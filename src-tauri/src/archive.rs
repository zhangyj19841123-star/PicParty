use crate::{assets,library::{self,Library,LibraryDocument},portable_zip,storage};
use anyhow::{bail,Context,Result};
use collage_core::{validate_project,Project};
use serde::{Deserialize,Serialize};
use serde_json::Value;
use std::{collections::{BTreeMap,BTreeSet},fs::{self,File},io::Read,path::{Path,PathBuf},sync::{Arc,Mutex,atomic::{AtomicBool,Ordering}}};
use uuid::Uuid;

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct ManifestAsset { asset_id:String,path:String,bytes:u64,blake3:String,width:u32,height:u32,file_name:String }
#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Manifest {
    format_version:u32, document_version:u32, engine_version:u32, complete:bool, created_at:u64,
    project_file:String, project_blake3:String, assets:Vec<ManifestAsset>, editor_state:Option<Value>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use collage_core::{BackgroundImage,Frame,ImageTransform,Rect};
    use image::{Rgb,RgbImage};
    fn fixture(directory:&Path)->Project {
        fs::create_dir_all(directory.join("first")).unwrap();fs::create_dir_all(directory.join("second")).unwrap();
        let first=directory.join("first/same.png");let second=directory.join("second/same.png");
        RgbImage::from_fn(24,36,|x,y|Rgb([(x*7) as u8,(y*5) as u8,120])).save(&first).unwrap();
        RgbImage::from_pixel(36,24,Rgb([20,180,40])).save(&second).unwrap();
        let mut project=crate::integration_tests::project_with_photo(&first,120,180);project.name="可迁移拼图".into();
        let second=assets::inspect(&second,Some("background-and-unplaced".into())).unwrap();
        project.pages[0].background_image=Some(BackgroundImage{image_asset_id:second.id.clone(),opacity:0.45,transform:ImageTransform::default()});
        project.pages[0].unplaced.push(Frame{id:"unplaced-frame".into(),slot_id:"unplaced-slot".into(),image_asset_id:Some(second.id.clone()),transform:ImageTransform::default()});
        project.pages[0].frames[0].transform.focus_x=0.35;project.pages[0].frames[0].transform.focus_y=0.65;
        project.pages[0].frames[0].transform.zoom=1.7;project.pages[0].frames[0].transform.rotation=19.25;
        project.pages[0].frames[0].transform.adjustments.exposure=0.65;
        project.pages[0].frame_rects=Some(BTreeMap::from([("photo".into(),Rect{x:0.1,y:0.2,width:0.8,height:0.6})]));
        project.assets.insert(second.id.clone(),second);validate_project(&project).unwrap();project
    }
    #[test]
    fn complete_archive_migrates_without_any_original_paths_and_preserves_editing_and_export_pixels(){
        let directory=tempfile::tempdir().unwrap();let project=fixture(directory.path());let original=project.clone();let cancel=AtomicBool::new(false);
        let expected=crate::render::render_page(&project,&project.pages[0],&cancel).unwrap();
        let source_bytes:BTreeMap<_,_>=project.assets.iter().map(|(id,a)|(id.clone(),fs::read(&a.original_path).unwrap())).collect();
        let zip=directory.path().join("portable.zip");
        let view = serde_json::json!({
            "workspaceMode": 4, "activePageId": "page",
            "outputSettings": {
                "export": {"format": "png", "scope": "all", "quality": 100},
                "watermark": {"watermarkPath": "/Volumes/Studio/mark.png", "textEnabled": true}
            }
        });
        let mut portable_view = view.clone();
        portable_view["outputSettings"]["watermark"].as_object_mut().unwrap().remove("watermarkPath");
        export_archive(&project,Some(view.clone()),&zip,&cancel,&mut|_,_,_|{}).unwrap();assert_eq!(project,original);
        for(id,a)in &project.assets{assert_eq!(fs::read(&a.original_path).unwrap(),source_bytes[id]);}
        // An independent library can import after every original disappears.
        for a in project.assets.values(){fs::rename(&a.original_path,format!("{}.offline",a.original_path)).unwrap();}
        let library=Library::new(directory.path().join("another-mac-library"));
        let imported=import_archive(&library,&zip,&cancel,&mut|_,_,_|{}).unwrap();
        assert_ne!(imported.project.id,project.id);assert_eq!(imported.project.pages,project.pages);assert_eq!(imported.project.document,project.document);assert_eq!(imported.project.templates,project.templates);assert_eq!(imported.editor_state,Some(portable_view));
        assert_eq!(imported.project.assets.len(),2);
        let mut paths=BTreeSet::new();
        for (id,a) in &imported.project.assets{
            assert!(Path::new(&a.original_path).starts_with(&library.root));assert!(paths.insert(a.original_path.clone()));assert_eq!(a.file_name,"same.png");
            assert_eq!(fs::read(&a.original_path).unwrap(),source_bytes[id]);assert_eq!(a.fingerprint,project.assets[id].fingerprint);assert!(a.previous_roots.is_empty());
            assert!(!a.source_root.as_ref().unwrap().contains("first"));assert!(!a.source_root.as_ref().unwrap().contains("second"));
        }
        let rendered=crate::render::render_page(&imported.project,&imported.project.pages[0],&cancel).unwrap();assert_eq!(rendered,expected);
        let reopened=library.open(&imported.entry.id,"project").unwrap();assert_eq!(reopened.project,imported.project);
        let mut edited=reopened.project;edited.pages[0].frames[0].transform.rotation=-15.0;
        let saved=library.save(edited.clone(),"project",Some(imported.entry.id.clone()),reopened.editor_state,Some(1)).unwrap();assert_eq!(library.open(&imported.entry.id,"project").unwrap().project,edited);assert_eq!(saved.entry.revision,2);
        let twice=import_archive(&library,&zip,&cancel,&mut|_,_,_|{}).unwrap();assert_ne!(twice.entry.id,imported.entry.id);assert_ne!(twice.project.id,imported.project.id);
    }
    #[test]
    fn missing_or_changed_originals_never_produce_a_complete_archive_or_mutate_the_project(){
        let directory=tempfile::tempdir().unwrap();let project=fixture(directory.path());let bytes=serde_json::to_vec(&project).unwrap();let path=directory.path().join("incomplete.zip");
        let first=project.assets.values().next().unwrap();fs::rename(&first.original_path,format!("{}.offline",first.original_path)).unwrap();
        assert!(export_archive(&project,None,&path,&AtomicBool::new(false),&mut|_,_,_|{}).is_err());assert!(!path.exists());assert_eq!(serde_json::to_vec(&project).unwrap(),bytes);
        fs::write(&first.original_path,b"same name, wrong content").unwrap();assert!(export_archive(&project,None,&path,&AtomicBool::new(false),&mut|_,_,_|{}).is_err());assert!(!path.exists());
    }
    #[test]
    fn archive_cancel_and_existing_output_preserve_originals_and_library(){
        let directory=tempfile::tempdir().unwrap();let project=fixture(directory.path());let path=directory.path().join("cancel.zip");
        assert!(export_archive(&project,None,&path,&AtomicBool::new(true),&mut|_,_,_|{}).is_err());assert!(!path.exists());
        export_archive(&project,None,&path,&AtomicBool::new(false),&mut|_,_,_|{}).unwrap();let previous=fs::read(&path).unwrap();
        assert!(export_archive(&project,None,&path,&AtomicBool::new(false),&mut|_,_,_|{}).is_err());assert_eq!(fs::read(&path).unwrap(),previous);
        let library=Library::new(directory.path().join("library"));assert!(import_archive(&library,&path,&AtomicBool::new(true),&mut|_,_,_|{}).is_err());assert!(library.list("project",false).unwrap().entries.is_empty());
        let flag=AtomicBool::new(false);assert!(import_archive(&library,&path,&flag,&mut|_,_,message|{if message=="安装为独立项目"{flag.store(true,Ordering::Relaxed);}}).is_err());assert!(library.list("project",false).unwrap().entries.is_empty());
    }
    #[test]
    fn tampered_manifest_and_same_named_wrong_photo_fail_before_install(){
        let directory=tempfile::tempdir().unwrap();let project=fixture(directory.path());let archive=directory.path().join("good.zip");let cancel=AtomicBool::new(false);
        export_archive(&project,None,&archive,&cancel,&mut|_,_,_|{}).unwrap();let entries=portable_zip::read_directory(&archive).unwrap();let extraction=tempfile::tempdir().unwrap();portable_zip::extract(&archive,&entries,extraction.path(),&cancel,|_,_|{}).unwrap();
        let root=storage::safe_prefix(&project.name);let base=extraction.path().join(&root);fs::write(base.join("assets/000001.png"),b"not the original photo").unwrap();
        let files:Vec<_>=entries.iter().filter(|e|!e.directory).map(|e|(e.name.clone(),extraction.path().join(&e.name))).collect();
        let bad=directory.path().join("bad.zip");portable_zip::write_stored(&mut File::create(&bad).unwrap(),&files,&cancel,|_,_|{}).unwrap();
        let library=Library::new(directory.path().join("library"));assert!(import_archive(&library,&bad,&cancel,&mut|_,_,_|{}).is_err());assert!(library.list("project",false).unwrap().entries.is_empty());
        let mut manifest:Manifest=serde_json::from_slice(&fs::read(base.join("manifest.json")).unwrap()).unwrap();manifest.complete=false;library::atomic_json(&base.join("manifest.json"),&manifest).unwrap();
        portable_zip::write_stored(&mut File::create(&bad).unwrap(),&files,&cancel,|_,_|{}).unwrap();assert!(import_archive(&library,&bad,&cancel,&mut|_,_,_|{}).is_err());
    }
    #[test]
    fn background_jobs_publish_terminal_results_and_cancel_cannot_reverse_a_completed_commit(){
        let directory=tempfile::tempdir().unwrap();let project=fixture(directory.path());let library=Arc::new(Library::new(directory.path().join("library")));
        let logger=crate::diagnostics::DiagnosticLog::open(directory.path(),"2.0.0-rc.1").unwrap();
        let jobs=Archives::new(library.clone()).with_diagnostics(Some(logger));let zip=directory.path().join("job.zip");
        let wait=|id:&str|{for _ in 0..1000{if let Some(progress)=jobs.progress(id){if progress.state!="running"{return progress;}}std::thread::sleep(std::time::Duration::from_millis(2));}panic!("archive background task timeout");};
        let id=jobs.start_export(project.clone(),zip.clone(),None).unwrap();let done=wait(&id);assert_eq!(done.state,"completed");assert_eq!(done.completed,done.total);assert!(done.path.is_some());
        jobs.cancel(&id);assert_eq!(jobs.progress(&id).unwrap().state,"completed");
        let duplicate=jobs.start_export(project,zip.clone(),None).unwrap();let failed=wait(&duplicate);assert_eq!(failed.state,"failed");assert!(failed.error.is_some());assert!(failed.result.is_none());
        let import=jobs.start_import(zip).unwrap();let imported=wait(&import);assert_eq!(imported.state,"completed");assert!(imported.result.is_some());assert_eq!(library.list("project",false).unwrap().entries.len(),1);
        let log=fs::read_to_string(directory.path().join("logs/startup.jsonl")).unwrap();
        let terminal:Vec<serde_json::Value>=log.lines().map(|line|serde_json::from_str::<serde_json::Value>(line).unwrap()).filter(|row|row["stage"]=="archive").collect();
        assert_eq!(terminal.iter().map(|row|row["outcome"].as_str().unwrap()).collect::<Vec<_>>(),vec!["ok","io_failure","ok"]);
        assert!(!log.contains(directory.path().to_str().unwrap()));assert!(!log.contains("same.png"));
    }
    #[test]
    fn oversized_manifest_or_project_is_rejected_before_any_extraction_directory_is_created() {
        let directory = tempfile::tempdir().unwrap();
        let oversized = directory.path().join("oversized.json");
        File::create(&oversized).unwrap().set_len(library::MAX_DOCUMENT_BYTES + 1).unwrap();
        let small = directory.path().join("small.json"); fs::write(&small, b"{}").unwrap();
        let path = directory.path().join("oversized.zip"); let cancel = AtomicBool::new(false);
        let library = Library::new(directory.path().join("library"));
        for oversized_name in ["manifest.json", "project.json"] {
            let files = ["manifest.json", "project.json"].map(|name| {
                (format!("project/{name}"), if name == oversized_name { oversized.clone() } else { small.clone() })
            });
            portable_zip::write_stored(&mut File::create(&path).unwrap(), &files, &cancel, |_, _| {}).unwrap();
            let mut progressed = false;
            let error = import_archive(&library, &path, &cancel, &mut |_, _, _| progressed = true).unwrap_err();
            assert!(error.to_string().contains("34 MiB"));
            assert!(!progressed);
            assert!(!library.root.exists(), "metadata size must be rejected before creating extraction storage");
        }
    }
}
#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct ArchiveProgress {
    pub job_id:String,pub kind:String,pub state:String,pub completed:usize,pub total:usize,pub message:String,
    pub path:Option<String>,pub result:Option<LibraryDocument>,pub error:Option<String>,
}
#[derive(Clone)]
pub struct Archives {
    library:Arc<Library>, active:Arc<Mutex<BTreeMap<String,Arc<AtomicBool>>>>, status:Arc<Mutex<BTreeMap<String,ArchiveProgress>>>,
    diagnostics:Option<crate::diagnostics::DiagnosticLog>,
}
impl Archives {
    pub fn new(library:Arc<Library>)->Self {Self {library,active:Arc::new(Mutex::new(BTreeMap::new())),status:Arc::new(Mutex::new(BTreeMap::new())),diagnostics:None}}
    pub fn with_diagnostics(mut self, diagnostics:Option<crate::diagnostics::DiagnosticLog>)->Self { self.diagnostics=diagnostics;self }
    fn publish(&self,progress:ArchiveProgress) {
        let mut status=self.status.lock().unwrap_or_else(|e|e.into_inner());
        if status.len()>=100 {if let Some(id)=status.iter().find(|(_,p)|p.state!="running").map(|(id,_)|id.clone()){status.remove(&id);}}
        status.insert(progress.job_id.clone(),progress);
    }
    pub fn progress(&self,id:&str)->Option<ArchiveProgress>{self.status.lock().unwrap_or_else(|e|e.into_inner()).get(id).cloned()}
    pub fn cancel(&self,id:&str){if let Some(flag)=self.active.lock().unwrap_or_else(|e|e.into_inner()).get(id){flag.store(true,Ordering::Relaxed);}}
    pub fn has_active(&self)->bool{!self.active.lock().unwrap_or_else(|e|e.into_inner()).is_empty()}
    pub fn start_export(&self,project:Project,path:PathBuf,editor_state:Option<Value>)->Result<String>{
        validate_project(&project)?;
        library::validate_editor(&editor_state)?;
        self.start("export",move |_library,cancel,update|export_archive(&project,editor_state,&path,cancel,update).map(|p|(Some(p.to_string_lossy().into()),None)))
    }
    pub fn start_import(&self,path:PathBuf)->Result<String>{self.start("import",move|library,cancel,update|import_archive(library,&path,cancel,update).map(|d|(None,Some(d))))}
    fn start(&self,kind:&str,operation:impl FnOnce(&Library,&AtomicBool,&mut dyn FnMut(usize,usize,&str))->Result<(Option<String>,Option<LibraryDocument>)>+Send+'static)->Result<String>{
        let id=Uuid::new_v4().to_string();let flag=Arc::new(AtomicBool::new(false));
        {let mut active=self.active.lock().unwrap_or_else(|e|e.into_inner());if active.len()>=2 {bail!("请等待当前归档任务完成");}active.insert(id.clone(),flag.clone());}
        let initial=ArchiveProgress{job_id:id.clone(),kind:kind.into(),state:"running".into(),completed:0,total:1,message:if kind=="export"{"检查归档素材"}else{"检查归档结构"}.into(),path:None,result:None,error:None};
        self.publish(initial.clone());let service=self.clone();let job=id.clone();
        tauri::async_runtime::spawn_blocking(move||{
            let mut progress=initial;
            let outcome=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||{
                let mut update=|completed,total,message:&str|{progress.completed=completed;progress.total=total;progress.message=message.into();service.publish(progress.clone());};
                operation(&service.library,&flag,&mut update)
            }));
            match outcome {
                Ok(Ok((path,result)))=>{progress.state="completed".into();progress.completed=progress.total;progress.message="已完成".into();progress.path=path;progress.result=result;},
                Ok(Err(error))=>{progress.state=if flag.load(Ordering::Relaxed){"cancelled"}else{"failed"}.into();progress.message=if progress.state=="cancelled"{"已取消，原作品未改变"}else{"归档未完成，原作品未改变"}.into();progress.error=Some(format!("{error:#}"));},
                Err(_)=>{progress.state="failed".into();progress.message="归档任务异常，原作品未改变".into();progress.error=Some("归档工作线程异常，临时文件将自动清理".into());},
            }
            if let Some(log)=&service.diagnostics {
                let outcome=if progress.state=="failed"{crate::diagnostics::Outcome::IoFailure}else{crate::diagnostics::Outcome::Ok};
                let _=log.record(crate::diagnostics::Stage::Archive,outcome);
            }
            service.publish(progress);service.active.lock().unwrap_or_else(|e|e.into_inner()).remove(&job);
        });Ok(id)
    }
}

fn read_json_bytes(path:&Path)->Result<Vec<u8>> {
    let file=File::open(path)?;if file.metadata()?.len()>library::MAX_DOCUMENT_BYTES {bail!("归档清单或项目文件过大");}
    let mut bytes=vec![];file.take(library::MAX_DOCUMENT_BYTES+1).read_to_end(&mut bytes)?;
    if bytes.len() as u64>library::MAX_DOCUMENT_BYTES {bail!("归档项目超过读取上限");}Ok(bytes)
}
fn asset_relative(value:&str)->Result<()> {
    portable_zip::safe_name(value)?;
    let parts:Vec<_>=value.split('/').collect();
    if parts.len()!=2 || parts[0]!="assets" || !parts[1].is_ascii() || !parts[1].bytes().all(|c|c.is_ascii_alphanumeric()||matches!(c,b'-'|b'_'|b'.')) {bail!("归档素材只能使用 assets/ 下的普通文件");}
    Ok(())
}

fn portable_editor_state(mut state: Option<Value>) -> Option<Value> {
    // The standalone batch tool's logo is a local reference, not a collage asset.
    // Keep the saved layout and text while requiring a local PNG selection after migration.
    if let Some(watermark) = state.as_mut()
        .and_then(|value| value.pointer_mut("/outputSettings/watermark"))
        .and_then(Value::as_object_mut)
    {
        watermark.remove("watermarkPath");
    }
    state
}

pub(crate) fn export_archive(project:&Project,editor_state:Option<Value>,destination:&Path,cancel:&AtomicBool,progress:&mut dyn FnMut(usize,usize,&str))->Result<PathBuf> {
    validate_project(project)?;
    if !destination.extension().is_some_and(|s|s.eq_ignore_ascii_case("zip")){bail!("归档文件必须使用 .zip 扩展名");}
    let parent=destination.parent().context("归档位置无效")?.canonicalize()?;
    let destination=parent.join(destination.file_name().context("归档名称无效")?);
    if destination.exists() || fs::symlink_metadata(&destination).is_ok(){bail!("归档文件已存在，请选择新名称；已有备份不会覆盖");}
    let staging=tempfile::tempdir_in(&parent)?;fs::create_dir(staging.path().join("assets"))?;
    let mut portable=project.clone();let mut manifest_assets=vec![];let mut entries=vec![];let mut total_bytes=0u64;
    let root=storage::safe_prefix(&project.name);let total=project.assets.len()+3;
    for (index,asset) in portable.assets.values_mut().enumerate(){
        portable_zip::check_cancel(cancel)?;
        let extension=if asset.format.eq_ignore_ascii_case("png"){"png"}else{"jpg"};
        let relative=format!("assets/{:06}.{extension}",index+1);let target=staging.path().join(&relative);
        let (bytes,hash)=portable_zip::copy_with_cancel(Path::new(&asset.original_path),&target,cancel).with_context(||format!("素材未连接或读取失败：{}",asset.file_name))?;
        if hash!=asset.fingerprint{bail!("原图已变化，请先重新扫描再归档：{}",asset.file_name);}
        total_bytes=total_bytes.checked_add(bytes).context("素材总长度溢出")?;if total_bytes>portable_zip::MAX_TOTAL{bail!("归档素材超过 2 GiB 安全上限");}
        let inspected=assets::inspect(&target,Some(asset.id.clone()))?;
        if (inspected.width,inspected.height)!=(asset.width,asset.height){bail!("原图尺寸与项目记录不一致，请重新扫描");}
        manifest_assets.push(ManifestAsset{asset_id:asset.id.clone(),path:relative.clone(),bytes,blake3:hash,width:asset.width,height:asset.height,file_name:asset.file_name.clone()});
        asset.original_path=relative.clone();asset.source_root=None;asset.relative_path=Some(relative.clone());asset.initial_path=None;asset.previous_roots.clear();asset.file_size=Some(bytes);
        entries.push((format!("{root}/{relative}"),target));progress(index+1,total,"复制并校验原始素材");
    }
    validate_project(&portable)?;
    let project_path=staging.path().join("project.json");library::atomic_json(&project_path,&portable)?;
    let project_hash=blake3::hash(&fs::read(&project_path)?).to_hex().to_string();
    let manifest=Manifest{format_version:2,document_version:portable.schema_version,engine_version:portable.engine_version,complete:true,created_at:library::now(),project_file:"project.json".into(),project_blake3:project_hash,assets:manifest_assets,editor_state:portable_editor_state(editor_state)};
    let manifest_path=staging.path().join("manifest.json");library::atomic_json(&manifest_path,&manifest)?;
    entries.push((format!("{root}/project.json"),project_path));entries.push((format!("{root}/manifest.json"),manifest_path));
    let mut zip=tempfile::NamedTempFile::new_in(&parent)?;
    portable_zip::write_stored(zip.as_file_mut(),&entries,cancel,|done,count|progress(done,count+1,"写入 ZIP 归档"))?;
    progress(entries.len(),entries.len()+1,"校验归档完整性");
    let directory=portable_zip::read_directory_with_cancel(zip.path(),cancel)?;portable_zip::verify(zip.path(),&directory,cancel)?;
    portable_zip::check_cancel(cancel)?;
    zip.persist_noclobber(&destination).map_err(|e|e.error).context("归档提交失败，已有文件未覆盖")?;
    storage::sync_parent(&destination);progress(entries.len()+1,entries.len()+1,"归档已完成");Ok(destination)
}

pub(crate) fn import_archive(library:&Library,path:&Path,cancel:&AtomicBool,progress:&mut dyn FnMut(usize,usize,&str))->Result<LibraryDocument>{
    let entries=portable_zip::read_directory_with_cancel(path,cancel)?;
    let manifests:Vec<_>=entries.iter().filter(|e|!e.directory && (e.name=="manifest.json"||e.name.ends_with("/manifest.json"))).collect();
    if manifests.len()!=1{bail!("归档必须包含唯一 manifest.json");}
    let prefix=manifests[0].name.strip_suffix("manifest.json").unwrap();
    if prefix.trim_end_matches('/').contains('/'){bail!("归档顶层结构无效");}
    for entry in &entries {
        let relative=entry.name.strip_prefix(prefix).context("归档包含根目录之外的文件")?;
        if entry.directory {if !matches!(relative,""|"assets/"|"previews/"){bail!("归档目录结构无效");}continue;}
        // Reject oversized metadata from the validated central directory before
        // allocating disk space for extraction. The byte reader repeats this
        // check after extraction as defense against inconsistent input.
        if matches!(relative,"manifest.json"|"project.json") && entry.size>library::MAX_DOCUMENT_BYTES {bail!("归档清单或项目文件超过 34 MiB 安全上限");}
        if !matches!(relative,"manifest.json"|"project.json") && !relative.starts_with("previews/"){asset_relative(relative)?;}
        if relative.starts_with("previews/") && (relative.split('/').count()!=2 || !relative.ends_with(".png")){bail!("归档预览路径无效");}
    }
    fs::create_dir_all(&library.root)?;let extracted=tempfile::tempdir_in(&library.root)?;
    portable_zip::extract(path,&entries,extracted.path(),cancel,|done,total|progress(done,total+2,"安全解压与 CRC 校验"))?;
    let folder=extracted.path().join(prefix);
    let manifest:Manifest=serde_json::from_slice(&read_json_bytes(&folder.join("manifest.json"))?).context("归档清单格式无效")?;
    if manifest.format_version!=2 || manifest.document_version!=1 || manifest.engine_version!=1 || !manifest.complete || manifest.project_file!="project.json"{bail!("归档版本不支持或未标记为完整备份");}
    let bytes=read_json_bytes(&folder.join("project.json"))?;
    if blake3::hash(&bytes).to_hex().as_str()!=manifest.project_blake3{bail!("归档项目完整性校验失败");}
    let project:Project=serde_json::from_slice(&bytes).context("归档项目格式无效")?;validate_project(&project)?;
    if project.assets.len()!=manifest.assets.len(){bail!("归档素材数量与项目不一致");}
    let mut seen=BTreeSet::new();let mut seen_paths=BTreeSet::new();
    for (index,record) in manifest.assets.iter().enumerate(){
        portable_zip::check_cancel(cancel)?;asset_relative(&record.path)?;
        if !seen.insert(record.asset_id.clone())||!seen_paths.insert(record.path.clone()){bail!("归档素材映射重复");}
        let asset=project.assets.get(&record.asset_id).context("归档存在无对应记录的素材")?;
        if asset.original_path!=record.path || asset.fingerprint!=record.blake3 || asset.width!=record.width || asset.height!=record.height {bail!("归档素材映射与项目记录不一致");}
        let file=folder.join(&record.path);
        if fs::metadata(&file)?.len()!=record.bytes{bail!("归档素材大小校验失败");}
        let inspected=assets::inspect(&file,Some(asset.id.clone()))?;
        if inspected.fingerprint!=record.blake3 || (inspected.width,inspected.height)!=(record.width,record.height){bail!("归档原图内容或尺寸校验失败");}
        progress(index+1,manifest.assets.len()+1,"验证素材指纹与尺寸");
    }
    for entry in entries.iter().filter(|e|!e.directory){let relative=entry.name.strip_prefix(prefix).unwrap();if relative.starts_with("assets/")&&!seen_paths.contains(relative){bail!("归档包含清单未登记的素材");}}
    portable_zip::check_cancel(cancel)?;progress(manifest.assets.len(),manifest.assets.len()+1,"安装为独立项目");
    let result=library.install_import(project,portable_editor_state(manifest.editor_state),&folder,cancel)?;
    progress(manifest.assets.len()+1,manifest.assets.len()+1,"归档已导入");Ok(result)
}
