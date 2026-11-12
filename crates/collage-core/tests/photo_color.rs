use collage_core::{
    adjust_srgba8, cover, validate_photo_adjustments, ImageTransform, PhotoAdjustments,
    PhotoColorTransform, Rect,
};
use serde_json::json;

fn gray(value: f32) -> [f32; 3] {
    [value; 3]
}
fn close(actual: f32, expected: f32) {
    assert!((actual - expected).abs() < 1e-5, "{actual} != {expected}");
}
fn chroma(rgb: [f32; 3]) -> f32 {
    rgb.into_iter().fold(f32::NEG_INFINITY, f32::max)
        - rgb.into_iter().fold(f32::INFINITY, f32::min)
}

#[test]
fn old_transforms_and_partial_settings_load_as_neutral_defaults() {
    let transform: ImageTransform = serde_json::from_value(json!({
        "focusX":0.2,"focusY":0.7,"zoom":2,"rotation":-37,"flipX":false,"flipY":false
    }))
    .unwrap();
    assert_eq!(transform.adjustments, PhotoAdjustments::default());
    assert_eq!(transform.rotation, -37.0);
    let adjustments: PhotoAdjustments =
        serde_json::from_value(json!({"exposure":1.0,"blacks":12.0})).unwrap();
    assert_eq!(adjustments.exposure, 1.0);
    assert_eq!(adjustments.blacks, 12.0);
    assert_eq!(adjustments.brightness, 0.0);
    assert!(serde_json::from_value::<PhotoAdjustments>(json!({"unknown":1})).is_err());
}

#[test]
fn adjustment_values_round_trip_without_mutating_the_source() {
    let adjustments = PhotoAdjustments {
        exposure: 0.7,
        temperature: -21.0,
        tint: 12.0,
        contrast: 34.0,
        highlights: -48.0,
        brightness: 17.0,
        shadows: 65.0,
        vibrance: 22.0,
        saturation: -13.0,
        blacks: -9.0,
    };
    let mut transform = ImageTransform::default();
    transform.adjustments = adjustments.clone();
    let before = transform.clone();
    let encoded = serde_json::to_string(&transform).unwrap();
    let reopened: ImageTransform = serde_json::from_str(&encoded).unwrap();
    assert_eq!(reopened.adjustments, adjustments);
    let color = PhotoColorTransform::new(&transform.adjustments);
    assert!(!color.is_neutral());
    let _ = color.apply([0.3, 0.2, 0.1]);
    assert_eq!(transform, before);
}

#[test]
fn neutral_preserves_every_srgb8_channel_and_alpha_exactly() {
    let pixels: Vec<u8> = (0..=255)
        .flat_map(|value| [value, 255 - value, value / 2, value])
        .collect();
    let transform = PhotoColorTransform::new(&PhotoAdjustments::default());
    assert!(transform.is_neutral());
    assert_eq!(
        adjust_srgba8(&pixels, &PhotoAdjustments::default()).unwrap(),
        pixels
    );
    assert_eq!(
        transform.apply([0.015, 0.2126, 0.87]),
        [0.015, 0.2126, 0.87]
    );
}

#[test]
fn exposure_changes_linear_light_by_stops() {
    let brighter = PhotoColorTransform::new(&PhotoAdjustments {
        exposure: 1.0,
        ..Default::default()
    });
    let darker = PhotoColorTransform::new(&PhotoAdjustments {
        exposure: -1.0,
        ..Default::default()
    });
    for (actual, expected) in brighter
        .apply([0.05, 0.1, 0.2])
        .into_iter()
        .zip([0.1, 0.2, 0.4])
    {
        close(actual, expected);
    }
    close(darker.apply(gray(0.2))[0], 0.1);
    close(brighter.apply(gray(0.8))[0], 1.0);
}

#[test]
fn brightness_lifts_midtones_and_is_distinct_from_exposure() {
    let brightness = PhotoColorTransform::new(&PhotoAdjustments {
        brightness: 55.0,
        ..Default::default()
    });
    let exposure = PhotoColorTransform::new(&PhotoAdjustments {
        exposure: 1.0,
        ..Default::default()
    });
    close(brightness.apply(gray(0.0))[0], 0.0);
    close(brightness.apply(gray(1.0))[0], 1.0);
    assert!(brightness.apply(gray(0.2))[0] > 0.2);
    assert!((brightness.apply(gray(0.65))[0] - exposure.apply(gray(0.65))[0]).abs() > 0.05);
    let darker = PhotoColorTransform::new(&PhotoAdjustments {
        brightness: -55.0,
        ..Default::default()
    });
    assert!(darker.apply(gray(0.2))[0] < 0.2);
}

#[test]
fn contrast_pushes_dark_and_light_patches_away_from_midgray() {
    let more = PhotoColorTransform::new(&PhotoAdjustments {
        contrast: 45.0,
        ..Default::default()
    });
    let less = PhotoColorTransform::new(&PhotoAdjustments {
        contrast: -45.0,
        ..Default::default()
    });
    assert!(more.apply(gray(0.04))[0] < 0.04);
    assert!(more.apply(gray(0.65))[0] > 0.65);
    assert!(less.apply(gray(0.04))[0] > 0.04);
    assert!(less.apply(gray(0.65))[0] < 0.65);
}

#[test]
fn highlights_and_shadows_affect_their_respective_luminance_ranges() {
    let highlights = PhotoColorTransform::new(&PhotoAdjustments {
        highlights: -60.0,
        ..Default::default()
    });
    let shadows = PhotoColorTransform::new(&PhotoAdjustments {
        shadows: 60.0,
        ..Default::default()
    });
    assert!(highlights.apply(gray(0.7))[0] < 0.6);
    close(highlights.apply(gray(0.02))[0], 0.02);
    assert!(shadows.apply(gray(0.04))[0] > 0.07);
    close(shadows.apply(gray(0.7))[0], 0.7);
    close(shadows.apply(gray(0.0))[0], 0.0);
}

#[test]
fn black_control_targets_deep_blacks_independently_of_shadows_and_brightness() {
    let blacks = PhotoColorTransform::new(&PhotoAdjustments {
        blacks: 70.0,
        ..Default::default()
    });
    let shadows = PhotoColorTransform::new(&PhotoAdjustments {
        shadows: 70.0,
        ..Default::default()
    });
    let brightness = PhotoColorTransform::new(&PhotoAdjustments {
        brightness: 70.0,
        ..Default::default()
    });
    assert!(blacks.apply(gray(0.0))[0] > 0.01);
    close(shadows.apply(gray(0.0))[0], 0.0);
    close(brightness.apply(gray(0.0))[0], 0.0);
    close(blacks.apply(gray(0.2))[0], 0.2);
    let crushed = PhotoColorTransform::new(&PhotoAdjustments {
        blacks: -70.0,
        ..Default::default()
    });
    assert!(crushed.apply(gray(0.005))[0] < 0.005);
}

#[test]
fn temperature_and_tint_adjust_opposing_color_channels() {
    let warm = PhotoColorTransform::new(&PhotoAdjustments {
        temperature: 60.0,
        ..Default::default()
    })
    .apply(gray(0.2));
    let cool = PhotoColorTransform::new(&PhotoAdjustments {
        temperature: -60.0,
        ..Default::default()
    })
    .apply(gray(0.2));
    assert!(warm[0] > warm[2]);
    assert!(cool[2] > cool[0]);
    let magenta = PhotoColorTransform::new(&PhotoAdjustments {
        tint: 60.0,
        ..Default::default()
    })
    .apply(gray(0.2));
    let green = PhotoColorTransform::new(&PhotoAdjustments {
        tint: -60.0,
        ..Default::default()
    })
    .apply(gray(0.2));
    assert!(magenta[0] > magenta[1] && magenta[2] > magenta[1]);
    assert!(green[1] > green[0] && green[1] > green[2]);
}

#[test]
fn saturation_can_make_grayscale_and_increase_constant_color_intensity() {
    let gray_result = PhotoColorTransform::new(&PhotoAdjustments {
        saturation: -100.0,
        ..Default::default()
    })
    .apply([0.3, 0.2, 0.1]);
    close(gray_result[0], gray_result[1]);
    close(gray_result[1], gray_result[2]);
    let more = PhotoColorTransform::new(&PhotoAdjustments {
        saturation: 60.0,
        ..Default::default()
    });
    assert!(chroma(more.apply([0.3, 0.2, 0.1])) > 0.2);
}

#[test]
fn vibrance_boosts_muted_colors_without_overdriving_already_saturated_colors() {
    let vibrance = PhotoColorTransform::new(&PhotoAdjustments {
        vibrance: 80.0,
        ..Default::default()
    });
    let saturation = PhotoColorTransform::new(&PhotoAdjustments {
        saturation: 80.0,
        ..Default::default()
    });
    let muted = [0.3, 0.25, 0.23];
    assert!(chroma(vibrance.apply(muted)) > chroma(muted));
    let saturated = [0.5, 0.01, 0.02];
    assert!(chroma(saturation.apply(saturated)) > chroma(vibrance.apply(saturated)) + 0.05);
    close(chroma(vibrance.apply(gray(0.2))), 0.0);
}

#[test]
fn rgba_path_preserves_transparency_and_all_alpha_values() {
    let pixels: Vec<u8> = (0..=255).flat_map(|alpha| [60, 110, 170, alpha]).collect();
    let settings = PhotoAdjustments {
        exposure: 1.0,
        temperature: 20.0,
        ..Default::default()
    };
    let output = adjust_srgba8(&pixels, &settings).unwrap();
    assert_eq!(&output[..4], &pixels[..4]);
    for (index, pixel) in output.chunks_exact(4).enumerate() {
        assert_eq!(pixel[3], index as u8);
        if index > 0 {
            assert!(pixel[0] > 60 && pixel[1] > 110);
        }
    }
    assert!(adjust_srgba8(&[1, 2, 3], &settings).is_err());
}

#[test]
fn each_adjustment_rejects_out_of_range_and_nonfinite_values() {
    for exposure in [-3.001, 3.001, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(validate_photo_adjustments(&PhotoAdjustments {
            exposure,
            ..Default::default()
        })
        .is_err());
    }
    for field in [
        "temperature",
        "tint",
        "contrast",
        "highlights",
        "brightness",
        "shadows",
        "vibrance",
        "saturation",
        "blacks",
    ] {
        for value in [-100.001, 100.001] {
            let mut json = serde_json::to_value(PhotoAdjustments::default()).unwrap();
            json[field] = json!(value);
            let settings: PhotoAdjustments = serde_json::from_value(json).unwrap();
            assert!(
                validate_photo_adjustments(&settings).is_err(),
                "{field}: {value}"
            );
        }
    }
    for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let invalid = [
            PhotoAdjustments {
                temperature: value,
                ..Default::default()
            },
            PhotoAdjustments {
                tint: value,
                ..Default::default()
            },
            PhotoAdjustments {
                contrast: value,
                ..Default::default()
            },
            PhotoAdjustments {
                highlights: value,
                ..Default::default()
            },
            PhotoAdjustments {
                brightness: value,
                ..Default::default()
            },
            PhotoAdjustments {
                shadows: value,
                ..Default::default()
            },
            PhotoAdjustments {
                vibrance: value,
                ..Default::default()
            },
            PhotoAdjustments {
                saturation: value,
                ..Default::default()
            },
            PhotoAdjustments {
                blacks: value,
                ..Default::default()
            },
        ];
        for settings in invalid {
            assert!(validate_photo_adjustments(&settings).is_err());
            assert!(adjust_srgba8(&[20, 30, 40, 255], &settings).is_err());
        }
    }
}

#[test]
fn geometry_validation_also_rejects_invalid_color_settings() {
    let mut transform = ImageTransform::default();
    transform.adjustments.blacks = 101.0;
    assert!(cover(
        &Rect {
            x: 0.0,
            y: 0.0,
            width: 400.0,
            height: 600.0
        },
        400.0,
        600.0,
        &transform
    )
    .is_err());
}

#[test]
fn combined_extreme_settings_keep_every_sample_finite_and_bounded() {
    for sign in [-1.0, 1.0] {
        let settings = PhotoAdjustments {
            exposure: sign * 3.0,
            temperature: sign * 100.0,
            tint: sign * 100.0,
            contrast: sign * 100.0,
            highlights: sign * 100.0,
            brightness: sign * 100.0,
            shadows: sign * 100.0,
            vibrance: sign * 100.0,
            saturation: sign * 100.0,
            blacks: sign * 100.0,
        };
        validate_photo_adjustments(&settings).unwrap();
        let transform = PhotoColorTransform::new(&settings);
        for r in 0..=10 {
            for g in 0..=10 {
                for b in 0..=10 {
                    for value in
                        transform.apply([r as f32 / 10.0, g as f32 / 10.0, b as f32 / 10.0])
                    {
                        assert!(value.is_finite() && (0.0..=1.0).contains(&value));
                    }
                }
            }
        }
    }
}
