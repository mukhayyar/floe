// Keeping Floe up to date. The proxy asks GitHub for the latest release an hour after start and
// then twice a day (one small request; `"checkUpdates": false` in config.json turns it off).
//
// Updating is the installer, the same one-liner you install with, started so that it outlives
// the proxy: the installer stops Floe and its proxy, puts the new version in place and starts
// Floe again. With auto-update on (Settings, on by
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

const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Start the installer so it outlives this proxy and Floe, which it stops. macOS and Linux: a
 * detached child in its own session (launchd and pkill leave it alone). Windows: Bun's detached
 * spawn never runs the command, and a plain child dies with Bun, so Windows itself starts it
 * (WMI's Win32_Process.Create), outside our process tree, hidden; it writes its own log.
 */
async function launchInstaller(target: string): Promise<void> {
  if (!IS_WIN) {
    const log = openSync(LOG, "a");
    const child = spawn("bash", ["-c", `curl -fsSL ${RAW}/install.sh | bash`], {
      detached: true,
      stdio: ["ignore", log, log],
      // the same install it updates, at the release it announced
      env: { ...childEnv(), FLOE_PREFIX: ROOT, FLOE_VERSION: `v${target}` },
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    return;
  }
  const log = psQuote(LOG);
  const script = [
    `"installer started (pid $PID)" | Out-File -Append -Encoding utf8 -FilePath ${log}`,
    `$env:FLOE_PREFIX = ${psQuote(ROOT)}`,
    `$env:FLOE_VERSION = ${psQuote(`v${target}`)}`,
    // Out-String keeps the log UTF-8 (Windows PowerShell's own redirection writes UTF-16)
    `try { & { irm ${RAW}/install.ps1 | iex } *>&1 | Out-String -Stream | Out-File -Append -Encoding utf8 -FilePath ${log} }`
      + ` catch { "the update failed: $_" | Out-File -Append -Encoding utf8 -FilePath ${log} }`,
  ].join("; ");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const command = `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand ${encoded}`;
  const launcher = [
    "$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }",
    `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${psQuote(command)}; ProcessStartupInformation = $si }`,
    "Write-Output $r.ProcessId",
    "exit $r.ReturnValue",
  ].join("; ");
  const proc = Bun.spawn(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", launcher], {
    stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true, env: childEnv(),
  });
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if (code !== 0) throw new Error(`Windows didn't start the installer (${code}): ${err.trim().slice(0, 200)}`);
  console.log(`[update] Windows started the installer (pid ${out.trim()})`);
}

/** Install the latest release now, logging to update.log; Floe restarts on the new version. */
export async function installNow(why: "you" | "auto"): Promise<{ ok: boolean; message: string }> {
  if (!update.canUpdate) return { ok: false, message: `This Floe runs from a source checkout (${ROOT}): update it with git pull.` };
  if (update.updating) return { ok: true, message: "Already updating" };
  if (!update.newer || !update.latest) return { ok: false, message: "Floe is up to date" };
  const target = update.latest;
  update.updating = true;
  try {
    mkdirSync(dirs.logs, { recursive: true });
    mkdirSync(dirs.cache, { recursive: true });
    writeFileSync(ATTEMPT, JSON.stringify({ version: target, at: Date.now() }));
    writeFileSync(LOG, `\n=== ${new Date().toLocaleString("sv-SE")} updating ${VERSION} → ${target} (${why})\n`, { flag: "a" });
    await launchInstaller(target);
    console.log(`[update] installing Floe ${target} (${why}); log: ${LOG}`);
    return { ok: true, message: `Updating to Floe ${target}. Floe restarts in a moment.` };
  } catch (e) {
    update.updating = false;
    console.error(`[update] couldn't start the installer: ${(e as Error).message}`);
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
    if (quiet()) void installNow("auto");
  };
  setTimeout(async () => {
    await checkNow();
    maybeInstall();
    setInterval(async () => { await checkNow(); maybeInstall(); }, 12 * 3600_000);
    setInterval(maybeInstall, 5 * 60_000); // found one while you were busy: try again when it's quiet
  }, Number(process.env.FLOE_UPDATE_DELAY_MS) || 3600_000);
}
