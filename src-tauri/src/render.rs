use crate::assets;
use anyhow::{bail, Context, Result};
use collage_core::{cover, layout, CoverResult, ImageAsset, ImageTransform, Page, PhotoColorTransform, Project, Rect};
use fast_image_resize::{FilterType, ResizeAlg, ResizeOptions, Resizer};
use image::{ImageBuffer, ImageEncoder, Rgb, RgbImage, Rgba, RgbaImage};
use std::{io::Write, sync::{atomic::{AtomicBool, Ordering}, OnceLock}};

type LinearImage = ImageBuffer<Rgba<u16>, Vec<u16>>;
const STRIP_HEIGHT: u32 = 128;

pub fn check_cancel(cancel: &AtomicBool) -> Result<()> {
    if cancel.load(Ordering::Relaxed) { bail!("导出已取消"); }
    Ok(())
}

fn linear_lut() -> &'static [u16; 256] {
    static LUT: OnceLock<[u16; 256]> = OnceLock::new();
    LUT.get_or_init(|| std::array::from_fn(|i| {
        let s = i as f64 / 255.0;
        let linear = if s <= 0.04045 { s / 12.92 } else { ((s + 0.055) / 1.055).powf(2.4) };
        (linear * 65535.0).round() as u16
    }))
}

fn srgb_lut() -> &'static [u8; 65536] {
    static LUT: OnceLock<[u8; 65536]> = OnceLock::new();
    LUT.get_or_init(|| std::array::from_fn(|i| {
        let l = i as f64 / 65535.0;
        let s = if l <= 0.0031308 { l * 12.92 } else { 1.055 * l.powf(1.0 / 2.4) - 0.055 };
        (s * 255.0).round().clamp(0.0, 255.0) as u8
    }))
}

fn to_linear(image: RgbaImage, cancel: &AtomicBool) -> Result<LinearImage> {
    let (w, h) = image.dimensions();
    let lookup = linear_lut();
    let mut result = LinearImage::new(w, h);
    for (row, (source, dest)) in image.as_raw().chunks_exact(w as usize * 4)
        .zip(result.as_mut().chunks_exact_mut(w as usize * 4)).enumerate() {
        if row % 128 == 0 { check_cancel(cancel)?; }
        for (s, d) in source.chunks_exact(4).zip(dest.chunks_exact_mut(4)) {
            // Linear premultiplied values prevent transparent edge contamination; resize
            // operates directly on these channels and never allocates an alpha-copy image.
            let alpha = s[3] as u32;
            for c in 0..3 { d[c] = ((lookup[s[c] as usize] as u32 * alpha + 127) / 255) as u16; }
            d[3] = (alpha * 257) as u16;
        }
    }
    Ok(result)
}

/// Placement adjustments use the same unpremultiplied linear-RGB transform as
/// the WASM preview. Apply once to this placement's decoded source, before any
/// resize/rotation, without allocating another image or changing source files.
fn adjust_linear_source(source: &mut LinearImage, color: &PhotoColorTransform, cancel: &AtomicBool) -> Result<()> {
    if color.is_neutral() { return Ok(()); }
    let stride = source.width() as usize * 4;
    for (row, pixels) in source.as_mut().chunks_exact_mut(stride).enumerate() {
        if row % 16 == 0 { check_cancel(cancel)?; }
        for pixel in pixels.chunks_exact_mut(4) {
            let alpha = pixel[3];
            if alpha == 0 {
                pixel[..3].fill(0);
                continue;
            }
            let linear = std::array::from_fn(|channel| pixel[channel] as f32 / alpha as f32);
            let adjusted = color.apply(linear);
            for channel in 0..3 {
                pixel[channel] = (adjusted[channel] * alpha as f32).round().clamp(0.0, alpha as f32) as u16;
            }
        }
    }
    Ok(())
}

fn options(crop: Rect) -> ResizeOptions {
    ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Lanczos3))
        .use_alpha(false).crop(crop.x, crop.y, crop.width, crop.height)
}

/// Every strip uses the global crop-to-output mapping and the full source image.
/// Filter support therefore crosses strip boundaries: no seams or repeated edge pixels.
fn resized_strips(
    source: &LinearImage, crop: Rect, width: u32, height: u32, strip_height: u32,
    cancel: &AtomicBool, mut consume: impl FnMut(u32, &LinearImage) -> Result<()>,
) -> Result<()> {
    let mut resizer = Resizer::new();
    let scale_y = crop.height / height as f64;
    for top in (0..height).step_by(strip_height as usize) {
        check_cancel(cancel)?;
        let count = strip_height.min(height - top);
        let region_y = crop.y + top as f64 * scale_y;
        // The last strip may mathematically end on the source edge while f64
        // multiplication places it a few ulps beyond it (e.g. 600px -> 6000px).
        // Derive its extent from the available source pixels to keep the sampler
        // inside the image without changing the global crop mapping.
        let region = Rect {
            x: crop.x,
            y: region_y,
            width: crop.width.min(source.width() as f64 - crop.x),
            height: (count as f64 * scale_y).min(source.height() as f64 - region_y),
        };
        let mut strip = LinearImage::new(width, count);
        resizer.resize(source, &mut strip, &options(region)).context("照片采样失败")?;
        consume(top, &strip)?;
    }
    Ok(())
}

/// Downsample before rotation so one destination pixel does not select only a
/// handful of pixels from a large original. Convolution works in premultiplied
/// linear light; the affine pass below then interpolates at approximately 1:1.
/// Upscaling is sampled from the original and never allocates an enlarged photo.
fn prepare_rotation_source(
    source: LinearImage, scale: f64, reserved_bytes: u64, cancel: &AtomicBool,
) -> Result<LinearImage> {
    if scale >= 1.0 { return Ok(source); }
    let width = (source.width() as f64 * scale).ceil().max(1.0) as u32;
    let height = (source.height() as f64 * scale).ceil().max(1.0) as u32;
    if (width, height) == source.dimensions() { return Ok(source); }
    // Includes the existing source, reduced bitmap, convolution scratch, output
    // strip and bookkeeping. It is checked before allocating the reduced bitmap.
    let estimated = reserved_bytes + source.width() as u64 * source.height() as u64 * 8
        + width as u64 * height as u64 * 8
        + width as u64 * source.height() as u64 * 8
        + width as u64 * STRIP_HEIGHT as u64 * 8 + 96 * 1024 * 1024;
    if estimated > assets::WORK_BUDGET { bail!("旋转照片采样超过 1.5 GB 图像任务预算，请缩小原图后重新导入"); }
    check_cancel(cancel)?;
    let crop = Rect { x: 0.0, y: 0.0, width: source.width() as f64, height: source.height() as f64 };
    let mut reduced = LinearImage::new(width, height);
    resized_strips(&source, crop, width, height, STRIP_HEIGHT, cancel, |top, strip| {
        let stride = width as usize * 4;
        let start = top as usize * stride;
        reduced.as_mut()[start..start + strip.as_raw().len()].copy_from_slice(strip.as_raw());
        Ok(())
    })?;
    Ok(reduced)
}

/// Coordinates describe the outer edges of the image; pixel centers are at
/// n+0.5. Edge extension applies only inside those edges, so transparent pixels
/// keep their alpha and genuinely outside samples do not smear edge colors.
fn sample_bilinear(source: &LinearImage, x: f64, y: f64) -> [u16; 4] {
    let width = source.width();
    let height = source.height();
    const EDGE_EPSILON: f64 = 1e-7;
    if x < -EDGE_EPSILON || y < -EDGE_EPSILON
        || x > width as f64 + EDGE_EPSILON || y > height as f64 + EDGE_EPSILON {
        return [0; 4];
    }
    let x = (x - 0.5).clamp(0.0, width as f64 - 1.0);
    let y = (y - 0.5).clamp(0.0, height as f64 - 1.0);
    let x0 = x.floor() as u32;
    let y0 = y.floor() as u32;
    let x1 = (x0 + 1).min(width - 1);
    let y1 = (y0 + 1).min(height - 1);
    let fraction_x = x - x0 as f64;
    let fraction_y = y - y0 as f64;
    let p00 = source.get_pixel(x0, y0).0;
    let p10 = source.get_pixel(x1, y0).0;
    let p01 = source.get_pixel(x0, y1).0;
    let p11 = source.get_pixel(x1, y1).0;
    std::array::from_fn(|channel| {
        let top = p00[channel] as f64 * (1.0 - fraction_x) + p10[channel] as f64 * fraction_x;
        let bottom = p01[channel] as f64 * (1.0 - fraction_x) + p11[channel] as f64 * fraction_x;
        (top * (1.0 - fraction_y) + bottom * fraction_y).round().clamp(0.0, 65535.0) as u16
    })
}

/// The geometry result uses page coordinates and the complete oriented photo's
/// unrotated width/height. Inverse rotation is independent of strip boundaries
/// and of any preceding Lanczos reduction, matching Canvas/Konva's transform.
fn rotated_strips(
    source: &LinearImage, transform: &CoverResult, left: u32, top: u32, width: u32,
    height: u32, strip_height: u32, cancel: &AtomicBool,
    mut consume: impl FnMut(u32, &LinearImage) -> Result<()>,
) -> Result<()> {
    let (sin, cos) = transform.rotation.to_radians().sin_cos();
    let factor_x = source.width() as f64 / transform.width;
    let factor_y = source.height() as f64 / transform.height;
    let delta_x = left as f64 + 0.5 - transform.center_x;
    for strip_top in (0..height).step_by(strip_height as usize) {
        check_cancel(cancel)?;
        let count = strip_height.min(height - strip_top);
        let mut strip = LinearImage::new(width, count);
        for y in 0..count {
            if y % 16 == 0 { check_cancel(cancel)?; }
            let delta_y = (top + strip_top + y) as f64 + 0.5 - transform.center_y;
            let origin_x = source.width() as f64 / 2.0 + (cos * delta_x + sin * delta_y) * factor_x;
            let origin_y = source.height() as f64 / 2.0 + (-sin * delta_x + cos * delta_y) * factor_y;
            for x in 0..width {
                let source_x = origin_x + x as f64 * cos * factor_x;
                let source_y = origin_y - x as f64 * sin * factor_y;
                strip.put_pixel(x, y, Rgba(sample_bilinear(source, source_x, source_y)));
            }
        }
        consume(strip_top, &strip)?;
    }
    Ok(())
}

fn background(hex: &str) -> Result<[u8; 3]> {
    if hex.len() != 7 || !hex.starts_with('#') || !hex[1..].bytes().all(|v| v.is_ascii_hexdigit()) { bail!("无效的页面背景颜色"); }
    Ok([u8::from_str_radix(&hex[1..3], 16)?, u8::from_str_radix(&hex[3..5], 16)?, u8::from_str_radix(&hex[5..7], 16)?])
}

fn composite_pixel(source: [u16; 4], under: [u8; 3], layer_alpha: u64, linear: &[u16; 256], srgb: &[u8; 65536]) -> [u8; 3] {
    let alpha = (source[3] as u64 * layer_alpha + 32767) / 65535;
    if alpha == 0 { return under; }
    let inverse = 65535 - alpha;
    std::array::from_fn(|channel| {
        let premultiplied = (source[channel].min(source[3]) as u64 * layer_alpha + 32767) / 65535;
        let composite = premultiplied + (linear[under[channel] as usize] as u64 * inverse + 32767) / 65535;
        srgb[composite.min(65535) as usize]
    })
}

/// Preview proxies have straight alpha. Match the batch export's white matte in linear sRGB.
pub(crate) fn watermark_preview_matte(proxy: &RgbaImage) -> RgbImage {
    let linear = linear_lut();
    let srgb = srgb_lut();
    RgbImage::from_fn(proxy.width(), proxy.height(), |x, y| {
        let pixel = proxy.get_pixel(x, y).0;
        let alpha = pixel[3] as u32;
        if alpha == 255 { return Rgb([pixel[0], pixel[1], pixel[2]]); }
        Rgb(std::array::from_fn(|channel| {
            let foreground = (linear[pixel[channel] as usize] as u32 * alpha + 127) / 255;
            srgb[(foreground + (255 - alpha) * 257) as usize]
        }))
    })
}

pub(crate) struct StampPlacement {
    /// Bounds of the rotated mark, in output pixels.
    pub rect: Rect,
    pub width: f64,
    pub height: f64,
    pub rotation: f64,
    pub gaps: Option<(f64, f64)>,
}

/// Resample the rotated, transparent mark only once, even when it covers the
/// whole photograph as a tile. The sampling and alpha math are shared with
/// collage renders, with no rotated cover crop or opaque background.
pub(crate) fn draw_watermark(
    result: &mut RgbImage, decoded: RgbaImage, mark: StampPlacement, opacity: f64, cancel: &AtomicBool,
) -> Result<()> {
    check_cancel(cancel)?;
    if opacity == 0.0 { return Ok(()); }
    let rect = mark.rect;
    let left = rect.x.round() as i64;
    let top = rect.y.round() as i64;
    let width = ((rect.x + rect.width).round() as i64 - left).max(1) as u32;
    let height = ((rect.y + rect.height).round() as i64 - top).max(1) as u32;
    let reserved = result.as_raw().len() as u64;
    let source_bytes = decoded.as_raw().len() as u64 * 3;
    let stamp_bytes = if mark.gaps.is_some() { width as u64 * height as u64 * 8 } else { 0 };
    let scratch_bytes = width as u64 * decoded.height() as u64 * 8 + width as u64 * STRIP_HEIGHT as u64 * 8;
    if reserved + source_bytes + stamp_bytes + scratch_bytes + 96 * 1024 * 1024 > assets::WORK_BUDGET {
        bail!("水印采样超过图像任务内存预算，请缩小水印或原图");
    }

    let source = to_linear(decoded, cancel)?;
    let mut stamp = mark.gaps.map(|_| LinearImage::new(width, height));
    let linear = linear_lut();
    let srgb = srgb_lut();
    let layer_alpha = (opacity * 65535.0).round() as u64;
    let canvas_width = result.width() as i64;
    let canvas_height = result.height() as i64;
    let mut use_strip = |strip_top, strip: &LinearImage| {
        if let Some(stamp) = &mut stamp {
            let start = strip_top as usize * width as usize * 4;
            stamp.as_mut()[start..start + strip.as_raw().len()].copy_from_slice(strip.as_raw());
            return Ok(());
        }
        for row in 0..strip.height() {
            if row % 16 == 0 { check_cancel(cancel)?; }
            let y = top + strip_top as i64 + row as i64;
            if !(0..canvas_height).contains(&y) { continue; }
            for x in left.max(0)..(left + width as i64).min(canvas_width) {
                let source = strip.get_pixel((x - left) as u32, row).0;
                if source[3] == 0 { continue; }
                let under = result.get_pixel_mut(x as u32, y as u32);
                under.0 = composite_pixel(source, under.0, layer_alpha, linear, srgb);
            }
        }
        Ok(())
    };
    if mark.rotation == 0.0 {
        let crop = Rect { x: 0.0, y: 0.0, width: source.width() as f64, height: source.height() as f64 };
        resized_strips(&source, crop, width, height, STRIP_HEIGHT, cancel, &mut use_strip)?;
    } else {
        let scale = (mark.width / source.width() as f64).min(mark.height / source.height() as f64);
        let source = prepare_rotation_source(source, scale, reserved + stamp_bytes, cancel)?;
        let transform = CoverResult {
            center_x: width as f64 / 2.0, center_y: height as f64 / 2.0,
            x: (width as f64 - mark.width) / 2.0, y: (height as f64 - mark.height) / 2.0,
            width: mark.width, height: mark.height, rotation: mark.rotation, scale,
            crop: Rect { x: 0.0, y: 0.0, width: source.width() as f64, height: source.height() as f64 },
        };
        rotated_strips(&source, &transform, 0, 0, width, height, STRIP_HEIGHT, cancel, &mut use_strip)?;
    }

    let (Some(stamp), Some((gap_x, gap_y))) = (stamp, mark.gaps) else { return Ok(()); };
    // Round each tile's origin independently. Rounding the pitch once would
    // accumulate an increasingly visible phase error on smaller previews.
    let x_step = (rect.width + gap_x).max(1.0);
    let y_step = (rect.height + gap_y).max(1.0);
    let first_x = rect.x.rem_euclid(x_step) - x_step;
    let columns: Vec<_> = (0..=canvas_width + 1)
        .map(|index| (first_x + index as f64 * x_step + 0.5).floor() as i64)
        .take_while(|start| *start < canvas_width)
        .chain(std::iter::once(canvas_width))
        .collect();
    for y in 0..canvas_height {
        if y % 16 == 0 { check_cancel(cancel)?; }
        let index = ((y as f64 + 0.5 - 1e-8 - rect.y) / y_step).floor();
        let mark_y = y - (rect.y + index * y_step + 0.5).floor() as i64;
        if !(0..height as i64).contains(&mark_y) { continue; }
        for column in columns.windows(2) {
            let x = column[0];
            let start = x.max(0);
            let end = (x + width as i64).min(column[1]);
            for output_x in start..end {
                let pixel = stamp.get_pixel((output_x - x) as u32, mark_y as u32).0;
                if pixel[3] == 0 { continue; }
                let under = result.get_pixel_mut(output_x as u32, y as u32);
                under.0 = composite_pixel(pixel, under.0, layer_alpha, linear, srgb);
            }
        }
    }
    Ok(())
}

/// Background and foreground photos share decoding, nondestructive color and
/// geometry. Composite onto the existing canvas in linear light, so transparent
/// foreground pixels reveal the background photo (or an earlier overlapping
/// frame). Both premultiplied RGB and source alpha receive the layer opacity.
pub(crate) fn render_placement(
    result: &mut RgbImage, asset: &ImageAsset, rect: Rect,
    placement: &ImageTransform, opacity: f64, cancel: &AtomicBool,
) -> Result<()> {
    check_cancel(cancel)?;
    let (width, height) = result.dimensions();
    let left = rect.x.round().clamp(0.0, width as f64) as u32;
    let top = rect.y.round().clamp(0.0, height as f64) as u32;
    let right = (rect.x + rect.width).round().clamp(0.0, width as f64) as u32;
    let bottom = (rect.y + rect.height).round().clamp(0.0, height as f64) as u32;
    if right <= left || bottom <= top { return Ok(()); }
    let frame_width = right - left;
    let frame_height = bottom - top;
    let reserved = width as u64 * height as u64 * 3;
    let transform = cover(&rect, asset.width as f64, asset.height as f64, placement)?;
    // Decode even an invisible layer to retain the original-file fingerprint,
    // dimensions and image-budget checks used by every exported placement.
    let decoded = assets::decode_srgb(asset, reserved, frame_width)?;
    if decoded.dimensions() != (asset.width, asset.height) { bail!("照片尺寸发生变化，请重新链接：{}", asset.file_name); }
    if opacity == 0.0 { return Ok(()); }
    let mut source = to_linear(decoded, cancel)?;
    let color = PhotoColorTransform::new(&placement.adjustments);
    adjust_linear_source(&mut source, &color, cancel)?;
    let layer_alpha = (opacity * 65535.0).round() as u64;
    let linear = linear_lut();
    let srgb = srgb_lut();
    let mut composite_strip = |strip_top, strip: &LinearImage| {
        for y in 0..strip.height() {
            if y % 16 == 0 { check_cancel(cancel)?; }
            for x in 0..strip.width() {
                let source = strip.get_pixel(x, y).0;
                if source[3] == 0 { continue; }
                let under = result.get_pixel_mut(left + x, top + strip_top + y);
                under.0 = composite_pixel(source, under.0, layer_alpha, linear, srgb);
            }
        }
        Ok(())
    };
    if transform.rotation == 0.0 {
        resized_strips(&source, transform.crop, frame_width, frame_height, STRIP_HEIGHT, cancel, &mut composite_strip)?;
    } else {
        let source = prepare_rotation_source(source, transform.scale, reserved, cancel)?;
        rotated_strips(&source, &transform, left, top, frame_width, frame_height, STRIP_HEIGHT, cancel, &mut composite_strip)?;
    }
    // Source and resize scratch are dropped after each layer.
    Ok(())
}

pub fn render_page(project: &Project, page: &Page, cancel: &AtomicBool) -> Result<RgbImage> {
    check_cancel(cancel)?;
    let width = project.document.width as u32;
    let height = project.document.height as u32;
    let reserved = width as u64 * height as u64 * 3;
    if reserved + 128 * 1024 * 1024 > assets::WORK_BUDGET { bail!("页面尺寸超过图像内存预算"); }
    let bg = background(&page.background)?;
    let template = project.templates.get(&page.template_id).context("找不到页面模板")?;
    let resolved = layout(page, &project.document, template)?;
    let mut result = RgbImage::from_pixel(width, height, Rgb(bg));
    if let Some(image) = &page.background_image {
        let asset = project.assets.get(&image.image_asset_id).context("找不到背景照片素材")?;
        let page_rect = Rect { x: 0.0, y: 0.0, width: width as f64, height: height as f64 };
        render_placement(&mut result, asset, page_rect, &image.transform, image.opacity, cancel)?;
    }
    for resolved in resolved.frames {
        let frame = page.frames.iter().find(|f| f.slot_id == resolved.slot_id).context("模板照片框不匹配")?;
        let Some(id) = &frame.image_asset_id else { continue; };
        let asset = project.assets.get(id).context("找不到照片素材")?;
        render_placement(&mut result, asset, resolved.rect, &frame.transform, 1.0, cancel)?;
    }
    check_cancel(cancel)?;
    Ok(result)
}

pub fn make_proxy(asset: &collage_core::ImageAsset, max_size: u32) -> Result<RgbaImage> {
    let cancel = AtomicBool::new(false);
    let ratio = (max_size as f64 / asset.width.max(asset.height) as f64).min(1.0);
    let width = (asset.width as f64 * ratio).round().max(1.0) as u32;
    let height = (asset.height as f64 * ratio).round().max(1.0) as u32;
    let decoded = assets::decode_srgb(asset, width as u64 * height as u64 * 4, width)?;
    let crop = Rect { x: 0.0, y: 0.0, width: decoded.width() as f64, height: decoded.height() as f64 };
    let source = to_linear(decoded, &cancel)?;
    let srgb = srgb_lut();
    let mut result = RgbaImage::new(width, height);
    resized_strips(&source, crop, width, height, STRIP_HEIGHT, &cancel, |top, strip| {
        for y in 0..strip.height() {
            for x in 0..width {
                let p = strip.get_pixel(x, y).0;
                let alpha = p[3] as u64;
                let mut rgba = [0u8; 4];
                if alpha > 0 {
                    for c in 0..3 { rgba[c] = srgb[((p[c] as u64 * 65535 + alpha / 2) / alpha).min(65535) as usize]; }
                    rgba[3] = ((alpha + 128) / 257).min(255) as u8;
                }
                result.put_pixel(x, top + y, Rgba(rgba));
            }
        }
        Ok(())
    })?;
    Ok(result)
}

pub fn encode_rgb(image: &RgbImage, writer: &mut impl Write, format: &str, quality: u8) -> Result<()> {
    match format {
        "png" => {
            let mut encoder = image::codecs::png::PngEncoder::new_with_quality(writer, image::codecs::png::CompressionType::Default, image::codecs::png::FilterType::Adaptive);
            encoder.set_icc_profile(assets::srgb_profile()?)?;
            encoder.write_image(image.as_raw(), image.width(), image.height(), image::ExtendedColorType::Rgb8)?;
        }
        "jpg" => {
            let mut encoder = jpeg_encoder::Encoder::new(writer, quality);
            encoder.set_sampling_factor(jpeg_encoder::SamplingFactor::F_1_1);
            encoder.add_icc_profile(&assets::srgb_profile()?)?;
            encoder.encode(image.as_raw(), image.width() as u16, image.height() as u16, jpeg_encoder::ColorType::Rgb)?;
        }
        _ => bail!("不支持的导出格式"),
    }
    Ok(())
}

pub fn encode_proxy(image: &RgbaImage, writer: &mut impl Write) -> Result<()> {
    let mut encoder = image::codecs::png::PngEncoder::new(writer);
    encoder.set_icc_profile(assets::srgb_profile()?)?;
    encoder.write_image(image.as_raw(), image.width(), image.height(), image::ExtendedColorType::Rgba8)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strips_match_full_render_with_fractional_crop() {
        let input = RgbaImage::from_fn(91, 133, |x, y| Rgba([(x * 11 % 256) as u8, (y * 7 % 256) as u8, ((x + y) * 13 % 256) as u8, 255]));
        let cancel = AtomicBool::new(false);
        let source = to_linear(input, &cancel).unwrap();
        let crop = Rect { x: 2.3, y: 8.15, width: 81.7, height: 112.1 };
        let mut full = LinearImage::new(73, 99);
        Resizer::new().resize(&source, &mut full, &options(crop)).unwrap();
        let mut tiled = LinearImage::new(73, 99);
        resized_strips(&source, crop, 73, 99, 13, &cancel, |top, strip| {
            for (x, y, pixel) in strip.enumerate_pixels() { tiled.put_pixel(x, top + y, *pixel); }
            Ok(())
        }).unwrap();
        let max_error = tiled.as_raw().iter().zip(full.as_raw()).map(|(a, b)| a.abs_diff(*b)).max().unwrap();
        assert!(max_error <= 2, "strip seam error {max_error}");
    }

    #[test]
    fn transparent_red_does_not_bleed_into_opaque_blue() {
        let image = RgbaImage::from_fn(20, 20, |x, _| if x < 10 { Rgba([255, 0, 0, 0]) } else { Rgba([0, 0, 255, 255]) });
        let cancel = AtomicBool::new(false);
        let source = to_linear(image, &cancel).unwrap();
        let mut output = LinearImage::new(4, 4);
        Resizer::new().resize(&source, &mut output, &options(Rect { x: 0.0, y: 0.0, width: 20.0, height: 20.0 })).unwrap();
        assert!(output.pixels().all(|p| p[0] == 0 && p[1] == 0));
    }

    #[test]
    fn cancelled_render_stops_before_allocation() {
        assert!(check_cancel(&AtomicBool::new(true)).is_err());
    }

    #[test]
    fn cancellation_during_resize_stops_before_the_next_strip() {
        let cancel = AtomicBool::new(false);
        let source = LinearImage::from_pixel(100, 100, Rgba([32768, 0, 0, 65535]));
        let mut consumed = 0;
        let outcome = resized_strips(&source, Rect { x: 0.0, y: 0.0, width: 100.0, height: 100.0 }, 400, 400, 32, &cancel, |_, _| {
            consumed += 1;
            cancel.store(true, Ordering::Relaxed);
            Ok(())
        });
        assert!(outcome.is_err());
        assert_eq!(consumed, 1);
    }

    #[test]
    fn rotated_strips_match_one_pass_and_cancel_between_strips() {
        let cancel = AtomicBool::new(false);
        let source = LinearImage::from_fn(91, 133, |x, y| Rgba([(x * 700) as u16, (y * 450) as u16, 12000, 65535]));
        let transform = cover(&Rect { x: 7.0, y: 11.0, width: 73.0, height: 99.0 }, 91.0, 133.0,
            &collage_core::ImageTransform { rotation: 37.0, ..Default::default() }).unwrap();
        let mut full = LinearImage::new(73, 99);
        rotated_strips(&source, &transform, 7, 11, 73, 99, 99, &cancel, |top, strip| {
            for (x, y, pixel) in strip.enumerate_pixels() { full.put_pixel(x, top + y, *pixel); }
            Ok(())
        }).unwrap();
        let mut tiled = LinearImage::new(73, 99);
        rotated_strips(&source, &transform, 7, 11, 73, 99, 13, &cancel, |top, strip| {
            for (x, y, pixel) in strip.enumerate_pixels() { tiled.put_pixel(x, top + y, *pixel); }
            Ok(())
        }).unwrap();
        assert_eq!(tiled, full);
        assert!(full.pixels().all(|p| p[3] == 65535), "automatic cover must not leave outside samples");
        let mut consumed = 0;
        let outcome = rotated_strips(&source, &transform, 7, 11, 73, 99, 13, &cancel, |_, _| {
            consumed += 1;
            cancel.store(true, Ordering::Relaxed);
            Ok(())
        });
        assert!(outcome.is_err());
        assert_eq!(consumed, 1);
    }

    #[test]
    fn rotated_minification_filters_a_one_pixel_checkerboard() {
        let cancel = AtomicBool::new(false);
        let source = to_linear(RgbaImage::from_fn(512, 512, |x, y| {
            let value = if (x + y) % 2 == 0 { 0 } else { 255 };
            Rgba([value, value, value, 255])
        }), &cancel).unwrap();
        let transform = cover(&Rect { x: 0.0, y: 0.0, width: 36.0, height: 36.0 }, 512.0, 512.0,
            &collage_core::ImageTransform { rotation: 37.0, ..Default::default() }).unwrap();
        assert!(transform.scale < 0.1);
        let source = prepare_rotation_source(source, transform.scale, 36 * 36 * 3, &cancel).unwrap();
        assert!(source.width() < 52);
        rotated_strips(&source, &transform, 0, 0, 36, 36, 8, &cancel, |top, strip| {
            for (x, y, pixel) in strip.enumerate_pixels() {
                if x > 2 && x < 33 && top + y > 2 && top + y < 33 {
                    assert!(pixel[0].abs_diff(32768) < 100, "checkerboard should average in linear light");
                }
                assert_eq!(pixel[3], 65535);
            }
            Ok(())
        }).unwrap();
    }

    #[test]
    fn rotation_prefilter_rejects_excess_budget_before_allocating() {
        let cancel = AtomicBool::new(false);
        let source = LinearImage::new(16, 16);
        assert!(prepare_rotation_source(source, 0.5, assets::WORK_BUDGET, &cancel).is_err());
    }

    #[test]
    fn rotated_zoom_and_focus_map_page_pixel_centers_to_the_original() {
        let cancel = AtomicBool::new(false);
        let source = LinearImage::from_fn(120, 180, |x, y| Rgba([(x * 500) as u16, (y * 300) as u16, 0, 65535]));
        let transform = cover(&Rect { x: 0.0, y: 0.0, width: 180.0, height: 120.0 }, 120.0, 180.0,
            &collage_core::ImageTransform { zoom: 2.0, focus_x: 0.2, focus_y: 0.7, rotation: 90.0, ..Default::default() }).unwrap();
        // At 90 degrees and 2x cover, focus X is clamped to .25 while Y stays
        // .7. The rendered center is (162,120). Pixel (67,45)'s center maps
        // to source outer-edge coordinates (22.75,137.25), or sample-index
        // coordinates (22.25,136.75). These expected values are independent
        // of rotated_strips' interpolation and catch a shifted rotation pivot.
        assert!((transform.center_x - 162.0).abs() < 1e-8);
        assert!((transform.center_y - 120.0).abs() < 1e-8);
        rotated_strips(&source, &transform, 0, 0, 180, 120, 17, &cancel, |top, strip| {
            if top <= 45 && top + strip.height() > 45 {
                let pixel = strip.get_pixel(67, 45 - top).0;
                assert_eq!(pixel, [11125, 41025, 0, 65535]);
            }
            Ok(())
        }).unwrap();
    }

    #[test]
    fn photo_adjustments_preserve_alpha_and_use_the_existing_source_buffer() {
        let cancel = AtomicBool::new(false);
        let mut source = to_linear(RgbaImage::from_fn(3, 1, |x, _| match x {
            0 => Rgba([255, 0, 0, 0]),
            1 => Rgba([100, 120, 140, 128]),
            _ => Rgba([80, 100, 120, 255]),
        }), &cancel).unwrap();
        let original = source.clone();
        let pointer = source.as_raw().as_ptr();
        adjust_linear_source(&mut source, &PhotoColorTransform::new(&Default::default()), &cancel).unwrap();
        assert_eq!(source, original, "neutral settings preserve every linear16 sample");
        let color = PhotoColorTransform::new(&collage_core::PhotoAdjustments { exposure: 1.0, temperature: 40.0, blacks: -20.0, ..Default::default() });
        adjust_linear_source(&mut source, &color, &cancel).unwrap();
        assert_eq!(source.as_raw().as_ptr(), pointer, "adjustments must not duplicate a full source image");
        assert_eq!(source.get_pixel(0, 0).0, [0, 0, 0, 0]);
        assert_eq!(source.get_pixel(1, 0)[3], 128 * 257);
        assert_eq!(source.get_pixel(2, 0)[3], 65535);
        assert_ne!(source.get_pixel(1, 0), original.get_pixel(1, 0));
        assert!(source.pixels().all(|pixel| pixel.0[..3].iter().all(|channel| *channel <= pixel[3])));
        assert!(adjust_linear_source(&mut source, &color, &AtomicBool::new(true)).is_err());
    }
}
