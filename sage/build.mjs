// Build a host's karakuri sage: a preview card (anatomy plate) and/or the sprite sheet Floe plays.
//   node build.mjs --id <host id> --name <host name> --kind local|environment|ssh [--salt n]
//                  [--sheet out.png] [--preview out.html [--back]] [--audit]
// The sheet has one row per state seen from the front, then the same rows seen from behind.
import { writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import * as k from "./kit/iso-kit.mjs";
import * as A from "./kit/audit.mjs";
import { STATES, COLS, VIEW, SAGE_CSS, SOCKETS, traitsOf, frameSvg, describe, comboOf } from "./sage.mjs";
// the same rider seen from behind (camera at 232°): the sheet's second half, so it can swim away from you
const BACK = await import("./sage.mjs?az=232");

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const host = { id: arg("id", "local"), name: arg("name", "This Mac"), kind: arg("kind", "local"), salt: Number(arg("salt", 0)) };
const T = traitsOf(host);
const CELL_PT = Number(arg("cell", 96));
// any Chromium browser renders the sheets headlessly
const PF = process.env.ProgramFiles || "C:\\Program Files", PF86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", LAD = process.env.LOCALAPPDATA || "";
const CHROME = process.env.FLOE_CHROME || {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Arc.app/Contents/MacOS/Arc",
    `${process.env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
  ],
  linux: [
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/snap/bin/chromium", "/usr/bin/brave-browser", "/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable",
    "/opt/google/chrome/chrome",
  ],
  // Edge ships with Windows, so there is always one
  win32: [
    join(PF, "Google", "Chrome", "Application", "chrome.exe"), join(PF86, "Google", "Chrome", "Application", "chrome.exe"),
    join(LAD, "Google", "Chrome", "Application", "chrome.exe"),
    join(PF86, "Microsoft", "Edge", "Application", "msedge.exe"), join(PF, "Microsoft", "Edge", "Application", "msedge.exe"),
    join(PF, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
  ],
}[process.platform]?.find((p) => existsSync(p));
if (!CHROME && (process.argv.includes("--sheet") || process.argv.includes("--scene"))) {
  console.error("Floe needs Google Chrome (or Chromium, Brave, Edge) to draw the sages. Install one, or set FLOE_CHROME.");
  process.exit(2);
}

// the courtyard backdrop: --scene out.png [--scene-json out.json] (no host needed)
const scenePath = arg("scene");
if (scenePath) {
  const { sceneSvg, W, H } = await import("./scene.mjs");
  const { svg, layout } = sceneSvg();
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${k.ISO_CSS}${SAGE_CSS}
html,body{margin:0;padding:0;background:#0a0f22}
body.iso{--anatomy-weight:0.9px}
svg.iso-svg{width:${W}px!important;height:${H}px!important;max-width:none!important;display:block;overflow:hidden}
</style></head><body class="iso" data-theme="dark"><svg class="iso-svg" viewBox="0 0 ${W} ${H}">${svg}</svg></body></html>`;
  const dir = mkdtempSync(join(tmpdir(), "floe-scene-"));
  const page = join(dir, "scene.html");
  writeFileSync(page, html);
  const r = spawnSync(CHROME, ["--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2", `--window-size=${W},${H}`, `--screenshot=${scenePath}`, pathToFileURL(page).href], { encoding: "utf8", timeout: 60000 });
  if (arg("scene-html")) writeFileSync(arg("scene-html"), html);
  rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  if (arg("scene-json")) writeFileSync(arg("scene-json"), JSON.stringify(layout));
  console.log(JSON.stringify({ scene: scenePath, layout: arg("scene-json") ?? null }));
  process.exit(0);
}

const frames = Object.fromEntries(STATES.map(([state, n]) => [state, Array.from({ length: n }, (_, i) => frameSvg(T, state, i / n, `${state}${i}`))]));
const backFrames = Object.fromEntries(STATES.map(([state, n]) => [state, Array.from({ length: n }, (_, i) => BACK.frameSvg(T, state, i / n, `b${state}${i}`))]));

if (process.argv.includes("--audit")) {
  // every state at three moments of its loop
  let failed = 0;
  for (const [view, build] of [["front", frameSvg], ["back", BACK.frameSvg]]) for (const [state] of STATES) for (const t of [0, 0.35, 0.55]) {
    const { R } = build(T, state, t, "audit");
    console.log(`\n== ${view} · ${state} @ ${t}`);
    A.auditOrExit(R, undefined, { argv: ["--audit"], allow: SOCKETS, cover: ["spout", "water.front", "incense"] });   // effects with no solid: spray, the water surface, smoke
    if (process.exitCode) { failed++; process.exitCode = 0; }
  }
  console.log(failed ? `\naudit failed in ${failed} poses` : "\naudit passed in every pose");
  process.exitCode = failed ? 1 : 0;
}

const sheetPath = arg("sheet");
if (sheetPath) {
  const cells = [...STATES.map(([state]) => frames[state]), ...STATES.map(([state]) => backFrames[state])].map((row) => row.map((f) =>
    `<svg class="iso-svg" viewBox="0 0 ${VIEW} ${VIEW}" width="${CELL_PT}" height="${CELL_PT}">${f.svg}</svg>`).join("")).map((row) => `<div class="row">${row}</div>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${k.ISO_CSS}${SAGE_CSS}
html,body{margin:0;padding:0;background:transparent!important}
body.iso{--anatomy-weight:1.15px;background:transparent}
.row{display:flex;height:${CELL_PT}px}.row svg.iso-svg{flex:none;display:block;overflow:visible;width:${CELL_PT}px!important;height:${CELL_PT}px!important;max-width:none!important}
.iso-dots circle{opacity:.5}
</style></head><body class="iso" data-theme="dark">${cells}</body></html>`;
  const dir = mkdtempSync(join(tmpdir(), "floe-sage-"));
  const page = join(dir, "sheet.html");
  writeFileSync(page, html);
  const w = COLS * CELL_PT, h = STATES.length * 2 * CELL_PT;
  const r = spawnSync(CHROME, ["--headless", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000",
    "--force-device-scale-factor=2", `--window-size=${w},${h}`, `--screenshot=${sheetPath}`, pathToFileURL(page).href], { encoding: "utf8", timeout: 60000 });
  rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  console.log(JSON.stringify({ sheet: sheetPath, combo: comboOf(T), cols: COLS, cell: CELL_PT * 2, states: STATES, views: ["front", "back"] }));
}

const previewPath = arg("preview");
if (previewPath) {
  const big = (svg) => `<svg class="iso-svg" viewBox="0 0 ${VIEW} ${VIEW}" role="img" aria-label="${describe(T)}"><g data-part="sage">${svg}</g></svg>`;
  const body = k.plateHtml({
    fig: "Fig 1",
    title: `Karakuri sage · ${host.name}`,
    hint: "1 idle · 2 working · 3 needs you · 4 asleep",
    readout: "idle",
    keys: [
      { mark: "lit", label: "The part to watch: brush while writing, bowl rim when an agent needs you" },
      { mark: "raised", label: `Seeded for ${host.name}: ${comboOf(T)}` },
    ],
    caption: describe(T),
    body: `<div class="iso-stage sg-stage" tabindex="0" role="img">${big((process.argv.includes("--back") ? backFrames : frames).idle[0].svg)}</div>`,
  });
  const shown = process.argv.includes("--back") ? backFrames : frames;
  const data = Object.fromEntries(STATES.map(([state, n, secs]) => [state, { secs, frames: shown[state].map((f) => f.svg) }]));
  const live = `
const DATA = ${JSON.stringify(data)};
const ORDER = ${JSON.stringify(STATES.map(([s]) => s))};
const LABEL = { idle: "idle", working: "working · writing", attention: "needs you · striking the bowl", asleep: "host offline · asleep" };
const g = document.querySelector('[data-part="sage"]');
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
let state = "idle", started = performance.now(), touring = true, shown = -1, tourAt = performance.now();
function tick(now) {
  if (touring && now - tourAt > 4500) { state = ORDER[(ORDER.indexOf(state) + 1) % ORDER.length]; tourAt = now; started = now; }
  const d = DATA[state];
  const i = still.matches ? 0 : Math.floor(((now - started) / 1000 / d.secs) * d.frames.length) % d.frames.length;
  const key = state + i;
  if (key !== shown) { g.innerHTML = d.frames[i]; shown = key; readout.textContent = LABEL[state]; }
  requestAnimationFrame(tick);
}
document.querySelector(".sg-stage").addEventListener("keydown", (e) => {
  const n = Number(e.key);
  if (n >= 1 && n <= 4) { state = ORDER[n - 1]; touring = false; started = performance.now(); }
});
requestAnimationFrame(tick);
`;
  const theme = process.argv.includes("--light") ? "light" : "dark";
  writeFileSync(previewPath, k.pageHtml({ title: "Karakuri sage", theme, body: `<style>${SAGE_CSS}.sg-stage:focus,.sg-stage:focus-visible{outline:none;box-shadow:none}.sg-stage{border-radius:10px;background:radial-gradient(ellipse 62% 48% at 50% 64%,#1b2c54 0%,#18284e 52%,rgba(19,19,19,0) 100%)}</style>` + body, script: live }));
  console.log("wrote", previewPath);
}
