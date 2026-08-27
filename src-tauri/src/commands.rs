use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter};

use crate::clean;
use crate::config::{self, AppConfig};
use crate::drives;
use crate::hardware::{self, HardwareInfo};
use crate::history;
use crate::memory::{self, MemoryCleanReport, MemorySnapshot, ProcessMemoryItem};
use crate::model::{
    AnalyzeResult, BlockingProcess, Category, CleanReport, CleanRequest, CleanTarget,
    ContextMenuOptimizeReport, DevCacheDashboard, DriveInfo, DupScanEstimate,
    HistoryCleanedItem, HistoryEntry, OptimizePhase, OptimizeProgress, OptimizeReport,
    RestoreReport, ScanRequest, ScanResult, ScanRoot, ScheduleReminderPayload,
    ServiceSuggestion, StartupFailure, StartupOptimizeReport, WinSxSHint,
};
use crate::process_lock;
use crate::recycle_restore;
use crate::scheduler;
use crate::scan;
use crate::elevation;
use crate::context_menu::{self, ContextMenuItem};
use crate::startup::{self, StartupItem};
use crate::services;
use crate::shell_integration;
use crate::winsxs;

/// Cooperative cancel flag for in-flight smart optimize.
static OPTIMIZE_CANCEL: AtomicBool = AtomicBool::new(false);
/// Cooperative cancel for regular scan / clean / dev-cache dashboard.
static SCAN_CANCEL: AtomicBool = AtomicBool::new(false);
static CLEAN_CANCEL: AtomicBool = AtomicBool::new(false);
static DEV_CACHE_CANCEL: AtomicBool = AtomicBool::new(false);

fn optimize_cancelled() -> bool {
    OPTIMIZE_CANCEL.load(Ordering::Relaxed)
}

fn history_cleaned_items(
    targets: &[CleanTarget],
    report: &CleanReport,
) -> Vec<HistoryCleanedItem> {
    if report.dry_run || !report.to_recycle_bin {
        return Vec::new();
    }
    let failed_paths: HashSet<String> = report
        .failures
        .iter()
        .map(|f| f.path.clone())
        .collect();
    targets
        .iter()
        .filter(|t| t.special.is_none() && !failed_paths.contains(&t.path))
        .map(|t| HistoryCleanedItem {
            path: t.path.clone(),
            bytes: t.bytes.unwrap_or(0),
            special: None,
        })
        .collect()
}

#[tauri::command]
pub fn get_default_roots() -> Vec<ScanRoot> {
    let mut roots: Vec<ScanRoot> = config::discover_default_scan_roots()
        .into_iter()
        .map(|path| {
            let label = path
                .rsplit(['\\', '/'])
                .next()
                .unwrap_or(&path)
                .to_string();
            ScanRoot {
                path: path.clone(),
                kind: "project".into(),
                label: format!("项目目录 ({label})"),
            }
        })
        .collect();
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

fn filter_categories(request_categories: Vec<Category>, cfg: &AppConfig) -> Vec<Category> {
    let enabled: HashSet<Category> = cfg.enabled_categories.iter().cloned().collect();
    request_categories
        .into_iter()
        .filter(|c| enabled.contains(c))
        .collect()
}

fn local_timestamp_now() -> String {
    #[cfg(windows)]
    {
        use std::mem::MaybeUninit;
        use windows_sys::Win32::Foundation::SYSTEMTIME;
        use windows_sys::Win32::System::SystemInformation::GetLocalTime;
        unsafe {
            let mut st = MaybeUninit::<SYSTEMTIME>::zeroed();
            GetLocalTime(st.as_mut_ptr());
            let st = st.assume_init();
            format!(
                "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
                st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond
            )
        }
    }
    #[cfg(not(windows))]
    {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let days = secs / 86400;
        let tod = secs % 86400;
        let hour = tod / 3600;
        let min = (tod % 3600) / 60;
        let sec = tod % 60;
        let (y, m, d) = civil_from_days(days as i64);
        format!("{y:04}-{m:02}-{d:02} {hour:02}:{min:02}:{sec:02}")
    }
}

#[tauri::command]
pub async fn scan(app: AppHandle, request: ScanRequest) -> ScanResult {
    SCAN_CANCEL.store(false, Ordering::SeqCst);
    let max_depth = request.max_depth.unwrap_or(6);
    let cfg = config::load_config();
    let protected_paths = request
        .protected_paths
        .unwrap_or_else(|| cfg.protected_paths.clone());
    let protected_globs = cfg.protected_globs.clone();
    let dup_extensions = request.dup_extensions.clone();
    let categories = filter_categories(
        request.categories.unwrap_or_else(Category::all),
        &cfg,
    );
    let roots = request.roots;
    let min_file_bytes = request.min_file_bytes;
    let stale_days = request.stale_days;
    let safe_only = request.safe_only.unwrap_or(false);
    let app = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let protection =
            config::ProtectionRules::from_slices(&protected_paths, &protected_globs);
        scan::run_scan(
            &app,
            &roots,
            Some(categories),
            max_depth,
            min_file_bytes,
            stale_days,
            safe_only,
            &protection,
            dup_extensions.as_deref(),
            true,
            Some(&SCAN_CANCEL),
        )
    })
    .await
    .expect("scan task panicked")
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
pub async fn clean(app: AppHandle, request: CleanRequest) -> CleanReport {
    CLEAN_CANCEL.store(false, Ordering::SeqCst);
    let cfg = config::load_config();
    let protected_paths = request
        .protected_paths
        .clone()
        .unwrap_or_else(|| cfg.protected_paths.clone());
    let protected_globs = cfg.protected_globs.clone();
    let dry_run = request.dry_run.unwrap_or(false);
    let to_recycle = request
        .to_recycle_bin
        .unwrap_or(cfg.to_recycle_bin_by_default);
    let mode = request.mode.clone();

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

    let app = app.clone();
    let targets_for_history = targets.clone();

    let report = tauri::async_runtime::spawn_blocking(move || {
        let protection =
            config::ProtectionRules::from_slices(&protected_paths, &protected_globs);
        clean::run_clean_with_options(
            &app,
            &targets,
            dry_run,
            to_recycle,
            &protection,
            true,
            Some(&CLEAN_CANCEL),
            None,
        )
    })
    .await
    .expect("clean task panicked");

    let cleaned_items = history_cleaned_items(&targets_for_history, &report);

    let _ = history::append_history(HistoryEntry {
        id: format!(
            "{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        ),
        timestamp: local_timestamp_now(),
        mode,
        freed_bytes: report.freed_bytes,
        success_count: report.success_count,
        failure_count: report.failures.len(),
        dry_run: report.dry_run,
        to_recycle_bin: report.to_recycle_bin,
        by_category: report.by_category.clone(),
        cleaned_items,
        restored: false,
    });

    report
}

#[tauri::command]
pub fn find_locking_processes(path: String) -> Vec<BlockingProcess> {
    process_lock::find_locking_processes(std::path::Path::new(&path))
}

#[tauri::command]
pub fn restore_history(id: String) -> Result<RestoreReport, String> {
    history::restore_history_entry(&id)
}

#[tauri::command]
pub fn open_recycle_bin() -> Result<(), String> {
    recycle_restore::open_recycle_bin_folder()
}

#[tauri::command]
pub fn open_disk_cleanup(drive: Option<String>) -> Result<(), String> {
    crate::system_tools::open_disk_cleanup(drive)
}

#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    crate::system_tools::reveal_in_explorer(path)
}

#[tauri::command]
pub fn clear_history() -> Result<(), String> {
    history::clear_history()
}

#[tauri::command]
pub async fn scan_dev_caches(
    app: AppHandle,
    roots: Option<Vec<String>>,
    force_refresh: Option<bool>,
) -> DevCacheDashboard {
    DEV_CACHE_CANCEL.store(false, Ordering::SeqCst);
    let cfg = config::load_config();
    let scan_roots = roots.unwrap_or_else(|| cfg.scan_roots.clone());
    let protected_paths = cfg.protected_paths.clone();
    let protected_globs = cfg.protected_globs.clone();
    let force = force_refresh.unwrap_or(false);
    let app = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let protection =
            config::ProtectionRules::from_slices(&protected_paths, &protected_globs);
        let mut last_emit = std::time::Instant::now();
        scan::dev_cache::build_dashboard(
            &scan_roots,
            &protection,
            Some(&DEV_CACHE_CANCEL),
            force,
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
    })
    .await
    .expect("dev cache scan task panicked")
}

#[cfg(not(windows))]
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
pub async fn analyze_disk_usage(app: AppHandle, drive: Option<String>) -> AnalyzeResult {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || crate::analyze::analyze_disk_usage(&app, drive))
        .await
        .expect("analyze task panicked")
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
pub async fn get_hardware_info() -> HardwareInfo {
    tauri::async_runtime::spawn_blocking(hardware::collect)
        .await
        .expect("hardware info task panicked")
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
pub async fn clean_memory() -> MemoryCleanReport {
    tauri::async_runtime::spawn_blocking(memory::clean_memory)
        .await
        .expect("memory clean task panicked")
}

#[tauri::command]
pub fn trim_process_working_set(pid: u32) -> Result<u64, String> {
    memory::trim_process(pid)
}

#[tauri::command]
pub fn set_startup_enabled(id: String, enabled: bool) -> Result<StartupItem, String> {
    startup::set_startup_enabled(&id, enabled)
}

#[tauri::command]
pub fn run_startup_smart_optimize() -> Result<StartupOptimizeReport, String> {
    let (disabled, skipped, failed_pairs) = startup::disable_suggested();
    let failed: Vec<StartupFailure> = failed_pairs
        .into_iter()
        .map(|(name, error)| StartupFailure { name, error })
        .collect();
    Ok(StartupOptimizeReport {
        disabled,
        skipped,
        failed,
    })
}

#[tauri::command]
pub fn list_context_menu_items() -> Vec<ContextMenuItem> {
    context_menu::list_context_menu_items()
}

#[tauri::command]
pub fn set_context_menu_enabled(id: String, enabled: bool) -> Result<ContextMenuItem, String> {
    context_menu::set_context_menu_enabled(&id, enabled)
}

#[tauri::command]
pub fn run_context_menu_smart_optimize() -> Result<ContextMenuOptimizeReport, String> {
    let (disabled, skipped, failed_pairs) = context_menu::disable_suggested();
    let failed: Vec<StartupFailure> = failed_pairs
        .into_iter()
        .map(|(name, error)| StartupFailure { name, error })
        .collect();
    Ok(ContextMenuOptimizeReport {
        disabled,
        skipped,
        failed,
    })
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
pub async fn run_smart_optimize(app: AppHandle, deep: Option<bool>) -> Result<OptimizeReport, String> {
    let deep = deep.unwrap_or(false);
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || run_smart_optimize_inner(&app, deep))
        .await
        .map_err(|e| format!("优化任务异常: {e}"))?
}

fn run_smart_optimize_inner(app: &AppHandle, deep: bool) -> Result<OptimizeReport, String> {
    OPTIMIZE_CANCEL.store(false, Ordering::SeqCst);

    let cfg = config::load_config();
    let protection = config::ProtectionRules::from_config(&cfg);
    let to_recycle = cfg.to_recycle_bin_by_default;
    let scan_roots = cfg.scan_roots.clone();

    emit_optimize(
        app,
        OptimizePhase::Scanning,
        if deep {
            "正在深度扫描项目安全构建产物…"
        } else {
            "正在快速定位可安全清理的缓存…"
        },
    );

    let mut last_emit = std::time::Instant::now();
    let targets = scan::collect_smart_optimize_targets(
        &protection,
        Some(&OPTIMIZE_CANCEL),
        deep,
        &scan_roots,
        |path| {
        if last_emit.elapsed() >= std::time::Duration::from_millis(200) {
            let short = path.rsplit(['\\', '/']).next().unwrap_or(path);
            emit_optimize(
                app,
                OptimizePhase::Scanning,
                &format!("正在检查：{short}"),
            );
            last_emit = std::time::Instant::now();
        }
    },
    );

    if optimize_cancelled() {
        return Err("cancelled".into());
    }

    emit_optimize(
        app,
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
                app,
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
            app,
            &targets,
            false,
            to_recycle,
            &protection,
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
        timestamp: local_timestamp_now(),
        mode: Some("optimize".into()),
        freed_bytes: clean_report.freed_bytes,
        success_count: clean_report.success_count,
        failure_count: clean_report.failures.len(),
        dry_run: clean_report.dry_run,
        to_recycle_bin: clean_report.to_recycle_bin,
        by_category: clean_report.by_category.clone(),
        cleaned_items: history_cleaned_items(&targets, &clean_report),
        restored: false,
    });

    emit_optimize(app, OptimizePhase::Startup, "正在优化开机启动项…");

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

    emit_optimize(app, OptimizePhase::Done, "体检优化完成");

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

#[tauri::command]
pub fn is_elevated() -> bool {
    elevation::is_elevated()
}

#[tauri::command]
pub fn restart_as_admin() -> Result<(), String> {
    elevation::restart_as_admin()
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<String, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| format!("更新组件不可用: {e}"))?;
    match updater.check().await {
        Ok(Some(update)) => Ok(format!(
            "发现新版本 {}（当前 {}）",
            update.version,
            update.current_version
        )),
        Ok(None) => Ok("当前已是最新版本".into()),
        Err(e) => Err(format!("检查更新失败: {e}")),
    }
}

#[tauri::command]
pub fn trigger_cleanup_reminder(app: AppHandle) -> Result<ScheduleReminderPayload, String> {
    scheduler::check_and_notify(&app, true)?;
    Ok(scheduler::estimate_cleanup())
}

#[tauri::command]
pub fn export_history() -> Result<String, String> {
    history::export_history_json()
}

#[tauri::command]
pub fn export_config() -> Result<String, String> {
    config::export_config_json()
}

#[tauri::command]
pub fn import_config(text: String) -> Result<AppConfig, String> {
    config::import_config_json(&text)
}

#[tauri::command]
pub fn import_config_from_path(path: String) -> Result<AppConfig, String> {
    config::import_config_from_path(&path)
}

#[tauri::command]
pub fn estimate_duplicate_scan(
    root: String,
    min_bytes: Option<u64>,
    max_depth: Option<usize>,
    extensions: Option<Vec<String>>,
) -> DupScanEstimate {
    use std::path::Path;
    let min = min_bytes.unwrap_or(config::DEFAULT_DUPE_MIN_BYTES);
    let depth = max_depth.unwrap_or(8);
    let (candidate_files, total_bytes, estimated_seconds) =
        scan::rules::estimate_duplicate_scan(
            Path::new(&root),
            min,
            depth,
            extensions.as_deref(),
        );
    DupScanEstimate {
        candidate_files,
        total_bytes,
        estimated_seconds,
    }
}

#[tauri::command]
pub fn list_service_suggestions() -> Vec<ServiceSuggestion> {
    services::list_service_suggestions()
}

#[tauri::command]
pub fn analyze_winsxs() -> WinSxSHint {
    winsxs::analyze_winsxs()
}

#[tauri::command]
pub fn register_explorer_menu() -> Result<(), String> {
    shell_integration::register_explorer_menu()
}

#[tauri::command]
pub fn unregister_explorer_menu() -> Result<(), String> {
    shell_integration::unregister_explorer_menu()
}

#[tauri::command]
pub fn is_explorer_menu_registered() -> bool {
    shell_integration::is_explorer_menu_registered()
}

#[tauri::command]
pub fn take_pending_analyze_path() -> Option<String> {
    shell_integration::take_pending_analyze_path()
}

#[tauri::command]
pub fn open_services_console() -> Result<(), String> {
    shell_integration::open_services_console()
}
