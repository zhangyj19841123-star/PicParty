use crate::{assets, render, service::{FileStamp, Shared}, storage, watermark_text::{TextLayout, TextWatermark}};
use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use collage_core::{CanvasSizing, DocumentSize, ExportProgress, Frame, ImageAsset, ImageTransform, LayoutNode, Margin, Page, Project, Rect, TemplateDefinition};
use image::{ImageEncoder, RgbImage, RgbaImage};
use serde::{Deserialize, Deserializer, Serialize};
use std::{cmp::Ordering as Compare, collections::{BTreeMap, BTreeSet, VecDeque}, fs, path::{Path, PathBuf}, sync::{atomic::{AtomicBool, Ordering}, mpsc::{self, SyncSender}, Arc, Mutex}};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

const MAX_BATCH: usize = 5000;
const PREVIEW_SOURCES: usize = 4;

#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PositionMode {
    #[default]
    Relative,
    Pixels,
    Margins,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Tile { pub gap_x: f64, pub gap_y: f64 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Placement {
    /// Fraction of movable space, top-left pixels, or margin from the anchor.
    pub x: f64,
    pub y: f64,
    /// Watermark width relative to the photograph's shorter edge.
    pub width_ratio: f64,
    pub opacity: f64,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default)]
    pub position_mode: PositionMode,
    #[serde(default = "default_anchor")]
    pub anchor_x: f64,
    #[serde(default = "default_anchor")]
    pub anchor_y: f64,
    #[serde(default)]
    pub tile: Option<Tile>,
}

fn default_anchor() -> f64 { 1.0 }

impl Default for Placement {
    fn default() -> Self {
        Self { x: 0.95, y: 0.95, width_ratio: 0.2, opacity: 0.7, rotation: 0.0,
            position_mode: PositionMode::Relative, anchor_x: 1.0, anchor_y: 1.0, tile: None }
    }
}

impl Placement {
    pub(crate) fn validate(&self) -> Result<()> {
        let max_position = if matches!(self.position_mode, PositionMode::Relative) { 1.0 } else { 32768.0 };
        if !(0.0..=max_position).contains(&self.x) || !(0.0..=max_position).contains(&self.y)
            || !(0.01..=2.0).contains(&self.width_ratio) || !(0.0..=1.0).contains(&self.opacity)
            || !(-180.0..=180.0).contains(&self.rotation)
            || !(0.0..=1.0).contains(&self.anchor_x) || !(0.0..=1.0).contains(&self.anchor_y)
            || self.tile.is_some_and(|tile| !(0.0..=32768.0).contains(&tile.gap_x) || !(0.0..=32768.0).contains(&tile.gap_y))
        {
            bail!("水印的位置、尺寸、旋转、透明度或间距无效");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Options {
    pub assets: Vec<ImageAsset>,
    #[serde(default)]
    pub watermark: Option<ImageAsset>,
    #[serde(default)]
    pub text: Option<TextWatermark>,
    pub input_directory: String,
    pub directory: String,
    #[serde(default, deserialize_with = "optional_placement")]
    pub placement: Placement,
    pub format: String,
    pub quality: u8,
}

// A text-only batch may send an explicit null placement for its disabled PNG layer.
fn optional_placement<'de, D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Placement, D::Error> {
    Option::<Placement>::deserialize(deserializer).map(Option::unwrap_or_default)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub directory: String,
    pub assets: Vec<ImageAsset>,
    pub errors: Vec<String>,
    pub skipped: usize,
}

#[derive(Serialize)]
pub struct Preview {
    pub url: String,
    pub layers: PreviewLayers,
}

#[derive(Default, Serialize)]
pub struct PreviewLayers {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<Rect>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<Rect>,
}

struct Job { options: Options, progress: ExportProgress, cancel: Arc<AtomicBool> }

struct PreviewSource {
    asset: ImageAsset,
    max_size: u32,
    stamp: FileStamp,
    bitmap: Arc<RgbaImage>,
}

#[derive(Default)]
struct QueueState {
    scans: Mutex<BTreeMap<PathBuf, Vec<ImageAsset>>>,
    jobs: Mutex<BTreeMap<String, Arc<AtomicBool>>>,
    progress: Mutex<BTreeMap<String, ExportProgress>>,
    preview: Mutex<VecDeque<PreviewSource>>,
}

pub struct WatermarkService {
    shared: Arc<Shared>,
    state: Arc<QueueState>,
    sender: SyncSender<Job>,
    app: AppHandle,
}

impl WatermarkService {
    pub fn new(shared: Arc<Shared>, app: AppHandle) -> Result<Self> {
        let state = Arc::new(QueueState::default());
        let (sender, receiver) = mpsc::sync_channel::<Job>(8);
        let worker_state = state.clone();
        let worker_shared = shared.clone();
        let worker_app = app.clone();
        std::thread::Builder::new().name("batch-watermark".into()).spawn(move || {
            while let Ok(job) = receiver.recv() {
                let mut progress = job.progress;
                let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    run_batch(&job.options, &job.cancel, &mut progress, &worker_shared.image_gate,
                        |p| publish(&worker_state, &worker_app, p))
                }));
                match outcome {
                    Err(_) => { progress.errors.push("水印任务异常退出，未完成照片没有写入".into()); progress.state = "failed".into(); }
                    Ok(Err(error)) if !job.cancel.load(Ordering::Relaxed) => {
                        progress.errors.push(format!("{error:#}")); progress.state = "failed".into();
                    }
                    _ => {
                        progress.state = if job.cancel.load(Ordering::Relaxed) { "cancelled" }
                            else if progress.paths.is_empty() && !progress.errors.is_empty() { "failed" }
                            else { "completed" }.into();
                    }
                }
                publish(&worker_state, &worker_app, &progress);
                worker_state.jobs.lock().unwrap_or_else(|e| e.into_inner()).remove(&progress.job_id);
            }
        })?;
        Ok(Self { shared, state, sender, app })
    }

    pub fn scan(&self, directory: &Path) -> Result<ScanResult> {
        let result = scan_directory(directory)?;
        for asset in &result.assets { self.shared.register_asset(asset.clone()); }
        let mut scans = self.state.scans.lock().unwrap_or_else(|e| e.into_inner());
        // Only metadata is retained. Restrict old authorizations to avoid an
        // unbounded session while keeping named profiles convenient to reuse.
        if scans.len() >= 32 && !scans.contains_key(Path::new(&result.directory)) {
            if let Some(path) = scans.keys().next().cloned() { scans.remove(&path); }
        }
        scans.insert(PathBuf::from(&result.directory), result.assets.clone());
        Ok(result)
    }

    pub fn start(&self, options: Options) -> Result<String> {
        let input = Path::new(&options.input_directory).canonicalize().context("输入文件夹不存在，请重新选择")?;
        let options = {
            let scans = self.state.scans.lock().unwrap_or_else(|e| e.into_inner());
            let scanned = scans.get(&input).context("请先扫描输入照片文件夹")?;
            prepare_options(options, scanned)?
        };
        if let Some(mark) = &options.watermark {
            self.shared.authorized_asset(&mark.id, Some(mark))?;
            let _gate = self.shared.image_gate.lock().unwrap_or_else(|e| e.into_inner());
            validate_watermark(mark)?;
        }
        for asset in &options.assets { self.shared.authorized_asset(&asset.id, Some(asset))?; }
        if let Some(text) = &options.text { TextLayout::new(text)?; }
        let job_id = Uuid::new_v4().to_string();
        let progress = ExportProgress { job_id: job_id.clone(), completed: 0, total: options.assets.len(),
            page_name: "等待添加水印".into(), state: "running".into(), errors: vec![], paths: vec![] };
        let cancel = Arc::new(AtomicBool::new(false));
        self.state.jobs.lock().unwrap_or_else(|e| e.into_inner()).insert(job_id.clone(), cancel.clone());
        publish(&self.state, &self.app, &progress);
        if self.sender.try_send(Job { options, progress, cancel }).is_err() {
            self.state.jobs.lock().unwrap_or_else(|e| e.into_inner()).remove(&job_id);
            self.state.progress.lock().unwrap_or_else(|e| e.into_inner()).remove(&job_id);
            bail!("水印队列已满，请等待当前任务完成");
        }
        Ok(job_id)
    }

    fn preview_source(&self, asset: &ImageAsset, max_size: u32) -> Result<Arc<RgbaImage>> {
        self.shared.authorized_asset(&asset.id, Some(asset))?;
        let path = Path::new(&asset.original_path);
        let stamp = FileStamp::read(path).with_context(|| format!("无法读取水印预览素材：{}", asset.file_name))?;
        {
            let mut sources = self.state.preview.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(index) = sources.iter().position(|source| source.asset == *asset && source.max_size == max_size && source.stamp == stamp) {
                let source = sources.remove(index).expect("position comes from this cache");
                let bitmap = source.bitmap.clone();
                sources.push_back(source);
                return Ok(bitmap);
            }
        }
        let proxy = self.shared.proxy(&asset.id, max_size, Some(asset))?;
        let bitmap = {
            let _gate = self.shared.image_gate.lock().unwrap_or_else(|e| e.into_inner());
            let mut reader = image::ImageReader::open(proxy)?.with_guessed_format()?;
            let mut limits = image::Limits::default();
            limits.max_image_width = Some(max_size);
            limits.max_image_height = Some(max_size);
            limits.max_alloc = Some(u64::from(max_size) * u64::from(max_size) * 8);
            reader.limits(limits);
            Arc::new(reader.decode()?.into_rgba8())
        };
        if FileStamp::read(path)? != stamp { bail!("生成预览时素材发生变化，请重新选择：{}", asset.file_name); }
        let mut sources = self.state.preview.lock().unwrap_or_else(|e| e.into_inner());
        sources.retain(|source| source.asset != *asset || source.max_size != max_size);
        if sources.len() >= PREVIEW_SOURCES { sources.pop_front(); }
        sources.push_back(PreviewSource { asset: asset.clone(), max_size, stamp, bitmap: bitmap.clone() });
        Ok(bitmap)
    }

    pub fn preview(&self, photo: &ImageAsset, watermark: Option<&ImageAsset>, placement: Option<&Placement>,
        text: Option<&TextWatermark>, max_size: u32) -> Result<Preview> {
        if !matches!(max_size, 256 | 512 | 1024) { bail!("水印预览尺寸无效"); }
        let reference = self.preview_source(photo, max_size)?;
        let default = Placement::default();
        let image = if let Some(mark) = watermark {
            if mark.format != "png" { bail!("水印须为 PNG 图片"); }
            let placement = placement.unwrap_or(&default);
            placement.validate()?;
            Some((mark, placement, self.preview_source(mark, max_size)?))
        } else { None };
        let text_layout = text.map(TextLayout::new).transpose()?;
        let _gate = self.shared.image_gate.lock().unwrap_or_else(|e| e.into_inner());
        let mut bitmap = render::watermark_preview_matte(&reference);
        let cancel = AtomicBool::new(false);
        let layers = render_layers(&mut bitmap, (photo.width, photo.height), image.map(|(mark, placement, bitmap)| (mark, placement, (*bitmap).clone())), text.zip(text_layout.as_ref()), &cancel)?;
        let mut png = Vec::new();
        let mut encoder = image::codecs::png::PngEncoder::new_with_quality(
            &mut png, image::codecs::png::CompressionType::Fast, image::codecs::png::FilterType::Adaptive,
        );
        encoder.set_icc_profile(assets::srgb_profile()?)?;
        encoder.write_image(bitmap.as_raw(), bitmap.width(), bitmap.height(), image::ExtendedColorType::Rgb8)?;
        Ok(Preview { url: format!("data:image/png;base64,{}", STANDARD.encode(png)), layers })
    }

    pub fn cancel(&self, job_id: &str) {
        if let Some(cancel) = self.state.jobs.lock().unwrap_or_else(|e| e.into_inner()).get(job_id) {
            cancel.store(true, Ordering::Relaxed);
        } else { return; }
        if let Some(mut progress) = self.status(job_id) {
            if progress.state == "running" { progress.state = "cancelling".into(); publish(&self.state, &self.app, &progress); }
        }
    }

    pub fn status(&self, job_id: &str) -> Option<ExportProgress> {
        self.state.progress.lock().unwrap_or_else(|e| e.into_inner()).get(job_id).cloned()
    }

    pub fn has_active_jobs(&self) -> bool {
        !self.state.jobs.lock().unwrap_or_else(|e| e.into_inner()).is_empty()
    }
}

fn publish(state: &QueueState, app: &AppHandle, progress: &ExportProgress) {
    let mut known = state.progress.lock().unwrap_or_else(|e| e.into_inner());
    if known.len() >= 100 && !known.contains_key(&progress.job_id) {
        if let Some(id) = known.iter().find(|(_, p)| matches!(p.state.as_str(), "completed" | "cancelled" | "failed")).map(|(id, _)| id.clone()) { known.remove(&id); }
    }
    known.insert(progress.job_id.clone(), progress.clone());
    drop(known);
    let _ = app.emit("watermark-progress", progress);
}

pub(crate) fn scan_directory(directory: &Path) -> Result<ScanResult> {
    let directory = directory.canonicalize().context("照片文件夹不存在或无法访问")?;
    if !directory.is_dir() { bail!("请选择照片文件夹"); }
    let mut result = ScanResult { directory: directory.to_string_lossy().to_string(), assets: vec![], errors: vec![], skipped: 0 };
    let mut paths = vec![];
    for entry in fs::read_dir(&directory)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let path = entry.path();
        // Do not recurse or follow aliases into an unchosen folder.
        if !kind.is_file() || !path.extension().is_some_and(|ext| ["jpg", "jpeg", "png"].iter().any(|allowed| ext.eq_ignore_ascii_case(allowed))) {
            result.skipped += 1; continue;
        }
        paths.push(path);
        if paths.len() > MAX_BATCH { bail!("每次最多处理 5000 张照片，请分成多个文件夹"); }
    }
    paths.sort_by(|a, b| natural_compare(&a.file_name().unwrap_or_default().to_string_lossy(), &b.file_name().unwrap_or_default().to_string_lossy()));
    for path in paths {
        match assets::inspect(&path, None) {
            Ok(asset) if Path::new(&asset.original_path).parent() == Some(directory.as_path()) => result.assets.push(asset),
            Ok(_) => { result.skipped += 1; },
            Err(error) => result.errors.push(format!("{}：{error:#}", path.file_name().unwrap_or_default().to_string_lossy())),
        }
    }
    Ok(result)
}

pub(crate) fn natural_compare(a: &str, b: &str) -> Compare {
    let lower_a = a.to_lowercase(); let lower_b = b.to_lowercase();
    let (a_bytes, b_bytes) = (lower_a.as_bytes(), lower_b.as_bytes());
    let (mut left, mut right) = (0, 0);
    while left < a_bytes.len() && right < b_bytes.len() {
        if a_bytes[left].is_ascii_digit() && b_bytes[right].is_ascii_digit() {
            let (start_a, start_b) = (left, right);
            while left < a_bytes.len() && a_bytes[left].is_ascii_digit() { left += 1; }
            while right < b_bytes.len() && b_bytes[right].is_ascii_digit() { right += 1; }
            let digits_a = lower_a[start_a..left].trim_start_matches('0');
            let digits_b = lower_b[start_b..right].trim_start_matches('0');
            let compare = digits_a.len().cmp(&digits_b.len()).then_with(|| digits_a.cmp(digits_b));
            if compare != Compare::Equal { return compare; }
        } else {
            let compare = a_bytes[left].cmp(&b_bytes[right]);
            if compare != Compare::Equal { return compare; }
            left += 1; right += 1;
        }
    }
    a_bytes.len().cmp(&b_bytes.len()).then_with(|| a.cmp(b))
}

pub(crate) fn prepare_options(mut options: Options, scanned: &[ImageAsset]) -> Result<Options> {
    if options.watermark.is_none() && options.text.is_none() { bail!("请添加图片或文字水印"); }
    if options.watermark.is_some() { options.placement.validate()?; }
    if let Some(text) = &options.text { text.validate()?; }
    if !matches!(options.format.as_str(), "jpg" | "png") || !(1..=100).contains(&options.quality) { bail!("水印导出格式或品质无效"); }
    if options.assets.is_empty() || options.assets.len() > MAX_BATCH { bail!("请选择 1～5000 张待处理照片"); }
    let input = Path::new(&options.input_directory).canonicalize().context("输入文件夹不存在或无法访问")?;
    let output = Path::new(&options.directory).canonicalize().context("输出文件夹不存在或无法访问")?;
    if !input.is_dir() || !output.is_dir() { bail!("请选择有效的输入与输出文件夹"); }
    if input == output { bail!("输出文件夹不能与原图文件夹相同，请选择单独的文件夹或其子文件夹"); }
    let authorized: BTreeMap<_, _> = scanned.iter().map(|asset| (&asset.id, asset)).collect();
    let mut seen = BTreeSet::new();
    for asset in &options.assets {
        if !seen.insert(&asset.id) || authorized.get(&asset.id).is_none_or(|known| *known != asset)
            || Path::new(&asset.original_path).parent() != Some(input.as_path()) {
            bail!("批量照片未经当前文件夹扫描授权，请重新扫描");
        }
    }
    // A PNG chosen from the photo folder must never stamp itself.
    if let Some(mark) = &options.watermark {
        options.assets.retain(|asset| asset.original_path != mark.original_path);
    }
    if options.assets.is_empty() { bail!("输入文件夹没有可处理的照片，请勿只放置水印文件"); }
    options.input_directory = input.to_string_lossy().to_string();
    options.directory = output.to_string_lossy().to_string();
    Ok(options)
}

pub(crate) fn validate_watermark(asset: &ImageAsset) -> Result<()> {
    if asset.format != "png" || image::ImageReader::open(&asset.original_path)?.with_guessed_format()?.format() != Some(image::ImageFormat::Png) {
        bail!("水印须为带透明背景的 PNG 图片");
    }
    let image = assets::decode_srgb(asset, 0, 1)?;
    if image.dimensions() != (asset.width, asset.height) { bail!("水印尺寸发生变化，请重新选择"); }
    if !image.pixels().any(|pixel| pixel[3] < 255) { bail!("PNG 没有透明背景，请先在图像软件中去除背景后重新选择"); }
    if !image.pixels().any(|pixel| pixel[3] > 0) { bail!("PNG 水印完全透明，请选择包含可见内容的水印"); }
    Ok(())
}

#[cfg(test)]
pub(crate) fn watermark_rect(width: u32, height: u32, mark_width: u32, mark_height: u32, placement: &Placement) -> Result<Rect> {
    if width == 0 || height == 0 || mark_width == 0 || mark_height == 0 { bail!("水印或照片尺寸无效"); }
    let w = width.min(height) as f64 * placement.width_ratio;
    Ok(resolve_placement((width, height), w, w * mark_height as f64 / mark_width as f64, placement)?.rect)
}

fn resolve_placement((canvas_width, canvas_height): (u32, u32), width: f64, height: f64,
    placement: &Placement) -> Result<render::StampPlacement> {
    placement.validate()?;
    if canvas_width == 0 || canvas_height == 0 || width <= 0.0 || height <= 0.0 || !width.is_finite() || !height.is_finite() {
        bail!("水印或照片尺寸无效");
    }
    let (sin, cos) = placement.rotation.to_radians().sin_cos();
    let bounds_width = width * cos.abs() + height * sin.abs();
    let bounds_height = width * sin.abs() + height * cos.abs();
    let contain = (canvas_width as f64 / bounds_width).min(canvas_height as f64 / bounds_height).min(1.0);
    let bounds_width = bounds_width * contain;
    let bounds_height = bounds_height * contain;
    let position = |value: f64, anchor: f64, free: f64| {
        match placement.position_mode {
            PositionMode::Relative => free * value,
            PositionMode::Pixels => value,
            PositionMode::Margins => match anchor {
                1.0 => free - value,
                0.5 => free / 2.0 + value,
                _ => value,
            },
        }.clamp(0.0, free)
    };
    Ok(render::StampPlacement {
        rect: Rect {
            x: position(placement.x, placement.anchor_x, (canvas_width as f64 - bounds_width).max(0.0)),
            y: position(placement.y, placement.anchor_y, (canvas_height as f64 - bounds_height).max(0.0)),
            width: bounds_width, height: bounds_height,
        },
        width: width * contain,
        height: height * contain,
        rotation: placement.rotation,
        gaps: placement.tile.map(|tile| (tile.gap_x, tile.gap_y)),
    })
}

fn scale_placement(mut placement: render::StampPlacement, scale: f64) -> render::StampPlacement {
    placement.rect.x *= scale;
    placement.rect.y *= scale;
    placement.rect.width *= scale;
    placement.rect.height *= scale;
    placement.width *= scale;
    placement.height *= scale;
    placement.gaps = placement.gaps.map(|(x, y)| (x * scale, y * scale));
    placement
}

fn render_layers(bitmap: &mut RgbImage, original: (u32, u32), image: Option<(&ImageAsset, &Placement, RgbaImage)>,
    text: Option<(&TextWatermark, &TextLayout)>, cancel: &AtomicBool) -> Result<PreviewLayers> {
    let scale = bitmap.width().max(bitmap.height()) as f64 / original.0.max(original.1) as f64;
    let mut layers = PreviewLayers::default();
    if let Some((asset, placement, decoded)) = image {
        let width = original.0.min(original.1) as f64 * placement.width_ratio;
        let height = width * asset.height as f64 / asset.width as f64;
        let resolved = resolve_placement(original, width, height, placement)?;
        layers.image = Some(resolved.rect);
        render::draw_watermark(bitmap, decoded, scale_placement(resolved, scale), placement.opacity, cancel)?;
    }
    if let Some((settings, layout)) = text {
        let resolved = resolve_placement(original, layout.width, layout.height, &settings.placement)?;
        layers.text = Some(resolved.rect);
        if settings.placement.opacity > 0.0 {
            let target = scale_placement(resolved, scale);
            let decoded = layout.rasterize(target.width, target.height)?;
            render::draw_watermark(bitmap, decoded, target, settings.placement.opacity, cancel)?;
        }
    }
    Ok(layers)
}

fn photo_project(photo: &ImageAsset) -> Project {
    let template = TemplateDefinition { id: "full".into(), version: 1, name: "原图".into(), category: "水印".into(),
        root: LayoutNode::Leaf { slot_id: "photo".into() }, defaults: BTreeMap::new(), slot_order: vec!["photo".into()] };
    let page = Page { id: "page".into(), name: photo.file_name.clone(), template_id: "full".into(), template_state: BTreeMap::new(), frame_rects: None,
        background_image: None, background: "#ffffff".into(), margin: Margin { top: 0.0, right: 0.0, bottom: 0.0, left: 0.0 }, column_gap: 0.0, row_gap: 0.0,
        frames: vec![Frame { id: "photo-frame".into(), slot_id: "photo".into(), image_asset_id: Some(photo.id.clone()), transform: ImageTransform::default() }], unplaced: vec![] };
    Project { schema_version: 1, engine_version: 1, id: "watermark-project".into(), name: "水印处理".into(), canvas_sizing: CanvasSizing::Fixed,
        document: DocumentSize { width: photo.width as f64, height: photo.height as f64, color_space: "srgb".into() }, pages: vec![page],
        assets: BTreeMap::from([(photo.id.clone(), photo.clone())]), templates: BTreeMap::from([("full".into(), template)]) }
}

fn write_prepared_photo(photo: &ImageAsset, options: &Options, text: Option<&TextLayout>, cancel: &AtomicBool) -> Result<PathBuf> {
    render::check_cancel(cancel)?;
    let project = photo_project(photo);
    let mut bitmap = render::render_page(&project, &project.pages[0], cancel)?;
    let image = if let Some(asset) = &options.watermark {
        let width = (photo.width.min(photo.height) as f64 * options.placement.width_ratio).ceil().min(photo.width as f64) as u32;
        let decoded = assets::decode_srgb(asset, bitmap.as_raw().len() as u64, width)?;
        if decoded.dimensions() != (asset.width, asset.height) { bail!("水印尺寸发生变化，请重新选择"); }
        Some((asset, &options.placement, decoded))
    } else { None };
    render_layers(&mut bitmap, (photo.width, photo.height), image, options.text.as_ref().zip(text), cancel)?;
    let directory = Path::new(&options.directory);
    let mut temp = tempfile::NamedTempFile::new_in(directory)?;
    render::encode_rgb(&bitmap, temp.as_file_mut(), &options.format, options.quality)?;
    temp.as_file().sync_all()?;
    render::check_cancel(cancel)?;
    let name = Path::new(&photo.file_name).file_stem().unwrap_or_default().to_string_lossy();
    storage::commit_export(temp, directory, &format!("{}-水印", storage::safe_prefix(&name)), &options.format)
}

#[cfg(test)]
pub(crate) fn write_photo(photo: &ImageAsset, options: &Options, cancel: &AtomicBool) -> Result<PathBuf> {
    let text = options.text.as_ref().map(TextLayout::new).transpose()?;
    write_prepared_photo(photo, options, text.as_ref(), cancel)
}

pub(crate) fn run_batch(options: &Options, cancel: &AtomicBool, progress: &mut ExportProgress, image_gate: &Mutex<()>, mut update: impl FnMut(&ExportProgress)) -> Result<()> {
    render::check_cancel(cancel)?;
    let text = options.text.as_ref().map(TextLayout::new).transpose()?;
    for photo in &options.assets {
        render::check_cancel(cancel)?;
        progress.page_name = photo.file_name.clone(); update(progress);
        let result = {
            let _gate = image_gate.lock().unwrap_or_else(|e| e.into_inner());
            write_prepared_photo(photo, options, text.as_ref(), cancel)
        };
        match result {
            Ok(path) => progress.paths.push(path.to_string_lossy().to_string()),
            Err(error) => { render::check_cancel(cancel)?; progress.errors.push(format!("{}：{error:#}", photo.file_name)); }
        }
        progress.completed += 1; update(progress);
    }
    Ok(())
}
