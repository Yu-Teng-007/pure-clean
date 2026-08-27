use std::collections::HashSet;
use std::path::PathBuf;

use crate::model::{Category, Risk, ScanItem};
use crate::scan::rules::{item_id, make_special_item, scan_fixed_paths, FixedPath};
use crate::scan::size::dir_size_bytes;

const LEFTOVER_MIN_BYTES: u64 = 50 * 1024 * 1024;

fn push_path(
    paths: &mut Vec<FixedPath>,
    path: PathBuf,
    category: Category,
    risk: Risk,
    selected: bool,
) {
    if !path.exists() {
        return;
    }
    paths.push(FixedPath {
        path,
        category,
        risk,
        selected_by_default: selected,
    });
}

fn make_hint_item(
    path: PathBuf,
    category: Category,
    risk: Risk,
    hint: &str,
    special: Option<&str>,
) -> ScanItem {
    let path_str = path.to_string_lossy().to_string();
    let bytes = if path.is_file() {
        std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
    } else if path.exists() {
        dir_size_bytes(&path)
    } else {
        0
    };
    ScanItem {
        id: item_id(&path_str),
        category_label: category.label().to_string(),
        category,
        path: path_str,
        bytes,
        risk,
        selected_by_default: false,
        special: special.map(String::from),
        group_id: None,
        is_keeper: None,
        hint: Some(hint.into()),
    }
}

/// Browser cookies / history / extension data — privacy-sensitive, default off.
pub fn fixed_browser_privacy_paths() -> Vec<FixedPath> {
    let mut paths = Vec::new();
    let Some(local) = dirs::data_local_dir() else {
        return paths;
    };

    let chromium_roots = [
        local.join("Google").join("Chrome").join("User Data"),
        local.join("Microsoft").join("Edge").join("User Data"),
        local.join("BraveSoftware").join("Brave-Browser").join("User Data"),
        local.join("Tencent").join("QQBrowser").join("User Data"),
    ];

    for root in chromium_roots {
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let profile = entry.path();
            if !profile.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let is_profile = name == "Default"
                || name.starts_with("Profile ")
                || name == "Guest Profile";
            if !is_profile {
                continue;
            }
            push_path(
                &mut paths,
                profile.join("Cookies"),
                Category::BrowserPrivacy,
                Risk::Dangerous,
                false,
            );
            push_path(
                &mut paths,
                profile.join("History"),
                Category::BrowserPrivacy,
                Risk::Dangerous,
                false,
            );
            push_path(
                &mut paths,
                profile.join("Login Data"),
                Category::BrowserPrivacy,
                Risk::Dangerous,
                false,
            );
            push_path(
                &mut paths,
                profile.join("Web Data"),
                Category::BrowserPrivacy,
                Risk::Caution,
                false,
            );
            push_path(
                &mut paths,
                profile.join("Local Storage"),
                Category::BrowserPrivacy,
                Risk::Caution,
                false,
            );
            push_path(
                &mut paths,
                profile.join("Session Storage"),
                Category::BrowserPrivacy,
                Risk::Caution,
                false,
            );
            push_path(
                &mut paths,
                profile.join("Extension Cookies"),
                Category::BrowserPrivacy,
                Risk::Caution,
                false,
            );
        }
    }

    let firefox_profiles = local.join("Mozilla").join("Firefox").join("Profiles");
    if let Ok(entries) = std::fs::read_dir(&firefox_profiles) {
        for entry in entries.flatten() {
            let profile = entry.path();
            if !profile.is_dir() {
                continue;
            }
            for file in ["cookies.sqlite", "places.sqlite", "formhistory.sqlite"] {
                push_path(
                    &mut paths,
                    profile.join(file),
                    Category::BrowserPrivacy,
                    Risk::Dangerous,
                    false,
                );
            }
        }
    }

    paths
}

/// Download accelerators / game launcher caches.
pub fn fixed_download_tool_paths() -> Vec<FixedPath> {
    let mut paths = Vec::new();

    if let Some(local) = dirs::data_local_dir() {
        for p in [
            local.join("Motrix").join("download"),
            local.join("qBittorrent").join("BT_backup"),
            local.join("EpicGamesLauncher").join("Saved").join("webcache"),
            local.join("WeGame").join("log"),
            local.join("WeGame").join("crash_log"),
        ] {
            push_path(
                &mut paths,
                p,
                Category::DownloadTools,
                Risk::Caution,
                false,
            );
        }
    }

    if let Some(roaming) = dirs::config_dir() {
        for p in [
            roaming.join("IDM").join("DwnlData"),
            roaming.join("IDM").join("Temp"),
            roaming.join("Thunder Network").join("Thunder").join("Cache"),
            roaming.join("baidu").join("BaiduNetdisk"),
            roaming.join("baidu").join("BaiduYunGuanjia"),
            roaming.join("Netease").join("CloudMusic").join("Cache"),
        ] {
            push_path(
                &mut paths,
                p,
                Category::DownloadTools,
                Risk::Caution,
                false,
            );
        }
    }

    paths
}

fn normalize_token(s: &str) -> String {
    s.to_ascii_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

#[cfg(windows)]
fn collect_installed_app_tokens() -> HashSet<String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let mut tokens = HashSet::new();
    let roots = [
        (
            RegKey::predef(HKEY_LOCAL_MACHINE),
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            RegKey::predef(HKEY_LOCAL_MACHINE),
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
        (
            RegKey::predef(HKEY_CURRENT_USER),
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        ),
    ];

    for (hive, sub) in roots {
        let Ok(key) = hive.open_subkey(sub) else {
            continue;
        };
        for name in key.enum_keys().filter_map(|k| k.ok()) {
            let Ok(sub) = key.open_subkey(&name) else {
                continue;
            };
            for val_name in ["DisplayName", "Publisher"] {
                if let Ok(display) = sub.get_value::<String, _>(val_name) {
                    let t = normalize_token(&display);
                    if t.len() >= 3 {
                        tokens.insert(t);
                    }
                }
            }
        }
    }

    tokens
}

#[cfg(not(windows))]
fn collect_installed_app_tokens() -> HashSet<String> {
    HashSet::new()
}

fn folder_likely_installed(folder_name: &str, installed: &HashSet<String>) -> bool {
    let token = normalize_token(folder_name);
    if token.len() < 3 {
        return true;
    }
    if installed.contains(&token) {
        return true;
    }
    for app in installed {
        if app.contains(&token) || token.contains(app) {
            return true;
        }
    }
    false
}

/// AppData folders that may be uninstall leftovers (heuristic, ≥50MB).
pub fn scan_uninstall_leftovers(
    on_progress: &mut dyn FnMut(&str) -> bool,
) -> Vec<ScanItem> {
    let installed = collect_installed_app_tokens();
    let mut items = Vec::new();
    let mut seen = HashSet::new();

    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(local) = dirs::data_local_dir() {
        roots.push(local);
    }
    if let Some(roaming) = dirs::config_dir() {
        roots.push(roaming);
    }

    for root in roots {
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || name.eq_ignore_ascii_case("Microsoft") {
                continue;
            }
            if !on_progress(&path.to_string_lossy()) {
                return items;
            }
            if folder_likely_installed(&name, &installed) {
                continue;
            }
            let bytes = dir_size_bytes(&path);
            if bytes < LEFTOVER_MIN_BYTES {
                continue;
            }
            let path_str = path.to_string_lossy().to_string();
            if !seen.insert(path_str.clone()) {
                continue;
            }
            items.push(ScanItem {
                id: item_id(&path_str),
                category_label: Category::UninstallLeftovers.label().to_string(),
                category: Category::UninstallLeftovers,
                path: path_str,
                bytes,
                risk: Risk::Caution,
                selected_by_default: false,
                special: None,
                group_id: None,
                is_keeper: None,
                hint: Some(
                    "未在已安装程序列表中找到匹配项，可能是卸载残留；删除前请确认".into(),
                ),
            });
        }
    }

    items
}

/// WinSxS / hiberfil / pagefile — detect only, do not delete in-app.
pub fn scan_system_advisory(on_progress: &mut dyn FnMut(&str) -> bool) -> Vec<ScanItem> {
    let mut items = Vec::new();

    let winsxs = PathBuf::from(r"C:\Windows\WinSxS");
    if winsxs.is_dir() {
        let _ = on_progress(&winsxs.to_string_lossy());
        items.push(make_hint_item(
            winsxs,
            Category::SystemAdvisory,
            Risk::Dangerous,
            "组件存储目录，勿手动删除。可使用「磁盘清理 → 清理系统文件」或 DISM 组件清理",
            Some("advisory_only"),
        ));
        items.push(make_special_item(
            "winsxs_cleanup_guide",
            "WinSxS 组件清理（打开磁盘清理）",
            Category::SystemAdvisory,
            Risk::Safe,
            false,
            "open_disk_cleanup",
            0,
        ));
        if let Some(last) = items.last_mut() {
            last.hint = Some(
                "不会自动删除 WinSxS；点击清理时将打开 Windows 磁盘清理工具".into(),
            );
        }
    }

    for letter in b'C'..=b'Z' {
        let drive = format!("{}:\\", letter as char);
        let root = PathBuf::from(&drive);
        if !root.is_dir() {
            continue;
        }
        for (file, hint) in [
            (
                "hiberfil.sys",
                "休眠文件；关闭休眠可释放（管理员）：powercfg -h off",
            ),
            (
                "pagefile.sys",
                "虚拟内存文件，系统运行必需，请勿删除；可在系统设置中调整大小",
            ),
        ] {
            let path = root.join(file);
            if path.is_file() {
                let _ = on_progress(&path.to_string_lossy());
                items.push(make_hint_item(
                    path,
                    Category::SystemAdvisory,
                    Risk::Dangerous,
                    hint,
                    Some("advisory_only"),
                ));
            }
        }
    }

    items
}

pub fn scan_browser_privacy(
    enabled: &HashSet<Category>,
    on_progress: &mut dyn FnMut(&str) -> bool,
) -> Vec<ScanItem> {
    let fixed = fixed_browser_privacy_paths();
    let mut items = scan_fixed_paths(&fixed, enabled, on_progress);
    for item in &mut items {
        if item.hint.is_none() {
            item.hint = Some(
                "含 Cookie / 历史 / 登录态等隐私数据，清理后需重新登录网站".into(),
            );
        }
    }
    items
}

pub fn scan_download_tools(
    enabled: &HashSet<Category>,
    on_progress: &mut dyn FnMut(&str) -> bool,
) -> Vec<ScanItem> {
    let fixed = fixed_download_tool_paths();
    let mut items = scan_fixed_paths(&fixed, enabled, on_progress);
    for item in &mut items {
        if item.hint.is_none() {
            item.hint = Some("下载器 / 游戏启动器缓存，清理后可能需要重新下载".into());
        }
    }
    items
}
