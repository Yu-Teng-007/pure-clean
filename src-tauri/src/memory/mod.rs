use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySnapshot {
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub used_bytes: u64,
    /// 0–100
    pub used_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMemoryItem {
    pub pid: u32,
    pub name: String,
    pub path: Option<String>,
    pub working_set_bytes: u64,
    pub private_bytes: u64,
    /// PNG data URL from the process executable icon, if available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_data_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCleanReport {
    pub before: MemorySnapshot,
    pub after: MemorySnapshot,
    /// 可用内存增加量（清理后可用 − 清理前可用）
    pub freed_bytes: u64,
    pub trimmed_count: u32,
    pub failed_count: u32,
    pub system_commands_ok: bool,
    pub message: String,
}

pub fn snapshot() -> MemorySnapshot {
    #[cfg(windows)]
    {
        return read_snapshot();
    }
    #[cfg(not(windows))]
    {
        MemorySnapshot {
            total_bytes: 0,
            available_bytes: 0,
            used_bytes: 0,
            used_percent: 0.0,
        }
    }
}

pub fn list_processes(limit: Option<usize>) -> Vec<ProcessMemoryItem> {
    #[cfg(windows)]
    {
        let mut items = enumerate_processes();
        items.sort_by(|a, b| b.working_set_bytes.cmp(&a.working_set_bytes));
        let lim = limit.unwrap_or(80).max(1);
        items.truncate(lim);
        attach_icons(&mut items);
        items
    }
    #[cfg(not(windows))]
    {
        let _ = limit;
        Vec::new()
    }
}

/// 一键内存清理：压缩进程工作集，并尝试刷新待机列表。
pub fn clean_memory() -> MemoryCleanReport {
    #[cfg(windows)]
    {
        clean_memory_windows()
    }
    #[cfg(not(windows))]
    {
        let snap = snapshot();
        MemoryCleanReport {
            before: snap.clone(),
            after: snap,
            freed_bytes: 0,
            trimmed_count: 0,
            failed_count: 0,
            system_commands_ok: false,
            message: "当前平台不支持内存清理".into(),
        }
    }
}

pub fn trim_process(pid: u32) -> Result<u64, String> {
    #[cfg(windows)]
    {
        trim_process_windows(pid)
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
        Err("当前平台不支持".into())
    }
}

#[cfg(windows)]
fn read_snapshot() -> MemorySnapshot {
    use windows_sys::Win32::System::SystemInformation::{
        GlobalMemoryStatusEx, MEMORYSTATUSEX,
    };

    unsafe {
        let mut status: MEMORYSTATUSEX = std::mem::zeroed();
        status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        if GlobalMemoryStatusEx(&mut status) == 0 {
            return MemorySnapshot {
                total_bytes: 0,
                available_bytes: 0,
                used_bytes: 0,
                used_percent: 0.0,
            };
        }
        let total = status.ullTotalPhys;
        let available = status.ullAvailPhys;
        let used = total.saturating_sub(available);
        let used_percent = if total > 0 {
            (used as f64 / total as f64) * 100.0
        } else {
            0.0
        };
        MemorySnapshot {
            total_bytes: total,
            available_bytes: available,
            used_bytes: used,
            used_percent,
        }
    }
}

#[cfg(windows)]
fn attach_icons(items: &mut [ProcessMemoryItem]) {
    use std::collections::HashMap;
    use std::path::Path;

    let mut cache: HashMap<String, Option<String>> = HashMap::new();
    for item in items.iter_mut() {
        let Some(path) = item.path.as_deref() else {
            continue;
        };
        let key = path.to_ascii_lowercase();
        let icon = if let Some(cached) = cache.get(&key) {
            cached.clone()
        } else {
            let url = crate::startup::icon::icon_data_url_for_path(Path::new(path));
            cache.insert(key, url.clone());
            url
        };
        item.icon_data_url = icon;
    }
}

#[cfg(windows)]
fn process_image_path(handle: windows_sys::Win32::Foundation::HANDLE) -> Option<String> {
    use windows_sys::Win32::System::ProcessStatus::K32GetModuleFileNameExW;
    use windows_sys::Win32::System::Threading::QueryFullProcessImageNameW;

    unsafe {
        let mut path_buf = [0u16; 512];
        let mut size = path_buf.len() as u32;
        if QueryFullProcessImageNameW(handle, 0, path_buf.as_mut_ptr(), &mut size) != 0
            && size > 0
        {
            return Some(wchar_to_string(&path_buf[..size as usize]));
        }
        if K32GetModuleFileNameExW(
            handle,
            std::ptr::null_mut(),
            path_buf.as_mut_ptr(),
            path_buf.len() as u32,
        ) > 0
        {
            return Some(wchar_to_string(&path_buf));
        }
        None
    }
}

#[cfg(windows)]
fn enumerate_processes() -> Vec<ProcessMemoryItem> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::ProcessStatus::{
        GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_QUERY_LIMITED_INFORMATION,
        PROCESS_VM_READ,
    };

    let mut items = Vec::new();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return items;
        }

        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        if Process32FirstW(snap, &mut entry) != 0 {
            loop {
                let pid = entry.th32ProcessID;
                if pid != 0 {
                    let name = wchar_to_string(&entry.szExeFile);
                    let access = PROCESS_QUERY_INFORMATION | PROCESS_VM_READ;
                    let mut handle = OpenProcess(access, 0, pid);
                    if handle.is_null() {
                        handle = OpenProcess(
                            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ,
                            0,
                            pid,
                        );
                    }
                    if handle.is_null() {
                        handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
                    }

                    if !handle.is_null() {
                        let mut counters: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
                        counters.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
                        let ok = GetProcessMemoryInfo(
                            handle,
                            &mut counters,
                            counters.cb,
                        );
                        if ok != 0 {
                            items.push(ProcessMemoryItem {
                                pid,
                                name,
                                path: process_image_path(handle),
                                working_set_bytes: counters.WorkingSetSize as u64,
                                private_bytes: counters.PagefileUsage as u64,
                                icon_data_url: None,
                            });
                        }
                        CloseHandle(handle);
                    }
                }

                if Process32NextW(snap, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
    }
    items
}

#[cfg(windows)]
fn clean_memory_windows() -> MemoryCleanReport {
    let before = read_snapshot();
    let (trimmed, failed) = empty_all_working_sets();
    let system_ok = try_system_memory_commands();

    // 给系统一点时间回收页
    std::thread::sleep(std::time::Duration::from_millis(350));
    let after = read_snapshot();
    let freed = after
        .available_bytes
        .saturating_sub(before.available_bytes);

    let message = if system_ok {
        format!(
            "已压缩 {trimmed} 个进程工作集，并刷新待机列表；可用内存约增加 {}",
            crate::scan::size::format_size(freed)
        )
    } else {
        format!(
            "已压缩 {trimmed} 个进程工作集（失败 {failed}）；待机列表需管理员权限才能深度清理；可用内存约增加 {}",
            crate::scan::size::format_size(freed)
        )
    };

    MemoryCleanReport {
        before,
        after,
        freed_bytes: freed,
        trimmed_count: trimmed,
        failed_count: failed,
        system_commands_ok: system_ok,
        message,
    }
}

#[cfg(windows)]
fn empty_all_working_sets() -> (u32, u32) {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::ProcessStatus::EmptyWorkingSet;
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcessId, OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_SET_QUOTA,
    };

    let self_pid = unsafe { GetCurrentProcessId() };
    let mut trimmed = 0u32;
    let mut failed = 0u32;

    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return (0, 0);
        }

        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        if Process32FirstW(snap, &mut entry) != 0 {
            loop {
                let pid = entry.th32ProcessID;
                if pid != 0 && pid != self_pid {
                    let handle =
                        OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_SET_QUOTA, 0, pid);
                    if !handle.is_null() {
                        if EmptyWorkingSet(handle) != 0 {
                            trimmed += 1;
                        } else {
                            failed += 1;
                        }
                        CloseHandle(handle);
                    } else {
                        failed += 1;
                    }
                }
                if Process32NextW(snap, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);

        // 也压缩自身工作集
        let self_handle =
            OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_SET_QUOTA, 0, self_pid);
        if !self_handle.is_null() {
            if EmptyWorkingSet(self_handle) != 0 {
                trimmed += 1;
            }
            CloseHandle(self_handle);
        }
    }

    (trimmed, failed)
}

#[cfg(windows)]
fn trim_process_windows(pid: u32) -> Result<u64, String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::ProcessStatus::{
        EmptyWorkingSet, GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_SET_QUOTA, PROCESS_VM_READ,
    };

    unsafe {
        let handle = OpenProcess(
            PROCESS_QUERY_INFORMATION | PROCESS_SET_QUOTA | PROCESS_VM_READ,
            0,
            pid,
        );
        if handle.is_null() {
            return Err("无法打开该进程（可能需要管理员权限）".into());
        }

        let mut before: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
        before.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
        let _ = GetProcessMemoryInfo(handle, &mut before, before.cb);
        let before_ws = before.WorkingSetSize as u64;

        if EmptyWorkingSet(handle) == 0 {
            CloseHandle(handle);
            return Err("压缩工作集失败（权限不足或进程受保护）".into());
        }

        let mut after: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
        after.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
        let _ = GetProcessMemoryInfo(handle, &mut after, after.cb);
        CloseHandle(handle);

        Ok(before_ws.saturating_sub(after.WorkingSetSize as u64))
    }
}

/// 尝试执行系统级内存列表命令（待机列表等）。失败时返回 false，不抛错。
#[cfg(windows)]
fn try_system_memory_commands() -> bool {
    // SYSTEM_MEMORY_LIST_COMMAND:
    // MemoryEmptyWorkingSets = 2
    // MemoryFlushModifiedList = 3
    // MemoryPurgeStandbyList = 4
    // MemoryPurgeLowPriorityStandbyList = 5
    const SYSTEM_MEMORY_LIST_INFORMATION: u32 = 80;
    type NtSetSystemInformationFn =
        unsafe extern "system" fn(u32, *mut std::ffi::c_void, u32) -> i32;

    unsafe {
        let ntdll = windows_sys::Win32::System::LibraryLoader::GetModuleHandleW(
            windows_sys::core::w!("ntdll.dll"),
        );
        if ntdll.is_null() {
            return false;
        }
        let proc = windows_sys::Win32::System::LibraryLoader::GetProcAddress(
            ntdll,
            windows_sys::core::s!("NtSetSystemInformation"),
        );
        if proc.is_none() {
            return false;
        }
        let nt_set: NtSetSystemInformationFn = std::mem::transmute(proc);

        let mut all_ok = true;
        for cmd in [2i32, 3, 4, 5] {
            let mut command = cmd;
            let status = nt_set(
                SYSTEM_MEMORY_LIST_INFORMATION,
                &mut command as *mut i32 as *mut _,
                std::mem::size_of::<i32>() as u32,
            );
            if status < 0 {
                all_ok = false;
            }
        }
        all_ok
    }
}

#[cfg(windows)]
fn wchar_to_string(buf: &[u16]) -> String {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_has_total_on_windows() {
        let s = snapshot();
        #[cfg(windows)]
        {
            assert!(s.total_bytes > 0);
            assert!(s.used_bytes <= s.total_bytes);
        }
        #[cfg(not(windows))]
        {
            let _ = s;
        }
    }
}
