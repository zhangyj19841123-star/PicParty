use crate::{assets, service::{RefreshResult, Service}, storage};
use collage_core::{ExportOptions, ExportProgress, ImageAsset, Project};
use serde::Serialize;
use std::path::Path;
use tauri::State;

#[derive(Serialize)]
pub struct ImportResult { assets: Vec<ImageAsset>, errors: Vec<String> }
#[derive(Serialize)]
pub struct RegisterResult { missing: Vec<String> }

#[tauri::command]
pub async fn import_assets(paths: Vec<String>, state: State<'_, Service>) -> Result<ImportResult, String> {
    if paths.len() > 1000 { return Err("单次最多导入 1000 张照片".into()); }
    let shared = state.shared.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut result = ImportResult { assets: vec![], errors: vec![] };
        for path in paths {
            match assets::inspect(Path::new(&path), None) {
                Ok(asset) => {
                    shared.register_asset(asset.clone());
                    result.assets.push(asset);
                }
                Err(error) => result.errors.push(format!("{}：{error:#}", Path::new(&path).file_name().unwrap_or_default().to_string_lossy())),
            }
        }
        result
    }).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_proxy(asset_id: String, max_size: u32, asset: Option<ImageAsset>, state: State<'_, Service>) -> Result<String, String> {
    let shared = state.shared.clone();
    tauri::async_runtime::spawn_blocking(move || shared.proxy(&asset_id, max_size, asset.as_ref()).map_err(|e| format!("{e:#}"))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn register_project(project: Project, state: State<'_, Service>) -> Result<RegisterResult, String> {
    let shared = state.shared.clone();
    tauri::async_runtime::spawn_blocking(move || shared.register_quick(&project).map(|missing| RegisterResult { missing }).map_err(|e| format!("{e:#}"))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_project(project: Project, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || storage::save(&project, Path::new(&path)).map_err(|e| format!("{e:#}"))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn load_project(path: String) -> Result<Project, String> {
    tauri::async_runtime::spawn_blocking(move || storage::load(Path::new(&path)).map_err(|e| format!("{e:#}"))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn relink_asset(asset_id: String, path: String, state: State<'_, Service>) -> Result<ImageAsset, String> {
    let shared = state.shared.clone();
    if !shared.assets.read().unwrap_or_else(|e| e.into_inner()).contains_key(&asset_id) { return Err("照片尚未登记".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let before = shared.authorized_asset(&asset_id, None).map_err(|e| format!("{e:#}"))?;
        let asset = assets::inherit_location(assets::inspect(Path::new(&path), Some(asset_id)).map_err(|e| format!("{e:#}"))?, &before);
        shared.register_asset(asset.clone());
        Ok(asset)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn open_in_photoshop(asset_id: String, asset: Option<ImageAsset>, state: State<'_, Service>) -> Result<(), String> {
    let shared = state.shared.clone();
    tauri::async_runtime::spawn_blocking(move || shared.open_in_photoshop(&asset_id, asset.as_ref()).map_err(|e| format!("{e:#}")))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn refresh_assets(assets: Vec<ImageAsset>, state: State<'_, Service>) -> Result<RefreshResult, String> {
    let shared = state.shared.clone();
    tauri::async_runtime::spawn_blocking(move || shared.refresh(&assets).map_err(|e| format!("{e:#}")))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn start_export(project: Project, options: ExportOptions, state: State<'_, Service>) -> Result<String, String> {
    state.start(project, options).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn cancel_export(job_id: String, state: State<'_, Service>) -> Result<(), String> {
    state.cancel(&job_id).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn get_export_progress(job_id: String, state: State<'_, Service>) -> Option<ExportProgress> { state.status(&job_id) }

#[tauri::command]
pub async fn sample_screen_color(app: tauri::AppHandle) -> Result<Option<String>, String> {
    crate::color_sampler::sample(app).await
}

#[tauri::command]
pub async fn import_watermark(path: String, state: State<'_, Service>) -> Result<ImageAsset, String> {
    let shared = state.shared.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let asset = assets::inspect(Path::new(&path), None).map_err(|e| format!("{e:#}"))?;
        { let _gate = shared.image_gate.lock().unwrap_or_else(|e| e.into_inner());
          crate::watermark::validate_watermark(&asset).map_err(|e| format!("{e:#}"))?; }
        shared.register_asset(asset.clone());
        Ok(asset)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scan_watermark_directory(directory: String, state: State<'_, Service>) -> Result<crate::watermark::ScanResult, String> {
    // Hashing and metadata inspection run off the main/UI thread.
    let watermarks = state.watermarks.clone();
    tauri::async_runtime::spawn_blocking(move || watermarks.scan(Path::new(&directory)).map_err(|e| format!("{e:#}")))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn start_watermark(options: crate::watermark::Options, state: State<'_, Service>) -> Result<String, String> {
    let watermarks = state.watermarks.clone();
    tauri::async_runtime::spawn_blocking(move || watermarks.start(options).map_err(|e| format!("{e:#}")))
        .await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn cancel_watermark(job_id: String, state: State<'_, Service>) { state.watermarks.cancel(&job_id); }

#[tauri::command]
pub fn get_watermark_progress(job_id: String, state: State<'_, Service>) -> Option<ExportProgress> { state.watermarks.status(&job_id) }

#[tauri::command]
pub async fn list_watermark_fonts() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| crate::watermark_text::font_families().map_err(|error| format!("{error:#}")))
        .await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn render_watermark_preview(photo: ImageAsset, watermark: Option<ImageAsset>, placement: Option<crate::watermark::Placement>,
    text: Option<crate::watermark_text::TextWatermark>, max_size: u32, state: State<'_, Service>) -> Result<crate::watermark::Preview, String> {
    let watermarks = state.watermarks.clone();
    tauri::async_runtime::spawn_blocking(move || {
        watermarks.preview(&photo, watermark.as_ref(), placement.as_ref(), text.as_ref(), max_size)
            .map_err(|error| format!("{error:#}"))
    }).await.map_err(|error| error.to_string())?
}
