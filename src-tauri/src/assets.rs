use anyhow::{bail, Context, Result};
use collage_core::ImageAsset;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, RgbaImage};
use moxcms::{ColorProfile, DataColorSpace, Layout, TransformOptions};
use std::{fs::{self, File}, io::{BufReader, Read}, path::Path};
use uuid::Uuid;

pub const MAX_SOURCE_PIXELS: u64 = 100_000_000;
pub const WORK_BUDGET: u64 = 1536 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 1024 * 1024 * 1024;

pub fn fingerprint(path: &Path) -> Result<String> {
    let meta = fs::metadata(path).with_context(|| format!("无法访问照片：{}", path.display()))?;
    if !meta.is_file() { bail!("素材不是普通文件：{}", path.display()); }
    if meta.len() > MAX_FILE_BYTES { bail!("照片文件超过 1 GB 安全读取上限"); }
    let mut file = File::open(path)?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 { break; }
        hasher.update(&buffer[..n]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

fn reader(path: &Path) -> Result<ImageReader<BufReader<File>>> {
    let mut reader = ImageReader::open(path)?.with_guessed_format()?;
    if !matches!(reader.format(), Some(ImageFormat::Jpeg | ImageFormat::Png)) {
        bail!("目前支持 JPG 和 PNG 照片");
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(32_768);
    limits.max_image_height = Some(32_768);
    limits.max_alloc = Some(512 * 1024 * 1024);
    reader.limits(limits);
    Ok(reader)
}

pub fn inspect(path: &Path, existing_id: Option<String>) -> Result<ImageAsset> {
    let path = path.canonicalize().with_context(|| format!("找不到照片：{}", path.display()))?;
    let hash = fingerprint(&path)?;
    let reader = reader(&path)?;
    let format = match reader.format() { Some(ImageFormat::Jpeg) => "jpg", _ => "png" };
    let mut decoder = reader.into_decoder()?;
    let (raw_width, raw_height) = decoder.dimensions();
    check_dimensions(raw_width, raw_height)?;
    let orientation = decoder.orientation()?.to_exif();
    let icc_data = decoder.icc_profile()?;
    if let Some(ref data) = icc_data { validate_profile(data)?; }
    let (width, height) = if orientation >= 5 { (raw_height, raw_width) } else { (raw_width, raw_height) };
    Ok(ImageAsset {
        id: existing_id.unwrap_or_else(|| Uuid::new_v4().to_string()),
        original_path: path.to_string_lossy().to_string(),
        file_name: path.file_name().unwrap_or_default().to_string_lossy().to_string(),
        width, height,
        raw_width, raw_height,
        orientation,
        format: format.into(), fingerprint: hash,
        icc: icc_data.map(|p| format!("RGB ICC · {} bytes", p.len())),
        source_root: path.parent().map(|p| p.to_string_lossy().to_string()),
        relative_path: path.file_name().map(|p| p.to_string_lossy().to_string()),
        file_size: fs::metadata(&path).ok().map(|m| m.len()),
        initial_path: Some(path.to_string_lossy().to_string()),
        previous_roots: vec![],
    })
}

/// Keep the user's original source identity through edits, moves and relinks.
pub fn inherit_location(mut inspected: ImageAsset, before: &ImageAsset) -> ImageAsset {
    inspected.initial_path = before.initial_path.clone().or_else(|| Some(before.original_path.clone()));
    let mut roots = before.previous_roots.clone();
    if let Some(root) = &before.source_root {
        if inspected.source_root.as_ref() != Some(root) && !roots.contains(root) { roots.push(root.clone()); }
    }
    if roots.len() > 16 { roots.drain(..roots.len() - 16); }
    inspected.previous_roots = roots;
    inspected
}

fn check_dimensions(width: u32, height: u32) -> Result<()> {
    if width == 0 || height == 0 || width as u64 * height as u64 > MAX_SOURCE_PIXELS {
        bail!("照片尺寸无效或超过 1 亿像素限制");
    }
    Ok(())
}

fn validate_profile(data: &[u8]) -> Result<ColorProfile> {
    if data.len() > 4 * 1024 * 1024 { bail!("ICC 配置过大"); }
    let profile = ColorProfile::new_from_slice(data).context("照片的 ICC 色彩配置无效")?;
    if profile.color_space != DataColorSpace::Rgb {
        bail!("此照片使用暂不支持的非 RGB ICC 配置，请先转换为 sRGB JPG/PNG");
    }
    Ok(profile)
}

/// Decode original, convert its RGB ICC to sRGB, and apply all EXIF mirror/rotation states once.
/// No metadata is copied to the composed output, so orientation cannot be applied a second time.
pub fn decode_srgb(asset: &ImageAsset, reserved_bytes: u64, destination_width: u32) -> Result<RgbaImage> {
    let path = Path::new(&asset.original_path);
    if fingerprint(path)? != asset.fingerprint { bail!("照片已在外部修改，请重新链接：{}", asset.file_name); }
    let mut decoder = reader(path)?.into_decoder()?;
    let (w, h) = decoder.dimensions();
    check_dimensions(w, h)?;
    let estimated = w as u64 * h as u64 * 16
        + destination_width as u64 * w.max(h) as u64 * 8
        + reserved_bytes + 96 * 1024 * 1024;
    if estimated > WORK_BUDGET { bail!("{} 超出 1.5 GB 图像任务预算，请缩小原图后重新导入", asset.file_name); }
    let orientation = decoder.orientation()?;
    let profile = decoder.icc_profile()?;
    let mut image = DynamicImage::from_decoder(decoder)?;
    image.apply_orientation(orientation);
    let mut rgba = image.into_rgba8();
    if let Some(data) = profile {
        let source = validate_profile(&data)?;
        let target = ColorProfile::new_srgb();
        let transform = source.create_transform_8bit(Layout::Rgba, &target, Layout::Rgba, TransformOptions::default())?;
        // Reuse a single row, rather than a second full-size decoded bitmap.
        let row_len = rgba.width() as usize * 4;
        let mut converted = vec![0u8; row_len];
        for row in rgba.as_mut().chunks_exact_mut(row_len) {
            transform.transform(row, &mut converted)?;
            row.copy_from_slice(&converted);
        }
    }
    if fingerprint(path)? != asset.fingerprint { bail!("读取时照片发生变化：{}", asset.file_name); }
    Ok(rgba)
}

pub fn srgb_profile() -> Result<Vec<u8>> {
    Ok(ColorProfile::new_srgb().encode()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, metadata::Orientation};

    #[test]
    fn all_eight_exif_states_preserve_distinct_pixels() {
        let image = RgbaImage::from_fn(3, 2, |x, y| Rgba([(y * 3 + x + 1) as u8, 0, 0, 255]));
        let expected: [&[u8]; 8] = [
            &[1,2,3,4,5,6], &[3,2,1,6,5,4], &[6,5,4,3,2,1], &[4,5,6,1,2,3],
            &[1,4,2,5,3,6], &[4,1,5,2,6,3], &[6,3,5,2,4,1], &[3,6,2,5,1,4]
        ];
        for exif in 1..=8 {
            let mut oriented = DynamicImage::ImageRgba8(image.clone());
            oriented.apply_orientation(Orientation::from_exif(exif).unwrap());
            let rgba = oriented.to_rgba8();
            assert_eq!(rgba.pixels().map(|p| p[0]).collect::<Vec<_>>(), expected[(exif - 1) as usize]);
            assert_eq!(rgba.dimensions(), if exif >= 5 { (2,3) } else { (3,2) });
        }
    }

    #[test]
    fn fingerprint_detects_changed_contents_with_same_length() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test");
        fs::write(&path, b"before").unwrap();
        let before = fingerprint(&path).unwrap();
        fs::write(&path, b"after!").unwrap();
        assert_ne!(before, fingerprint(&path).unwrap());
    }
}
