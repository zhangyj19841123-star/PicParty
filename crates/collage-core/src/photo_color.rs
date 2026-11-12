//! One deterministic color pipeline for browser proxies and original-image export.
//! Pixels enter and leave as unpremultiplied, linear-light sRGB. Tone powers and
//! transfer functions are prepared once, not evaluated for every exported pixel.
use crate::{fail, validate_photo_adjustments, CoreError, PhotoAdjustments};
use std::sync::OnceLock;

const TONE_STEPS: usize = 8192;
const LUMA: [f32; 3] = [0.2126, 0.7152, 0.0722];

pub struct PhotoColorTransform {
    neutral: bool,
    exposure: f32,
    gains: [f32; 3],
    saturation: f32,
    vibrance: f32,
    tone: Option<Vec<f32>>,
}

impl PhotoColorTransform {
    /// Persisted values are checked by validate_photo_adjustments. Direct callers
    /// also receive a finite transform if they accidentally bypass validation.
    pub fn new(adjustments: &PhotoAdjustments) -> Self {
        let exposure = finite_clamp(adjustments.exposure, -3.0, 3.0);
        let temperature = control(adjustments.temperature);
        let tint = control(adjustments.tint);
        let brightness = control(adjustments.brightness);
        let contrast = control(adjustments.contrast);
        let highlights = control(adjustments.highlights);
        let shadows = control(adjustments.shadows);
        let blacks = control(adjustments.blacks);
        let saturation = control(adjustments.saturation);
        let vibrance = control(adjustments.vibrance);
        let neutral = [
            exposure,
            temperature,
            tint,
            brightness,
            contrast,
            highlights,
            shadows,
            blacks,
            saturation,
            vibrance,
        ]
        .iter()
        .all(|value| *value == 0.0);

        // A warm shift favors red over blue; a positive tint favors magenta over
        // green. Normalize the gains so tinting a neutral patch keeps its luma.
        let mut gains = [
            2.0_f64.powf(temperature * 0.55 + tint * 0.2) as f32,
            2.0_f64.powf(-tint * 0.4) as f32,
            2.0_f64.powf(-temperature * 0.55 + tint * 0.2) as f32,
        ];
        let gain_luma = luminance(gains);
        for value in &mut gains {
            *value /= gain_luma;
        }

        let tone = if [brightness, contrast, highlights, shadows, blacks]
            .iter()
            .all(|value| *value == 0.0)
        {
            None
        } else {
            let gamma = 2.0_f64.powf(-brightness * 0.75);
            let contrast_gain = 2.0_f64.powf(contrast * 1.2);
            Some(
                (0..=TONE_STEPS)
                    .map(|index| {
                        let linear = index as f64 / TONE_STEPS as f64;
                        let mut p = linear_to_srgb(linear).powf(gamma);
                        p = ((p - 0.5) * contrast_gain + 0.5).clamp(0.0, 1.0);
                        // Broad shadows keep the true black point; blacks acts on the
                        // deepest quarter of the perceptual range and can lift black.
                        let shadow_mask =
                            smoothstep(0.0, 0.08, p) * (1.0 - smoothstep(0.2, 0.65, p));
                        let highlight_mask = smoothstep(0.35, 0.85, p);
                        let black_mask = 1.0 - smoothstep(0.0, 0.25, p);
                        let shadow_delta =
                            shadows * 0.3 * shadow_mask * if shadows >= 0.0 { 1.0 - p } else { p };
                        let highlight_delta = highlights
                            * 0.3
                            * highlight_mask
                            * if highlights >= 0.0 { 1.0 - p } else { p };
                        let black_delta =
                            blacks * 0.16 * black_mask * if blacks >= 0.0 { 1.0 - p } else { 1.0 };
                        srgb_to_linear(
                            (p + shadow_delta + highlight_delta + black_delta).clamp(0.0, 1.0),
                        ) as f32
                    })
                    .collect(),
            )
        };

        Self {
            neutral,
            exposure: 2.0_f64.powf(exposure) as f32,
            gains,
            saturation: (1.0 + saturation) as f32,
            vibrance: vibrance as f32,
            tone,
        }
    }

    pub fn is_neutral(&self) -> bool {
        self.neutral
    }

    pub fn apply(&self, pixel: [f32; 3]) -> [f32; 3] {
        if self.neutral {
            return pixel.map(unit);
        }
        let mut rgb = std::array::from_fn(|channel| {
            unit(pixel[channel]) * self.exposure * self.gains[channel]
        });
        let source_luma = luminance(rgb);
        let target_luma = self
            .tone
            .as_ref()
            .map(|table| sample_tone(table, source_luma))
            .unwrap_or(source_luma.clamp(0.0, 1.0));
        if source_luma > 1e-8 {
            let gain = target_luma / source_luma;
            for channel in &mut rgb {
                *channel *= gain;
            }
        } else {
            rgb = [target_luma; 3];
        }

        // Vibrance preferentially affects muted colors. Constant saturation
        // remains independent, and -100 saturation produces neutral gray.
        let max = rgb.into_iter().fold(f32::NEG_INFINITY, f32::max);
        let min = rgb.into_iter().fold(f32::INFINITY, f32::min);
        let chroma = if max > 1e-8 {
            ((max - min) / max).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let muted = 1.0 - chroma;
        let saturation = self.saturation * (1.0 + self.vibrance * muted * muted);
        rgb.map(|channel| unit(target_luma + (channel - target_luma) * saturation))
    }

    /// Canvas ImageData and decoded sRGB8 proxies are not premultiplied. Alpha
    /// and transparent RGB bytes remain untouched, including at partial alpha.
    pub fn apply_srgba8(&self, pixel: [u8; 4]) -> [u8; 4] {
        if self.neutral || pixel[3] == 0 {
            return pixel;
        }
        let decode = srgb_decode_table();
        let linear = self.apply([
            decode[pixel[0] as usize],
            decode[pixel[1] as usize],
            decode[pixel[2] as usize],
        ]);
        let encode = srgb_encode_table();
        [
            encode[(linear[0] * 65535.0).round() as usize],
            encode[(linear[1] * 65535.0).round() as usize],
            encode[(linear[2] * 65535.0).round() as usize],
            pixel[3],
        ]
    }
}

/// Shared byte boundary keeps preview alpha, validation and neutral behavior
/// testable without a browser or a native image-decoder dependency.
pub fn adjust_srgba8(pixels: &[u8], adjustments: &PhotoAdjustments) -> Result<Vec<u8>, CoreError> {
    validate_photo_adjustments(adjustments)?;
    if pixels.len() % 4 != 0 {
        return fail("Photo adjustment input must contain complete RGBA pixels");
    }
    let transform = PhotoColorTransform::new(adjustments);
    if transform.is_neutral() {
        return Ok(pixels.to_vec());
    }
    let mut output = Vec::with_capacity(pixels.len());
    for pixel in pixels.chunks_exact(4) {
        output.extend_from_slice(&transform.apply_srgba8([pixel[0], pixel[1], pixel[2], pixel[3]]));
    }
    Ok(output)
}

fn finite_clamp(value: f64, min: f64, max: f64) -> f64 {
    if value.is_finite() {
        value.clamp(min, max)
    } else {
        0.0
    }
}

fn control(value: f64) -> f64 {
    finite_clamp(value, -100.0, 100.0) / 100.0
}
fn unit(value: f32) -> f32 {
    if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        0.0
    }
}
fn luminance(rgb: [f32; 3]) -> f32 {
    rgb[0] * LUMA[0] + rgb[1] * LUMA[1] + rgb[2] * LUMA[2]
}
fn smoothstep(start: f64, end: f64, value: f64) -> f64 {
    let t = ((value - start) / (end - start)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
fn sample_tone(table: &[f32], value: f32) -> f32 {
    let coordinate = value.clamp(0.0, 1.0) * TONE_STEPS as f32;
    let index = coordinate as usize;
    if index == TONE_STEPS {
        return table[index];
    }
    let amount = coordinate - index as f32;
    table[index] + (table[index + 1] - table[index]) * amount
}
fn srgb_to_linear(value: f64) -> f64 {
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}
fn linear_to_srgb(value: f64) -> f64 {
    if value <= 0.0031308 {
        value * 12.92
    } else {
        1.055 * value.powf(1.0 / 2.4) - 0.055
    }
}
fn srgb_decode_table() -> &'static [f32; 256] {
    static TABLE: OnceLock<[f32; 256]> = OnceLock::new();
    TABLE.get_or_init(|| std::array::from_fn(|index| srgb_to_linear(index as f64 / 255.0) as f32))
}
fn srgb_encode_table() -> &'static Vec<u8> {
    static TABLE: OnceLock<Vec<u8>> = OnceLock::new();
    TABLE.get_or_init(|| {
        (0..=65535)
            .map(|index| (linear_to_srgb(index as f64 / 65535.0) * 255.0).round() as u8)
            .collect()
    })
}
