use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

use crate::config::{self, AppConfig};

pub fn start(app: AppHandle) {
    let startup = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(15));
        let _ = check_and_notify(&startup, false);
    });

    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(3600));
        let _ = check_and_notify(&app, false);
    });
}

fn local_hour() -> u32 {
    #[cfg(windows)]
    {
        use std::mem::MaybeUninit;
        use windows_sys::Win32::Foundation::SYSTEMTIME;
        use windows_sys::Win32::System::SystemInformation::GetLocalTime;
        unsafe {
            let mut st = MaybeUninit::<SYSTEMTIME>::zeroed();
            GetLocalTime(st.as_mut_ptr());
            st.assume_init().wHour as u32
        }
    }
    #[cfg(not(windows))]
    {
        0
    }
}

fn days_since_last(last: &str) -> Option<u64> {
    let parsed = last.trim().parse::<i64>().ok()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs() as i64;
    let diff = now.saturating_sub(parsed);
    Some((diff / 86400) as u64)
}

pub fn check_and_notify(app: &AppHandle, force: bool) -> Result<bool, String> {
    let cfg = config::load_config();
    if !force && !cfg.schedule_reminder_enabled {
        return Ok(false);
    }

    let due = force
        || is_reminder_due(&cfg)
        || (cfg.schedule_reminder_enabled && cfg.last_reminder_at.is_none());

    if !due {
        return Ok(false);
    }

    app.notification()
        .builder()
        .title("净界 · 清理提醒")
        .body("磁盘缓存可能已累积，打开应用运行一次扫描吧")
        .show()
        .map_err(|e| format!("发送通知失败: {e}"))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
        .to_string();
    let mut next = cfg;
    next.last_reminder_at = Some(now);
    config::save_config(&next)?;

    let _ = app.emit("schedule_reminder", ());
    Ok(true)
}

fn is_reminder_due(cfg: &AppConfig) -> bool {
    if !cfg.schedule_reminder_enabled {
        return false;
    }
    if local_hour() < cfg.schedule_reminder_hour {
        return false;
    }
    match cfg.last_reminder_at.as_deref() {
        None => true,
        Some(last) => days_since_last(last)
            .map(|d| d >= cfg.schedule_reminder_days.max(1))
            .unwrap_or(true),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn days_since_last_parses_unix() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let two_days_ago = (now - 2 * 86400).to_string();
        assert_eq!(days_since_last(&two_days_ago), Some(2));
    }
}
