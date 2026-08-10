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

pub struct FixedPath {
    pub path: PathBuf,
    pub category: Category,
    pub risk: Risk,
    pub selected_by_default: bool,
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

        // Chrome / Edge caches — not selected by default
        let chrome_cache = local
            .join("Google")
            .join("Chrome")
            .join("User Data")
            .join("Default")
            .join("Cache");
        paths.push(FixedPath {
            path: chrome_cache,
            category: Category::BrowserCache,
            risk: Risk::Dangerous,
            selected_by_default: false,
        });

        let edge_cache = local
            .join("Microsoft")
            .join("Edge")
            .join("User Data")
            .join("Default")
            .join("Cache");
        paths.push(FixedPath {
            path: edge_cache,
            category: Category::BrowserCache,
            risk: Risk::Dangerous,
            selected_by_default: false,
        });

        let chrome_code = local
            .join("Google")
            .join("Chrome")
            .join("User Data")
            .join("Default")
            .join("Code Cache");
        paths.push(FixedPath {
            path: chrome_code,
            category: Category::BrowserCache,
            risk: Risk::Dangerous,
            selected_by_default: false,
        });

        let edge_code = local
            .join("Microsoft")
            .join("Edge")
            .join("User Data")
            .join("Default")
            .join("Code Cache");
        paths.push(FixedPath {
            path: edge_code,
            category: Category::BrowserCache,
            risk: Risk::Dangerous,
            selected_by_default: false,
        });
    }

    paths
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
        items.push(make_item(
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
