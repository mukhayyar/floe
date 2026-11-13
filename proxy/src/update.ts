// Is a newer Floe out? Asks GitHub for the latest release an hour after start and then twice a
// day (one small request; `"checkUpdates": false` in config.json turns it off). The apps show
// the answer in Settings; updating is running the install command again.
import pkg from "../package.json";
import type { Config } from "./config";

export const VERSION: string = pkg.version;
const LATEST = "https://api.github.com/repos/mukhayyar/floe/releases/latest";

export interface UpdateInfo {
  current: string;
  latest: string | null;
  newer: boolean;
  url: string | null;
  checkedAt: number | null;
}

export const update: UpdateInfo = { current: VERSION, latest: null, newer: false, url: null, checkedAt: null };

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

export function watchUpdates(cfg: Config) {
  if (cfg.checkUpdates === false || process.env.FLOE_DEMO) return;
  setTimeout(() => {
    void checkNow();
    setInterval(() => void checkNow(), 12 * 3600_000);
  }, 3600_000);
}
