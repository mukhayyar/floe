// Floe's app icon: an ice floe shaped like Floe's own pill (the island at the top of your screen)
// afloat on the sages' night sea, with an orca's fin cutting the water in front of it. Drawn in
// the sages' camera with their kit (../../sage/kit), so it belongs with the Hosts tab.
//
//   scripts/icons.sh   → icon.svg/png (1024 px) and tray.svg/png here, every size Tauri bundles
//                        (desktop/src-tauri/icons), and the Mac app's app/Floe.icns

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extrude, iso, pathOf, roundedPlan } from "../../sage/kit/iso-kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const S = 1024;
const cam = { scale: 1.1, origin: [500, 500] };
const P = (x, y, z) => iso([x, y, z], cam);

/** A plan ring turned so its long axis runs across the screen (the camera looks down x = y). */
const turn = (ring, a = -Math.PI / 4) => ring.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);

// ---- the floe: a pill of ice standing proud of the water, more of it below
const pill = (w, d, grow = 0) => turn(roundedPlan({ x: -w / 2 - grow, y: -d / 2 - grow, w: w + grow * 2, d: d + grow * 2, r: d / 2 + grow }, 16));
const FLOE_W = 430, FLOE_D = 170, FLOE_H = 52;
const body = extrude(pill(FLOE_W, FLOE_D), 0, FLOE_H, cam, { convex: true, bevel: 7 });
const under = extrude(pill(FLOE_W, FLOE_D, 18), -90, 90, cam, { convex: true }); // the ice below the waterline
const cap = extrude(pill(FLOE_W - 70, FLOE_D - 52), FLOE_H, 16, cam, { convex: true, bevel: 5 }); // snow on top
const ICE = ["#5f81b7", "#83a5d3", "#adc7e8", "#d6e4f6"]; // side faces, from away-from-the-moon to lit
const SNOW = ["#bccfeb", "#cddcf2", "#dfe9f8", "#eff5fd"];

/** The edge of a plan ring that faces you, at height z (the waterline, where foam gathers). */
function frontEdge(ring, z) {
  const [vx, vy] = [Math.SQRT1_2, Math.SQRT1_2];
  const n = ring.length;
  const facing = ring.map(([ax, ay], i) => {
    const [bx, by] = ring[(i + 1) % n];
    return (by - ay) * vx - (bx - ax) * vy > 0; // counter-clockwise ring: outward normal (dy, -dx)
  });
  let start = facing.findIndex((f, i) => f && !facing[(i + n - 1) % n]);
  if (start < 0) start = 0;
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const i = (start + k) % n;
    if (!facing[i] && k > 0) { pts.push(ring[i]); break; }
    pts.push(ring[i]);
  }
  return pts.map(([x, y]) => P(x, y, z));
}

// ---- the orca, in profile, swimming to the right in front of the floe: head with its white eye
// patch, the back, a tall dorsal fin, the grey saddle behind it. Its plane faces you.
const ALONG = [Math.SQRT1_2, -Math.SQRT1_2]; // screen-right, in plan
const BASE = [176, 136]; // where the orca's middle meets the water, in plan
const O = 0.8; // its size
const at = (s, z) => P(BASE[0] + ALONG[0] * s * O, BASE[1] + ALONG[1] * s * O, z * O);
const curve = (f, n = 48) => Array.from({ length: n + 1 }, (_, i) => f(i / n));
const lerp = (a, b, t) => a + (b - a) * t;
const backZ = (s) => (s < -150 ? 0 : s > 262 ? 0 : s > 175 ? 58 * Math.sin(((262 - s) / 87) * (Math.PI / 2)) ** 0.7 : 58 * Math.sin(((s + 150) / 325) * (Math.PI / 2)) ** 1.15);
const backLine = curve((t) => at(lerp(-150, 262, t), backZ(lerp(-150, 262, t))), 80);
const bodyShape = [...backLine, at(262, 0), at(-150, 0)];
const finLead = curve((t) => at(lerp(118, -6, t ** 0.9), lerp(backZ(118) - 4, 240, Math.sin((t * Math.PI) / 2) ** 1.3)));
const finTrail = curve((t) => at(lerp(-6, 22, t) + 26 * Math.sin(Math.PI * t), lerp(240, backZ(22) - 4, t ** 0.85))).slice(1);
const fin = [...finLead, ...finTrail];
const saddle = [
  ...curve((t) => at(lerp(-44, 24, t), backZ(lerp(-44, 24, t)) - 2)),
  ...curve((t) => at(lerp(24, -44, t), backZ(lerp(24, -44, t)) - 4 - 11 * Math.sin(Math.PI * t))).slice(1),
];
const eye = curve((t) => { const a = t * Math.PI * 2; return at(196 + 24 * Math.cos(a) + 5 * Math.sin(a), 36 + 8 * Math.sin(a) + 3.5 * Math.cos(a)); }, 40);
// foam where the orca breaks the surface: along its waterline, heaped at the head and the tail
const foam = curve((t) => at(lerp(-158, 272, t), 2 * Math.sin(t * Math.PI * 7)), 90);
const splash = [curve((t) => at(lerp(250, 292, t), 10 * Math.sin(Math.PI * t))), curve((t) => at(lerp(-176, -140, t), 7 * Math.sin(Math.PI * t)))];

// water rings around the orca, and moonlight on the swell
const ellipse = (cx, cy, rx, ry, n = 72) => curve((t) => {
  const a = t * Math.PI * 2;
  const [x, y] = turn([[rx * Math.cos(a), ry * Math.sin(a)]])[0];
  return P(cx + x, cy + y, 0);
}, n);
const ripples = [ellipse(BASE[0] + 22, BASE[1] - 2, 230, 58), ellipse(BASE[0] + 22, BASE[1] - 2, 282, 86)];

function svg({ tray = false } = {}) {
  const d = (pts, close = true) => pathOf(pts, close);
  // the tray shows just the tile, edge to edge, without the shadow
  const view = tray ? "100 100 824 824" : `0 0 ${S} ${S}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="${view}">
  <defs>
    <linearGradient id="sea" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0" stop-color="#26396a"/><stop offset="0.5" stop-color="#15234a"/><stop offset="1" stop-color="#070d20"/>
    </linearGradient>
    <radialGradient id="moon" cx="0.72" cy="0.16" r="0.6">
      <stop offset="0" stop-color="#a9c8ff" stop-opacity="0.36"/><stop offset="1" stop-color="#a9c8ff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="top" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e2ecf9"/>
    </linearGradient>
    <linearGradient id="deep" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#86d6ff" stop-opacity="0.6"/><stop offset="1" stop-color="#3f8fe0" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="orca" x1="0" y1="0" x2="1" y2="0.4">
      <stop offset="0" stop-color="#1b2130"/><stop offset="0.6" stop-color="#0a0d14"/><stop offset="1" stop-color="#040508"/>
    </linearGradient>
    <clipPath id="tile"><rect x="100" y="100" width="824" height="824" rx="186"/></clipPath>
    <filter id="drop" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity="0.35"/></filter>
  </defs>
  <g ${tray ? "" : 'filter="url(#drop)"'}><rect x="100" y="100" width="824" height="824" rx="186" fill="url(#sea)"/></g>
  <g clip-path="url(#tile)">
    <rect x="100" y="100" width="824" height="824" fill="url(#moon)"/>
    <!-- the floe -->
    <path d="${under.fill}" fill="url(#deep)" opacity="0.8"/>
    <path d="${body.fill}" fill="${ICE[1]}"/>
    ${body.shades.map((p, i) => (p ? `<path d="${p}" fill="${ICE[i]}"/>` : "")).join("")}
    <path d="${body.top}" fill="url(#top)"/>
    <path d="${cap.fill}" fill="${SNOW[3]}"/>
    ${cap.shades.map((p, i) => (p ? `<path d="${p}" fill="${SNOW[i]}"/>` : "")).join("")}
    <path d="${cap.top}" fill="#ffffff"/>
    <path d="${body.outline}" fill="none" stroke="#3b5c91" stroke-opacity="0.5" stroke-width="3"/>
    <path d="${d(frontEdge(pill(FLOE_W + 4, FLOE_D + 4), 0), false)}" fill="none" stroke="#ffffff" stroke-opacity="0.75" stroke-width="7" stroke-linecap="round"/>
    <!-- the orca -->
    ${ripples.map((r, i) => `<path d="${d(r)}" fill="none" stroke="#9cc0ff" stroke-opacity="${0.2 - i * 0.08}" stroke-width="${6 - i * 2}"/>`).join("")}
    <path d="${d(bodyShape)}" fill="url(#orca)"/>
    <path d="${d(saddle)}" fill="#5d687e"/>
    <path d="${d(fin)}" fill="url(#orca)"/>
    <path d="${d(eye)}" fill="#f4f7fc"/>
    <path d="${d(finLead, false)}" fill="none" stroke="#c7d6f1" stroke-opacity="0.7" stroke-width="4.5" stroke-linecap="round"/>
    <path d="${d(curve((t) => at(lerp(175, 258, t), backZ(lerp(175, 258, t)) - 1)), false)}" fill="none" stroke="#c7d6f1" stroke-opacity="0.45" stroke-width="4" stroke-linecap="round"/>
    <path d="${d(foam, false)}" fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="7" stroke-linecap="round"/>
    ${splash.map((c) => `<path d="${d(c, false)}" fill="none" stroke="#ffffff" stroke-opacity="0.8" stroke-width="6" stroke-linecap="round"/>`).join("")}
  </g>
  <rect x="100.5" y="100.5" width="823" height="823" rx="186" fill="none" stroke="#ffffff" stroke-opacity="0.07" stroke-width="2"/>
</svg>
`;
}

function chrome() {
  const found = [
    process.env.FLOE_CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ].filter(Boolean).find((p) => existsSync(p));
  if (!found) throw new Error("drawing the PNGs needs Google Chrome (or set FLOE_CHROME)");
  return found;
}

/** Render an SVG file to a PNG of `size` px with a transparent background. */
function png(svgPath, out, size) {
  const page = join(mkdtempSync(join(tmpdir(), "floe-icon-")), "page.html");
  writeFileSync(page, `<html><body style="margin:0;background:transparent"><img src="${pathToFileURL(svgPath).href}" style="width:${size}px;height:${size}px;display:block"></body></html>`);
  execFileSync(chrome(), ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000", `--window-size=${size},${size}`, `--screenshot=${out}`, pathToFileURL(page).href], { stdio: "ignore" });
}

writeFileSync(join(HERE, "icon.svg"), svg());
png(join(HERE, "icon.svg"), join(HERE, "icon.png"), 1024);
writeFileSync(join(HERE, "tray.svg"), svg({ tray: true }));
png(join(HERE, "tray.svg"), join(HERE, "tray.png"), 64);
console.log("icon.svg, icon.png, tray.svg, tray.png");
