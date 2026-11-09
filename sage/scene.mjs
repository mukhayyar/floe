// The sages' sea: the backdrop of Floe's Hosts tab, in the same camera as the sages, so each
// host's orca rider swims in it at true scale. Across the back, under the moon, lies a rocky,
// snow-capped island with a shrine: a hall with vermilion pillars, a copper roof with ridge
// logs and crossed finials, a sacred rope with paper streamers, paper and stone lanterns, a
// snowy pine and a red maple. A great vermilion torii stands in the sea before it. Everything
// in front of the island is open ocean, where Floe lets the orcas swim.
//
// sceneSvg() returns the picture and a layout for the app: how big a sage sprite is and where
// its waterline sits (seen from the front and from behind), the band of open water the riders
// may swim in, the moorings by the island for hosts that are asleep, where a host that needs
// you comes to wait, and where the lantern lights are, so Floe can float glows over them.

import * as k from "./kit/iso-kit.mjs";
import * as G from "./kit/lathe.mjs";
import * as A from "./kit/audit.mjs";
import { tubePieces, tubeSvg } from "./kit/tube.mjs";
import { material } from "./palette.mjs";
import { PROJECTION as SAGE_P, VIEW as SAGE_VIEW, MARKS } from "./sage.mjs";

const BACK = await import("./sage.mjs?az=232");

export const W = 470, H = 460;
const AZ = (52 * Math.PI) / 180;
// screen-aligned world axes: RIGHT runs left→right across the picture, TOWARD comes at you
const RIGHT = [Math.sin(AZ), -Math.cos(AZ)];
const TOWARD = [Math.cos(AZ), Math.sin(AZ)];
const ACROSS = G.unit3([-Math.sin(AZ), Math.cos(AZ), 0]);
const TOWARD3 = G.unit3([Math.cos(AZ), Math.sin(AZ), 0]);
/** A world point from screen-aligned offsets: sx to the right, sy toward the viewer. */
const W2 = (sx, sy) => [sx * RIGHT[0] + sy * TOWARD[0], sx * RIGHT[1] + sy * TOWARD[1]];

const SEA = 0;
const GROUND = 26;                    // the island's snowy top
// the island: a long rocky shore across the back of the picture
const ISLE_C = [0, -330], ISLE_RX = 480, ISLE_RY = 118;
const CW = W2(...ISLE_C);
const ISLE = Array.from({ length: 40 }, (_, i) => {
  const a = (i / 40) * Math.PI * 2;
  const wob = 1 + 0.05 * Math.sin(a * 5 + 1.3) + 0.03 * Math.sin(a * 11 + 0.4);
  return W2(ISLE_C[0] + ISLE_RX * wob * Math.cos(a), ISLE_C[1] + ISLE_RY * wob * Math.sin(a));
});
const SHRINE = W2(60, -365);
const SHRINE_SCALE = 1.5;          // the hall, drawn large enough to read as the shrine
const TORII = W2(-90, -150);
const PINE = W2(-385, -330);
const MAPLE = W2(375, -345);
const OCEAN_FRONT = 430;              // how far toward you the open water reaches (sets the frame)

const P = k.fitProjection(
  [...ISLE.map(([x, y]) => [x, y, SEA]), ...ISLE.map(([x, y]) => [x, y, GROUND]),
    [TORII[0], TORII[1], 124], [SHRINE[0], SHRINE[1], GROUND + 150], [PINE[0], PINE[1], GROUND + 110], [MAPLE[0], MAPLE[1], GROUND + 100],
    [...W2(-480, OCEAN_FRONT), SEA], [...W2(480, OCEAN_FRONT), SEA]],
  W, H, { pad: 6, azimuth: 52 },
);
export const SCENE_P = P;
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const path3 = (pts, closed = false) => k.pathOf(pts.map(at), closed);
const zUp = (o) => G.frameOf(o, [0, 0, 1], [1, 0, 0], [0, 1, 0]);
const wear = (m, svg) => `<g style="${m}">${svg}</g>`;

const M = {
  rock: material("#63646b"),
  boulder: material("#7d7f86"),
  snow: material("#dbe7ec", { edge: "#7f97a3" }),
  stone: material("#7a7671"),
  plinth: material("#8b8780"),
  wood: material("#5a3b28"),
  floor: material("#6a4630"),
  plaster: material("#e4ddcc", { edge: "#6f6556" }),
  torii: material("#b5402c"),
  toriiTop: material("#1e1b1d"),
  roof: material("#3f7466", { edge: "#9fd2c2" }),
  ridge: material("#24302d"),
  gold: material("#c9a24a"),
  straw: material("#c8b27a", { edge: "#6b5a32" }),
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
  const lights = [];

  // ---- sky, moon, stars, far mountains (a painted backdrop behind the stage)
  const isleBack = Math.min(...ISLE.map(([x, y]) => at([x, y, SEA])[1]));
  const HZ = isleBack - 16;            // the horizon, just behind the island
  back.push(`<defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a0f22"/><stop offset="0.7" stop-color="#151b35"/><stop offset="1" stop-color="#1e2444"/></linearGradient>
    <radialGradient id="moonglow"><stop offset="0" stop-color="#f6ecd2" stop-opacity="0.35"/><stop offset="1" stop-color="#f6ecd2" stop-opacity="0"/></radialGradient>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d2c52"/><stop offset="0.35" stop-color="#15234a"/><stop offset="1" stop-color="#0a1430"/></linearGradient>
  </defs>`);
  back.push(`<rect width="${W}" height="${H}" fill="url(#sky)"/>`);
  const r = rng(7);
  let stars = "";
  for (let i = 0; i < 80; i++) {
    const x = r() * W, y = r() * HZ * 0.95, s = 0.3 + r() * 0.8;
    stars += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${s.toFixed(2)}" fill="#e8ecff" opacity="${(0.25 + r() * 0.55).toFixed(2)}"/>`;
  }
  back.push(stars);
  const moon = [W * 0.84, Math.max(30, HZ * 0.32)];
  back.push(`<circle cx="${moon[0]}" cy="${moon[1]}" r="46" fill="url(#moonglow)"/><circle cx="${moon[0]}" cy="${moon[1]}" r="14" fill="#f3e8cc"/><circle cx="${moon[0] + 5}" cy="${moon[1] - 3}" r="3" fill="#e2d5b4"/><circle cx="${moon[0] - 4}" cy="${moon[1] + 5}" r="2.2" fill="#e2d5b4"/>`);
  // far mountains, two layers of mist-blue ridges on the horizon
  const ridge = (seed, base, height, fill, op) => {
    const q = rng(seed);
    let d = `M0 ${base}`;
    for (let x = 0; x <= W; x += 18 + q() * 22) d += ` L${x.toFixed(1)} ${(base - height * (0.35 + q() * 0.65)).toFixed(1)}`;
    return `<path d="${d} L${W} ${base} Z" fill="${fill}" opacity="${op}"/>`;
  };
  back.push(ridge(31, HZ, 34, "#26305a", 0.85), ridge(47, HZ, 18, "#313c6a", 0.9));
  // the sea, from the horizon to the bottom of the picture
  back.push(`<rect y="${HZ}" width="${W}" height="${H - HZ}" fill="url(#sea)"/>`, `<rect y="${HZ - 1}" width="${W}" height="2" fill="#3a4a78" opacity="0.6"/>`);
  // the moon's path on the water, and long slow swells (longer nearer you)
  const q = rng(19);
  let glow = "";
  for (let y = HZ + 3; y < H; y += 4 + (y - HZ) * 0.05) {
    const w = 5 + (y - HZ) * 0.18 * (0.6 + q() * 0.8);
    glow += `<rect x="${(moon[0] - w / 2 + (q() - 0.5) * 12).toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="1.1" rx="0.55" fill="#f3e8cc" opacity="${(0.42 - ((y - HZ) / (H - HZ)) * 0.34).toFixed(2)}"/>`;
  }
  let swell = "";
  for (let i = 0; i < 90; i++) {
    const y = HZ + 6 + q() * (H - HZ - 6);
    const x = q() * W, w = 5 + (y - HZ) * 0.08 + q() * 14;
    swell += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="0.8" rx="0.4" fill="#5d79a8" opacity="${(0.12 + q() * 0.22).toFixed(2)}"/>`;
  }
  back.push(glow, swell);

  // ---- the island: rock above the waterline, a snowy top, foam where the sea meets it
  const strata = [-5, -10.5].map((dz) => L(k.ringSeam(ISLE, GROUND + dz, P), { tone: "lo" })).join("");
  const foam = L(k.ringSeam(ISLE, SEA + 1.2, P), { tone: "hi" });
  back.push(wear(M.rock, S(k.extrude(ISLE, SEA, GROUND - SEA - 3, P, { convex: false, bevel: 1.6 }), { tone: "mid", inner: strata + foam })));
  const SNOW = ISLE.map(([x, y]) => [CW[0] + (x - CW[0]) * 0.985, CW[1] + (y - CW[1]) * 0.985]);
  back.push(wear(M.snow, S(k.extrude(SNOW, GROUND - 3, 3, P, { convex: false, bevel: 1.2 }), { tone: "hi" })));
  rec(A.extruded(ISLE, SEA, GROUND - SEA, { name: "stand.isle" }));
  // boulders along the near shore, half in the sea
  const qb = rng(41);
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.1 + 0.8 * (i / 8)) + (qb() - 0.5) * 0.1;      // the near half of the shore
    const [x, y] = W2(ISLE_C[0] - ISLE_RX * 1.02 * Math.cos(a), ISLE_C[1] + ISLE_RY * 1.04 * Math.sin(a));
    const rr = 6 + qb() * 7;
    const c = [x, y, rr * 0.1];
    put("boulder", c, wear(M.boulder, S(G.sphereOf(c, rr, P, { steps: 24 }), { tone: "mid" })), [rec(A.ball(c, rr, { name: "boulder", ground: true }))], -0.5);
  }

  // ---- the shrine hall (haiden): stone base, wooden floor, vermilion pillars, plaster walls,
  // lattice doors, a gabled copper roof with a ridge, katsuogi logs and crossed chigi
  const [sx, sy] = SHRINE;
  const u = SHRINE_SCALE;
  const box = (name, mat, x, y, w, d, z, h, tone = "mid", inner = "", bias = 0) => {
    const plan = { x: sx + x * u, y: sy + y * u, w: w * u, d: d * u, r: 0.6 };
    put(name, [sx + (x + w / 2) * u, sy + (y + d / 2) * u, z + (h * u) / 2], wear(mat, S(k.slabOf(plan, z, h * u, P, 2, 0.4), { tone, inner })), [rec(A.slab(plan, z, h * u, { name }, 2))], bias);
  };
  const Z0 = GROUND;
  box("shrine.base", M.plinth, -66, -42, 132, 84, Z0, 7);
  box("shrine.floor", M.floor, -56, -34, 112, 68, Z0 + 7 * u, 4);
  const ZF = Z0 + 11 * u, ZE = ZF + 34 * u;   // floor top, eaves
  box("shrine.wall.back", M.plaster, -48, -28, 96, 3, ZF, 34);
  box("shrine.wall.left", M.plaster, -48, -28, 3, 52, ZF, 34);
  box("shrine.wall.right", M.plaster, 45, -28, 3, 52, ZF, 34, "mid", "", 0.2);
  // the front: dark lattice doors between the pillars
  const lattice = [];
  for (let i = 1; i < 12; i++) lattice.push(path3([[sx + (-44 + i * 7.4) * u, sy + 24.2 * u, ZF + 3 * u], [sx + (-44 + i * 7.4) * u, sy + 24.2 * u, ZE - 6 * u]]));
  for (let j = 1; j < 5; j++) lattice.push(path3([[sx - 44 * u, sy + 24.2 * u, ZF + (3 + j * 5.6) * u], [sx + 44 * u, sy + 24.2 * u, ZF + (3 + j * 5.6) * u]]));
  box("shrine.doors", M.wood, -46, 21, 92, 3, ZF, 30, "mid", L(lattice.join(""), { tone: "lo" }), 0.3);
  for (const x of [-48, -16, 16, 48]) for (const y of [-27, 26]) {
    if (y < 0 && Math.abs(x) < 20) continue;
    const c = [sx + x * u, sy + y * u];
    put("shrine.pillar", [c[0], c[1], (ZF + ZE) / 2], wear(M.torii, S(k.cylinder(c[0], c[1], 2.8 * u, ZF, ZE - ZF, P, 20), { tone: "mid", crease: "none" })), [rec(A.cylinder(c[0], c[1], 2.8 * u, ZF, ZE - ZF, { name: "shrine.pillar" }))], 0.6);
  }
  // vermilion tie beams under the eaves, front and sides
  box("shrine.beam.front", M.torii, -51, 25, 102, 3.6, ZE - 5 * u, 4, "mid", "", 0.7);
  box("shrine.beam.left", M.torii, -51, -29, 3.6, 57, ZE - 5 * u, 4, "mid", "", 0.7);
  box("shrine.beam.right", M.torii, 47.4, -29, 3.6, 57, ZE - 5 * u, 4, "mid", "", 0.7);
  // steps up to the floor
  for (let i = 0; i < 3; i++) box(`shrine.step:${i}`, M.plinth, -16, 42 + i * 7, 32, 7, Z0, 9 - i * 3, "mid", "", 0.1);
  // the roof: a gable along x with deep eaves, then the ridge, katsuogi and chigi
  const ROOF_H = 32 * u, EAVE = 48 * u, HALF = 66 * u;
  const RF = G.frameOf([sx, sy, ZE], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const gable = [[-EAVE, -1.5], [EAVE, -1.5], [EAVE, 1.5], [3 * u, ROOF_H], [-3 * u, ROOF_H], [-EAVE, 1.5]];
  const tiles = [];
  for (let i = 1; i < 11; i++) {
    const t = i / 11;
    for (const sgn of [-1, 1]) tiles.push(path3([[sx - HALF, sy + sgn * EAVE * (1 - t), ZE + 1.5 + (ROOF_H - 1.5) * t], [sx + HALF, sy + sgn * EAVE * (1 - t), ZE + 1.5 + (ROOF_H - 1.5) * t]]));
  }
  put("shrine.roof", [sx, sy, ZE + ROOF_H / 2], wear(M.roof, S(G.prismOf(RF, gable, -HALF, HALF, P), { tone: "mid", inner: L(tiles.join(""), { tone: "lo" }) })), [rec(A.prism(RF, gable, -HALF, HALF, { name: "shrine.roof" }))], 1);
  const ZR = ZE + ROOF_H;
  const RB = G.frameOf([sx, sy, ZR], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  const ridgeBar = [[-4.5 * u, -1], [4.5 * u, -1], [4.5 * u, 4.5 * u], [-4.5 * u, 4.5 * u]];
  put("shrine.ridge", [sx, sy, ZR + 2], wear(M.ridge, S(G.prismOf(RB, ridgeBar, -HALF - 2, HALF + 2, P), { tone: "mid" })), [rec(A.prism(RB, ridgeBar, -HALF - 2, HALF + 2, { name: "shrine.ridge" }))], 1.2);
  const oct = Array.from({ length: 8 }, (_, i) => [2.4 * u * Math.cos((i / 8) * Math.PI * 2), 2.4 * u * Math.sin((i / 8) * Math.PI * 2)]);
  for (const x of [-40, -20, 0, 20, 40]) {
    const KF = G.frameOf([sx + x * u, sy, ZR + 6.9 * u], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
    put("shrine.katsuogi", [sx + x * u, sy, ZR + 7 * u], wear(M.gold, S(G.prismOf(KF, oct, -9 * u, 9 * u, P), { tone: "mid", crease: "none" })), [rec(A.prism(KF, oct, -9 * u, 9 * u, { name: "shrine.katsuogi" }))], 1.4);
  }
  for (const end of [-1, 1]) {
    const CF = G.frameOf([sx + end * (HALF - 2), sy, ZR], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    for (const sgn of [-1, 1]) {
      const bar = [[sgn * 2 * u, -2], [sgn * 5.5 * u, -2], [-sgn * 9 * u, 22 * u], [-sgn * 12.5 * u, 22 * u]];
      put("shrine.chigi", [sx + end * (HALF - 2), sy, ZR + 10 * u], wear(M.ridge, S(G.prismOf(CF, bar, -1.2 * u, 1.2 * u, P), { tone: "mid" })), [rec(A.prism(CF, bar, -1.2 * u, 1.2 * u, { name: "shrine.chigi" }))], 1.5);
    }
  }
  // the shimenawa: a thick straw rope sagging across the front, with zigzag paper shide
  const rope = G.fillet([[sx - 30 * u, sy + 27.5 * u, ZE - 7 * u], [sx, sy + 27.5 * u, ZE - 12 * u], [sx + 30 * u, sy + 27.5 * u, ZE - 7 * u]], 30 * u, 10);
  put("shrine.rope", [sx, sy + 27.5 * u, ZE - 10 * u], tubePieces(rope, () => 1.7 * u, P, { maxLength: 400 }).map((p) => wear(M.straw, tubeSvg(p, { tone: "mid" }))).join(""), [rec(A.tube(rope, 1.7 * u, { name: "shrine.rope" }))], 0.9);
  for (const x of [-16, 0, 16]) {
    const top = [sx + x * u, sy + 28.5 * u, ZE - (11 - Math.abs(x) * 0.12) * u];
    const zig = [top, [top[0] + 1.6 * u, top[1], top[2] - 3 * u], [top[0] - 1.2 * u, top[1], top[2] - 6 * u], [top[0] + 1.6 * u, top[1], top[2] - 9 * u], [top[0] - 0.6 * u, top[1], top[2] - 12 * u]];
    put("shrine.shide", G.add3(top, [0, 0, -6 * u]), `<path d="${path3(zig)}" fill="none" stroke="#f1ede2" stroke-width="1.4" stroke-linejoin="bevel"/>`, [rec(A.tube(zig, 0.7, { name: "shrine.shide" }))], 1);
  }
  // paper lanterns hanging from the front corners of the eaves
  for (const x of [-42, 42]) {
    const topP = [sx + x * u, sy + 30 * u, ZE - 3 * u];
    const F = zUp(G.add3(topP, [0, 0, -18 * u]));
    const shape = [[0, 0.8], [0.5, 3, 1], [2.6, 4.8, 1], [6, 5.4, 1], [9.4, 4.8, 1], [11.5, 3, 1], [12, 0.8]].map(([a, b, f]) => (f ? [a * u, b * u, f] : [a * u, b * u]));
    const ribs = [2.6, 4.8, 7, 9.2].map((sv) => G.arcOf(F, sv * u, 5.2 * u, P)).join("");
    put("chochin", G.add3(F.o, [0, 0, 6 * u]), L(path3([topP, G.add3(topP, [0, 0, -6 * u])]), { tone: "lo" }) +
      wear(M.paper, S(G.solidOf(shape, F, P, { steps: 28 }), { tone: "hi", lit: true, inner: L(ribs, { tone: "lo" }) })),
      [rec(A.solid(F, shape, { name: "chochin" }))], 1.1);
    lights.push({ at: at(G.add3(F.o, [0, 0, 6 * u])), r: 14 * u, color: "#ffb35c" });
  }

  // ---- the great torii standing in the sea, foam at its feet
  const T0 = [TORII[0], TORII[1], SEA];
  const legs = [-1, 1].map((s) => G.add3(T0, G.mul3(ACROSS, s * 50)));
  for (const leg of legs) {
    const F = zUp(leg);
    const prof = [[0, 8.6], [4, 8.6], [4, 7], [118, 5.8]];
    const ring = Array.from({ length: 33 }, (_, i) => { const a = (i / 32) * Math.PI * 2; return [leg[0] + 11 * Math.cos(a), leg[1] + 11 * Math.sin(a), SEA + 0.4]; });
    put("torii.leg", G.add3(leg, [0, 0, 60]), `<path d="${path3(ring, true)}" fill="none" stroke="#dbe8ff" stroke-width="0.9" opacity="0.6"/>` +
      wear(M.torii, S(G.solidOf(prof, F, P, { steps: 32 }), { tone: "mid" })), [rec(A.solid(F, prof, { name: "torii.leg", ground: true }))], 0);
  }
  const beam = (z, half, depth, h, mat, name, bias) => {
    const F = G.frameOf(G.add3(T0, [0, 0, z]), ACROSS, TOWARD3, [0, 0, 1]);
    const poly = [[-depth / 2, 0], [depth / 2, 0], [depth / 2, h], [-depth / 2, h]];
    put(name, G.add3(T0, [0, 0, z + h / 2]), wear(mat, S(G.prismOf(F, poly, -half, half, P), { tone: "mid" })), [rec(A.prism(F, poly, -half, half, { name }))], bias);
  };
  beam(90, 62, 7.5, 6.5, M.torii, "torii.nuki", 0.5);
  beam(112, 72, 9.5, 5.5, M.torii, "torii.shimaki", 0.6);
  beam(117.5, 82, 10.5, 5, M.toriiTop, "torii.kasagi", 0.7);
  const tabPoly = [[-3, 0], [3, 0], [3, 15.5], [-3, 15.5]];
  const tab = G.frameOf(G.add3(T0, [0, 0, 96.5]), ACROSS, TOWARD3, [0, 0, 1]);
  put("torii.gakuzuka", G.add3(T0, [0, 0, 104]), wear(M.toriiTop, S(G.prismOf(tab, tabPoly, -7.5, 7.5, P), { tone: "mid" })),
    [rec(A.prism(tab, tabPoly, -7.5, 7.5, { name: "torii.gakuzuka" }))], 0.8);

  // ---- trees: a snowy pine at the left end of the island, a red maple at the right
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

  // ---- stone lanterns: two by the shrine steps, two along the shore, their windows lit
  const toro = (x, y, s = 1) => {
    const z = GROUND;
    put("toro.base", [x, y, z + 2], wear(M.stone, S(k.cylinder(x, y, 9 * s, z, 4 * s, P, 32, 0.4), { tone: "mid" })), [rec(A.cylinder(x, y, 9 * s, z, 4 * s, { name: "toro.base" }))]);
    put("toro.post", [x, y, z + 16 * s], wear(M.stone, S(k.cylinder(x, y, 3.6 * s, z + 4 * s, 22 * s, P, 20), { tone: "mid", crease: "none" })), [rec(A.cylinder(x, y, 3.6 * s, z + 4 * s, 22 * s, { name: "toro.post" }))]);
    const deck = { x: x - 9 * s, y: y - 9 * s, w: 18 * s, d: 18 * s, r: 1.5 };
    put("toro.deck", [x, y, z + 27.5 * s], wear(M.stone, S(k.slabOf(deck, z + 26 * s, 3 * s, P, 3, 0.4), { tone: "mid" })), [rec(A.slab(deck, z + 26 * s, 3 * s, { name: "toro.deck" }, 3))]);
    const bx = { x: x - 6.5 * s, y: y - 6.5 * s, w: 13 * s, d: 13 * s, r: 0.8 };
    const z0 = z + 29 * s, z1 = z0 + 12 * s;
    const win = (pts) => `<path class="sg-lamp" d="${path3(pts, true)}"/>` + L(path3(pts, true), { tone: "lo" });
    const front = [[x - 3.4 * s, y + 6.5 * s, z0 + 2 * s], [x + 3.4 * s, y + 6.5 * s, z0 + 2 * s], [x + 3.4 * s, y + 6.5 * s, z1 - 2 * s], [x - 3.4 * s, y + 6.5 * s, z1 - 2 * s]];
    const side = [[x + 6.5 * s, y + 3.4 * s, z0 + 2 * s], [x + 6.5 * s, y - 3.4 * s, z0 + 2 * s], [x + 6.5 * s, y - 3.4 * s, z1 - 2 * s], [x + 6.5 * s, y + 3.4 * s, z1 - 2 * s]];
    put("toro.box", [x, y, (z0 + z1) / 2], wear(M.stone, S(k.slabOf(bx, z0, 12 * s, P, 2), { tone: "mid" }) + win(front) + win(side)), [rec(A.slab(bx, z0, 12 * s, { name: "toro.box" }, 2))]);
    const FR = zUp([x, y, z1]);
    const roof = [[0, 13 * s], [1.4 * s, 13 * s], [2.8 * s, 10.6 * s, 1], [6 * s, 6 * s, 1], [9 * s, 2.2 * s, 1], [9.8 * s, 0]];
    put("toro.roof", [x, y, z1 + 4 * s], wear(M.stone, S(G.solidOf(roof, FR, P), { tone: "mid" })), [rec(A.solid(FR, roof, { name: "toro.roof" }))]);
    const tip = [x, y, z1 + 11.6 * s];
    put("toro.tip", tip, wear(M.stone, S(G.sphereOf(tip, 2.2 * s, P, { steps: 24 }), { tone: "mid" })), [rec(A.ball(tip, 2.2 * s, { name: "toro.tip" }))], 0.2);
    lights.push({ at: at([x, y, (z0 + z1) / 2]), r: 20 * s, color: "#ffc978" });
  };
  toro(sx - 46 * SHRINE_SCALE, sy + 64 * SHRINE_SCALE, 0.9);
  toro(sx + 46 * SHRINE_SCALE, sy + 64 * SHRINE_SCALE, 0.9);
  toro(...W2(-235, -275));
  toro(...W2(245, -280));

  A.settle(R, P);
  R.items.sort((a, b) => a.key - b.key);
  const svg = back.join("") + R.items.map((i) => i.svg).join("");

  // ---- layout for the app
  const sageScale = P.scale / SAGE_P.scale;
  const sageSize = SAGE_VIEW * sageScale;              // sprite edge, in scene units (pt)
  const frac = ([x, y]) => ({ x: x / W, y: y / H });
  // open water: below the island's shore and the torii's feet, to the bottom of the picture
  const shore = Math.max(...ISLE.map(([x, y]) => at([x, y, SEA])[1]), ...legs.map((l) => at(l)[1]));
  const ocean = { top: (shore + 10) / H, bottom: 1, left: 0, right: 1 };
  // moorings for hosts that are asleep: in the shallows along the shore, either side of the torii
  const docks = [-0.36, 0.3, -0.18, 0.42, 0.12, -0.42, 0.2, -0.28, 0.36, -0.08].map((u, i) => frac([W * (0.5 + u), shore + 16 + (i % 2) * 10]));
  // where a host that needs you comes to wait: front and centre (a row when there are several)
  const calls = [0, -0.22, 0.22, -0.4, 0.4].map((u) => frac([W * (0.5 + u), H * 0.8]));
  const layout = {
    width: W, height: H,
    sage: { size: sageSize / W, ...MARKS },
    sageBack: { size: sageSize / W, ...BACK.MARKS },
    // sprite scale by host count: riders are drawn larger than true scale so they read at a
    // glance (the island is far off), and a crowded sea gets smaller ones
    scale: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, i + 1 >= 7 ? 1.05 : i + 1 >= 4 ? 1.25 : 1.5])),
    lights: lights.map((l) => ({ x: l.at[0] / W, y: l.at[1] / H, r: l.r / W, color: l.color })),
    ocean,
    docks,
    calls,
    horizon: HZ / H,
    // older Floe builds read these
    pond: { ...frac([W * 0.5, (shore + H) / 2]), rx: 0.04 },
    sea: { top: ocean.top, bottom: 1 },
    seats: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, docks.slice(0, i + 1).map((d) => ({ ...d, depth: d.y }))])),
  };
  return { svg, layout, R };
}
