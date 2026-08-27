/// Windows 管理员权限检测与 UAC 提权重启。

#[cfg(windows)]
pub fn is_elevated() -> bool {
    use windows_sys::Win32::UI::Shell::IsUserAnAdmin;
    unsafe { IsUserAnAdmin() != 0 }
}

#[cfg(not(windows))]
pub fn is_elevated() -> bool {
    false
}

#[cfg(windows)]
pub fn restart_as_admin() -> Result<(), String> {
    use std::ffi::OsStr;
    use std::ptr::null_mut;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOW;

    if is_elevated() {
        return Err("当前已以管理员身份运行".into());
    }

    let exe = std::env::current_exe().map_err(|e| format!("无法定位程序路径: {e}"))?;
    let exe_wide = wide(exe.as_os_str());
    let op_wide = wide(OsStr::new("runas"));

    let result = unsafe {
        ShellExecuteW(
            null_mut(),
            op_wide.as_ptr(),
            exe_wide.as_ptr(),
            null_mut(),
            null_mut(),
            SW_SHOW,
        )
    };

    // ShellExecuteW 返回值 > 32 表示成功启动
    if result as isize <= 32 {
        return Err(format!(
            "提权启动失败 (code {})，请手动右键「以管理员身份运行」",
            result as isize
        ));
    }

    std::process::exit(0);
}

#[cfg(not(windows))]
pub fn restart_as_admin() -> Result<(), String> {
    Err("仅 Windows 支持管理员提权".into())
}

#[cfg(windows)]
fn wide(s: &std::ffi::OsStr) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    s.encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_elevated_returns_bool() {
        let _ = is_elevated();
    }
}
