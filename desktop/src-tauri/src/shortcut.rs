//! The hotkey on Wayland. Floe runs on XWayland, where its key grab only sees keys while an X11
//! window is in front: Wayland doesn't let apps listen for keys behind other apps' backs. The
//! way in is a shortcut the desktop itself owns, running `floe --toggle` (the running Floe gets
//! it through single-instance). On GNOME Floe can add that shortcut for you.

use serde::Serialize;
use std::process::Command;

const LIST_SCHEMA: &str = "org.gnome.settings-daemon.plugins.media-keys";
const PATH: &str = "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/floe/";
const WM_SCHEMA: &str = "org.gnome.desktop.wm.keybindings";

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyHelp {
    /// A Wayland session: the hotkey needs a desktop shortcut.
    pub wayland: bool,
    /// What that shortcut should run.
    pub command: String,
    /// GNOME: Floe can add the shortcut itself.
    pub gnome: bool,
    /// Floe's GNOME shortcut is in place, with this hotkey and command.
    pub bound: bool,
    /// A GNOME shortcut that already uses this key ("the window menu").
    pub conflict: Option<String>,
}

fn wayland() -> bool {
    std::env::var("XDG_SESSION_TYPE").map(|t| t == "wayland").unwrap_or(false) || std::env::var_os("WAYLAND_DISPLAY").is_some()
}

fn gnome() -> bool {
    std::env::var("XDG_CURRENT_DESKTOP").map(|d| d.to_uppercase().split(':').any(|p| p == "GNOME")).unwrap_or(false)
}

/// `floe --toggle`, as this copy of Floe is started: the AppImage file itself when run from one.
pub fn command() -> String {
    let exe = std::env::var("APPIMAGE")
        .ok()
        .filter(|p| !p.is_empty())
        .or_else(|| std::env::current_exe().ok().map(|p| p.display().to_string()))
        .unwrap_or_else(|| "floe".into());
    let quoted = if exe.contains(' ') { format!("\"{exe}\"") } else { exe };
    format!("{quoted} --toggle")
}

/// "alt+space" → "<Alt>space", in GNOME's accelerator syntax.
pub fn accel(spec: &str) -> String {
    let mut mods = String::new();
    let mut key = String::new();
    for p in spec.split('+').map(|p| p.trim().to_lowercase()) {
        match p.as_str() {
            "alt" | "option" | "opt" => mods.push_str("<Alt>"),
            "ctrl" | "control" => mods.push_str("<Control>"),
            "shift" => mods.push_str("<Shift>"),
            "super" | "cmd" | "command" | "meta" => mods.push_str("<Super>"),
            "enter" | "return" => key = "Return".into(),
            "backquote" | "grave" | "`" => key = "grave".into(),
            k if k.len() > 1 && k.starts_with('f') && k[1..].parse::<u8>().is_ok() => key = k.to_uppercase(),
            k => key = k.to_string(),
        }
    }
    format!("{mods}{key}")
}

fn get(schema: &str, key: &str) -> Option<String> {
    let out = Command::new("gsettings").args(["get", schema, key]).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn set(schema: &str, key: &str, value: &str) -> Result<(), String> {
    let out = Command::new("gsettings").args(["set", schema, key, value]).output().map_err(|e| format!("gsettings: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// `['a', 'b']` or `@as []` → [a, b] (GVariant text for a list of strings).
fn strings(v: &str) -> Vec<String> {
    let inner = v.trim().trim_start_matches("@as").trim().trim_start_matches('[').trim_end_matches(']');
    inner
        .split(',')
        .map(|s| s.trim().trim_matches('\'').trim_matches('"').to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn list(items: &[String]) -> String {
    format!("[{}]", items.iter().map(|s| format!("'{}'", s.replace('\'', "\\'"))).collect::<Vec<_>>().join(", "))
}

fn quoted(s: &str) -> String {
    format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"))
}

fn ours() -> String {
    format!("{LIST_SCHEMA}.custom-keybinding:{PATH}")
}

/// GNOME shortcuts of its own that this key would clash with (GNOME ignores a custom shortcut
/// whose key it already uses).
fn conflict(accel: &str) -> Option<String> {
    let lower = accel.to_lowercase();
    [("activate-window-menu", "the window menu"), ("switch-input-source", "switching input sources"), ("switch-applications", "switching apps")]
        .iter()
        .find(|(key, _)| get(WM_SCHEMA, key).map(|v| strings(&v).iter().any(|a| a.to_lowercase() == lower)).unwrap_or(false))
        .map(|(_, what)| what.to_string())
}

pub fn help(spec: &str) -> HotkeyHelp {
    if !cfg!(target_os = "linux") || !wayland() {
        return HotkeyHelp::default();
    }
    let command = command();
    let gnome = gnome() && get(LIST_SCHEMA, "custom-keybindings").is_some();
    let a = accel(spec);
    let bound = gnome
        && get(LIST_SCHEMA, "custom-keybindings").map(|v| strings(&v).iter().any(|p| p == PATH)).unwrap_or(false)
        && get(&ours(), "binding").map(|v| v.trim_matches('\'') == a).unwrap_or(false)
        && get(&ours(), "command").map(|v| v.trim_matches('\'') == command).unwrap_or(false);
    HotkeyHelp { wayland: true, command, gnome, bound, conflict: if gnome { conflict(&a) } else { None } }
}

/// Add (or update) Floe's GNOME shortcut. With `free`, take the key back from GNOME's own
/// binding (the window menu keeps any other keys it has).
pub fn bind_gnome(spec: &str, free: bool) -> Result<HotkeyHelp, String> {
    let a = accel(spec);
    if free {
        for key in ["activate-window-menu", "switch-input-source", "switch-applications"] {
            if let Some(v) = get(WM_SCHEMA, key) {
                let keep: Vec<String> = strings(&v).into_iter().filter(|x| x.to_lowercase() != a.to_lowercase()).collect();
                if keep.len() != strings(&v).len() {
                    set(WM_SCHEMA, key, &list(&keep))?;
                }
            }
        }
    }
    set(&ours(), "name", "'Floe'")?;
    set(&ours(), "command", &quoted(&command()))?;
    set(&ours(), "binding", &quoted(&a))?;
    let mut paths = get(LIST_SCHEMA, "custom-keybindings").map(|v| strings(&v)).unwrap_or_default();
    if !paths.iter().any(|p| p == PATH) {
        paths.push(PATH.into());
        set(LIST_SCHEMA, "custom-keybindings", &list(&paths))?;
    }
    Ok(help(spec))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accelerators() {
        assert_eq!(accel("alt+space"), "<Alt>space");
        assert_eq!(accel("ctrl+shift+F12"), "<Control><Shift>F12");
        assert_eq!(accel("super+backquote"), "<Super>grave");
        assert_eq!(accel("Alt+K"), "<Alt>k");
    }

    #[test]
    fn gvariant_lists() {
        assert_eq!(strings("@as []"), Vec::<String>::new());
        assert_eq!(strings("['<Alt>space', '<Super>w']"), vec!["<Alt>space", "<Super>w"]);
        assert_eq!(list(&["a".into(), "b".into()]), "['a', 'b']");
    }

    /// Against GNOME's real schemas in a throwaway store (CI: GSETTINGS_BACKEND=keyfile with a
    /// scratch XDG_CONFIG_HOME, and FLOE_GSETTINGS_TEST=1). Skipped anywhere else.
    #[test]
    fn adds_the_gnome_shortcut() {
        if std::env::var_os("FLOE_GSETTINGS_TEST").is_none() {
            return;
        }
        std::env::set_var("XDG_SESSION_TYPE", "wayland");
        std::env::set_var("XDG_CURRENT_DESKTOP", "ubuntu:GNOME");
        let other = "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/";
        set(LIST_SCHEMA, "custom-keybindings", &list(&[other.into()])).unwrap();

        let before = help("alt+space");
        assert!(before.wayland && before.gnome && !before.bound);
        assert_eq!(before.conflict.as_deref(), Some("the window menu"));
        assert!(before.command.ends_with(" --toggle"));

        let after = bind_gnome("alt+space", true).unwrap();
        assert!(after.bound, "the shortcut is in place");
        assert_eq!(after.conflict, None, "the window menu let go of Alt+Space");
        assert_eq!(strings(&get(LIST_SCHEMA, "custom-keybindings").unwrap()), vec![other.to_string(), PATH.to_string()]);
        assert_eq!(get(&ours(), "binding").unwrap(), "'<Alt>space'");

        // again: nothing doubles up
        bind_gnome("alt+space", true).unwrap();
        assert_eq!(strings(&get(LIST_SCHEMA, "custom-keybindings").unwrap()).len(), 2);
    }
}
