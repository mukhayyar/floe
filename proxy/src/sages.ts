// Sprite sheets of each host's karakuri sage (../../sage), rendered once per host and cached.
//
// A sheet is a grid of 192 px frames: one row per state (idle, working, attention, asleep),
// as many columns as the longest loop. Rendering a host takes ~20 s of CPU, so sheets are
// rendered one at a time at low priority, ahead of time, and kept until the sage's source,
// the host's name or its look changes. No two current hosts share a look: when a host's
// seeded traits collide with an earlier host's, it is re-seeded with the next salt.

import { existsSync, mkdirSync, readdirSync, renameSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import type { HostView } from "./orca";

const SAGE_DIR = join(import.meta.dir, "../../sage");
const CACHE = join(homedir(), "Library/Caches/Floe/sages");

type Host = Pick<HostView, "id" | "name" | "kind">;
type SageModule = {
  VERSION: number;
  COLS: number;
  STATES: [string, number, number][];
  traitsOf: (h: Host & { salt: number }) => unknown;
  comboOf: (t: unknown) => string;
};

let mod: SageModule | null = null;
async function sage(): Promise<SageModule> {
  return (mod ??= (await import(join(SAGE_DIR, "sage.mjs"))) as SageModule);
}

const stampOf = (files: string[]) => files.map((f) => Math.floor(statSync(join(SAGE_DIR, f)).mtimeMs)).join(".");
const stamp = () => stampOf(["sage.mjs", "build.mjs", "palette.mjs"]);
const sceneStamp = () => stampOf(["sage.mjs", "build.mjs", "palette.mjs", "scene.mjs"]);

export class Sages {
  private pending = new Map<string, Promise<void>>();
  private failed = new Map<string, number>(); // key → when it last failed (retry after 10 min)
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private hosts: () => Host[]) {
    mkdirSync(CACHE, { recursive: true });
  }

  /**
   * The grid layout, for the app: "idle:8:3.2,working:20:2,…,back.idle:8:3.2,…;cell=192;cols=20".
   * One row per state seen from the front, then the same rows seen from behind ("back.").
   */
  async layout(): Promise<string> {
    const S = await sage();
    const rows = [...S.STATES, ...S.STATES.map(([n, f, s]) => [`back.${n}`, f, s] as const)];
    return `${rows.map(([n, f, s]) => `${n}:${f}:${s}`).join(",")};cell=192;cols=${S.COLS}`;
  }

  private async salts(): Promise<Map<string, number>> {
    // Each host (in id order) takes the salt whose look differs from the hosts before it in
    // the most traits (hat, plinth, lantern/incense, beard); ties go to the lowest salt.
    const S = await sage();
    const FIELDS = ["robe", "hat", "plinth", "accessory", "beard"] as const;
    const chosen: Record<string, unknown>[] = [];
    const out = new Map<string, number>();
    for (const h of [...this.hosts()].sort((a, b) => a.id.localeCompare(b.id))) {
      let best = 0;
      let bestScore = -1;
      for (let salt = 0; salt < 24; salt++) {
        const t = S.traitsOf({ id: h.id, name: h.name, kind: h.kind, salt }) as Record<string, unknown>;
        const score = chosen.length ? Math.min(...chosen.map((c) => FIELDS.filter((f) => c[f] !== t[f]).length)) : 0;
        if (score > bestScore) { best = salt; bestScore = score; }
        if (!chosen.length) break;
      }
      chosen.push(S.traitsOf({ id: h.id, name: h.name, kind: h.kind, salt: best }) as Record<string, unknown>);
      out.set(h.id, best);
    }
    return out;
  }

  /** The cached sheet for a host, or null while it is still being rendered (queued if needed). */
  async sheet(id: string): Promise<string | null> {
    const S = await sage();
    const h: Host = this.hosts().find((x) => x.id === id) ?? { id, name: id, kind: "ssh" };
    const salt = (await this.salts()).get(id) ?? 0;
    const key = createHash("sha1").update(`${S.VERSION}|${stamp()}|${h.id}|${h.name}|${h.kind}|${salt}`).digest("hex").slice(0, 16);
    const path = join(CACHE, `${key}.png`);
    if (existsSync(path)) return path;
    if (Date.now() - (this.failed.get(key) ?? 0) < 10 * 60_000) return null;
    if (!this.pending.has(key)) {
      const job = this.queue.then(() => this.render(h, salt, path));
      this.queue = job.catch(() => {});
      this.pending.set(key, job);
      job.catch((e) => { this.failed.set(key, Date.now()); console.error(`[sage] ${h.name}: ${e}`); }).finally(() => this.pending.delete(key));
    }
    return null;
  }

  /** The courtyard backdrop and its layout ({png, json}), or null while it renders. */
  async scene(): Promise<{ png: string; json: string } | null> {
    const S = await sage();
    const key = createHash("sha1").update(`scene|${S.VERSION}|${sceneStamp()}`).digest("hex").slice(0, 16);
    const png = join(CACHE, `scene-${key}.png`), json = join(CACHE, `scene-${key}.json`);
    if (existsSync(png) && existsSync(json)) return { png, json };
    if (Date.now() - (this.failed.get(key) ?? 0) < 10 * 60_000) return null;
    if (!this.pending.has(key)) {
      const job = this.queue.then(async () => {
        const proc = Bun.spawn(["nice", "-n", "15", process.execPath, join(SAGE_DIR, "build.mjs"), "--scene", `${png}.tmp.png`, "--scene-json", `${json}.tmp`], { stdout: "pipe", stderr: "pipe" });
        if ((await proc.exited) !== 0 || !existsSync(`${png}.tmp.png`)) throw new Error(`scene render failed: ${(await new Response(proc.stderr).text()).slice(-300)}`);
        renameSync(`${json}.tmp`, json);
        renameSync(`${png}.tmp.png`, png);
        console.log("[sage] rendered the courtyard");
      });
      this.queue = job.catch(() => {});
      this.pending.set(key, job);
      job.catch((e) => { this.failed.set(key, Date.now()); console.error(`[sage] ${e}`); }).finally(() => this.pending.delete(key));
    }
    return null;
  }

  /** Queue every current host, so sheets are ready before anyone opens the Hosts tab. */
  warm(): void {
    void Promise.all([this.scene().then((s) => [s?.png, s?.json]).catch(() => []), ...this.hosts().map((h) => this.sheet(h.id).catch(() => null))]).then(([scene, ...current]) => {
      // drop sheets no current host uses, once they are a day old
      const keep = new Set([...(scene as (string | undefined)[]), ...current].filter(Boolean));
      for (const f of readdirSync(CACHE)) {
        const p = join(CACHE, f);
        try { if (!keep.has(p) && Date.now() - statSync(p).mtimeMs > 86_400_000) rmSync(p, { force: true }); } catch {}
      }
    });
  }

  private async render(h: Host, salt: number, path: string): Promise<void> {
    const tmp = `${path}.${process.pid}.tmp.png`;
    const started = Date.now();
    const proc = Bun.spawn(
      ["nice", "-n", "15", process.execPath, join(SAGE_DIR, "build.mjs"), "--id", h.id, "--name", h.name, "--kind", h.kind, "--salt", String(salt), "--sheet", tmp],
      { stdout: "pipe", stderr: "pipe" },
    );
    const code = await proc.exited;
    if (code !== 0 || !existsSync(tmp)) {
      rmSync(tmp, { force: true });
      throw new Error(`render failed (${code}): ${(await new Response(proc.stderr).text()).slice(-400)}`);
    }
    renameSync(tmp, path);
    console.log(`[sage] rendered ${h.name} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
}
