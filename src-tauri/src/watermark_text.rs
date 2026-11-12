//! Core Text lays out the same installed fonts for the preview and export.

use crate::watermark::Placement;
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Alignment {
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextColorRange {
    // Core Text and the editor both index strings by UTF-16 code unit.
    pub start: usize,
    pub end: usize,
    pub color: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextStroke {
    pub color: String,
    pub width: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextShadow {
    pub color: String,
    pub opacity: f64,
    pub offset_x: f64,
    pub offset_y: f64,
    pub blur: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextBackground {
    pub color: String,
    pub opacity: f64,
    pub padding: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TextWatermark {
    pub text: String,
    pub font_family: String,
    pub font_weight: u16,
    pub font_size: f64,
    pub color: String,
    pub character_spacing: f64,
    pub line_spacing: f64,
    pub italic_angle: f64,
    pub alignment: Alignment,
    pub wrap_width: f64,
    pub scale: f64,
    pub placement: Placement,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub color_ranges: Vec<TextColorRange>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke: Option<TextStroke>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shadow: Option<TextShadow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<TextBackground>,
}

fn is_hex_color(color: &str) -> bool {
    color.len() == 7
        && color.starts_with('#')
        && color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}

impl TextWatermark {
    pub(crate) fn validate(&self) -> Result<()> {
        let units: Vec<_> = self.text.encode_utf16().take(2001).collect();
        if self.text.trim().is_empty() || units.len() > 2000 {
            bail!("请输入 1～2000 个字符作为文字水印");
        }
        if self.font_family.len() > 512 || self.font_family.chars().any(char::is_control) {
            bail!("水印字体名称无效");
        }
        if !(100..=900).contains(&self.font_weight)
            || !(1.0..=512.0).contains(&self.font_size)
            || !(-20.0..=200.0).contains(&self.character_spacing)
            || !(0.0..=500.0).contains(&self.line_spacing)
            || !(-45.0..=45.0).contains(&self.italic_angle)
            || !(0.0..=8192.0).contains(&self.wrap_width)
            || !(0.1..=10.0).contains(&self.scale)
        {
            bail!("水印文字的字号、间距或缩放无效");
        }
        if !is_hex_color(&self.color) {
            bail!("水印文字颜色必须是 #RRGGBB");
        }
        let is_char_boundary = |index| {
            units
                .get(index)
                .is_none_or(|unit| !(0xDC00..=0xDFFF).contains(unit))
        };
        let mut previous_end = 0;
        for range in &self.color_ranges {
            if range.start < previous_end
                || range.start >= range.end
                || range.end > units.len()
                || !is_char_boundary(range.start)
                || !is_char_boundary(range.end)
                || !is_hex_color(&range.color)
            {
                bail!("水印文字的局部颜色范围无效");
            }
            previous_end = range.end;
        }
        if self.stroke.as_ref().is_some_and(|stroke| {
            !is_hex_color(&stroke.color) || !(0.0..=32.0).contains(&stroke.width)
        }) {
            bail!("水印文字的描边颜色或宽度无效");
        }
        if self.shadow.as_ref().is_some_and(|shadow| {
            !is_hex_color(&shadow.color)
                || !(0.0..=1.0).contains(&shadow.opacity)
                || !(-64.0..=64.0).contains(&shadow.offset_x)
                || !(-64.0..=64.0).contains(&shadow.offset_y)
                || !(0.0..=64.0).contains(&shadow.blur)
        }) {
            bail!("水印文字的投影颜色或参数无效");
        }
        if self.background.as_ref().is_some_and(|background| {
            !is_hex_color(&background.color)
                || !(0.0..=1.0).contains(&background.opacity)
                || !(0.0..=64.0).contains(&background.padding)
        }) {
            bail!("水印文字的色块颜色或参数无效");
        }
        self.placement.validate()
    }
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use anyhow::Context;
    use image::RgbaImage;
    use objc2_core_foundation::{
        CFAttributedString, CFDictionary, CFMutableAttributedString, CFNumber, CFRange, CFRetained,
        CFString, CFType, CGAffineTransform, CGPoint, CGRect, CGSize,
    };
    use objc2_core_graphics::{
        kCGColorSpaceSRGB, CGBitmapContextCreate, CGBitmapInfo, CGColor, CGColorSpace, CGContext,
        CGImageAlphaInfo, CGImageByteOrderInfo, CGLineJoin,
    };
    use objc2_core_text::{
        kCTFontAttributeName, kCTFontFamilyNameAttribute, kCTFontTraitsAttribute,
        kCTFontWeightTrait, kCTForegroundColorAttributeName, kCTKernAttributeName,
        kCTStrokeColorAttributeName, kCTStrokeWidthAttributeName, CTFont, CTFontDescriptor,
        CTFontManagerCopyAvailableFontFamilyNames, CTFontOptions, CTLine, CTTypesetter,
    };
    use std::ptr::{null, null_mut};

    pub(crate) fn font_families() -> Result<Vec<String>> {
        // Core Text documents this array as visible CFString family names.
        let names = unsafe { CTFontManagerCopyAvailableFontFamilyNames() };
        let names = unsafe { names.cast_unchecked::<CFString>() };
        Ok(names.iter().map(|name| name.to_string()).collect())
    }

    fn font(settings: &TextWatermark) -> Result<CFRetained<CTFont>> {
        let family = if settings.font_family.is_empty() {
            "Helvetica Neue"
        } else {
            &settings.font_family
        };
        let name = CFString::from_str(family);
        // Core Text maps the CSS-like 100–900 scale to the closest installed face.
        let weight = CFNumber::new_cgfloat((settings.font_weight as f64 - 400.0) / 800.0);
        let traits = CFDictionary::from_slices(&[unsafe { kCTFontWeightTrait }], &[&*weight]);
        let attributes = CFDictionary::<CFString, CFType>::from_slices(
            &[unsafe { kCTFontFamilyNameAttribute }, unsafe {
                kCTFontTraitsAttribute
            }],
            &[name.as_ref(), traits.as_ref()],
        );
        let descriptor = unsafe { CTFontDescriptor::with_attributes(attributes.as_opaque()) };
        let font = unsafe {
            CTFont::with_font_descriptor_and_options(
                &descriptor,
                settings.font_size * settings.scale,
                null(),
                CTFontOptions::PreventAutoActivation,
            )
        };
        let actual = unsafe { font.family_name() };
        if actual.to_string() != family {
            bail!("本机未找到水印字体「{family}」，请选择其他字体");
        }
        Ok(font)
    }

    fn color(hex: &str, alpha: f64) -> CFRetained<CGColor> {
        let component = |index| {
            u8::from_str_radix(&hex[index..index + 2], 16).expect("validated hex color") as f64
                / 255.0
        };
        CGColor::new_srgb(component(1), component(3), component(5), alpha)
    }

    fn paragraphs(text: &str) -> impl Iterator<Item = (&str, usize)> {
        let mut remaining = Some(text);
        let mut offset = 0;
        std::iter::from_fn(move || {
            let rest = remaining.take()?;
            let split = rest.find(['\r', '\n']).unwrap_or(rest.len());
            let (paragraph, suffix) = rest.split_at(split);
            let paragraph_start = offset;
            if !suffix.is_empty() {
                let separator_len = if suffix.starts_with("\r\n") { 2 } else { 1 };
                offset += paragraph.encode_utf16().count() + separator_len;
                remaining = Some(&suffix[separator_len..]);
            }
            Some((paragraph, paragraph_start))
        })
    }

    fn styled_paragraph(
        paragraph: &str,
        offset: usize,
        length: usize,
        attributes: &CFDictionary<CFString, CFType>,
        colors: &[TextColorRange],
    ) -> Result<CFRetained<CFMutableAttributedString>> {
        let string = CFString::from_str(paragraph);
        let attributed =
            unsafe { CFAttributedString::new(None, Some(&string), Some(attributes.as_opaque())) }
                .context("无法创建水印文字排版")?;
        let styled = CFMutableAttributedString::new_copy(None, 0, Some(&attributed))
            .context("无法设置水印文字颜色")?;
        for run in colors
            .iter()
            .skip_while(|run| run.end <= offset)
            .take_while(|run| run.start < offset + length)
        {
            let start = run.start.max(offset);
            let end = run.end.min(offset + length);
            let fill = color(&run.color, 1.0);
            // The validated range is intersected with this paragraph's UTF-16 units.
            unsafe {
                CFMutableAttributedString::set_attribute(
                    Some(&styled),
                    CFRange {
                        location: (start - offset) as isize,
                        length: (end - start) as isize,
                    },
                    Some(kCTForegroundColorAttributeName),
                    Some(fill.as_ref()),
                );
            }
        }
        Ok(styled)
    }

    struct Line {
        line: CFRetained<CTLine>,
        outline: Option<CFRetained<CTLine>>,
        width: f64,
        x: f64,
        baseline: f64,
    }

    struct Shadow {
        color: CFRetained<CGColor>,
        offset: CGSize,
        blur: f64,
    }

    struct Background {
        color: CFRetained<CGColor>,
        rect: CGRect,
    }

    pub(crate) struct TextLayout {
        lines: Vec<Line>,
        pub(crate) width: f64,
        pub(crate) height: f64,
        shadow: Option<Shadow>,
        background: Option<Background>,
        slant: f64,
        left: f64,
        bottom: f64,
    }

    impl TextLayout {
        pub(crate) fn new(settings: &TextWatermark) -> Result<Self> {
            settings.validate()?;
            let font = font(settings)?;
            let kern = CFNumber::new_cgfloat(settings.character_spacing * settings.scale);
            let fill = color(&settings.color, 1.0);
            let mut keys = vec![unsafe { kCTFontAttributeName }, unsafe {
                kCTForegroundColorAttributeName
            }];
            let mut values: Vec<&CFType> = vec![font.as_ref(), fill.as_ref()];
            if settings.character_spacing != 0.0 {
                keys.push(unsafe { kCTKernAttributeName });
                values.push(kern.as_ref());
            }
            let stroke = settings.stroke.as_ref().filter(|style| style.width > 0.0);
            let attributes = CFDictionary::from_slices(&keys, &values);
            let stroke_attributes = stroke.map(|style| {
                let fill = color(&style.color, 1.0);
                // Core Text centers its stroke, which must be twice the visible outer width.
                let width = CFNumber::new_cgfloat(200.0 * style.width / settings.font_size);
                CFDictionary::<CFString, CFType>::from_slices(
                    &[unsafe { kCTStrokeColorAttributeName }, unsafe {
                        kCTStrokeWidthAttributeName
                    }],
                    &[fill.as_ref(), width.as_ref()],
                )
            });
            let ascent = unsafe { font.ascent() };
            let descent = unsafe { font.descent() };
            let leading = unsafe { font.leading() }.max(0.0);
            let line_gap = leading + settings.line_spacing * settings.scale;
            let wrap_width = settings.wrap_width * settings.scale;
            let slant = settings.italic_angle.to_radians().tan();
            let mut lines = Vec::new();
            let mut height = 0.0;
            let mut width: f64 = wrap_width;
            for (paragraph, offset) in paragraphs(&settings.text) {
                if paragraph.is_empty() {
                    height += ascent + descent + line_gap;
                    continue;
                }
                let units: Vec<_> = paragraph.encode_utf16().collect();
                let attributed = styled_paragraph(
                    paragraph,
                    offset,
                    units.len(),
                    &attributes,
                    &settings.color_ranges,
                )?;
                let typesetter = unsafe { CTTypesetter::with_attributed_string(&attributed) };
                let length = units.len() as isize;
                let outline = stroke_attributes
                    .as_ref()
                    .map(|style| -> Result<_> {
                        let outline =
                            CFMutableAttributedString::new_copy(None, 0, Some(&attributed))
                                .context("无法创建水印文字描边")?;
                        unsafe {
                            CFMutableAttributedString::set_attributes(
                                Some(&outline),
                                CFRange {
                                    location: 0,
                                    length,
                                },
                                Some(style.as_opaque()),
                                false,
                            );
                            Ok(CTTypesetter::with_attributed_string(&outline))
                        }
                    })
                    .transpose()?;
                let mut start = 0;
                while start < length {
                    let mut count = length - start;
                    if wrap_width > 0.0 {
                        count = unsafe { typesetter.suggest_line_break(start, wrap_width) };
                        if count <= 0 {
                            count = unsafe { typesetter.suggest_cluster_break(start, wrap_width) };
                        }
                        if count <= 0 {
                            // A glyph wider than the box still occupies one line. Keep surrogate pairs intact.
                            count = if (0xD800..=0xDBFF).contains(&units[start as usize]) {
                                2
                            } else {
                                1
                            };
                        }
                    }
                    count = count.min(length - start);
                    let range = CFRange {
                        location: start,
                        length: count,
                    };
                    let line = unsafe { typesetter.line(range) };
                    let mut line_ascent = 0.0;
                    let mut line_descent = 0.0;
                    let advance = unsafe {
                        line.typographic_bounds(&mut line_ascent, &mut line_descent, null_mut())
                    }
                    .max(0.0);
                    line_ascent = line_ascent.max(ascent);
                    line_descent = line_descent.max(descent);
                    width = width.max(advance);
                    lines.push(Line {
                        line,
                        outline: outline
                            .as_ref()
                            .map(|typesetter| unsafe { typesetter.line(range) }),
                        width: advance,
                        x: 0.0,
                        baseline: -height - line_ascent,
                    });
                    height += line_ascent + line_descent + line_gap;
                    start += count;
                }
            }
            let mut left: f64 = 0.0;
            let mut right = width;
            let mut top: f64 = 0.0;
            let mut bottom = -height + line_gap;
            for line in &mut lines {
                line.x = (width - line.width)
                    * match settings.alignment {
                        Alignment::Left => 0.0,
                        Alignment::Center => 0.5,
                        Alignment::Right => 1.0,
                    };
                let bounds = unsafe { line.line.image_bounds(None) };
                if bounds.origin.x.is_finite()
                    && bounds.origin.y.is_finite()
                    && bounds.size.width.is_finite()
                    && bounds.size.height.is_finite()
                {
                    let lower = bounds.origin.y;
                    let upper = lower + bounds.size.height;
                    left = left.min(line.x + bounds.origin.x + (slant * lower).min(slant * upper));
                    right = right.max(
                        line.x
                            + bounds.origin.x
                            + bounds.size.width
                            + (slant * lower).max(slant * upper),
                    );
                    top = top.max(line.baseline + upper);
                    bottom = bottom.min(line.baseline + lower);
                }
            }
            let outline = stroke.map_or(0.0, |style| style.width * settings.scale);
            let horizontal_outline = outline * (1.0 + slant.abs());
            left -= horizontal_outline;
            right += horizontal_outline;
            bottom -= outline;
            top += outline;
            let background = settings
                .background
                .as_ref()
                .filter(|style| style.opacity > 0.0)
                .map(|style| {
                    let pad = style.padding * settings.scale;
                    Background {
                        color: color(&style.color, style.opacity),
                        rect: CGRect::new(
                            CGPoint::new(left - pad, bottom - pad),
                            CGSize::new(right - left + 2.0 * pad, top - bottom + 2.0 * pad),
                        ),
                    }
                });
            let shadow = settings
                .shadow
                .as_ref()
                .filter(|style| style.opacity > 0.0)
                .map(|style| Shadow {
                    color: color(&style.color, style.opacity),
                    offset: CGSize::new(
                        style.offset_x * settings.scale,
                        -style.offset_y * settings.scale,
                    ),
                    blur: style.blur * settings.scale,
                });
            if let Some(style) = &shadow {
                // Include the blur tail and use the same extent for placement at both resolutions.
                let blur_extent = style.blur * 3.0;
                left += (style.offset.width - blur_extent).min(0.0);
                right += (style.offset.width + blur_extent).max(0.0);
                bottom += (style.offset.height - blur_extent).min(0.0);
                top += (style.offset.height + blur_extent).max(0.0);
            }
            if let Some(style) = &background {
                left = left.min(style.rect.origin.x);
                right = right.max(style.rect.origin.x + style.rect.size.width);
                bottom = bottom.min(style.rect.origin.y);
                top = top.max(style.rect.origin.y + style.rect.size.height);
            }
            Ok(Self {
                lines,
                width: (right - left + 2.0).max(1.0),
                height: (top - bottom + 2.0).max(1.0),
                shadow,
                background,
                slant,
                left: left - 1.0,
                bottom: bottom - 1.0,
            })
        }

        pub(crate) fn rasterize(&self, target_width: f64, target_height: f64) -> Result<RgbaImage> {
            // Large wrapping blocks rasterize only at their actual visible size.
            // Cap temporary masks at 16 megapixels even for oversized originals.
            let limit = (8192.0 / target_width.max(target_height))
                .min((16_000_000.0 / (target_width * target_height)).sqrt())
                .min(1.0);
            let width = (target_width * limit).ceil().max(1.0) as u32;
            let height = (target_height * limit).ceil().max(1.0) as u32;
            let mut bitmap = RgbaImage::new(width, height);
            let color_space = CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB }))
                .context("无法建立 sRGB 文字色域")?;
            let info = CGBitmapInfo(
                CGImageAlphaInfo::PremultipliedLast.0 | CGImageByteOrderInfo::Order32Big.0,
            );
            // The bitmap owns the buffer and outlives this context. Drawing finishes before unpremultiplication.
            let context = unsafe {
                CGBitmapContextCreate(
                    bitmap.as_mut().as_mut_ptr().cast(),
                    width as usize,
                    height as usize,
                    8,
                    width as usize * 4,
                    Some(&color_space),
                    info.0,
                )
            }
            .context("无法建立水印文字画布")?;
            let context_ref = Some(&*context);
            let scale_x = width as f64 / self.width;
            let scale_y = height as f64 / self.height;
            CGContext::scale_ctm(context_ref, scale_x, scale_y);
            if let Some(background) = &self.background {
                let mut rect = background.rect;
                rect.origin.x -= self.left;
                rect.origin.y -= self.bottom;
                CGContext::set_fill_color_with_color(context_ref, Some(&background.color));
                CGContext::fill_rect(context_ref, rect);
            }
            if let Some(shadow) = &self.shadow {
                // Shadow parameters are in base space, so scale them to the raster resolution.
                CGContext::set_shadow_with_color(
                    context_ref,
                    CGSize::new(
                        shadow.offset.width * scale_x,
                        shadow.offset.height * scale_y,
                    ),
                    shadow.blur * scale_x.max(scale_y),
                    Some(&shadow.color),
                );
                // Group the glyphs so the shadow sits behind all text and above the color block.
                unsafe { CGContext::begin_transparency_layer(context_ref, None) };
            }
            CGContext::set_should_antialias(context_ref, true);
            CGContext::set_should_smooth_fonts(context_ref, false);
            CGContext::set_line_join(context_ref, CGLineJoin::Round);
            let text_matrix = CGAffineTransform {
                a: 1.0,
                b: 0.0,
                c: self.slant,
                d: 1.0,
                tx: 0.0,
                ty: 0.0,
            };
            let draw = |line: &Line, glyphs: &CTLine| {
                CGContext::set_text_matrix(context_ref, text_matrix);
                CGContext::set_text_position(
                    context_ref,
                    line.x - self.left,
                    line.baseline - self.bottom,
                );
                unsafe { glyphs.draw(&context) };
            };
            // Draw the original glyph fill on top of the centered outline so
            // thin strokes and local color remain visible even with a thick border.
            for line in &self.lines {
                if let Some(outline) = &line.outline {
                    draw(line, outline);
                }
            }
            for line in &self.lines {
                draw(line, &line.line);
            }
            if self.shadow.is_some() {
                CGContext::end_transparency_layer(context_ref);
            }
            drop(context);
            for pixel in bitmap.pixels_mut() {
                let alpha = pixel[3] as u32;
                if alpha > 0 {
                    for channel in &mut pixel.0[..3] {
                        *channel = ((*channel as u32 * 255 + alpha / 2) / alpha).min(255) as u8;
                    }
                }
            }
            Ok(bitmap)
        }
    }
}

#[cfg(target_os = "macos")]
pub(crate) use native::{font_families, TextLayout};

#[cfg(not(target_os = "macos"))]
pub(crate) fn font_families() -> Result<Vec<String>> {
    bail!("当前系统不支持本机字体水印")
}

#[cfg(not(target_os = "macos"))]
pub(crate) struct TextLayout {
    pub(crate) width: f64,
    pub(crate) height: f64,
}

#[cfg(not(target_os = "macos"))]
impl TextLayout {
    pub(crate) fn new(_: &TextWatermark) -> Result<Self> {
        bail!("当前系统不支持本机字体水印")
    }
    pub(crate) fn rasterize(&self, _: f64, _: f64) -> Result<image::RgbaImage> {
        bail!("当前系统不支持本机字体水印")
    }
}
