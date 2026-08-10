pub mod rules;
pub mod size;

use std::collections::HashSet;
use std::path::Path;

use tauri::{AppHandle, Emitter};

use crate::config::{self, DEFAULT_DUPE_MIN_BYTES, DEFAULT_MIN_FILE_BYTES, DEFAULT_STALE_DAYS};
use crate::model::{Category, Risk, ScanItem, ScanProgress, ScanResult};
use crate::scan::rules::{
    docker_prune_item, downloads_dir, fixed_dev_paths, fixed_docker_wsl_paths, fixed_system_paths,
    recycle_bin_item, scan_duplicate_files, scan_fixed_paths, scan_installers, scan_large_files,
    scan_node_modules, scan_project_tree, scan_stale_files,
};

fn emit_progress(app: &AppHandle, path: &str, items_found: usize, bytes_found: u64) {
    let _ = app.emit(
        "scan_progress",
        ScanProgress {
            current_path: path.to_string(),
            items_found,
            bytes_found,
        },
    );
}

fn push_unique(
    items: &mut Vec<ScanItem>,
    items_found: &mut usize,
    bytes_found: &mut u64,
    item: ScanItem,
    protected: &[String],
) {
    if config::is_protected(Path::new(&item.path), protected) {
        return;
    }
    if items.iter().any(|i| i.path == item.path) {
        return;
    }
    *items_found += 1;
    *bytes_found = bytes_found.saturating_add(item.bytes);
    items.push(item);
}

pub fn run_scan(
    app: &AppHandle,
    roots: &[String],
    categories: Option<Vec<Category>>,
    max_depth: usize,
    min_file_bytes: Option<u64>,
    stale_days: Option<u64>,
    safe_only: bool,
    protected_paths: &[String],
) -> ScanResult {
    let enabled: HashSet<Category> = categories
        .unwrap_or_else(Category::all)
        .into_iter()
        .collect();
    let min_bytes = min_file_bytes.unwrap_or(DEFAULT_MIN_FILE_BYTES);
    let stale = stale_days.unwrap_or(DEFAULT_STALE_DAYS);
    let dupe_min = min_file_bytes.unwrap_or(DEFAULT_DUPE_MIN_BYTES);
    let installer_min = min_file_bytes.unwrap_or(50 * 1024 * 1024);
    let stale_min = 1024 * 1024; // ignore tiny stale files (<1MB)

    let mut items = Vec::new();
    let mut items_found = 0usize;
    let mut bytes_found = 0u64;

    let mut scan_roots: Vec<String> = roots.to_vec();
    if enabled.contains(&Category::StaleFiles) {
        if let Some(dl) = downloads_dir() {
            let dl_str = dl.to_string_lossy().to_string();
            if !scan_roots.iter().any(|r| r.eq_ignore_ascii_case(&dl_str)) {
                scan_roots.push(dl_str);
            }
        }
    }

    for root in &scan_roots {
        let path = Path::new(root);
        if !path.is_dir() {
            continue;
        }
        emit_progress(app, root, items_found, bytes_found);
        let found = scan_project_tree(path, max_depth, &enabled, &mut |p| {
            emit_progress(app, p, items_found, bytes_found);
        });
        for item in found {
            push_unique(
                &mut items,
                &mut items_found,
                &mut bytes_found,
                item,
                protected_paths,
            );
        }

        if enabled.contains(&Category::LargeFiles) {
            let large = scan_large_files(path, min_bytes, max_depth, &mut |p| {
                emit_progress(app, p, items_found, bytes_found);
            });
            for item in large {
                push_unique(
                    &mut items,
                    &mut items_found,
                    &mut bytes_found,
                    item,
                    protected_paths,
                );
            }
        }

        if enabled.contains(&Category::NodeModules) {
            let modules = scan_node_modules(path, max_depth, stale, &mut |p| {
                emit_progress(app, p, items_found, bytes_found);
            });
            for item in modules {
                push_unique(
                    &mut items,
                    &mut items_found,
                    &mut bytes_found,
                    item,
                    protected_paths,
                );
            }
        }

        if enabled.contains(&Category::DuplicateFiles) {
            let dupes = scan_duplicate_files(path, dupe_min, max_depth, &mut |p| {
                emit_progress(app, p, items_found, bytes_found);
            });
            for item in dupes {
                push_unique(
                    &mut items,
                    &mut items_found,
                    &mut bytes_found,
                    item,
                    protected_paths,
                );
            }
        }

        if enabled.contains(&Category::StaleFiles) {
            let stale_items = scan_stale_files(path, stale, max_depth, stale_min, &mut |p| {
                emit_progress(app, p, items_found, bytes_found);
            });
            for item in stale_items {
                push_unique(
                    &mut items,
                    &mut items_found,
                    &mut bytes_found,
                    item,
                    protected_paths,
                );
            }
        }

        if enabled.contains(&Category::Installers) {
            let installers = scan_installers(path, max_depth, installer_min, &mut |p| {
                emit_progress(app, p, items_found, bytes_found);
            });
            for item in installers {
                push_unique(
                    &mut items,
                    &mut items_found,
                    &mut bytes_found,
                    item,
                    protected_paths,
                );
            }
        }
    }

    let mut fixed = fixed_dev_paths();
    fixed.extend(fixed_system_paths());
    fixed.extend(fixed_docker_wsl_paths());
    let fixed_items = scan_fixed_paths(&fixed, &enabled, &mut |p| {
        emit_progress(app, p, items_found, bytes_found);
    });
    for item in fixed_items {
        push_unique(
            &mut items,
            &mut items_found,
            &mut bytes_found,
            item,
            protected_paths,
        );
    }

    if enabled.contains(&Category::RecycleBin) {
        let rb = recycle_bin_item();
        push_unique(
            &mut items,
            &mut items_found,
            &mut bytes_found,
            rb,
            protected_paths,
        );
        emit_progress(app, "回收站", items_found, bytes_found);
    }

    if enabled.contains(&Category::DockerWsl) {
        let prune = docker_prune_item();
        push_unique(
            &mut items,
            &mut items_found,
            &mut bytes_found,
            prune,
            protected_paths,
        );
        emit_progress(app, "Docker prune", items_found, bytes_found);
    }

    if safe_only {
        items.retain(|i| i.risk == Risk::Safe);
        items_found = items.len();
        bytes_found = items.iter().map(|i| i.bytes).sum();
        emit_progress(app, "仅保留安全项", items_found, bytes_found);
    }

    items.sort_by(|a, b| b.bytes.cmp(&a.bytes));

    let total_bytes: u64 = items.iter().map(|i| i.bytes).sum();

    emit_progress(app, "完成", items_found, total_bytes);

    ScanResult {
        items,
        total_bytes,
        scanned_roots: scan_roots,
    }
}
