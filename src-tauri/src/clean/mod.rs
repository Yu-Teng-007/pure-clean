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
    // Windows: 5 = access denied, 32 = sharing violation, 33 = lock violation,
    // 145 = directory not empty (often leftover after locked children were skipped)
    match err.raw_os_error() {
        Some(5) => format!("拒绝访问: {err}（可能需要管理员权限，或文件被占用）"),
        Some(32) | Some(33) => format!("文件被占用: {err}（请关闭相关程序后重试）"),
        Some(145) => {
            "目录不是空的（部分子项被占用或无权限，已尽量删除可删内容；关闭占用进程后可再试）"
                .into()
        }
        _ if err.kind() == io::ErrorKind::PermissionDenied => {
            format!("拒绝访问: {err}（可能需要管理员权限，或文件被占用）")
        }
        _ if err.kind() == io::ErrorKind::DirectoryNotEmpty => {
            "目录不是空的（部分子项被占用或无权限，已尽量删除可删内容；关闭占用进程后可再试）"
                .into()
        }
        _ => format!("{err}"),
    }
}

/// Prefer actionable root-cause messages over consequential "dir not empty".
fn remember_error(slot: &mut Option<String>, next: String) {
    let next_is_consequence = next.contains("目录不是空的");
    match slot {
        Some(prev) if prev.contains("目录不是空的") && !next_is_consequence => {
            *slot = Some(next);
        }
        Some(_) if next_is_consequence => {}
        None => *slot = Some(next),
        Some(_) => *slot = Some(next),
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
    // Do not silently drop WalkDir I/O errors — those are often the real skip cause.
    let mut entries: Vec<PathBuf> = Vec::new();
    for entry in WalkDir::new(path)
        .follow_links(false)
        .contents_first(true)
        .into_iter()
    {
        match entry {
            Ok(e) => entries.push(e.into_path()),
            Err(e) => {
                skipped += 1;
                let msg = e
                    .io_error()
                    .map(classify_io_error)
                    .unwrap_or_else(|| format!("遍历失败: {e}"));
                remember_error(&mut last_error, msg);
            }
        }
    }

    // Ensure root itself is last (contents_first usually puts it last already).
    entries.sort_by_key(|p| std::cmp::Reverse(p.components().count()));

    for entry in entries {
        match remove_one(&entry) {
            Ok(n) => freed_bytes = freed_bytes.saturating_add(n),
            Err(e) => {
                // Parent "not empty" after skipped children is expected — still count the skip,
                // but keep the child root-cause in last_error when present.
                let consequence = e.contains("目录不是空的");
                if !(consequence && skipped > 0) {
                    skipped += 1;
                }
                remember_error(&mut last_error, e);
            }
        }
    }

    // If root remains and looks empty enough, try once more (race / delayed unlock).
    if path.exists() {
        match remove_one(path) {
            Ok(_) => {}
            Err(e) => {
                let consequence = e.contains("目录不是空的");
                if skipped == 0 {
                    skipped = 1;
                    remember_error(&mut last_error, e);
                } else if !consequence {
                    remember_error(&mut last_error, e);
                }
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

fn run_docker_prune() -> Result<String, String> {
    use std::process::Command;

    let output = Command::new("docker")
        .args(["system", "prune", "-af"])
        .output()
        .map_err(|e| {
            format!("无法启动 docker 命令: {e}（请确认已安装 Docker Desktop 且 docker 在 PATH 中）")
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("退出码 {}", output.status)
        };
        return Err(format!("docker system prune 失败: {detail}"));
    }

    Ok(if stdout.is_empty() {
        "Docker prune 完成".into()
    } else {
        stdout
    })
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
            "docker_prune" => match run_docker_prune() {
                Ok(msg) => {
                    success_count += 1;
                    let _ = msg;
                }
                Err(e) => failures.push(CleanFailure {
                    path: "Docker system prune".into(),
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
