//! Floe for Linux and Windows: the same top-of-screen island as the Mac app, as a Tauri window.
//!
//! The Rust side owns the window (where it sits, its size, who has the keyboard), the global
//! hotkey, the tray, launch at login, and the proxy it keeps running. Everything you see is the
//! web UI in `../src`, which talks to the proxy over HTTP.

mod config;
mod focus;
mod log;
mod paths;
mod proxy;
mod shortcut;

use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;

/// Where the island sits along the top edge, and its current size (logical pixels).
#[derive(Default)]
struct Geometry {
    anchor: Mutex<Option<f64>>,
    size: Mutex<(f64, f64)>,
    drag_from: Mutex<Option<f64>>,
    shown: Mutex<bool>,
}

#[derive(Default)]
struct Hotkey {
    spec: Mutex<String>,
    error: Mutex<Option<String>>,
}

struct Screen {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

fn screen(win: &WebviewWindow) -> Screen {
    let m = win.primary_monitor().ok().flatten().or_else(|| win.current_monitor().ok().flatten());
    match m {
        Some(m) => {
            let s = m.scale_factor();
            let p = m.position().to_logical::<f64>(s);
            let z = m.size().to_logical::<f64>(s);
            Screen { x: p.x, y: p.y, w: z.width, h: z.height }
        }
        None => Screen { x: 0.0, y: 0.0, w: 1440.0, h: 900.0 },
    }
}

fn center_of(geo: &Geometry, s: &Screen) -> f64 {
    let anchor = geo.anchor.lock().ok().and_then(|a| *a).unwrap_or(0.5);
    s.x + anchor * s.w
}

/// Put the window at its anchor along the top edge with the given size, keeping it on screen.
fn place(win: &WebviewWindow, geo: &Geometry, w: f64, h: f64, center: Option<f64>) {
    let s = screen(win);
    let c = center.unwrap_or_else(|| center_of(geo, &s));
    let x = (c - w / 2.0).clamp(s.x, (s.x + s.w - w).max(s.x));
    // Linux: a non-resizable GTK window takes the webview's natural size, which is the page, which
    // fills the window, so it can grow but never shrink. The window is resizable there instead,
    // with its min and max pinned to the island so the window manager still can't resize it.
    #[cfg(target_os = "linux")]
    {
        let _ = win.set_min_size(Some(LogicalSize::new(w, h)));
        let _ = win.set_max_size(Some(LogicalSize::new(w, h)));
    }
    let _ = win.set_size(LogicalSize::new(w, h));
    let _ = win.set_position(LogicalPosition::new(x.round(), s.y));
    if let Ok(mut z) = geo.size.lock() {
        *z = (w, h);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Boot {
    port: u16,
    hotkey: String,
    hotkey_error: Option<String>,
    version: String,
    platform: &'static str,
    screen_width: f64,
    screen_height: f64,
    proxy: Option<proxy::ProxyState>,
    logs_dir: String,
    /// `FLOE_OPEN=live|hosts|ask|settings`: open on that tab at start (testing, screenshots).
    open: Option<String>,
    /// Wayland: the hotkey needs a desktop shortcut that runs `floe --toggle`.
    hotkey_help: shortcut::HotkeyHelp,
}

#[tauri::command]
fn boot(app: AppHandle, win: WebviewWindow) -> Boot {
    let cfg = config::load();
    let s = screen(&win);
    let hk = app.state::<Hotkey>();
    let hotkey = hk.spec.lock().map(|s| s.clone()).unwrap_or_default();
    let hotkey_error = hk.error.lock().ok().and_then(|e| e.clone());
    Boot {
        port: cfg.port,
        hotkey,
        hotkey_error,
        version: app.package_info().version.to_string(),
        platform: if cfg!(windows) {
            "windows"
        } else if cfg!(target_os = "macos") {
            "macos"
        } else {
            "linux"
        },
        screen_width: s.w,
        screen_height: s.h,
        proxy: app.state::<Arc<proxy::Supervisor>>().snapshot(),
        logs_dir: paths::logs_dir().display().to_string(),
        open: std::env::var("FLOE_OPEN").ok().filter(|v| !v.is_empty()),
        hotkey_help: shortcut::help(&cfg.hotkey),
    }
}

/// GNOME on Wayland: add the desktop shortcut for the hotkey (`free` takes the key back from
/// GNOME's own use of it, such as Alt+Space for the window menu).
#[tauri::command]
fn gnome_shortcut(free: bool) -> Result<shortcut::HotkeyHelp, String> {
    let cfg = config::load();
    let res = shortcut::bind_gnome(&cfg.hotkey, free);
    match &res {
        Ok(_) => log::line(&format!("GNOME shortcut {} → {}{}", cfg.hotkey, shortcut::command(), if free { " (taken from GNOME)" } else { "" })),
        Err(e) => log::line(&format!("couldn't add the GNOME shortcut: {e}")),
    }
    res
}

/// The UI asks for a size (pill, peek, panel); the window keeps its centre and shows itself the
/// first time, so it never flashes at the screen's corner.
#[tauri::command]
fn layout(win: WebviewWindow, geo: tauri::State<Geometry>, width: f64, height: f64) {
    place(&win, &geo, width, height, None);
    let first = geo.shown.lock().map(|mut s| !std::mem::replace(&mut *s, true)).unwrap_or(false);
    if first {
        let _ = win.show();
    }
}

#[tauri::command]
fn drag_begin(win: WebviewWindow, geo: tauri::State<Geometry>) {
    let s = screen(&win);
    let c = center_of(&geo, &s);
    if let Ok(mut d) = geo.drag_from.lock() {
        *d = Some(c);
    }
}

/// Horizontal only: Floe stays pinned to the top edge.
#[tauri::command]
fn drag_move(win: WebviewWindow, geo: tauri::State<Geometry>, dx: f64) {
    let Some(from) = geo.drag_from.lock().ok().and_then(|d| *d) else { return };
    let s = screen(&win);
    let c = (from + dx).clamp(s.x + 40.0, s.x + s.w - 40.0);
    if let Ok(mut a) = geo.anchor.lock() {
        *a = Some((c - s.x) / s.w);
    }
    let (w, h) = geo.size.lock().map(|z| *z).unwrap_or((112.0, 32.0));
    place(&win, &geo, w, h, Some(c));
}

#[tauri::command]
fn drag_end(geo: tauri::State<Geometry>) {
    if let Ok(mut d) = geo.drag_from.lock() {
        *d = None;
    }
    if let Some(a) = geo.anchor.lock().ok().and_then(|a| *a) {
        config::save_anchor(a);
        log::line(&format!("drag ended, anchor {a:.4} (saved)"));
    }
}

#[tauri::command]
fn snap_center(win: WebviewWindow, geo: tauri::State<Geometry>) {
    if let Ok(mut a) = geo.anchor.lock() {
        *a = Some(0.5);
    }
    config::save_anchor(0.5);
    let (w, h) = geo.size.lock().map(|z| *z).unwrap_or((112.0, 32.0));
    place(&win, &geo, w, h, None);
}

/// Opening Floe: it takes the keyboard (remembering who had it).
#[tauri::command]
fn take_focus(win: WebviewWindow, focus: tauri::State<focus::Focus>) {
    focus.take(&win);
    log::line("panel took the keyboard");
}

/// Folding up: clicks stop activating Floe and the keyboard goes back.
#[tauri::command]
fn release_focus(win: WebviewWindow, focus: tauri::State<focus::Focus>) {
    let had = win.is_focused().unwrap_or(false);
    focus.release(&win);
    if had {
        log::line("panel gave the keyboard back");
    }
}

#[tauri::command]
fn proxy_state(sup: tauri::State<Arc<proxy::Supervisor>>) -> Option<proxy::ProxyState> {
    sup.snapshot()
}

#[tauri::command]
fn autostart_get(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn autostart_set(app: AppHandle, on: bool) -> Result<bool, String> {
    let al = app.autolaunch();
    if on { al.enable() } else { al.disable() }.map_err(|e| e.to_string())?;
    config::mark_autostart_seeded();
    log::line(&format!("launch at login {}", if on { "on" } else { "off" }));
    al.is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn open_logs(app: AppHandle) -> Result<(), String> {
    let dir = paths::logs_dir();
    let _ = std::fs::create_dir_all(&dir);
    app.opener().open_path(dir.display().to_string(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// The UI's own log lines (errors, start-up) land in app.log too.
#[tauri::command]
fn log_line(msg: String) {
    log::line(&format!("ui: {}", msg.chars().take(600).collect::<String>()));
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

fn register_hotkey(app: &AppHandle) {
    let cfg = config::load();
    let spec = config::shortcut_spec(&cfg.hotkey);
    let hk = app.state::<Hotkey>();
    if let Ok(mut s) = hk.spec.lock() {
        *s = cfg.hotkey.clone();
    }
    let err = match app.global_shortcut().register(spec.as_str()) {
        Ok(()) => {
            log::line(&format!("hotkey {} registered", cfg.hotkey));
            None
        }
        Err(e) => {
            let msg = format!("Couldn't register {}: {e}. Another app may own it; set \"hotkey\" in ~/.config/floe/config.json.", cfg.hotkey);
            log::line(&msg);
            Some(msg)
        }
    };
    let slot = hk.error.lock();
    if let Ok(mut e) = slot {
        *e = err;
    }
}

/// The Linux tray needs libayatana-appindicator (or libappindicator); without it the tray library
/// panics, so look first and run without a tray instead.
fn tray_available() -> bool {
    #[cfg(target_os = "linux")]
    {
        ["libayatana-appindicator3.so.1", "libappindicator3.so.1", "libayatana-appindicator3.so", "libappindicator3.so"]
            .iter()
            .any(|name| unsafe { libloading::Library::new(name) }.is_ok())
    }
    #[cfg(not(target_os = "linux"))]
    {
        true
    }
}

fn tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Floe", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let center = MenuItem::with_id(app, "center", "Move to Center", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Floe", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &settings, &sep, &center, &sep2, &quit])?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;
    TrayIconBuilder::with_id("floe")
        .icon(icon)
        .tooltip("Floe")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => {
                let _ = app.emit("tray", "open");
            }
            "settings" => {
                let _ = app.emit("tray", "settings");
            }
            "center" => {
                if let Some(win) = app.get_webview_window("main") {
                    snap_center(win, app.state::<Geometry>());
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

pub fn run() {
    #[cfg(target_os = "linux")]
    {
        // Wayland ignores where a window asks to be and whether it stays on top; XWayland honours
        // both. And WebKitGTK's DMA-BUF renderer draws blank windows on some NVIDIA drivers.
        if std::env::var_os("GDK_BACKEND").is_none() {
            std::env::set_var("GDK_BACKEND", "x11");
        }
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    let supervisor = Arc::new(proxy::Supervisor::default());
    let sup_for_exit = supervisor.clone();

    let app = tauri::Builder::default()
        // Starting Floe again opens the running one; `floe --toggle` (a desktop shortcut on
        // Wayland) opens or folds it like the hotkey.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if args.iter().any(|a| a == "--toggle") {
                let _ = app.emit("hotkey", ());
            } else {
                let _ = app.emit("tray", "open");
            }
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = app.emit("hotkey", ());
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::Builder::new().app_name("Floe").build())
        .plugin(tauri_plugin_opener::init())
        .manage(Geometry::default())
        .manage(Hotkey::default())
        .manage(focus::Focus::default())
        .manage(supervisor.clone())
        .invoke_handler(tauri::generate_handler![
            boot,
            layout,
            drag_begin,
            drag_move,
            drag_end,
            snap_center,
            take_focus,
            release_focus,
            proxy_state,
            autostart_get,
            autostart_set,
            open_logs,
            open_url,
            log_line,
            gnome_shortcut,
            quit
        ])
        .setup(move |app| {
            log::line(&format!("Floe {} starting", app.package_info().version));
            *app.state::<Geometry>().anchor.lock().unwrap() = config::load_anchor();

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Created hidden, unfocused and not focusable: it never takes the keyboard from a game
            // until you open it. The UI's first layout() shows it in place.
            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Floe")
                .inner_size(112.0, 32.0)
                .position(0.0, 0.0)
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .resizable(cfg!(target_os = "linux")) // see place()
                .maximizable(false)
                .minimizable(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .visible_on_all_workspaces(true)
                .focused(false)
                .focusable(false)
                .visible(false)
                .build()?;
            win.on_window_event({
                let app = app.handle().clone();
                move |e| match e {
                    WindowEvent::Focused(false) => {
                        let _ = app.emit("blur", ());
                    }
                    WindowEvent::ScaleFactorChanged { .. } => {
                        let _ = app.emit("screen", ());
                    }
                    _ => {}
                }
            });

            register_hotkey(app.handle());
            if !tray_available() {
                log::line("no tray icon: install libayatana-appindicator3-1 for one (the hotkey and the island work without it)");
            } else if let Err(e) = tray(app.handle()) {
                log::line(&format!("no tray icon: {e}"));
            }

            // Launch at login: on by default, once. Later changes in Settings stick. (Not on
            // macOS, where this is only a dev build and the Swift app is Floe.)
            if !cfg!(target_os = "macos") && !config::autostart_seeded() {
                match app.autolaunch().enable() {
                    Ok(()) => log::line("launch at login switched on (first run)"),
                    Err(e) => log::line(&format!("couldn't switch on launch at login: {e}")),
                }
                config::mark_autostart_seeded();
            }

            proxy::start(app.handle().clone(), supervisor.clone(), config::load().port);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Floe");

    app.run(move |_app, event| {
        if let RunEvent::Exit = event {
            if sup_for_exit.snapshot().map(|s| s.owned).unwrap_or(false) {
                log::line("stopping the proxy Floe started");
            }
            sup_for_exit.shutdown();
        }
    });
}
