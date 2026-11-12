//! Exercise real source files through the same decoder, geometry, encoder and
//! atomic output path used by IPC jobs. No WebView or proxy participates.
use crate::{assets, render, service, storage};
use collage_core::{Axis, BackgroundImage, CanvasSizing, DocumentSize, ExportOptions, Frame, ImageTransform, LayoutNode, Margin, Page, PhotoAdjustments, PhotoColorTransform, Project, Rect, ResolvedFrame, TemplateDefinition};
use image::{ImageDecoder, ImageReader, Rgb, RgbImage, Rgba, RgbaImage};
use std::{collections::BTreeMap, fs, path::Path, sync::atomic::AtomicBool};

pub(crate) fn project_with_photo(path: &Path, width: u32, height: u32) -> Project {
    let asset = assets::inspect(path, Some("source".into())).unwrap();
    let template = TemplateDefinition {
        id: "full".into(), version: 1, name: "Full page".into(), category: "single".into(),
        root: LayoutNode::Leaf { slot_id: "photo".into() }, defaults: BTreeMap::new(), slot_order: vec!["photo".into()],
    };
    let page = Page {
        id: "page".into(), name: "Page 1".into(), template_id: template.id.clone(), template_state: BTreeMap::new(),
        frame_rects: None,
        background_image: None,
        background: "#ffffff".into(), margin: Margin { top: 0.0, right: 0.0, bottom: 0.0, left: 0.0 }, column_gap: 0.0, row_gap: 0.0,
        frames: vec![Frame { id: "frame".into(), slot_id: "photo".into(), image_asset_id: Some(asset.id.clone()), transform: ImageTransform::default() }],
        unplaced: vec![],
    };
    Project {
        schema_version: 1, engine_version: 1, id: "project".into(), name: "Native export test".into(),
        canvas_sizing: CanvasSizing::Fixed,
        document: DocumentSize { width: width as f64, height: height as f64, color_space: "srgb".into() }, pages: vec![page],
        assets: BTreeMap::from([(asset.id.clone(), asset)]), templates: BTreeMap::from([(template.id.clone(), template)]),
    }
}

pub(crate) fn options(directory: &Path, format: &str) -> ExportOptions {
    ExportOptions { page_ids: vec!["page".into()], format: format.into(), quality: 100, directory: directory.to_string_lossy().into(), prefix: "Test".into() }
}

fn add_background(project: &mut Project, path: &Path, opacity: f64) {
    let asset = assets::inspect(path, Some("background-source".into())).unwrap();
    project.pages[0].background_image = Some(BackgroundImage {
        image_asset_id: asset.id.clone(), opacity, transform: ImageTransform::default(),
    });
    project.assets.insert(asset.id.clone(), asset);
}

fn reference_blend(source: [u8; 4], opacity: f64, under: [u8; 3]) -> [u8; 3] {
    let linear = |channel: u8| {
        let value = channel as f64 / 255.0;
        if value <= 0.04045 { value / 12.92 } else { ((value + 0.055) / 1.055).powf(2.4) }
    };
    let alpha = source[3] as f64 / 255.0 * opacity;
    std::array::from_fn(|channel| {
        let value = linear(source[channel]) * alpha + linear(under[channel]) * (1.0 - alpha);
        let srgb = if value <= 0.0031308 { value * 12.92 } else { 1.055 * value.powf(1.0 / 2.4) - 0.055 };
        (srgb * 255.0).round().clamp(0.0, 255.0) as u8
    })
}

#[test]
fn background_photo_covers_the_whole_page_behind_margin_and_foreground_frames() {
    let dir = tempfile::tempdir().unwrap();
    let foreground = dir.path().join("foreground.png");
    let background = dir.path().join("background.png");
    RgbImage::from_pixel(120, 180, Rgb([20, 180, 50])).save(&foreground).unwrap();
    // A horizontal source still covers a vertical whole page, including its margins.
    RgbImage::from_pixel(180, 120, Rgb([220, 30, 20])).save(&background).unwrap();
    let mut project = project_with_photo(&foreground, 120, 180);
    project.pages[0].margin = Margin { top: 20.0, right: 20.0, bottom: 20.0, left: 20.0 };
    add_background(&mut project, &background, 0.5);
    collage_core::validate_project(&project).unwrap();
    let output = service::write_page(&project, &project.pages[0], &options(dir.path(), "png"), "background-and-foreground", &AtomicBool::new(false)).unwrap();
    let rendered = image::open(output).unwrap().into_rgb8();
    let expected = reference_blend([220, 30, 20, 255], 0.5, [255, 255, 255]);
    for (x, y) in [(0, 0), (119, 0), (0, 179), (119, 179), (10, 90)] {
        assert!(rendered.get_pixel(x, y).0.iter().zip(expected).all(|(a, b)| a.abs_diff(b) <= 1));
    }
    assert_eq!(rendered.get_pixel(60, 90).0, [20, 180, 50]);
    project.pages[0].frames[0].image_asset_id = None;
    let empty_frame = render::render_page(&project, &project.pages[0], &AtomicBool::new(false)).unwrap();
    assert!(empty_frame.pixels().all(|pixel| pixel.0.iter().zip(expected).all(|(a, b)| a.abs_diff(b) <= 1)),
        "empty photo frames must reveal the background without editor placeholders");
}

#[test]
fn overlapping_frame_layers_follow_saved_page_order_in_real_png_and_jpeg_exports() {
    let dir = tempfile::tempdir().unwrap();
    let bottom_source = dir.path().join("bottom.png");
    let top_source = dir.path().join("top.png");
    RgbImage::from_pixel(120, 180, Rgb([220, 30, 20])).save(&bottom_source).unwrap();
    RgbImage::from_pixel(120, 180, Rgb([20, 40, 220])).save(&top_source).unwrap();
    let mut project = project_with_photo(&bottom_source, 120, 180);
    let top_asset = assets::inspect(&top_source, Some("top-photo".into())).unwrap();
    project.assets.insert(top_asset.id.clone(), top_asset.clone());
    let template = project.templates.get_mut("full").unwrap();
    template.root = LayoutNode::Free { frames: vec![
        ResolvedFrame { slot_id: "photo".into(), rect: Rect { x: 0.0, y: 0.0, width: 1.0, height: 1.0 } },
        ResolvedFrame { slot_id: "inset".into(), rect: Rect { x: 0.2, y: 0.2, width: 0.6, height: 0.6 } },
    ] };
    template.slot_order.push("inset".into());
    project.pages[0].frames.push(Frame { id: "inset-frame".into(), slot_id: "inset".into(),
        image_asset_id: Some(top_asset.id.clone()), transform: ImageTransform::default() });
    let original_template = project.templates["full"].clone();
    for (name, expected_center) in [("blue-top", [20u8, 40, 220]), ("red-top", [220u8, 30, 20])] {
        if name == "red-top" { project.pages[0].frames.reverse(); }
        collage_core::validate_project(&project).unwrap();
        let saved_path = dir.path().join(format!("{name}.collage"));
        storage::save(&project, &saved_path).unwrap();
        let loaded = storage::load(&saved_path).unwrap();
        assert_eq!(loaded.pages[0].frames, project.pages[0].frames);
        assert_eq!(loaded.templates["full"], original_template, "changing layers must not change shared template geometry");
        for format in ["png", "jpg"] {
            let output = service::write_page(&loaded, &loaded.pages[0], &options(dir.path(), format), name, &AtomicBool::new(false)).unwrap();
            let pixels = image::open(output).unwrap().into_rgb8();
            for (x, y, expected) in [(60, 90, expected_center), (5, 5, [220, 30, 20]), (115, 175, [220, 30, 20])] {
                assert!(pixels.get_pixel(x, y).0.iter().zip(expected).all(|(actual, expected)| actual.abs_diff(expected) <= 3),
                    "{format} {name} layer mismatch at ({x}, {y}): {:?}", pixels.get_pixel(x, y).0);
            }
        }
    }
    // An empty top frame remains a layout target; it cannot erase the photo below.
    project.pages[0].frames.reverse();
    project.pages[0].frames[1].image_asset_id = None;
    let empty_top = render::render_page(&project, &project.pages[0], &AtomicBool::new(false)).unwrap();
    assert!(empty_top.pixels().all(|pixel| pixel.0 == [220, 30, 20]));
}

#[test]
fn background_source_alpha_and_layer_opacity_multiply_in_linear_light_and_show_through_foreground() {
    let dir = tempfile::tempdir().unwrap();
    let foreground = dir.path().join("transparent-foreground.png");
    let background = dir.path().join("transparent-background.png");
    // Red stored beneath zero alpha must never leak into the result.
    RgbaImage::from_fn(120, 180, |x, _| if x < 60 { Rgba([255, 0, 0, 0]) } else { Rgba([20, 200, 80, 128]) })
        .save(&foreground).unwrap();
    RgbaImage::from_pixel(120, 180, Rgba([20, 40, 220, 128])).save(&background).unwrap();
    let mut project = project_with_photo(&foreground, 120, 180);
    project.pages[0].background = "#c8b496".into();
    project.pages[0].margin = Margin { top: 10.0, right: 10.0, bottom: 10.0, left: 10.0 };
    add_background(&mut project, &background, 0.5);
    let solid = [200, 180, 150];
    let under = reference_blend([20, 40, 220, 128], 0.5, solid);
    let expected_foreground = reference_blend([20, 200, 80, 128], 1.0, under);
    let rendered = render::render_page(&project, &project.pages[0], &AtomicBool::new(false)).unwrap();
    for (x, y, expected) in [(0, 90, under), (35, 90, under), (85, 90, expected_foreground)] {
        assert!(rendered.get_pixel(x, y).0.iter().zip(expected).all(|(a, b)| a.abs_diff(b) <= 1),
            "incorrect linear layer composition at ({x}, {y}): {:?} vs {expected:?}", rendered.get_pixel(x, y).0);
    }
    project.pages[0].frames[0].image_asset_id = None;
    for opacity in [0.0, 1.0] {
        project.pages[0].background_image.as_mut().unwrap().opacity = opacity;
        let expected = reference_blend([20, 40, 220, 128], opacity, solid);
        let rendered = render::render_page(&project, &project.pages[0], &AtomicBool::new(false)).unwrap();
        assert!(rendered.pixels().all(|pixel| pixel.0.iter().zip(expected).all(|(a, b)| a.abs_diff(b) <= 1)));
    }
}

#[test]
fn background_uses_the_same_focus_zoom_rotation_and_adjustments_as_a_full_page_photo() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("pattern.png");
    RgbImage::from_fn(120, 180, |x, y| Rgb([(x * 2) as u8, (y + 30) as u8, ((x + y) % 240) as u8]))
        .save(&source).unwrap();
    let fingerprint = assets::fingerprint(&source).unwrap();
    for rotation in [0.0, 37.0, -90.0] {
        let mut foreground = project_with_photo(&source, 60, 90);
        let transform = ImageTransform {
            focus_x: 0.23, focus_y: 0.71, zoom: 1.8, rotation,
            adjustments: PhotoAdjustments { exposure: 0.4, temperature: -18.0, contrast: 13.0, ..Default::default() },
            ..Default::default()
        };
        foreground.pages[0].frames[0].transform = transform.clone();
        let reference = render::render_page(&foreground, &foreground.pages[0], &AtomicBool::new(false)).unwrap();
        let mut background = foreground.clone();
        background.pages[0].frames[0].image_asset_id = None;
        background.pages[0].frames[0].transform = ImageTransform::default();
        background.pages[0].background_image = Some(BackgroundImage { image_asset_id: "source".into(), opacity: 1.0, transform });
        collage_core::validate_project(&background).unwrap();
        let actual = render::render_page(&background, &background.pages[0], &AtomicBool::new(false)).unwrap();
        assert_eq!(actual, reference, "background geometry mismatch at {rotation} degrees");
        let project_path = dir.path().join(format!("background-{rotation}.collage"));
        storage::save(&background, &project_path).unwrap();
        assert_eq!(storage::load(&project_path).unwrap(), background);
    }
    assert_eq!(assets::fingerprint(&source).unwrap(), fingerprint);
}

#[test]
fn background_original_changes_and_cancellation_cannot_create_a_partial_export() {
    let dir = tempfile::tempdir().unwrap();
    let foreground = dir.path().join("foreground.png");
    let background = dir.path().join("background.png");
    RgbImage::from_pixel(120, 180, Rgb([20, 180, 50])).save(&foreground).unwrap();
    RgbImage::from_pixel(120, 180, Rgb([220, 30, 20])).save(&background).unwrap();
    let mut project = project_with_photo(&foreground, 120, 180);
    add_background(&mut project, &background, 0.0);
    let output_options = options(dir.path(), "png");
    assert!(service::write_page(&project, &project.pages[0], &output_options, "cancelled-background", &AtomicBool::new(true)).is_err());
    RgbImage::from_pixel(120, 180, Rgb([20, 30, 220])).save(&background).unwrap();
    let error = service::write_page(&project, &project.pages[0], &output_options, "changed-background", &AtomicBool::new(false)).unwrap_err();
    assert!(error.to_string().contains("重新链接"));
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2, "failed background exports must leave no output or temporary file");
}

#[test]
fn original_file_exports_full_4000_by_6000_in_jpeg_and_png_with_srgb_profile() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source.png");
    let pixels = RgbImage::from_fn(400, 600, |x, y| Rgb(if x < 200 { if y < 300 { [220, 30, 20] } else { [20, 180, 50] } } else if y < 300 { [20, 40, 220] } else { [220, 180, 20] }));
    pixels.save(&source).unwrap();
    let project = project_with_photo(&source, 4000, 6000);
    collage_core::validate_project(&project).unwrap();
    let original_hash = assets::fingerprint(&source).unwrap();
    for format in ["jpg", "png"] {
        let output = service::write_page(&project, &project.pages[0], &options(dir.path(), format), "large", &AtomicBool::new(false)).unwrap();
        let mut decoder = ImageReader::open(&output).unwrap().with_guessed_format().unwrap().into_decoder().unwrap();
        assert_eq!(decoder.dimensions(), (4000, 6000));
        assert!(decoder.icc_profile().unwrap().is_some(), "output must identify sRGB");
        assert_eq!(decoder.orientation().unwrap().to_exif(), 1);
        let exported = image::DynamicImage::from_decoder(decoder).unwrap().into_rgb8();
        for (x, y, expected) in [(100, 100, [220u8, 30, 20]), (3900, 100, [20, 40, 220]), (100, 5900, [20, 180, 50]), (3900, 5900, [220, 180, 20])] {
            assert!(exported.get_pixel(x, y).0.iter().zip(expected).all(|(actual, expected)| actual.abs_diff(expected) <= 3));
        }
    }
    assert_eq!(assets::fingerprint(&source).unwrap(), original_hash);
}

#[test]
fn jpeg_exif_orientation_is_read_from_files_and_applied_once() {
    let dir = tempfile::tempdir().unwrap();
    let input = RgbImage::from_fn(60, 40, |x, y| {
        let tile = (y / 20) * 3 + x / 20;
        Rgb([30 + tile as u8 * 35, 0, 0])
    });
    let expected: [[u8; 6]; 8] = [
        [0,1,2,3,4,5], [2,1,0,5,4,3], [5,4,3,2,1,0], [3,4,5,0,1,2],
        [0,3,1,4,2,5], [3,0,4,1,5,2], [5,2,4,1,3,0], [2,5,1,4,0,3],
    ];
    for orientation in 1..=8u8 {
        // Little-endian TIFF header, one SHORT Orientation tag, and no next IFD.
        let mut exif = vec![b'I', b'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0];
        let source = dir.path().join(format!("exif-{orientation}.jpg"));
        let mut encoded = vec![];
        let mut encoder = jpeg_encoder::Encoder::new(&mut encoded, 100);
        encoder.set_sampling_factor(jpeg_encoder::SamplingFactor::F_1_1);
        encoder.add_exif_metadata(&exif).unwrap();
        encoder.encode(input.as_raw(), 60, 40, jpeg_encoder::ColorType::Rgb).unwrap();
        exif.clear();
        fs::write(&source, encoded).unwrap();
        let asset = assets::inspect(&source, None).unwrap();
        assert_eq!(asset.orientation, orientation);
        let dimensions = if orientation >= 5 { (40, 60) } else { (60, 40) };
        assert_eq!((asset.width, asset.height), dimensions);
        let decoded = assets::decode_srgb(&asset, 0, dimensions.0).unwrap();
        assert_eq!(decoded.dimensions(), dimensions);
        let columns = dimensions.0 / 20;
        for (index, tile) in expected[(orientation - 1) as usize].iter().enumerate() {
            let value = decoded.get_pixel((index as u32 % columns) * 20 + 10, (index as u32 / columns) * 20 + 10)[0];
            assert!(value.abs_diff(30 + tile * 35) <= 2, "EXIF {orientation}, tile {index}: {value}");
        }
        let project = project_with_photo(&source, dimensions.0, dimensions.1);
        let rendered = render::render_page(&project, &project.pages[0], &AtomicBool::new(false)).unwrap();
        assert_eq!(rendered.dimensions(), dimensions);
        assert_eq!(rendered.get_pixel(10, 10)[0], decoded.get_pixel(10, 10)[0]);
    }
}

#[test]
fn cancelled_job_creates_no_output_and_collision_never_overwrites() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source.png");
    RgbImage::from_pixel(120, 180, Rgb([30, 90, 180])).save(&source).unwrap();
    let project = project_with_photo(&source, 120, 180);
    let collision = dir.path().join("output.png");
    fs::write(&collision, b"existing original").unwrap();
    assert!(service::write_page(&project, &project.pages[0], &options(dir.path(), "png"), "output", &AtomicBool::new(true)).is_err());
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
    let output = service::write_page(&project, &project.pages[0], &options(dir.path(), "png"), "output", &AtomicBool::new(false)).unwrap();
    assert_eq!(output.file_name().unwrap(), "output-1.png");
    assert_eq!(fs::read(collision).unwrap(), b"existing original");
}

#[test]
fn saved_project_round_trips_and_changed_original_requires_relink() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source.png");
    RgbImage::from_pixel(120, 180, Rgb([30, 90, 180])).save(&source).unwrap();
    let project = project_with_photo(&source, 120, 180);
    let project_path = dir.path().join("work.collage");
    storage::save(&project, &project_path).unwrap();
    assert_eq!(storage::load(&project_path).unwrap(), project);
    RgbImage::from_pixel(120, 180, Rgb([90, 30, 180])).save(&source).unwrap();
    let error = render::render_page(&project, &project.pages[0], &AtomicBool::new(false)).unwrap_err();
    assert!(error.to_string().contains("重新链接"));
    assert!(!dir.path().join("work.png").exists());
}

#[test]
fn clockwise_quarter_turn_rotates_real_pixels_and_keeps_original_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("quadrants.png");
    RgbImage::from_fn(120, 180, |x, y| Rgb(if x < 60 { if y < 90 { [220, 30, 20] } else { [20, 180, 50] } } else if y < 90 { [20, 40, 220] } else { [220, 180, 20] })).save(&source).unwrap();
    let original_hash = assets::fingerprint(&source).unwrap();
    let mut project = project_with_photo(&source, 180, 120);
    project.pages[0].frames[0].transform.rotation = 90.0;
    collage_core::validate_project(&project).unwrap();
    let rendered = render::render_page(&project, &project.pages[0], &AtomicBool::new(false)).unwrap();
    for (x, y, expected) in [(20, 20, [20, 180, 50]), (160, 20, [220, 30, 20]), (20, 100, [220, 180, 20]), (160, 100, [20, 40, 220])] {
        assert_eq!(rendered.get_pixel(x, y).0, expected);
    }
    let project_path = dir.path().join("rotated.collage");
    storage::save(&project, &project_path).unwrap();
    assert_eq!(storage::load(&project_path).unwrap(), project);
    assert_eq!(assets::fingerprint(&source).unwrap(), original_hash);
}

#[test]
fn arbitrary_rotation_preserves_transparent_colors_and_clips_to_the_frame() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("transparent.png");
    RgbaImage::from_fn(256, 384, |x, _| if x < 128 { Rgba([255, 0, 0, 0]) } else { Rgba([0, 0, 255, 255]) }).save(&source).unwrap();
    let mut project = project_with_photo(&source, 256, 384);
    project.pages[0].frames[0].transform.rotation = 37.0;
    project.pages[0].margin = Margin { top: 12.0, right: 12.0, bottom: 12.0, left: 12.0 };
    let rendered = render::render_page(&project, &project.pages[0], &AtomicBool::new(false)).unwrap();
    assert_eq!(rendered.get_pixel(100, 100).0, [255, 255, 255]);
    assert_eq!(rendered.get_pixel(220, 300).0, [0, 0, 255]);
    for (x, y, pixel) in rendered.enumerate_pixels() {
        assert_eq!(pixel[0], pixel[1], "transparent red must never contaminate rotated edges");
        assert_eq!(pixel[2], 255);
        if x < 12 || x >= 244 || y < 12 || y >= 372 { assert_eq!(pixel.0, [255, 255, 255]); }
    }
}

#[test]
fn arbitrary_rotated_original_exports_4000_by_6000_without_blank_edges() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source.png");
    RgbImage::from_pixel(400, 600, Rgb([30, 90, 180])).save(&source).unwrap();
    let mut project = project_with_photo(&source, 4000, 6000);
    project.pages[0].frames[0].transform.rotation = -37.0;
    let output = service::write_page(&project, &project.pages[0], &options(dir.path(), "png"), "rotated-large", &AtomicBool::new(false)).unwrap();
    let mut decoder = ImageReader::open(&output).unwrap().with_guessed_format().unwrap().into_decoder().unwrap();
    assert_eq!(decoder.dimensions(), (4000, 6000));
    assert!(decoder.icc_profile().unwrap().is_some());
    assert_eq!(decoder.orientation().unwrap().to_exif(), 1);
    let rendered = image::DynamicImage::from_decoder(decoder).unwrap().into_rgb8();
    for (x, y) in [(0, 0), (3999, 0), (0, 5999), (3999, 5999), (2000, 3000)] {
        assert_eq!(rendered.get_pixel(x, y).0, [30, 90, 180]);
    }
}

#[test]
fn adjusted_rotated_export_matches_shared_color_and_preserves_the_original() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("adjustments.png");
    let original_rgb = [100, 120, 140];
    RgbImage::from_pixel(120, 180, Rgb(original_rgb)).save(&source).unwrap();
    let original_hash = assets::fingerprint(&source).unwrap();
    let mut project = project_with_photo(&source, 120, 180);
    let neutral = render::render_page(&project, &project.pages[0], &AtomicBool::new(false)).unwrap();
    assert!(neutral.pixels().all(|pixel| pixel.0 == original_rgb));
    let adjustments = PhotoAdjustments {
        exposure: 0.4, temperature: 30.0, tint: -20.0, contrast: 15.0,
        highlights: -25.0, brightness: 10.0, shadows: 20.0, vibrance: 35.0,
        saturation: 10.0, blacks: -10.0,
    };
    project.pages[0].frames[0].transform.adjustments = adjustments.clone();
    project.pages[0].frames[0].transform.rotation = 17.0;
    collage_core::validate_project(&project).unwrap();
    let color = PhotoColorTransform::new(&adjustments);
    let linear = original_rgb.map(|channel| {
        let srgb = channel as f32 / 255.0;
        if srgb <= 0.04045 { srgb / 12.92 } else { ((srgb + 0.055) / 1.055).powf(2.4) }
    });
    let expected = color.apply(linear).map(|channel| {
        let srgb = if channel <= 0.0031308 { 12.92 * channel } else { 1.055 * channel.powf(1.0 / 2.4) - 0.055 };
        (srgb * 255.0).round().clamp(0.0, 255.0) as u8
    });
    assert_ne!(expected, original_rgb);
    let output = service::write_page(&project, &project.pages[0], &options(dir.path(), "png"), "adjusted", &AtomicBool::new(false)).unwrap();
    let adjusted = image::open(output).unwrap().into_rgb8();
    for pixel in adjusted.pixels() {
        assert!(pixel.0.iter().zip(expected).all(|(actual, expected)| actual.abs_diff(expected) <= 1), "native color must match shared preview color: {:?} vs {:?}", pixel.0, expected);
    }
    let project_path = dir.path().join("adjusted.collage");
    storage::save(&project, &project_path).unwrap();
    assert_eq!(storage::load(&project_path).unwrap(), project);
    assert_eq!(assets::fingerprint(&source).unwrap(), original_hash);
}

#[test]
fn two_placements_of_the_same_original_keep_independent_photo_adjustments() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("shared-original.png");
    RgbImage::from_pixel(120, 180, Rgb([80, 100, 120])).save(&source).unwrap();
    let mut project = project_with_photo(&source, 240, 180);
    let template = project.templates.get_mut("full").unwrap();
    template.root = LayoutNode::Split {
        axis: Axis::X, parameter: "columns".into(),
        children: vec![LayoutNode::Leaf { slot_id: "photo".into() }, LayoutNode::Leaf { slot_id: "second".into() }],
    };
    template.defaults.insert("columns".into(), vec![0.5, 0.5]);
    template.slot_order.push("second".into());
    let mut second = project.pages[0].frames[0].clone();
    second.id = "second-frame".into();
    second.slot_id = "second".into();
    second.transform.adjustments.exposure = 1.0;
    second.transform.adjustments.temperature = 40.0;
    project.pages[0].frames.push(second);
    collage_core::validate_project(&project).unwrap();
    let rendered = render::render_page(&project, &project.pages[0], &AtomicBool::new(false)).unwrap();
    assert_eq!(rendered.get_pixel(60, 90).0, [80, 100, 120]);
    let changed = rendered.get_pixel(180, 90).0;
    assert_ne!(changed, [80, 100, 120]);
    assert!(changed[0] > 80 && changed[1] > 100, "second placement receives its own exposure");
    assert_eq!(project.pages[0].frames[0].transform.adjustments, PhotoAdjustments::default());
}

#[test]
fn free_photo_geometry_and_page_override_export_inside_their_independent_rectangles() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("free-source.png");
    RgbImage::from_pixel(120, 180, Rgb([30, 90, 180])).save(&source).unwrap();
    let mut project = project_with_photo(&source, 200, 300);
    project.templates.get_mut("full").unwrap().root = LayoutNode::Free {
        frames: vec![ResolvedFrame { slot_id: "photo".into(), rect: Rect { x: 0.2, y: 0.1, width: 0.6, height: 0.4 } }],
    };
    project.pages[0].margin = Margin { top: 140.0, right: 80.0, bottom: 140.0, left: 80.0 };
    project.pages[0].column_gap = 1000.0;
    project.pages[0].row_gap = 1000.0;
    for (name, rectangle) in [
        ("free", Rect { x: 40.0, y: 30.0, width: 120.0, height: 120.0 }),
        ("override", Rect { x: 20.0, y: 180.0, width: 60.0, height: 90.0 }),
    ] {
        if name == "override" {
            project.pages[0].frame_rects = Some(BTreeMap::from([("photo".into(), Rect { x: 0.1, y: 0.6, width: 0.3, height: 0.3 })]));
        }
        collage_core::validate_project(&project).unwrap();
        let output = service::write_page(&project, &project.pages[0], &options(dir.path(), "png"), name, &AtomicBool::new(false)).unwrap();
        let rendered = image::open(output).unwrap().into_rgb8();
        assert_eq!(rendered.dimensions(), (200, 300));
        for (x, y, pixel) in rendered.enumerate_pixels() {
            let inside = x as f64 >= rectangle.x && (x as f64) < rectangle.x + rectangle.width
                && y as f64 >= rectangle.y && (y as f64) < rectangle.y + rectangle.height;
            assert_eq!(pixel.0, if inside { [30, 90, 180] } else { [255, 255, 255] }, "{name}: ({x},{y})");
        }
    }
}
