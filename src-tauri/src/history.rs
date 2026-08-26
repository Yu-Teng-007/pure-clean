use std::fs;

use crate::config;
use crate::model::{HistoryEntry, RestoreReport};
use crate::recycle_restore;

const MAX_HISTORY: usize = 50;

fn history_path() -> Result<std::path::PathBuf, String> {
    Ok(config::config_dir()?.join("history.json"))
}

fn save_history(list: &[HistoryEntry]) -> Result<(), String> {
    let path = history_path()?;
    let text =
        serde_json::to_string_pretty(list).map_err(|e| format!("序列化历史失败: {e}"))?;
    fs::write(&path, text).map_err(|e| format!("写入历史失败: {e}"))
}

pub fn load_history() -> Vec<HistoryEntry> {
    let path = match history_path() {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

pub fn append_history(entry: HistoryEntry) -> Result<(), String> {
    let mut list = load_history();
    list.insert(0, entry);
    if list.len() > MAX_HISTORY {
        list.truncate(MAX_HISTORY);
    }
    save_history(&list)
}

pub fn clear_history() -> Result<(), String> {
    save_history(&[])
}

pub fn restore_history_entry(id: &str) -> Result<RestoreReport, String> {
    let mut list = load_history();
    let entry = list
        .iter_mut()
        .find(|e| e.id == id)
        .ok_or_else(|| "未找到该历史记录".to_string())?;

    if entry.restored {
        return Err("该记录已恢复过".into());
    }
    if entry.dry_run {
        return Err("模拟清理无法恢复".into());
    }
    if !entry.to_recycle_bin {
        return Err("仅支持恢复「移入回收站」的清理记录".into());
    }
    if entry.cleaned_items.is_empty() {
        return Err("该记录缺少可恢复的路径明细（可能是旧版历史）".into());
    }

    let paths: Vec<String> = entry
        .cleaned_items
        .iter()
        .filter(|i| i.special.is_none())
        .map(|i| i.path.clone())
        .collect();

    if paths.is_empty() {
        return Err("该记录没有可恢复的普通文件项".into());
    }

    let report = recycle_restore::restore_paths(&paths);
    if report.restored_count > 0 {
        entry.restored = true;
        save_history(&list)?;
    }

    Ok(report)
}
