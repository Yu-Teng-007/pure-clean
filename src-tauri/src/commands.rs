use tauri::AppHandle;

use crate::clean;
use crate::config::{self, AppConfig};
use crate::model::{
    Category, CleanReport, CleanRequest, ScanRequest, ScanResult, ScanRoot,
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
    scan::run_scan(
        &app,
        &request.roots,
        request.categories,
        max_depth,
        request.min_file_bytes,
    )
}

#[tauri::command]
pub fn clean(app: AppHandle, request: CleanRequest) -> CleanReport {
    let specials = request.specials.unwrap_or_default();
    clean::run_clean(&app, &request.paths, &specials)
}

#[tauri::command]
pub fn format_bytes(bytes: u64) -> String {
    crate::scan::size::format_size(bytes)
}
