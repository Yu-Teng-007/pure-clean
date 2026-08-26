use std::path::Path;

use crate::model::BlockingProcess;

/// Returns processes that may be locking `path` (Windows Restart Manager).
pub fn find_locking_processes(path: &Path) -> Vec<BlockingProcess> {
    #[cfg(windows)]
    {
        find_locking_processes_windows(path)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Vec::new()
    }
}

#[cfg(windows)]
fn find_locking_processes_windows(path: &Path) -> Vec<BlockingProcess> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;

    use windows_sys::Win32::Foundation::{ERROR_MORE_DATA, ERROR_SUCCESS};
    use windows_sys::Win32::System::RestartManager::{
        CCH_RM_SESSION_KEY, RmEndSession, RmGetList, RmRegisterResources, RmStartSession,
        RM_PROCESS_INFO,
    };

    if !path.exists() {
        return Vec::new();
    }

    let canonical = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string();

    let mut wide: Vec<u16> = OsStr::new(&canonical).encode_wide().collect();
    wide.push(0);

    unsafe {
        let mut session = 0u32;
        let mut session_key = [0u16; (CCH_RM_SESSION_KEY as usize) + 1];
        if RmStartSession(&mut session, 0, session_key.as_mut_ptr()) != ERROR_SUCCESS {
            return Vec::new();
        }

        let mut file_ptr = wide.as_ptr();
        if RmRegisterResources(
            session,
            1,
            &mut file_ptr,
            0,
            ptr::null(),
            0,
            ptr::null(),
        ) != ERROR_SUCCESS
        {
            let _ = RmEndSession(session);
            return Vec::new();
        }

        let mut needed = 0u32;
        let mut count = 0u32;
        let mut reboot = 0u32;

        let mut rc = RmGetList(
            session,
            &mut needed,
            &mut count,
            ptr::null_mut(),
            &mut reboot,
        );
        if rc != ERROR_SUCCESS && rc != ERROR_MORE_DATA {
            let _ = RmEndSession(session);
            return Vec::new();
        }
        if needed == 0 {
            let _ = RmEndSession(session);
            return Vec::new();
        }

        count = needed;
        let mut infos: Vec<RM_PROCESS_INFO> = vec![std::mem::zeroed(); needed as usize];
        rc = RmGetList(
            session,
            &mut needed,
            &mut count,
            infos.as_mut_ptr(),
            &mut reboot,
        );
        if rc != ERROR_SUCCESS {
            let _ = RmEndSession(session);
            return Vec::new();
        }

        let mut out = Vec::new();
        for info in infos.iter().take(count as usize) {
            let name = wide_to_string(&info.strAppName);
            if info.Process.dwProcessId == 0 {
                continue;
            }
            out.push(BlockingProcess {
                pid: info.Process.dwProcessId,
                name: if name.is_empty() {
                    format!("PID {}", info.Process.dwProcessId)
                } else {
                    name
                },
            });
        }

        let _ = RmEndSession(session);
        out
    }
}

#[cfg(windows)]
fn wide_to_string(wide: &[u16; 256]) -> String {
    let len = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
    String::from_utf16_lossy(&wide[..len])
}

pub fn enrich_error_with_processes(path: &str, error: &str) -> (String, Vec<BlockingProcess>) {
    let is_lock = error.contains("被占用")
        || error.contains("拒绝访问")
        || error.contains("Sharing violation")
        || error.contains("Lock violation");
    if !is_lock {
        return (error.to_string(), Vec::new());
    }

    let processes = find_locking_processes(Path::new(path));
    if processes.is_empty() {
        return (error.to_string(), Vec::new());
    }

    let names: Vec<String> = processes
        .iter()
        .map(|p| format!("{} (PID {})", p.name, p.pid))
        .collect();
    let hint = format!("{error}；可能占用进程：{}", names.join("、"));
    (hint, processes)
}
