use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter};

use crate::drives;
use crate::model::{AnalyzeProgress, AnalyzeResult, DiskUsageEntry};
use crate::scan::size::dir_size_bytes;

/// Only list AppData\Local children at or above this size (200 MB).
const LOCAL_CHILD_MIN_BYTES: u64 = 200 * 1024 * 1024;
/// Dot-folders under the user profile (500 MB).
const DOT_DIR_MIN_BYTES: u64 = 500 * 1024 * 1024;

fn emit(app: &AppHandle, path: &str, entries_found: usize) {
    let _ = app.emit(
        "analyze_progress",
        AnalyzeProgress {
            current_path: path.to_string(),
            entries_found,
        },
    );
}

fn hint_for_path(path: &Path) -> Option<String> {
    let lower = path.to_string_lossy().to_ascii_lowercase();
    if lower.contains("\\cache")
        || lower.contains("\\temp")
        || lower.contains("npm-cache")
        || lower.contains("yarn\\cache")
        || lower.contains("thumbcache")
        || lower.contains("deliveryoptimization")
        || lower.contains("optguide")
        || lower.contains("crashdumps")
        || lower.contains("wer")
    {
        return Some("可尝试清理（缓存/临时）".into());
    }
    if lower.contains("\\docker")
        || lower.contains("android\\sdk")
        || lower.contains(".gradle")
        || lower.contains("ms-playwright")
        || lower.contains("vm_bundles")
        || lower.contains("\\packages\\")
    {
        return Some("占用较大，部分可清理或需手动卸载".into());
    }
    if lower.contains("\\program files")
        || lower.contains("\\windows")
        || lower.ends_with("\\users")
    {
        return Some("系统/程序本体，不可直接删除".into());
    }
    if lower.contains("\\documents")
        || lower.contains("\\downloads")
        || lower.contains("\\desktop")
    {
        return Some("个人文件，请自行整理".into());
    }
    None
}

fn push_entry(
    entries: &mut Vec<DiskUsageEntry>,
    path: PathBuf,
    group: &str,
    label: Option<String>,
) {
    if !path.exists() {
        return;
    }
    let path_str = path.to_string_lossy().to_string();
    let bytes = dir_size_bytes(&path);
    if bytes == 0 {
        return;
    }
    entries.push(DiskUsageEntry {
        path: path_str.clone(),
        bytes,
        group: group.to_string(),
        group_label: label.unwrap_or_else(|| group.to_string()),
        hint: hint_for_path(&path),
    });
}

/// Break down where space on a drive is consumed. Inner groups are subsets of outer
/// (e.g. AppData\\Local items sit inside C:\\Users).
pub fn analyze_disk_usage(app: &AppHandle, drive: Option<String>) -> AnalyzeResult {
    let drive_root = drive.unwrap_or_else(|| "C:\\".to_string());
    let root = PathBuf::from(&drive_root);

    let drive_info = drives::list_drives()
        .into_iter()
        .find(|d| d.name.eq_ignore_ascii_case(&drive_root))
        .or_else(|| {
            drives::list_drives()
                .into_iter()
                .find(|d| drive_root.starts_with(&d.name))
        });

    let (drive_total_bytes, drive_free_bytes) = drive_info
        .map(|d| (d.total_bytes, d.free_bytes))
        .unwrap_or((0, 0));
    let drive_used_bytes = drive_total_bytes.saturating_sub(drive_free_bytes);

    let mut entries = Vec::new();

    // --- Level 1: drive root (disjoint top-level folders + large root files) ---
    emit(app, &drive_root, entries.len());
    if root.is_dir() {
        if let Ok(read) = std::fs::read_dir(&root) {
            for entry in read.flatten() {
                let path = entry.path();
                emit(app, &path.to_string_lossy(), entries.len());
                if path.is_dir() {
                    push_entry(
                        &mut entries,
                        path,
                        "drive_root",
                        Some("磁盘根目录".into()),
                    );
                } else if let Ok(meta) = entry.metadata() {
                    if meta.is_file() && meta.len() >= 256 * 1024 * 1024 {
                        let name = entry.file_name().to_string_lossy().to_string();
                        entries.push(DiskUsageEntry {
                            path: path.to_string_lossy().to_string(),
                            bytes: meta.len(),
                            group: "drive_root".into(),
                            group_label: "磁盘根目录（系统文件）".into(),
                            hint: Some(format!("系统文件 {name}，勿手动删除")),
                        });
                    }
                }
            }
        }
    }

    // --- Level 2: current user profile ---
    if let Some(home) = dirs::home_dir() {
        let profile_sections: [(&str, PathBuf); 7] = [
            ("AppData\\Local", home.join("AppData").join("Local")),
            ("AppData\\Roaming", home.join("AppData").join("Roaming")),
            ("Documents", home.join("Documents")),
            ("Downloads", home.join("Downloads")),
            ("Desktop", home.join("Desktop")),
            (".gradle", home.join(".gradle")),
            (".cargo", home.join(".cargo")),
        ];
        for (label, path) in profile_sections {
            emit(app, &path.to_string_lossy(), entries.len());
            if path.exists() {
                entries.push(DiskUsageEntry {
                    path: path.to_string_lossy().to_string(),
                    bytes: dir_size_bytes(&path),
                    group: "user_profile".into(),
                    group_label: format!("用户目录 · {label}"),
                    hint: hint_for_path(&path),
                });
            }
        }

        // --- Level 3: AppData\Local top-level apps (often the hidden bulk) ---
        let local = home.join("AppData").join("Local");
        if local.is_dir() {
            if let Ok(read) = std::fs::read_dir(&local) {
                for entry in read.flatten() {
                    let path = entry.path();
                    if !path.is_dir() {
                        continue;
                    }
                    emit(app, &path.to_string_lossy(), entries.len());
                    let bytes = dir_size_bytes(&path);
                    if bytes >= LOCAL_CHILD_MIN_BYTES {
                        let name = entry.file_name().to_string_lossy().to_string();
                        entries.push(DiskUsageEntry {
                            path: path.to_string_lossy().to_string(),
                            bytes,
                            group: "app_data_local".into(),
                            group_label: "AppData\\Local 应用".into(),
                            hint: hint_for_path(&path).or(Some(format!(
                                "应用数据 · {name}（请确认后清理）"
                            ))),
                        });
                    }
                }
            }
        }

        // Hidden dot-folders in profile root (.gradle, .cache, etc.)
        if home.is_dir() {
            if let Ok(read) = std::fs::read_dir(&home) {
                for entry in read.flatten() {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if !name.starts_with('.') {
                        continue;
                    }
                    let path = entry.path();
                    if !path.is_dir() {
                        continue;
                    }
                    // Already listed explicitly above
                    if name.eq_ignore_ascii_case(".gradle") || name.eq_ignore_ascii_case(".cargo") {
                        continue;
                    }
                    emit(app, &path.to_string_lossy(), entries.len());
                    let bytes = dir_size_bytes(&path);
                    if bytes >= DOT_DIR_MIN_BYTES {
                        entries.push(DiskUsageEntry {
                            path: path.to_string_lossy().to_string(),
                            bytes,
                            group: "user_dot".into(),
                            group_label: "用户隐藏目录".into(),
                            hint: hint_for_path(&path),
                        });
                    }
                }
            }
        }
    }

    entries.sort_by(|a, b| b.bytes.cmp(&a.bytes));

    emit(app, "完成", entries.len());

    AnalyzeResult {
        drive: drive_root,
        drive_total_bytes,
        drive_used_bytes,
        drive_free_bytes,
        entries,
    }
}
