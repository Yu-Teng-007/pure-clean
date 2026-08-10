use std::path::Path;

use walkdir::{DirEntry, WalkDir};

/// Sum file sizes under `path`, skipping reparse points / symlinks and inaccessible files.
pub fn dir_size_bytes(path: &Path) -> u64 {
    if !path.exists() {
        return 0;
    }

    let mut sum = 0u64;
    let walker = WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| !is_reparse_or_symlink(e));

    for entry in walker.filter_map(|e| e.ok()) {
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.is_file() {
            sum = sum.saturating_add(meta.len());
        }
    }
    sum
}

fn is_reparse_or_symlink(entry: &DirEntry) -> bool {
    entry.path_is_symlink()
        || entry
            .metadata()
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false)
}

pub fn format_size(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let b = bytes as f64;
    if b >= GB {
        format!("{:.2} GB", b / GB)
    } else if b >= MB {
        format!("{:.1} MB", b / MB)
    } else if b >= KB {
        format!("{:.0} KB", b / KB)
    } else {
        format!("{bytes} B")
    }
}
