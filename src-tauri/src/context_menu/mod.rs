use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use winreg::enums::*;
use winreg::RegKey;

use crate::config;

pub(crate) mod icon;

const CLASSES_PREFIX: &str = r"Software\Classes";
const DISABLED_EXT: &str = ".pcoff";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextMenuHive {
    Hkcu,
    Hklm,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum ContextMenuLocation {
    FileShellex,
    DirectoryShellex,
    BackgroundShellex,
    DriveShellex,
    AllFsShellex,
    FileShell,
    DirectoryShell,
    BackgroundShell,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextMenuKind {
    Shellex,
    Shell,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Copy)]
#[serde(rename_all = "snake_case")]
pub enum ContextMenuImpact {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuItem {
    pub id: String,
    pub name: String,
    pub handler: String,
    pub location: ContextMenuLocation,
    pub hive: ContextMenuHive,
    pub kind: ContextMenuKind,
    pub enabled: bool,
    pub publisher_hint: Option<String>,
    pub impact: ContextMenuImpact,
    pub suggest_disable: bool,
    /// PNG data URL from handler / CLSID icon, if available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_data_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DisabledEntry {
    hive: ContextMenuHive,
    location: ContextMenuLocation,
    kind: ContextMenuKind,
    name: String,
    handler: String,
}

struct ScanTarget {
    rel_path: &'static str,
    location: ContextMenuLocation,
    kind: ContextMenuKind,
}

const SCAN_TARGETS: &[ScanTarget] = &[
    ScanTarget {
        rel_path: r"*\shellex\ContextMenuHandlers",
        location: ContextMenuLocation::FileShellex,
        kind: ContextMenuKind::Shellex,
    },
    ScanTarget {
        rel_path: r"Directory\shellex\ContextMenuHandlers",
        location: ContextMenuLocation::DirectoryShellex,
        kind: ContextMenuKind::Shellex,
    },
    ScanTarget {
        rel_path: r"Directory\Background\shellex\ContextMenuHandlers",
        location: ContextMenuLocation::BackgroundShellex,
        kind: ContextMenuKind::Shellex,
    },
    ScanTarget {
        rel_path: r"Drive\shellex\ContextMenuHandlers",
        location: ContextMenuLocation::DriveShellex,
        kind: ContextMenuKind::Shellex,
    },
    ScanTarget {
        rel_path: r"AllFilesystemObjects\shellex\ContextMenuHandlers",
        location: ContextMenuLocation::AllFsShellex,
        kind: ContextMenuKind::Shellex,
    },
    ScanTarget {
        rel_path: r"*\shell",
        location: ContextMenuLocation::FileShell,
        kind: ContextMenuKind::Shell,
    },
    ScanTarget {
        rel_path: r"Directory\shell",
        location: ContextMenuLocation::DirectoryShell,
        kind: ContextMenuKind::Shell,
    },
    ScanTarget {
        rel_path: r"Directory\Background\shell",
        location: ContextMenuLocation::BackgroundShell,
        kind: ContextMenuKind::Shell,
    },
];

const SYSTEM_SHELL_SKIP: &[&str] = &[
    "open",
    "edit",
    "print",
    "find",
    "properties",
    "cut",
    "copy",
    "paste",
    "delete",
    "rename",
    "opennewwindow",
    "opennewprocess",
    "explore",
    "cmd",
    "none",
    "runas",
    "pintohome",
    "pintohomegraph",
    "link",
    "removeproperties",
    "updatevew",
    "createlibrary",
    "manage",
    "share",
    "encrypt",
    "decrypt",
    "restore",
    "previousversions",
    "offlinefiles",
];

fn disabled_path() -> Result<PathBuf, String> {
    Ok(config::config_dir()?.join("context-menu-disabled.json"))
}

fn load_disabled() -> Vec<DisabledEntry> {
    let path = match disabled_path() {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn save_disabled(entries: &[DisabledEntry]) -> Result<(), String> {
    let path = disabled_path()?;
    let text = serde_json::to_string_pretty(entries)
        .map_err(|e| format!("序列化右键菜单备份失败: {e}"))?;
    fs::write(&path, text).map_err(|e| format!("写入右键菜单备份失败: {e}"))
}

fn make_id(
    hive: &ContextMenuHive,
    location: &ContextMenuLocation,
    kind: &ContextMenuKind,
    name: &str,
) -> String {
    let h = match hive {
        ContextMenuHive::Hkcu => "hkcu",
        ContextMenuHive::Hklm => "hklm",
    };
    let loc = match location {
        ContextMenuLocation::FileShellex => "file_shellex",
        ContextMenuLocation::DirectoryShellex => "dir_shellex",
        ContextMenuLocation::BackgroundShellex => "bg_shellex",
        ContextMenuLocation::DriveShellex => "drive_shellex",
        ContextMenuLocation::AllFsShellex => "allfs_shellex",
        ContextMenuLocation::FileShell => "file_shell",
        ContextMenuLocation::DirectoryShell => "dir_shell",
        ContextMenuLocation::BackgroundShell => "bg_shell",
    };
    let k = match kind {
        ContextMenuKind::Shellex => "shellex",
        ContextMenuKind::Shell => "shell",
    };
    format!("{h}|{loc}|{k}|{name}")
}

pub fn parse_id(id: &str) -> Result<(ContextMenuHive, ContextMenuLocation, ContextMenuKind, String), String> {
    let mut parts = id.splitn(4, '|');
    let hive_s = parts.next().ok_or("无效的右键菜单 id")?;
    let loc_s = parts.next().ok_or("无效的右键菜单 id")?;
    let kind_s = parts.next().ok_or("无效的右键菜单 id")?;
    let name = parts
        .next()
        .ok_or("无效的右键菜单 id")?
        .to_string();
    if name.is_empty() {
        return Err("右键菜单名称为空".into());
    }

    let hive = match hive_s {
        "hkcu" => ContextMenuHive::Hkcu,
        "hklm" => ContextMenuHive::Hklm,
        _ => return Err("未知的注册表来源".into()),
    };
    let location = match loc_s {
        "file_shellex" => ContextMenuLocation::FileShellex,
        "dir_shellex" => ContextMenuLocation::DirectoryShellex,
        "bg_shellex" => ContextMenuLocation::BackgroundShellex,
        "drive_shellex" => ContextMenuLocation::DriveShellex,
        "allfs_shellex" => ContextMenuLocation::AllFsShellex,
        "file_shell" => ContextMenuLocation::FileShell,
        "dir_shell" => ContextMenuLocation::DirectoryShell,
        "bg_shell" => ContextMenuLocation::BackgroundShell,
        _ => return Err("未知的右键菜单位置".into()),
    };
    let kind = match kind_s {
        "shellex" => ContextMenuKind::Shellex,
        "shell" => ContextMenuKind::Shell,
        _ => return Err("未知的右键菜单类型".into()),
    };
    Ok((hive, location, kind, name))
}

fn rel_path_for(location: &ContextMenuLocation, kind: &ContextMenuKind) -> Option<&'static str> {
    SCAN_TARGETS
        .iter()
        .find(|t| t.location == *location && t.kind == *kind)
        .map(|t| t.rel_path)
}

fn open_classes_subkey(hive: &ContextMenuHive, rel: &str, write: bool) -> Result<RegKey, String> {
    let hive_id = match hive {
        ContextMenuHive::Hkcu => HKEY_CURRENT_USER,
        ContextMenuHive::Hklm => HKEY_LOCAL_MACHINE,
    };
    let root = RegKey::predef(hive_id);
    let full = format!("{CLASSES_PREFIX}\\{rel}");
    let access = if write { KEY_READ | KEY_WRITE } else { KEY_READ };
    root.open_subkey_with_flags(&full, access)
        .map_err(|e| match hive {
            ContextMenuHive::Hklm if write => {
                format!("无法写入本机右键菜单项（可能需要管理员权限）: {e}")
            }
            _ => format!("打开注册表「{full}」失败: {e}"),
        })
}

fn score_impact(
    name: &str,
    handler: &str,
) -> (ContextMenuImpact, bool, Option<String>) {
    let hay = format!("{name} {handler}").to_ascii_lowercase();

    const KEEP: &[(&str, &str)] = &[
        ("windows defender", "Windows 安全"),
        ("defender", "Windows 安全"),
        ("antivirus", "安全软件"),
        ("360", "360 安全"),
        ("kaspersky", "卡巴斯基"),
        ("bitdefender", "Bitdefender"),
        ("sentinel", "SentinelOne"),
        ("crowdstrike", "CrowdStrike"),
        ("msse", "Microsoft 安全"),
        ("sharing", "系统共享"),
        ("sendto", "发送到"),
        ("compressed (zipped)", "系统压缩"),
        ("pin to start", "固定到开始"),
        ("pin to taskbar", "固定到任务栏"),
        ("previous versions", "先前版本"),
        ("bitlocker", "BitLocker"),
        ("windows.perception", "Windows 系统"),
        ("cascade", "系统菜单"),
    ];

    for (needle, hint) in KEEP {
        if hay.contains(needle) {
            return (ContextMenuImpact::Low, false, Some(hint.to_string()));
        }
    }

    const SUGGEST: &[(&str, &str, ContextMenuImpact)] = &[
        ("winrar", "WinRAR", ContextMenuImpact::Medium),
        ("7-zip", "7-Zip", ContextMenuImpact::Medium),
        ("bandizip", "Bandizip", ContextMenuImpact::Medium),
        ("tortoisegit", "TortoiseGit", ContextMenuImpact::High),
        ("tortoisesvn", "TortoiseSVN", ContextMenuImpact::High),
        ("tortoisehg", "TortoiseHg", ContextMenuImpact::High),
        ("git", "Git 扩展", ContextMenuImpact::Medium),
        ("nvidia", "NVIDIA", ContextMenuImpact::Medium),
        ("amd", "AMD", ContextMenuImpact::Medium),
        ("intel", "Intel 显卡", ContextMenuImpact::Medium),
        ("dropbox", "Dropbox", ContextMenuImpact::Medium),
        ("googledrive", "Google Drive", ContextMenuImpact::Medium),
        ("google drive", "Google Drive", ContextMenuImpact::Medium),
        ("baidu", "百度网盘", ContextMenuImpact::Medium),
        ("aliyun", "阿里云盘", ContextMenuImpact::Medium),
        ("quark", "夸克网盘", ContextMenuImpact::Medium),
        ("update", "更新程序", ContextMenuImpact::High),
        ("updater", "更新程序", ContextMenuImpact::High),
        ("adobe", "Adobe", ContextMenuImpact::Medium),
        ("notepad++", "Notepad++", ContextMenuImpact::Low),
        ("vscode", "VS Code", ContextMenuImpact::Low),
        ("cursor", "Cursor", ContextMenuImpact::Low),
    ];

    for (needle, hint, impact) in SUGGEST {
        if hay.contains(needle) {
            return (*impact, true, Some(hint.to_string()));
        }
    }

    if handler.contains("CLSID") || handler.starts_with('{') {
        return (ContextMenuImpact::Medium, true, Some("Shell 扩展".into()));
    }

    if handler.contains(".exe") || handler.contains(":\\") {
        return (ContextMenuImpact::Medium, true, None);
    }

    (ContextMenuImpact::Low, false, None)
}

fn build_item(
    hive: ContextMenuHive,
    location: ContextMenuLocation,
    kind: ContextMenuKind,
    registry_key: String,
    name: String,
    handler: String,
    enabled: bool,
    icon_hint: Option<&str>,
) -> ContextMenuItem {
    let (impact, suggest_disable, publisher_hint) = score_impact(&name, &handler);
    let icon_data_url = icon::icon_data_url_for_item(&kind, &handler, icon_hint);
    ContextMenuItem {
        id: make_id(&hive, &location, &kind, &registry_key),
        name,
        handler,
        location,
        hive,
        kind,
        enabled,
        publisher_hint,
        impact,
        suggest_disable,
        icon_data_url,
    }
}

fn shell_display_name(sub: &RegKey, key_name: &str) -> String {
    if let Ok(s) = sub.get_value::<String, _>("") {
        let trimmed = s.trim();
        if !trimmed.is_empty() && !trimmed.starts_with('@') {
            return trimmed.to_string();
        }
    }
    if let Ok(s) = sub.get_value::<String, _>("MUIVerb") {
        let trimmed = s.trim().trim_start_matches('@');
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    key_name.to_string()
}

fn shell_command(sub: &RegKey) -> Option<String> {
    let cmd_key = sub.open_subkey("command").ok()?;
    cmd_key.get_value("").ok()
}

fn is_system_shell(key_name: &str, sub: &RegKey) -> bool {
    let lower = key_name.to_ascii_lowercase();
    if SYSTEM_SHELL_SKIP.iter().any(|s| lower == *s) {
        return true;
    }
    if lower.starts_with("windows.") {
        return true;
    }
    if sub
        .get_value::<u32, _>("ProgrammaticAccessOnly")
        .map(|v| v != 0)
        .unwrap_or(false)
    {
        return true;
    }
    if sub
        .get_value::<u32, _>("LegacyDisable")
        .map(|v| v != 0)
        .unwrap_or(false)
    {
        return true;
    }
    false
}

fn strip_disabled_ext(name: &str) -> (String, bool) {
    let lower = name.to_ascii_lowercase();
    if let Some(base) = lower.strip_suffix(DISABLED_EXT) {
        let stem = &name[..base.len()];
        (stem.to_string(), false)
    } else {
        (name.to_string(), true)
    }
}

fn list_shellex(hive: ContextMenuHive, target: &ScanTarget, items: &mut Vec<ContextMenuItem>) {
    let Ok(key) = open_classes_subkey(&hive, target.rel_path, false) else {
        return;
    };
    for sub_name in key.enum_keys().filter_map(|r| r.ok()) {
        let Ok(sub) = key.open_subkey(&sub_name) else {
            continue;
        };
        let clsid: String = sub.get_value("").unwrap_or_default();
        if clsid.is_empty() {
            continue;
        }
        let icon_hint = sub
            .get_value::<String, _>("Icon")
            .ok()
            .filter(|s| !s.trim().is_empty());
        let display_name = icon::shellex_display_name(&sub_name, &clsid);
        items.push(build_item(
            hive.clone(),
            target.location.clone(),
            target.kind.clone(),
            sub_name.clone(),
            display_name,
            clsid,
            true,
            icon_hint.as_deref(),
        ));
    }
}

fn list_shell(hive: ContextMenuHive, target: &ScanTarget, items: &mut Vec<ContextMenuItem>) {
    let Ok(key) = open_classes_subkey(&hive, target.rel_path, false) else {
        return;
    };
    for sub_name in key.enum_keys().filter_map(|r| r.ok()) {
        let (registry_key, enabled) = strip_disabled_ext(&sub_name);
        let Ok(sub) = key.open_subkey(&sub_name) else {
            continue;
        };
        if enabled && is_system_shell(&registry_key, &sub) {
            continue;
        }
        let handler = shell_command(&sub).unwrap_or_else(|| {
            sub.get_value("")
                .unwrap_or_else(|_| registry_key.clone())
        });
        let label = shell_display_name(&sub, &registry_key);
        let icon_hint = sub
            .get_value::<String, _>("Icon")
            .ok()
            .filter(|s| !s.trim().is_empty());
        items.push(build_item(
            hive.clone(),
            target.location.clone(),
            target.kind.clone(),
            registry_key,
            label,
            handler,
            enabled,
            icon_hint.as_deref(),
        ));
    }
}

fn list_disabled_backup(items: &mut Vec<ContextMenuItem>) {
    for entry in load_disabled() {
        if items.iter().any(|i| i.id == make_id(&entry.hive, &entry.location, &entry.kind, &entry.name))
        {
            continue;
        }
        items.push(build_item(
            entry.hive,
            entry.location,
            entry.kind,
            entry.name.clone(),
            entry.name,
            entry.handler,
            false,
            None,
        ));
    }
}

pub fn list_context_menu_items() -> Vec<ContextMenuItem> {
    let mut items = Vec::new();
    for hive in [ContextMenuHive::Hkcu, ContextMenuHive::Hklm] {
        for target in SCAN_TARGETS {
            match target.kind {
                ContextMenuKind::Shellex => list_shellex(hive.clone(), target, &mut items),
                ContextMenuKind::Shell => list_shell(hive.clone(), target, &mut items),
            }
        }
    }
    list_disabled_backup(&mut items);
    items.sort_by(|a, b| {
        a.hive
            .cmp_hive()
            .cmp(&b.hive.cmp_hive())
            .then_with(|| a.location.cmp(&b.location))
            .then_with(|| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()))
    });
    items
}

impl ContextMenuHive {
    fn cmp_hive(&self) -> u8 {
        match self {
            ContextMenuHive::Hkcu => 0,
            ContextMenuHive::Hklm => 1,
        }
    }
}

fn disable_shellex(
    hive: ContextMenuHive,
    location: ContextMenuLocation,
    name: &str,
) -> Result<(), String> {
    let rel = rel_path_for(&location, &ContextMenuKind::Shellex)
        .ok_or_else(|| "未知的 Shell 扩展位置".to_string())?;
    let key = open_classes_subkey(&hive, rel, true)?;
    let sub = key
        .open_subkey(name)
        .map_err(|e| format!("读取右键菜单扩展「{name}」失败: {e}"))?;
    let handler: String = sub.get_value("").unwrap_or_default();

    let mut disabled = load_disabled();
    disabled.retain(|e| {
        !(e.hive == hive
            && e.location == location
            && e.kind == ContextMenuKind::Shellex
            && e.name.eq_ignore_ascii_case(name))
    });
    disabled.push(DisabledEntry {
        hive: hive.clone(),
        location,
        kind: ContextMenuKind::Shellex,
        name: name.to_string(),
        handler,
    });
    save_disabled(&disabled)?;

    key.delete_subkey_all(name)
        .map_err(|e| format!("禁用右键菜单扩展「{name}」失败: {e}"))?;
    Ok(())
}

fn enable_shellex(
    hive: ContextMenuHive,
    location: ContextMenuLocation,
    name: &str,
) -> Result<(), String> {
    let mut disabled = load_disabled();
    let idx = disabled
        .iter()
        .position(|e| {
            e.hive == hive
                && e.location == location
                && e.kind == ContextMenuKind::Shellex
                && e.name.eq_ignore_ascii_case(name)
        })
        .ok_or_else(|| format!("找不到已禁用的 Shell 扩展备份「{name}」"))?;
    let entry = disabled.remove(idx);

    let rel = rel_path_for(&entry.location, &ContextMenuKind::Shellex)
        .ok_or_else(|| "未知的 Shell 扩展位置".to_string())?;
    let key = open_classes_subkey(&entry.hive, rel, true)?;
    let (sub, _) = key
        .create_subkey(&entry.name)
        .map_err(|e| format!("恢复右键菜单扩展「{name}」失败: {e}"))?;
    sub.set_value("", &entry.handler)
        .map_err(|e| format!("写入 Shell 扩展 CLSID 失败: {e}"))?;
    save_disabled(&disabled)?;
    Ok(())
}

fn disable_shell(
    hive: ContextMenuHive,
    location: ContextMenuLocation,
    name: &str,
) -> Result<(), String> {
    let rel = rel_path_for(&location, &ContextMenuKind::Shell)
        .ok_or_else(|| "未知的 Shell 动词位置".to_string())?;
    let key = open_classes_subkey(&hive, rel, true)?;
    let active = name.to_string();
    let disabled_name = format!("{name}{DISABLED_EXT}");

    if key.open_subkey(&active).is_err() {
        if key.open_subkey(&disabled_name).is_ok() {
            return Ok(());
        }
        return Err(format!("找不到右键菜单项「{name}」"));
    }

    key.rename_subkey(&active, &disabled_name)
        .map_err(|e| format!("禁用右键菜单项「{name}」失败: {e}"))?;
    Ok(())
}

fn enable_shell(
    hive: ContextMenuHive,
    location: ContextMenuLocation,
    name: &str,
) -> Result<(), String> {
    let rel = rel_path_for(&location, &ContextMenuKind::Shell)
        .ok_or_else(|| "未知的 Shell 动词位置".to_string())?;
    let key = open_classes_subkey(&hive, rel, true)?;
    let active = name.to_string();
    let disabled_name = format!("{name}{DISABLED_EXT}");

    if key.open_subkey(&active).is_ok() {
        return Ok(());
    }
    key.rename_subkey(&disabled_name, &active)
        .map_err(|e| format!("启用右键菜单项「{name}」失败: {e}"))?;
    Ok(())
}

pub fn set_context_menu_enabled(id: &str, enabled: bool) -> Result<ContextMenuItem, String> {
    let (hive, location, kind, name) = parse_id(id)?;
    match kind {
        ContextMenuKind::Shellex => {
            if enabled {
                enable_shellex(hive, location, &name)?;
            } else {
                disable_shellex(hive, location, &name)?;
            }
        }
        ContextMenuKind::Shell => {
            if enabled {
                enable_shell(hive, location, &name)?;
            } else {
                disable_shell(hive, location, &name)?;
            }
        }
    }

    list_context_menu_items()
        .into_iter()
        .find(|i| i.id == id)
        .ok_or_else(|| "操作成功但无法重新读取该项".to_string())
}

pub fn disable_suggested() -> (Vec<ContextMenuItem>, Vec<ContextMenuItem>, Vec<(String, String)>) {
    let mut disabled = Vec::new();
    let mut skipped = Vec::new();
    let mut failed = Vec::new();

    for item in list_context_menu_items() {
        if !item.enabled {
            continue;
        }
        if !item.suggest_disable {
            skipped.push(item);
            continue;
        }
        match set_context_menu_enabled(&item.id, false) {
            Ok(updated) => disabled.push(updated),
            Err(e) => failed.push((item.name, e)),
        }
    }

    (disabled, skipped, failed)
}
