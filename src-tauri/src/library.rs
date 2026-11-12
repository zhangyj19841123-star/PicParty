//! V2's application-owned project library. The drawing document stays schema 1;
//! the independently versioned envelope is never written over a legacy .collage.
use anyhow::{bail, Context, Result};
use collage_core::{validate_project, Project};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs::{self, File}, io::{Cursor, Read, Write}, path::{Path, PathBuf}, sync::{Mutex,atomic::AtomicBool}, time::{SystemTime, UNIX_EPOCH}};
use uuid::Uuid;

pub const MAX_DOCUMENT_BYTES: u64 = 34 * 1024 * 1024;
const FORMAT_VERSION: u32 = 2;
const MAX_EDITOR_BYTES: usize = 128 * 1024;
const MAX_COVER_BYTES: usize = 512 * 1024;
const COVER_FILE: &str = "cover-v1.bin";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Envelope {
    pub format_version: u32,
    pub id: String,
    pub kind: String,
    pub updated_at: u64,
    pub deleted_at: Option<u64>,
    pub revision: u64,
    pub project: Project,
    pub editor_state: Option<Value>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb,RgbImage};
    fn project(directory:&Path)->Project {
        let photo=directory.join("original.png");RgbImage::from_pixel(16,24,Rgb([20,80,160])).save(&photo).unwrap();
        crate::integration_tests::project_with_photo(&photo,120,180)
    }
    #[test]
    fn named_projects_and_drafts_have_independent_storage_and_same_names_never_overwrite(){
        let directory=tempfile::tempdir().unwrap();let library=Library::new(directory.path().join("library"));let project=project(directory.path());
        let view=serde_json::json!({"workspaceMode":4,"activePageId":"page"});
        let draft=library.save(project.clone(),"draft",None,Some(view.clone()),None).unwrap();
        let first=library.save(project.clone(),"project",None,Some(view.clone()),None).unwrap();
        let second=library.save(project.clone(),"project",None,None,None).unwrap();
        assert_ne!(first.entry.id,second.entry.id);assert_ne!(first.entry.id,draft.entry.id);
        assert_eq!(library.list("project",false).unwrap().entries.len(),2);assert_eq!(library.list("draft",false).unwrap().entries.len(),1);
        let reloaded=Library::new(library.root.clone()).open(&first.entry.id,"project").unwrap();
        assert_eq!(reloaded.project,project);assert_eq!(reloaded.editor_state,Some(view));
        let repeated=library.save(project,"draft",None,None,None).unwrap();assert_eq!(repeated.entry.id,draft.entry.id);
        assert_eq!(library.list("draft",false).unwrap().entries.len(),1);
    }
    #[test]
    fn autosave_rejects_wrong_session_stale_revision_and_deleted_projects(){
        let directory=tempfile::tempdir().unwrap();let library=Library::new(directory.path().join("library"));let project=project(directory.path());
        let first=library.save(project.clone(),"project",None,None,None).unwrap();let bytes=fs::read(&first.path).unwrap();
        let mut wrong=project.clone();wrong.id="different-project".into();
        assert!(library.save(wrong,"project",Some(first.entry.id.clone()),None,Some(1)).is_err());
        assert!(library.save(project.clone(),"project",Some(first.entry.id.clone()),None,Some(0)).is_err());
        assert_eq!(fs::read(&first.path).unwrap(),bytes);
        library.set_deleted(&first.entry.id,"project",true).unwrap();
        assert!(library.save(project.clone(),"project",Some(first.entry.id.clone()),None,None).is_err());
        assert!(library.open(&first.entry.id,"project").is_err());assert!(library.list("project",false).unwrap().entries.is_empty());
        assert_eq!(library.list("project",true).unwrap().entries.len(),1);
        library.set_deleted(&first.entry.id,"project",false).unwrap();assert_eq!(library.open(&first.entry.id,"project").unwrap().project,project);
    }
    #[test]
    fn rename_and_duplicate_preserve_every_edit_without_copying_originals(){
        let directory=tempfile::tempdir().unwrap();let library=Library::new(directory.path().join("library"));let mut project=project(directory.path());
        project.pages[0].frames[0].transform.rotation=17.5;project.pages[0].frames[0].transform.adjustments.exposure=0.7;
        let source=project.assets.values().next().unwrap().original_path.clone();let original=fs::read(&source).unwrap();
        let saved=library.save(project.clone(),"project",None,None,None).unwrap();
        library.rename(&saved.entry.id,"project","重命名".into()).unwrap();
        let copy=library.duplicate(&saved.entry.id,"project").unwrap();assert_ne!(copy.project.id,project.id);assert_ne!(copy.entry.id,saved.entry.id);
        assert_eq!(copy.project.pages,project.pages);assert_eq!(copy.project.assets,project.assets);assert_eq!(copy.project.document,project.document);
        assert_eq!(copy.project.name,"重命名 副本");assert_eq!(fs::read(source).unwrap(),original);
        assert!(!Path::new(&copy.path).parent().unwrap().join("assets").exists());
    }
    #[test]
    fn damaged_current_file_recovers_last_success_and_repair_preserves_damaged_bytes(){
        let directory=tempfile::tempdir().unwrap();let library=Library::new(directory.path().join("library"));let mut project=project(directory.path());
        let first=library.save(project.clone(),"project",None,None,None).unwrap();project.name="second revision".into();
        library.save(project,"project",Some(first.entry.id.clone()),None,Some(1)).unwrap();
        fs::write(&first.path,b"interrupted unexpected disk content").unwrap();
        let recovered=library.open(&first.entry.id,"project").unwrap();assert!(recovered.recovered);assert_eq!(recovered.project,first.project);
        let repaired=library.save(recovered.project,"project",Some(first.entry.id),None,Some(1)).unwrap();
        assert!(!library.open(&repaired.entry.id,"project").unwrap().recovered);
        let damaged:Vec<_>=fs::read_dir(Path::new(&first.path).parent().unwrap().join("recovery")).unwrap().flatten().filter(|e|e.file_name().to_string_lossy().starts_with("damaged-")).collect();
        assert_eq!(damaged.len(),1);assert_eq!(fs::read(damaged[0].path()).unwrap(),b"interrupted unexpected disk content");
    }
    #[test]
    fn recovery_versions_are_bounded_and_invalid_ids_or_editor_data_never_change_project(){
        let directory=tempfile::tempdir().unwrap();let library=Library::new(directory.path().join("library"));let mut project=project(directory.path());
        let first=library.save(project.clone(),"project",None,None,None).unwrap();
        for index in 0..8{project.name=format!("revision{index}");library.save(project.clone(),"project",Some(first.entry.id.clone()),None,None).unwrap();}
        let folder=Path::new(&first.path).parent().unwrap();assert_eq!(Library::history(folder).len(),3);
        let bytes=fs::read(&first.path).unwrap();
        for id in ["../escape","/tmp/escape","not-a-uuid"]{assert!(library.open(id,"project").is_err());}
        assert!(library.save(project.clone(),"unknown",None,None,None).is_err());
        assert!(library.save(project.clone(),"project",Some(first.entry.id.clone()),Some(serde_json::json!([])),None).is_err());
        assert!(library.save(project,"project",Some(first.entry.id),Some(serde_json::json!({"oversized":"a".repeat(128*1024)})),None).is_err());
        assert_eq!(fs::read(&first.path).unwrap(),bytes);
    }
    #[test]
    fn concurrent_optimistic_saves_cannot_silently_overwrite_each_other(){
        let directory=tempfile::tempdir().unwrap();let library=Arc::new(Library::new(directory.path().join("library")));let project=project(directory.path());
        let first=library.save(project.clone(),"project",None,None,None).unwrap();
        let workers:Vec<_>=(0..2).map(|index|{let library=library.clone();let id=first.entry.id.clone();let mut p=project.clone();p.name=format!("edit{index}");std::thread::spawn(move||library.save(p,"project",Some(id),None,Some(1)).is_ok())}).collect();
        let success=workers.into_iter().map(|worker|worker.join().unwrap()).filter(|success|*success).count();assert_eq!(success,1);
        assert_eq!(library.open(&first.entry.id,"project").unwrap().entry.revision,2);
    }
    #[test]
    fn cover_cache_is_optional_and_late_thumbnails_cannot_replace_newer_pixels() {
        fn jpeg(color: Rgb<u8>) -> Vec<u8> {
            let mut output = Cursor::new(Vec::new());
            RgbImage::from_pixel(24, 36, color).write_to(&mut output, image::ImageFormat::Jpeg).unwrap();
            output.into_inner()
        }
        let directory = tempfile::tempdir().unwrap();
        let library = Library::new(directory.path().join("library"));
        let first = library.save(project(directory.path()), "project", None, None, None).unwrap();
        let id = &first.entry.id;
        let initial = jpeg(Rgb([30, 80, 160]));
        let replacement = jpeg(Rgb([200, 40, 70]));
        assert!(library.read_cover(id, "project", 0).unwrap().is_empty());
        assert_eq!(library.write_cover(id, "project", 1, &initial).unwrap(), Some(1));
        let renamed = library.rename(id, "project", "New name".into()).unwrap();
        assert_eq!(renamed.created_at, first.entry.created_at);
        assert_eq!(renamed.cover_revision, Some(1));
        let project_bytes = fs::read(&first.path).unwrap();
        assert!(library.write_cover(id, "project", 2, b"bad jpeg").is_err());
        assert_eq!(library.read_cover(id, "project", 1).unwrap(), initial);
        assert_eq!(library.write_cover(id, "project", 2, &replacement).unwrap(), Some(2));
        assert_eq!(library.write_cover(id, "project", 1, &initial).unwrap(), Some(2));
        assert_eq!(library.read_cover(id, "project", 2).unwrap(), replacement);
        assert_eq!(fs::read(&first.path).unwrap(), project_bytes);
        assert_eq!(library.reveal_path(id, "project").unwrap(), PathBuf::from(first.path));
        assert!(library.reveal_path("../source.png", "project").is_err());
    }
    #[test]
    fn future_envelopes_are_never_silently_recovered_or_overwritten_by_an_older_app(){
        let directory=tempfile::tempdir().unwrap();let library=Library::new(directory.path().join("library"));let project=project(directory.path());
        let first=library.save(project.clone(),"project",None,None,None).unwrap();library.save(project.clone(),"project",Some(first.entry.id.clone()),None,None).unwrap();
        let mut future:Value=serde_json::from_slice(&fs::read(&first.path).unwrap()).unwrap();future["formatVersion"]=serde_json::json!(3);atomic_json(Path::new(&first.path),&future).unwrap();let bytes=fs::read(&first.path).unwrap();
        assert!(library.open(&first.entry.id,"project").is_err());assert!(library.save(project,"project",Some(first.entry.id),None,None).is_err());assert_eq!(fs::read(&first.path).unwrap(),bytes);
    }
    #[test]
    fn a_damaged_deleted_document_never_reappears_through_an_older_recovery_version(){
        let directory=tempfile::tempdir().unwrap();let library=Library::new(directory.path().join("library"));let project=project(directory.path());let saved=library.save(project.clone(),"project",None,None,None).unwrap();
        library.set_deleted(&saved.entry.id,"project",true).unwrap();fs::write(&saved.path,b"damaged current").unwrap();
        assert!(library.list("project",false).unwrap().entries.is_empty());assert!(library.open(&saved.entry.id,"project").is_err());
        library.set_deleted(&saved.entry.id,"project",false).unwrap();assert_eq!(library.open(&saved.entry.id,"project").unwrap().project,project);
    }
    #[test]
    fn cancelling_an_import_while_it_waits_for_autosave_never_installs_the_project() {
        use std::{sync::atomic::Ordering, time::{Duration, Instant}};
        let directory = tempfile::tempdir().unwrap();
        let mut project = project(directory.path());
        let extracted = directory.path().join("extracted");
        fs::create_dir_all(extracted.join("assets")).unwrap();
        let original = project.assets.values().next().unwrap().original_path.clone();
        let original_bytes = fs::read(&original).unwrap();
        fs::copy(&original, extracted.join("assets/000001.png")).unwrap();
        project.assets.values_mut().next().unwrap().original_path = "assets/000001.png".into();
        let library = Arc::new(Library::new(directory.path().join("library")));
        let cancel = Arc::new(AtomicBool::new(false));
        // Simulate an in-flight autosave owning the same commit gate.
        let guard = library.gate.lock().unwrap();
        let worker_library = library.clone();
        let worker_cancel = cancel.clone();
        let worker = std::thread::spawn(move || worker_library.install_import(project, None, &extracted, &worker_cancel));
        let deadline = Instant::now() + Duration::from_secs(5);
        let parent = library.root.join("projects");
        loop {
            let staged = fs::read_dir(&parent).into_iter().flatten().flatten().any(|entry| entry.path().join("project.json").is_file());
            if staged { break; }
            assert!(Instant::now() < deadline, "import never reached its commit gate");
            std::thread::sleep(Duration::from_millis(1));
        }
        // The staging envelope has been fsynced, and the worker can only wait
        // for the held gate. Leave a scheduling turn before cancelling it.
        std::thread::sleep(Duration::from_millis(30));
        assert!(!worker.is_finished());
        cancel.store(true, Ordering::Relaxed);
        drop(guard);
        assert!(worker.join().unwrap().is_err());
        assert_eq!(fs::read_dir(parent).unwrap().count(), 0);
        assert_eq!(fs::read(original).unwrap(), original_bytes);
    }
    use std::sync::Arc;
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntry {
    pub id: String, pub name: String, pub kind: String, pub updated_at: u64,
    pub deleted_at: Option<u64>, pub page_count: usize, pub asset_count: usize, pub revision: u64,
    pub created_at: Option<u64>, pub cover_revision: Option<u64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDocument {
    pub entry: LibraryEntry, pub project: Project, pub path: String,
    pub editor_state: Option<Value>, pub recovered: bool,
}
#[derive(Serialize)]
pub struct LibraryList { pub root: String, pub entries: Vec<LibraryEntry>, pub errors: Vec<String> }

pub struct Library { pub(crate) root: PathBuf, gate: Mutex<()> }

pub fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }
fn kind_directory(kind: &str) -> Result<&'static str> {
    match kind { "project" => Ok("projects"), "draft" => Ok("drafts"), _ => bail!("项目类型无效") }
}
fn valid_id(id: &str) -> Result<()> {
    if Uuid::parse_str(id).is_err() || id.len() != 36 { bail!("项目标识无效"); }
    Ok(())
}
pub(crate) fn validate_editor(editor: &Option<Value>) -> Result<()> {
    if let Some(value) = editor {
        if !value.is_object() || serde_json::to_vec(value)?.len() > MAX_EDITOR_BYTES { bail!("编辑视图设置无效或过大"); }
    }
    Ok(())
}
fn validate_envelope(document: &Envelope) -> Result<()> {
    if document.format_version != FORMAT_VERSION { bail!("此项目库文件需要其他版本的应用，未修改原文件"); }
    valid_id(&document.id)?; kind_directory(&document.kind)?;
    validate_project(&document.project)?; validate_editor(&document.editor_state)?;
    if document.revision > 9_000_000_000_000_000 { bail!("项目修订编号无效"); }
    Ok(())
}
fn cover_file(folder: &Path) -> Option<(u64, File)> {
    let path = folder.join(COVER_FILE);
    let metadata = fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file() || !(9..=(MAX_COVER_BYTES as u64 + 8)).contains(&metadata.len()) { return None; }
    let mut file = File::open(path).ok()?;
    let mut revision = [0; 8];
    file.read_exact(&mut revision).ok()?;
    Some((u64::from_le_bytes(revision), file))
}
fn summary(document: &Envelope, path: &Path) -> LibraryEntry {
    let folder = path.parent().expect("library documents live in project directories");
    let created_at = fs::metadata(folder).and_then(|metadata| metadata.created()).ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map(|duration| duration.as_millis() as u64);
    let cover_revision = cover_file(folder).map(|(revision, _)| revision).filter(|revision| *revision <= document.revision);
    LibraryEntry { id: document.id.clone(), name: document.project.name.clone(), kind: document.kind.clone(), updated_at: document.updated_at,
        deleted_at: document.deleted_at, page_count: document.project.pages.len(), asset_count: document.project.assets.len(), revision: document.revision,
        created_at, cover_revision }
}
fn result(document: Envelope, path: PathBuf, recovered: bool) -> LibraryDocument {
    LibraryDocument { entry: summary(&document, &path), project: document.project, path: path.to_string_lossy().into(), editor_state: document.editor_state, recovered }
}
pub(crate) fn read_envelope(path: &Path) -> Result<Envelope> {
    let file = File::open(path)?;
    if !file.metadata()?.is_file() || file.metadata()?.len() > MAX_DOCUMENT_BYTES { bail!("项目库文件超过安全读取上限"); }
    let mut bytes = Vec::new(); file.take(MAX_DOCUMENT_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES { bail!("项目库文件过大"); }
    let document: Envelope = serde_json::from_slice(&bytes).context("项目库文件损坏，可尝试恢复版本")?;
    validate_envelope(&document)?; Ok(document)
}
pub(crate) fn atomic_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(value)?;
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES { bail!("项目数据超过 34 MB 安全保存上限"); }
    let parent = path.parent().context("保存位置无效")?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    temp.write_all(&bytes)?; temp.as_file().sync_all()?;
    temp.persist(path).map_err(|e| e.error).context("自动保存失败，上一成功版本未改变")?;
    crate::storage::sync_parent(path); Ok(())
}

impl Library {
    pub fn new(root: PathBuf) -> Self { Self { root, gate: Mutex::new(()) } }
    fn folder(&self, id: &str, kind: &str) -> Result<PathBuf> { valid_id(id)?; Ok(self.root.join(kind_directory(kind)?).join(id)) }
    fn history(folder: &Path) -> Vec<PathBuf> {
        let mut values: Vec<(u64, PathBuf)> = fs::read_dir(folder.join("recovery")).into_iter().flatten().flatten()
            .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
            .filter_map(|e| { let path = e.path(); let number = path.file_stem()?.to_str()?.parse::<u64>().ok()?; Some((number, path)) }).collect();
        values.sort_by(|a,b| b.0.cmp(&a.0)); values.into_iter().map(|(_,p)|p).collect()
    }
    fn read(&self, id: &str, kind: &str) -> Result<(Envelope, PathBuf, bool)> {
        let folder = self.folder(id, kind)?;
        let path = folder.join("project.json");
        if fs::symlink_metadata(&folder).is_ok_and(|m| m.file_type().is_symlink()) { bail!("项目目录不是普通目录"); }
        // A valid future envelope is not corruption. Never roll it back to an
        // old recovery version and then let this older app overwrite new data.
        if fs::metadata(&path).is_ok_and(|m|m.len()<=MAX_DOCUMENT_BYTES) {
            if let Ok(value)=fs::read(&path).and_then(|bytes|serde_json::from_slice::<Value>(&bytes).map_err(std::io::Error::other)) {
                if value.get("formatVersion").is_some_and(|version|version.as_u64()!=Some(FORMAT_VERSION as u64)){bail!("此项目需要更新版本的应用，旧版不会覆盖");}
            }
        }
        let apply_deleted=|mut document:Envelope|->Result<Envelope>{
            let marker=folder.join("deleted.json");
            if marker.exists(){if fs::metadata(&marker)?.len()>1024{bail!("删除状态记录损坏，作品已保留");}document.deleted_at=serde_json::from_slice(&fs::read(marker)?).context("删除状态无法读取，作品已保留")?;}
            Ok(document)
        };
        if let Ok(document) = read_envelope(&path) {
            if document.id != id || document.kind != kind { bail!("项目身份与保存位置不一致"); }
            return Ok((apply_deleted(document)?,path,false));
        }
        for backup in Self::history(&folder) {
            if let Ok(document) = read_envelope(&backup) {
                if document.id == id && document.kind == kind { return Ok((apply_deleted(document)?,path,true)); }
            }
        }
        bail!("项目无法读取，原文件与恢复目录均已保留")
    }
    fn write(&self, document: &Envelope) -> Result<PathBuf> {
        validate_envelope(document)?;
        let folder = self.folder(&document.id, &document.kind)?;
        fs::create_dir_all(&folder)?;
        let path = folder.join("project.json");
        if path.exists() {
            let recovery = folder.join("recovery"); fs::create_dir_all(&recovery)?;
            // Only validated prior versions enter the bounded recovery chain.
            if let Ok(previous) = read_envelope(&path) {
                let backup = recovery.join(format!("{}.json", previous.revision));
                if !backup.exists() { atomic_json(&backup, &previous)?; }
            } else {
                // Preserve the damaged current file before repairing from history.
                let backup = recovery.join(format!("damaged-{}-{}.json", now(), Uuid::new_v4()));
                fs::copy(&path, backup)?;
            }
        }
        atomic_json(&path, document)?;
        for obsolete in Self::history(&folder).into_iter().skip(3) { let _ = fs::remove_file(obsolete); }
        Ok(path)
    }
    pub fn list(&self, kind: &str, include_deleted: bool) -> Result<LibraryList> {
        let _guard = self.gate.lock().unwrap_or_else(|e| e.into_inner());
        self.list_unlocked(kind, include_deleted)
    }
    fn list_unlocked(&self, kind: &str, include_deleted: bool) -> Result<LibraryList> {
        let directory = self.root.join(kind_directory(kind)?);
        let mut output = LibraryList { root: self.root.to_string_lossy().into(), entries: vec![], errors: vec![] };
        if !directory.exists() { return Ok(output); }
        for item in fs::read_dir(directory)?.take(20_001) {
            let item = item?;
            if !item.file_type()?.is_dir() { continue; }
            let id = item.file_name().to_string_lossy().to_string();
            if valid_id(&id).is_err() { continue; }
            match self.read(&id,kind) {
                Ok((document,path,_)) if include_deleted || document.deleted_at.is_none() => output.entries.push(summary(&document,&path)),
                Ok(_) => (), Err(_) => output.errors.push("有一份项目记录无法读取，原文件及恢复目录已保留".into()),
            }
        }
        output.entries.sort_by(|a,b| b.updated_at.cmp(&a.updated_at)); Ok(output)
    }
    pub fn open(&self, id: &str, kind: &str) -> Result<LibraryDocument> {
        let _guard = self.gate.lock().unwrap_or_else(|e| e.into_inner());
        let (document,path,recovered) = self.read(id,kind)?;
        if document.deleted_at.is_some() { bail!("此作品已移到已删除列表，请先恢复"); }
        Ok(result(document,path,recovered))
    }
    pub fn read_cover(&self, id: &str, kind: &str, revision: u64) -> Result<Vec<u8>> {
        let folder = self.folder(id, kind)?;
        if !fs::symlink_metadata(&folder).is_ok_and(|metadata| metadata.is_dir()) { return Ok(vec![]); }
        let Some((stored_revision, file)) = cover_file(&folder) else { return Ok(vec![]); };
        if stored_revision < revision { return Ok(vec![]); }
        let mut bytes = Vec::new();
        file.take(MAX_COVER_BYTES as u64 + 1).read_to_end(&mut bytes)?;
        if bytes.len() > MAX_COVER_BYTES { return Ok(vec![]); }
        Ok(bytes)
    }
    pub fn write_cover(&self, id: &str, kind: &str, revision: u64, jpeg: &[u8]) -> Result<Option<u64>> {
        if jpeg.len() > MAX_COVER_BYTES { bail!("项目封面超过安全大小"); }
        let (width, height) = image::ImageReader::with_format(Cursor::new(jpeg), image::ImageFormat::Jpeg).into_dimensions()?;
        if width == 0 || height == 0 || width > 512 || height > 512 { bail!("项目封面尺寸无效"); }
        let _guard = self.gate.lock().unwrap_or_else(|e| e.into_inner());
        let (document, path, _) = self.read(id, kind)?;
        if document.deleted_at.is_some() || revision == 0 || revision > document.revision { return Ok(None); }
        let folder = path.parent().context("项目目录无效")?;
        if let Some((existing, _)) = cover_file(folder) {
            if existing >= revision && existing <= document.revision { return Ok(Some(existing)); }
        }
        let mut temp = tempfile::NamedTempFile::new_in(folder)?;
        temp.write_all(&revision.to_le_bytes())?;
        temp.write_all(jpeg)?;
        temp.persist(folder.join(COVER_FILE)).map_err(|error| error.error)?;
        Ok(Some(revision))
    }
    pub fn reveal_path(&self, id: &str, kind: &str) -> Result<PathBuf> {
        let _guard = self.gate.lock().unwrap_or_else(|e| e.into_inner());
        let (_, path, _) = self.read(id, kind)?;
        if !fs::symlink_metadata(&path)?.is_file() { bail!("无法在 Finder 中显示该项目文件"); }
        Ok(path)
    }
    pub fn save(&self, project: Project, kind: &str, library_id: Option<String>, editor_state: Option<Value>, expected_revision: Option<u64>) -> Result<LibraryDocument> {
        validate_project(&project)?; validate_editor(&editor_state)?; kind_directory(kind)?;
        let _guard = self.gate.lock().unwrap_or_else(|e|e.into_inner());
        let mut existing = library_id;
        // A repeated initial draft save is idempotent even if IPC callers race.
        if existing.is_none() && kind == "draft" {
            existing = self.list_unlocked(kind,false)?.entries.into_iter().find_map(|e| self.read(&e.id,kind).ok().and_then(|(d,_,_)| (d.project.id == project.id).then_some(e.id)));
        }
        let (id,revision,updated_at) = if let Some(id) = existing {
            let (previous,_,_) = self.read(&id,kind)?;
            if previous.project.id != project.id { bail!("项目已切换，拒绝将草稿或其他作品写入此项目"); }
            if previous.deleted_at.is_some() { bail!("项目已删除，自动保存不会恢复它"); }
            if expected_revision.is_some_and(|r| r != previous.revision) { bail!("项目已被其他保存更新，请重新打开后继续，旧版未覆盖"); }
            (id,previous.revision + 1,now().max(previous.updated_at + 1))
        } else { (Uuid::new_v4().to_string(),1,now()) };
        let document = Envelope { format_version: FORMAT_VERSION, id, kind: kind.into(), updated_at, deleted_at: None, revision, project, editor_state };
        let path = self.write(&document)?; Ok(result(document,path,false))
    }
    pub fn rename(&self, id: &str, kind: &str, name: String) -> Result<LibraryEntry> {
        let name = name.trim(); if name.is_empty() || name.len() > 4096 || name.chars().any(char::is_control) { bail!("请输入有效的项目名称"); }
        let _guard = self.gate.lock().unwrap_or_else(|e|e.into_inner());
        let (mut document,_,_) = self.read(id,kind)?;
        if document.deleted_at.is_some() { bail!("请先恢复此项目"); }
        document.project.name = name.into(); document.revision += 1; document.updated_at = now().max(document.updated_at+1);
        let path = self.write(&document)?; Ok(summary(&document, &path))
    }
    pub fn set_deleted(&self, id: &str, kind: &str, deleted: bool) -> Result<LibraryEntry> {
        let _guard = self.gate.lock().unwrap_or_else(|e|e.into_inner());
        let (mut document,_,_) = self.read(id,kind)?;
        document.deleted_at = if deleted { Some(now()) } else { None }; document.updated_at = now().max(document.updated_at+1); document.revision += 1;
        let marker=self.folder(id,kind)?.join("deleted.json");
        // The independent tombstone keeps an older recovery snapshot from
        // silently resurrecting a removed work after a damaged current save.
        if deleted { atomic_json(&marker,&document.deleted_at)?; }
        let path = self.write(&document)?;
        if !deleted { atomic_json(&marker,&document.deleted_at)?; }
        Ok(summary(&document, &path))
    }
    pub fn duplicate(&self, id: &str, kind: &str) -> Result<LibraryDocument> {
        let _guard = self.gate.lock().unwrap_or_else(|e|e.into_inner());
        let (mut document,_,_) = self.read(id,kind)?;
        document.id = Uuid::new_v4().to_string(); document.project.id = Uuid::new_v4().to_string();
        document.project.name = format!("{} 副本", document.project.name); document.updated_at = now(); document.deleted_at = None; document.revision = 1;
        let path = self.write(&document)?; Ok(result(document,path,false))
    }
    /// The importer calls this only after validating an isolated extraction tree.
    /// It installs all bytes and the envelope with one final directory rename.
    pub(crate) fn install_import(&self, mut project: Project, editor_state: Option<Value>, extracted: &Path, cancel: &AtomicBool) -> Result<LibraryDocument> {
        let parent = self.root.join("projects"); fs::create_dir_all(&parent)?;
        let staging = tempfile::tempdir_in(&parent)?;
        let id = Uuid::new_v4().to_string(); let destination = parent.join(&id);
        fs::create_dir(staging.path().join("assets"))?;
        for asset in project.assets.values_mut() {
            let relative = PathBuf::from(&asset.original_path);
            // Archive validation also applies this rule before any extraction.
            if relative.components().any(|c| !matches!(c,std::path::Component::Normal(_))) || !asset.original_path.starts_with("assets/") { bail!("归档素材路径无效"); }
            let source = extracted.join(&relative); let target = staging.path().join(&relative);
            if fs::symlink_metadata(&source)?.file_type().is_symlink() { bail!("归档不允许符号链接"); }
            crate::portable_zip::copy_with_cancel(&source,&target,cancel)?;
            asset.original_path = destination.join(&relative).to_string_lossy().into();
            asset.initial_path = Some(asset.original_path.clone());
            asset.source_root = Some(destination.to_string_lossy().into());
            asset.relative_path = Some(relative.to_string_lossy().into());
            asset.previous_roots.clear();
        }
        project.id = Uuid::new_v4().to_string();
        let document = Envelope { format_version: FORMAT_VERSION, id, kind: "project".into(), updated_at: now(), deleted_at: None, revision: 1, project, editor_state };
        validate_envelope(&document)?; atomic_json(&staging.path().join("project.json"),&document)?;
        crate::portable_zip::check_cancel(cancel)?;
        let _guard = self.gate.lock().unwrap_or_else(|e|e.into_inner());
        // Cancellation may arrive while waiting for an autosave to release the
        // library gate. The directory rename is the irreversible commit point.
        crate::portable_zip::check_cancel(cancel)?;
        if destination.exists() { bail!("项目标识发生冲突，请重试导入"); }
        fs::rename(staging.path(),&destination)?; crate::storage::sync_parent(&destination);
        Ok(result(document,destination.join("project.json"),false))
    }
}
