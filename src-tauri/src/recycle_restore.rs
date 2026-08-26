use std::fs;
use std::path::{Path, PathBuf};

use crate::model::{CleanFailure, RestoreReport};
use crate::process_lock;

/// Try to restore files/dirs from the recycle bin back to their original paths.
pub fn restore_paths(paths: &[String]) -> RestoreReport {
    #[cfg(windows)]
    {
        restore_paths_windows(paths)
    }
    #[cfg(not(windows))]
    {
        RestoreReport {
            restored_count: 0,
            failures: paths
                .iter()
                .map(|p| CleanFailure {
                    path: p.clone(),
                    error: "回收站恢复仅支持 Windows".into(),
                    blocking_processes: Vec::new(),
                })
                .collect(),
        }
    }
}

#[cfg(windows)]
fn restore_paths_windows(paths: &[String]) -> RestoreReport {
    let mut restored_count = 0usize;
    let mut failures = Vec::new();
    let index = build_recycle_index();

    for path in paths {
        let norm = normalize_path(path);
        let Some((r_path, original)) = index.get(&norm).cloned() else {
            failures.push(CleanFailure {
                path: path.clone(),
                error: "在回收站中未找到对应项（可能已被永久删除或清空）".into(),
                blocking_processes: Vec::new(),
            });
            continue;
        };

        match restore_one(&r_path, Path::new(&original)) {
            Ok(()) => restored_count += 1,
            Err(e) => {
                let processes = process_lock::find_locking_processes(Path::new(path));
                failures.push(CleanFailure {
                    path: path.clone(),
                    error: e,
                    blocking_processes: processes,
                });
            }
        }
    }

    RestoreReport {
        restored_count,
        failures,
    }
}

#[cfg(windows)]
fn restore_one(r_path: &Path, original: &Path) -> Result<(), String> {
    if !r_path.exists() {
        return Err("回收站数据文件不存在".into());
    }
    if original.exists() {
        return Err("目标路径已存在，请先手动处理冲突".into());
    }
    if let Some(parent) = original.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    }
    fs::rename(r_path, original).map_err(|e| format!("恢复失败: {e}"))
}

#[cfg(windows)]
fn build_recycle_index() -> std::collections::HashMap<String, (PathBuf, String)> {
    use std::collections::HashMap;

    let mut map = HashMap::new();

    for letter in b'C'..=b'Z' {
        let recycle_root = PathBuf::from(format!("{}:\\$Recycle.Bin", letter as char));
        if !recycle_root.is_dir() {
            continue;
        }
        let Ok(sid_dirs) = fs::read_dir(&recycle_root) else {
            continue;
        };
        for sid_entry in sid_dirs.flatten() {
            let sid_path = sid_entry.path();
            if !sid_path.is_dir() {
                continue;
            }
            let Ok(entries) = fs::read_dir(&sid_path) else {
                continue;
            };
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if !name_str.starts_with("$I") {
                    continue;
                }
                let suffix = &name_str[2..];
                let r_path = sid_path.join(format!("$R{suffix}"));
                if let Some(original) = parse_info_file(&entry.path()) {
                    map.insert(normalize_path(&original), (r_path, original));
                }
            }
        }
    }

    map
}

/// Parse Windows $I recycle-bin metadata (Vista+ layout).
#[cfg(windows)]
fn parse_info_file(info_path: &Path) -> Option<String> {
    let data = fs::read(info_path).ok()?;
    if data.len() < 24 {
        return None;
    }
    let header_size = u32::from_le_bytes(data[16..20].try_into().ok()?) as usize;
    let path_chars = u32::from_le_bytes(data[20..24].try_into().ok()?) as usize;
    let path_start = header_size.max(24);
    let path_bytes = path_chars.checked_mul(2)?;
    if data.len() < path_start + path_bytes {
        return None;
    }
    let wide: Vec<u16> = data[path_start..path_start + path_bytes]
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .take_while(|&c| c != 0)
        .collect();
    if wide.is_empty() {
        return None;
    }
    Some(String::from_utf16_lossy(&wide))
}

fn normalize_path(path: &str) -> String {
    let trimmed = path.trim().trim_end_matches(['/', '\\']);
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

/// Open the Windows recycle bin folder in Explorer.
pub fn open_recycle_bin_folder() -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::process::Command;
        Command::new("explorer.exe")
            .arg("shell:RecycleBinFolder")
            .spawn()
            .map_err(|e| format!("无法打开回收站: {e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("仅支持 Windows".into())
    }
}
