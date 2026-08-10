use std::collections::HashSet;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use crate::model::{Category, Risk, ScanItem};
use crate::scan::size::dir_size_bytes;

const SKIP_DIR_NAMES: &[&str] = &[
    ".git",
    "node_modules",
    ".pnpm-store",
    "$Recycle.Bin",
    "System Volume Information",
];

/// Directories already covered by project/cache rules — skip when hunting large files
/// so we do not double-report artifacts inside `target`, `.next`, etc.
const LARGE_FILE_SKIP_DIR_NAMES: &[&str] = &[
    ".git",
    "node_modules",
    ".pnpm-store",
    "$Recycle.Bin",
    "System Volume Information",
    "target",
    ".next",
    ".turbo",
    ".vite",
    ".nuxt",
    ".output",
    ".svelte-kit",
    "dist",
    "build",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".cache",
    "coverage",
    ".parcel-cache",
    ".eslintcache",
];

#[derive(Clone)]
pub struct MatchRule {
    pub category: Category,
    pub risk: Risk,
    pub selected_by_default: bool,
}

pub fn item_id(path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    hex::encode(hasher.finalize())[..16].to_string()
}

pub fn make_item(path: PathBuf, category: Category, risk: Risk, selected: bool) -> ScanItem {
    let path_str = path.to_string_lossy().to_string();
    let bytes = dir_size_bytes(&path);
    ScanItem {
        id: item_id(&path_str),
        category_label: category.label().to_string(),
        category,
        path: path_str,
        bytes,
        risk,
        selected_by_default: selected,
        special: None,
    }
}

pub fn make_special_item(
    id: &str,
    label_path: &str,
    category: Category,
    risk: Risk,
    selected: bool,
    special: &str,
    bytes: u64,
) -> ScanItem {
    ScanItem {
        id: id.to_string(),
        category_label: category.label().to_string(),
        category,
        path: label_path.to_string(),
        bytes,
        risk,
        selected_by_default: selected,
        special: Some(special.to_string()),
    }
}

fn should_skip_dir(name: &str) -> bool {
    SKIP_DIR_NAMES
        .iter()
        .any(|s| s.eq_ignore_ascii_case(name))
}

fn should_skip_large_file_dir(name: &str) -> bool {
    LARGE_FILE_SKIP_DIR_NAMES
        .iter()
        .any(|s| s.eq_ignore_ascii_case(name))
}

fn has_package_json(dir: &Path) -> bool {
    dir.join("package.json").is_file()
}

fn has_cargo_toml(dir: &Path) -> bool {
    dir.join("Cargo.toml").is_file()
}

fn ancestor_has_package_json(path: &Path, max_up: usize) -> bool {
    let mut cur = path.parent();
    for _ in 0..max_up {
        match cur {
            Some(p) => {
                if has_package_json(p) {
                    return true;
                }
                cur = p.parent();
            }
            None => return false,
        }
    }
    false
}

fn match_project_dir(path: &Path, name: &str) -> Option<MatchRule> {
    // Rust / Tauri target
    if name.eq_ignore_ascii_case("target") {
        if let Some(parent) = path.parent() {
            let parent_name = parent.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if parent_name.eq_ignore_ascii_case("src-tauri") {
                return Some(MatchRule {
                    category: Category::RustTauri,
                    risk: Risk::Safe,
                    selected_by_default: true,
                });
            }
            if has_cargo_toml(parent) {
                return Some(MatchRule {
                    category: Category::RustTauri,
                    risk: Risk::Safe,
                    selected_by_default: true,
                });
            }
        }
        return None;
    }

    // Node build artifacts
    if matches!(
        name,
        ".next" | ".turbo" | ".vite" | ".nuxt" | ".output" | ".svelte-kit"
    ) {
        return Some(MatchRule {
            category: Category::NodeBuild,
            risk: Risk::Safe,
            selected_by_default: true,
        });
    }

    if matches!(name, "dist" | "build") {
        if ancestor_has_package_json(path, 3) {
            return Some(MatchRule {
                category: Category::NodeBuild,
                risk: Risk::Safe,
                selected_by_default: true,
            });
        }
        return None;
    }

    // Python
    if matches!(name, "__pycache__" | ".pytest_cache" | ".mypy_cache" | ".ruff_cache") {
        return Some(MatchRule {
            category: Category::Python,
            risk: Risk::Safe,
            selected_by_default: true,
        });
    }

    // Other
    if matches!(name, ".cache" | "coverage" | ".parcel-cache" | ".eslintcache") {
        return Some(MatchRule {
            category: Category::OtherDev,
            risk: Risk::Safe,
            selected_by_default: true,
        });
    }

    None
}

/// Walk a project root looking for junk directories. Does not descend into matched junk.
pub fn scan_project_tree(
    root: &Path,
    max_depth: usize,
    enabled: &HashSet<Category>,
    on_progress: &mut dyn FnMut(&str),
) -> Vec<ScanItem> {
    use std::cell::RefCell;

    let mut items = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    if !root.is_dir() {
        return items;
    }

    // Paths of junk dirs already recorded — children must be filtered out.
    let junk_roots: RefCell<Vec<PathBuf>> = RefCell::new(Vec::new());

    let walker = WalkDir::new(root)
        .follow_links(false)
        .max_depth(max_depth)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            if e.path_is_symlink() {
                return false;
            }
            let path = e.path();
            if junk_roots
                .borrow()
                .iter()
                .any(|j| path.starts_with(j) && path != j.as_path())
            {
                return false;
            }
            let name = e.file_name().to_string_lossy();
            if e.file_type().is_dir() && should_skip_dir(&name) {
                return false;
            }
            true
        });

    for entry in walker.filter_map(|e| e.ok()) {
        let path = entry.path();
        on_progress(&path.to_string_lossy());

        if !entry.file_type().is_dir() {
            continue;
        }

        let name = entry.file_name().to_string_lossy();
        if let Some(rule) = match_project_dir(path, &name) {
            junk_roots.borrow_mut().push(path.to_path_buf());
            if !enabled.contains(&rule.category) {
                continue;
            }
            let key = path.to_string_lossy().to_string();
            if seen.insert(key) {
                items.push(make_item(
                    path.to_path_buf(),
                    rule.category,
                    rule.risk,
                    rule.selected_by_default,
                ));
            }
        }
    }

    items
}

/// Walk a project root looking for individual files at or above `min_bytes`.
/// Skips junk/cache directories already covered by other categories.
pub fn scan_large_files(
    root: &Path,
    min_bytes: u64,
    max_depth: usize,
    on_progress: &mut dyn FnMut(&str),
) -> Vec<ScanItem> {
    let mut items = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    if !root.is_dir() || min_bytes == 0 {
        return items;
    }

    let walker = WalkDir::new(root)
        .follow_links(false)
        .max_depth(max_depth)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            if e.path_is_symlink() {
                return false;
            }
            let name = e.file_name().to_string_lossy();
            if e.file_type().is_dir() && should_skip_large_file_dir(&name) {
                return false;
            }
            true
        });

    for entry in walker.filter_map(|e| e.ok()) {
        let path = entry.path();
        on_progress(&path.to_string_lossy());

        if !entry.file_type().is_file() {
            continue;
        }

        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.is_file() || meta.len() < min_bytes {
            continue;
        }

        let key = path.to_string_lossy().to_string();
        if !seen.insert(key) {
            continue;
        }

        let path_str = path.to_string_lossy().to_string();
        items.push(ScanItem {
            id: item_id(&path_str),
            category_label: Category::LargeFiles.label().to_string(),
            category: Category::LargeFiles,
            path: path_str,
            bytes: meta.len(),
            risk: Risk::Caution,
            selected_by_default: false,
            special: None,
        });
    }

    items
}

pub struct FixedPath {
    pub path: PathBuf,
    pub category: Category,
    pub risk: Risk,
    pub selected_by_default: bool,
}

fn push_ide_cache_dirs(paths: &mut Vec<FixedPath>, base: PathBuf) {
    for name in ["Cache", "CachedData", "Code Cache", "GPUCache", "logs"] {
        paths.push(FixedPath {
            path: base.join(name),
            category: Category::IdeCache,
            risk: Risk::Caution,
            selected_by_default: false,
        });
    }
}

pub fn fixed_dev_paths() -> Vec<FixedPath> {
    let mut paths = Vec::new();

    if let Some(home) = dirs::home_dir() {
        // Gradle
        paths.push(FixedPath {
            path: home.join(".gradle").join("caches"),
            category: Category::Java,
            risk: Risk::Safe,
            selected_by_default: true,
        });
        // Maven — caution, not selected
        paths.push(FixedPath {
            path: home.join(".m2").join("repository"),
            category: Category::Java,
            risk: Risk::Caution,
            selected_by_default: false,
        });
        // JetBrains shared caches (Linux-style layout also appears via JetBrains Toolbox)
        paths.push(FixedPath {
            path: home.join(".cache").join("JetBrains"),
            category: Category::IdeCache,
            risk: Risk::Caution,
            selected_by_default: false,
        });
    }

    // npm cache
    if let Some(roaming) = dirs::config_dir() {
        // On Windows config_dir is AppData\Roaming
        paths.push(FixedPath {
            path: roaming.join("npm-cache"),
            category: Category::PackageManagerCache,
            risk: Risk::Safe,
            selected_by_default: true,
        });

        // VS Code / Cursor / VSCodium editor caches
        push_ide_cache_dirs(&mut paths, roaming.join("Code"));
        push_ide_cache_dirs(&mut paths, roaming.join("Cursor"));
        push_ide_cache_dirs(&mut paths, roaming.join("VSCodium"));
    }

    if let Some(local) = dirs::data_local_dir() {
        paths.push(FixedPath {
            path: local.join("Yarn").join("Cache"),
            category: Category::PackageManagerCache,
            risk: Risk::Safe,
            selected_by_default: true,
        });
        paths.push(FixedPath {
            path: local.join("npm-cache"),
            category: Category::PackageManagerCache,
            risk: Risk::Safe,
            selected_by_default: true,
        });
        paths.push(FixedPath {
            path: local.join("pnpm-cache"),
            category: Category::PackageManagerCache,
            risk: Risk::Safe,
            selected_by_default: true,
        });
        // pnpm store — caution (global)
        paths.push(FixedPath {
            path: local.join("pnpm").join("store"),
            category: Category::PackageManagerCache,
            risk: Risk::Caution,
            selected_by_default: false,
        });
        paths.push(FixedPath {
            path: local.join("pip").join("Cache"),
            category: Category::Python,
            risk: Risk::Safe,
            selected_by_default: true,
        });

        // JetBrains product caches / logs / tmp under Local AppData
        let jetbrains = local.join("JetBrains");
        if jetbrains.is_dir() {
            if let Ok(products) = std::fs::read_dir(&jetbrains) {
                for product in products.flatten() {
                    let product_path = product.path();
                    if !product_path.is_dir() {
                        continue;
                    }
                    for name in ["caches", "log", "tmp", "Local History"] {
                        paths.push(FixedPath {
                            path: product_path.join(name),
                            category: Category::IdeCache,
                            risk: Risk::Caution,
                            selected_by_default: false,
                        });
                    }
                }
            }
        }
    }

    // Cargo registry/git caches are useful but large — include as caution under Rust
    if let Some(home) = dirs::home_dir() {
        let cargo = home.join(".cargo");
        paths.push(FixedPath {
            path: cargo.join("registry").join("cache"),
            category: Category::RustTauri,
            risk: Risk::Caution,
            selected_by_default: false,
        });
        paths.push(FixedPath {
            path: cargo.join("git").join("db"),
            category: Category::RustTauri,
            risk: Risk::Caution,
            selected_by_default: false,
        });
    }

    paths
}

fn push_chromium_profile_caches(paths: &mut Vec<FixedPath>, user_data: PathBuf) {
    let default = user_data.join("Default");
    for name in ["Cache", "Code Cache", "GPUCache"] {
        paths.push(FixedPath {
            path: default.join(name),
            category: Category::BrowserCache,
            risk: Risk::Dangerous,
            selected_by_default: false,
        });
    }
}

fn push_firefox_profile_caches(paths: &mut Vec<FixedPath>, profiles_root: PathBuf) {
    let Ok(entries) = std::fs::read_dir(&profiles_root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        paths.push(FixedPath {
            path: path.join("cache2"),
            category: Category::BrowserCache,
            risk: Risk::Dangerous,
            selected_by_default: false,
        });
        paths.push(FixedPath {
            path: path.join("startupCache"),
            category: Category::BrowserCache,
            risk: Risk::Dangerous,
            selected_by_default: false,
        });
    }
}

pub fn fixed_system_paths() -> Vec<FixedPath> {
    let mut paths = Vec::new();

    if let Ok(temp) = std::env::var("TEMP") {
        paths.push(FixedPath {
            path: PathBuf::from(temp),
            category: Category::SystemTemp,
            risk: Risk::Safe,
            selected_by_default: true,
        });
    }
    if let Ok(tmp) = std::env::var("TMP") {
        let p = PathBuf::from(&tmp);
        if std::env::var("TEMP").ok().as_deref() != Some(tmp.as_str()) {
            paths.push(FixedPath {
                path: p,
                category: Category::SystemTemp,
                risk: Risk::Safe,
                selected_by_default: true,
            });
        }
    }

    if let Some(local) = dirs::data_local_dir() {
        paths.push(FixedPath {
            path: local.join("Temp"),
            category: Category::SystemTemp,
            risk: Risk::Safe,
            selected_by_default: true,
        });

        // Thumbnail / icon caches (individual db files)
        let explorer = local.join("Microsoft").join("Windows").join("Explorer");
        if explorer.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&explorer) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_lowercase();
                    if (name.starts_with("thumbcache") || name.starts_with("iconcache"))
                        && name.ends_with(".db")
                    {
                        paths.push(FixedPath {
                            path: entry.path(),
                            category: Category::SystemTemp,
                            risk: Risk::Caution,
                            selected_by_default: false,
                        });
                    }
                }
            }
        }

        // Delivery Optimization cache
        paths.push(FixedPath {
            path: local
                .join("Microsoft")
                .join("Windows")
                .join("DeliveryOptimization")
                .join("Cache"),
            category: Category::SystemTemp,
            risk: Risk::Safe,
            selected_by_default: true,
        });

        // Chrome / Edge / Brave
        push_chromium_profile_caches(
            &mut paths,
            local.join("Google").join("Chrome").join("User Data"),
        );
        push_chromium_profile_caches(
            &mut paths,
            local.join("Microsoft").join("Edge").join("User Data"),
        );
        push_chromium_profile_caches(
            &mut paths,
            local.join("BraveSoftware").join("Brave-Browser").join("User Data"),
        );

        // Firefox
        push_firefox_profile_caches(&mut paths, local.join("Mozilla").join("Firefox").join("Profiles"));
    }

    // Prefetch — caution (diagnostics / boot hints)
    paths.push(FixedPath {
        path: PathBuf::from(r"C:\Windows\Prefetch"),
        category: Category::SystemTemp,
        risk: Risk::Caution,
        selected_by_default: false,
    });

    // Windows Update download cache — often needs admin
    paths.push(FixedPath {
        path: PathBuf::from(r"C:\Windows\SoftwareDistribution\Download"),
        category: Category::SystemTemp,
        risk: Risk::Dangerous,
        selected_by_default: false,
    });

    // Previous Windows installation leftover
    paths.push(FixedPath {
        path: PathBuf::from(r"C:\Windows.old"),
        category: Category::SystemTemp,
        risk: Risk::Dangerous,
        selected_by_default: false,
    });

    paths
}

/// Find stale `node_modules` directories under a project root.
pub fn scan_node_modules(
    root: &Path,
    max_depth: usize,
    stale_days: u64,
    on_progress: &mut dyn FnMut(&str),
) -> Vec<ScanItem> {
    use std::time::{Duration, SystemTime};

    let mut items = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    if !root.is_dir() {
        return items;
    }

    let min_age = Duration::from_secs(stale_days.saturating_mul(24 * 60 * 60));
    let now = SystemTime::now();

    let walker = WalkDir::new(root)
        .follow_links(false)
        .max_depth(max_depth)
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            if e.path_is_symlink() {
                return false;
            }
            let name = e.file_name().to_string_lossy();
            if e.file_type().is_dir()
                && matches!(
                    name.as_ref(),
                    ".git" | ".pnpm-store" | "$Recycle.Bin" | "System Volume Information"
                )
            {
                return false;
            }
            // Do not descend into node_modules; the node_modules directory itself is still visited.
            if e.depth() > 1 {
                if let Some(parent) = e.path().parent() {
                    if parent
                        .file_name()
                        .and_then(|s| s.to_str())
                        .map(|s| s.eq_ignore_ascii_case("node_modules"))
                        .unwrap_or(false)
                    {
                        return false;
                    }
                }
            }
            true
        });

    for entry in walker.filter_map(|e| e.ok()) {
        let path = entry.path();
        on_progress(&path.to_string_lossy());

        if !entry.file_type().is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy();
        if !name.eq_ignore_ascii_case("node_modules") {
            continue;
        }
        // Prefer project-level node_modules (parent has package.json)
        let Some(parent) = path.parent() else {
            continue;
        };
        if !has_package_json(parent) {
            continue;
        }
        // Skip nested node_modules inside another node_modules
        if parent
            .components()
            .any(|c| c.as_os_str().eq_ignore_ascii_case("node_modules"))
        {
            continue;
        }

        let meta = match std::fs::metadata(path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modified = match meta.modified() {
            Ok(t) => t,
            Err(_) => continue,
        };
        let age = match now.duration_since(modified) {
            Ok(d) => d,
            Err(_) => continue,
        };
        if age < min_age {
            continue;
        }

        let key = path.to_string_lossy().to_string();
        if !seen.insert(key) {
            continue;
        }
        items.push(make_item(
            path.to_path_buf(),
            Category::NodeModules,
            Risk::Caution,
            false,
        ));
    }

    items
}

pub fn fixed_docker_wsl_paths() -> Vec<FixedPath> {
    let mut paths = Vec::new();

    if let Some(local) = dirs::data_local_dir() {
        // Docker Desktop WSL virtual disks
        paths.push(FixedPath {
            path: local
                .join("Docker")
                .join("wsl")
                .join("data")
                .join("ext4.vhdx"),
            category: Category::DockerWsl,
            risk: Risk::Dangerous,
            selected_by_default: false,
        });
        paths.push(FixedPath {
            path: local
                .join("Docker")
                .join("wsl")
                .join("distro")
                .join("ext4.vhdx"),
            category: Category::DockerWsl,
            risk: Risk::Dangerous,
            selected_by_default: false,
        });

        // WSL distro packages store vhdx under LocalState
        let packages = local.join("Packages");
        if packages.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&packages) {
                for entry in entries.flatten() {
                    let local_state = entry.path().join("LocalState");
                    let vhdx = local_state.join("ext4.vhdx");
                    if vhdx.is_file() {
                        paths.push(FixedPath {
                            path: vhdx,
                            category: Category::DockerWsl,
                            risk: Risk::Dangerous,
                            selected_by_default: false,
                        });
                    }
                }
            }
        }
    }

    paths
}

pub fn docker_prune_item() -> ScanItem {
    // Size unknown until prune; show as actionable special with 0 estimate.
    make_special_item(
        "special:docker_prune",
        "Docker system prune（未使用的镜像 / 容器 / 网络）",
        Category::DockerWsl,
        Risk::Dangerous,
        false,
        "docker_prune",
        0,
    )
}

/// Prefer file size for vhdx; fall back to dir size for directories.
pub fn make_file_or_dir_item(
    path: PathBuf,
    category: Category,
    risk: Risk,
    selected: bool,
) -> ScanItem {
    let path_str = path.to_string_lossy().to_string();
    let bytes = if path.is_file() {
        std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
    } else {
        dir_size_bytes(&path)
    };
    ScanItem {
        id: item_id(&path_str),
        category_label: category.label().to_string(),
        category,
        path: path_str,
        bytes,
        risk,
        selected_by_default: selected,
        special: None,
    }
}

pub fn scan_fixed_paths(
    fixed: &[FixedPath],
    enabled: &HashSet<Category>,
    on_progress: &mut dyn FnMut(&str),
) -> Vec<ScanItem> {
    let mut items = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for fp in fixed {
        if !enabled.contains(&fp.category) {
            continue;
        }
        on_progress(&fp.path.to_string_lossy());
        if !fp.path.exists() {
            continue;
        }
        let canonical = fp
            .path
            .canonicalize()
            .unwrap_or_else(|_| fp.path.clone())
            .to_string_lossy()
            .to_string();
        if !seen.insert(canonical) {
            continue;
        }
        items.push(make_file_or_dir_item(
            fp.path.clone(),
            fp.category.clone(),
            fp.risk.clone(),
            fp.selected_by_default,
        ));
    }
    items
}

pub fn recycle_bin_item() -> ScanItem {
    let bytes = estimate_recycle_bin_size();
    make_special_item(
        "special:recycle_bin",
        "回收站 (所有驱动器)",
        Category::RecycleBin,
        Risk::Safe,
        true,
        "recycle_bin",
        bytes,
    )
}

fn estimate_recycle_bin_size() -> u64 {
    let mut total = 0u64;
    for letter in b'C'..=b'Z' {
        let drive = format!("{}:\\$Recycle.Bin", letter as char);
        let path = Path::new(&drive);
        if path.is_dir() {
            total = total.saturating_add(dir_size_bytes(path));
        }
    }
    total
}
