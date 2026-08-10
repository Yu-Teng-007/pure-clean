use std::fs;

use crate::config;
use crate::model::HistoryEntry;

const MAX_HISTORY: usize = 50;

fn history_path() -> Result<std::path::PathBuf, String> {
    Ok(config::config_dir()?.join("history.json"))
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
    let path = history_path()?;
    let text =
        serde_json::to_string_pretty(&list).map_err(|e| format!("序列化历史失败: {e}"))?;
    fs::write(&path, text).map_err(|e| format!("写入历史失败: {e}"))
}
