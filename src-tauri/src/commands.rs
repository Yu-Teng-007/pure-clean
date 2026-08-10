use tauri::AppHandle;

use crate::clean;
use crate::config::{self, AppConfig};
use crate::drives;
use crate::history;
use crate::model::{
    Category, CleanReport, CleanRequest, CleanTarget, DriveInfo, HistoryEntry, ScanRequest,
    ScanResult, ScanRoot,
};
use crate::scan;

#[tauri::command]
pub fn get_default_roots() -> Vec<ScanRoot> {
    let mut roots = Vec::new();
    let yhdja = std::path::PathBuf::from(r"D:\YHDJA");
    if yhdja.is_dir() {
        roots.push(ScanRoot {
            path: yhdja.to_string_lossy().to_string(),
            kind: "project".into(),
            label: "项目根目录 (D:\\YHDJA)".into(),
        });
    }
    roots.push(ScanRoot {
        path: "(全局缓存与系统路径)".into(),
        kind: "global".into(),
        label: "全局缓存 / 系统临时 / 浏览器".into(),
    });
    roots
}

#[tauri::command]
pub fn get_categories() -> Vec<serde_json::Value> {
    Category::all()
        .into_iter()
        .map(|c| {
            serde_json::json!({
                "id": c,
                "label": c.label(),
            })
        })
        .collect()
}

#[tauri::command]
pub fn load_config() -> AppConfig {
    config::load_config()
}

#[tauri::command]
pub fn save_config(config: AppConfig) -> Result<(), String> {
    config::save_config(&config)
}

#[tauri::command]
pub fn scan(app: AppHandle, request: ScanRequest) -> ScanResult {
    let max_depth = request.max_depth.unwrap_or(6);
    let cfg = config::load_config();
    let protected = request
        .protected_paths
        .unwrap_or(cfg.protected_paths);
    scan::run_scan(
        &app,
        &request.roots,
        request.categories,
        max_depth,
        request.min_file_bytes,
        request.stale_days,
        request.safe_only.unwrap_or(false),
        &protected,
    )
}

#[tauri::command]
pub fn clean(app: AppHandle, request: CleanRequest) -> CleanReport {
    let cfg = config::load_config();
    let protected = request
        .protected_paths
        .clone()
        .unwrap_or_else(|| cfg.protected_paths.clone());
    let dry_run = request.dry_run.unwrap_or(false);
    let to_recycle = request
        .to_recycle_bin
        .unwrap_or(cfg.to_recycle_bin_by_default);

    let mut targets: Vec<CleanTarget> = request.targets.unwrap_or_default();
    if targets.is_empty() {
        for path in request.paths.unwrap_or_default() {
            targets.push(CleanTarget {
                path,
                category: None,
                bytes: None,
                special: None,
            });
        }
        for special in request.specials.unwrap_or_default() {
            targets.push(CleanTarget {
                path: special.clone(),
                category: None,
                bytes: None,
                special: Some(special),
            });
        }
    }

    let report = clean::run_clean(&app, &targets, dry_run, to_recycle, &protected);

    let _ = history::append_history(HistoryEntry {
        id: format!(
            "{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        ),
        timestamp: chrono_like_now(),
        mode: None,
        freed_bytes: report.freed_bytes,
        success_count: report.success_count,
        failure_count: report.failures.len(),
        dry_run: report.dry_run,
        to_recycle_bin: report.to_recycle_bin,
        by_category: report.by_category.clone(),
    });

    report
}

fn chrono_like_now() -> String {
    // Local-ish ISO without extra crate: use UTC offset via Windows localtime is heavy;
    // store RFC3339-ish UTC from system clock seconds.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Simple YYYY-MM-DD HH:MM:SS UTC
    let days = secs / 86400;
    let tod = secs % 86400;
    let hour = tod / 3600;
    let min = (tod % 3600) / 60;
    let sec = tod % 60;
    // Civil date from days since epoch (1970-01-01)
    let (y, m, d) = civil_from_days(days as i64);
    format!("{y:04}-{m:02}-{d:02} {hour:02}:{min:02}:{sec:02} UTC")
}

fn civil_from_days(days: i64) -> (i32, u32, u32) {
    // Howard Hinnant algorithm
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

#[tauri::command]
pub fn format_bytes(bytes: u64) -> String {
    crate::scan::size::format_size(bytes)
}

#[tauri::command]
pub fn list_drives() -> Vec<DriveInfo> {
    drives::list_drives()
}

#[tauri::command]
pub fn load_history() -> Vec<HistoryEntry> {
    history::load_history()
}
