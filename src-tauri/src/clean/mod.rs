use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

use crate::model::{CleanFailure, CleanProgress, CleanReport};

/// Result of a best-effort delete: bytes actually removed + optional skip summary.
struct RemoveOutcome {
    freed_bytes: u64,
    skipped: usize,
    last_error: Option<String>,
}

fn clear_readonly(path: &Path) {
    if let Ok(meta) = fs::metadata(path) {
        let mut perms = meta.permissions();
        if perms.readonly() {
            perms.set_readonly(false);
            let _ = fs::set_permissions(path, perms);
        }
    }
}

fn classify_io_error(err: &io::Error) -> String {
    // Windows: 5 = access denied, 32 = sharing violation
    match err.raw_os_error() {
        Some(5) => format!("拒绝访问: {err}（可能需要管理员权限，或文件被占用）"),
        Some(32) => format!("文件被占用: {err}（请关闭相关程序后重试）"),
        _ if err.kind() == io::ErrorKind::PermissionDenied => {
            format!("拒绝访问: {err}（可能需要管理员权限，或文件被占用）")
        }
        _ => format!("{err}"),
    }
}

fn remove_one(path: &Path) -> Result<u64, String> {
    clear_readonly(path);
    let size = if path.is_file() {
        fs::metadata(path).map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };

    let result = if path.is_dir() {
        fs::remove_dir(path)
    } else {
        fs::remove_file(path)
    };

    match result {
        Ok(()) => Ok(size),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(0),
        Err(e) => Err(classify_io_error(&e)),
    }
}

/// Delete as much as possible under `path`. Locked / denied entries are skipped.
fn remove_path_best_effort(path: &Path) -> RemoveOutcome {
    if !path.exists() {
        return RemoveOutcome {
            freed_bytes: 0,
            skipped: 0,
            last_error: None,
        };
    }

    // Single file
    if path.is_file() {
        return match remove_one(path) {
            Ok(n) => RemoveOutcome {
                freed_bytes: n,
                skipped: 0,
                last_error: None,
            },
            Err(e) => RemoveOutcome {
                freed_bytes: 0,
                skipped: 1,
                last_error: Some(e),
            },
        };
    }

    let mut freed_bytes = 0u64;
    let mut skipped = 0usize;
    let mut last_error: Option<String> = None;

    // Collect paths deepest-first so we remove files before their parents.
    let mut entries: Vec<PathBuf> = WalkDir::new(path)
        .follow_links(false)
        .contents_first(true)
        .into_iter()
        .filter_map(|e| e.ok())
        .map(|e| e.into_path())
        .collect();

    // Ensure root itself is last (contents_first usually puts it last already).
    entries.sort_by_key(|p| std::cmp::Reverse(p.components().count()));

    for entry in entries {
        match remove_one(&entry) {
            Ok(n) => freed_bytes = freed_bytes.saturating_add(n),
            Err(e) => {
                skipped += 1;
                last_error = Some(e);
            }
        }
    }

    // If root remains empty, try once more.
    if path.exists() {
        if let Err(e) = remove_one(path) {
            // Still there — count as skip only if we didn't already.
            if skipped == 0 {
                skipped = 1;
                last_error = Some(e);
            } else if last_error.is_none() {
                last_error = Some(e);
            }
        }
    }

    RemoveOutcome {
        freed_bytes,
        skipped,
        last_error,
    }
}

#[cfg(windows)]
fn empty_recycle_bin() -> Result<(), String> {
    use windows_sys::Win32::Foundation::S_OK;
    use windows_sys::Win32::UI::Shell::{
        SHEmptyRecycleBinW, SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND,
    };

    const FLAGS: u32 = SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND;
    // Treat these as success / already empty:
    // - S_OK
    // - 0x80070002 / 0x80070003 (not found)
    // - 0x80270021 (empty on some builds)
    // - 0x8000FFFF E_UNEXPECTED (Win10/11 often returns this even when empty/partial OK)
    fn hr_ok(hr: i32) -> bool {
        matches!(
            hr as u32,
            0 | 0x8007_0002 | 0x8007_0003 | 0x8027_0021 | 0x8000_FFFF
        ) || hr == S_OK
    }

    let mut any_ok = false;
    let mut last_bad: Option<u32> = None;

    // Prefer per-drive emptying — more reliable than NULL (all drives) on Win10/11.
    for letter in 'A'..='Z' {
        let root = format!("{letter}:\\");
        if !Path::new(&root).exists() {
            continue;
        }
        let wide: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
        let hr = unsafe { SHEmptyRecycleBinW(std::ptr::null_mut(), wide.as_ptr(), FLAGS) };
        if hr_ok(hr) {
            any_ok = true;
        } else {
            last_bad = Some(hr as u32);
        }
    }

    if any_ok {
        return Ok(());
    }

    // Fallback: all drives at once
    let hr = unsafe { SHEmptyRecycleBinW(std::ptr::null_mut(), std::ptr::null(), FLAGS) };
    if hr_ok(hr) {
        return Ok(());
    }
    Err(format!(
        "清空回收站失败 (HRESULT 0x{:08X})，可能需要管理员权限或文件被占用",
        last_bad.unwrap_or(hr as u32)
    ))
}

#[cfg(not(windows))]
fn empty_recycle_bin() -> Result<(), String> {
    Err("回收站清理仅支持 Windows".into())
}

fn format_skip_message(path: &str, outcome: &RemoveOutcome) -> String {
    let hint = outcome
        .last_error
        .clone()
        .unwrap_or_else(|| "部分文件无法删除".into());
    if outcome.freed_bytes > 0 {
        format!(
            "部分清理完成（已释放 {}，跳过 {} 项）: {hint}",
            crate::scan::size::format_size(outcome.freed_bytes),
            outcome.skipped
        )
    } else {
        format!("删除失败: {hint}（路径: {path}）")
    }
}

pub fn run_clean(app: &AppHandle, paths: &[String], specials: &[String]) -> CleanReport {
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
        let outcome = remove_path_best_effort(path);

        if outcome.skipped == 0 {
            freed_bytes = freed_bytes.saturating_add(outcome.freed_bytes);
            success_count += 1;
        } else if outcome.freed_bytes > 0 {
            // Partial success: count freed space, still surface a soft failure note.
            freed_bytes = freed_bytes.saturating_add(outcome.freed_bytes);
            success_count += 1;
            failures.push(CleanFailure {
                path: path_str.clone(),
                error: format_skip_message(path_str, &outcome),
            });
        } else {
            failures.push(CleanFailure {
                path: path_str.clone(),
                error: format_skip_message(path_str, &outcome),
            });
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
