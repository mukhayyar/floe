// The sages' lagoon: the backdrop of Floe's Hosts tab, in the same camera as the sages, so each
// host's orca rider swims in it at true scale. (An orca's favourite place is the floe.) A ring
// of layered ice floats in a moonlit sea around a calm lagoon; on the ring stand a vermilion
// torii with two paper lanterns, a snowy pine, a red maple and stone lanterns. The riders swim
// in the lagoon, and Floe animates orca fins in the open sea beyond.
//
// sceneSvg() returns the picture and a layout for the app: where each seat is (for 1..10
// hosts), how big a sage sprite is and where its origin sits, and where the pond and the
// lantern lights are, so Floe can float ripples and glows over them.

import * as k from "./kit/iso-kit.mjs";
import * as G from "./kit/lathe.mjs";
import * as A from "./kit/audit.mjs";
import { tubePieces, tubeSvg } from "./kit/tube.mjs";
import { material } from "./palette.mjs";
import { PROJECTION as SAGE_P, VIEW as SAGE_VIEW, MARKS } from "./sage.mjs";

export const W = 470, H = 460;
const TAU = Math.PI * 2;

const DECK = { x: -205, y: -160, w: 410, d: 320, r: 6 };
const DECK_H = 12;
const GROUND = -DECK_H;               // the floe's snowy top
const SEA = GROUND - 15;              // waterline on the floe's sides
const FLOE_RX = 300, FLOE_RY = 262;
const POND = [0, 0], POND_R = 54;
// the lagoon: the floe's inner edge, a ring of ice ~60 wide all round
const LAGOON = 0.74;
const onRing = (deg, f = 0.87) => { const a = (deg * Math.PI) / 180; return [FLOE_RX * f * Math.cos(a), FLOE_RY * f * Math.sin(a)]; };
const TORII = onRing(-142, 0.86);
const PINE = onRing(132, 0.88);
const MAPLE = onRing(-62, 0.88);
const FLOE = Array.from({ length: 30 }, (_, i) => {
  const a = (i / 30) * Math.PI * 2;
  const wob = 1 + 0.045 * Math.sin(a * 5 + 1.3) + 0.03 * Math.sin(a * 9 + 0.4);
  return [FLOE_RX * wob * Math.cos(a), FLOE_RY * wob * Math.sin(a)];
});

const P = k.fitProjection(
  [...FLOE.map(([x, y]) => [x, y, SEA]), ...FLOE.map(([x, y]) => [x, y, GROUND]), [TORII[0], TORII[1], 118], [PINE[0], PINE[1], 112], [MAPLE[0], MAPLE[1], 100]],
  W, H, { pad: 6, azimuth: 52 },
);
export const SCENE_P = P;
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (pts, style) => k.dotsSvg(pts, style);
const path3 = (pts, closed = false) => k.pathOf(pts.map(at), closed);
const zUp = (o) => G.frameOf(o, [0, 0, 1], [1, 0, 0], [0, 1, 0]);
const wear = (m, svg) => `<g style="${m}">${svg}</g>`;

const M = {
  ice: material("#a9c9d6"),
  snow: material("#dbe7ec", { edge: "#7f97a3" }),
  deck: material("#6a4630"),
  beam: material("#4e3324"),
  stone: material("#7a7671"),
  rock: material("#5e5c5a"),
  water: material("#1d4a5e"),
  torii: material("#b5402c"),
  toriiTop: material("#1e1b1d"),
  pine: material("#2f5a3b"),
  maple: material("#b5482e"),
  bark: material("#4a3427"),
  paper: material("#e6a24e", { edge: "#7a3a1e" }),
};

function rng(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function sceneSvg() {
  const R = A.recorder(P);
  const rec = R.solid;
  const put = (name, ref, svg, shapes = [], bias = 0) => R.put({ name, at: ref, bias, svg, shapes });
  const back = [];

  // ---- sky, moon, stars, far mountains and mist (a painted backdrop behind the stage)
  back.push(`<defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a0f22"/><stop offset="0.55" stop-color="#151b35"/><stop offset="1" stop-color="#1c2140"/></linearGradient>
    <radialGradient id="moonglow"><stop offset="0" stop-color="#f6ecd2" stop-opacity="0.35"/><stop offset="1" stop-color="#f6ecd2" stop-opacity="0"/></radialGradient>
    <linearGradient id="mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3156" stop-opacity="0"/><stop offset="1" stop-color="#2a3156" stop-opacity="0.85"/></linearGradient>
    <radialGradient id="pondlight"><stop offset="0" stop-color="#3f8fa6" stop-opacity="0.55"/><stop offset="1" stop-color="#3f8fa6" stop-opacity="0"/></radialGradient>
  </defs>`);
  back.push(`<rect width="${W}" height="${H}" fill="url(#sky)"/>`);
  const r = rng(7);
  let stars = "";
  for (let i = 0; i < 70; i++) {
    const x = r() * W, y = r() * H * 0.42, s = 0.3 + r() * 0.8;
    stars += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${s.toFixed(2)}" fill="#e8ecff" opacity="${(0.25 + r() * 0.55).toFixed(2)}"/>`;
  }
  back.push(stars);
  const moon = [W * 0.83, H * 0.1];
  back.push(`<circle cx="${moon[0]}" cy="${moon[1]}" r="46" fill="url(#moonglow)"/><circle cx="${moon[0]}" cy="${moon[1]}" r="15" fill="#f3e8cc"/><circle cx="${moon[0] + 5}" cy="${moon[1] - 3}" r="3" fill="#e2d5b4"/><circle cx="${moon[0] - 4}" cy="${moon[1] + 5}" r="2.2" fill="#e2d5b4"/>`);
  // the sea below the horizon, a moonpath on it, far icebergs on the horizon
  const HZ = H * 0.3;
  back.push(`<defs><linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c2a4e"/><stop offset="1" stop-color="#0a1328"/></linearGradient></defs>`);
  back.push(`<rect y="${HZ}" width="${W}" height="${H - HZ}" fill="url(#sea)"/>`);
  const q = rng(19);
  let berg = "";
  for (const [x, w, h] of [[30, 60, 16], [120, 38, 10], [300, 70, 20], [400, 44, 12]]) {
    berg += `<path d="M${x} ${HZ} L${x + w * 0.3} ${HZ - h} L${x + w * 0.55} ${HZ - h * 0.7} L${x + w * 0.7} ${HZ - h * 0.9} L${x + w} ${HZ} Z" fill="#3a4a72" opacity="0.8"/>`;
  }
  back.push(berg, `<rect y="${HZ - 2}" width="${W}" height="3" fill="#2c3a62" opacity="0.6"/>`);
  let path = "";
  for (let y = HZ + 4; y < H; y += 5 + (y - HZ) * 0.04) {
    const w = 6 + (y - HZ) * 0.22 * (0.6 + q() * 0.8);
    path += `<rect x="${(moon[0] - w / 2 + (q() - 0.5) * 10).toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="1.2" rx="0.6" fill="#f3e8cc" opacity="${(0.5 - (y - HZ) / H * 0.45).toFixed(2)}"/>`;
  }
  let swell = "";
  for (let i = 0; i < 46; i++) {
    const x = q() * W, y = HZ + 8 + q() * (H - HZ - 8), w = 6 + q() * 16;
    swell += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="0.8" rx="0.4" fill="#5d79a8" opacity="${(0.15 + q() * 0.25).toFixed(2)}"/>`;
  }
  back.push(path, swell);

  // ---- the floe: layered ice above the waterline, a snowy top, foam where it meets the sea
  const strata = [-4, -8.5, -12].map((dz) => L(k.ringSeam(FLOE, GROUND + dz, P), { tone: "lo" })).join("");
  const foam = L(k.ringSeam(FLOE, SEA + 1.2, P), { tone: "hi" });
  back.push(wear(M.ice, S(k.extrude(FLOE, SEA, GROUND - SEA, P, { convex: false, bevel: 1.4 }), { tone: "mid", inner: strata + foam })));
  back.push(wear(M.snow, L(k.onTop(FLOE.map(([x, y]) => [x * 0.95, y * 0.95]), GROUND, P, true), { tone: "faint" })));
  rec(A.extruded(FLOE, SEA, GROUND - SEA, { name: "stand.floe" }));

  // ---- the lagoon: the floe's inner cliff (the far side faces us) and the calm water inside
  const inner = FLOE.map(([x, y], i) => { const wob = 1 + 0.03 * Math.sin(i * 1.7); return [x * LAGOON * wob, y * LAGOON * wob]; });
  const VIEWER = [Math.cos((52 * Math.PI) / 180), Math.sin((52 * Math.PI) / 180)];
  let walls = "";
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i], b = inner[(i + 1) % inner.length];
    const n = [-(b[1] - a[1]), b[0] - a[0]];          // inward normal for a counter-clockwise ring
    const len = Math.hypot(n[0], n[1]) || 1;
    const face = (n[0] * VIEWER[0] + n[1] * VIEWER[1]) / len;
    if (face <= 0) continue;                           // only the far side of the cliff faces us
    const tone = face > 0.75 ? 3 : face > 0.5 ? 2 : face > 0.25 ? 1 : 0;
    walls += `<path class="iso-shade" data-shade="${tone}" d="${path3([[a[0], a[1], GROUND], [b[0], b[1], GROUND], [b[0], b[1], SEA], [a[0], a[1], SEA]], true)}"/>`;
  }
  const lag = inner.map(([x, y]) => [x, y, SEA]);
  const strataIn = [-4, -8.5, -12].map((dz) => k.pathOf(inner.map(([x, y]) => at([x, y, GROUND + dz])), true)).join("");
  back.push(`<defs><radialGradient id="lagoon" cx="0.45" cy="0.45" r="0.6"><stop offset="0" stop-color="#22355f"/><stop offset="1" stop-color="#16244a"/></radialGradient></defs>`);
  back.push(wear(M.ice, `<g>${walls}</g>` + `<path d="${strataIn}" fill="none" stroke="var(--anatomy-lo)" stroke-width="0.6" opacity="0.7"/>`));
  back.push(`<path d="${path3(lag, true)}" fill="url(#lagoon)"/>`);
  // the moon's path on the lagoon, and a few slow swells
  const qq = rng(23);
  let glint = "";
  for (let i = 0; i < 26; i++) {
    const u = qq(), v = qq();
    const p0 = at([-120 + 240 * u, -150 + 260 * v, SEA]);
    const w = 5 + qq() * 14;
    glint += `<rect x="${(p0[0] - w / 2).toFixed(1)}" y="${p0[1].toFixed(1)}" width="${w.toFixed(1)}" height="0.8" rx="0.4" fill="#7f9ccc" opacity="${(0.12 + qq() * 0.2).toFixed(2)}"/>`;
  }
  back.push(`<clipPath id="lagclip"><path d="${path3(lag, true)}"/></clipPath><g clip-path="url(#lagclip)">${glint}</g>`);
  back.push(wear(M.snow, L(k.pathOf(inner.map(([x, y]) => at([x, y, SEA + 1])), true), { tone: "hi" })));   // foam at the foot of the cliff
  back.push(wear(M.snow, L(k.pathOf(inner.map(([x, y]) => at([x, y, GROUND])), true), { tone: "faint" })));  // the cliff's lip

  // ---- torii: two posts, the nuki tie beam and the kasagi on top, facing the viewer
  const across = G.unit3([-Math.sin((52 * Math.PI) / 180), Math.cos((52 * Math.PI) / 180), 0]);
  const toward = G.unit3([Math.cos((52 * Math.PI) / 180), Math.sin((52 * Math.PI) / 180), 0]);
  const T0 = [TORII[0], TORII[1], GROUND];
  const legs = [-1, 1].map((s) => G.add3(T0, G.mul3(across, s * 46)));
  for (const leg of legs.sort((a, b) => k.depthOf(a, P) - k.depthOf(b, P))) {
    const F = zUp(leg);
    put("torii.leg", G.add3(leg, [0, 0, 60]), wear(M.torii, S(G.solidOf([[0, 8], [3, 8], [3, 6.4], [110, 5.4]], F, P, { steps: 32 }), { tone: "mid" })),
      [rec(A.solid(F, [[0, 8], [3, 8], [3, 6.4], [110, 5.4]], { name: "stand.torii" }))], 0);
  }
  const beam = (z, half, depth, h, mat, name, bias) => {
    const F = G.frameOf(G.add3(T0, [0, 0, z]), across, toward, [0, 0, 1]);
    const poly = [[-depth / 2, 0], [depth / 2, 0], [depth / 2, h], [-depth / 2, h]];
    put(name, G.add3(T0, [0, 0, z + h / 2]), wear(mat, S(G.prismOf(F, poly, -half, half, P), { tone: "mid" })), [rec(A.prism(F, poly, -half, half, { name }))], bias);
  };
  beam(84, 58, 7, 6, M.torii, "torii.nuki", 0.5);
  beam(104, 66, 9, 5, M.torii, "torii.shimaki", 0.6);
  beam(109, 74, 10, 4.5, M.toriiTop, "torii.kasagi", 0.7);
  // a tablet between the beams, and two paper lanterns hanging from the nuki
  const tab = G.frameOf(G.add3(T0, [0, 0, 90]), across, toward, [0, 0, 1]);
  put("torii.gakuzuka", G.add3(T0, [0, 0, 97]), wear(M.toriiTop, S(G.prismOf(tab, [[-3, 0], [3, 0], [3, 14], [-3, 14]], -7, 7, P), { tone: "mid" })), [], 0.8);
  const lights = [];
  for (const s of [-1, 1]) {
    const top = G.add3(T0, G.add3(G.mul3(across, s * 24), [0, 0, 84]));
    const F = zUp(G.add3(top, [0, 0, -26]));
    const shape = [[0, 0.8], [0.5, 3.4, 1], [3, 5.6, 1], [7, 6.4, 1], [11, 5.6, 1], [13.5, 3.4, 1], [14, 0.8]];
    const ribs = [3, 5.5, 8, 10.5].map((sv) => G.arcOf(F, sv, 6.1, P)).join("");
    put("chochin", G.add3(top, [0, 0, -18]), L(path3([top, G.add3(top, [0, 0, -12])]), { tone: "lo" }) +
      wear(M.paper, S(G.solidOf(shape, F, P, { steps: 32 }), { tone: "hi", lit: true, inner: L(ribs, { tone: "lo" }) })) +
      wear(M.toriiTop, S(G.disc(14, 15.5, 2.2, F, P, { steps: 16 }), { tone: "mid" }) + S(G.disc(-1.5, 0, 2.2, F, P, { steps: 16 }), { tone: "mid" })),
      [], 1);
    lights.push({ at: at(G.add3(F.o, [0, 0, 7])), r: 16, color: "#ffb35c" });
  }

  // ---- trees: a pine at the left, a maple at the right
  const tree = (base, mat, pads, name) => {
    const route = G.fillet([[base[0], base[1], GROUND], [base[0] + 4, base[1] - 6, GROUND + 36], [base[0] - 10, base[1] + 4, GROUND + 70], [base[0] - 2, base[1] - 2, GROUND + 100]], 14, 8);
    tubePieces(route, (u) => 7 - 4 * u, P, { maxLength: 30 }).forEach((p, i) => put(`${name}.trunk:${i}`, p.mid, wear(M.bark, tubeSvg(p, { tone: "mid" })), [], -1));
    for (const [dx, dy, z, rr] of pads) {
      const F = zUp([base[0] + dx, base[1] + dy, GROUND + z]);
      const prof = [[0, rr * 0.7], [2, rr, 1], [6, rr * 0.92, 1], [10, rr * 0.55, 1], [12, 0]];
      put(`${name}.pad`, [base[0] + dx, base[1] + dy, GROUND + z + 5], wear(mat, S(G.solidOf(prof, F, P, { steps: 48 }), { tone: "mid" })), [rec(A.solid(F, prof, { name: `${name}.pad` }))], 2);
      if (name === "pine") {
        const FS = zUp([base[0] + dx - 2, base[1] + dy - 2, GROUND + z + 8.4]);
        const cap = [[0, rr * 0.58], [1.6, rr * 0.6, 1], [3.2, rr * 0.36, 1], [3.8, 0]];
        put(`${name}.snow`, [base[0] + dx, base[1] + dy, GROUND + z + 10], wear(M.snow, S(G.solidOf(cap, FS, P, { steps: 40 }), { tone: "hi" })), [rec(A.solid(FS, cap, { name: `${name}.snow` }))], 2.2);
      }
    }
  };
  tree(PINE, M.pine, [[-24, 14, 52, 28], [20, -10, 76, 22], [-8, 6, 98, 16]], "pine");
  tree(MAPLE, M.maple, [[-18, 20, 48, 26], [20, -14, 68, 24], [-4, 4, 88, 18]], "maple");

  // ---- stone lanterns beside the deck, their windows lit
  const toro = (x, y) => {
    const z = GROUND;
    put("toro.base", [x, y, z + 2], wear(M.stone, S(k.cylinder(x, y, 9, z, 4, P, 32, 0.4), { tone: "mid" })), [rec(A.cylinder(x, y, 9, z, 4, { name: "toro.base" }))]);
    put("toro.post", [x, y, z + 16], wear(M.stone, S(k.cylinder(x, y, 3.6, z + 4, 22, P, 20), { tone: "mid", crease: "none" })), [rec(A.cylinder(x, y, 3.6, z + 4, 22, { name: "toro.post" }))]);
    const deck = { x: x - 9, y: y - 9, w: 18, d: 18, r: 1.5 };
    put("toro.deck", [x, y, z + 27.5], wear(M.stone, S(k.slabOf(deck, z + 26, 3, P, 3, 0.4), { tone: "mid" })), [rec(A.slab(deck, z + 26, 3, { name: "toro.deck" }, 3))]);
    const box = { x: x - 6.5, y: y - 6.5, w: 13, d: 13, r: 0.8 };
    const z0 = z + 29, z1 = z0 + 12;
    const win = (pts) => `<path class="sg-lamp" d="${path3(pts, true)}"/>` + L(path3(pts, true), { tone: "lo" });
    const front = [[x - 3.4, y + 6.5, z0 + 2], [x + 3.4, y + 6.5, z0 + 2], [x + 3.4, y + 6.5, z1 - 2], [x - 3.4, y + 6.5, z1 - 2]];
    const side = [[x + 6.5, y + 3.4, z0 + 2], [x + 6.5, y - 3.4, z0 + 2], [x + 6.5, y - 3.4, z1 - 2], [x + 6.5, y + 3.4, z1 - 2]];
    put("toro.box", [x, y, (z0 + z1) / 2], wear(M.stone, S(k.slabOf(box, z0, 12, P, 2), { tone: "mid" }) + win(front) + win(side)), [rec(A.slab(box, z0, 12, { name: "toro.box" }, 2))]);
    const FR = zUp([x, y, z1]);
    const roof = [[0, 13], [1.4, 13], [2.8, 10.6, 1], [6, 6, 1], [9, 2.2, 1], [9.8, 0]];
    put("toro.roof", [x, y, z1 + 4], wear(M.stone, S(G.solidOf(roof, FR, P), { tone: "mid" })), [rec(A.solid(FR, roof, { name: "toro.roof" }))]);
    const tip = [x, y, z1 + 11.6];
    put("toro.tip", tip, wear(M.stone, S(G.sphereOf(tip, 2.2, P, { steps: 24 }), { tone: "mid" })), [rec(A.ball(tip, 2.2, { name: "toro.tip" }))], 0.2);
    lights.push({ at: at([x, y, (z0 + z1) / 2]), r: 22, color: "#ffc978" });
  };
  toro(...onRing(168, 0.87));
  toro(...onRing(-104, 0.87));

  A.settle(R, P);
  R.items.sort((a, b) => a.key - b.key);
  const svg = back.join("") + R.items.map((i) => i.svg).join("");

  // ---- layout for the app
  const sageScale = P.scale / SAGE_P.scale;
  const sageSize = SAGE_VIEW * sageScale;              // sprite edge, in scene units (pt)
  const origin = k.iso([0, 0, 0], SAGE_P);              // the sage's world origin in its sprite
  const front = (52 * Math.PI) / 180;
  // seats on an ellipse stretched across the screen (wide left-right, shallow front-back),
  // turned so no seat hides the pond, and kept on the deck
  const ACROSS = [-Math.sin(front), Math.cos(front)], TOWARD = [Math.cos(front), Math.sin(front)];
  // riders in the lagoon: a row across it (two rows for a crowd), staggered a little front-back
  const place = (u, v) => {
    const w = [u * ACROSS[0] + v * TOWARD[0], u * ACROSS[1] + v * TOWARD[1], SEA];
    const s = at(w);
    return { x: s[0] / W, y: s[1] / H, depth: k.depthOf(w, P) };
  };
  const seatsFor = (n) => {
    // one zigzag line across the lagoon (alternately forward and back), two lines for a crowd
    const line = (k, v, span) => Array.from({ length: k }, (_, i) => {
      const gap = k > 1 ? Math.min(140, span / (k - 1)) : 0;
      return place((i - (k - 1) / 2) * gap, v + (k > 1 ? (i % 2 ? 44 : -18) : 0));
    });
    if (n <= 5) return line(n, n <= 3 ? 30 : 20, n <= 3 ? 280 : 360);
    const back = Math.ceil(n / 2);
    return [...line(back, -60, 360), ...line(n - back, 100, 340)];
  };
  const layout = {
    width: W, height: H,
    sage: { size: sageSize / W, anchorX: origin[0] / SAGE_VIEW, anchorY: origin[1] / SAGE_VIEW, ...MARKS },
    // sprite scale by host count (crowded decks get smaller sages)
    scale: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, i + 1 >= 6 ? 0.7 : i + 1 >= 4 ? 0.8 : 1])),
    pond: { x: at([0, -150, SEA])[0] / W, y: at([0, -150, SEA])[1] / H, rx: (40 * P.scale) / W },
    lights: lights.map((l) => ({ x: l.at[0] / W, y: l.at[1] / H, r: l.r / W, color: l.color })),
    // open sea in front of the floe, where the orca fins swim (fractions of the picture)
    sea: (() => { const lowest = Math.max(...FLOE.map(([x, y]) => at([x, y, SEA])[1])); return { top: Math.min(0.97, (lowest + 6) / H), bottom: 1 }; })(),
    seats: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, seatsFor(i + 1)])),
  };
  return { svg, layout, R };
}
