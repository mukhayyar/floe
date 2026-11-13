//! Taking the keyboard when Floe opens from the hotkey, and handing it back to whatever was in
//! front (a game, an editor) when it folds up, like the Mac app does with NSRunningApplication.

#[cfg(any(windows, target_os = "linux"))]
use std::sync::Mutex;
use tauri::WebviewWindow;

#[derive(Default)]
pub struct Focus {
    #[cfg(windows)]
    previous: Mutex<isize>,
    #[cfg(target_os = "linux")]
    previous: Mutex<Option<u64>>,
}

impl Focus {
    /// Remember the window in front, then focus Floe.
    pub fn take(&self, window: &WebviewWindow) {
        self.remember(window);
        let _ = window.set_focusable(true);
        let _ = window.set_focus();
        // GNOME refuses focus asked for without a fresh key or click of ours (`floe --toggle` from
        // a desktop shortcut is another process); an activation request sent the way a pager
        // sends one goes through. A moment later, once the window accepts focus again.
        #[cfg(target_os = "linux")]
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_millis(80));
            if let Some(w) = x11::own_window() {
                x11::activate(w);
            }
        });
    }

    #[cfg(windows)]
    fn remember(&self, window: &WebviewWindow) {
        use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
        use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
        let fg = unsafe { GetForegroundWindow() };
        let mine = window.hwnd().map(|h| h.0 as isize).unwrap_or(0);
        // Not one of ours: the tray menu's hidden window takes the foreground before "Open Floe".
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(fg, &mut pid) };
        let fg = fg as isize;
        if fg != 0 && fg != mine && pid != std::process::id() {
            if let Ok(mut p) = self.previous.lock() {
                *p = fg;
            }
        }
    }

    #[cfg(target_os = "linux")]
    fn remember(&self, window: &WebviewWindow) {
        if self.focused(window) {
            return; // already ours: keep whoever had it before
        }
        // Whatever is in front now, or nothing (the desktop): never an old window from earlier.
        let front = x11::active_window().filter(|&w| x11::pid_of(w) != Some(std::process::id()));
        if let Ok(mut p) = self.previous.lock() {
            *p = front;
        }
    }

    #[cfg(target_os = "macos")]
    fn remember(&self, _window: &WebviewWindow) {}

    /// Fold-up: stop taking clicks as activations and give the keyboard back (unless `hand_back`
    /// is false: Floe just asked Orca to come forward, and the keyboard should go there).
    pub fn release(&self, window: &WebviewWindow, hand_back: bool) -> bool {
        let focused = self.focused(window);
        let _ = window.set_focusable(false);
        if focused && hand_back {
            self.restore(window);
        }
        focused
    }

    /// Does Floe have the keyboard? On X11 a global key grab (the hotkey itself) makes GTK report
    /// a focus loss while Floe is still the active window, so ask the window manager.
    pub fn focused(&self, window: &WebviewWindow) -> bool {
        #[cfg(target_os = "linux")]
        if let Some(w) = x11::active_window() {
            if x11::pid_of(w) == Some(std::process::id()) {
                return true;
            }
        }
        window.is_focused().unwrap_or(false)
    }

    /// Windows: let whichever app Floe asks to come forward (Orca) take the foreground; only the
    /// foreground app may grant that.
    pub fn allow_foreground(&self) {
        #[cfg(windows)]
        unsafe {
            windows_sys::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow(windows_sys::Win32::UI::WindowsAndMessaging::ASFW_ANY);
        }
    }

    #[cfg(windows)]
    fn restore(&self, _window: &WebviewWindow) {
        use windows_sys::Win32::UI::WindowsAndMessaging::{IsWindow, SetForegroundWindow};
        let prev = self.previous.lock().map(|p| *p).unwrap_or(0);
        if prev != 0 {
            unsafe {
                let h = prev as windows_sys::Win32::Foundation::HWND;
                if IsWindow(h) != 0 {
                    SetForegroundWindow(h);
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    fn restore(&self, _window: &WebviewWindow) {
        if let Some(xid) = self.previous.lock().ok().and_then(|p| *p) {
            x11::activate(xid);
        }
    }

    /// macOS is a dev target only (the Swift app is Floe there): leave focus alone.
    #[cfg(target_os = "macos")]
    fn restore(&self, _window: &WebviewWindow) {}
}

/// EWMH through Xlib (loaded at runtime, like tao does): read `_NET_ACTIVE_WINDOW`, and ask the
/// window manager to activate a window the way a pager or a click would. Floe runs on XWayland
/// under Wayland sessions (GDK_BACKEND=x11), where this reaches other X11 windows (games, most
/// Electron apps); native Wayland windows keep focus rules of their own.
#[cfg(target_os = "linux")]
mod x11 {
    use std::ffi::CString;
    use std::os::raw::{c_int, c_long, c_uchar, c_ulong};
    use std::ptr;
    use x11_dl::xlib;

    fn with_display<T>(f: impl FnOnce(&xlib::Xlib, *mut xlib::Display) -> Option<T>) -> Option<T> {
        let xl = xlib::Xlib::open().ok()?;
        unsafe {
            let dpy = (xl.XOpenDisplay)(ptr::null());
            if dpy.is_null() {
                return None;
            }
            let out = f(&xl, dpy);
            (xl.XCloseDisplay)(dpy);
            out
        }
    }

    fn atom(xl: &xlib::Xlib, dpy: *mut xlib::Display, name: &str) -> xlib::Atom {
        let n = CString::new(name).unwrap();
        unsafe { (xl.XInternAtom)(dpy, n.as_ptr(), xlib::False) }
    }

    pub fn active_window() -> Option<u64> {
        with_display(|xl, dpy| unsafe {
            let root = (xl.XDefaultRootWindow)(dpy);
            let prop = atom(xl, dpy, "_NET_ACTIVE_WINDOW");
            let (mut ty, mut fmt, mut n, mut after) = (0 as xlib::Atom, 0 as c_int, 0 as c_ulong, 0 as c_ulong);
            let mut data: *mut c_uchar = ptr::null_mut();
            let ok = (xl.XGetWindowProperty)(dpy, root, prop, 0, 1, xlib::False, xlib::XA_WINDOW, &mut ty, &mut fmt, &mut n, &mut after, &mut data);
            let mut out = None;
            if ok == xlib::Success as c_int && !data.is_null() && n == 1 && fmt == 32 {
                let w = *(data as *const c_ulong);
                if w != 0 {
                    out = Some(w as u64);
                }
            }
            if !data.is_null() {
                (xl.XFree)(data as *mut _);
            }
            out
        })
    }

    /// Floe's own window, from the window manager's list of windows (`_NET_CLIENT_LIST`).
    pub fn own_window() -> Option<u64> {
        let windows = with_display(|xl, dpy| unsafe {
            let root = (xl.XDefaultRootWindow)(dpy);
            let prop = atom(xl, dpy, "_NET_CLIENT_LIST");
            let (mut ty, mut fmt, mut n, mut after) = (0 as xlib::Atom, 0 as c_int, 0 as c_ulong, 0 as c_ulong);
            let mut data: *mut c_uchar = ptr::null_mut();
            let ok = (xl.XGetWindowProperty)(dpy, root, prop, 0, 4096, xlib::False, xlib::XA_WINDOW, &mut ty, &mut fmt, &mut n, &mut after, &mut data);
            let mut out = Vec::new();
            if ok == xlib::Success as c_int && !data.is_null() && fmt == 32 {
                out = std::slice::from_raw_parts(data as *const c_ulong, n as usize).iter().map(|&w| w as u64).collect();
            }
            if !data.is_null() {
                (xl.XFree)(data as *mut _);
            }
            Some(out)
        })?;
        let me = std::process::id();
        windows.into_iter().find(|&w| pid_of(w) == Some(me))
    }

    /// The process that owns a window (`_NET_WM_PID`), when it says.
    pub fn pid_of(window: u64) -> Option<u32> {
        with_display(|xl, dpy| unsafe {
            let prop = atom(xl, dpy, "_NET_WM_PID");
            let (mut ty, mut fmt, mut n, mut after) = (0 as xlib::Atom, 0 as c_int, 0 as c_ulong, 0 as c_ulong);
            let mut data: *mut c_uchar = ptr::null_mut();
            let ok = (xl.XGetWindowProperty)(dpy, window as xlib::Window, prop, 0, 1, xlib::False, xlib::XA_CARDINAL, &mut ty, &mut fmt, &mut n, &mut after, &mut data);
            let mut out = None;
            if ok == xlib::Success as c_int && !data.is_null() && n == 1 && fmt == 32 {
                out = Some(*(data as *const c_ulong) as u32);
            }
            if !data.is_null() {
                (xl.XFree)(data as *mut _);
            }
            out
        })
    }

    pub fn activate(window: u64) {
        with_display(|xl, dpy| unsafe {
            let root = (xl.XDefaultRootWindow)(dpy);
            let mut ev: xlib::XEvent = std::mem::zeroed();
            ev.client_message.type_ = xlib::ClientMessage;
            ev.client_message.window = window as xlib::Window;
            ev.client_message.message_type = atom(xl, dpy, "_NET_ACTIVE_WINDOW");
            ev.client_message.format = 32;
            ev.client_message.data.set_long(0, 2 as c_long); // source: a pager, so the WM obeys
            ev.client_message.data.set_long(1, xlib::CurrentTime as c_long);
            (xl.XSendEvent)(dpy, root, xlib::False, xlib::SubstructureRedirectMask | xlib::SubstructureNotifyMask, &mut ev);
            (xl.XFlush)(dpy);
            Some(())
        });
    }
}
