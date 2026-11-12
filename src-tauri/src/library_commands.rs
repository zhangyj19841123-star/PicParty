use crate::{archive::{Archives,ArchiveProgress},diagnostics::{DiagnosticLog,Stage,Outcome},library::{Library,LibraryDocument,LibraryEntry,LibraryList},service::Service};
use collage_core::Project;
use serde_json::Value;
use std::{path::PathBuf,sync::Arc};
use tauri::{AppHandle,Manager,State};

fn record(app:&AppHandle,stage:Stage,ok:bool){if let Some(log)=app.try_state::<DiagnosticLog>(){let _=log.record(stage,if ok{Outcome::Ok}else{Outcome::IoFailure});}}

#[tauri::command]
pub async fn library_list(kind:String,include_deleted:Option<bool>,library:State<'_,Arc<Library>>)->Result<LibraryList,String>{
    let library=library.inner().clone();tauri::async_runtime::spawn_blocking(move||library.list(&kind,include_deleted.unwrap_or(false)).map_err(|e|format!("{e:#}"))).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn library_open(id:String,kind:String,library:State<'_,Arc<Library>>,app:AppHandle)->Result<LibraryDocument,String>{
    let library=library.inner().clone();let output=tauri::async_runtime::spawn_blocking(move||library.open(&id,&kind).map_err(|e|format!("{e:#}"))).await.map_err(|e|e.to_string())?;
    record(&app,Stage::ProjectRead,output.is_ok());output
}
#[tauri::command]
pub async fn library_save(project:Project,kind:String,library_id:Option<String>,editor_state:Option<Value>,expected_revision:Option<u64>,library:State<'_,Arc<Library>>,app:AppHandle)->Result<LibraryDocument,String>{
    let library=library.inner().clone();let output=tauri::async_runtime::spawn_blocking(move||library.save(project,&kind,library_id,editor_state,expected_revision).map_err(|e|format!("{e:#}"))).await.map_err(|e|e.to_string())?;
    record(&app,Stage::ProjectWrite,output.is_ok());output
}
#[tauri::command]
pub async fn library_duplicate(id:String,kind:String,library:State<'_,Arc<Library>>)->Result<LibraryDocument,String>{
    let library=library.inner().clone();tauri::async_runtime::spawn_blocking(move||library.duplicate(&id,&kind).map_err(|e|format!("{e:#}"))).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn library_set_deleted(id:String,kind:String,deleted:bool,library:State<'_,Arc<Library>>)->Result<LibraryEntry,String>{
    let library=library.inner().clone();tauri::async_runtime::spawn_blocking(move||library.set_deleted(&id,&kind,deleted).map_err(|e|format!("{e:#}"))).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn library_rename(id:String,kind:String,name:String,library:State<'_,Arc<Library>>)->Result<LibraryEntry,String>{
    let library=library.inner().clone();tauri::async_runtime::spawn_blocking(move||library.rename(&id,&kind,name).map_err(|e|format!("{e:#}"))).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn library_read_cover(id: String, kind: String, revision: u64, library: State<'_, Arc<Library>>) -> Result<tauri::ipc::Response, String> {
    let library = library.inner().clone();
    let bytes = tauri::async_runtime::spawn_blocking(move || library.read_cover(&id, &kind, revision))
        .await.map_err(|error| error.to_string())?.map_err(|error| error.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn library_write_cover(id: String, kind: String, revision: u64, jpeg: Vec<u8>, library: State<'_, Arc<Library>>) -> Result<Option<u64>, String> {
    let library = library.inner().clone();
    tauri::async_runtime::spawn_blocking(move || library.write_cover(&id, &kind, revision, &jpeg))
        .await.map_err(|error| error.to_string())?.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn library_reveal(id: String, kind: String, library: State<'_, Arc<Library>>) -> Result<(), String> {
    let library = library.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = library.reveal_path(&id, &kind).map_err(|error| error.to_string())?;
        let status = std::process::Command::new("/usr/bin/open").arg("-R").arg(path).status()
            .map_err(|_| "无法打开 Finder".to_string())?;
        if status.success() { Ok(()) } else { Err("无法在 Finder 中显示该项目文件".into()) }
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn archive_start(project:Project,path:String,editor_state:Option<Value>,archives:State<'_,Archives>,service:State<'_,Service>,app:AppHandle)->Result<String,String>{
    crate::library::validate_editor(&editor_state).map_err(|e|e.to_string())?;
    for asset in project.assets.values(){service.shared.authorized_asset(&asset.id,Some(asset)).map_err(|e|format!("{e:#}"))?;}
    let output=archives.start_export(project,PathBuf::from(path),editor_state).map_err(|e|format!("{e:#}"));record(&app,Stage::Archive,output.is_ok());output
}
#[tauri::command]
pub fn archive_import_start(path:String,archives:State<'_,Archives>,app:AppHandle)->Result<String,String>{let output=archives.start_import(PathBuf::from(path)).map_err(|e|format!("{e:#}"));record(&app,Stage::Archive,output.is_ok());output}
#[tauri::command]
pub fn archive_progress(job_id:String,archives:State<'_,Archives>)->Option<ArchiveProgress>{archives.progress(&job_id)}
#[tauri::command]
pub fn archive_cancel(job_id:String,archives:State<'_,Archives>){archives.cancel(&job_id);}
