use crate::model::ServiceSuggestion;

/// List Windows services that are auto-start but may be optional (read-only suggestions).
pub fn list_service_suggestions() -> Vec<ServiceSuggestion> {
    #[cfg(windows)]
    {
        list_service_suggestions_windows()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

#[cfg(windows)]
fn list_service_suggestions_windows() -> Vec<ServiceSuggestion> {
    use std::process::Command;

    let script = r#"
Get-CimInstance Win32_Service |
  Where-Object { $_.StartMode -eq 'Auto' -and $_.State -eq 'Running' } |
  Select-Object -First 60 Name, DisplayName, State, StartMode, PathName |
  ConvertTo-Json -Compress
"#;
    let output = match Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
    {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => return Vec::new(),
    };
    if output.is_empty() {
        return Vec::new();
    }

    let parsed: Result<serde_json::Value, _> = serde_json::from_str(&output);
    let Ok(value) = parsed else {
        return Vec::new();
    };

    let items: Vec<serde_json::Value> = match value {
        serde_json::Value::Array(arr) => arr,
        obj => vec![obj],
    };

    let skip_prefixes = ["Rpc", "Dcom", "Win", "Event", "Plug", "Power", "State", "Sys"];

    items
        .into_iter()
        .filter_map(|v| {
            let name = v.get("Name")?.as_str()?.to_string();
            if skip_prefixes.iter().any(|p| name.starts_with(p)) {
                return None;
            }
            let display_name = v
                .get("DisplayName")
                .and_then(|x| x.as_str())
                .unwrap_or(&name)
                .to_string();
            let state = v
                .get("State")
                .and_then(|x| x.as_str())
                .unwrap_or("Unknown")
                .to_string();
            let start_mode = v
                .get("StartMode")
                .and_then(|x| x.as_str())
                .unwrap_or("Auto")
                .to_string();
            let path_name = v
                .get("PathName")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_lowercase();
            let hint = if path_name.contains("program files") {
                "第三方程序服务，若不用对应软件可考虑改为手动".into()
            } else if name.ends_with("Updater") || display_name.contains("Update") {
                "更新相关服务，停用可能影响自动更新".into()
            } else {
                "自动启动服务，请确认是否必需后再在 services.msc 中调整".into()
            };
            Some(ServiceSuggestion {
                name,
                display_name,
                state,
                start_mode,
                hint,
            })
        })
        .collect()
}
