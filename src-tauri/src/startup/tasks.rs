use std::process::Command;

use super::{score_impact, StartupItem, StartupLocation};

const STARTUP_SCHEDULE_MARKERS: &[&str] = &[
    "at logon",
    "at system start",
    "at startup",
    "登录时",
    "系统启动时",
    "启动时",
];

fn decode_oem(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn run_schtasks(args: &[&str]) -> Result<String, String> {
    let output = Command::new("schtasks")
        .args(args)
        .output()
        .map_err(|e| format!("无法运行 schtasks: {e}"))?;
    if !output.status.success() {
        let stderr = decode_oem(&output.stderr);
        let stdout = decode_oem(&output.stdout);
        let detail = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        };
        return Err(if detail.is_empty() {
            "schtasks 命令失败".into()
        } else {
            detail
        });
    }
    Ok(decode_oem(&output.stdout))
}

fn is_startup_schedule(schedule_type: &str) -> bool {
    let lower = schedule_type.to_ascii_lowercase();
    STARTUP_SCHEDULE_MARKERS
        .iter()
        .any(|m| lower.contains(m))
}

fn is_system_maintenance_task(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with("\\microsoft\\windows\\")
        && !lower.contains("update")
        && !lower.contains("google")
        && !lower.contains("adobe")
        && !lower.contains("nvidia")
        && !lower.contains("amd")
}

fn parse_list_blocks(text: &str) -> Vec<StartupItem> {
    let mut items = Vec::new();
    for block in text.split("\r\n\r\n").chain(text.split("\n\n")) {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }
        let mut task_name: Option<String> = None;
        let mut command: Option<String> = None;
        let mut status: Option<String> = None;
        let mut schedule_type: Option<String> = None;

        for line in block.lines() {
            let Some((key, value)) = line.split_once(':') else {
                continue;
            };
            let key = key.trim();
            let value = value.trim();
            match key {
                "TaskName" | "任务名" => task_name = Some(value.to_string()),
                "Task To Run" | "要运行的任务" => command = Some(value.to_string()),
                "Status" | "状态" => status = Some(value.to_string()),
                "Schedule Type" | "计划类型" => schedule_type = Some(value.to_string()),
                _ => {}
            }
        }

        let Some(name) = task_name.filter(|n| !n.is_empty()) else {
            continue;
        };
        if is_system_maintenance_task(&name) {
            continue;
        }
        let schedule = schedule_type.unwrap_or_default();
        if !is_startup_schedule(&schedule) {
            continue;
        }
        let command = command.unwrap_or_else(|| name.clone());
        let status_text = status.unwrap_or_default();
        let enabled = !status_text.to_ascii_lowercase().contains("disabled")
            && !status_text.contains("已禁用");

        let display = name.rsplit('\\').next().unwrap_or(&name).to_string();
        let (impact, suggest_disable, publisher_hint) = score_impact(&display, &command);
        items.push(StartupItem {
            id: make_task_id(&name),
            name: display,
            command,
            location: StartupLocation::TaskScheduler,
            enabled,
            publisher_hint,
            impact,
            suggest_disable,
            icon_data_url: None,
        });
    }
    items
}

pub fn make_task_id(full_name: &str) -> String {
    format!("task|{full_name}")
}

pub fn parse_task_id(id: &str) -> Result<String, String> {
    id.strip_prefix("task|")
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "无效的任务计划 id".into())
}

pub fn list_task_scheduler_items() -> Vec<StartupItem> {
    let Ok(text) = run_schtasks(&["/Query", "/FO", "LIST", "/V"]) else {
        return Vec::new();
    };
    parse_list_blocks(&text)
}

pub fn set_task_enabled(full_name: &str, enabled: bool) -> Result<(), String> {
    let flag = if enabled { "/ENABLE" } else { "/DISABLE" };
    run_schtasks(&["/Change", "/TN", full_name, flag]).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_logon_schedule() {
        assert!(is_startup_schedule("At logon time"));
        assert!(is_startup_schedule("At system start up"));
        assert!(!is_startup_schedule("Daily"));
    }

    #[test]
    fn parse_task_id_roundtrip() {
        let id = make_task_id("\\Vendor\\Update");
        assert_eq!(parse_task_id(&id).unwrap(), "\\Vendor\\Update");
    }
}
