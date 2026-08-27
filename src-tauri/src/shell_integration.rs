use std::path::PathBuf;
use std::process::Command;

const MENU_KEY: &str = r"Software\Classes\Directory\shell\PureCleanAnalyze";
const MENU_LABEL: &str = "用净界分析磁盘占用";
const PENDING_FILE: &str = "pending_analyze.json";

pub fn is_explorer_menu_registered() -> bool {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(MENU_KEY)
            .is_ok()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

pub fn register_explorer_menu() -> Result<(), String> {
    #[cfg(windows)]
    {
        register_explorer_menu_windows()
    }
    #[cfg(not(windows))]
    {
        Err("资源管理器集成仅支持 Windows".into())
    }
}

pub fn unregister_explorer_menu() -> Result<(), String> {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let _ = hkcu.delete_subkey_all(MENU_KEY);
        let _ = hkcu.delete_subkey_all(format!("{MENU_KEY}\\command"));
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("资源管理器集成仅支持 Windows".into())
    }
}

#[cfg(windows)]
fn register_explorer_menu_windows() -> Result<(), String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let exe = current_exe()?;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (menu, _) = hkcu
        .create_subkey(MENU_KEY)
        .map_err(|e| format!("写入注册表失败: {e}"))?;
    menu.set_value("", &MENU_LABEL)
        .map_err(|e| format!("写入菜单名失败: {e}"))?;
    menu.set_value("Icon", &exe.to_string_lossy().to_string())
        .map_err(|e| format!("写入图标失败: {e}"))?;

    let (cmd, _) = hkcu
        .create_subkey(format!("{MENU_KEY}\\command"))
        .map_err(|e| format!("写入 command 键失败: {e}"))?;
    let command = format!(
        "\"{}\" --analyze \"%1\"",
        exe.to_string_lossy().replace('/', "\\")
    );
    cmd.set_value("", &command)
        .map_err(|e| format!("写入命令失败: {e}"))?;
    Ok(())
}

fn current_exe() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|e| format!("无法定位程序路径: {e}"))
}

/// Write pending analyze path and optionally launch app.
pub fn handle_analyze_arg(path: &str) -> Result<(), String> {
    let trimmed = path.trim().trim_matches('"');
    if trimmed.is_empty() {
        return Err("分析路径为空".into());
    }
    let pending = crate::config::config_dir()?.join(PENDING_FILE);
    let payload = serde_json::json!({ "path": trimmed });
    std::fs::write(
        &pending,
        serde_json::to_string(&payload).map_err(|e| format!("序列化失败: {e}"))?,
    )
    .map_err(|e| format!("写入待分析路径失败: {e}"))?;
    Ok(())
}

pub fn take_pending_analyze_path() -> Option<String> {
    let path = crate::config::config_dir().ok()?.join(PENDING_FILE);
    let text = std::fs::read_to_string(&path).ok()?;
    let _ = std::fs::remove_file(&path);
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    value.get("path")?.as_str().map(|s| s.to_string())
}

/// Re-launch self with --analyze if not already running (for shell menu).
pub fn ensure_app_running_for_analyze(path: &str) -> Result<(), String> {
    handle_analyze_arg(path)?;
    // If we're invoked from Explorer, we're already running — setup handles pending file.
    // If user wants to open existing instance, they can use single-instance later.
    Ok(())
}

pub fn open_services_console() -> Result<(), String> {
    #[cfg(windows)]
    {
        Command::new("services.msc")
            .spawn()
            .map_err(|e| format!("无法打开服务管理器: {e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("仅支持 Windows".into())
    }
}
