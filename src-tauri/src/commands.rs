use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter};

use crate::clean;
use crate::config::{self, AppConfig};
use crate::drives;
use crate::hardware::{self, HardwareInfo};
use crate::history;
use crate::memory::{self, MemoryCleanReport, MemorySnapshot, ProcessMemoryItem};
use crate::model::{
    AnalyzeResult, Category, CleanReport, CleanRequest, CleanTarget, DevCacheDashboard, DriveInfo,
    HistoryEntry, OptimizePhase, OptimizeProgress, OptimizeReport, ScanRequest, ScanResult,
    ScanRoot, StartupFailure,
};
use crate::scan;
use crate::startup::{self, StartupItem};

/// Cooperative cancel flag for in-flight smart optimize.
static OPTIMIZE_CANCEL: AtomicBool = AtomicBool::new(false);
/// Cooperative cancel for regular scan / clean / dev-cache dashboard.
static SCAN_CANCEL: AtomicBool = AtomicBool::new(false);
static CLEAN_CANCEL: AtomicBool = AtomicBool::new(false);
static DEV_CACHE_CANCEL: AtomicBool = AtomicBool::new(false);

fn optimize_cancelled() -> bool {
    OPTIMIZE_CANCEL.load(Ordering::Relaxed)
}

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
    SCAN_CANCEL.store(false, Ordering::SeqCst);
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
        true,
        Some(&SCAN_CANCEL),
    )
}

#[tauri::command]
pub fn cancel_smart_optimize() {
    OPTIMIZE_CANCEL.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn cancel_scan() {
    SCAN_CANCEL.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn cancel_clean() {
    CLEAN_CANCEL.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn cancel_dev_cache_scan() {
    DEV_CACHE_CANCEL.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn clean(app: AppHandle, request: CleanRequest) -> CleanReport {
    CLEAN_CANCEL.store(false, Ordering::SeqCst);
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

    let report = clean::run_clean_with_options(
        &app,
        &targets,
        dry_run,
        to_recycle,
        &protected,
        true,
        Some(&CLEAN_CANCEL),
        None,
    );

    let _ = history::append_history(HistoryEntry {
        id: format!(
            "{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        ),
        timestamp: chrono_like_now(),
        mode: request.mode.clone(),
        freed_bytes: report.freed_bytes,
        success_count: report.success_count,
        failure_count: report.failures.len(),
        dry_run: report.dry_run,
        to_recycle_bin: report.to_recycle_bin,
        by_category: report.by_category.clone(),
    });

    report
}

#[tauri::command]
pub fn clear_history() -> Result<(), String> {
    history::clear_history()
}

#[tauri::command]
pub fn scan_dev_caches(app: AppHandle, roots: Option<Vec<String>>) -> DevCacheDashboard {
    DEV_CACHE_CANCEL.store(false, Ordering::SeqCst);
    let cfg = config::load_config();
    let scan_roots = roots.unwrap_or_else(|| cfg.scan_roots.clone());
    let protected = cfg.protected_paths.clone();
    let mut last_emit = std::time::Instant::now();
    scan::dev_cache::build_dashboard(
        &scan_roots,
        &protected,
        Some(&DEV_CACHE_CANCEL),
        |path| {
            if last_emit.elapsed() >= std::time::Duration::from_millis(200) {
                let _ = app.emit(
                    "dev_cache_progress",
                    serde_json::json!({ "currentPath": path }),
                );
                last_emit = std::time::Instant::now();
            }
        },
    )
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
pub fn analyze_disk_usage(app: AppHandle, drive: Option<String>) -> AnalyzeResult {
    crate::analyze::analyze_disk_usage(&app, drive)
}

#[tauri::command]
pub fn load_history() -> Vec<HistoryEntry> {
    history::load_history()
}

#[tauri::command]
pub fn list_startup_items() -> Vec<StartupItem> {
    startup::list_startup_items()
}

#[tauri::command]
pub fn get_hardware_info() -> HardwareInfo {
    hardware::collect()
}

#[tauri::command]
pub fn get_memory_snapshot() -> MemorySnapshot {
    memory::snapshot()
}

#[tauri::command]
pub fn list_memory_processes(limit: Option<usize>) -> Vec<ProcessMemoryItem> {
    memory::list_processes(limit)
}

#[tauri::command]
pub fn clean_memory() -> MemoryCleanReport {
    memory::clean_memory()
}

#[tauri::command]
pub fn trim_process_working_set(pid: u32) -> Result<u64, String> {
    memory::trim_process(pid)
}

#[tauri::command]
pub fn set_startup_enabled(id: String, enabled: bool) -> Result<StartupItem, String> {
    startup::set_startup_enabled(&id, enabled)
}

fn emit_optimize(app: &AppHandle, phase: OptimizePhase, message: &str) {
    let _ = app.emit(
        "optimize_progress",
        OptimizeProgress {
            phase,
            message: message.to_string(),
        },
    );
}

#[tauri::command]
pub fn run_smart_optimize(app: AppHandle) -> Result<OptimizeReport, String> {
    OPTIMIZE_CANCEL.store(false, Ordering::SeqCst);

    let cfg = config::load_config();
    let protected = cfg.protected_paths.clone();
    let to_recycle = cfg.to_recycle_bin_by_default;

    emit_optimize(&app, OptimizePhase::Scanning, "正在快速定位可安全清理的缓存…");

    // Lightweight strategy: only known fixed Safe paths (existence check).
    // Avoid project-tree walks, AppData discovery, and recursive dir sizing —
    // those froze the UI as soon as optimize opened.
    let mut last_emit = std::time::Instant::now();
    let targets = scan::collect_smart_optimize_targets(&protected, Some(&OPTIMIZE_CANCEL), |path| {
        if last_emit.elapsed() >= std::time::Duration::from_millis(200) {
            let short = path.rsplit(['\\', '/']).next().unwrap_or(path);
            emit_optimize(
                &app,
                OptimizePhase::Scanning,
                &format!("正在检查：{short}"),
            );
            last_emit = std::time::Instant::now();
        }
    });

    if optimize_cancelled() {
        return Err("cancelled".into());
    }

    emit_optimize(
        &app,
        OptimizePhase::Cleaning,
        &format!("正在清理 {} 项安全垃圾…", targets.len()),
    );

    let clean_report = if targets.is_empty() {
        CleanReport {
            freed_bytes: 0,
            success_count: 0,
            failures: Vec::new(),
            by_category: Vec::new(),
            dry_run: false,
            to_recycle_bin: to_recycle,
        }
    } else {
        let mut last_clean_emit = std::time::Instant::now();
        let mut on_item = |label: &str, done: usize, total: usize, freed: u64| {
            if last_clean_emit.elapsed() < std::time::Duration::from_millis(250) && done < total {
                return;
            }
            let short = label.rsplit(['\\', '/']).next().unwrap_or(label);
            emit_optimize(
                &app,
                OptimizePhase::Cleaning,
                &format!(
                    "清理中 {done}/{total}：{short}（已释放 {}）",
                    crate::scan::size::format_size(freed)
                ),
            );
            last_clean_emit = std::time::Instant::now();
        };
        // Silent clean_progress (avoids flooding webview); surface coarse optimize_progress.
        clean::run_clean_with_options(
            &app,
            &targets,
            false,
            to_recycle,
            &protected,
            false,
            Some(&OPTIMIZE_CANCEL),
            Some(&mut on_item),
        )
    };

    if optimize_cancelled() {
        return Err("cancelled".into());
    }

    let _ = history::append_history(HistoryEntry {
        id: format!(
            "{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        ),
        timestamp: chrono_like_now(),
        mode: Some("optimize".into()),
        freed_bytes: clean_report.freed_bytes,
        success_count: clean_report.success_count,
        failure_count: clean_report.failures.len(),
        dry_run: clean_report.dry_run,
        to_recycle_bin: clean_report.to_recycle_bin,
        by_category: clean_report.by_category.clone(),
    });

    emit_optimize(&app, OptimizePhase::Startup, "正在优化开机启动项…");

    if optimize_cancelled() {
        return Err("cancelled".into());
    }

    let (startups_disabled, startups_skipped, failed_pairs) = startup::disable_suggested();
    let startups_failed: Vec<StartupFailure> = failed_pairs
        .into_iter()
        .map(|(name, error)| StartupFailure { name, error })
        .collect();

    if optimize_cancelled() {
        return Err("cancelled".into());
    }

    emit_optimize(&app, OptimizePhase::Done, "体检优化完成");

    Ok(OptimizeReport {
        freed_bytes: clean_report.freed_bytes,
        clean_success: clean_report.success_count,
        clean_failures: clean_report.failures,
        by_category: clean_report.by_category,
        startups_disabled,
        startups_skipped,
        startups_failed,
        dry_run: clean_report.dry_run,
        to_recycle_bin: clean_report.to_recycle_bin,
    })
}
