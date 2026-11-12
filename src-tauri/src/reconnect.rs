//! Bounded, authorized source discovery. Never guesses by a filename alone.
use crate::{assets, service::Service};
use anyhow::{bail, Context, Result};
use collage_core::ImageAsset;
use serde::{Deserialize, Serialize};
use std::{collections::{BTreeMap, BTreeSet, VecDeque}, fs, io::Write, path::{Component, Path, PathBuf}, sync::Mutex, time::{Duration, Instant}};
use tauri::State;

const MAX_ENTRIES: usize = 10_000;
const MAX_ROOTS: usize = 64;
#[derive(Default, Serialize, Deserialize)]
struct Roots { #[serde(default)] roots: Vec<String> }
struct Scan { signature: String, at: Instant, files: BTreeMap<String, Vec<PathBuf>>, visited: usize, truncated: bool }
pub struct ReconnectService { directory: PathBuf, gate: Mutex<()>, scans: Mutex<BTreeMap<String, Scan>> }
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Connection { pub asset_id: String, pub status: String, pub candidates: Vec<String> }
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReconnectReport { pub assets: Vec<ImageAsset>, pub connections: Vec<Connection>, pub scanned: usize, pub truncated: bool }

impl ReconnectService {
    pub fn new(data: &Path) -> Result<Self> {
        let directory = data.join("asset-roots-v2"); fs::create_dir_all(&directory)?;
        Ok(Self { directory, gate: Mutex::new(()), scans: Mutex::new(BTreeMap::new()) })
    }
    fn roots_path(&self, project: &str) -> PathBuf { self.directory.join(format!("{}.json", blake3::hash(project.as_bytes()).to_hex())) }
    fn read_roots(&self, project: &str) -> Result<Roots> {
        let path = self.roots_path(project);
        if !path.exists() { return Ok(Roots::default()); }
        if fs::metadata(&path)?.len() > 1024 * 1024 { bail!("素材目录记录过大"); }
        serde_json::from_slice(&fs::read(path)?).context("素材目录记录损坏，请重新指定素材文件夹")
    }
    pub fn authorize(&self, project: &str, path: &Path) -> Result<()> {
        let path = path.canonicalize().context("素材文件夹不可访问，请检查磁盘连接或重新选择文件夹授权")?;
        if !path.is_dir() || !scan_root_allowed(&path) { bail!("请选择具体素材文件夹，不要选择整台电脑或磁盘总目录"); }
        let _guard = self.gate.lock().unwrap_or_else(|e| e.into_inner());
        let mut roots = self.read_roots(project)?;
        let value = path.to_string_lossy().to_string();
        roots.roots.retain(|p| p != &value); roots.roots.insert(0, value); roots.roots.truncate(MAX_ROOTS);
        let mut temp = tempfile::NamedTempFile::new_in(&self.directory)?;
        temp.write_all(&serde_json::to_vec(&roots)?)?; temp.as_file().sync_all()?;
        temp.persist(self.roots_path(project)).map_err(|e| e.error)?;
        self.scans.lock().unwrap_or_else(|e| e.into_inner()).remove(project);
        Ok(())
    }
    pub fn check(&self, project: &str, snapshots: &[ImageAsset], force: bool) -> Result<ReconnectReport> {
        if snapshots.len() > 20_000 || project.len() > 256 { bail!("素材检查数量或项目ID无效"); }
        let mut result = ReconnectReport::default();
        let mut missing = vec![];
        let stored = self.read_roots(project)?;
        let mut roots: Vec<PathBuf> = stored.roots.iter().map(PathBuf::from).collect();
        for asset in snapshots {
            if fs::File::open(&asset.original_path).is_ok() && Path::new(&asset.original_path).is_file() {
                result.connections.push(Connection { asset_id: asset.id.clone(), status: "connected".into(), candidates: vec![] });
            } else { missing.push(asset); }
            if let Some(root) = &asset.source_root { roots.push(PathBuf::from(root)); }
            else if let Some(root) = Path::new(&asset.original_path).parent() { roots.push(root.to_owned()); }
            roots.extend(asset.previous_roots.iter().map(PathBuf::from));
        }
        if missing.is_empty() { return Ok(result); }
        let mut seen = BTreeSet::new(); roots.retain(|p| seen.insert(p.clone())); roots.truncate(MAX_ROOTS);
        let signature = format!("{}:{}", roots.iter().map(|p| p.to_string_lossy()).collect::<Vec<_>>().join("|"), volume_signature());
        let mut scans = self.scans.lock().unwrap_or_else(|e| e.into_inner());
        if force || scans.get(project).is_none_or(|s| s.signature != signature || s.at.elapsed() >= Duration::from_secs(30)) {
            let (files, visited, truncated) = scan_files(&roots);
            if scans.len() >= 32 { scans.clear(); }
            scans.insert(project.into(), Scan { signature, at: Instant::now(), files, visited, truncated });
        }
        let scan = &scans[project]; result.scanned = scan.visited; result.truncated = scan.truncated;
        for asset in missing {
            let mut candidates = vec![];
            // Direct relative lookups retain priority and do not require recursion.
            let relative = asset.relative_path.as_deref().unwrap_or(&asset.file_name);
            if safe_relative(Path::new(relative)) { for root in &roots { candidates.push(root.join(relative)); } }
            if let Some(found) = scan.files.get(&asset.file_name) { candidates.extend(found.iter().cloned()); }
            let mut paths = BTreeSet::new();
            let mut trusted = vec![];
            for candidate in candidates {
                let Ok(path) = candidate.canonicalize() else { continue; };
                if !paths.insert(path.clone()) || path == Path::new(&asset.original_path) { continue; }
                // Candidate may be a symlink only on a specifically identified relative path;
                // it still must stay in an already authorized source root.
                if !roots.iter().filter_map(|r| r.canonicalize().ok()).any(|root| path.starts_with(root)) { continue; }
                if let Some(expected) = asset.file_size { if fs::metadata(&path).map(|m| m.len()).ok() != Some(expected) { continue; } }
                if let Ok(inspected) = assets::inspect(&path, Some(asset.id.clone())) {
                    if inspected.fingerprint == asset.fingerprint && inspected.width == asset.width && inspected.height == asset.height {
                        trusted.push(assets::inherit_location(inspected, asset));
                    }
                }
            }
            let status = if trusted.len() == 1 { result.assets.push(trusted.pop().unwrap()); "connected" }
                else if trusted.len() > 1 { "ambiguous" } else { "missing" };
            result.connections.push(Connection { asset_id: asset.id.clone(), status: status.into(), candidates: trusted.into_iter().map(|a| a.original_path).collect() });
        }
        Ok(result)
    }
}
fn safe_relative(path: &Path) -> bool { !path.as_os_str().is_empty() && path.components().all(|c| matches!(c, Component::Normal(_))) }
fn scan_root_allowed(path: &Path) -> bool { path.is_absolute() && path.components().count() > 2 && path != Path::new("/Users") && path != Path::new("/Volumes") }
fn volume_signature() -> String {
    let names: BTreeSet<_> = fs::read_dir("/Volumes").into_iter().flatten().filter_map(|e| e.ok()).map(|e| e.file_name()).collect();
    format!("{:?}", names)
}
fn scan_files(roots: &[PathBuf]) -> (BTreeMap<String, Vec<PathBuf>>, usize, bool) {
    let mut queue: VecDeque<_> = roots.iter().filter(|p| scan_root_allowed(p)).map(|p| (p.clone(), 0)).collect();
    let mut directories = BTreeSet::new(); let mut files: BTreeMap<String, Vec<PathBuf>> = BTreeMap::new(); let mut visited = 0;
    let started = Instant::now();
    while let Some((directory, depth)) = queue.pop_front() {
        if visited >= MAX_ENTRIES || started.elapsed() > Duration::from_secs(3) { return (files, visited, true); }
        let Ok(canonical) = directory.canonicalize() else { continue; };
        if !directories.insert(canonical) { continue; }
        let Ok(entries) = fs::read_dir(directory) else { continue; };
        for entry in entries.flatten() {
            visited += 1;
            if visited >= MAX_ENTRIES || started.elapsed() > Duration::from_secs(3) { return (files, visited, true); }
            let Ok(kind) = entry.file_type() else { continue; };
            if kind.is_symlink() { continue; }
            if kind.is_dir() && depth < 6 { queue.push_back((entry.path(), depth + 1)); }
            else if kind.is_file() {
                let name = entry.file_name().to_string_lossy().to_string();
                let ext = entry.path().extension().unwrap_or_default().to_string_lossy().to_ascii_lowercase();
                if matches!(ext.as_str(), "png" | "jpg" | "jpeg") { files.entry(name).or_default().push(entry.path()); }
            }
        }
    }
    (files, visited, false)
}

#[tauri::command]
pub async fn authorize_asset_root(project_id: String, path: String, registry: State<'_, std::sync::Arc<ReconnectService>>) -> Result<(), String> {
    let registry = registry.inner().clone();
    tauri::async_runtime::spawn_blocking(move || registry.authorize(&project_id, Path::new(&path)).map_err(|e| format!("{e:#}"))).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn reconnect_assets(project_id: String, assets: Vec<ImageAsset>, force: bool, registry: State<'_, std::sync::Arc<ReconnectService>>, service: State<'_, Service>, app: tauri::AppHandle) -> Result<ReconnectReport, String> {
    let registry = registry.inner().clone(); let shared = service.shared.clone();
    let output = tauri::async_runtime::spawn_blocking(move || {
        for asset in &assets { shared.authorized_asset(&asset.id, Some(asset)).map_err(|e| format!("{e:#}"))?; }
        let report = registry.check(&project_id, &assets, force).map_err(|e| format!("{e:#}"))?;
        for asset in &report.assets { shared.register_asset(asset.clone()); }
        Ok(report)
    }).await.map_err(|e| e.to_string())?;
    // Explicit rescans are logged once, never every background polling tick.
    if force {
        use tauri::Manager;
        if let Some(log) = app.try_state::<crate::diagnostics::DiagnosticLog>() {
            let outcome = match &output {
                Ok(report) if report.connections.iter().any(|c| c.status != "connected") => crate::diagnostics::Outcome::MissingSource,
                Ok(_) => crate::diagnostics::Outcome::Ok,
                Err(_) => crate::diagnostics::Outcome::IoFailure,
            };
            let _ = log.record(crate::diagnostics::Stage::AssetScan, outcome);
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};
    fn image(path: &Path, color: u8) -> ImageAsset { RgbImage::from_pixel(12, 18, Rgb([color, 30, 80])).save(path).unwrap(); assets::inspect(path, Some("photo".into())).unwrap() }
    #[test] fn source_move_reconnects_only_identical_bytes_and_keeps_initial_identity() {
        let dir = tempfile::tempdir().unwrap(); let old = dir.path().join("old"); let new = dir.path().join("new"); fs::create_dir_all(&old).unwrap(); fs::create_dir_all(&new).unwrap();
        let before = image(&old.join("same.png"), 12); fs::rename(old.join("same.png"), new.join("same.png")).unwrap();
        let registry = ReconnectService::new(&dir.path().join("data")).unwrap(); registry.authorize("project", &new).unwrap();
        let result = registry.check("project", &[before.clone()], true).unwrap(); assert_eq!(result.assets.len(), 1); assert_eq!(result.assets[0].fingerprint, before.fingerprint); assert_eq!(result.assets[0].initial_path, before.initial_path);
        assert_eq!(result.connections[0].status, "connected");
    }
    #[test] fn same_filename_different_pixels_never_reconnects() {
        let dir = tempfile::tempdir().unwrap(); let old = dir.path().join("old"); let new = dir.path().join("new"); fs::create_dir_all(&old).unwrap(); fs::create_dir_all(&new).unwrap();
        let asset = image(&old.join("same.png"), 12); fs::remove_file(old.join("same.png")).unwrap(); image(&new.join("same.png"), 220);
        let registry = ReconnectService::new(&dir.path().join("data")).unwrap(); registry.authorize("p", &new).unwrap();
        let result = registry.check("p", &[asset], true).unwrap(); assert!(result.assets.is_empty()); assert_eq!(result.connections[0].status, "missing");
    }
    #[test] fn multiple_identical_candidates_require_selection_and_roots_survive_restart() {
        let dir = tempfile::tempdir().unwrap(); let original = dir.path().join("same.png"); let asset = image(&original, 10); let root = dir.path().join("allowed");
        for sub in ["a", "b"] { fs::create_dir_all(root.join(sub)).unwrap(); fs::copy(&original, root.join(sub).join("same.png")).unwrap(); } fs::remove_file(original).unwrap();
        let data = dir.path().join("data"); ReconnectService::new(&data).unwrap().authorize("p", &root).unwrap();
        let result = ReconnectService::new(&data).unwrap().check("p", &[asset], true).unwrap(); assert!(result.assets.is_empty()); assert_eq!(result.connections[0].status, "ambiguous"); assert_eq!(result.connections[0].candidates.len(), 2);
    }
    #[test] fn remounted_original_is_detected_without_reopening_or_scanning() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("same.png"); let asset = image(&path, 10); let held = dir.path().join("held"); fs::rename(&path, &held).unwrap();
        let registry = ReconnectService::new(&dir.path().join("data")).unwrap(); assert_eq!(registry.check("p", &[asset.clone()], true).unwrap().connections[0].status, "missing");
        fs::rename(&held, &path).unwrap(); let result = registry.check("p", &[asset], false).unwrap(); assert_eq!(result.connections[0].status, "connected"); assert_eq!(result.scanned, 0);
    }
    #[test] fn scan_is_bounded_and_never_follows_symlink_directories() {
        let dir = tempfile::tempdir().unwrap(); let root = dir.path().join("allowed"); fs::create_dir(&root).unwrap();
        #[cfg(unix)] std::os::unix::fs::symlink(dir.path(), root.join("loop")).unwrap();
        let (_, visited, truncated) = scan_files(&[root]); assert!(visited < 10); assert!(!truncated);
        assert!(!safe_relative(Path::new("../escape.png"))); assert!(!safe_relative(Path::new("/absolute.png"))); assert!(!scan_root_allowed(Path::new("/Volumes")));
    }
}
