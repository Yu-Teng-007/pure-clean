use serde::{Deserialize, Serialize};

use crate::drives;
use crate::model::DriveInfo;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OsInfo {
    pub product_name: String,
    pub display_version: String,
    pub build: String,
    pub hostname: String,
    pub architecture: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuInfo {
    pub name: String,
    pub physical_cores: u32,
    pub logical_cores: u32,
    pub max_clock_mhz: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInfo {
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub used_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardInfo {
    pub manufacturer: String,
    pub product: String,
    pub bios_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    pub name: String,
    pub is_primary: bool,
    pub width: u32,
    pub height: u32,
    pub refresh_hz: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkAdapterInfo {
    pub name: String,
    pub description: String,
    pub adapter_type: String,
    pub mac: String,
    pub ipv4: Vec<String>,
    pub operational: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatteryInfo {
    pub present: bool,
    pub on_ac: bool,
    pub charging: bool,
    pub percent: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareInfo {
    pub os: OsInfo,
    pub cpu: CpuInfo,
    pub memory: MemoryInfo,
    pub board: BoardInfo,
    pub gpus: Vec<GpuInfo>,
    pub drives: Vec<DriveInfo>,
    pub displays: Vec<DisplayInfo>,
    pub networks: Vec<NetworkAdapterInfo>,
    pub battery: BatteryInfo,
}

pub fn collect() -> HardwareInfo {
    #[cfg(windows)]
    {
        windows_collect()
    }
    #[cfg(not(windows))]
    {
        empty_info()
    }
}

#[cfg(not(windows))]
fn empty_info() -> HardwareInfo {
    HardwareInfo {
        os: OsInfo {
            product_name: String::new(),
            display_version: String::new(),
            build: String::new(),
            hostname: String::new(),
            architecture: String::new(),
        },
        cpu: CpuInfo {
            name: String::new(),
            physical_cores: 0,
            logical_cores: 0,
            max_clock_mhz: None,
        },
        memory: MemoryInfo {
            total_bytes: 0,
            available_bytes: 0,
            used_bytes: 0,
        },
        board: BoardInfo {
            manufacturer: String::new(),
            product: String::new(),
            bios_version: String::new(),
        },
        gpus: Vec::new(),
        drives: Vec::new(),
        displays: Vec::new(),
        networks: Vec::new(),
        battery: BatteryInfo {
            present: false,
            on_ac: true,
            charging: false,
            percent: None,
        },
    }
}

#[cfg(windows)]
fn windows_collect() -> HardwareInfo {
    HardwareInfo {
        os: read_os(),
        cpu: read_cpu(),
        memory: read_memory(),
        board: read_board(),
        gpus: read_gpus(),
        drives: drives::list_drives(),
        displays: read_displays(),
        networks: read_networks(),
        battery: read_battery(),
    }
}

#[cfg(windows)]
fn reg_string(key: &winreg::RegKey, name: &str) -> String {
    key.get_value::<String, _>(name)
        .unwrap_or_default()
        .trim()
        .to_string()
}

#[cfg(windows)]
fn read_os() -> OsInfo {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let (product_name, display_version, build) =
        match hklm.open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion") {
            Ok(key) => {
                let product = reg_string(&key, "ProductName");
                let display = {
                    let v = reg_string(&key, "DisplayVersion");
                    if v.is_empty() {
                        reg_string(&key, "ReleaseId")
                    } else {
                        v
                    }
                };
                let current_build = reg_string(&key, "CurrentBuild");
                let ubr: u32 = key.get_value("UBR").unwrap_or(0);
                let build = if ubr > 0 && !current_build.is_empty() {
                    format!("{current_build}.{ubr}")
                } else {
                    current_build
                };
                (product, display, build)
            }
            Err(_) => (String::new(), String::new(), String::new()),
        };

    OsInfo {
        product_name,
        display_version,
        build,
        hostname: read_hostname(),
        architecture: read_architecture(),
    }
}

#[cfg(windows)]
fn read_hostname() -> String {
    use windows_sys::Win32::System::SystemInformation::{
        GetComputerNameExW, ComputerNamePhysicalDnsHostname,
    };

    unsafe {
        let mut size: u32 = 0;
        GetComputerNameExW(ComputerNamePhysicalDnsHostname, std::ptr::null_mut(), &mut size);
        if size == 0 {
            return String::new();
        }
        let mut buf = vec![0u16; size as usize];
        let ok = GetComputerNameExW(
            ComputerNamePhysicalDnsHostname,
            buf.as_mut_ptr(),
            &mut size,
        );
        if ok == 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..size as usize])
    }
}

#[cfg(windows)]
fn read_architecture() -> String {
    use windows_sys::Win32::System::SystemInformation::{
        GetNativeSystemInfo, PROCESSOR_ARCHITECTURE_AMD64, PROCESSOR_ARCHITECTURE_ARM,
        PROCESSOR_ARCHITECTURE_ARM64, PROCESSOR_ARCHITECTURE_INTEL, SYSTEM_INFO,
    };

    unsafe {
        let mut info: SYSTEM_INFO = std::mem::zeroed();
        GetNativeSystemInfo(&mut info);
        match info.Anonymous.Anonymous.wProcessorArchitecture {
            PROCESSOR_ARCHITECTURE_AMD64 => "x64".into(),
            PROCESSOR_ARCHITECTURE_ARM64 => "ARM64".into(),
            PROCESSOR_ARCHITECTURE_ARM => "ARM".into(),
            PROCESSOR_ARCHITECTURE_INTEL => "x86".into(),
            other => format!("unknown ({other})"),
        }
    }
}

#[cfg(windows)]
fn read_cpu() -> CpuInfo {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    use windows_sys::Win32::System::SystemInformation::{GetSystemInfo, SYSTEM_INFO};

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let (name, max_clock_mhz) =
        match hklm.open_subkey(r"HARDWARE\DESCRIPTION\System\CentralProcessor\0") {
            Ok(key) => {
                let name = reg_string(&key, "ProcessorNameString");
                let mhz: u32 = key.get_value("~MHz").unwrap_or(0);
                (name, if mhz > 0 { Some(mhz) } else { None })
            }
            Err(_) => (String::new(), None),
        };

    let logical_cores = unsafe {
        let mut info: SYSTEM_INFO = std::mem::zeroed();
        GetSystemInfo(&mut info);
        info.dwNumberOfProcessors
    };

    let physical_cores = read_physical_cores().unwrap_or(logical_cores);

    CpuInfo {
        name,
        physical_cores,
        logical_cores,
        max_clock_mhz,
    }
}

#[cfg(windows)]
fn read_physical_cores() -> Option<u32> {
    use windows_sys::Win32::System::SystemInformation::{
        GetLogicalProcessorInformationEx, RelationProcessorCore,
        SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX,
    };

    unsafe {
        let mut size: u32 = 0;
        GetLogicalProcessorInformationEx(RelationProcessorCore, std::ptr::null_mut(), &mut size);
        if size == 0 {
            return None;
        }
        let mut buf = vec![0u8; size as usize];
        let ok = GetLogicalProcessorInformationEx(
            RelationProcessorCore,
            buf.as_mut_ptr() as *mut SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX,
            &mut size,
        );
        if ok == 0 {
            return None;
        }

        let mut cores = 0u32;
        let mut offset = 0usize;
        while offset + std::mem::size_of::<u32>() * 2 <= size as usize {
            let info = &*(buf.as_ptr().add(offset) as *const SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX);
            if info.Relationship == RelationProcessorCore {
                cores += 1;
            }
            let step = info.Size as usize;
            if step == 0 {
                break;
            }
            offset += step;
        }
        if cores > 0 {
            Some(cores)
        } else {
            None
        }
    }
}

#[cfg(windows)]
fn read_memory() -> MemoryInfo {
    use windows_sys::Win32::System::SystemInformation::{
        GlobalMemoryStatusEx, MEMORYSTATUSEX,
    };

    unsafe {
        let mut status: MEMORYSTATUSEX = std::mem::zeroed();
        status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        if GlobalMemoryStatusEx(&mut status) == 0 {
            return MemoryInfo {
                total_bytes: 0,
                available_bytes: 0,
                used_bytes: 0,
            };
        }
        let total = status.ullTotalPhys;
        let available = status.ullAvailPhys;
        MemoryInfo {
            total_bytes: total,
            available_bytes: available,
            used_bytes: total.saturating_sub(available),
        }
    }
}

#[cfg(windows)]
fn read_board() -> BoardInfo {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let (manufacturer, product) =
        match hklm.open_subkey(r"SYSTEM\CurrentControlSet\Control\SystemInformation") {
            Ok(key) => (
                reg_string(&key, "SystemManufacturer"),
                reg_string(&key, "SystemProductName"),
            ),
            Err(_) => (String::new(), String::new()),
        };

    let bios_version = match hklm.open_subkey(r"HARDWARE\DESCRIPTION\System\BIOS") {
        Ok(key) => {
            let v = reg_string(&key, "BIOSVersion");
            if v.is_empty() {
                reg_string(&key, "SystemBiosVersion")
            } else {
                v
            }
        }
        Err(_) => String::new(),
    };

    BoardInfo {
        manufacturer,
        product,
        bios_version,
    }
}

#[cfg(windows)]
fn wide_to_string(buf: &[u16]) -> String {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len]).trim().to_string()
}

#[cfg(windows)]
fn read_gpus() -> Vec<GpuInfo> {
    use windows_sys::Win32::Graphics::Gdi::{
        EnumDisplayDevicesW, DISPLAY_DEVICEW, DISPLAY_DEVICE_ACTIVE, DISPLAY_DEVICE_MIRRORING_DRIVER,
    };

    let mut gpus = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut i = 0u32;

    unsafe {
        loop {
            let mut device: DISPLAY_DEVICEW = std::mem::zeroed();
            device.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
            let ok = EnumDisplayDevicesW(std::ptr::null(), i, &mut device, 0);
            if ok == 0 {
                break;
            }
            i += 1;

            let flags = device.StateFlags;
            if flags & DISPLAY_DEVICE_MIRRORING_DRIVER != 0 {
                continue;
            }
            if flags & DISPLAY_DEVICE_ACTIVE == 0 {
                continue;
            }

            let name = wide_to_string(&device.DeviceString);
            if name.is_empty() || !seen.insert(name.clone()) {
                continue;
            }
            gpus.push(GpuInfo { name });
        }
    }
    gpus
}

#[cfg(windows)]
fn read_displays() -> Vec<DisplayInfo> {
    use windows_sys::Win32::Graphics::Gdi::{
        EnumDisplayDevicesW, EnumDisplaySettingsW, DISPLAY_DEVICEW, DISPLAY_DEVICE_ACTIVE,
        DISPLAY_DEVICE_ATTACHED_TO_DESKTOP, DISPLAY_DEVICE_MIRRORING_DRIVER,
        DISPLAY_DEVICE_PRIMARY_DEVICE, DEVMODEW, ENUM_CURRENT_SETTINGS,
    };

    let mut displays = Vec::new();
    let mut adapter_idx = 0u32;

    unsafe {
        loop {
            let mut adapter: DISPLAY_DEVICEW = std::mem::zeroed();
            adapter.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
            if EnumDisplayDevicesW(std::ptr::null(), adapter_idx, &mut adapter, 0) == 0 {
                break;
            }
            adapter_idx += 1;

            if adapter.StateFlags & DISPLAY_DEVICE_MIRRORING_DRIVER != 0 {
                continue;
            }
            if adapter.StateFlags & DISPLAY_DEVICE_ATTACHED_TO_DESKTOP == 0 {
                continue;
            }

            let mut monitor_idx = 0u32;
            loop {
                let mut monitor: DISPLAY_DEVICEW = std::mem::zeroed();
                monitor.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
                if EnumDisplayDevicesW(adapter.DeviceName.as_ptr(), monitor_idx, &mut monitor, 0)
                    == 0
                {
                    break;
                }
                monitor_idx += 1;

                if monitor.StateFlags & DISPLAY_DEVICE_ACTIVE == 0 {
                    continue;
                }

                let mut mode: DEVMODEW = std::mem::zeroed();
                mode.dmSize = std::mem::size_of::<DEVMODEW>() as u16;
                let (width, height, refresh_hz) =
                    if EnumDisplaySettingsW(adapter.DeviceName.as_ptr(), ENUM_CURRENT_SETTINGS, &mut mode)
                        != 0
                    {
                        let hz = mode.dmDisplayFrequency;
                        (
                            mode.dmPelsWidth,
                            mode.dmPelsHeight,
                            if hz > 1 { Some(hz) } else { None },
                        )
                    } else {
                        (0, 0, None)
                    };

                let name = {
                    let n = wide_to_string(&monitor.DeviceString);
                    if n.is_empty() {
                        wide_to_string(&adapter.DeviceString)
                    } else {
                        n
                    }
                };

                displays.push(DisplayInfo {
                    name,
                    is_primary: monitor.StateFlags & DISPLAY_DEVICE_PRIMARY_DEVICE != 0
                        || adapter.StateFlags & DISPLAY_DEVICE_PRIMARY_DEVICE != 0,
                    width,
                    height,
                    refresh_hz,
                });
            }
        }
    }
    displays
}

#[cfg(windows)]
fn read_networks() -> Vec<NetworkAdapterInfo> {
    use windows_sys::Win32::Networking::WinSock::AF_UNSPEC;
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        GetAdaptersAddresses, GAA_FLAG_INCLUDE_PREFIX, IF_TYPE_ETHERNET_CSMACD,
        IF_TYPE_IEEE80211, IF_TYPE_SOFTWARE_LOOPBACK, IP_ADAPTER_ADDRESSES_LH,
    };
    use windows_sys::Win32::NetworkManagement::Ndis::IfOperStatusUp;

    unsafe {
        let mut size: u32 = 0;
        let flags = GAA_FLAG_INCLUDE_PREFIX;
        GetAdaptersAddresses(
            AF_UNSPEC as u32,
            flags,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut size,
        );
        if size == 0 {
            return Vec::new();
        }

        let mut buf = vec![0u8; size as usize];
        let head = buf.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH;
        let err = GetAdaptersAddresses(
            AF_UNSPEC as u32,
            flags,
            std::ptr::null_mut(),
            head,
            &mut size,
        );
        if err != 0 {
            return Vec::new();
        }

        let mut out = Vec::new();
        let mut cur = head;
        while !cur.is_null() {
            let adapter = &*cur;

            if adapter.IfType == IF_TYPE_SOFTWARE_LOOPBACK {
                cur = adapter.Next;
                continue;
            }

            let name = {
                let friendly = adapter.FriendlyName;
                if friendly.is_null() {
                    String::new()
                } else {
                    wide_cstr(friendly)
                }
            };
            let description = {
                let desc = adapter.Description;
                if desc.is_null() {
                    String::new()
                } else {
                    wide_cstr(desc)
                }
            };

            let adapter_type = match adapter.IfType {
                IF_TYPE_ETHERNET_CSMACD => "以太网".into(),
                IF_TYPE_IEEE80211 => "无线".into(),
                other => format!("类型 {other}"),
            };

            let mac = if adapter.PhysicalAddressLength > 0 {
                let len = adapter.PhysicalAddressLength as usize;
                adapter.PhysicalAddress[..len]
                    .iter()
                    .map(|b| format!("{b:02X}"))
                    .collect::<Vec<_>>()
                    .join(":")
            } else {
                String::new()
            };

            let ipv4 = collect_ipv4(adapter.FirstUnicastAddress);
            let operational = adapter.OperStatus == IfOperStatusUp;

            if !name.is_empty() || !description.is_empty() {
                out.push(NetworkAdapterInfo {
                    name,
                    description,
                    adapter_type,
                    mac,
                    ipv4,
                    operational,
                });
            }

            cur = adapter.Next;
        }
        out
    }
}

#[cfg(windows)]
unsafe fn wide_cstr(ptr: *mut u16) -> String {
    if ptr.is_null() {
        return String::new();
    }
    let mut len = 0usize;
    while *ptr.add(len) != 0 {
        len += 1;
        if len > 512 {
            break;
        }
    }
    String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len))
        .trim()
        .to_string()
}

#[cfg(windows)]
unsafe fn collect_ipv4(
    mut addr: *mut windows_sys::Win32::NetworkManagement::IpHelper::IP_ADAPTER_UNICAST_ADDRESS_LH,
) -> Vec<String> {
    use windows_sys::Win32::Networking::WinSock::{AF_INET, SOCKADDR_IN};

    let mut ips = Vec::new();
    while !addr.is_null() {
        let ua = &*addr;
        if !ua.Address.lpSockaddr.is_null() {
            let sa = &*ua.Address.lpSockaddr;
            if sa.sa_family == AF_INET as u16 {
                let sin = &*(ua.Address.lpSockaddr as *const SOCKADDR_IN);
                let octets = sin.sin_addr.S_un.S_un_b;
                let ip = format!(
                    "{}.{}.{}.{}",
                    octets.s_b1, octets.s_b2, octets.s_b3, octets.s_b4
                );
                if !ip.starts_with("169.254.") {
                    ips.push(ip);
                }
            }
        }
        addr = ua.Next;
    }
    ips
}

#[cfg(windows)]
fn read_battery() -> BatteryInfo {
    use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

    unsafe {
        let mut status: SYSTEM_POWER_STATUS = std::mem::zeroed();
        if GetSystemPowerStatus(&mut status) == 0 {
            return BatteryInfo {
                present: false,
                on_ac: true,
                charging: false,
                percent: None,
            };
        }

        // BatteryFlag bit 7 (128) = no system battery
        let present = status.BatteryFlag & 128 == 0 && status.BatteryLifePercent != 255;
        let on_ac = status.ACLineStatus == 1;
        let charging = status.BatteryFlag & 8 != 0;
        let percent = if present && status.BatteryLifePercent <= 100 {
            Some(status.BatteryLifePercent)
        } else {
            None
        };

        BatteryInfo {
            present,
            on_ac,
            charging,
            percent,
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn collect_smoke() {
        let info = collect();
        assert!(
            !info.os.product_name.is_empty()
                || !info.cpu.name.is_empty()
                || info.memory.total_bytes > 0,
            "expected at least one hardware field"
        );
        assert!(info.memory.used_bytes <= info.memory.total_bytes);
    }
}
