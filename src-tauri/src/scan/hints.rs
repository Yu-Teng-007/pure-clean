use std::path::Path;

use crate::model::{Risk, ScanItem};

struct SystemFileInfo {
    hint: &'static str,
    risk: Risk,
}

fn lookup_system_file(file_name: &str) -> Option<SystemFileInfo> {
    match file_name.to_ascii_lowercase().as_str() {
        "pagefile.sys" => Some(SystemFileInfo {
            hint: "Windows 虚拟内存文件，系统运行必需，请勿删除",
            risk: Risk::Dangerous,
        }),
        "hiberfil.sys" => Some(SystemFileInfo {
            hint: "系统休眠文件，删除后无法使用休眠功能",
            risk: Risk::Dangerous,
        }),
        "swapfile.sys" => Some(SystemFileInfo {
            hint: "Windows 交换文件，请勿删除",
            risk: Risk::Dangerous,
        }),
        "sleepfile.sys" => Some(SystemFileInfo {
            hint: "混合睡眠文件，请勿删除",
            risk: Risk::Dangerous,
        }),
        "bootmgr" | "bootnxt" => Some(SystemFileInfo {
            hint: "系统引导文件，请勿删除",
            risk: Risk::Dangerous,
        }),
        _ => None,
    }
}

/// Attach known-file warnings so users do not delete critical system files by mistake.
pub fn enrich_scan_item(mut item: ScanItem) -> ScanItem {
    let path = Path::new(&item.path);
    let Some(name) = path.file_name() else {
        return item;
    };
    let Some(info) = lookup_system_file(&name.to_string_lossy()) else {
        return item;
    };
    item.hint = Some(info.hint.to_string());
    item.risk = info.risk;
    item.selected_by_default = false;
    item
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Category;

    fn bare_item(path: &str) -> ScanItem {
        ScanItem {
            id: "test".into(),
            category: Category::LargeFiles,
            category_label: Category::LargeFiles.label().to_string(),
            path: path.into(),
            bytes: 8 * 1024 * 1024 * 1024,
            risk: Risk::Caution,
            selected_by_default: false,
            special: None,
            group_id: None,
            is_keeper: None,
            hint: None,
        }
    }

    #[test]
    fn pagefile_gets_warning_and_dangerous_risk() {
        let item = enrich_scan_item(bare_item(r"C:\pagefile.sys"));
        assert!(item.hint.as_ref().unwrap().contains("虚拟内存"));
        assert_eq!(item.risk, Risk::Dangerous);
    }

    #[test]
    fn regular_file_unchanged() {
        let item = enrich_scan_item(bare_item(r"C:\Users\me\big.zip"));
        assert!(item.hint.is_none());
        assert_eq!(item.risk, Risk::Caution);
    }
}
