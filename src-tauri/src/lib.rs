use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use sysinfo::{
    Components, CpuRefreshKind, Disks, MemoryRefreshKind, Networks, RefreshKind, System,
};
#[cfg(windows)]
mod win;

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewWindow,
};

const WIDGET_WIDTH: f64 = 390.0;
const EDGE_MARGIN: f64 = 16.0;
// Disk space and temperature change slowly; querying them every second is wasted work.
const DISK_REFRESH: Duration = Duration::from_secs(10);
const TEMP_REFRESH: Duration = Duration::from_secs(2);
// Plausible sensor range; anything outside is a bogus reading.
pub(crate) const TEMP_RANGE: std::ops::RangeInclusive<f32> = 15.0..=115.0;

#[derive(Debug, Serialize, Clone)]
pub struct DiskStats {
    pub mount_point: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub usage_percent: f32,
}

#[derive(Debug, Serialize, Clone)]
pub struct SystemStats {
    pub cpu_usage: f32,
    /// `None` when no sensor is readable.
    pub cpu_temp: Option<f32>,
    pub cpu_brand: String,
    pub ram_used_bytes: u64,
    pub ram_total_bytes: u64,
    pub ram_percent: f32,
    pub ram_temp: Option<f32>,
    pub disks: Vec<DiskStats>,
    pub net_rx_bytes_per_sec: f64,
    pub net_tx_bytes_per_sec: f64,
}

struct Sampler {
    sys: System,
    networks: Networks,
    #[cfg(windows)]
    thermal: Option<win::ThermalZone>,
    /// sysinfo sensors, only used when the platform-specific source gives nothing. Created
    /// lazily because on Windows it goes through WMI (and needs admin rights to return data).
    components: Option<Components>,
    last_net: Instant,
    disks: Vec<DiskStats>,
    last_disk: Option<Instant>,
    cpu_temp: Option<f32>,
    ram_temp: Option<f32>,
    last_temp: Option<Instant>,
}

impl Sampler {
    fn new() -> Self {
        let sys = System::new_with_specifics(
            RefreshKind::nothing()
                .with_cpu(CpuRefreshKind::nothing().with_cpu_usage())
                .with_memory(MemoryRefreshKind::nothing().with_ram()),
        );
        Self {
            sys,
            networks: Networks::new_with_refreshed_list(),
            #[cfg(windows)]
            thermal: win::ThermalZone::open(),
            components: None,
            last_net: Instant::now(),
            disks: Vec::new(),
            last_disk: None,
            cpu_temp: None,
            ram_temp: None,
            last_temp: None,
        }
    }

    fn sample(&mut self) -> SystemStats {
        self.sys.refresh_cpu_usage();
        self.sys.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());

        let ram_total = self.sys.total_memory();
        let ram_used = self.sys.used_memory();
        let ram_percent = if ram_total > 0 {
            ram_used as f32 / ram_total as f32 * 100.0
        } else {
            0.0
        };

        let (rx, tx) = self.network_speed();

        if is_due(self.last_disk, DISK_REFRESH) {
            self.disks = read_disks();
            self.last_disk = Some(Instant::now());
        }

        if is_due(self.last_temp, TEMP_REFRESH) {
            (self.cpu_temp, self.ram_temp) = self.read_temps();
            self.last_temp = Some(Instant::now());
        }

        SystemStats {
            cpu_usage: self.sys.global_cpu_usage(),
            cpu_temp: self.cpu_temp,
            cpu_brand: self
                .sys
                .cpus()
                .first()
                .map(|c| c.brand().trim().to_string())
                .unwrap_or_default(),
            ram_used_bytes: ram_used,
            ram_total_bytes: ram_total,
            ram_percent,
            ram_temp: self.ram_temp,
            disks: self.disks.clone(),
            net_rx_bytes_per_sec: rx,
            net_tx_bytes_per_sec: tx,
        }
    }

    fn read_temps(&mut self) -> (Option<f32>, Option<f32>) {
        #[cfg(windows)]
        if let Some(t) = self.thermal.as_ref().and_then(|z| z.read_celsius()) {
            return (Some(t), None);
        }
        let components = self.components.get_or_insert_with(Components::new_with_refreshed_list);
        components.refresh(true);
        read_temps(components)
    }

    /// Bytes/s since the previous call. `received()` / `transmitted()` already hold the
    /// delta since the last refresh, so no running totals are needed.
    fn network_speed(&mut self) -> (f64, f64) {
        self.networks.refresh(true);
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_net).as_secs_f64();
        self.last_net = now;
        if elapsed < 0.05 {
            return (0.0, 0.0);
        }

        let (mut rx, mut tx) = (0u64, 0u64);
        for (name, data) in self.networks.iter() {
            if name.to_lowercase().contains("loopback") {
                continue;
            }
            rx += data.received();
            tx += data.transmitted();
        }
        (rx as f64 / elapsed, tx as f64 / elapsed)
    }
}

fn is_due(last: Option<Instant>, every: Duration) -> bool {
    last.is_none_or(|t| t.elapsed() >= every)
}

fn read_disks() -> Vec<DiskStats> {
    let disks = Disks::new_with_refreshed_list();
    let mut out: Vec<DiskStats> = disks
        .iter()
        .filter(|d| d.total_space() > 0)
        .map(|d| {
            let total = d.total_space();
            let used = total.saturating_sub(d.available_space());
            DiskStats {
                mount_point: d.mount_point().to_string_lossy().trim_end_matches('\\').to_string(),
                total_bytes: total,
                used_bytes: used,
                usage_percent: used as f32 / total as f32 * 100.0,
            }
        })
        .collect();
    out.sort_by(|a, b| a.mount_point.cmp(&b.mount_point));
    out.dedup_by(|a, b| a.mount_point == b.mount_point);
    out
}

/// Returns (cpu, ram) temperatures from sysinfo sensors. Labels differ per platform/driver,
/// so match on keywords; an unlabeled zone (e.g. ACPI) is used as a CPU fallback.
fn read_temps(components: &Components) -> (Option<f32>, Option<f32>) {
    const RAM_KEYS: [&str; 4] = ["dimm", "memory", "spd", "ddr"];
    const CPU_KEYS: [&str; 7] = ["cpu", "core", "package", "tdie", "tctl", "k10temp", "coretemp"];

    let (mut cpu, mut ram, mut other): (Option<f32>, Option<f32>, Option<f32>) = (None, None, None);
    for comp in components.iter() {
        let Some(t) = comp.temperature().filter(|t| TEMP_RANGE.contains(t)) else {
            continue;
        };
        let label = comp.label().to_lowercase();
        let slot = if RAM_KEYS.iter().any(|k| label.contains(k)) {
            &mut ram
        } else if CPU_KEYS.iter().any(|k| label.contains(k)) {
            &mut cpu
        } else {
            &mut other
        };
        *slot = Some(slot.map_or(t, |v| v.max(t)));
    }
    (cpu.or(other), ram)
}

#[tauri::command]
async fn get_system_stats(
    state: tauri::State<'_, Mutex<Option<Sampler>>>,
) -> Result<SystemStats, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    // Created lazily on this worker thread: sysinfo initializes COM (multithreaded) for its
    // WMI queries, and doing that on the main thread makes the window's OleInitialize fail.
    Ok(guard.get_or_insert_with(Sampler::new).sample())
}

/// Resizes the window to fit the content height reported by the frontend, keeping the
/// current position but pulling the window back inside the screen if it would overflow.
#[tauri::command]
fn resize_widget(window: WebviewWindow, height: f64) -> Result<(), String> {
    let height = height.clamp(40.0, 1200.0);
    window
        .set_size(LogicalSize::new(WIDGET_WIDTH, height))
        .map_err(|e| e.to_string())?;

    let (Ok(pos), Ok(Some(monitor))) = (window.outer_position(), window.current_monitor()) else {
        return Ok(());
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let (w, h) = ((WIDGET_WIDTH * scale) as i32, (height * scale) as i32);
    let max_x = area.position.x + area.size.width as i32 - w;
    let max_y = area.position.y + area.size.height as i32 - h;
    let x = pos.x.min(max_x).max(area.position.x);
    let y = pos.y.min(max_y).max(area.position.y);
    if (x, y) != (pos.x, pos.y) {
        window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn move_to_top_right(window: &WebviewWindow) {
    let Ok(Some(monitor)) = window
        .current_monitor()
        .and_then(|m| if m.is_some() { Ok(m) } else { window.primary_monitor() })
    else {
        return;
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let margin = (EDGE_MARGIN * scale) as i32;
    let x = area.position.x + area.size.width as i32 - (WIDGET_WIDTH * scale) as i32 - margin;
    let y = area.position.y + margin;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

fn show_widget(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        let _ = w.show();
        let _ = w.unminimize();
    }
}

fn toggle_widget(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            show_widget(app);
        }
    }
}

#[cfg(windows)]
use win::{autostart_enabled, set_autostart};
#[cfg(not(windows))]
fn autostart_enabled() -> bool {
    false
}
#[cfg(not(windows))]
fn set_autostart(_: bool) -> bool {
    false
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Ẩn / Hiện widget", true, None::<&str>)?;
    let on_top = CheckMenuItem::with_id(app, "on_top", "Luôn ở trên cùng", true, true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "Khởi động cùng Windows",
        cfg!(windows),
        autostart_enabled(),
        None::<&str>,
    )?;
    let reset = MenuItem::with_id(app, "reset_pos", "Đưa về góc trên bên phải", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Thoát", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&toggle, &on_top, &autostart, &reset, &PredefinedMenuItem::separator(app)?, &quit],
    )?;

    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("AeroPulse Widget")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "toggle" => toggle_widget(app),
            "on_top" => {
                if let Some(w) = main_window(app) {
                    let _ = w.set_always_on_top(on_top.is_checked().unwrap_or(true));
                }
            }
            "autostart" => {
                let want = autostart.is_checked().unwrap_or(false);
                if !set_autostart(want) {
                    let _ = autostart.set_checked(!want);
                }
            }
            "reset_pos" => {
                if let Some(w) = main_window(app) {
                    move_to_top_right(&w);
                    show_widget(app);
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_widget(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Launching the app a second time just brings the existing widget back.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_widget(app);
        }))
        .manage(Mutex::new(None::<Sampler>))
        .setup(|app| {
            #[cfg(windows)]
            win::refresh_autostart_path();
            build_tray(app)?;
            if let Some(window) = app.get_webview_window("main") {
                move_to_top_right(&window);
                window.show()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_system_stats, resize_widget])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
