use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use winreg::enums::*;
use winreg::types::FromRegValue;
use winreg::RegKey;

use crate::config;

pub(crate) mod icon;

const RUN_SUBKEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const DISABLED_EXT: &str = ".pcoff";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StartupLocation {
    RegistryHkcu,
    RegistryHklm,
    FolderUser,
    FolderCommon,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StartupImpact {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupItem {
    pub id: String,
    pub name: String,
    pub command: String,
    pub location: StartupLocation,
    pub enabled: bool,
    pub publisher_hint: Option<String>,
    pub impact: StartupImpact,
    /// Smart optimize should disable this when enabled.
    pub suggest_disable: bool,
    /// PNG data URL from the app / shortcut icon, if available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_data_url: Option<String>,
}

fn build_item(
    location: StartupLocation,
    name: String,
    command: String,
    enabled: bool,
) -> StartupItem {
    let (impact, suggest_disable, publisher_hint) = score_impact(&name, &command);
    let icon_data_url = icon::icon_data_url_for_command(&command);
    StartupItem {
        id: make_id(&location, &name),
        name,
        command,
        location,
        enabled,
        publisher_hint,
        impact,
        suggest_disable,
        icon_data_url,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DisabledRegistryEntry {
    location: StartupLocation,
    name: String,
    command: String,
}

fn disabled_path() -> Result<PathBuf, String> {
    Ok(config::config_dir()?.join("startup-disabled.json"))
}

fn load_disabled() -> Vec<DisabledRegistryEntry> {
    let path = match disabled_path() {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

fn save_disabled(entries: &[DisabledRegistryEntry]) -> Result<(), String> {
    let path = disabled_path()?;
    let text =
        serde_json::to_string_pretty(entries).map_err(|e| format!("序列化开机项备份失败: {e}"))?;
    fs::write(&path, text).map_err(|e| format!("写入开机项备份失败: {e}"))
}

fn make_id(location: &StartupLocation, name: &str) -> String {
    let loc = match location {
        StartupLocation::RegistryHkcu => "hkcu",
        StartupLocation::RegistryHklm => "hklm",
        StartupLocation::FolderUser => "folder_user",
        StartupLocation::FolderCommon => "folder_common",
    };
    format!("{loc}|{name}")
}

pub fn parse_id(id: &str) -> Result<(StartupLocation, String), String> {
    let (loc, name) = id
        .split_once('|')
        .ok_or_else(|| "无效的开机项 id".to_string())?;
    let location = match loc {
        "hkcu" => StartupLocation::RegistryHkcu,
        "hklm" => StartupLocation::RegistryHklm,
        "folder_user" => StartupLocation::FolderUser,
        "folder_common" => StartupLocation::FolderCommon,
        _ => return Err("未知的开机项来源".into()),
    };
    if name.is_empty() {
        return Err("开机项名称为空".into());
    }
    Ok((location, name.to_string()))
}

fn score_impact(name: &str, command: &str) -> (StartupImpact, bool, Option<String>) {
    let hay = format!("{name} {command}").to_ascii_lowercase();

    // Conservative keep-list: system / security / common OEM trays.
    const KEEP: &[&str] = &[
        "securityhealth",
        "windows defender",
        "onedrive",
        "ctfmon",
        "igfxtray",
        "igfxpers",
        "nvidia",
        "nvcontainer",
        "amdradeon",
        "radeonsoftware",
        "realtimeprocess",
        "rthdcpl",
        "synaptics",
        "thinkpad",
        "lenovo",
        "dell",
        "hp system",
        "jusched",
        "adobegc",
        "steam",
        "discord",
        "spotify",
        "dropbox",
        "icloud",
        "google drive",
        "googledrivesync",
    ];

    for k in KEEP {
        if hay.contains(k) {
            let hint = match *k {
                "securityhealth" | "windows defender" => Some("Windows 安全".into()),
                "onedrive" => Some("Microsoft OneDrive".into()),
                s if s.contains("nvidia") || s.contains("nvcontainer") => Some("NVIDIA".into()),
                s if s.contains("amd") || s.contains("radeon") => Some("AMD".into()),
                "steam" => Some("Steam".into()),
                "discord" => Some("Discord".into()),
                _ => Some("系统/常用组件".into()),
            };
            // Steam/Discord etc. are keep for impact Low but still optional —
            // only true system bits get suggest_disable=false with Low.
            let systemish = matches!(
                *k,
                "securityhealth"
                    | "windows defender"
                    | "onedrive"
                    | "ctfmon"
                    | "igfxtray"
                    | "igfxpers"
                    | "nvidia"
                    | "nvcontainer"
                    | "amdradeon"
                    | "radeonsoftware"
                    | "realtimeprocess"
                    | "rthdcpl"
                    | "synaptics"
                    | "thinkpad"
                    | "lenovo"
                    | "dell"
                    | "hp system"
            );
            if systemish {
                return (StartupImpact::Low, false, hint);
            }
            // Known apps: medium impact, do not auto-suggest disable
            return (StartupImpact::Medium, false, hint);
        }
    }

    // Temp / updater / unknown third-party → suggest disable
    if hay.contains("update") || hay.contains("updater") || hay.contains("temp") {
        return (StartupImpact::High, true, Some("更新/临时程序".into()));
    }

    if command.contains(":\\") || command.contains(".exe") {
        return (StartupImpact::Medium, true, None);
    }

    (StartupImpact::Medium, true, None)
}

fn open_run_key(location: &StartupLocation, write: bool) -> Result<RegKey, String> {
    let hive = match location {
        StartupLocation::RegistryHkcu => HKEY_CURRENT_USER,
        StartupLocation::RegistryHklm => HKEY_LOCAL_MACHINE,
        _ => return Err("非注册表来源".into()),
    };
    let root = RegKey::predef(hive);
    let access = if write { KEY_READ | KEY_WRITE } else { KEY_READ };
    root.open_subkey_with_flags(RUN_SUBKEY, access)
        .map_err(|e| match location {
            StartupLocation::RegistryHklm if write => {
                format!("无法写入本机开机项（可能需要管理员权限）: {e}")
            }
            _ => format!("打开注册表 Run 失败: {e}"),
        })
}

fn list_registry(location: StartupLocation, items: &mut Vec<StartupItem>) {
    let Ok(key) = open_run_key(&location, false) else {
        return;
    };
    for (name, value) in key.enum_values().filter_map(|r| r.ok()) {
        let command = match String::from_reg_value(&value) {
            Ok(s) => s,
            Err(_) => continue,
        };
        if name.is_empty() {
            continue;
        }
        items.push(build_item(location.clone(), name, command, true));
    }
}

fn list_disabled_registry(items: &mut Vec<StartupItem>) {
    for entry in load_disabled() {
        if !matches!(
            entry.location,
            StartupLocation::RegistryHkcu | StartupLocation::RegistryHklm
        ) {
            continue;
        }
        // Skip if already present as enabled (value restored elsewhere)
        if items.iter().any(|i| {
            i.location == entry.location && i.name.eq_ignore_ascii_case(&entry.name)
        }) {
            continue;
        }
        items.push(build_item(
            entry.location,
            entry.name,
            entry.command,
            false,
        ));
    }
}

fn startup_folder(location: &StartupLocation) -> Option<PathBuf> {
    match location {
        StartupLocation::FolderUser => {
            let appdata = dirs::data_dir()?; // typically AppData\Roaming
            Some(
                appdata
                    .join("Microsoft")
                    .join("Windows")
                    .join("Start Menu")
                    .join("Programs")
                    .join("Startup"),
            )
        }
        StartupLocation::FolderCommon => {
            let program_data = std::env::var_os("ProgramData")?;
            Some(
                PathBuf::from(program_data)
                    .join("Microsoft")
                    .join("Windows")
                    .join("Start Menu")
                    .join("Programs")
                    .join("Startup"),
            )
        }
        _ => None,
    }
}

fn is_startup_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    if lower == "desktop.ini" {
        return false;
    }
    lower.ends_with(".lnk")
        || lower.ends_with(".url")
        || lower.ends_with(".exe")
        || lower.ends_with(".bat")
        || lower.ends_with(".cmd")
        || lower.ends_with(DISABLED_EXT)
}

fn strip_disabled_ext(name: &str) -> (String, bool) {
    let lower = name.to_ascii_lowercase();
    if let Some(base) = lower.strip_suffix(DISABLED_EXT) {
        // Preserve original casing for the stem by slicing original length
        let stem = &name[..base.len()];
        (stem.to_string(), false)
    } else {
        (name.to_string(), true)
    }
}

fn list_folder(location: StartupLocation, items: &mut Vec<StartupItem>) {
    let Some(dir) = startup_folder(&location) else {
        return;
    };
    let Ok(entries) = fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if !is_startup_file(file_name) {
            continue;
        }
        let (display_name, enabled) = strip_disabled_ext(file_name);
        let command = path.to_string_lossy().to_string();
        items.push(build_item(
            location.clone(),
            display_name,
            command,
            enabled,
        ));
    }
}

pub fn list_startup_items() -> Vec<StartupItem> {
    let mut items = Vec::new();
    list_registry(StartupLocation::RegistryHkcu, &mut items);
    list_registry(StartupLocation::RegistryHklm, &mut items);
    list_disabled_registry(&mut items);
    list_folder(StartupLocation::FolderUser, &mut items);
    list_folder(StartupLocation::FolderCommon, &mut items);
    items.sort_by(|a, b| {
        a.location
            .cmp_loc()
            .cmp(&b.location.cmp_loc())
            .then_with(|| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()))
    });
    items
}

impl StartupLocation {
    fn cmp_loc(&self) -> u8 {
        match self {
            StartupLocation::RegistryHkcu => 0,
            StartupLocation::RegistryHklm => 1,
            StartupLocation::FolderUser => 2,
            StartupLocation::FolderCommon => 3,
        }
    }
}

fn disable_registry(location: StartupLocation, name: &str) -> Result<(), String> {
    let key = open_run_key(&location, true)?;
    let command: String = key
        .get_value(name)
        .map_err(|e| format!("读取开机项「{name}」失败: {e}"))?;

    let mut disabled = load_disabled();
    disabled.retain(|e| !(e.location == location && e.name.eq_ignore_ascii_case(name)));
    disabled.push(DisabledRegistryEntry {
        location: location.clone(),
        name: name.to_string(),
        command,
    });
    save_disabled(&disabled)?;

    key.delete_value(name)
        .map_err(|e| format!("禁用开机项「{name}」失败: {e}"))?;
    Ok(())
}

fn enable_registry(location: StartupLocation, name: &str) -> Result<(), String> {
    let mut disabled = load_disabled();
    let idx = disabled
        .iter()
        .position(|e| e.location == location && e.name.eq_ignore_ascii_case(name))
        .ok_or_else(|| format!("找不到已禁用的开机项备份「{name}」"))?;
    let entry = disabled.remove(idx);
    let key = open_run_key(&location, true)?;
    key.set_value(&entry.name, &entry.command)
        .map_err(|e| format!("启用开机项「{name}」失败: {e}"))?;
    save_disabled(&disabled)?;
    Ok(())
}

fn folder_active_path(dir: &Path, name: &str) -> PathBuf {
    dir.join(name)
}

fn folder_disabled_path(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}{DISABLED_EXT}"))
}

fn disable_folder(location: StartupLocation, name: &str) -> Result<(), String> {
    let dir = startup_folder(&location).ok_or_else(|| "无法定位 Startup 文件夹".to_string())?;
    let active = folder_active_path(&dir, name);
    let disabled = folder_disabled_path(&dir, name);
    if !active.exists() {
        if disabled.exists() {
            return Ok(());
        }
        return Err(format!("找不到开机项文件「{name}」"));
    }
    if disabled.exists() {
        let _ = fs::remove_file(&disabled);
    }
    fs::rename(&active, &disabled).map_err(|e| format!("禁用 Startup 项失败: {e}"))?;
    Ok(())
}

fn enable_folder(location: StartupLocation, name: &str) -> Result<(), String> {
    let dir = startup_folder(&location).ok_or_else(|| "无法定位 Startup 文件夹".to_string())?;
    let active = folder_active_path(&dir, name);
    let disabled = folder_disabled_path(&dir, name);
    if active.exists() {
        return Ok(());
    }
    if !disabled.exists() {
        return Err(format!("找不到已禁用的 Startup 项「{name}」"));
    }
    fs::rename(&disabled, &active).map_err(|e| format!("启用 Startup 项失败: {e}"))?;
    Ok(())
}

pub fn set_startup_enabled(id: &str, enabled: bool) -> Result<StartupItem, String> {
    let (location, name) = parse_id(id)?;
    match location {
        StartupLocation::RegistryHkcu | StartupLocation::RegistryHklm => {
            if enabled {
                enable_registry(location.clone(), &name)?;
            } else {
                disable_registry(location.clone(), &name)?;
            }
        }
        StartupLocation::FolderUser | StartupLocation::FolderCommon => {
            if enabled {
                enable_folder(location.clone(), &name)?;
            } else {
                disable_folder(location.clone(), &name)?;
            }
        }
    }

    list_startup_items()
        .into_iter()
        .find(|i| i.id == id)
        .ok_or_else(|| "操作成功但无法重新读取该项".to_string())
}

pub fn disable_suggested() -> (Vec<StartupItem>, Vec<StartupItem>, Vec<(String, String)>) {
    let mut disabled = Vec::new();
    let mut skipped = Vec::new();
    let mut failed = Vec::new();

    for item in list_startup_items() {
        if !item.enabled {
            continue;
        }
        if !item.suggest_disable {
            skipped.push(item);
            continue;
        }
        match set_startup_enabled(&item.id, false) {
            Ok(updated) => disabled.push(updated),
            Err(e) => failed.push((item.name, e)),
        }
    }

    (disabled, skipped, failed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_id_roundtrip_registry_hkcu() {
        let id = make_id(&StartupLocation::RegistryHkcu, "MyApp");
        let (loc, name) = parse_id(&id).expect("parse");
        assert_eq!(loc, StartupLocation::RegistryHkcu);
        assert_eq!(name, "MyApp");
    }

    #[test]
    fn parse_id_rejects_unknown_location() {
        assert!(parse_id("unknown|foo").is_err());
    }

    #[test]
    fn parse_id_rejects_empty_name() {
        assert!(parse_id("hkcu|").is_err());
    }
}
