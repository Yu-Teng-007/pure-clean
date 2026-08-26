use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

use crate::config;
use crate::model::{
    Category, CategoryFreed, CleanFailure, CleanProgress, CleanReport, CleanTarget,
};

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

fn remove_path_best_effort(path: &Path) -> RemoveOutcome {
    if !path.exists() {
        return RemoveOutcome {
            freed_bytes: 0,
            skipped: 0,
            last_error: None,
        };
    }

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

    entries.sort_by_key(|p| std::cmp::Reverse(p.components().count()));

    for entry in entries {
        match remove_one(&entry) {
            Ok(n) => freed_bytes = freed_bytes.saturating_add(n),
            Err(e) => {
                let consequence = e.contains("目录不是空的");
                if !(consequence && skipped > 0) {
                    skipped += 1;
                }
                remember_error(&mut last_error, e);
            }
        }
    }

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
    fn hr_ok(hr: i32) -> bool {
        matches!(
            hr as u32,
            0 | 0x8007_0002 | 0x8007_0003 | 0x8027_0021 | 0x8000_FFFF
        ) || hr == S_OK
    }

    let mut any_ok = false;
    let mut last_bad: Option<u32> = None;

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

#[cfg(windows)]
fn move_to_recycle_bin(path: &Path) -> Result<u64, String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::{
        SHFileOperationW, FO_DELETE, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT,
        SHFILEOPSTRUCTW,
    };

    if !path.exists() {
        return Ok(0);
    }

    let bytes = if path.is_file() {
        fs::metadata(path).map(|m| m.len()).unwrap_or(0)
    } else {
        crate::scan::size::dir_size_bytes(path)
    };

    clear_readonly(path);

    let mut from: Vec<u16> = path.as_os_str().encode_wide().collect();
    from.push(0);
    from.push(0);

    let mut op = SHFILEOPSTRUCTW {
        hwnd: std::ptr::null_mut(),
        wFunc: FO_DELETE as u32,
        pFrom: from.as_ptr(),
        pTo: std::ptr::null(),
        fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT) as u16,
        fAnyOperationsAborted: 0,
        hNameMappings: std::ptr::null_mut(),
        lpszProgressTitle: std::ptr::null(),
    };

    let result = unsafe { SHFileOperationW(&mut op) };
    if result != 0 || op.fAnyOperationsAborted != 0 {
        return Err(format!(
            "移到回收站失败 (code {result})，可尝试永久删除或检查文件占用"
        ));
    }
    Ok(bytes)
}

#[cfg(not(windows))]
fn move_to_recycle_bin(_path: &Path) -> Result<u64, String> {
    Err("移到回收站仅支持 Windows".into())
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

fn outcome_is_skippable(outcome: &RemoveOutcome) -> bool {
    if outcome.skipped == 0 {
        return false;
    }
    match &outcome.last_error {
        Some(e) if e.contains("文件被占用") || e.contains("目录不是空的") => true,
        None => true,
        _ => false,
    }
}

fn format_failure_message(path: &str, outcome: &RemoveOutcome) -> String {
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

fn record_category(
    map: &mut HashMap<Category, (u64, usize)>,
    category: Option<&Category>,
    bytes: u64,
) {
    let Some(cat) = category else {
        return;
    };
    let entry = map.entry(cat.clone()).or_insert((0, 0));
    entry.0 = entry.0.saturating_add(bytes);
    entry.1 += 1;
}

fn push_failure(failures: &mut Vec<CleanFailure>, path: String, error: String) {
    let (error, blocking_processes) =
        crate::process_lock::enrich_error_with_processes(&path, &error);
    failures.push(CleanFailure {
        path,
        error,
        blocking_processes,
    });
}

#[allow(dead_code)]
pub fn run_clean(
    app: &AppHandle,
    targets: &[CleanTarget],
    dry_run: bool,
    to_recycle_bin: bool,
    protected_paths: &[String],
) -> CleanReport {
    run_clean_with_options(
        app,
        targets,
        dry_run,
        to_recycle_bin,
        protected_paths,
        true,
        None,
        None,
    )
}

/// Like [`run_clean`], with optional progress flood control and cooperative cancel.
/// `on_item` is called after each target: (label, done, total, freed_bytes).
pub fn run_clean_with_options(
    app: &AppHandle,
    targets: &[CleanTarget],
    dry_run: bool,
    to_recycle_bin: bool,
    protected_paths: &[String],
    emit_events: bool,
    cancel: Option<&AtomicBool>,
    mut on_item: Option<&mut dyn FnMut(&str, usize, usize, u64)>,
) -> CleanReport {
    let total = targets.len();
    let mut done = 0usize;
    let mut freed_bytes = 0u64;
    let mut success_count = 0usize;
    let mut failures = Vec::new();
    let mut by_cat: HashMap<Category, (u64, usize)> = HashMap::new();

    let cancelled = || {
        cancel
            .map(|c| c.load(Ordering::Relaxed))
            .unwrap_or(false)
    };

    let emit = |current_path: &str, done: usize, freed_bytes: u64| {
        if !emit_events {
            return;
        }
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

    for target in targets {
        if cancelled() {
            break;
        }

        let label = target
            .special
            .as_deref()
            .map(|s| match s {
                "recycle_bin" => "回收站",
                "docker_prune" => "Docker system prune",
                other => other,
            })
            .unwrap_or(target.path.as_str());

        emit(label, done, freed_bytes);

        if target.special.is_none() && config::is_protected(Path::new(&target.path), protected_paths)
        {
            push_failure(
                &mut failures,
                target.path.clone(),
                "路径在保护白名单中，已跳过".into(),
            );
            done += 1;
            emit(label, done, freed_bytes);
            if let Some(cb) = on_item.as_mut() {
                cb(label, done, total, freed_bytes);
            }
            continue;
        }

        if dry_run {
            let estimate = target.bytes.unwrap_or(0);
            freed_bytes = freed_bytes.saturating_add(estimate);
            success_count += 1;
            record_category(&mut by_cat, target.category.as_ref(), estimate);
            done += 1;
            emit(label, done, freed_bytes);
            if let Some(cb) = on_item.as_mut() {
                cb(label, done, total, freed_bytes);
            }
            continue;
        }

        if let Some(special) = target.special.as_deref() {
            match special {
                "recycle_bin" => match empty_recycle_bin() {
                    Ok(()) => {
                        let estimate = target.bytes.unwrap_or(0);
                        freed_bytes = freed_bytes.saturating_add(estimate);
                        success_count += 1;
                        record_category(&mut by_cat, target.category.as_ref(), estimate);
                    }
                    Err(e) => push_failure(&mut failures, "回收站".into(), e),
                },
                "docker_prune" => match run_docker_prune() {
                    Ok(_) => {
                        success_count += 1;
                        record_category(&mut by_cat, target.category.as_ref(), 0);
                    }
                    Err(e) => push_failure(&mut failures, "Docker system prune".into(), e),
                },
                other => push_failure(
                    &mut failures,
                    other.to_string(),
                    format!("未知特殊项: {other}"),
                ),
            }
            done += 1;
            emit(label, done, freed_bytes);
            if let Some(cb) = on_item.as_mut() {
                cb(label, done, total, freed_bytes);
            }
            continue;
        }

        let path = Path::new(&target.path);
        let outcome = if to_recycle_bin {
            match move_to_recycle_bin(path) {
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
            }
        } else {
            remove_path_best_effort(path)
        };

        if outcome.skipped == 0 || outcome_is_skippable(&outcome) {
            freed_bytes = freed_bytes.saturating_add(outcome.freed_bytes);
            success_count += 1;
            record_category(
                &mut by_cat,
                target.category.as_ref(),
                outcome.freed_bytes,
            );
        } else {
            push_failure(
                &mut failures,
                target.path.clone(),
                format_failure_message(&target.path, &outcome),
            );
        }

        done += 1;
        emit(label, done, freed_bytes);
        if let Some(cb) = on_item.as_mut() {
            cb(label, done, total, freed_bytes);
        }
    }

    let mut by_category: Vec<CategoryFreed> = by_cat
        .into_iter()
        .map(|(category, (freed, count))| CategoryFreed {
            label: category.label().to_string(),
            category,
            freed_bytes: freed,
            count,
        })
        .collect();
    by_category.sort_by(|a, b| b.freed_bytes.cmp(&a.freed_bytes));

    CleanReport {
        freed_bytes,
        success_count,
        failures,
        by_category,
        dry_run,
        to_recycle_bin,
    }
}
