use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::model::Category;

pub const DEFAULT_MIN_FILE_BYTES: u64 = 500 * 1024 * 1024;

fn default_min_file_bytes() -> u64 {
    DEFAULT_MIN_FILE_BYTES
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub scan_roots: Vec<String>,
    pub enabled_categories: Vec<Category>,
    pub select_caution_by_default: bool,
    #[serde(default = "default_min_file_bytes")]
    pub min_file_bytes: u64,
}

impl Default for AppConfig {
    fn default() -> Self {
        let mut scan_roots = Vec::new();
        let yhdja = PathBuf::from(r"D:\YHDJA");
        if yhdja.is_dir() {
            scan_roots.push(yhdja.to_string_lossy().to_string());
        }
        if let Some(home) = dirs::home_dir() {
            let home_str = home.to_string_lossy().to_string();
            if !scan_roots.iter().any(|r| r == &home_str) {
                // Don't auto-add entire home — too broad. Only YHDJA by default.
            }
        }
        Self {
            scan_roots,
            enabled_categories: Category::all(),
            select_caution_by_default: false,
            min_file_bytes: DEFAULT_MIN_FILE_BYTES,
        }
    }
}

fn config_path() -> Result<PathBuf, String> {
    let base = dirs::config_dir().ok_or_else(|| "无法定位配置目录".to_string())?;
    let dir = base.join("pure-clean");
    fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {e}"))?;
    Ok(dir.join("config.json"))
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
