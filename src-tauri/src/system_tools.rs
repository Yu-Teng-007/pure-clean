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
