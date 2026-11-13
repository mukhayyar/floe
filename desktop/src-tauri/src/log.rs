//! `<logs>/app.log`: the few things worth knowing later (proxy, hotkey, keyboard hand-offs).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn line(msg: &str) {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let text = format!("[{secs}] {msg}\n");
    eprint!("{text}");
    let dir = crate::paths::logs_dir();
    let _ = fs::create_dir_all(&dir);
    // On macOS the Swift app already writes app.log there; this dev build keeps out of its way.
    let name = if cfg!(target_os = "macos") { "desktop.log" } else { "app.log" };
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(dir.join(name)) {
        let _ = f.write_all(text.as_bytes());
    }
}
