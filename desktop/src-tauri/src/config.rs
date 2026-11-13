//! `~/.config/floe/config.json` (shared with the proxy) and this app's own small state file.

use serde_json::Value;
use std::fs;

use crate::paths;

#[derive(Clone, Debug, serde::Serialize)]
pub struct Config {
    pub port: u16,
    /// As written in config.json ("option+space"), or the default.
    pub hotkey: String,
}

pub fn load() -> Config {
    let j: Value = fs::read_to_string(paths::config_dir().join("config.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null);
    let port = std::env::var("FLOE_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .or_else(|| j.get("port").and_then(Value::as_u64).map(|p| p as u16))
        .unwrap_or(7717);
    let hotkey = std::env::var("FLOE_HOTKEY")
        .ok()
        .filter(|h| !h.trim().is_empty())
        .or_else(|| j.get("hotkey").and_then(Value::as_str).map(str::to_string))
        .unwrap_or_else(|| "alt+space".to_string());
    Config { port, hotkey }
}

/// The Mac app's spelling ("option+space", "⌥⌘K") → what the shortcut plugin parses ("alt+space").
pub fn shortcut_spec(spec: &str) -> String {
    spec.split('+')
        .map(|p| {
            let p = p.trim();
            match p.to_lowercase().as_str() {
                "opt" | "option" | "⌥" => "alt".to_string(),
                "⌘" | "command" | "cmd" => "super".to_string(),
                "⌃" | "control" => "ctrl".to_string(),
                "⇧" => "shift".to_string(),
                "return" => "enter".to_string(),
                "`" | "grave" => "backquote".to_string(),
                _ => p.to_string(),
            }
        })
        .collect::<Vec<_>>()
        .join("+")
}

fn state_path() -> std::path::PathBuf {
    paths::config_dir().join("desktop.json")
}

fn read_state() -> Value {
    fs::read_to_string(state_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| Value::Object(Default::default()))
}

fn write_state(key: &str, value: Value) {
    let _ = fs::create_dir_all(paths::config_dir());
    let mut j = read_state();
    if let Some(o) = j.as_object_mut() {
        o.insert(key.into(), value);
    }
    let _ = fs::write(state_path(), serde_json::to_string_pretty(&j).unwrap_or_default() + "\n");
}

/// Where along the top edge Floe sits: its centre as a fraction of the screen width.
pub fn load_anchor() -> Option<f64> {
    read_state().get("anchor").and_then(Value::as_f64).filter(|a| (0.0..=1.0).contains(a))
}

pub fn save_anchor(anchor: f64) {
    write_state("anchor", Value::from(anchor));
}

/// Launch at login is switched on once, on first run; after that it's the user's call.
pub fn autostart_seeded() -> bool {
    read_state().get("autostartSeeded").and_then(Value::as_bool).unwrap_or(false)
}

pub fn mark_autostart_seeded() {
    write_state("autostartSeeded", Value::Bool(true));
}
