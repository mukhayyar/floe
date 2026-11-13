//! Where Floe keeps things on each OS. Shared with the proxy and the install scripts.

use std::path::PathBuf;

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

fn env_dir(key: &str) -> Option<PathBuf> {
    std::env::var_os(key).filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// `~/.config/floe/config.json` on every OS (Windows too), shared with the proxy.
pub fn config_dir() -> PathBuf {
    home().join(".config").join("floe")
}

/// Where the installer puts `proxy/`, `sage/` and `brain/`. `FLOE_HOME` overrides.
pub fn install_dir() -> PathBuf {
    if let Some(p) = env_dir("FLOE_HOME") {
        return p;
    }
    #[cfg(target_os = "macos")]
    {
        home().join("Library").join("Application Support").join("Floe")
    }
    #[cfg(target_os = "windows")]
    {
        env_dir("LOCALAPPDATA").unwrap_or_else(|| home().join("AppData").join("Local")).join("Floe")
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        env_dir("XDG_DATA_HOME").unwrap_or_else(|| home().join(".local").join("share")).join("floe")
    }
}

/// `app.log` (this app) and `proxy.log` (the proxy it supervises).
pub fn logs_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        home().join("Library").join("Logs").join("Floe")
    }
    #[cfg(target_os = "windows")]
    {
        env_dir("LOCALAPPDATA").unwrap_or_else(|| home().join("AppData").join("Local")).join("Floe").join("logs")
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        env_dir("XDG_STATE_HOME").unwrap_or_else(|| home().join(".local").join("state")).join("floe")
    }
}

/// Bun: `~/.bun/bin/bun(.exe)`, else the first one on PATH.
pub fn bun() -> Option<PathBuf> {
    let exe = if cfg!(windows) { "bun.exe" } else { "bun" };
    if let Some(p) = env_dir("BUN_INSTALL").map(|d| d.join("bin").join(exe)).filter(|p| p.is_file()) {
        return Some(p);
    }
    let home_bun = home().join(".bun").join("bin").join(exe);
    if home_bun.is_file() {
        return Some(home_bun);
    }
    let path = std::env::var_os("PATH")?;
    let mut dirs: Vec<PathBuf> = std::env::split_paths(&path).collect();
    // A login session may start us with a bare PATH: look where bun usually lives too.
    for extra in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        dirs.push(PathBuf::from(extra));
    }
    dirs.into_iter().map(|d| d.join(exe)).find(|p| p.is_file())
}
