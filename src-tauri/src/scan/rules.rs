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
        group_id: None,
        is_keeper: None,
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
        group_id: None,
        is_keeper: None,
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
    on_progress: &mut dyn FnMut(&str) -> bool,
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
        if !on_progress(&path.to_string_lossy()) {
            break;
        }
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
    on_progress: &mut dyn FnMut(&str) -> bool,
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
        if !on_progress(&path.to_string_lossy()) {
            break;
        }
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
            group_id: None,
            is_keeper: None,
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
    for name in ["Cache", "CachedData", "Code Cache", "GPUCache", "logs", "CachedExtensions", "CachedExtensionVSIXs"] {
        paths.push(FixedPath {
            path: base.join(name),
            category: Category::IdeCache,
            risk: Risk::Caution,
            selected_by_default: false,
        });
    }
}

fn push_safe_cache(
    paths: &mut Vec<FixedPath>,
    path: PathBuf,
    category: Category,
) {
    paths.push(FixedPath {
        path,
        category,
        risk: Risk::Safe,
        selected_by_default: true,
    });
}

fn push_caution_cache(
    paths: &mut Vec<FixedPath>,
    path: PathBuf,
    category: Category,
) {
    paths.push(FixedPath {
        path,
        category,
        risk: Risk::Caution,
        selected_by_default: false,
    });
}

fn push_dangerous_cache(
    paths: &mut Vec<FixedPath>,
    path: PathBuf,
    category: Category,
) {
    paths.push(FixedPath {
        path,
        category,
        risk: Risk::Dangerous,
        selected_by_default: false,
    });
}

pub fn fixed_dev_paths() -> Vec<FixedPath> {
    let mut paths = Vec::new();

    if let Some(home) = dirs::home_dir() {
        // Gradle
        push_safe_cache(
            &mut paths,
            home.join(".gradle").join("caches"),
            Category::Java,
        );
        // Maven — caution, not selected
        push_caution_cache(
            &mut paths,
            home.join(".m2").join("repository"),
            Category::Java,
        );
        // JetBrains shared caches (Linux-style layout also appears via JetBrains Toolbox)
        push_caution_cache(
            &mut paths,
            home.join(".cache").join("JetBrains"),
            Category::IdeCache,
        );
        // NuGet global packages — can reclaim tens of GB
        push_caution_cache(
            &mut paths,
            home.join(".nuget").join("packages"),
            Category::PackageManagerCache,
        );
        // Bun install cache
        push_safe_cache(
            &mut paths,
            home.join(".bun").join("install").join("cache"),
            Category::PackageManagerCache,
        );
        // Go module cache
        push_caution_cache(
            &mut paths,
            home.join("go").join("pkg").join("mod"),
            Category::PackageManagerCache,
        );
        // Scoop package cache
        push_safe_cache(
            &mut paths,
            home.join("scoop").join("cache"),
            Category::PackageManagerCache,
        );
        // Conda / Miniconda package caches
        for name in ["anaconda3", "miniconda3", "miniforge3"] {
            push_caution_cache(
                &mut paths,
                home.join(name).join("pkgs"),
                Category::Python,
            );
        }
        // Cargo registry/git caches — large but rebuildable
        let cargo = home.join(".cargo");
        push_caution_cache(
            &mut paths,
            cargo.join("registry").join("cache"),
            Category::RustTauri,
        );
        push_caution_cache(
            &mut paths,
            cargo.join("git").join("db"),
            Category::RustTauri,
        );
    }

    // npm cache + Electron IDE caches (Roaming)
    if let Some(roaming) = dirs::config_dir() {
        push_safe_cache(
            &mut paths,
            roaming.join("npm-cache"),
            Category::PackageManagerCache,
        );

        for editor in ["Code", "Cursor", "VSCodium", "Code - Insiders"] {
            push_ide_cache_dirs(&mut paths, roaming.join(editor));
        }
    }

    if let Some(local) = dirs::data_local_dir() {
        push_safe_cache(
            &mut paths,
            local.join("Yarn").join("Cache"),
            Category::PackageManagerCache,
        );
        push_safe_cache(
            &mut paths,
            local.join("npm-cache"),
            Category::PackageManagerCache,
        );
        push_safe_cache(
            &mut paths,
            local.join("pnpm-cache"),
            Category::PackageManagerCache,
        );
        // pnpm store — caution (global)
        push_caution_cache(
            &mut paths,
            local.join("pnpm").join("store"),
            Category::PackageManagerCache,
        );
        push_safe_cache(
            &mut paths,
            local.join("pip").join("Cache"),
            Category::Python,
        );
        push_safe_cache(
            &mut paths,
            local.join("uv").join("cache"),
            Category::Python,
        );
        push_safe_cache(
            &mut paths,
            local.join("pypoetry").join("Cache"),
            Category::Python,
        );
        // Go build cache
        push_safe_cache(
            &mut paths,
            local.join("go-build"),
            Category::PackageManagerCache,
        );
        // WinGet temporary download cache (not installed packages)
        push_safe_cache(
            &mut paths,
            local.join("Temp").join("WinGet"),
            Category::PackageManagerCache,
        );
        push_safe_cache(
            &mut paths,
            local.join("Microsoft").join("WinGet").join("Cache"),
            Category::PackageManagerCache,
        );

        // Electron editors also keep caches under Local AppData
        for editor in ["Code", "Cursor", "VSCodium", "Code - Insiders"] {
            push_ide_cache_dirs(&mut paths, local.join(editor));
        }

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
                        push_caution_cache(
                            &mut paths,
                            product_path.join(name),
                            Category::IdeCache,
                        );
                    }
                }
            }
        }
    }

    // Chocolatey download cache only (never `lib` — that holds installed packages)
    push_safe_cache(
        &mut paths,
        PathBuf::from(r"C:\ProgramData\chocolatey\cache"),
        Category::PackageManagerCache,
    );

    paths
}

/// Chromium-family: scan Default / Profile N / Guest / System profiles + shared shader caches.
fn push_chromium_profile_caches(paths: &mut Vec<FixedPath>, user_data: PathBuf) {
    // On-device ML / component caches at User Data root (often multi-GB)
    for name in [
        "OptGuideOnDeviceModel",
        "OptGuideOnDeviceClassifierModel",
        "optimization_guide_model_store",
        "component_crx_cache",
        "extensions_crx_cache",
        "GrShaderCache",
        "ShaderCache",
        "GraphiteDawnCache",
        "Component Crx Cache",
    ] {
        push_safe_cache(paths, user_data.join(name), Category::BrowserCache);
    }

    let Ok(entries) = std::fs::read_dir(&user_data) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_profile = name == "Default"
            || name == "Guest Profile"
            || name == "System Profile"
            || name.starts_with("Profile ");
        if !is_profile {
            continue;
        }
        // Disk / code / GPU caches are safe to clear (pages re-download)
        for cache_name in ["Cache", "Code Cache", "GPUCache"] {
            push_safe_cache(paths, path.join(cache_name), Category::BrowserCache);
        }
        // Service Worker cache can be large; clearing may log users out of PWAs
        push_caution_cache(
            paths,
            path.join("Service Worker").join("CacheStorage"),
            Category::BrowserCache,
        );
        push_caution_cache(
            paths,
            path.join("Service Worker").join("ScriptCache"),
            Category::BrowserCache,
        );
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
        push_safe_cache(paths, path.join("cache2"), Category::BrowserCache);
        push_safe_cache(paths, path.join("startupCache"), Category::BrowserCache);
        push_caution_cache(paths, path.join("offlineCache"), Category::BrowserCache);
    }
}

/// Electron-style app caches under Roaming\<App>\{Cache,Code Cache,GPUCache}.
fn push_electron_app_caches(paths: &mut Vec<FixedPath>, app_dir: PathBuf) {
    for name in ["Cache", "Code Cache", "GPUCache", "blob_storage"] {
        push_safe_cache(paths, app_dir.join(name), Category::AppCache);
    }
}

pub fn fixed_system_paths() -> Vec<FixedPath> {
    let mut paths = Vec::new();

    if let Ok(temp) = std::env::var("TEMP") {
        push_safe_cache(&mut paths, PathBuf::from(temp), Category::SystemTemp);
    }
    if let Ok(tmp) = std::env::var("TMP") {
        let p = PathBuf::from(&tmp);
        if std::env::var("TEMP").ok().as_deref() != Some(tmp.as_str()) {
            push_safe_cache(&mut paths, p, Category::SystemTemp);
        }
    }

    // System-wide temp (often needs admin for some files)
    push_safe_cache(
        &mut paths,
        PathBuf::from(r"C:\Windows\Temp"),
        Category::SystemTemp,
    );

    if let Some(local) = dirs::data_local_dir() {
        push_safe_cache(
            &mut paths,
            local.join("Temp"),
            Category::SystemTemp,
        );

        // Thumbnail / icon caches (individual db files)
        let explorer = local.join("Microsoft").join("Windows").join("Explorer");
        if explorer.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&explorer) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_lowercase();
                    if (name.starts_with("thumbcache") || name.starts_with("iconcache"))
                        && name.ends_with(".db")
                    {
                        push_caution_cache(&mut paths, entry.path(), Category::SystemTemp);
                    }
                }
            }
        }

        // Delivery Optimization cache
        push_safe_cache(
            &mut paths,
            local
                .join("Microsoft")
                .join("Windows")
                .join("DeliveryOptimization")
                .join("Cache"),
            Category::SystemTemp,
        );

        // Internet / Edge WebView temporary internet files
        push_safe_cache(
            &mut paths,
            local.join("Microsoft").join("Windows").join("INetCache"),
            Category::SystemTemp,
        );

        // DirectX shader cache — rebuilds on next game/app launch
        push_safe_cache(
            &mut paths,
            local.join("D3DSCache"),
            Category::SystemTemp,
        );

        // Crash dumps
        push_safe_cache(
            &mut paths,
            local.join("CrashDumps"),
            Category::SystemTemp,
        );

        // Chromium-family browsers (all profiles)
        push_chromium_profile_caches(
            &mut paths,
            local.join("Google").join("Chrome").join("User Data"),
        );
        push_chromium_profile_caches(
            &mut paths,
            local.join("Google").join("Chrome Beta").join("User Data"),
        );
        push_chromium_profile_caches(
            &mut paths,
            local.join("Google").join("Chrome SxS").join("User Data"),
        );
        push_chromium_profile_caches(
            &mut paths,
            local.join("Microsoft").join("Edge").join("User Data"),
        );
        push_chromium_profile_caches(
            &mut paths,
            local.join("Microsoft").join("Edge Beta").join("User Data"),
        );
        push_chromium_profile_caches(
            &mut paths,
            local.join("Microsoft").join("Edge SxS").join("User Data"),
        );
        push_chromium_profile_caches(
            &mut paths,
            local
                .join("BraveSoftware")
                .join("Brave-Browser")
                .join("User Data"),
        );
        push_chromium_profile_caches(
            &mut paths,
            local.join("Vivaldi").join("User Data"),
        );
        push_chromium_profile_caches(
            &mut paths,
            local
                .join("Opera Software")
                .join("Opera Stable"),
        );
        push_chromium_profile_caches(
            &mut paths,
            local.join("Opera Software").join("Opera GX Stable"),
        );
        // Domestic Chromium browsers
        push_chromium_profile_caches(
            &mut paths,
            local.join("Tencent").join("QQBrowser").join("User Data"),
        );
        push_chromium_profile_caches(
            &mut paths,
            local.join("360Chrome").join("Chrome").join("User Data"),
        );
        push_chromium_profile_caches(
            &mut paths,
            local.join("360ChromeX").join("Chrome").join("User Data"),
        );
        push_chromium_profile_caches(
            &mut paths,
            local.join("CentBrowser").join("User Data"),
        );

        // Firefox
        push_firefox_profile_caches(
            &mut paths,
            local.join("Mozilla").join("Firefox").join("Profiles"),
        );
    }

    // Prefetch — caution (diagnostics / boot hints)
    push_caution_cache(
        &mut paths,
        PathBuf::from(r"C:\Windows\Prefetch"),
        Category::SystemTemp,
    );

    // Windows Update download cache — often needs admin
    push_dangerous_cache(
        &mut paths,
        PathBuf::from(r"C:\Windows\SoftwareDistribution\Download"),
        Category::SystemTemp,
    );

    // CBS / DISM logs
    push_safe_cache(
        &mut paths,
        PathBuf::from(r"C:\Windows\Logs\CBS"),
        Category::SystemTemp,
    );
    push_safe_cache(
        &mut paths,
        PathBuf::from(r"C:\Windows\Logs\DISM"),
        Category::SystemTemp,
    );

    // Memory dump / minidumps
    push_caution_cache(
        &mut paths,
        PathBuf::from(r"C:\Windows\Minidump"),
        Category::SystemTemp,
    );
    push_dangerous_cache(
        &mut paths,
        PathBuf::from(r"C:\Windows\MEMORY.DMP"),
        Category::SystemTemp,
    );

    // Windows Error Reporting queue
    push_safe_cache(
        &mut paths,
        PathBuf::from(r"C:\ProgramData\Microsoft\Windows\WER"),
        Category::SystemTemp,
    );

    // Upgrade leftovers — often 10–30+ GB
    push_dangerous_cache(
        &mut paths,
        PathBuf::from(r"C:\Windows.old"),
        Category::SystemTemp,
    );
    push_dangerous_cache(
        &mut paths,
        PathBuf::from(r"C:\$WINDOWS.~BT"),
        Category::SystemTemp,
    );
    push_dangerous_cache(
        &mut paths,
        PathBuf::from(r"C:\$WINDOWS.~WS"),
        Category::SystemTemp,
    );

    paths
}

/// Third-party / Microsoft app caches that commonly eat tens of GB on C:.
pub fn fixed_app_cache_paths() -> Vec<FixedPath> {
    let mut paths = Vec::new();

    if let Some(roaming) = dirs::config_dir() {
        // Discord / Slack / Teams (classic) / Spotify Electron shells
        for app in ["discord", "DiscordCanary", "DiscordPTB", "slack", "Spotify"] {
            push_electron_app_caches(&mut paths, roaming.join(app));
        }
        push_electron_app_caches(&mut paths, roaming.join("Microsoft").join("Teams"));
        // Teams also keeps meeting recordings / blobs
        push_caution_cache(
            &mut paths,
            roaming.join("Microsoft").join("Teams").join("Service Worker").join("CacheStorage"),
            Category::AppCache,
        );

        // WeChat / QQ (Tencent) roaming caches
        push_safe_cache(
            &mut paths,
            roaming.join("Tencent").join("WeChat").join("radium"),
            Category::AppCache,
        );
        push_caution_cache(
            &mut paths,
            roaming.join("Tencent").join("xwechat"),
            Category::AppCache,
        );
        push_safe_cache(
            &mut paths,
            roaming.join("Tencent").join("QQ").join("Temp"),
            Category::AppCache,
        );
    }

    if let Some(local) = dirs::data_local_dir() {
        // Android SDK — emulators / images are huge
        push_caution_cache(
            &mut paths,
            local.join("Android").join("Sdk").join(".temp"),
            Category::AppCache,
        );
        push_caution_cache(
            &mut paths,
            local.join("Android").join("Sdk").join("system-images"),
            Category::Installers,
        );
        push_caution_cache(
            &mut paths,
            local.join("Android").join("Sdk").join("emulator"),
            Category::AppCache,
        );

        // Android Studio caches (Google\AndroidStudio*)
        let google = local.join("Google");
        if google.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&google) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if name.starts_with("AndroidStudio") {
                        let base = entry.path();
                        for sub in ["caches", "log", "tmp", "index", "gradle"] {
                            push_caution_cache(&mut paths, base.join(sub), Category::IdeCache);
                        }
                    }
                }
            }
        }

        // Playwright bundled browsers
        push_caution_cache(
            &mut paths,
            local.join("ms-playwright"),
            Category::OtherDev,
        );

        // Claude Desktop
        for claude_dir in ["Claude", "Claude-3p"] {
            let base = local.join(claude_dir);
            push_electron_app_caches(&mut paths, base.clone());
            push_caution_cache(&mut paths, base.join("vm_bundles"), Category::AppCache);
        }

        // DingTalk / Quark / WPS (common on CN desktops)
        if local.join("DingTalk_133").is_dir() {
            push_safe_cache(
                &mut paths,
                local.join("DingTalk_133").join("Cache"),
                Category::AppCache,
            );
        }
        push_electron_app_caches(&mut paths, local.join("Quark"));
        push_caution_cache(
            &mut paths,
            local.join("kingsoft").join("WPS Office").join("cache"),
            Category::AppCache,
        );

        // Office file cache / Telemetry
        push_caution_cache(
            &mut paths,
            local
                .join("Microsoft")
                .join("Office")
                .join("16.0")
                .join("OfficeFileCache"),
            Category::AppCache,
        );
        push_safe_cache(
            &mut paths,
            local.join("Microsoft").join("Office").join("SolutionPackages"),
            Category::AppCache,
        );

        // New Microsoft Teams (Store / MSIX)
        let packages = local.join("Packages");
        if packages.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&packages) {
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if name.starts_with("MSTeams_") || name.starts_with("MicrosoftTeams_") {
                        let base = entry.path().join("LocalCache").join("Microsoft").join("MSTeams");
                        push_safe_cache(
                            &mut paths,
                            base.join("EBWebView").join("Cache"),
                            Category::AppCache,
                        );
                        push_safe_cache(
                            &mut paths,
                            base.join("EBWebView").join("Code Cache"),
                            Category::AppCache,
                        );
                        push_safe_cache(
                            &mut paths,
                            base.join("EBWebView").join("GPUCache"),
                            Category::AppCache,
                        );
                    }
                }
            }
        }

        // Steam HTML / shader caches (not game installs)
        push_safe_cache(
            &mut paths,
            local.join("Steam").join("htmlcache"),
            Category::AppCache,
        );
        push_safe_cache(
            &mut paths,
            local.join("Steam").join("shadercache"),
            Category::AppCache,
        );

        // NVIDIA / AMD / Intel driver caches
        push_safe_cache(
            &mut paths,
            local.join("NVIDIA").join("DXCache"),
            Category::AppCache,
        );
        push_safe_cache(
            &mut paths,
            local.join("NVIDIA").join("GLCache"),
            Category::AppCache,
        );
        push_safe_cache(
            &mut paths,
            local.join("AMD").join("DxCache"),
            Category::AppCache,
        );
        push_safe_cache(
            &mut paths,
            local.join("AMD").join("GLCache"),
            Category::AppCache,
        );
        push_safe_cache(
            &mut paths,
            local.join("Intel").join("ShaderCache"),
            Category::AppCache,
        );

        // Spotify local storage (offline may live here — caution)
        push_caution_cache(
            &mut paths,
            local.join("Spotify").join("Storage"),
            Category::AppCache,
        );
        push_caution_cache(
            &mut paths,
            local.join("Spotify").join("Data"),
            Category::AppCache,
        );

        // Epic Games Launcher cache
        push_safe_cache(
            &mut paths,
            local
                .join("EpicGamesLauncher")
                .join("Saved")
                .join("webcache"),
            Category::AppCache,
        );
        push_safe_cache(
            &mut paths,
            local
                .join("EpicGamesLauncher")
                .join("Saved")
                .join("webcache_4430"),
            Category::AppCache,
        );

        // NetEase Cloud Music cache
        push_caution_cache(
            &mut paths,
            local.join("Netease").join("CloudMusic").join("Cache"),
            Category::AppCache,
        );

        // Baidu Netdisk cache
        push_caution_cache(
            &mut paths,
            local.join("BaiduNetdisk").join("Cache"),
            Category::AppCache,
        );

        // Thunder / Xunlei
        push_safe_cache(
            &mut paths,
            local.join("Thunder Network").join("Thunder").join("Data").join("Temp"),
            Category::AppCache,
        );

        // Tencent Meeting / WeCom temp
        push_safe_cache(
            &mut paths,
            local.join("Tencent").join("WeMeet").join("Temp"),
            Category::AppCache,
        );
        push_safe_cache(
            &mut paths,
            local.join("Tencent").join("WXWork").join("Cache"),
            Category::AppCache,
        );
    }

    // WeChat file caches under Documents (often the largest consumer)
    if let Some(home) = dirs::home_dir() {
        push_caution_cache(
            &mut paths,
            home.join(".android").join("cache"),
            Category::AppCache,
        );
        push_caution_cache(
            &mut paths,
            home.join(".android").join("avd"),
            Category::AppCache,
        );

        let wechat_files = home.join("Documents").join("WeChat Files");
        if wechat_files.is_dir() {
            if let Ok(accounts) = std::fs::read_dir(&wechat_files) {
                for account in accounts.flatten() {
                    let account_path = account.path();
                    if !account_path.is_dir() {
                        continue;
                    }
                    let name = account.file_name().to_string_lossy().into_owned();
                    // Skip All Users / WMPF related shared dirs carefully
                    if name.eq_ignore_ascii_case("All Users")
                        || name.eq_ignore_ascii_case("WMPF")
                        || name.starts_with('.')
                    {
                        continue;
                    }
                    let storage = account_path.join("FileStorage");
                    push_caution_cache(
                        &mut paths,
                        storage.join("Cache"),
                        Category::AppCache,
                    );
                    push_caution_cache(
                        &mut paths,
                        storage.join("Temp"),
                        Category::AppCache,
                    );
                    // Image / video / file caches — caution (user may want media)
                    push_caution_cache(
                        &mut paths,
                        storage.join("Image").join("Thumb"),
                        Category::AppCache,
                    );
                }
            }
        }
    }

    paths
}

/// Find stale `node_modules` directories under a project root.
pub fn scan_node_modules(
    root: &Path,
    max_depth: usize,
    stale_days: u64,
    on_progress: &mut dyn FnMut(&str) -> bool,
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
        if !on_progress(&path.to_string_lossy()) {
            break;
        }
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
        group_id: None,
        is_keeper: None,
    }
}

fn file_content_hash(path: &Path) -> Option<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 1024 * 64];
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Some(hex::encode(hasher.finalize()))
}

const FILE_SCAN_SKIP: &[&str] = &[
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
    "__pycache__",
];

fn should_skip_file_scan_dir(name: &str) -> bool {
    FILE_SCAN_SKIP
        .iter()
        .any(|s| s.eq_ignore_ascii_case(name))
}

/// Find duplicate files by size then content hash. Keep the oldest path; select copies.
pub fn scan_duplicate_files(
    root: &Path,
    min_bytes: u64,
    max_depth: usize,
    on_progress: &mut dyn FnMut(&str) -> bool,
) -> Vec<ScanItem> {
    use std::collections::HashMap;

    let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();

    if !root.is_dir() || min_bytes == 0 {
        return Vec::new();
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
            if e.file_type().is_dir() && should_skip_file_scan_dir(&name) {
                return false;
            }
            true
        });

    for entry in walker.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !on_progress(&path.to_string_lossy()) {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.len() < min_bytes {
            continue;
        }
        by_size.entry(meta.len()).or_default().push(path.to_path_buf());
    }

    let mut items = Vec::new();
    'dupe_groups: for (size, paths) in by_size {
        if paths.len() < 2 {
            continue;
        }
        let mut by_hash: HashMap<String, Vec<PathBuf>> = HashMap::new();
        for path in paths {
            if !on_progress(&path.to_string_lossy()) {
                break 'dupe_groups;
            }
            if let Some(hash) = file_content_hash(&path) {
                by_hash.entry(hash).or_default().push(path);
            }
        }
        for (hash, mut group) in by_hash {
            if group.len() < 2 {
                continue;
            }
            group.sort_by(|a, b| {
                let ta = std::fs::metadata(a)
                    .and_then(|m| m.modified())
                    .ok();
                let tb = std::fs::metadata(b)
                    .and_then(|m| m.modified())
                    .ok();
                match (ta, tb) {
                    (Some(x), Some(y)) => x.cmp(&y),
                    _ => a.cmp(b),
                }
            });
            let group_id = format!("dupe:{}", &hash[..16.min(hash.len())]);
            for (idx, path) in group.into_iter().enumerate() {
                let path_str = path.to_string_lossy().to_string();
                let is_keeper = idx == 0;
                items.push(ScanItem {
                    id: item_id(&path_str),
                    category_label: Category::DuplicateFiles.label().to_string(),
                    category: Category::DuplicateFiles,
                    path: path_str,
                    bytes: size,
                    risk: Risk::Caution,
                    selected_by_default: !is_keeper,
                    special: None,
                    group_id: Some(group_id.clone()),
                    is_keeper: Some(is_keeper),
                });
            }
        }
    }

    items
}

/// Files not modified for `stale_days` under root (and optional Downloads).
pub fn scan_stale_files(
    root: &Path,
    stale_days: u64,
    max_depth: usize,
    min_bytes: u64,
    on_progress: &mut dyn FnMut(&str) -> bool,
) -> Vec<ScanItem> {
    use std::time::{Duration, SystemTime};

    let mut items = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    if !root.is_dir() {
        return items;
    }

    let min_age = Duration::from_secs(stale_days.saturating_mul(24 * 60 * 60));
    let now = SystemTime::now();
    let floor = min_bytes.max(1);

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
            if e.file_type().is_dir() && should_skip_file_scan_dir(&name) {
                return false;
            }
            true
        });

    for entry in walker.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !on_progress(&path.to_string_lossy()) {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.len() < floor {
            continue;
        }
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
        if !seen.insert(key.clone()) {
            continue;
        }
        items.push(ScanItem {
            id: item_id(&key),
            category_label: Category::StaleFiles.label().to_string(),
            category: Category::StaleFiles,
            path: key,
            bytes: meta.len(),
            risk: Risk::Caution,
            selected_by_default: false,
            special: None,
            group_id: None,
            is_keeper: None,
        });
    }

    items
}

fn is_installer_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".msi")
        || lower.ends_with(".iso")
        || lower.ends_with(".img")
        || lower.ends_with(".dmg")
    {
        return true;
    }
    if lower.ends_with(".exe") {
        return lower.contains("setup")
            || lower.contains("install")
            || lower.contains("installer")
            || lower.starts_with("setup")
            || lower.contains("-setup")
            || lower.contains("_setup");
    }
    false
}

fn is_android_sdk_residue(path: &Path) -> bool {
    let s = path.to_string_lossy().to_ascii_lowercase();
    s.contains("android")
        && (s.contains("system-images")
            || s.contains("\\ndk\\")
            || s.contains("/ndk/")
            || s.contains("\\ndk-bundle")
            || s.contains("emulator"))
}

/// Installer packages, disk images, and common Android SDK bulky leftovers.
pub fn scan_installers(
    root: &Path,
    max_depth: usize,
    min_bytes: u64,
    on_progress: &mut dyn FnMut(&str) -> bool,
) -> Vec<ScanItem> {
    let mut items = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let floor = min_bytes.max(1);

    if !root.is_dir() {
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
            if e.file_type().is_dir() && should_skip_file_scan_dir(&name) {
                return false;
            }
            true
        });

    for entry in walker.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !on_progress(&path.to_string_lossy()) {
            break;
        }
        if entry.file_type().is_dir() {
            let name = entry.file_name().to_string_lossy();
            if matches!(name.as_ref(), "system-images" | "ndk" | "ndk-bundle")
                && is_android_sdk_residue(path)
            {
                let key = path.to_string_lossy().to_string();
                if seen.insert(key) {
                    let bytes = dir_size_bytes(path);
                    if bytes >= floor {
                        items.push(make_item(
                            path.to_path_buf(),
                            Category::Installers,
                            Risk::Caution,
                            false,
                        ));
                    }
                }
            }
            continue;
        }

        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy();
        if !is_installer_name(&name) {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.len() < floor {
            continue;
        }
        let key = path.to_string_lossy().to_string();
        if !seen.insert(key.clone()) {
            continue;
        }
        items.push(ScanItem {
            id: item_id(&key),
            category_label: Category::Installers.label().to_string(),
            category: Category::Installers,
            path: key,
            bytes: meta.len(),
            risk: Risk::Caution,
            selected_by_default: false,
            special: None,
            group_id: None,
            is_keeper: None,
        });
    }

    items
}

pub fn downloads_dir() -> Option<PathBuf> {
    dirs::download_dir()
}

pub fn scan_fixed_paths(
    fixed: &[FixedPath],
    enabled: &HashSet<Category>,
    on_progress: &mut dyn FnMut(&str) -> bool,
) -> Vec<ScanItem> {
    let mut items = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    for fp in fixed {
        if !enabled.contains(&fp.category) {
            continue;
        }
        if !on_progress(&fp.path.to_string_lossy()) {
            break;
        }
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

/// Discover large AppData / dot-folders not covered by fixed rules (>= 500 MB).
const DISCOVERED_MIN_BYTES: u64 = 500 * 1024 * 1024;

pub fn scan_discovered_large_dirs(
    enabled: &HashSet<Category>,
    on_progress: &mut dyn FnMut(&str) -> bool,
) -> Vec<ScanItem> {
    if !enabled.contains(&Category::AppCache) {
        return Vec::new();
    }

    let mut items = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    let mut roots: Vec<(PathBuf, &'static str)> = Vec::new();
    if let Some(local) = dirs::data_local_dir() {
        roots.push((local, "AppData\\Local"));
    }
    if let Some(roaming) = dirs::config_dir() {
        roots.push((roaming, "AppData\\Roaming"));
    }

    for (root, _label) in roots {
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if !on_progress(&path.to_string_lossy()) {
                return items;
            }
            let bytes = dir_size_bytes(&path);
            if bytes < DISCOVERED_MIN_BYTES {
                continue;
            }
            let canonical = path
                .canonicalize()
                .unwrap_or(path)
                .to_string_lossy()
                .to_string();
            if !seen.insert(canonical.clone()) {
                continue;
            }
            items.push(ScanItem {
                id: item_id(&canonical),
                category_label: Category::AppCache.label().to_string(),
                category: Category::AppCache,
                path: canonical,
                bytes,
                risk: Risk::Caution,
                selected_by_default: false,
                special: None,
                group_id: Some("discovered_app_data".into()),
                is_keeper: None,
            });
        }
    }

    if let Some(home) = dirs::home_dir() {
        let Ok(entries) = std::fs::read_dir(&home) else {
            return items;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with('.') {
                continue;
            }
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if !on_progress(&path.to_string_lossy()) {
                return items;
            }
            let bytes = dir_size_bytes(&path);
            if bytes < DISCOVERED_MIN_BYTES {
                continue;
            }
            let canonical = path
                .canonicalize()
                .unwrap_or(path)
                .to_string_lossy()
                .to_string();
            if !seen.insert(canonical.clone()) {
                continue;
            }
            items.push(ScanItem {
                id: item_id(&canonical),
                category_label: Category::AppCache.label().to_string(),
                category: Category::AppCache,
                path: canonical,
                bytes,
                risk: Risk::Caution,
                selected_by_default: false,
                special: None,
                group_id: Some("discovered_dot_dir".into()),
                is_keeper: None,
            });
        }
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
