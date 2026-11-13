// Keeping Floe up to date. The proxy asks GitHub for the latest release an hour after start and
// then twice a day (one small request; `"checkUpdates": false` in config.json turns it off).
//
// Updating is the installer, the same one-liner you install with, started by the proxy as its
// own detached process: the installer stops Floe and its proxy, puts the new version in place
// and starts Floe again, so it must not die with them. With auto-update on (Settings, on by
// default), a new release is installed once no agent is waiting on you.
//
// A Floe run from a git checkout (`scripts/build.sh`, launchd pointing at the repo) never updates
// itself: the installer would move it to the installed copy. Pull instead.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json";
import { ROOT, type Config } from "./config";
import { prefs } from "./prefs";
import { IS_WIN, childEnv, dirs } from "./platform";

export const VERSION: string = pkg.version;
const REPO = "mukhayyar/floe";
const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
const RAW = `https://raw.githubusercontent.com/${REPO}/main`;
/** A source checkout updates with git, not the installer. */
export const SOURCE_CHECKOUT = existsSync(join(ROOT, ".git"));
const ATTEMPT = join(dirs.cache, "update-attempt.json");
const LOG = join(dirs.logs, "update.log");

export interface UpdateInfo {
  current: string;
  latest: string | null;
  newer: boolean;
  url: string | null;
  checkedAt: number | null;
  /** This copy can update itself (an installed Floe, not a git checkout). */
  canUpdate: boolean;
  /** The installer is running: Floe restarts in a moment. */
  updating: boolean;
}

export const update: UpdateInfo = {
  current: VERSION, latest: null, newer: false, url: null, checkedAt: null, canUpdate: !SOURCE_CHECKOUT, updating: false,
};

/** 1 if a is newer than b, -1 if older, 0 if the same ("v0.4.10" > "0.4.9"). */
export function compare(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/, "").split(/[.-]/).map((p) => Number.parseInt(p, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0) ? 1 : -1;
  }
  return 0;
}

export async function checkNow(): Promise<UpdateInfo> {
  try {
    const res = await fetch(LATEST, {
      headers: { accept: "application/vnd.github+json", "user-agent": `floe/${VERSION}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const r: any = await res.json();
      if (typeof r?.tag_name === "string" && !r.draft && !r.prerelease) {
        update.latest = r.tag_name.replace(/^v/, "");
        update.url = typeof r.html_url === "string" ? r.html_url : null;
        update.newer = compare(update.latest!, VERSION) > 0;
        if (update.newer) console.log(`[update] Floe ${update.latest} is out (this is ${VERSION})`);
      }
    }
  } catch {} // offline, rate-limited: try again next time
  update.checkedAt = Date.now();
  return update;
}

/** The release we last tried to install, so a failing install isn't retried in a loop. */
function lastAttempt(): { version: string; at: number } | null {
  try {
    return JSON.parse(readFileSync(ATTEMPT, "utf8"));
  } catch {
    return null;
  }
}

/** The installer command for this system, for the given release. */
export function installerCommand(): string[] {
  return IS_WIN
    ? ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", `irm ${RAW}/install.ps1 | iex`]
    : ["bash", "-c", `curl -fsSL ${RAW}/install.sh | bash`];
}

/**
 * Install the latest release now: start the installer detached (its own session on macOS and
 * Linux; on Windows Floe's job object lets the proxy's children go), logging to update.log.
 */
export function installNow(why: "you" | "auto"): { ok: boolean; message: string } {
  if (!update.canUpdate) return { ok: false, message: `This Floe runs from a source checkout (${ROOT}): update it with git pull.` };
  if (update.updating) return { ok: true, message: "Already updating" };
  if (!update.newer || !update.latest) return { ok: false, message: "Floe is up to date" };
  const target = update.latest;
  try {
    mkdirSync(dirs.logs, { recursive: true });
    mkdirSync(dirs.cache, { recursive: true });
    writeFileSync(ATTEMPT, JSON.stringify({ version: target, at: Date.now() }));
    const log = openSync(LOG, "a");
    writeFileSync(LOG, `\n=== ${new Date().toLocaleString("sv-SE")} updating ${VERSION} → ${target} (${why})\n`, { flag: "a" });
    const [cmd, ...args] = installerCommand();
    const child = spawn(cmd, args, {
      detached: true,
      stdio: ["ignore", log, log],
      windowsHide: true,
      // the same install it updates, at the release it announced
      env: { ...childEnv(), FLOE_PREFIX: ROOT, FLOE_VERSION: `v${target}` },
    });
    child.on("error", (e) => {
      update.updating = false;
      console.error(`[update] couldn't start the installer: ${e.message}`);
    });
    child.unref();
    update.updating = true;
    console.log(`[update] installing Floe ${target} (${why}); log: ${LOG}`);
    return { ok: true, message: `Updating to Floe ${target}. Floe restarts in a moment.` };
  } catch (e) {
    update.updating = false;
    return { ok: false, message: `Couldn't start the update: ${(e as Error).message}` };
  }
}

/**
 * Check on a timer and, with auto-update on, install a newer release once it's quiet: no agent
 * waiting on you and no answer being written. The same release isn't tried twice within 6 hours.
 */
export function watchUpdates(cfg: Config, quiet: () => boolean) {
  if (cfg.checkUpdates === false || process.env.FLOE_DEMO) return;
  const maybeInstall = () => {
    if (!prefs.autoUpdate || !update.newer || !update.canUpdate || update.updating || !update.latest) return;
    const last = lastAttempt();
    if (last?.version === update.latest && Date.now() - last.at < 6 * 3600_000) return;
    if (quiet()) installNow("auto");
  };
  setTimeout(async () => {
    await checkNow();
    maybeInstall();
    setInterval(async () => { await checkNow(); maybeInstall(); }, 12 * 3600_000);
    setInterval(maybeInstall, 5 * 60_000); // found one while you were busy: try again when it's quiet
  }, Number(process.env.FLOE_UPDATE_DELAY_MS) || 3600_000);
}
