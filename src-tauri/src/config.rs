use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::model::Category;

pub const DEFAULT_MIN_FILE_BYTES: u64 = 500 * 1024 * 1024;
pub const DEFAULT_STALE_DAYS: u64 = 30;
pub const DEFAULT_DUPE_MIN_BYTES: u64 = 10 * 1024 * 1024;

/// Common subdirectory names under home or drive roots that often hold projects.
const PROJECT_DIR_NAMES: &[&str] = &[
    "Projects",
    "projects",
    "code",
    "dev",
    "workspace",
    "src",
    "repos",
    "development",
    "MYCode",
    "YHDJA",
];

fn push_unique_dir(out: &mut Vec<String>, seen: &mut HashSet<String>, path: PathBuf) {
    if !path.is_dir() {
        return;
    }
    let canonical = path
        .canonicalize()
        .unwrap_or(path)
        .to_string_lossy()
        .to_string();
    let key = normalize_path_str(&canonical);
    if key.is_empty() || !seen.insert(key) {
        return;
    }
    out.push(canonical);
}

/// Discover likely project / code directories on this machine.
pub fn discover_default_scan_roots() -> Vec<String> {
    let mut roots = Vec::new();
    let mut seen = HashSet::new();

    if let Some(home) = dirs::home_dir() {
        for name in PROJECT_DIR_NAMES {
            push_unique_dir(&mut roots, &mut seen, home.join(name));
        }
        if let Some(desktop) = dirs::desktop_dir() {
            for name in ["Projects", "projects", "code"] {
                push_unique_dir(&mut roots, &mut seen, desktop.join(name));
            }
        }
        if let Some(docs) = dirs::document_dir() {
            for name in ["Projects", "projects", "code"] {
                push_unique_dir(&mut roots, &mut seen, docs.join(name));
            }
        }
    }

    // Scan drive letters C–Z for common dev folder names (fast is_dir checks only).
    for letter in b'C'..=b'Z' {
        let drive = PathBuf::from(format!("{}:\\", letter as char));
        if !drive.is_dir() {
            continue;
        }
        for name in PROJECT_DIR_NAMES {
            push_unique_dir(&mut roots, &mut seen, drive.join(name));
        }
    }

    roots
}

fn default_min_file_bytes() -> u64 {
    DEFAULT_MIN_FILE_BYTES
}

fn default_stale_days() -> u64 {
    DEFAULT_STALE_DAYS
}

fn default_protected() -> Vec<String> {
    Vec::new()
}

fn default_recycle() -> bool {
    false
}

fn default_schedule_enabled() -> bool {
    false
}

fn default_schedule_days() -> u64 {
    7
}

fn default_schedule_hour() -> u32 {
    10
}

fn default_run_in_tray() -> bool {
    true
}

fn default_check_updates() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub scan_roots: Vec<String>,
    pub enabled_categories: Vec<Category>,
    pub select_caution_by_default: bool,
    #[serde(default = "default_min_file_bytes")]
    pub min_file_bytes: u64,
    #[serde(default = "default_stale_days")]
    pub stale_days: u64,
    #[serde(default = "default_protected")]
    pub protected_paths: Vec<String>,
    #[serde(default = "default_recycle")]
    pub to_recycle_bin_by_default: bool,
    #[serde(default = "default_schedule_enabled")]
    pub schedule_reminder_enabled: bool,
    #[serde(default = "default_schedule_days")]
    pub schedule_reminder_days: u64,
    #[serde(default = "default_schedule_hour")]
    pub schedule_reminder_hour: u32,
    #[serde(default)]
    pub last_reminder_at: Option<String>,
    #[serde(default = "default_run_in_tray")]
    pub run_in_tray: bool,
    #[serde(default = "default_check_updates")]
    pub check_updates_on_start: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            scan_roots: discover_default_scan_roots(),
            enabled_categories: Category::all(),
            select_caution_by_default: false,
            min_file_bytes: DEFAULT_MIN_FILE_BYTES,
            stale_days: DEFAULT_STALE_DAYS,
            protected_paths: Vec::new(),
            to_recycle_bin_by_default: false,
            schedule_reminder_enabled: false,
            schedule_reminder_days: 7,
            schedule_reminder_hour: 10,
            last_reminder_at: None,
            run_in_tray: true,
            check_updates_on_start: true,
        }
    }
}

pub fn config_dir() -> Result<PathBuf, String> {
    let base = dirs::config_dir().ok_or_else(|| "无法定位配置目录".to_string())?;
    let dir = base.join("pure-clean");
    fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {e}"))?;
    Ok(dir)
}

fn config_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("config.json"))
}

pub fn load_config() -> AppConfig {
    let path = match config_path() {
        Ok(p) => p,
        Err(_) => return AppConfig::default(),
    };
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => AppConfig::default(),
    }
}

pub fn save_config(config: &AppConfig) -> Result<(), String> {
    let path = config_path()?;
    let text =
        serde_json::to_string_pretty(config).map_err(|e| format!("序列化配置失败: {e}"))?;
    fs::write(&path, text).map_err(|e| format!("写入配置失败: {e}"))
}

/// Returns true if `path` is equal to or under any protected path.
pub fn is_protected(path: &Path, protected: &[String]) -> bool {
    if protected.is_empty() {
        return false;
    }
    let path_str = normalize_path_str(&path.to_string_lossy());
    for p in protected {
        let prot = normalize_path_str(p);
        if prot.is_empty() {
            continue;
        }
        if path_str == prot || path_str.starts_with(&(prot.clone() + "\\")) {
            return true;
        }
    }
    false
}

fn normalize_path_str(s: &str) -> String {
    let trimmed = s.trim().trim_end_matches(['/', '\\']);
    let mut out = String::with_capacity(trimmed.len());
    for ch in trimmed.chars() {
        if ch == '/' {
            out.push('\\');
        } else {
            out.push(ch.to_ascii_lowercase());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn is_protected_exact_match() {
        assert!(is_protected(
            Path::new(r"D:\Projects\secret"),
            &[r"D:\Projects\secret".into()],
        ));
    }

    #[test]
    fn is_protected_child_path() {
        assert!(is_protected(
            Path::new(r"D:\Projects\secret\build\out"),
            &[r"D:\Projects\Secret".into()],
        ));
    }

    #[test]
    fn is_protected_ignores_unrelated_prefix() {
        assert!(!is_protected(
            Path::new(r"D:\Projects\public"),
            &[r"D:\Projects\secret".into()],
        ));
    }

    #[test]
    fn normalize_path_str_unifies_slashes_and_case() {
        assert_eq!(
            normalize_path_str(r"D:/Projects/Code"),
            r"d:\projects\code"
        );
    }
}
