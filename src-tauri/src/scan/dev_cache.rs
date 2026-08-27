use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use walkdir::WalkDir;

use crate::config::{self, ProtectionRules};
use crate::model::{
    Category, DevCacheDashboard, DevCachePathItem, DevCacheToolGroup, ProjectWasteItem, Risk,
};
use crate::scan::rules::{fixed_dev_paths, FixedPath};
use crate::scan::size::dir_size_bytes;

fn is_cancelled(cancel: Option<&AtomicBool>) -> bool {
    cancel
        .map(|c| c.load(Ordering::Relaxed))
        .unwrap_or(false)
}

fn tool_for_path(path: &Path, category: &Category) -> (&'static str, &'static str) {
    let s = path.to_string_lossy().to_lowercase().replace('/', "\\");
    if s.contains("pnpm") {
        return ("pnpm", "pnpm");
    }
    if s.contains("npm-cache") || s.contains("\\npm\\") || s.ends_with("\\npm") {
        return ("npm", "npm");
    }
    if s.contains(".bun") || s.contains("\\bun\\") {
        return ("bun", "Bun");
    }
    if s.contains(".cargo") || s.contains("\\cargo\\") {
        return ("cargo", "Cargo / Rust");
    }
    if s.contains(".gradle") || s.contains("\\gradle\\") {
        return ("gradle", "Gradle");
    }
    if s.contains(".m2") || s.contains("\\maven") {
        return ("maven", "Maven");
    }
    if s.contains("\\pip\\") || s.contains("\\pip\\cache") {
        return ("pip", "pip");
    }
    if s.contains("\\uv\\") {
        return ("uv", "uv");
    }
    if s.contains("nuget") {
        return ("nuget", "NuGet");
    }
    if s.contains("\\go\\pkg") || s.contains("gopath") {
        return ("go", "Go modules");
    }
    if s.contains("scoop") {
        return ("scoop", "Scoop");
    }
    if s.contains("conda") || s.contains("miniforge") || s.contains("anaconda") {
        return ("conda", "Conda");
    }
    if s.contains("pub-cache") || s.contains(".pub-cache") {
        return ("flutter", "Flutter / Dart");
    }
    if s.contains("jetbrains")
        || s.contains("code - oss")
        || s.contains("cursor")
        || s.contains("vscode")
        || s.contains("visual studio code")
        || matches!(category, Category::IdeCache)
    {
        return ("ide", "IDE / 编辑器");
    }
    match category {
        Category::RustTauri => ("cargo", "Cargo / Rust"),
        Category::Java => ("java", "Java 工具链"),
        Category::Python => ("python", "Python"),
        Category::PackageManagerCache => ("pkg", "其他包管理器"),
        Category::IdeCache => ("ide", "IDE / 编辑器"),
        _ => ("other", "其他开发缓存"),
    }
}

fn path_item(path: PathBuf, category: Category, risk: Risk) -> DevCachePathItem {
    let bytes = if path.is_file() {
        std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
    } else {
        dir_size_bytes(&path)
    };
    DevCachePathItem {
        path: path.to_string_lossy().to_string(),
        bytes,
        category_label: category.label().to_string(),
        category,
        risk,
    }
}

fn scan_tool_groups(
    protection: &config::ProtectionRules<'_>,
    cancel: Option<&AtomicBool>,
    on_progress: &mut dyn FnMut(&str),
) -> Vec<DevCacheToolGroup> {
    let fixed: Vec<FixedPath> = fixed_dev_paths();
    let mut groups: HashMap<&'static str, DevCacheToolGroup> = HashMap::new();

    for fp in fixed {
        if is_cancelled(cancel) {
            break;
        }
        if !fp.path.exists() {
            continue;
        }
        if protection.check(&fp.path) {
            continue;
        }
        let path_str = fp.path.to_string_lossy().to_string();
        on_progress(&path_str);

        let (id, label) = tool_for_path(&fp.path, &fp.category);
        let item = path_item(fp.path, fp.category, fp.risk);
        if item.bytes == 0 {
            continue;
        }
        let entry = groups.entry(id).or_insert_with(|| DevCacheToolGroup {
            id: id.to_string(),
            label: label.to_string(),
            bytes: 0,
            paths: Vec::new(),
            suggested_mode: "dev".into(),
        });
        entry.bytes = entry.bytes.saturating_add(item.bytes);
        entry.paths.push(item);
    }

    let mut list: Vec<_> = groups.into_values().collect();
    for g in &mut list {
        g.paths.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    }
    list.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    list
}

fn is_project_waste_dir(name: &str) -> Option<(Category, Risk)> {
    let lower = name.to_lowercase();
    match lower.as_str() {
        "target" => Some((Category::RustTauri, Risk::Safe)),
        "node_modules" => Some((Category::NodeModules, Risk::Caution)),
        ".next" | ".turbo" | ".vite" | ".nuxt" | ".output" | ".svelte-kit" => {
            Some((Category::NodeBuild, Risk::Safe))
        }
        "dist" | "build" => Some((Category::NodeBuild, Risk::Caution)),
        "__pycache__" | ".pytest_cache" | ".mypy_cache" | ".ruff_cache" => {
            Some((Category::Python, Risk::Safe))
        }
        ".cache" => Some((Category::OtherDev, Risk::Caution)),
        ".dart_tool" => Some((Category::OtherDev, Risk::Safe)),
        _ => None,
    }
}

fn scan_project_waste(
    roots: &[String],
    protection: &ProtectionRules<'_>,
    max_depth: usize,
    cancel: Option<&AtomicBool>,
    on_progress: &mut dyn FnMut(&str),
) -> Vec<ProjectWasteItem> {
    let mut by_project: HashMap<String, ProjectWasteItem> = HashMap::new();

    for root in roots {
        if is_cancelled(cancel) {
            break;
        }
        let root_path = Path::new(root);
        if !root_path.is_dir() {
            continue;
        }
        on_progress(root);

        for entry in WalkDir::new(root_path)
            .follow_links(false)
            .max_depth(max_depth)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if is_cancelled(cancel) {
                break;
            }
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            let Some((category, risk)) = is_project_waste_dir(name) else {
                continue;
            };
            if let Some(parent) = path.parent() {
                if let Some(pname) = parent.file_name().and_then(|s| s.to_str()) {
                    if is_project_waste_dir(pname).is_some() {
                        continue;
                    }
                }
            }
            if protection.check(path) {
                continue;
            }
            let path_str = path.to_string_lossy().to_string();
            on_progress(&path_str);

            let project_path = path
                .parent()
                .unwrap_or(path)
                .to_string_lossy()
                .to_string();
            let project_name = Path::new(&project_path)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or(&project_path)
                .to_string();

            let item = path_item(path.to_path_buf(), category, risk);
            if item.bytes == 0 {
                continue;
            }

            let entry = by_project
                .entry(project_path.clone())
                .or_insert_with(|| ProjectWasteItem {
                    project_path: project_path.clone(),
                    project_name: project_name.clone(),
                    bytes: 0,
                    details: Vec::new(),
                });
            entry.bytes = entry.bytes.saturating_add(item.bytes);
            entry.details.push(item);
        }
    }

    let mut list: Vec<_> = by_project.into_values().collect();
    for p in &mut list {
        p.details.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    }
    list.sort_by(|a, b| b.bytes.cmp(&a.bytes));
    list
}

const DASHBOARD_TTL: Duration = Duration::from_secs(300);

struct CachedDashboard {
    key: String,
    built_at: Instant,
    data: DevCacheDashboard,
}

static DASHBOARD_CACHE: Mutex<Option<CachedDashboard>> = Mutex::new(None);

fn dashboard_cache_key(roots: &[String], protection: &ProtectionRules<'_>) -> String {
    format!("{:?}|{:?}|{:?}", roots, protection.paths, protection.globs)
}

pub fn build_dashboard(
    roots: &[String],
    protection: &ProtectionRules<'_>,
    cancel: Option<&AtomicBool>,
    force_refresh: bool,
    mut on_progress: impl FnMut(&str),
) -> DevCacheDashboard {
    let key = dashboard_cache_key(roots, protection);
    if !force_refresh {
        if let Ok(guard) = DASHBOARD_CACHE.lock() {
            if let Some(cached) = guard.as_ref() {
                if cached.key == key && cached.built_at.elapsed() < DASHBOARD_TTL {
                    return cached.data.clone();
                }
            }
        }
    }

    let tool_groups = scan_tool_groups(protection, cancel, &mut on_progress);
    let projects = if is_cancelled(cancel) {
        Vec::new()
    } else {
        scan_project_waste(roots, protection, 5, cancel, &mut on_progress)
    };

    let total_tool_bytes = tool_groups.iter().map(|g| g.bytes).sum();
    let total_project_bytes = projects.iter().map(|p| p.bytes).sum();

    let dashboard = DevCacheDashboard {
        tool_groups,
        projects,
        total_tool_bytes,
        total_project_bytes,
    };

    if let Ok(mut guard) = DASHBOARD_CACHE.lock() {
        *guard = Some(CachedDashboard {
            key,
            built_at: Instant::now(),
            data: dashboard.clone(),
        });
    }

    dashboard
}
