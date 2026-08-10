//! Extract Windows shell icons as PNG data URLs for startup items.

use std::fs;
use std::path::{Path, PathBuf};
use std::ptr;

use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC, SelectObject,
    BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
};
use windows_sys::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, DrawIconEx, DI_NORMAL, HICON,
};

const ICON_SIZE: i32 = 32;

/// Parse the leading executable / file path from a Run command line.
pub fn path_from_command(command: &str) -> Option<PathBuf> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path = if trimmed.starts_with('"') {
        let rest = &trimmed[1..];
        let end = rest.find('"')?;
        rest[..end].to_string()
    } else {
        trimmed
            .split_whitespace()
            .next()
            .unwrap_or(trimmed)
            .to_string()
    };
    let path = path.trim();
    if path.is_empty() {
        return None;
    }
    Some(PathBuf::from(path))
}

fn to_wide(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// If path ends with `.pcoff`, copy to a temp file with the original extension so Shell can resolve the icon.
fn materialize_for_icon(path: &Path) -> Option<(PathBuf, Option<PathBuf>)> {
    let name = path.file_name()?.to_string_lossy();
    let lower = name.to_ascii_lowercase();
    if !lower.ends_with(".pcoff") {
        return Some((path.to_path_buf(), None));
    }
    let stem = &name[..name.len() - ".pcoff".len()];
    if stem.is_empty() {
        return None;
    }
    let temp_dir = std::env::temp_dir().join("pure-clean-icons");
    let _ = fs::create_dir_all(&temp_dir);
    let temp = temp_dir.join(format!("{}_{stem}", std::process::id()));
    fs::copy(path, &temp).ok()?;
    Some((temp.clone(), Some(temp)))
}

fn hicon_to_png_data_url(hicon: HICON) -> Option<String> {
    unsafe {
        let hdc_screen = GetDC(0 as HWND);
        if hdc_screen.is_null() {
            return None;
        }
        let hdc_mem = CreateCompatibleDC(hdc_screen);
        if hdc_mem.is_null() {
            ReleaseDC(0 as HWND, hdc_screen);
            return None;
        }

        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: ICON_SIZE,
                biHeight: -ICON_SIZE, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB as u32,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [std::mem::zeroed()],
        };

        let mut bits: *mut core::ffi::c_void = ptr::null_mut();
        let hbmp = CreateDIBSection(
            hdc_mem,
            &bmi,
            DIB_RGB_COLORS,
            &mut bits,
            ptr::null_mut(),
            0,
        );
        if hbmp.is_null() || bits.is_null() {
            DeleteDC(hdc_mem);
            ReleaseDC(0 as HWND, hdc_screen);
            return None;
        }

        let old = SelectObject(hdc_mem, hbmp as HGDIOBJ);

        let pixel_count = (ICON_SIZE * ICON_SIZE) as usize;
        let pixels = std::slice::from_raw_parts_mut(bits as *mut u8, pixel_count * 4);
        pixels.fill(0);

        let ok = DrawIconEx(
            hdc_mem,
            0,
            0,
            hicon,
            ICON_SIZE,
            ICON_SIZE,
            0,
            ptr::null_mut(),
            DI_NORMAL,
        );

        // Copy before freeing the DIB
        let mut rgba = Vec::with_capacity(pixel_count * 4);
        for chunk in pixels.chunks_exact(4) {
            rgba.extend_from_slice(&[chunk[2], chunk[1], chunk[0], chunk[3]]); // BGRA → RGBA
        }

        SelectObject(hdc_mem, old);
        DeleteObject(hbmp as HGDIOBJ);
        DeleteDC(hdc_mem);
        ReleaseDC(0 as HWND, hdc_screen);

        if ok == 0 {
            return None;
        }

        let mut png_bytes = Vec::new();
        {
            let mut encoder =
                png::Encoder::new(&mut png_bytes, ICON_SIZE as u32, ICON_SIZE as u32);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().ok()?;
            writer.write_image_data(&rgba).ok()?;
        }

        Some(format!("data:image/png;base64,{}", base64_encode(&png_bytes)))
    }
}

fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let a = chunk[0] as u32;
        let b = chunk.get(1).copied().unwrap_or(0) as u32;
        let c = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (a << 16) | (b << 8) | c;
        out.push(TABLE[((triple >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

pub fn icon_data_url_for_path(path: &Path) -> Option<String> {
    if !path.exists() {
        return None;
    }
    let (query_path, temp) = materialize_for_icon(path)?;
    let result = unsafe {
        let wide = to_wide(&query_path);
        let mut info: SHFILEINFOW = std::mem::zeroed();
        let flags = SHGFI_ICON | SHGFI_LARGEICON;
        let hr = SHGetFileInfoW(
            wide.as_ptr(),
            0,
            &mut info,
            std::mem::size_of::<SHFILEINFOW>() as u32,
            flags,
        );
        if hr == 0 || info.hIcon.is_null() {
            None
        } else {
            let url = hicon_to_png_data_url(info.hIcon);
            DestroyIcon(info.hIcon);
            url
        }
    };
    if let Some(t) = temp {
        let _ = fs::remove_file(t);
    }
    result
}

pub fn icon_data_url_for_command(command: &str) -> Option<String> {
    let path = path_from_command(command)?;
    icon_data_url_for_path(&path)
}
