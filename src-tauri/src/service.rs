use crate::{assets, render, storage};
use anyhow::{bail, Context, Result};
use collage_core::{validate_project, ExportOptions, ExportProgress, ImageAsset, Page, Project};
use std::{collections::{BTreeMap, BTreeSet}, fs, path::{Path, PathBuf}, sync::{atomic::{AtomicBool, Ordering}, mpsc::{self, SyncSender}, Arc, Mutex, RwLock}, time::SystemTime};
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

struct Job {
    project: Project,
    options: ExportOptions,
    progress: ExportProgress,
    cancel: Arc<AtomicBool>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FileStamp {
    modified: SystemTime,
    bytes: u64,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
}

impl FileStamp {
    pub(crate) fn read(path: &Path) -> Result<Self> {
        let metadata = fs::metadata(path)?;
        if !metadata.is_file() { bail!("照片路径不是普通文件"); }
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;
        Ok(Self {
            modified: metadata.modified()?, bytes: metadata.len(),
            #[cfg(unix)] device: metadata.dev(),
            #[cfg(unix)] inode: metadata.ino(),
        })
    }
}

#[derive(Clone)]
struct AssetFileState {
    asset: ImageAsset,
    stamp: Option<FileStamp>,
    failed_attempts: u8,
}

#[derive(serde::Serialize)]
pub struct RefreshResult {
    pub assets: Vec<ImageAsset>,
    pub errors: Vec<String>,
}

pub struct Shared {
    /// Explicit import/open/relink authorizes a metadata snapshot. Keep older
    /// snapshots so document undo can still use the corresponding original.
    pub assets: RwLock<BTreeMap<String, Vec<ImageAsset>>>,
    files: Mutex<BTreeMap<(String, String), AssetFileState>>,
    /// All large native bitmap allocations share this gate, including proxies and exports.
    pub image_gate: Mutex<()>,
    jobs: Mutex<BTreeMap<String, Arc<AtomicBool>>>,
    progress: Mutex<BTreeMap<String, ExportProgress>>,
    pub cache: PathBuf,
}

pub struct Service {
    pub shared: Arc<Shared>,
    pub watermarks: Arc<crate::watermark::WatermarkService>,
    sender: SyncSender<Job>,
    app: AppHandle,
}

impl Service {
    pub fn new(app: AppHandle) -> Result<Self> {
        let cache = app.path().app_cache_dir()?.join("proxies");
        fs::create_dir_all(&cache)?;
        let shared = Arc::new(Shared {
            assets: RwLock::new(BTreeMap::new()), files: Mutex::new(BTreeMap::new()), image_gate: Mutex::new(()),
            jobs: Mutex::new(BTreeMap::new()), progress: Mutex::new(BTreeMap::new()), cache,
        });
        let (sender, receiver) = mpsc::sync_channel::<Job>(8);
        let worker_shared = shared.clone();
        let worker_app = app.clone();
        std::thread::Builder::new().name("collage-export".into()).spawn(move || {
            // One FIFO worker: 50 pages never create 50 simultaneous full-size buffers.
            while let Ok(job) = receiver.recv() {
                let mut progress = job.progress;
                let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    export_job(&worker_shared, &worker_app, &job.project, &job.options, &job.cancel, &mut progress)
                }));
                match outcome {
                    Err(_) => { progress.errors.push("图像任务异常退出，本次未完成页面没有写入".into()); progress.state = "failed".into(); }
                    Ok(Err(error)) if !job.cancel.load(Ordering::Relaxed) => { progress.errors.push(format!("{error:#}")); progress.state = "failed".into(); }
                    _ => {
                        progress.state = if job.cancel.load(Ordering::Relaxed) { "cancelled" } else if progress.paths.is_empty() && !progress.errors.is_empty() { "failed" } else { "completed" }.into();
                    }
                }
                publish(&worker_shared, &worker_app, &progress);
                worker_shared.jobs.lock().unwrap_or_else(|e| e.into_inner()).remove(&progress.job_id);
            }
        })?;
        let watermarks = Arc::new(crate::watermark::WatermarkService::new(shared.clone(), app.clone())?);
        Ok(Self { shared, sender, app, watermarks })
    }

    pub fn start(&self, project: Project, options: ExportOptions) -> Result<String> {
        validate_project(&project)?;
        if !matches!(options.format.as_str(), "jpg" | "png") || !(1..=100).contains(&options.quality) { bail!("导出格式或品质无效"); }
        if options.page_ids.is_empty() || options.page_ids.len() > 1000 { bail!("请选择要导出的页面"); }
        let ids: BTreeSet<_> = options.page_ids.iter().collect();
        if ids.len() != options.page_ids.len() || ids.iter().any(|id| !project.pages.iter().any(|page| &page.id == *id)) { bail!("导出页面选择无效"); }
        let directory = Path::new(&options.directory).canonicalize().context("导出文件夹不存在或无法访问")?;
        if !directory.is_dir() { bail!("请选择导出文件夹"); }
        // Validate authorization without replacing the immutable document's
        // assets with the newest relink. Undo may legitimately reference an
        // older authorized original. Rendering still checks its fingerprint.
        self.shared.authorize_export(&project, &ids)?;
        let job_id = Uuid::new_v4().to_string();
        let progress = ExportProgress {
            job_id: job_id.clone(), completed: 0, total: options.page_ids.len(),
            page_name: "等待导出".into(), state: "running".into(), errors: vec![], paths: vec![],
        };
        let cancel = Arc::new(AtomicBool::new(false));
        self.shared.jobs.lock().unwrap_or_else(|e| e.into_inner()).insert(job_id.clone(), cancel.clone());
        publish(&self.shared, &self.app, &progress);
        let mut options = options;
        options.directory = directory.to_string_lossy().to_string();
        if self.sender.try_send(Job { project, options, progress, cancel }).is_err() {
            self.shared.jobs.lock().unwrap_or_else(|e| e.into_inner()).remove(&job_id);
            self.shared.progress.lock().unwrap_or_else(|e| e.into_inner()).remove(&job_id);
            bail!("导出队列已满，请等待当前任务完成");
        }
        Ok(job_id)
    }

    pub fn cancel(&self, job_id: &str) -> Result<()> {
        if let Some(cancel) = self.shared.jobs.lock().unwrap_or_else(|e| e.into_inner()).get(job_id) {
            cancel.store(true, Ordering::Relaxed);
        } else { return Ok(()); }
        if let Some(mut progress) = self.status(job_id) {
            progress.state = "cancelling".into();
            publish(&self.shared, &self.app, &progress);
        }
        Ok(())
    }

    pub fn status(&self, job_id: &str) -> Option<ExportProgress> {
        self.shared.progress.lock().unwrap_or_else(|e| e.into_inner()).get(job_id).cloned()
    }
}

fn publish(shared: &Shared, app: &AppHandle, progress: &ExportProgress) {
    let mut known = shared.progress.lock().unwrap_or_else(|e| e.into_inner());
    if known.len() >= 100 && !known.contains_key(&progress.job_id) {
        if let Some(id) = known.iter().find(|(_, p)| matches!(p.state.as_str(), "completed" | "cancelled" | "failed")).map(|(id, _)| id.clone()) { known.remove(&id); }
    }
    known.insert(progress.job_id.clone(), progress.clone());
    drop(known);
    let _ = app.emit("export-progress", progress);
}

fn export_job(shared: &Shared, app: &AppHandle, project: &Project, options: &ExportOptions, cancel: &AtomicBool, progress: &mut ExportProgress) -> Result<()> {
    let selected: BTreeSet<_> = options.page_ids.iter().collect();
    let prefix = storage::safe_prefix(&options.prefix);
    for (index, page) in project.pages.iter().enumerate() {
        if !selected.contains(&page.id) { continue; }
        render::check_cancel(cancel)?;
        progress.page_name = page.name.clone();
        publish(shared, app, progress);
        let page_result: Result<PathBuf> = (|| {
            let _gate = shared.image_gate.lock().unwrap_or_else(|e| e.into_inner());
            write_page(project, page, options, &format!("{prefix}-{:02}", index + 1), cancel)
        })();
        // Record committed pages even if cancellation arrives directly after the rename.
        // The user must always see every file this job actually produced.
        match page_result {
            Ok(path) => progress.paths.push(path.to_string_lossy().to_string()),
            Err(error) => {
                render::check_cancel(cancel)?;
                progress.errors.push(format!("第 {} 页「{}」：{error:#}", index + 1, page.name));
            }
        }
        progress.completed += 1;
        publish(shared, app, progress);
    }
    Ok(())
}

/// One page is invisible until it is fully encoded, synced, and cancellation checked.
pub(crate) fn write_page(project: &Project, page: &Page, options: &ExportOptions, stem: &str, cancel: &AtomicBool) -> Result<PathBuf> {
    render::check_cancel(cancel)?;
    let bitmap = render::render_page(project, page, cancel)?;
    let directory = Path::new(&options.directory);
    let mut temp = tempfile::NamedTempFile::new_in(directory)?;
    render::encode_rgb(&bitmap, temp.as_file_mut(), &options.format, options.quality)?;
    temp.as_file().sync_all()?;
    render::check_cancel(cancel)?;
    storage::commit_export(temp, directory, stem, &options.format)
}

impl Shared {
    pub fn register_asset(&self, asset: ImageAsset) {
        let file_state = AssetFileState {
            asset: asset.clone(),
            stamp: FileStamp::read(Path::new(&asset.original_path)).ok(), failed_attempts: 0,
        };
        let key = (asset.id.clone(), asset.original_path.clone());
        let mut registered = self.assets.write().unwrap_or_else(|e| e.into_inner());
        let versions = registered.entry(asset.id.clone()).or_default();
        if let Some(index) = versions.iter().position(|known| known == &asset) { versions.remove(index); }
        versions.push(asset);
        drop(registered);
        self.files.lock().unwrap_or_else(|e| e.into_inner()).insert(key, file_state);
    }

    pub(crate) fn authorized_asset(&self, asset_id: &str, snapshot: Option<&ImageAsset>) -> Result<ImageAsset> {
        let registered = self.assets.read().unwrap_or_else(|e| e.into_inner());
        let versions = registered.get(asset_id).context("照片尚未登记，请重新打开项目或导入照片")?;
        match snapshot {
            Some(asset) if asset.id == asset_id && versions.contains(asset) => Ok(asset.clone()),
            Some(_) => bail!("照片版本尚未授权，请重新打开项目或重新链接原图"),
            None => versions.last().cloned().context("照片尚未登记"),
        }
    }

    fn authorize_export(&self, project: &Project, ids: &BTreeSet<&String>) -> Result<()> {
        for page in &project.pages {
            if !ids.contains(&page.id) { continue; }
            let images = page.background_image.iter().map(|image| &image.image_asset_id)
                .chain(page.frames.iter().filter_map(|frame| frame.image_asset_id.as_ref()));
            for id in images {
                let asset = project.assets.get(id).context("项目缺少照片记录")?;
                self.authorized_asset(id, Some(asset))?;
            }
        }
        Ok(())
    }

    pub fn register(&self, project: &Project) -> Result<Vec<String>> {
        validate_project(project)?;
        let mut missing = vec![];
        for asset in project.assets.values() {
            let current = assets::inspect(Path::new(&asset.original_path), Some(asset.id.clone()));
            let matches_saved = matches!(&current,
                Ok(inspected) if inspected.fingerprint == asset.fingerprint && inspected.width == asset.width && inspected.height == asset.height);
            if !matches_saved {
                missing.push(asset.id.clone());
            }
            // Opening a project explicitly authorizes its paths, including
            // unavailable originals that may be restored at the same path.
            self.register_asset(asset.clone());
            if !matches_saved {
                if let Some(file) = self.files.lock().unwrap_or_else(|e| e.into_inner()).get_mut(&(asset.id.clone(), asset.original_path.clone())) {
                    // The saved snapshot lacks a stat baseline. Re-inspect on
                    // the first poll even when the file predates this open.
                    file.stamp = None;
                }
            }
        }
        Ok(missing)
    }

    /// Opening the editor must not hash every full-resolution original first.
    /// Proxy/refresh/export still verify contents on their background workers.
    pub fn register_quick(&self, project: &Project) -> Result<Vec<String>> {
        validate_project(project)?;
        let mut missing = vec![];
        for asset in project.assets.values() {
            if !Path::new(&asset.original_path).is_file() { missing.push(asset.id.clone()); }
            self.register_asset(asset.clone());
            // The first asynchronous refresh also detects edits made while closed.
            if let Some(file) = self.files.lock().unwrap_or_else(|e| e.into_inner()).get_mut(&(asset.id.clone(), asset.original_path.clone())) { file.stamp = None; }
        }
        Ok(missing)
    }

    pub(crate) fn photoshop_path(&self, asset_id: &str, snapshot: Option<&ImageAsset>) -> Result<PathBuf> {
        let asset = self.authorized_asset(asset_id, snapshot)?;
        let path = Path::new(&asset.original_path).canonicalize()
            .with_context(|| format!("找不到照片原图：{}", asset.file_name))?;
        if !path.is_file() { bail!("照片原图不是普通文件：{}", asset.file_name); }
        Ok(path)
    }

    pub fn open_in_photoshop(&self, asset_id: &str, snapshot: Option<&ImageAsset>) -> Result<()> {
        let path = self.photoshop_path(asset_id, snapshot)?;
        // Pass only an explicitly registered asset's canonical path as an
        // argument. No shell, arbitrary frontend path, or guessed application.
        let outcome = std::process::Command::new("/usr/bin/open")
            .args(["-b", "com.adobe.Photoshop"]).arg(path).output()
            .context("无法打开 Photoshop，请确认已安装 Photoshop")?;
        if !outcome.status.success() {
            bail!("无法使用 Photoshop 打开照片，请确认已安装 Photoshop，并可正常启动");
        }
        Ok(())
    }

    fn refresh_failure(&self, asset: &ImageAsset, error: &anyhow::Error, result: &mut RefreshResult) {
        let mut files = self.files.lock().unwrap_or_else(|e| e.into_inner());
        let file = files.entry((asset.id.clone(), asset.original_path.clone())).or_insert_with(|| AssetFileState {
            asset: asset.clone(), stamp: None, failed_attempts: 0,
        });
        file.failed_attempts = file.failed_attempts.saturating_add(1);
        // Photoshop commonly saves by replacing the original. Missing or
        // incomplete intermediate files are retried before showing an error.
        if file.failed_attempts >= 3 {
            result.errors.push(format!("「{}」暂时无法同步：{error:#}。保留当前照片并继续重试", asset.file_name));
        }
    }

    pub fn refresh(&self, snapshots: &[ImageAsset]) -> Result<RefreshResult> {
        if snapshots.len() > 1000 { bail!("单次最多同步 1000 张照片"); }
        let mut result = RefreshResult { assets: vec![], errors: vec![] };
        let mut seen = BTreeSet::new();
        for snapshot in snapshots {
            if !seen.insert(snapshot.id.clone()) { continue; }
            let id = &snapshot.id;
            let asset = match self.authorized_asset(id, Some(snapshot)) {
                Ok(asset) => asset,
                Err(error) => { result.errors.push(format!("{error:#}")); continue; }
            };
            let path = Path::new(&asset.original_path);
            let before = match FileStamp::read(path) {
                Ok(stamp) => stamp,
                Err(error) => { self.refresh_failure(&asset, &error, &mut result); continue; }
            };
            let key = (asset.id.clone(), asset.original_path.clone());
            let cached = {
                let mut files = self.files.lock().unwrap_or_else(|e| e.into_inner());
                let file = files.entry(key.clone()).or_insert_with(|| AssetFileState {
                    asset: asset.clone(), stamp: None, failed_attempts: 0,
                });
                let matches = file.stamp.as_ref() == Some(&before);
                if matches { file.failed_attempts = 0; }
                matches.then(|| file.asset.clone())
            };
            if let Some(cached) = cached {
                // A previous poll may already have authorized the file update,
                // while this caller still holds the old document snapshot.
                // Return the metadata belonging to this path's stable stat;
                // another explicitly relinked path must not replace it.
                if cached != asset { result.assets.push(cached); }
                continue;
            }
            let inspected = match assets::inspect(path, Some(asset.id.clone())) {
                Ok(inspected) => assets::inherit_location(inspected, &asset),
                Err(error) => { self.refresh_failure(&asset, &error, &mut result); continue; }
            };
            // Do not publish mixed metadata while a save is still in flight.
            // Keep the old baseline so the next poll can retry the stable file.
            if FileStamp::read(path).ok().as_ref() != Some(&before) { continue; }
            let updated = {
                let mut registered = self.assets.write().unwrap_or_else(|e| e.into_inner());
                let Some(versions) = registered.get_mut(id) else { continue; };
                if !versions.contains(&asset) { continue; }
                let changed = inspected != asset;
                if changed {
                    let latest_uses_this_path = versions.last().is_some_and(|known| known.original_path == asset.original_path);
                    if let Some(index) = versions.iter().position(|known| known == &inspected) { versions.remove(index); }
                    if latest_uses_this_path {
                        versions.push(inspected.clone());
                    } else {
                        // Authorize the old path being watched after undo,
                        // retaining the separately relinked default snapshot.
                        versions.insert(versions.len().saturating_sub(1), inspected.clone());
                    }
                }
                changed
            };
            self.files.lock().unwrap_or_else(|e| e.into_inner()).insert(key, AssetFileState {
                asset: inspected.clone(), stamp: Some(before), failed_attempts: 0,
            });
            if updated { result.assets.push(inspected); }
        }
        Ok(result)
    }

    pub fn proxy(&self, asset_id: &str, max_size: u32, snapshot: Option<&ImageAsset>) -> Result<String> {
        if !matches!(max_size, 256 | 512 | 1024 | 2048 | 4096) { bail!("预览尺寸不支持"); }
        let asset = self.authorized_asset(asset_id, snapshot)?;
        let key = blake3::hash(format!("linear16-srgb-v1:{}:{}:{max_size}", asset.fingerprint, asset.orientation).as_bytes()).to_hex();
        let destination = self.cache.join(format!("{key}.png"));
        let _gate = self.image_gate.lock().unwrap_or_else(|e| e.into_inner());
        // Offline previews are useful, but never stand in for originals at export.
        // Prefer the requested proxy, then any already-cached resolution.
        if !Path::new(&asset.original_path).is_file() {
            for size in [max_size, 1024, 512, 256, 2048, 4096] {
                let hash = blake3::hash(format!("linear16-srgb-v1:{}:{}:{size}", asset.fingerprint, asset.orientation).as_bytes()).to_hex();
                let cached = self.cache.join(format!("{hash}.png"));
                if cached.is_file() { return Ok(cached.to_string_lossy().to_string()); }
            }
            bail!("原图未连接，且没有缓存预览：{}", asset.file_name);
        }
        if assets::fingerprint(Path::new(&asset.original_path))? != asset.fingerprint { bail!("原图已修改，请重新链接：{}", asset.file_name); }
        if destination.is_file() { return Ok(destination.to_string_lossy().to_string()); }
        let image = render::make_proxy(&asset, max_size)?;
        let mut temp = tempfile::NamedTempFile::new_in(&self.cache)?;
        render::encode_proxy(&image, temp.as_file_mut())?;
        temp.as_file().sync_all()?;
        temp.persist(&destination).map_err(|e| e.error)?;
        self.trim_cache(&destination);
        Ok(destination.to_string_lossy().to_string())
    }

    fn trim_cache(&self, preserve: &Path) {
        const DISK_BUDGET: u64 = 2 * 1024 * 1024 * 1024;
        let Ok(entries) = fs::read_dir(&self.cache) else { return; };
        let mut files: Vec<_> = entries.filter_map(|e| e.ok()).filter_map(|entry| {
            let path = entry.path();
            let meta = fs::symlink_metadata(&path).ok()?;
            if !meta.is_file() || path.extension()?.to_str()? != "png" { return None; }
            Some((path, meta.len(), meta.modified().unwrap_or(SystemTime::UNIX_EPOCH)))
        }).collect();
        let mut size: u64 = files.iter().map(|(_, bytes, _)| bytes).sum();
        files.sort_by_key(|(_, _, modified)| *modified);
        for (path, bytes, _) in files {
            if size <= DISK_BUDGET { break; }
            if path != preserve && fs::remove_file(path).is_ok() { size = size.saturating_sub(bytes); }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::integration_tests::{options, project_with_photo};
    use image::{Rgb, RgbImage};

    fn shared(cache: PathBuf) -> Shared {
        fs::create_dir_all(&cache).unwrap();
        Shared { assets: RwLock::new(BTreeMap::new()), files: Mutex::new(BTreeMap::new()), image_gate: Mutex::new(()),
            jobs: Mutex::new(BTreeMap::new()), progress: Mutex::new(BTreeMap::new()), cache }
    }

    #[test]
    fn offline_cached_preview_survives_and_export_still_requires_the_original() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("offline.png");
        RgbImage::from_pixel(120, 180, Rgb([80, 20, 10])).save(&path).unwrap();
        let project = project_with_photo(&path, 120, 180); let asset = project.assets["source"].clone();
        let registry = shared(dir.path().join("cache")); registry.register(&project).unwrap();
        let preview = registry.proxy(&asset.id, 512, Some(&asset)).unwrap();
        fs::remove_file(&path).unwrap();
        assert_eq!(registry.proxy(&asset.id, 2048, Some(&asset)).unwrap(), preview);
        assert!(render::render_page(&project, &project.pages[0], &AtomicBool::new(false)).is_err());
        assert_eq!(registry.register_quick(&project).unwrap(), vec![asset.id]);
    }

    #[test]
    fn relink_undo_uses_the_authorized_document_snapshot_for_proxy_and_export() {
        let dir = tempfile::tempdir().unwrap();
        let old_path = dir.path().join("old.png");
        let new_path = dir.path().join("new.png");
        RgbImage::from_pixel(120, 180, Rgb([210, 30, 20])).save(&old_path).unwrap();
        RgbImage::from_pixel(120, 180, Rgb([20, 30, 210])).save(&new_path).unwrap();
        let old_project = project_with_photo(&old_path, 120, 180);
        let old_asset = old_project.assets["source"].clone();
        let registry = shared(dir.path().join("cache"));
        assert!(registry.register(&old_project).unwrap().is_empty());
        let new_asset = assets::inspect(&new_path, Some(old_asset.id.clone())).unwrap();
        registry.register_asset(new_asset.clone());

        // The current document has relinked, while undo restores the old one.
        let mut new_project = old_project.clone();
        new_project.assets.insert(new_asset.id.clone(), new_asset.clone());
        for (project, asset, expected, stem) in [
            (&new_project, &new_asset, [20, 30, 210], "relinked"),
            (&old_project, &old_asset, [210, 30, 20], "undone"),
        ] {
            let proxy = registry.proxy(&asset.id, 256, Some(asset)).unwrap();
            assert_eq!(image::open(proxy).unwrap().into_rgb8().get_pixel(10, 10).0, expected);
            let ids = BTreeSet::from([&project.pages[0].id]);
            registry.authorize_export(project, &ids).unwrap();
            let output = write_page(project, &project.pages[0], &options(dir.path(), "png"), stem, &AtomicBool::new(false)).unwrap();
            assert_eq!(image::open(output).unwrap().into_rgb8().get_pixel(10, 10).0, expected);
        }
        // Old clients without a snapshot still use the latest explicitly linked source.
        assert_eq!(registry.authorized_asset("source", None).unwrap(), new_asset);
    }

    #[test]
    fn asset_snapshot_cannot_redirect_an_authorized_id_to_an_unapproved_path() {
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join("original.png");
        let unapproved = dir.path().join("unapproved.png");
        RgbImage::from_pixel(120, 180, Rgb([30, 90, 180])).save(&original).unwrap();
        RgbImage::from_pixel(120, 180, Rgb([180, 90, 30])).save(&unapproved).unwrap();
        let mut project = project_with_photo(&original, 120, 180);
        let registry = shared(dir.path().join("cache"));
        registry.register(&project).unwrap();
        let substituted = assets::inspect(&unapproved, Some("source".into())).unwrap();
        assert!(registry.proxy("source", 256, Some(&substituted)).is_err());
        assert!(registry.photoshop_path("source", Some(&substituted)).is_err());
        let refresh = registry.refresh(&[substituted.clone()]).unwrap();
        assert!(refresh.assets.is_empty());
        assert_eq!(refresh.errors.len(), 1);
        project.assets.insert("source".into(), substituted);
        assert!(registry.authorize_export(&project, &BTreeSet::from([&project.pages[0].id])).is_err());
        assert_eq!(fs::read_dir(&registry.cache).unwrap().count(), 0);
    }

    #[test]
    fn background_only_assets_need_their_own_authorized_snapshot_before_export() {
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join("original.png");
        let background = dir.path().join("background.png");
        RgbImage::from_pixel(120, 180, Rgb([30, 90, 180])).save(&original).unwrap();
        RgbImage::from_pixel(180, 120, Rgb([180, 90, 30])).save(&background).unwrap();
        let mut project = project_with_photo(&original, 120, 180);
        let registry = shared(dir.path().join("cache"));
        registry.register(&project).unwrap();
        let asset = assets::inspect(&background, Some("background-source".into())).unwrap();
        project.assets.insert(asset.id.clone(), asset.clone());
        project.pages[0].frames[0].image_asset_id = None;
        project.pages[0].background_image = Some(collage_core::BackgroundImage {
            image_asset_id: asset.id.clone(), opacity: 0.0, transform: Default::default(),
        });
        let ids = BTreeSet::from([&project.pages[0].id]);
        assert!(registry.authorize_export(&project, &ids).is_err(), "an invisible background still needs authorization");
        registry.register_asset(asset.clone());
        registry.authorize_export(&project, &ids).unwrap();
        let proxy = registry.proxy(&asset.id, 256, Some(&asset)).unwrap();
        assert_eq!(image::open(proxy).unwrap().into_rgb8().get_pixel(10, 10).0, [180, 90, 30]);
        let output = write_page(&project, &project.pages[0], &options(dir.path(), "png"), "authorized-background", &AtomicBool::new(false)).unwrap();
        assert_eq!(image::open(output).unwrap().into_rgb8().get_pixel(10, 10).0, [255, 255, 255]);
        project.pages[0].background_image.as_mut().unwrap().opacity = 1.0;
        let output = write_page(&project, &project.pages[0], &options(dir.path(), "png"), "visible-background", &AtomicBool::new(false)).unwrap();
        assert_eq!(image::open(output).unwrap().into_rgb8().get_pixel(10, 10).0, [180, 90, 30]);
    }

    #[test]
    fn photoshop_refresh_detects_atomic_same_path_replacement_and_preserves_placement() {
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join("original.png");
        RgbImage::from_pixel(120, 180, Rgb([210, 30, 20])).save(&original).unwrap();
        let mut project = project_with_photo(&original, 120, 180);
        project.pages[0].frames[0].transform.zoom = 2.0;
        project.pages[0].frames[0].transform.rotation = 17.0;
        let registry = shared(dir.path().join("cache"));
        registry.register(&project).unwrap();
        let old_asset = project.assets["source"].clone();
        let old_page = project.pages[0].clone();
        let old_document = project.document.clone();
        assert!(registry.refresh(&[old_asset.clone()]).unwrap().assets.is_empty());
        let replacement = dir.path().join("photoshop-save.png");
        let mut file = fs::File::create(&replacement).unwrap();
        render::encode_rgb(&RgbImage::from_pixel(180, 120, Rgb([20, 30, 210])), &mut file, "png", 100).unwrap();
        drop(file);
        fs::rename(replacement, &original).unwrap();
        let refreshed = registry.refresh(&[old_asset.clone()]).unwrap();
        assert!(refreshed.errors.is_empty());
        assert_eq!(refreshed.assets.len(), 1);
        let updated = refreshed.assets[0].clone();
        assert_eq!(updated.id, old_asset.id);
        assert_eq!(updated.original_path, old_asset.original_path);
        assert_eq!((updated.width, updated.height), (180, 120));
        assert!(updated.icc.is_some(), "newly saved ICC metadata must be inspected");
        assert_ne!(updated.fingerprint, old_asset.fingerprint);
        assert_eq!(registry.authorized_asset("source", None).unwrap(), updated);
        assert_eq!(registry.authorized_asset("source", Some(&old_asset)).unwrap(), old_asset);
        project.assets.insert(updated.id.clone(), updated.clone());
        assert_eq!(project.pages[0], old_page);
        assert_eq!(project.document, old_document);
        registry.authorize_export(&project, &BTreeSet::from([&project.pages[0].id])).unwrap();
        let proxy = registry.proxy("source", 256, Some(&updated)).unwrap();
        assert_eq!(image::open(proxy).unwrap().into_rgb8().get_pixel(10, 10).0, [20, 30, 210]);
        let output = write_page(&project, &project.pages[0], &options(dir.path(), "png"), "synced", &AtomicBool::new(false)).unwrap();
        assert_eq!(image::open(output).unwrap().into_rgb8().get_pixel(10, 10).0, [20, 30, 210]);
        let unchanged = registry.refresh(&[updated.clone(), updated]).unwrap();
        assert!(unchanged.assets.is_empty() && unchanged.errors.is_empty());
    }

    #[test]
    fn opening_a_saved_project_with_a_changed_original_enables_first_poll_sync() {
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join("original.png");
        RgbImage::from_pixel(120, 180, Rgb([210, 30, 20])).save(&original).unwrap();
        let project = project_with_photo(&original, 120, 180);
        RgbImage::from_pixel(180, 120, Rgb([20, 30, 210])).save(&original).unwrap();
        let registry = shared(dir.path().join("cache"));
        assert_eq!(registry.register(&project).unwrap(), vec!["source"]);
        let refreshed = registry.refresh(&[project.assets["source"].clone()]).unwrap();
        assert_eq!(refreshed.assets.len(), 1);
        assert_eq!((refreshed.assets[0].width, refreshed.assets[0].height), (180, 120));
        assert!(refreshed.errors.is_empty());
    }

    #[test]
    fn photoshop_launch_and_refresh_reject_unregistered_asset_ids() {
        let dir = tempfile::tempdir().unwrap();
        let registry = shared(dir.path().join("cache"));
        // Resolve the authorized path separately so the test never launches
        // Photoshop or opens any application on the developer's computer.
        assert!(registry.photoshop_path("not-registered", None).is_err());
        let original = dir.path().join("not-registered.png");
        RgbImage::from_pixel(120, 180, Rgb([30, 90, 180])).save(&original).unwrap();
        let asset = assets::inspect(&original, Some("not-registered".into())).unwrap();
        let result = registry.refresh(&[asset]).unwrap();
        assert!(result.assets.is_empty());
        assert_eq!(result.errors.len(), 1);
    }

    #[test]
    fn photoshop_atomic_save_transients_retry_before_reporting_and_recover() {
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join("original.png");
        let temporary = dir.path().join("during-save.png");
        RgbImage::from_pixel(120, 180, Rgb([30, 90, 180])).save(&original).unwrap();
        let project = project_with_photo(&original, 120, 180);
        let registry = shared(dir.path().join("cache"));
        registry.register(&project).unwrap();
        let asset = project.assets["source"].clone();
        fs::rename(&original, &temporary).unwrap();
        for _ in 0..2 {
            let result = registry.refresh(&[asset.clone()]).unwrap();
            assert!(result.assets.is_empty() && result.errors.is_empty());
        }
        assert_eq!(registry.refresh(&[asset.clone()]).unwrap().errors.len(), 1);
        fs::rename(&temporary, &original).unwrap();
        assert!(registry.refresh(&[asset.clone()]).unwrap().errors.is_empty());
        fs::rename(&original, &temporary).unwrap();
        assert!(registry.refresh(&[asset]).unwrap().errors.is_empty(), "a successful refresh resets transient failure count");
        fs::rename(&temporary, &original).unwrap();
    }

    #[test]
    fn photoshop_watch_and_open_follow_the_authorized_path_restored_by_undo() {
        let dir = tempfile::tempdir().unwrap();
        let old_path = dir.path().join("before-relink.png");
        let new_path = dir.path().join("after-relink.png");
        RgbImage::from_pixel(120, 180, Rgb([210, 30, 20])).save(&old_path).unwrap();
        RgbImage::from_pixel(120, 180, Rgb([20, 30, 210])).save(&new_path).unwrap();
        let project = project_with_photo(&old_path, 120, 180);
        let old_asset = project.assets["source"].clone();
        let new_asset = assets::inspect(&new_path, Some("source".into())).unwrap();
        let registry = shared(dir.path().join("cache"));
        registry.register(&project).unwrap();
        registry.register_asset(new_asset.clone());
        assert_eq!(registry.photoshop_path("source", Some(&old_asset)).unwrap(), old_path.canonicalize().unwrap());
        assert_eq!(registry.photoshop_path("source", Some(&new_asset)).unwrap(), new_path.canonicalize().unwrap());
        assert!(registry.refresh(&[old_asset.clone()]).unwrap().assets.is_empty());
        let replacement = dir.path().join("photoshop-old-save.png");
        RgbImage::from_pixel(180, 120, Rgb([20, 210, 30])).save(&replacement).unwrap();
        fs::rename(replacement, &old_path).unwrap();
        let refreshed = registry.refresh(&[old_asset.clone()]).unwrap();
        assert!(refreshed.errors.is_empty());
        assert_eq!(refreshed.assets.len(), 1);
        let updated = &refreshed.assets[0];
        assert_eq!(updated.original_path, old_asset.original_path);
        assert_eq!((updated.width, updated.height), (180, 120));
        assert_eq!(registry.authorized_asset("source", None).unwrap(), new_asset, "refreshing undo's old path must not replace another explicitly linked default path");
        assert!(registry.refresh(&[new_asset]).unwrap().assets.is_empty());
        assert_eq!(registry.photoshop_path("source", Some(updated)).unwrap(), old_path.canonicalize().unwrap());
        let proxy = registry.proxy("source", 256, Some(updated)).unwrap();
        assert_eq!(image::open(proxy).unwrap().into_rgb8().get_pixel(10, 10).0, [20, 210, 30]);
    }

    #[test]
    fn unchanged_watch_stat_returns_known_update_to_a_stale_authorized_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join("original.png");
        RgbImage::from_pixel(120, 180, Rgb([210, 30, 20])).save(&original).unwrap();
        let project = project_with_photo(&original, 120, 180);
        let old_asset = project.assets["source"].clone();
        let registry = shared(dir.path().join("cache"));
        registry.register(&project).unwrap();
        let replacement = dir.path().join("saved.png");
        RgbImage::from_pixel(180, 120, Rgb([20, 210, 30])).save(&replacement).unwrap();
        fs::rename(replacement, original).unwrap();
        let first = registry.refresh(&[old_asset.clone()]).unwrap();
        assert_eq!(first.assets.len(), 1);
        let second = registry.refresh(&[old_asset]).unwrap();
        assert!(second.errors.is_empty());
        assert_eq!(second.assets, first.assets, "stable stat must not conceal an update already authorized by another poll");
        assert!(registry.refresh(&first.assets).unwrap().assets.is_empty());
    }
}
