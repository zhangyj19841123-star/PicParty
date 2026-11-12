use anyhow::{bail, Context, Result};
use collage_core::{validate_project, Project};
use std::{fs::{self, File}, io::{Read, Write}, path::{Path, PathBuf}};

const MAX_PROJECT_BYTES: u64 = 32 * 1024 * 1024;

/// Resolve a chosen destination without following a final symlink during the atomic rename.
/// A project may only replace another .collage file, never one of its source photographs.
pub fn project_destination(path: &Path, project: &Project) -> Result<PathBuf> {
    if !path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("collage")) {
        bail!("项目文件必须使用 .collage 扩展名");
    }
    let parent = path.parent().context("无效的项目路径")?.canonicalize()?;
    let result = parent.join(path.file_name().context("无效的项目名称")?);
    if fs::symlink_metadata(&result).is_ok_and(|m| m.file_type().is_symlink()) {
        bail!("不能将项目保存到符号链接，请选择普通文件");
    }
    for asset in project.assets.values() {
        let source = Path::new(&asset.original_path);
        if source == result || source.canonicalize().is_ok_and(|p| p == result) {
            bail!("不能覆盖原始照片");
        }
    }
    Ok(result)
}

pub fn save(project: &Project, path: &Path) -> Result<()> {
    validate_project(project)?;
    let path = project_destination(path, project)?;
    let bytes = serde_json::to_vec_pretty(project)?;
    if bytes.len() as u64 > MAX_PROJECT_BYTES { bail!("项目文件超过 32 MB 上限"); }
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().unwrap())?;
    temp.write_all(&bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(&path).map_err(|error| error.error).context("保存项目失败，原项目保持不变")?;
    sync_parent(&path);
    Ok(())
}

pub fn load(path: &Path) -> Result<Project> {
    let mut file = File::open(path).context("无法打开项目文件")?;
    if file.metadata()?.len() > MAX_PROJECT_BYTES { bail!("项目文件超过 32 MB 上限"); }
    let mut bytes = Vec::new();
    Read::by_ref(&mut file).take(MAX_PROJECT_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_PROJECT_BYTES { bail!("项目文件超过 32 MB 上限"); }
    let mut project: Project = serde_json::from_slice(&bytes).context("项目格式无效或需要更新版本的应用")?;
    // Portable project files may refer to originals relative to the project folder.
    let parent = path.parent().context("项目没有父目录")?.canonicalize()?;
    for asset in project.assets.values_mut() {
        if Path::new(&asset.original_path).is_relative() {
            asset.original_path = parent.join(&asset.original_path).to_string_lossy().to_string();
        }
    }
    validate_project(&project)?;
    Ok(project)
}

pub fn sync_parent(path: &Path) {
    if let Some(parent) = path.parent() {
        if let Ok(file) = File::open(parent) { let _ = file.sync_all(); }
    }
}

pub fn safe_prefix(value: &str) -> String {
    let cleaned: String = value.chars().filter(|c| !c.is_control() && !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')).take(100).collect();
    let cleaned = cleaned.trim().trim_matches('.').trim();
    if cleaned.is_empty() { "拼图".into() } else { cleaned.into() }
}

/// Atomic, exclusive commit. Even an existing original with an identical filename is untouched.
pub fn commit_export(temp: tempfile::NamedTempFile, directory: &Path, stem: &str, extension: &str) -> Result<PathBuf> {
    let mut temp = temp;
    for suffix in 0..10000 {
        let name = if suffix == 0 { format!("{stem}.{extension}") } else { format!("{stem}-{suffix}.{extension}") };
        let destination = directory.join(name);
        match temp.persist_noclobber(&destination) {
            Ok(_) => { sync_parent(&destination); return Ok(destination); }
            Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => { temp = error.file; }
            Err(error) => return Err(error.error.into()),
        }
    }
    bail!("文件名重复过多，请选择其他导出前缀")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn export_never_clobbers_original_or_previous_output() {
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join("照片-01.png");
        fs::write(&original, b"original pixels").unwrap();
        let mut file = tempfile::NamedTempFile::new_in(dir.path()).unwrap();
        file.write_all(b"exported pixels").unwrap();
        let output = commit_export(file, dir.path(), "照片-01", "png").unwrap();
        assert_eq!(fs::read(original).unwrap(), b"original pixels");
        assert_eq!(output.file_name().unwrap(), "照片-01-1.png");
        assert_eq!(fs::read(output).unwrap(), b"exported pixels");
    }

    #[test]
    fn export_prefix_cannot_escape_output_directory() {
        assert_eq!(safe_prefix("../../../../"), "拼图");
        assert_eq!(safe_prefix("日记/旅行:2026"), "日记旅行2026");
    }
}
