//! Windows-only helpers: CPU temperature via PDH and "start with Windows" via the HKCU Run key.

use std::ffi::c_void;
use std::os::windows::ffi::OsStrExt;
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::ERROR_SUCCESS;
use windows_sys::Win32::System::Performance::{
    PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterArrayW,
    PdhOpenQueryW, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE, PDH_MORE_DATA,
};
use windows_sys::Win32::System::Registry::{
    RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_SZ,
};

fn wide(s: &str) -> Vec<u16> {
    std::ffi::OsStr::new(s).encode_wide().chain(Some(0)).collect()
}

/// Reads the ACPI thermal zone through the "Thermal Zone Information" performance counter.
/// Unlike the MSAcpi_ThermalZoneTemperature WMI class (which sysinfo uses), the counter is
/// readable without admin rights. On laptops the zone follows the CPU package temperature.
pub struct ThermalZone {
    query: *mut c_void,
    counter: *mut c_void,
}

// The PDH handles are only used behind the sampler's Mutex, one thread at a time.
unsafe impl Send for ThermalZone {}

impl ThermalZone {
    pub fn open() -> Option<Self> {
        let mut query = null_mut();
        let mut counter = null_mut();
        // English counter name works on any Windows display language.
        let path = wide(r"\Thermal Zone Information(*)\High Precision Temperature");
        unsafe {
            if PdhOpenQueryW(null(), 0, &mut query) != ERROR_SUCCESS {
                return None;
            }
            if PdhAddEnglishCounterW(query, path.as_ptr(), 0, &mut counter) != ERROR_SUCCESS {
                PdhCloseQuery(query);
                return None;
            }
            Some(Self { query, counter })
        }
    }

    /// Hottest zone in °C, or `None` if nothing plausible could be read.
    pub fn read_celsius(&self) -> Option<f32> {
        unsafe {
            if PdhCollectQueryData(self.query) != ERROR_SUCCESS {
                return None;
            }
            let (mut size, mut count) = (0u32, 0u32);
            let status = PdhGetFormattedCounterArrayW(
                self.counter,
                PDH_FMT_DOUBLE,
                &mut size,
                &mut count,
                null_mut(),
            );
            if status != PDH_MORE_DATA as u32 || size == 0 {
                return None;
            }
            // Buffer holds the item array followed by the instance name strings; use u64
            // storage so the items are properly aligned.
            let mut buf = vec![0u64; (size as usize).div_ceil(8)];
            let items = buf.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
            if PdhGetFormattedCounterArrayW(
                self.counter,
                PDH_FMT_DOUBLE,
                &mut size,
                &mut count,
                items,
            ) != ERROR_SUCCESS
            {
                return None;
            }
            std::slice::from_raw_parts(items, count as usize)
                .iter()
                .filter(|it| it.FmtValue.CStatus == ERROR_SUCCESS)
                // Value is in tenths of a Kelvin
                .map(|it| (it.FmtValue.Anonymous.doubleValue / 10.0 - 273.15) as f32)
                .filter(|t| crate::TEMP_RANGE.contains(t))
                .reduce(f32::max)
        }
    }
}

impl Drop for ThermalZone {
    fn drop(&mut self) {
        unsafe {
            PdhCloseQuery(self.query);
        }
    }
}

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_VALUE: &str = "AeroPulseWidget";

fn current_exe_command() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    Some(format!("\"{}\"", exe.display()))
}

fn read_run_value() -> Option<String> {
    let (key, name) = (wide(RUN_KEY), wide(RUN_VALUE));
    let mut buf = [0u16; 1024];
    let mut size = (buf.len() * 2) as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_SZ,
            null_mut(),
            buf.as_mut_ptr() as *mut c_void,
            &mut size,
        )
    };
    if status != ERROR_SUCCESS {
        return None;
    }
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..len]))
}

pub fn autostart_enabled() -> bool {
    read_run_value().is_some()
}

pub fn set_autostart(enable: bool) -> bool {
    let (key, name) = (wide(RUN_KEY), wide(RUN_VALUE));
    let status = if enable {
        let Some(cmd) = current_exe_command() else {
            return false;
        };
        let data = wide(&cmd);
        unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                name.as_ptr(),
                REG_SZ,
                data.as_ptr() as *const c_void,
                (data.len() * 2) as u32,
            )
        }
    } else {
        unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr()) }
    };
    status == ERROR_SUCCESS
}

/// If autostart is on but the exe was moved or rebuilt elsewhere, point the entry at
/// the copy that is running now.
pub fn refresh_autostart_path() {
    if let (Some(stored), Some(cmd)) = (read_run_value(), current_exe_command()) {
        if !stored.eq_ignore_ascii_case(&cmd) {
            set_autostart(true);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_thermal_zone() {
        let zone = ThermalZone::open().expect("PDH query");
        let t = zone.read_celsius().expect("temperature");
        println!("thermal zone: {t:.1} °C");
    }

    #[test]
    fn autostart_roundtrip() {
        let before = autostart_enabled();
        assert!(set_autostart(true));
        assert!(autostart_enabled());
        assert!(set_autostart(false));
        assert!(!autostart_enabled());
        if before {
            set_autostart(true);
        }
    }
}
