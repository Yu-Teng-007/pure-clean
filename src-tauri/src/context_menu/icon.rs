//! Resolve shell extension / context-menu handler icons as PNG data URLs.

use std::path::{Path, PathBuf};
use std::ptr;

use winreg::enums::*;
use winreg::RegKey;

use crate::context_menu::ContextMenuKind;
use crate::startup::icon;

const CLSID_PREFIX: &str = r"CLSID\";

fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn expand_env_path(raw: &str) -> PathBuf {
    let trimmed = raw.trim().trim_matches('"');
    if trimmed.is_empty() {
        return PathBuf::new();
    }
    unsafe {
        let wide = to_wide(trimmed);
        let needed = windows_sys::Win32::System::Environment::ExpandEnvironmentStringsW(
            wide.as_ptr(),
            std::ptr::null_mut(),
            0,
        );
        if needed == 0 {
            return PathBuf::from(trimmed);
        }
        let mut buf = vec![0u16; needed as usize];
        let written = windows_sys::Win32::System::Environment::ExpandEnvironmentStringsW(
            wide.as_ptr(),
            buf.as_mut_ptr(),
            needed,
        );
        if written == 0 {
            return PathBuf::from(trimmed);
        }
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        PathBuf::from(String::from_utf16_lossy(&buf[..len]))
    }
}

fn is_guid_like(s: &str) -> bool {
    normalize_clsid(s).is_some()
}

fn normalize_clsid(handler: &str) -> Option<String> {
    let trimmed = handler.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') && trimmed.len() > 2 {
        return Some(trimmed.to_string());
    }
    let inner = trimmed.trim_matches('{').trim_matches('}');
    if inner.len() == 36 && inner.chars().filter(|c| *c == '-').count() == 4 {
        return Some(format!("{{{inner}}}"));
    }
    None
}

fn resolve_indirect_string(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if !trimmed.starts_with('@') {
        return Some(trimmed.to_string());
    }
    unsafe {
        let wide = to_wide(trimmed);
        let mut buf = [0u16; 512];
        let hr = windows_sys::Win32::UI::Shell::SHLoadIndirectString(
            wide.as_ptr(),
            buf.as_mut_ptr(),
            buf.len() as u32,
            ptr::null_mut(),
        );
        if hr >= 0 {
            let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            let s = String::from_utf16_lossy(&buf[..len]).trim().to_string();
            if !s.is_empty() {
                return Some(s);
            }
        }
    }
    None
}

fn parse_icon_location(raw: &str, module_hint: Option<&Path>) -> Option<(PathBuf, i32)> {
    let mut s = raw.trim();
    s = s.trim_start_matches('@');
    s = s.trim_matches('"');
    if s.is_empty() {
        return None;
    }

    let (path_part, index) = match s.rsplit_once(',') {
        Some((path, idx)) => {
            let idx_trim = idx.trim();
            if idx_trim.parse::<i32>().is_ok() {
                (path.trim(), idx_trim.parse::<i32>().unwrap_or(0))
            } else {
                (s, 0)
            }
        }
        None => (s, 0),
    };

    let path = if path_part.contains(':') || path_part.starts_with('%') || path_part.starts_with('\\')
    {
        expand_env_path(path_part)
    } else if let Some(module) = module_hint {
        module
            .parent()
            .map(|dir| dir.join(path_part))
            .unwrap_or_else(|| PathBuf::from(path_part))
    } else {
        PathBuf::from(r"C:\Windows\System32").join(path_part)
    };

    if path.as_os_str().is_empty() {
        return None;
    }
    Some((path, index))
}

fn icon_from_icon_string(raw: &str, module_hint: Option<&Path>) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some((path, index)) = parse_icon_location(trimmed, module_hint) {
        if let Some(url) = icon::icon_data_url_for_path_index(&path, index) {
            return Some(url);
        }
    }
    if trimmed.contains(".exe") || trimmed.contains(":\\") || trimmed.starts_with('"') {
        return icon::icon_data_url_for_command(trimmed);
    }
    None
}

fn open_clsid_subkey(clsid: &str, sub: &str) -> Option<RegKey> {
    let root = RegKey::predef(HKEY_CLASSES_ROOT);
    let path = if sub.is_empty() {
        format!("{CLSID_PREFIX}{clsid}")
    } else {
        format!("{CLSID_PREFIX}{clsid}\\{sub}")
    };
    root.open_subkey(path).ok()
}

fn module_paths_for_clsid(clsid: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for sub in [
        "InprocServer32",
        "LocalServer32",
        "InprocHandler32",
        "InprocHandler",
        "TreatAs",
    ] {
        if let Some(key) = open_clsid_subkey(clsid, sub) {
            if let Ok(s) = key.get_value::<String, _>("") {
                let p = expand_env_path(s.trim());
                if p.exists() {
                    paths.push(p);
                }
            }
        }
    }
    paths
}

fn icon_from_clsid(clsid: &str, depth: u8) -> Option<String> {
    if depth > 3 {
        return None;
    }
    let normalized = normalize_clsid(clsid)?;
    let modules = module_paths_for_clsid(&normalized);
    let module_hint = modules.first().map(|p| p.as_path());

    if let Some(key) = open_clsid_subkey(&normalized, "") {
        if let Ok(raw) = key.get_value::<String, _>("Icon") {
            if let Some(url) = icon_from_icon_string(&raw, module_hint) {
                return Some(url);
            }
        }
    }

    if let Some(key) = open_clsid_subkey(&normalized, "DefaultIcon") {
        if let Ok(raw) = key.get_value::<String, _>("") {
            if let Some(url) = icon_from_icon_string(&raw, module_hint) {
                return Some(url);
            }
        }
    }

    for dll in &modules {
        if let Some(url) = icon::icon_data_url_for_path_index(dll, 0) {
            return Some(url);
        }
    }

    if let Some(key) = open_clsid_subkey(&normalized, "shellex\\IconHandler") {
        if let Ok(next) = key.get_value::<String, _>("") {
            if let Some(url) = icon_from_clsid(&next, depth + 1) {
                return Some(url);
            }
        }
    }

    None
}

fn icon_from_handler(handler: &str) -> Option<String> {
    if let Some(clsid) = normalize_clsid(handler) {
        if let Some(url) = icon_from_clsid(&clsid, 0) {
            return Some(url);
        }
    }

    if handler.contains(".exe") || handler.contains(":\\") || handler.starts_with('"') {
        return icon::icon_data_url_for_command(handler);
    }

    icon_from_icon_string(handler, None)
}

pub fn shellex_display_name(handler_key: &str, clsid: &str) -> String {
    if !is_guid_like(handler_key) {
        return handler_key.to_string();
    }
    friendly_name_from_clsid(clsid).unwrap_or_else(|| handler_key.to_string())
}

fn friendly_name_from_clsid(clsid: &str) -> Option<String> {
    let normalized = normalize_clsid(clsid)?;
    if let Some(key) = open_clsid_subkey(&normalized, "") {
        if let Ok(s) = key.get_value::<String, _>("") {
            let t = s.trim();
            if !t.is_empty() && !t.starts_with('@') && !is_guid_like(t) {
                return Some(s.trim().to_string());
            }
            if t.starts_with('@') {
                return resolve_indirect_string(t);
            }
        }
        for val_name in ["LocalizedString", "InfoTip", "Description"] {
            if let Ok(s) = key.get_value::<String, _>(val_name) {
                if let Some(name) = resolve_indirect_string(&s) {
                    if !name.is_empty() && !is_guid_like(&name) {
                        return Some(name);
                    }
                }
            }
        }
    }
    None
}

pub fn icon_data_url_for_item(
    kind: &ContextMenuKind,
    handler: &str,
    icon_hint: Option<&str>,
) -> Option<String> {
    if let Some(hint) = icon_hint {
        if let Some(url) = icon_from_icon_string(hint, None) {
            return Some(url);
        }
    }

    match kind {
        ContextMenuKind::Shellex => icon_from_handler(handler),
        ContextMenuKind::Shell => icon::icon_data_url_for_command(handler)
            .or_else(|| icon_from_handler(handler)),
    }
}
