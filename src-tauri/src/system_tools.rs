use std::process::Command;

/// Launch Windows Disk Cleanup for a drive (used for WinSxS / component store).
pub fn open_disk_cleanup(drive: Option<String>) -> Result<(), String> {
    #[cfg(windows)]
    {
        let letter = drive
            .unwrap_or_else(|| "C".into())
            .trim()
            .trim_end_matches(':')
            .chars()
            .next()
            .unwrap_or('C');
        Command::new("cleanmgr.exe")
            .arg(format!("/d{letter}"))
            .spawn()
            .map_err(|e| format!("无法启动磁盘清理: {e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = drive;
        Err("磁盘清理仅支持 Windows".into())
    }
}

/// Reveal a file or folder in Windows Explorer.
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    use std::path::Path;
    use std::process::Command;

    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("路径为空".into());
    }

    #[cfg(windows)]
    {
        let p = Path::new(trimmed);
        if p.is_file() {
            Command::new("explorer.exe")
                .arg(format!("/select,{trimmed}"))
                .spawn()
                .map_err(|e| format!("无法打开资源管理器: {e}"))?;
            return Ok(());
        }
        if p.is_dir() {
            Command::new("explorer.exe")
                .arg(trimmed)
                .spawn()
                .map_err(|e| format!("无法打开资源管理器: {e}"))?;
            return Ok(());
        }
        if let Some(parent) = p.parent().filter(|d| !d.as_os_str().is_empty()) {
            Command::new("explorer.exe")
                .arg(parent)
                .spawn()
                .map_err(|e| format!("无法打开资源管理器: {e}"))?;
            return Ok(());
        }
        Err("路径不存在".into())
    }
    #[cfg(not(windows))]
    {
        let _ = trimmed;
        Err("资源管理器定位仅支持 Windows".into())
    }
}
