use crate::{assets, watermark::{self, Options, Placement}};
use collage_core::ExportProgress;
use image::{ImageDecoder, ImageReader, Rgb, RgbImage, Rgba, RgbaImage};
use std::{fs, path::Path, sync::{atomic::{AtomicBool, Ordering}, Mutex}};

fn placement() -> Placement { Placement { x: 1.0, y: 1.0, width_ratio: 0.5, opacity: 1.0, ..Placement::default() } }
fn setup() -> (tempfile::TempDir, Options) {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("input"); let output = dir.path().join("output");
    fs::create_dir(&input).unwrap(); fs::create_dir(&output).unwrap();
    RgbImage::from_pixel(120, 180, Rgb([0, 0, 0])).save(input.join("photo1.png")).unwrap();
    RgbImage::from_pixel(180, 120, Rgb([20, 40, 60])).save(input.join("photo2.png")).unwrap();
    let mark = dir.path().join("mark.png");
    RgbaImage::from_fn(20, 10, |x, _| if x < 10 { Rgba([255, 0, 0, 0]) } else { Rgba([255, 255, 255, 128]) }).save(&mark).unwrap();
    let scan = watermark::scan_directory(&input).unwrap();
    let options = Options { assets: scan.assets, watermark: Some(assets::inspect(&mark, None).unwrap()), text: None, input_directory: input.to_string_lossy().into(),
        directory: output.to_string_lossy().into(), placement: placement(), format: "png".into(), quality: 100 };
    (dir, options)
}
fn progress(options: &Options) -> ExportProgress {
    ExportProgress { job_id: "test-watermark".into(), completed: 0, total: options.assets.len(), page_name: "等待".into(),
        state: "running".into(), paths: vec![], errors: vec![] }
}
fn files(directory: &str) -> usize { fs::read_dir(directory).unwrap().count() }

#[test]
fn scanning_is_natural_nonrecursive_and_reports_invalid_and_ignored_entries() {
    let dir = tempfile::tempdir().unwrap();
    for name in ["照片10.png", "照片2.PNG", "照片1.jpg"] {
        let path = dir.path().join(name);
        RgbImage::from_pixel(12, 18, Rgb([10, 20, 30])).save_with_format(path, if name.ends_with("jpg") { image::ImageFormat::Jpeg } else { image::ImageFormat::Png }).unwrap();
    }
    fs::write(dir.path().join("broken.png"), b"not a photo").unwrap();
    fs::write(dir.path().join("notes.txt"), b"ignored").unwrap();
    fs::create_dir(dir.path().join("nested")).unwrap();
    RgbImage::new(2, 2).save(dir.path().join("nested/photo.png")).unwrap();
    let scan = watermark::scan_directory(dir.path()).unwrap();
    assert_eq!(scan.assets.iter().map(|a| a.file_name.as_str()).collect::<Vec<_>>(), ["照片1.jpg", "照片2.PNG", "照片10.png"]);
    assert_eq!(scan.errors.len(), 1); assert!(scan.errors[0].contains("broken.png"));
    assert_eq!(scan.skipped, 2);
    assert!(watermark::natural_compare("a999999999999999999999999999999.jpg", "a1000000000000000000000000000000.jpg").is_lt());
}

#[test]
fn watermark_selection_requires_real_png_with_visible_and_transparent_content() {
    let (dir, options) = setup();
    watermark::validate_watermark(options.watermark.as_ref().unwrap()).unwrap();
    for (name, pixels, expected) in [
        ("opaque.png", Rgba([255, 255, 255, 255]), "没有透明背景"),
        ("empty.png", Rgba([255, 255, 255, 0]), "完全透明"),
    ] {
        let path = dir.path().join(name); RgbaImage::from_pixel(20, 10, pixels).save(&path).unwrap();
        assert!(watermark::validate_watermark(&assets::inspect(&path, None).unwrap()).unwrap_err().to_string().contains(expected));
    }
    let disguised = dir.path().join("fake.png");
    RgbImage::new(20, 10).save_with_format(&disguised, image::ImageFormat::Jpeg).unwrap();
    let mut false_metadata = assets::inspect(&disguised, None).unwrap(); false_metadata.format = "png".into();
    assert!(watermark::validate_watermark(&false_metadata).unwrap_err().to_string().contains("PNG"));
}

#[test]
fn positioning_uses_the_shorter_edge_and_relative_remaining_space_on_each_orientation() {
    let p = Placement { x: 0.25, y: 0.75, width_ratio: 0.4, opacity: 0.8, ..Placement::default() };
    let vertical = watermark::watermark_rect(400, 600, 200, 100, &p).unwrap();
    assert_eq!((vertical.x, vertical.y, vertical.width, vertical.height), (60.0, 390.0, 160.0, 80.0));
    let horizontal = watermark::watermark_rect(600, 400, 200, 100, &p).unwrap();
    assert_eq!((horizontal.x, horizontal.y, horizontal.width, horizontal.height), (110.0, 240.0, 160.0, 80.0));
    let enlarged = watermark::watermark_rect(4000, 6000, 200, 100, &p).unwrap();
    assert_eq!(enlarged.x / vertical.x, 10.0); assert_eq!(enlarged.y / vertical.y, 10.0);
}

#[test]
fn oversized_and_tall_watermarks_are_contained_without_changing_aspect_or_clipping() {
    let p = Placement { width_ratio: 2.0, ..placement() };
    let tall = watermark::watermark_rect(600, 400, 100, 1000, &p).unwrap();
    assert_eq!((tall.x, tall.y, tall.width, tall.height), (560.0, 0.0, 40.0, 400.0));
    let wide = watermark::watermark_rect(400, 600, 1000, 100, &p).unwrap();
    assert_eq!((wide.x, wide.y, wide.width, wide.height), (0.0, 560.0, 400.0, 40.0));
    assert!(watermark::watermark_rect(0, 600, 100, 100, &p).is_err());
}

#[test]
fn invalid_placement_parameters_and_export_options_fail_before_any_output() {
    let (_dir, options) = setup();
    for p in [Placement { x: f64::NAN, ..placement() }, Placement { y: -0.01, ..placement() }, Placement { opacity: 1.01, ..placement() },
        Placement { width_ratio: 0.009, ..placement() }, Placement { width_ratio: 2.01, ..placement() }] {
        let mut bad = options.clone(); bad.placement = p;
        assert!(watermark::prepare_options(bad, &options.assets).is_err());
    }
    for (format, quality) in [("tiff", 100), ("jpg", 0)] {
        let mut bad = options.clone(); bad.format = format.into(); bad.quality = quality;
        assert!(watermark::prepare_options(bad, &options.assets).is_err());
    }
    assert_eq!(files(&options.directory), 0);
}

#[test]
fn batch_preserves_both_original_dimensions_and_png_alpha_blends_in_linear_srgb() {
    let (_dir, mut options) = setup();
    options.placement.opacity = 0.5;
    let originals: Vec<_> = options.assets.iter().map(|a| assets::fingerprint(Path::new(&a.original_path)).unwrap()).collect();
    let mut p = progress(&options);
    watermark::run_batch(&options, &AtomicBool::new(false), &mut p, &Mutex::new(()), |_| {}).unwrap();
    assert_eq!(p.completed, 2); assert_eq!(p.paths.len(), 2); assert!(p.errors.is_empty());
    let vertical = image::open(&p.paths[0]).unwrap().into_rgb8();
    assert_eq!(vertical.dimensions(), (120, 180));
    assert_eq!(vertical.get_pixel(70, 165).0, [0, 0, 0], "invisible red pixels may not bleed into the original");
    let blended = vertical.get_pixel(110, 165).0;
    // 128/255 source alpha × .5 layer opacity, blended in linear light onto black.
    assert!(blended.iter().all(|value| value.abs_diff(137) <= 1), "incorrect blend: {blended:?}");
    let horizontal = image::open(&p.paths[1]).unwrap(); assert_eq!((horizontal.width(), horizontal.height()), (180, 120));
    for (asset, original) in options.assets.iter().zip(originals) { assert_eq!(assets::fingerprint(Path::new(&asset.original_path)).unwrap(), original); }
}

#[test]
fn jpg_quality_100_output_is_full_resolution_rgb_srgb() {
    let (_dir, mut options) = setup(); options.format = "jpg".into();
    let path = watermark::write_photo(&options.assets[0], &options, &AtomicBool::new(false)).unwrap();
    let mut decoder = ImageReader::open(path).unwrap().into_decoder().unwrap();
    assert_eq!(decoder.dimensions(), (120, 180));
    assert_eq!(decoder.orientation().unwrap().to_exif(), 1);
    assert!(decoder.icc_profile().unwrap().is_some());
    assert_eq!(decoder.color_type(), image::ColorType::Rgb8);
}

#[test]
fn exif_rotated_original_is_oriented_once_before_positioning_and_export() {
    let (dir, mut options) = setup(); let path = dir.path().join("input/rotated.jpg");
    let data = RgbImage::from_pixel(80, 40, Rgb([20, 80, 120]));
    let exif = [b'I', b'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0];
    let mut file = fs::File::create(&path).unwrap();
    let mut encoder = jpeg_encoder::Encoder::new(&mut file, 100);
    encoder.set_sampling_factor(jpeg_encoder::SamplingFactor::F_1_1); encoder.add_exif_metadata(&exif).unwrap();
    encoder.encode(data.as_raw(), 80, 40, jpeg_encoder::ColorType::Rgb).unwrap(); drop(file);
    let photo = assets::inspect(&path, None).unwrap(); assert_eq!((photo.width, photo.height), (40, 80));
    options.assets = vec![photo.clone()];
    let output = watermark::write_photo(&photo, &options, &AtomicBool::new(false)).unwrap();
    let mut decoder = ImageReader::open(&output).unwrap().into_decoder().unwrap();
    assert_eq!(decoder.dimensions(), (40, 80)); assert_eq!(decoder.orientation().unwrap().to_exif(), 1);
    let bitmap = image::open(output).unwrap().into_rgb8();
    assert!(bitmap.get_pixel(38, 78)[0] > bitmap.get_pixel(2, 2)[0] + 30, "watermark must use the oriented bottom-right corner");
}

#[test]
fn selection_requires_scanned_snapshots_and_rejects_duplicate_or_outside_photos() {
    let (_dir, options) = setup();
    watermark::prepare_options(options.clone(), &options.assets).unwrap();
    let mut duplicate = options.clone(); duplicate.assets.push(duplicate.assets[0].clone());
    assert!(watermark::prepare_options(duplicate, &options.assets).is_err());
    let mut tampered = options.clone(); tampered.assets[0].width += 1;
    assert!(watermark::prepare_options(tampered, &options.assets).is_err());
    let mark = options.watermark.clone().unwrap();
    let mut outside = options.clone(); outside.assets = vec![mark.clone()];
    assert!(watermark::prepare_options(outside, &[mark]).is_err());
}

#[test]
fn output_cannot_be_the_input_folder_and_collisions_never_replace_existing_files() {
    let (_dir, options) = setup();
    let mut same = options.clone(); same.directory = same.input_directory.clone();
    assert!(watermark::prepare_options(same, &options.assets).unwrap_err().to_string().contains("不能"));
    let previous = Path::new(&options.directory).join("photo1-水印.png"); fs::write(&previous, b"previous file").unwrap();
    let source_before = fs::read(&options.assets[0].original_path).unwrap();
    let next = watermark::write_photo(&options.assets[0], &options, &AtomicBool::new(false)).unwrap();
    assert_eq!(next.file_name().unwrap(), "photo1-水印-1.png");
    assert_eq!(fs::read(previous).unwrap(), b"previous file");
    assert_eq!(fs::read(&options.assets[0].original_path).unwrap(), source_before);
}

#[test]
fn errors_are_recorded_per_photo_and_processing_continues() {
    let (_dir, mut options) = setup();
    let good = options.assets[1].clone();
    fs::remove_file(&options.assets[1].original_path).unwrap();
    options.assets.push(options.assets[0].clone());
    let mut p = progress(&options);
    watermark::run_batch(&options, &AtomicBool::new(false), &mut p, &Mutex::new(()), |_| {}).unwrap();
    assert_eq!(p.completed, 3); assert_eq!(p.paths.len(), 2); assert_eq!(p.errors.len(), 1);
    assert!(p.errors[0].contains(&good.file_name));
    assert_eq!(files(&options.directory), 2, "failed photos must leave no incomplete temporary files");
}

#[test]
fn cancellation_before_or_between_photos_keeps_only_completed_files_and_accurate_progress() {
    let (_dir, options) = setup();
    let mut p = progress(&options); let pre_cancelled = AtomicBool::new(true);
    assert!(watermark::run_batch(&options, &pre_cancelled, &mut p, &Mutex::new(()), |_| {}).is_err());
    assert_eq!(p.completed, 0); assert_eq!(files(&options.directory), 0);
    let cancel = AtomicBool::new(false);
    assert!(watermark::run_batch(&options, &cancel, &mut p, &Mutex::new(()), |current| {
        if current.completed == 1 { cancel.store(true, Ordering::Relaxed); }
    }).is_err());
    assert_eq!(p.completed, 1); assert_eq!(p.paths.len(), 1); assert!(p.errors.is_empty());
    assert_eq!(files(&options.directory), 1);
    assert!(image::open(&p.paths[0]).is_ok());
}

#[cfg(unix)]
#[test]
fn folder_symlinks_are_canonicalized_and_file_symlinks_are_not_scanned() {
    let (dir, options) = setup();
    let alias = dir.path().join("alias"); std::os::unix::fs::symlink(&options.input_directory, &alias).unwrap();
    let mut same = options.clone(); same.directory = alias.to_string_lossy().into();
    assert!(watermark::prepare_options(same, &options.assets).is_err());
    std::os::unix::fs::symlink(&options.watermark.as_ref().unwrap().original_path, Path::new(&options.input_directory).join("linked.png")).unwrap();
    let scan = watermark::scan_directory(Path::new(&options.input_directory)).unwrap();
    assert_eq!(scan.assets.len(), 2); assert_eq!(scan.skipped, 1);
}

#[test]
fn a_watermark_inside_input_is_excluded_from_the_photo_batch() {
    let (_dir, mut options) = setup();
    let destination = Path::new(&options.input_directory).join("mark.png"); fs::copy(&options.watermark.as_ref().unwrap().original_path, &destination).unwrap();
    let scan = watermark::scan_directory(Path::new(&options.input_directory)).unwrap();
    options.watermark = scan.assets.iter().find(|asset| asset.file_name == "mark.png").cloned();
    options.assets = scan.assets.clone();
    let prepared = watermark::prepare_options(options, &scan.assets).unwrap();
    assert_eq!(prepared.assets.len(), 2); assert!(prepared.assets.iter().all(|asset| asset.file_name != "mark.png"));
}

#[test]
fn a_quarter_turn_preserves_transparency_when_tiling_with_independent_gaps() {
    use watermark::{PositionMode, Tile};
    let (_dir, mut options) = setup();
    options.placement = Placement { position_mode: PositionMode::Pixels, x: 8.0, y: 12.0,
        rotation: 90.0, tile: Some(Tile { gap_x: 10.0, gap_y: 10.0 }), ..placement() };
    let path = watermark::write_photo(&options.assets[0], &options, &AtomicBool::new(false)).unwrap();
    let pixels = image::open(path).unwrap().into_rgb8();
    assert_eq!(pixels.dimensions(), (120, 180));
    // The unrotated mark has transparent red on its left and half-alpha white
    // on its right. A clockwise turn puts those halves on top and bottom.
    assert_eq!(pixels.get_pixel(15, 20).0, [0, 0, 0]);
    assert_eq!(pixels.get_pixel(44, 60).0, [0, 0, 0]);
    assert_eq!(pixels.get_pixel(15, 78).0, [0, 0, 0]);
    for (x, y) in [(15, 60), (55, 60), (15, 130)] {
        assert!(pixels.get_pixel(x, y).0.iter().all(|channel| channel.abs_diff(188) <= 1));
    }
}

#[test]
fn legacy_placement_defaults_and_edge_margins_resolve_on_both_photo_orientations() {
    use watermark::PositionMode;
    let legacy: Placement = serde_json::from_str(r#"{"x":1,"y":1,"widthRatio":0.5,"opacity":1}"#).unwrap();
    assert_eq!(legacy.rotation, 0.0);
    assert!(matches!(legacy.position_mode, PositionMode::Relative));
    assert!(legacy.tile.is_none());
    let margin = Placement { position_mode: PositionMode::Margins, x: 10.0, y: 20.0, ..legacy };
    let portrait = watermark::watermark_rect(120, 180, 20, 10, &margin).unwrap();
    let landscape = watermark::watermark_rect(180, 120, 20, 10, &margin).unwrap();
    assert_eq!((portrait.x, portrait.y), (50.0, 130.0));
    assert_eq!((landscape.x, landscape.y), (110.0, 70.0));
}

#[cfg(target_os = "macos")]
fn text_watermark() -> crate::watermark_text::TextWatermark {
    use crate::watermark_text::{Alignment, TextWatermark};
    TextWatermark { text: "PicParty\n摄影署名".into(), font_family: "Helvetica Neue".into(),
        font_weight: 500, font_size: 18.0, color: "#FF0000".into(), character_spacing: 1.0,
        line_spacing: 3.0, italic_angle: 12.0, alignment: Alignment::Left, wrap_width: 0.0, scale: 1.0,
        placement: Placement { x: 0.0, y: 0.0, ..placement() },
        color_ranges: Vec::new(), stroke: None, shadow: None, background: None }
}

#[cfg(target_os = "macos")]
#[test]
fn system_fonts_shape_multilingual_text_and_change_weight_and_wrap() {
    use crate::watermark_text::{font_families, TextLayout};
    assert!(font_families().unwrap().iter().any(|name| name == "Helvetica Neue"));
    let mut text = text_watermark();
    text.font_weight = 400;
    let normal = TextLayout::new(&text).unwrap();
    let normal_alpha: u64 = normal.rasterize(normal.width, normal.height).unwrap().pixels().map(|p| p[3] as u64).sum();
    assert!(normal_alpha > 0);
    text.font_weight = 700;
    let bold = TextLayout::new(&text).unwrap();
    let bold_alpha: u64 = bold.rasterize(bold.width, bold.height).unwrap().pixels().map(|p| p[3] as u64).sum();
    assert!(bold_alpha > normal_alpha, "the installed bold face should use more ink");
    text.wrap_width = 40.0;
    let wrapped = TextLayout::new(&text).unwrap();
    assert!(wrapped.width < bold.width && wrapped.height > bold.height);
    text.font_family = "PicParty unavailable font fixture".into();
    assert!(TextLayout::new(&text).err().unwrap().to_string().contains("未找到水印字体"));
}

#[cfg(target_os = "macos")]
#[test]
fn selected_text_color_survives_utf16_and_crlf_layout() {
    use crate::watermark_text::{TextColorRange, TextLayout};

    let mut text = text_watermark();
    text.text = "A🚀\r\nB".into();
    text.font_size = 30.0;
    text.color_ranges = vec![TextColorRange {
        start: 5,
        end: 6,
        color: "#00FF00".into(),
    }];
    let layout = TextLayout::new(&text).unwrap();
    let pixels = layout.rasterize(layout.width, layout.height).unwrap();
    let color_rows = |channel: usize| {
        pixels
            .enumerate_pixels()
            .filter(|(_, _, p)| p[channel] > 200 && p[1 - channel] < 20 && p[2] < 20 && p[3] > 200)
            .map(|(_, y, _)| y)
            .collect::<Vec<_>>()
    };
    let default = color_rows(0);
    let selection = color_rows(1);
    assert!(default.len() > 20, "the first line should keep the base fill");
    assert!(selection.len() > 20, "the selected B should be green");
    assert!(default.iter().max() < selection.iter().min());

    text.color_ranges[0].start = 2;
    text.color_ranges[0].end = 3;
    assert!(text.validate().is_err(), "a range must not split the rocket surrogate pair");
}

#[cfg(target_os = "macos")]
#[test]
fn drop_shadow_offset_scales_and_uses_downward_positive_y() {
    use crate::watermark_text::{TextLayout, TextShadow};

    let mut text = text_watermark();
    text.text = "M".into();
    text.font_size = 24.0;
    text.shadow = Some(TextShadow {
        color: "#0000FF".into(),
        opacity: 0.7,
        offset_x: 22.0,
        offset_y: 13.0,
        blur: 0.0,
    });
    let layout = TextLayout::new(&text).unwrap();
    for scale in [1.0, 0.5] {
        let pixels = layout.rasterize(layout.width * scale, layout.height * scale).unwrap();
        let color_origin = |channel: usize| {
            pixels
                .enumerate_pixels()
                .filter(|(_, _, p)| p[channel] > 200 && p[2 - channel] < 20 && p[3] > 120)
                .map(|(x, y, _)| (x, y))
                .reduce(|(min_x, min_y), (x, y)| (min_x.min(x), min_y.min(y)))
                .expect("glyph and shadow should both be visible")
        };
        let glyph = color_origin(0);
        let shadow = color_origin(2);
        assert!(((shadow.0 as f64 - glyph.0 as f64) - 22.0 * scale).abs() < 2.0);
        assert!(((shadow.1 as f64 - glyph.1 as f64) - 13.0 * scale).abs() < 2.0);
    }
}

#[cfg(target_os = "macos")]
#[test]
fn rotated_styled_text_keeps_local_fill_outline_shadow_and_color_block_in_export() {
    use crate::watermark_text::{TextBackground, TextColorRange, TextShadow, TextStroke};

    let (_dir, mut options) = setup();
    options.watermark = None;
    let mut text = text_watermark();
    text.text = "AB".into();
    text.font_size = 26.0;
    text.placement.x = 0.5;
    text.placement.y = 0.5;
    text.placement.rotation = -27.0;
    text.color_ranges = vec![TextColorRange {
        start: 1,
        end: 2,
        color: "#00FF00".into(),
    }];
    text.stroke = Some(TextStroke {
        color: "#00FFFF".into(),
        width: 2.0,
    });
    text.shadow = Some(TextShadow {
        color: "#0000FF".into(),
        opacity: 0.8,
        offset_x: 14.0,
        offset_y: 11.0,
        blur: 1.0,
    });
    text.background = Some(TextBackground {
        color: "#FFFF00".into(),
        opacity: 0.4,
        padding: 4.0,
    });
    options.text = Some(text);
    let path = watermark::write_photo(&options.assets[0], &options, &AtomicBool::new(false)).unwrap();
    let pixels = image::open(path).unwrap().into_rgb8();
    assert_eq!(pixels.dimensions(), (120, 180));
    assert_eq!(pixels.get_pixel(0, 0).0, [0, 0, 0]);
    assert!(pixels.pixels().any(|p| p[0] > 180 && p[1] < 45 && p[2] < 45), "base red fill");
    assert!(pixels.pixels().any(|p| p[0] < 45 && p[1] > 180 && p[2] < 45), "selected green fill");
    assert!(pixels.pixels().any(|p| p[0] < 45 && p[1] > 180 && p[2] > 180), "cyan outline");
    assert!(pixels.pixels().any(|p| p[0] < 45 && p[1] < 45 && p[2] > 150), "blue drop shadow");
    assert!(pixels.pixels().any(|p| (160..=180).contains(&p[0]) && p[0] == p[1] && p[2] < 10), "40% yellow color block blended onto black");
}

#[cfg(target_os = "macos")]
#[test]
fn text_only_and_two_layer_batch_exports_keep_original_sizes_and_show_both_layers() {
    let (_dir, mut options) = setup();
    let originals: Vec<_> = options.assets.iter().map(|a| fs::read(&a.original_path).unwrap()).collect();
    options.text = Some(text_watermark());
    let mut text_only = options.clone();
    text_only.watermark = None;
    let mut payload = serde_json::to_value(text_only).unwrap();
    payload["placement"] = serde_json::Value::Null;
    let text_only: Options = serde_json::from_value(payload).unwrap();
    let prepared = watermark::prepare_options(text_only, &options.assets).unwrap();
    let path = watermark::write_photo(&prepared.assets[0], &prepared, &AtomicBool::new(false)).unwrap();
    let pixels = image::open(path).unwrap().into_rgb8();
    assert!(pixels.enumerate_pixels().any(|(_, y, pixel)| y < 50 && pixel[0] > 128 && pixel[1] == 0));
    assert_eq!(pixels.get_pixel(110, 165).0, [0, 0, 0]);

    let mut p = progress(&options);
    watermark::run_batch(&options, &AtomicBool::new(false), &mut p, &Mutex::new(()), |_| {}).unwrap();
    assert_eq!(p.paths.len(), 2);
    assert!(p.errors.is_empty(), "{:?}", p.errors);
    let portrait = image::open(&p.paths[0]).unwrap().into_rgb8();
    assert_eq!(portrait.dimensions(), (120, 180));
    assert!(portrait.enumerate_pixels().any(|(_, y, pixel)| y < 50 && pixel[0] > 128 && pixel[1] == 0));
    assert!(portrait.get_pixel(110, 165)[1] > 128);
    assert_eq!(image::open(&p.paths[1]).unwrap().into_rgb8().dimensions(), (180, 120));
    for (asset, original) in options.assets.iter().zip(originals) {
        assert_eq!(fs::read(&asset.original_path).unwrap(), original);
    }
}
