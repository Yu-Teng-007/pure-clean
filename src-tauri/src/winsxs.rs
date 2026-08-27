use crate::model::WinSxSHint;

/// Analyze WinSxS component store reclaimable size via DISM (read-only).
pub fn analyze_winsxs() -> WinSxSHint {
    #[cfg(windows)]
    {
        analyze_winsxs_windows()
    }
    #[cfg(not(windows))]
    {
        WinSxSHint {
            reclaimable_bytes: None,
            summary: "WinSxS 分析仅支持 Windows".into(),
            raw_excerpt: None,
        }
    }
}

#[cfg(windows)]
fn analyze_winsxs_windows() -> WinSxSHint {
    use std::process::Command;

    let output = Command::new("dism.exe")
        .args([
            "/Online",
            "/Cleanup-Image",
            "/AnalyzeComponentStore",
        ])
        .output();

    let Ok(out) = output else {
        return WinSxSHint {
            reclaimable_bytes: None,
            summary: "无法运行 DISM，可能需要管理员权限".into(),
            raw_excerpt: None,
        };
    };

    let text = String::from_utf8_lossy(&out.stdout);
    let combined = format!("{}{}", text, String::from_utf8_lossy(&out.stderr));
    let excerpt: String = combined
        .lines()
        .filter(|l| !l.trim().is_empty())
        .take(12)
        .collect::<Vec<_>>()
        .join("\n");

    let reclaimable = parse_reclaimable_gb(&combined);
    let summary = if let Some(bytes) = reclaimable {
        format!(
            "组件存储可清理约 {}，建议使用「磁盘清理」或 cleanmgr 处理 WinSxS",
            crate::scan::size::format_size(bytes)
        )
    } else if combined.contains("Error") || combined.contains("错误") {
        "DISM 分析未完成，可尝试以管理员身份运行或使用磁盘清理".into()
    } else {
        "已运行 DISM 分析，请查看详情或使用磁盘清理工具".into()
    };

    WinSxSHint {
        reclaimable_bytes: reclaimable,
        summary,
        raw_excerpt: if excerpt.is_empty() {
            None
        } else {
            Some(excerpt)
        },
    }
}

#[cfg(windows)]
fn parse_reclaimable_gb(text: &str) -> Option<u64> {
    // Match "Component Store Cleanup Recommended : Yes" and size lines like "xx GB"
    for line in text.lines() {
        let lower = line.to_lowercase();
        if lower.contains("reclaim") || lower.contains("可回收") || lower.contains("节省") {
            if let Some(bytes) = extract_size_from_line(line) {
                return Some(bytes);
            }
        }
    }
    // Fallback: any "X.XX GB" near Component Store
    for line in text.lines() {
        if line.to_lowercase().contains("component") || line.contains("组件") {
            if let Some(bytes) = extract_size_from_line(line) {
                return Some(bytes);
            }
        }
    }
    None
}

#[cfg(windows)]
fn extract_size_from_line(line: &str) -> Option<u64> {
    let lower = line.to_lowercase();
    if let Some(idx) = lower.find("gb") {
        let before = line[..idx].trim();
        let num_str: String = before
            .chars()
            .rev()
            .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == ',')
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        let num_str = num_str.replace(',', ".");
        if let Ok(gb) = num_str.parse::<f64>() {
            return Some((gb * 1024.0 * 1024.0 * 1024.0) as u64);
        }
    }
    if let Some(idx) = lower.find("mb") {
        let before = line[..idx].trim();
        let num_str: String = before
            .chars()
            .rev()
            .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == ',')
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        let num_str = num_str.replace(',', ".");
        if let Ok(mb) = num_str.parse::<f64>() {
            return Some((mb * 1024.0 * 1024.0) as u64);
        }
    }
    None
}
