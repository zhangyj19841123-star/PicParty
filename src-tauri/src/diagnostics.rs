//! Privacy-preserving startup diagnostics. No project, source path, error text,
//! panic payload, account identity, address or credentials enter these records.
use serde::Serialize;
use std::{fs::{self, OpenOptions}, io::{self, Write}, path::{Path, PathBuf}, time::{SystemTime, UNIX_EPOCH}};

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Stage { Entry, Services, Menus, Ready, ProjectRead, ProjectWrite, AssetScan, Archive, Panic }
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome { Ok, PermissionDenied, InvalidData, MissingSource, IoFailure, InitializationFailure, Panic }

#[derive(Clone)]
pub struct DiagnosticLog { path: PathBuf, version: String, system_version: String }

fn timestamp() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() }

fn system_version() -> String {
    #[cfg(target_os = "macos")]
    if let Ok(output) = std::process::Command::new("/usr/bin/sw_vers").arg("-productVersion").output() {
        let value = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        if output.status.success() && !value.is_empty() && value.len() < 32 && value.chars().all(|c| c.is_ascii_digit() || c == '.') { return value; }
    }
    "unknown".into()
}

impl DiagnosticLog {
    pub fn open(app_data: &Path, version: &str) -> io::Result<Self> {
        let directory = app_data.join("logs");
        if fs::symlink_metadata(&directory).is_ok_and(|m| m.file_type().is_symlink()) { return Err(io::Error::new(io::ErrorKind::PermissionDenied, "diagnostics_directory_link")); }
        fs::create_dir_all(&directory)?;
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
        }
        let path = directory.join("startup.jsonl");
        if fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) { return Err(io::Error::new(io::ErrorKind::PermissionDenied, "diagnostics_file_link")); }
        // Keep previous diagnostics rather than overwriting them during rotation.
        if fs::metadata(&path).is_ok_and(|m| m.len() > 1024 * 1024) {
            fs::rename(&path, directory.join(format!("startup-{}-{}.jsonl", timestamp(), uuid::Uuid::new_v4())))?;
        }
        let version = if version.len() <= 64 && version.chars().all(|c| c.is_ascii_alphanumeric() || ".-+".contains(c)) { version.into() } else { "unknown".into() };
        let logger = Self { path, version, system_version: system_version() };
        logger.record(Stage::Entry, Outcome::Ok)?;
        Ok(logger)
    }

    pub fn record(&self, stage: Stage, outcome: Outcome) -> io::Result<()> {
        #[derive(Serialize)]
        struct Record<'a> { schema_version: u8, timestamp: u64, version: &'a str, architecture: &'static str, system: &'static str, system_version: &'a str, stage: Stage, outcome: Outcome }
        let row = Record { schema_version: 1, timestamp: timestamp(), version: &self.version, architecture: std::env::consts::ARCH, system: std::env::consts::OS, system_version: &self.system_version, stage, outcome };
        let mut options = OpenOptions::new(); options.create(true).append(true);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        let mut file = options.open(&self.path)?;
        let mut bytes = serde_json::to_vec(&row)?; bytes.push(b'\n');
        file.write_all(&bytes)?; file.sync_data()
    }

    pub fn install_panic_hook(&self) {
        let logger = self.clone();
        let _ = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |_information| {
            let _ = logger.record(Stage::Panic, Outcome::Panic);
            eprintln!("The application encountered an internal error; see the startup diagnostics.");
        }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn logs_only_controlled_fields_and_appends_without_sensitive_input() {
        let directory = tempfile::tempdir().unwrap();
        let logger = DiagnosticLog::open(directory.path(), "2.0.0-rc.1").unwrap();
        logger.record(Stage::Services, Outcome::PermissionDenied).unwrap();
        let bytes = fs::read_to_string(directory.path().join("logs/startup.jsonl")).unwrap();
        let rows: Vec<serde_json::Value> = bytes.lines().map(|line| serde_json::from_str(line).unwrap()).collect();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["stage"], "entry"); assert_eq!(rows[1]["outcome"], "permission_denied");
        assert_eq!(rows[0].as_object().unwrap().len(), 8);
        assert!(!bytes.contains(directory.path().to_str().unwrap()));
        assert!(!bytes.contains("/Users/"));
        #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; assert_eq!(fs::metadata(directory.path().join("logs/startup.jsonl")).unwrap().permissions().mode() & 0o777, 0o600); }
    }
    #[test]
    fn rejects_arbitrary_version_text_and_retains_earlier_records() {
        let directory = tempfile::tempdir().unwrap();
        DiagnosticLog::open(directory.path(), "/Users/private/photo.png").unwrap();
        DiagnosticLog::open(directory.path(), "2.0.0").unwrap();
        let bytes = fs::read_to_string(directory.path().join("logs/startup.jsonl")).unwrap();
        let rows: Vec<serde_json::Value> = bytes.lines().map(|line| serde_json::from_str(line).unwrap()).collect();
        assert_eq!(rows[0]["version"], "unknown"); assert_eq!(rows.len(), 2);
    }
    #[test]
    #[cfg(unix)]
    fn does_not_follow_a_log_file_symlink() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir(directory.path().join("logs")).unwrap();
        let original = directory.path().join("original"); fs::write(&original, b"preserve").unwrap();
        std::os::unix::fs::symlink(&original, directory.path().join("logs/startup.jsonl")).unwrap();
        assert!(DiagnosticLog::open(directory.path(), "2.0.0").is_err());
        assert_eq!(fs::read(original).unwrap(), b"preserve");
    }
}
