// Where things live on macOS, Linux and Windows: Floe's own folders, and the local Orca install.
//
// Orca on Linux is usually an AppImage, mounted at a new /tmp/.mount_* path on every launch, so
// the running Orca is found through the pid it writes to orca-runtime.json. On Ubuntu `orca` on
// PATH is the GNOME screen reader: Floe never runs a bare `orca` there (Orca's Linux CLI is
// `orca-ide`).

import { existsSync, readFileSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

export const OS = process.platform as "darwin" | "linux" | "win32";
export const IS_WIN = OS === "win32";
export const IS_MAC = OS === "darwin";
export const HOME = homedir();

const env = process.env;
const LOCAL_APPDATA = env.LOCALAPPDATA || join(HOME, "AppData", "Local");
const ROAMING_APPDATA = env.APPDATA || join(HOME, "AppData", "Roaming");
const xdg = (name: string, fallback: string) => env[name] || join(HOME, fallback);

/** Floe's install dir (proxy/, sage/, brain/ when installed), logs and caches. */
export const dirs = {
  install:
    env.FLOE_HOME ||
    (IS_MAC ? join(HOME, "Library", "Application Support", "Floe") : IS_WIN ? join(LOCAL_APPDATA, "Floe") : join(xdg("XDG_DATA_HOME", ".local/share"), "floe")),
  logs: IS_MAC ? join(HOME, "Library", "Logs", "Floe") : IS_WIN ? join(LOCAL_APPDATA, "Floe", "logs") : join(xdg("XDG_STATE_HOME", ".local/state"), "floe"),
  cache: IS_MAC ? join(HOME, "Library", "Caches", "Floe") : IS_WIN ? join(LOCAL_APPDATA, "Floe", "cache") : join(xdg("XDG_CACHE_HOME", ".cache"), "floe"),
};

/** Orca's Electron user-data dir, which holds orca-runtime.json (endpoint + token + pid). */
export const ORCA_USER_DATA = IS_MAC
  ? join(HOME, "Library", "Application Support", "orca")
  : IS_WIN
    ? join(ROAMING_APPDATA, "orca")
    : join(xdg("XDG_CONFIG_HOME", ".config"), "orca");

export const firstExisting = (paths: (string | undefined)[]) => paths.find((p): p is string => !!p && existsSync(p));

function runtimePid(userData: string): number | null {
  try {
    const pid = JSON.parse(readFileSync(join(userData, "orca-runtime.json"), "utf8")).pid;
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

const exeCache = new Map<number, string | null>();

/** The executable of the running Orca (its pid from orca-runtime.json), or null. */
function runningOrcaExe(userData: string): string | null {
  const pid = runtimePid(userData);
  if (!pid) return null;
  if (exeCache.has(pid)) {
    const hit = exeCache.get(pid)!;
    if (!hit || existsSync(hit)) return hit;
  }
  let exe: string | null = null;
  try {
    if (OS === "linux") exe = readlinkSync(`/proc/${pid}/exe`);
    else if (IS_WIN) {
      const r = Bun.spawnSync(["powershell", "-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${pid}).Path`], { stdout: "pipe", stderr: "ignore", windowsHide: true });
      exe = r.stdout.toString().trim() || null;
    } else {
      const r = Bun.spawnSync(["ps", "-o", "comm=", "-p", String(pid)], { stdout: "pipe", stderr: "ignore" });
      exe = r.stdout.toString().trim() || null;
    }
  } catch {}
  if (exe?.endsWith(" (deleted)")) exe = null;
  exeCache.set(pid, exe);
  return exe;
}

/** Folders that hold an installed Orca's executable, best first. */
function orcaAppDirs(userData: string, orcaApp: string): string[] {
  const running = runningOrcaExe(userData);
  if (IS_MAC) {
    const fromRunning = running?.includes(".app/") ? running.slice(0, running.indexOf(".app/") + 4) : undefined;
    return [fromRunning, orcaApp, "/Applications/Orca.app", join(HOME, "Applications", "Orca.app")].filter((d): d is string => !!d);
  }
  const fromRunning = running ? dirname(running) : undefined;
  if (IS_WIN)
    return [fromRunning, join(LOCAL_APPDATA, "Programs", "Orca"), join(LOCAL_APPDATA, "Programs", "orca"), join(env.ProgramFiles || "C:\\Program Files", "Orca")].filter(
      (d): d is string => !!d,
    );
  return [fromRunning, "/opt/Orca", "/opt/orca-ide", "/opt/orca"].filter((d): d is string => !!d);
}

const LINUX_EXE = ["orca-ide", "orca", "Orca"];

/** Orca's Electron binary (the bridge runs under it with ELECTRON_RUN_AS_NODE=1). */
export function orcaElectron(userData: string, orcaApp: string): string | null {
  for (const dir of orcaAppDirs(userData, orcaApp)) {
    const exe = IS_MAC ? firstExisting([join(dir, "Contents", "MacOS", "Orca")]) : IS_WIN ? firstExisting([join(dir, "Orca.exe"), join(dir, "orca.exe")]) : firstExisting(LINUX_EXE.map((n) => join(dir, n)));
    if (exe) return exe;
  }
  return null;
}

/** The `orca` CLI. On Linux only Orca's own `orca-ide` launchers, never a bare `orca` from PATH. */
export function orcaCli(userData: string, orcaApp: string, override?: string): string {
  if (override) return override;
  const inApps = orcaAppDirs(userData, orcaApp).map((d) => (IS_MAC ? join(d, "Contents", "Resources", "bin", "orca") : join(d, "resources", "bin", IS_WIN ? "orca.exe" : "orca-ide")));
  const found = firstExisting(
    IS_MAC
      ? [...inApps, "/opt/homebrew/bin/orca", "/usr/local/bin/orca", join(HOME, ".local", "bin", "orca")]
      : IS_WIN
        ? inApps
        : [...inApps, join(HOME, ".local", "bin", "orca-ide")],
  );
  return found ?? (IS_WIN ? "orca.exe" : IS_MAC ? "orca" : "orca-ide");
}

/** Bring Orca's window to the front (a second launch hands over to the running instance). */
export function openOrca(userData: string, orcaApp: string) {
  try {
    if (IS_MAC) {
      Bun.spawn(["/usr/bin/open", "-a", "Orca"], { stdout: "ignore", stderr: "ignore" });
      return;
    }
    let target: string | null = null;
    if (OS === "linux") {
      const pid = runtimePid(userData);
      try {
        // an AppImage: relaunch the AppImage itself, not the file inside its mount
        const appImage = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").find((v) => v.startsWith("APPIMAGE="));
        if (appImage) target = appImage.slice("APPIMAGE=".length);
      } catch {}
    }
    target ??= orcaElectron(userData, orcaApp);
    if (!target) return;
    const proc = Bun.spawn([target], { stdout: "ignore", stderr: "ignore", stdin: "ignore", env: childEnv(), windowsHide: true });
    proc.unref();
  } catch {}
}

/** Where people's tools live, so children (orca, claude, git, agents) find them under a bare service PATH. */
function toolDirs(): string[] {
  if (IS_WIN) return [join(HOME, ".local", "bin"), join(HOME, ".bun", "bin"), join(ROAMING_APPDATA, "npm")];
  if (IS_MAC) return ["/opt/homebrew/bin", "/opt/homebrew/sbin", join(HOME, ".local", "bin"), join(HOME, ".bun", "bin"), "/usr/local/bin"];
  return [join(HOME, ".local", "bin"), join(HOME, ".bun", "bin"), "/usr/local/bin", "/usr/bin", "/bin", "/snap/bin"];
}

/** launchd and app-spawned services start with a bare PATH; children need the user's tools. */
export function childEnv(): Record<string, string> {
  const base = { ...(process.env as Record<string, string>) };
  const key = Object.keys(base).find((k) => k.toUpperCase() === "PATH") ?? "PATH"; // "Path" on Windows
  const current = (base[key] ?? (IS_WIN ? "" : "/usr/bin:/bin:/usr/sbin:/sbin")).split(delimiter).filter(Boolean);
  base[key] = [...new Set([...toolDirs(), ...current])].join(delimiter);
  if (!IS_WIN) base.HOME = HOME;
  return base;
}

/** Claude Code's CLI for the brain. */
export function claudeBin(): string {
  const found = firstExisting(
    IS_WIN
      ? [join(HOME, ".local", "bin", "claude.exe"), join(ROAMING_APPDATA, "npm", "claude.cmd")]
      : [join(HOME, ".local", "bin", "claude"), join(HOME, ".claude", "local", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude", "/usr/bin/claude"],
  );
  return found ?? "claude";
}

/** The process name for "This Mac"/"This PC" style labels. */
export const THIS_MACHINE = IS_MAC ? "This Mac" : "This PC";
