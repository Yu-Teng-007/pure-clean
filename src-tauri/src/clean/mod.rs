use std::fs;
use std::path::Path;

use tauri::{AppHandle, Emitter};

use crate::model::{CleanFailure, CleanProgress, CleanReport};

#[cfg(windows)]
fn empty_recycle_bin() -> Result<(), String> {
    use windows_sys::Win32::Foundation::S_OK;
    use windows_sys::Win32::UI::Shell::{
        SHEmptyRecycleBinW, SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND,
    };

    let flags = SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND;
    let hr = unsafe { SHEmptyRecycleBinW(std::ptr::null_mut(), std::ptr::null(), flags) };
    // S_OK, or common "already empty" style results
    if hr == S_OK || hr == 0 || (hr as u32) == 0x8027_0021 {
        Ok(())
    } else {
        Err(format!(
            "清空回收站失败 (HRESULT 0x{:08X})，可能需要管理员权限或文件被占用",
            hr as u32
        ))
    }
}

#[cfg(not(windows))]
fn empty_recycle_bin() -> Result<(), String> {
    Err("回收站清理仅支持 Windows".into())
}

fn remove_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|e| format!("删除目录失败: {e}"))
    } else {
        fs::remove_file(path).map_err(|e| format!("删除文件失败: {e}"))
    }
}

pub fn run_clean(
    app: &AppHandle,
    paths: &[String],
    specials: &[String],
) -> CleanReport {
    let total = paths.len() + specials.len();
    let mut done = 0usize;
    let mut freed_bytes = 0u64;
    let mut success_count = 0usize;
    let mut failures = Vec::new();

    let emit = |current_path: &str, done: usize, freed_bytes: u64| {
        let _ = app.emit(
            "clean_progress",
            CleanProgress {
                current_path: current_path.to_string(),
                done,
                total,
                freed_bytes,
            },
        );
    };

    for special in specials {
        emit(special, done, freed_bytes);
        match special.as_str() {
            "recycle_bin" => match empty_recycle_bin() {
                Ok(()) => {
                    success_count += 1;
                }
                Err(e) => failures.push(CleanFailure {
                    path: "回收站".into(),
                    error: e,
                }),
            },
            other => failures.push(CleanFailure {
                path: other.to_string(),
                error: format!("未知特殊项: {other}"),
            }),
        }
        done += 1;
        emit(special, done, freed_bytes);
    }

    for path_str in paths {
        emit(path_str, done, freed_bytes);
        let path = Path::new(path_str);
        let size = if path.exists() {
            crate::scan::size::dir_size_bytes(path)
        } else {
            0
        };

        match remove_path(path) {
            Ok(()) => {
                freed_bytes = freed_bytes.saturating_add(size);
                success_count += 1;
            }
            Err(e) => {
                // Partial delete may have freed some; still report failure
                failures.push(CleanFailure {
                    path: path_str.clone(),
                    error: format!("{e}（可能被占用，请关闭相关程序后重试）"),
                });
            }
        }
        done += 1;
        emit(path_str, done, freed_bytes);
    }

    CleanReport {
        freed_bytes,
        success_count,
        failures,
    }
}
