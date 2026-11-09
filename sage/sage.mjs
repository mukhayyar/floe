// A karakuri sage riding an orca: one small mechanical monk per Orca host, built with the
// anatomy kit. (The host is part of Orca, so its sage rides one.)
//
// The host is the automaton. It sits on a lacquered saddle board strapped to the back of a
// turned, black-and-white orca that floats in the sea. While the host's agents work, the orca
// swims (its flukes beat and it leaves a wake) and the sage writes on a scroll (or types on a
// laptop, for this Mac); every column it finishes rolls the scroll on. When an agent needs
// you, the orca spouts and the sage strikes the singing bowl at its side. The lantern (or the
// incense) burns while the host is online; offline, the light goes out, the orca drifts with
// its eye shut and the sage bows its head. Hat, robe, board, beard, lantern or incense, the
// orca's markings and the characters it writes are seeded from the host id, and the host's
// initials are on a brass plate on the board.

import * as k from "./kit/iso-kit.mjs";
import * as G from "./kit/lathe.mjs";
import * as A from "./kit/audit.mjs";
import { tubePieces, tubeSvg } from "./kit/tube.mjs";
import { ROBES, LACQUERS, paletteOf } from "./palette.mjs";

export const VERSION = 3;
/** [state, frames, seconds per loop] — rows of the sprite sheet, in this order. */
export const STATES = [
  ["idle", 8, 3.2],
  ["working", 20, 2.0],
  ["attention", 12, 1.3],
  ["asleep", 4, 4.0],
];
export const COLS = Math.max(...STATES.map(([, n]) => n));
export const VIEW = 200;

const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

// ---------------------------------------------------------------- traits

function hash32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function rngOf(seed) {
  let s = hash32(seed) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

export const HATS = ["kasa", "eboshi", "topknot", "nimbus"];
export const PLINTHS = ["cabinet", "hex"];
export const ACCESSORIES = ["lantern", "incense"];

export function monogram(name) {
  const words = String(name || "?").split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] || "?").slice(0, 2).toUpperCase();
}

/** Four brush strokes, kanji-like (mostly bars and posts, a falling stroke, a dot): a character only this host writes. */
function glyphOf(r) {
  const g = [0.1, 0.36, 0.64, 0.9];
  const at = () => Math.floor(r() * 4);
  const strokes = [];
  for (let i = 0; i < 4; i++) {
    const kind = r();
    if (kind < 0.42) { const y = g[at()], x0 = g[Math.min(1, at())], x1 = g[2 + Math.min(1, at())]; strokes.push([[x0, y], [x1, y + 0.03]]); }
    else if (kind < 0.7) { const x = g[at()], y0 = g[Math.min(1, at())], y1 = g[2 + Math.min(1, at())]; strokes.push([[x, y0], [x, y1]]); }
    else if (kind < 0.84) { const x = g[1 + Math.min(2, at())], y = g[Math.min(1, at())]; strokes.push([[x, y], [x - 0.5, y + 0.55]]); }
    else if (kind < 0.94) { const x = g[Math.min(2, at())], y = g[Math.min(1, at())]; strokes.push([[x, y], [x + 0.45, y + 0.5]]); }
    else { const x = g[at()], y = g[at()]; strokes.push([[x, y], [x + 0.08, y + 0.1]]); }
  }
  return strokes.map(([[x0, y0], [x1, y1]]) => [[clamp(x0, 0.06, 0.94), clamp(y0, 0.06, 0.94)], [clamp(x1, 0.06, 0.94), clamp(y1, 0.06, 0.94)]]);
}

export function traitsOf({ id, name, kind, salt = 0 }) {
  const r = rngOf(`${id}#${salt}`);
  const pick = (list) => list[Math.floor(r() * list.length)];
  return {
    hat: pick(HATS),
    plinth: pick(PLINTHS),
    accessory: pick(ACCESSORIES),
    beard: r() < 0.6,
    glyphs: [glyphOf(r), glyphOf(r)],
    desk: kind === "local" ? "laptop" : "scroll",
    monogram: monogram(name),
    robe: pick(ROBES),
    lacquer: pick(LACQUERS),
    marks: Math.floor(r() * 3) - 1,
  };
}
export const comboOf = (t) => `${t.hat}/${t.plinth}/${t.accessory}/${t.beard ? "beard" : "clean"}/${t.desk}/${t.robe[0]}/${t.lacquer[0]}`;

// ---------------------------------------------------------------- world

// ---- the orca: a turned body along +y (it swims the way the sage faces), widest under the board
const ORCA_R = 38, ORCA_L = 184;
const ORCA_TM = 0.9 / 1.32;
const ORCA_NORM = Math.pow(ORCA_TM, 0.9) * Math.pow(1 - ORCA_TM, 0.42);
const Y_TAIL = -ORCA_TM * ORCA_L;      // so the widest ring sits at y = 0
const ZC = 4;                          // the body's axis above the sea (z = 0 is the sea)
const orcaR = (s) => { const t = clamp(s / ORCA_L, 1e-4, 1 - 1e-4); return (ORCA_R * Math.pow(t, 0.9) * Math.pow(1 - t, 0.42)) / ORCA_NORM; };
const orcaSlope = (s) => { const t = clamp(s / ORCA_L, 1e-3, 1 - 1e-3); return ((ORCA_R / ORCA_NORM) * (0.9 * Math.pow(t, -0.1) * Math.pow(1 - t, 0.42) - 0.42 * Math.pow(t, 0.9) * Math.pow(1 - t, -0.58))) / ORCA_L; };
const sOf = (y) => y - Y_TAIL;
const backAt = (y) => ZC + orcaR(sOf(y));    // the top of the orca's back at y

// The camera's azimuth. 52 shows the rider from the front (the orca heads down-left on screen);
// import "./sage.mjs?az=232" for the same rider from behind (heading up-right), so Floe can
// let it swim every way (the other two headings are these two mirrored).
export const AZIMUTH = Number(new URL(import.meta.url).searchParams.get("az") ?? 52);
const VIEWER = [Math.cos((AZIMUTH * Math.PI) / 180), Math.sin((AZIMUTH * Math.PI) / 180)];
const P = k.fitProjection(
  [...k.boxCorners({ x: -66, y: Y_TAIL - 46, w: 132, d: -Y_TAIL + 46 + 82, r: 0 }, -2, 0), [0, -16, 112], [0, -58, 88], [25.5, -25.5, 74], [-40, 0, 60], [40, 0, 50]],
  VIEW,
  VIEW,
  { pad: 4, azimuth: AZIMUTH },
);
export const PROJECTION = P;
const V = G.viewOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);
const zUp = (o) => G.frameOf(o, [0, 0, 1], [1, 0, 0], [0, 1, 0]);

const BOARD_Z = backAt(0) + 0.3;    // the saddle board stands on blocks just clear of the back
const BODY = 5;                     // board thickness
const TOP = BOARD_Z + BODY + 2;     // board top, over the lip
const PL = { x: -38, y: -38, w: 76, d: 76, r: 4.5 };
const HEX_R = 46;
const HEX = Array.from({ length: 6 }, (_, i) => [HEX_R * Math.cos((i * TAU) / 6), HEX_R * Math.sin((i * TAU) / 6)]);
const HEX_FRONT = HEX_R * Math.sin(TAU / 6);    // y of the flat front face

const MAT = { x: -21, y: -37, w: 42, d: 44, r: 2 };
const MAT_TOP = TOP + 1.6;
const SAGE = [0, -16];
const U = 1.3;                      // the doll's scale: it carries the icon, so it is big
// The sage is turned like a doll: a cushion-shaped lap of crossed legs, a torso that tapers
// into rounded shoulders, a neck, and a ball head. Sleeves and hands sit outside the torso.
// The lap ends in a flat top exactly as wide as the torso's base, so the torso stands flush on it.
const LAP = [[0, 14.6], [1.6, 15.6, 1], [3.8, 15.2, 1], [5.6, 12.6, 1], [6.6, 10.4, 1], [7, 9.6]].map(([s, r, f]) => (f ? [s * U, r * U, f] : [s * U, r * U]));
const LAP_Y = 0;
const TORSO_Z = 7 * U;              // torso base: the lap's flat top
const TORSO_H = 19 * U;
const torsoBase = (s) => (s < 12 ? 9.6 - 0.9 * Math.pow(s / 12, 1.5) : 8.7 * Math.sqrt(Math.max(0, 1 - ((s - 12) / 7.6) ** 2)));
const torsoBaseSlope = (s) => (s < 12 ? (-0.9 * 1.5 * Math.sqrt(s / 12)) / 12 : (-8.7 * ((s - 12) / 7.6 ** 2)) / Math.sqrt(Math.max(1e-3, 1 - ((s - 12) / 7.6) ** 2)));
const torsoR = (s) => U * torsoBase(s / U);
const torsoSlope = (s) => torsoBaseSlope(s / U);
const HEAD_R = 6 * U;

const DESK = { x: -15, y: 8, w: 30, d: 14, r: 1.2 };
const DESK_LEG = 12;
const DESK_TOP = TOP + DESK_LEG;
const PAPER = { x: -10.4, y: 9.4, w: 20.8, d: 11.2, r: 0.3 };
const INK = DESK_TOP + 0.35;
const CELL = 4.4;
const PITCH = 6;
const PEN_X = 5.2;

const BOWL = [-29.8, 7];
const BU = 0.85;                    // the bowl and its cushion are a little smaller
const LAMP = [25.5, -25.5];
/** Where Floe pins a count badge (by the sage's head) and the host's name (by the orca's nose), as sprite fractions. */
export const MARKS = (() => {
  const head = k.iso([SAGE[0], SAGE[1], MAT_TOP + TORSO_Z + TORSO_H + 3.4 * U + 7.8], P);
  const nose = k.iso([0, ORCA_L + Y_TAIL + 4, -6], P);
  // the orca's heading on screen (unit vector, SVG axes: y down), for Floe's swim animation
  const o = k.iso([0, 0, 0], P), f = k.iso([0, 10, 0], P);
  const len = Math.hypot(f[0] - o[0], f[1] - o[1]);
  return { anchorX: o[0] / VIEW, anchorY: o[1] / VIEW, headX: head[0] / VIEW, headY: head[1] / VIEW, labelX: nose[0] / VIEW, labelY: nose[1] / VIEW, headingX: (f[0] - o[0]) / len, headingY: (f[1] - o[1]) / len };
})();

// ---------------------------------------------------------------- frame

/**
 * One frame of one state as an SVG body (no card). `t` runs 0..1 over the loop and the loop
 * is seamless. `uid` keeps clip-path ids unique when many frames share a page.
 */
export function frameSvg(T, state, t, uid = "f") {
  const R = A.recorder(P);
  RCUR = R;
  const base = [];
  const paint = paletteOf(T);
  const dress = (name, svg) => { const m = paint.of(name.replace(/:\d+$/, "")); return m ? `<g style="${m}">${svg}</g>` : svg; };
  const put = (name, ref, svg, shapes = [], bias = 0) => R.put({ name, at: ref, bias, svg: dress(name, svg), shapes });
  const rec = R.solid;
  const online = state !== "asleep";
  const working = state === "working";

  // breathing, shared by everything above the robe's waist
  const breath = state === "working" ? 0.25 * Math.sin(TAU * t * 2) : 0.55 * Math.sin(TAU * t);
  const bow = state === "asleep" ? 1 : 0;

  mount(T, base, put, rec, state, t, uid);

  // tatami mat under the sage
  put("mat", [SAGE[0], SAGE[1], TOP + 0.8],
    S(k.slabOf(MAT, TOP, 1.6, P, 3, 0.4), { tone: "lo", inner: "" }) +
      L(k.planOutline(k.insetPlan(MAT, 2.2), MAT_TOP, P, 3), { tone: "faint" }),
    [rec(A.slab(MAT, TOP, 1.6, { name: "mat" }, 3))], -2);

  // lap and torso: two turned bodies of one carved doll (owner "sage")
  const grow = 1 + 0.014 * breath;
  const FL = zUp([SAGE[0], SAGE[1] + LAP_Y, MAT_TOP]);
  put("lap", [SAGE[0], SAGE[1] + LAP_Y, MAT_TOP + 3], S(G.solidOf(LAP, FL, P), { tone: "hi" }), [rec(A.solid(FL, LAP, { name: "lap", owner: "sage" }))], -0.6);
  const FR = zUp([SAGE[0], SAGE[1], MAT_TOP + TORSO_Z]);
  const radius = (s) => torsoR(s) * grow;
  const slope = (s) => torsoSlope(s) * grow;
  const torso = Array.from({ length: 24 }, (_, i) => { const s = (i / 23) * TORSO_H; return [s, radius(s), 1]; });
  const obi = [4.2, 6.6].map((s) => L(G.arcOf(FR, s, radius(s), P, { slope: slope(s) }), { tone: "lo" })).join("");
  put("torso", [SAGE[0], SAGE[1], MAT_TOP + TORSO_Z + 8],
    S(G.solidOf(torso, FR, P, { smooth: { slope, radius } }), { tone: "hi", inner: obi }),
    [rec(A.solid(FR, torso, { radius, name: "torso", owner: "sage" }))]);

  // neck and head
  const lift = breath * 0.5;
  // the neck stands on the torso's flat top; the head's sphere rests on the neck's rim
  const NECK_R = 2.7 * U, NECK_H = 3.4 * U;
  const neckZ = MAT_TOP + TORSO_Z + TORSO_H;
  const neckH = NECK_H + lift;      // breathing lifts the head on its neck
  const head = [SAGE[0], SAGE[1] + 1.9 * bow, neckZ + neckH + Math.sqrt(HEAD_R * HEAD_R - NECK_R * NECK_R) - 1.5 * bow];
  const FN = zUp([SAGE[0], SAGE[1], neckZ]);
  put("neck", [SAGE[0], SAGE[1], neckZ + 2],
    S(G.disc(0, neckH, NECK_R, FN, P, { steps: 28 }), { tone: "hi", crease: "none" }),
    [rec(A.disc(FN, 0, neckH, NECK_R, { name: "neck", owner: "sage" }))]);
  put("head", head, S(G.sphereOf(head, HEAD_R, P), { tone: "hi" }) + face(head, HEAD_R, bow, T),
    [rec(A.ball(head, HEAD_R, { name: "head", owner: "sage" }))], 0.4);
  if (T.beard) beard(put, rec, head, HEAD_R, bow);
  hat(T, put, rec, head, HEAD_R, bow);

  // desk with the scroll (and its ink) or the laptop
  desk(T, put, rec, T.desk === "scroll" ? writing(T, state, t, uid) : "");

  // arms, hands, brush and mallet
  // shoulder balls touch the torso's side (a tangent contact), a little forward of its middle
  const shoulderS = 12.6 * U;
  const shoulderZ = MAT_TOP + TORSO_Z + shoulderS + lift * 0.6;
  const reach = torsoR(shoulderS) * grow + R_SHOULDER + 0.05;
  const sideDir = (side) => G.unit3([side, 0.22, 0]);
  const RS = G.add3([SAGE[0], SAGE[1], shoulderZ], G.mul3(sideDir(+1), reach));
  const LS = G.add3([SAGE[0], SAGE[1], shoulderZ], G.mul3(sideDir(-1), reach));
  const knee = (side) => [SAGE[0] + side * 5.4 * U, SAGE[1] + LAP_Y + 12 * U, MAT_TOP + 8.6 * U + lift * 0.1];

  if (T.desk === "scroll") {
    const pen = penAt(T, state, t);
    const BA = G.unit3([0.14, -0.32, 1]);
    const across = G.unit3(G.cross3(BA, [0, 0, 1]).map((v, i) => v || [1, 0, 0][i]));
    const grip = (tip) => G.add3(G.add3(tip, G.mul3(BA, 7.6)), G.mul3(across, -(R_HAND + 0.72)));
    const hand = arm("arm.r", put, RS, grip(pen.tip), +1);
    // the brush hangs from the fist: if the arm could not quite reach, the brush moves with it
    const tip = G.sub3(G.sub3(hand, G.mul3(across, -(R_HAND + 0.72))), G.mul3(BA, 7.6));
    brush(put, rec, tip, BA, working);
  } else {
    // typing: both hands on the keyboard, one pressing each beat
    if (working) {
      const beat = Math.floor(t * 20) % 2;
      const rest = DESK_TOP + 0.9 + R_HAND + 0.05;   // fingertips on the keys, the other hand lifted
      const keyL = [-3.8, 11.8, rest + (beat === 0 ? 0 : 0.9)];
      const keyR = [3.6, 12, rest + (beat === 1 ? 0 : 0.9)];
      arm("arm.r", put, RS, keyR, +1);
      if (state !== "attention") arm("arm.l", put, LS, keyL, -1);
    } else {
      arm("arm.r", put, RS, knee(+1), +1);
    }
  }

  bowlAndMallet(T, put, rec, state, t, LS, knee(-1));
  accessory(T, put, rec, online, t);

  A.settle(R, P);
  R.items.sort((a, b) => a.key - b.key);
  return { svg: base.join("") + R.items.map((i) => i.svg).join(""), R };

  // ------------------------------------------------------------ helpers that need R

  function arm(name, put, shoulder, hand, side) { return jointedArm(R, name, put, shoulder, hand, side); }
}

/** Joint pairs excused in the audit: a limb's rim lands on its ball, so the two interlock by a few px² at the rim. */
export const SOCKETS = ["arm.r", "arm.l"].flatMap((a) => [
  [`${a}.upper*`, `${a}.shoulder`], [`${a}.upper*`, `${a}.elbow`], [`${a}.fore*`, `${a}.elbow`], [`${a}.fore*`, `${a}.hand`], [`${a}.upper*`, `${a}.fore*`],
]).concat([["beard", "head"]]);
/**
 * A karakuri arm: ball joints at the shoulder, elbow and hand, joined by two straight turned
 * limbs whose rims land on the balls. The elbow comes from two-bone IK, bent out and down.
 */
const UPPER = 11.5 * U, FORE = 10.5 * U;
let RCUR = null;                    // the recorder of the frame being built
const R_SHOULDER = 3 * U, R_ELBOW = 2.5 * U, R_HAND = 2 * U;
const R_UPPER = 1.9 * U, R_FORE = 1.6 * U;
function jointedArm(_, name, put, shoulder, hand, side) {
  const toHand = G.sub3(hand, shoulder);
  const d = Math.min(UPPER + FORE - 0.01, Math.max(Math.abs(UPPER - FORE) + 0.01, G.len3(toHand)));
  const u = G.unit3(toHand);
  const pole = [side * 2.6, 0.1, -1];
  const w = G.unit3(G.sub3(pole, G.mul3(u, G.dot3(pole, u))));
  const cosA = clamp((UPPER * UPPER + d * d - FORE * FORE) / (2 * UPPER * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const elbow = G.add3(shoulder, G.add3(G.mul3(u, UPPER * cosA), G.mul3(w, UPPER * sinA)));
  hand = G.add3(elbow, G.mul3(G.unit3(G.sub3(hand, elbow)), FORE));   // where the arm really ends
  const owner = name;
  const limb = (from, to, rFrom, rTo, r, tag) => {
    const dir = G.unit3(G.sub3(to, from));
    const a = G.add3(from, G.mul3(dir, Math.sqrt(Math.max(0, rFrom * rFrom - r * r))));
    const b = G.sub3(to, G.mul3(dir, Math.sqrt(Math.max(0, rTo * rTo - r * r))));
    RCUR.route(`${name}.${tag}`, [a, b], r, { owner });
    tubePieces([a, mix3(a, b, 0.5), b], r, P, { maxLength: 3.5, caps: false }).forEach((piece, i) =>
      put(`${name}.${tag}:${i}`, piece.mid, tubeSvg(piece, { tone: "hi" }), [A.tube(piece.points, piece.radii, { name: `${name}.${tag}:${i}`, owner })], 0.05),
    );
  };
  const ball = (at, r, tag, bias) =>
    put(`${name}.${tag}`, at, S(G.sphereOf(at, r, P, { steps: 36 }), { tone: "hi" }), [RCUR.solid(A.ball(at, r, { name: `${name}.${tag}`, owner: `${name}.joints` }))], bias);
  ball(shoulder, R_SHOULDER, "shoulder", 0.1);
  limb(shoulder, elbow, R_SHOULDER, R_ELBOW, R_UPPER, "upper");
  ball(elbow, R_ELBOW, "elbow", 0.15);
  limb(elbow, hand, R_ELBOW, R_HAND, R_FORE, "fore");
  ball(hand, R_HAND, "hand", 0.2);
  return hand;
}

// ---------------------------------------------------------------- the orca and its saddle

const SEA_A = 64, SEA_B = 124, SEA_CY = (Y_TAIL - 46 + 82) / 2;
const ellipse = (a, b, cy, n = 72, cx = 0) => Array.from({ length: n }, (_, i) => { const q = (i / n) * TAU; return [cx + a * Math.cos(q), cy + b * Math.sin(q)]; });

/**
 * The orca, the water round it, and the saddle board on its back. The sea patch, ripples and
 * wake go first (out); the body's three bands, fins, board and the near water surface are
 * items, so the depth solver orders them against the sage, the desk and each other.
 */
function mount(T, out, put, rec, state, t, uid) {
  const working = state === "working", asleep = state === "asleep", attention = state === "attention";
  const F = G.frameOf([0, Y_TAIL, ZC], [0, 1, 0], [1, 0, 0], [0, 0, 1]);

  // ---- the sea round it: a soft patch that melts into Floe's sea, ripples, and a wake
  out.push(`<defs><radialGradient id="sea-${uid}"><stop offset="0" stop-color="#1b2c54" stop-opacity="0.96"/><stop offset="0.72" stop-color="#17274c" stop-opacity="0.7"/><stop offset="1" stop-color="#132244" stop-opacity="0"/></radialGradient></defs>`);
  out.push(`<path d="${k.onTop(ellipse(SEA_A, SEA_B, SEA_CY), 0, P, true)}" fill="url(#sea-${uid})"/>`);
  const ripple = (d, alpha, w = 0.8) => `<path d="${d}" fill="none" stroke="#cfe0ff" stroke-width="${w}" stroke-linecap="round" opacity="${alpha.toFixed(2)}"/>`;
  if (!asleep) {
    for (let i = 0; i < 3; i++) {
      const ph = (t * (working ? 2 : 1) + i / 3) % 1;
      out.push(ripple(k.onTop(ellipse(36 + 24 * ph, 92 + 30 * ph, -12), 0, P, true), (1 - ph) * 0.32));
    }
  }
  if (working) {
    // a wake: dashes running back along a V from the flukes
    for (const side of [-1, 1]) for (let j = 0; j < 6; j++) {
      const f = ((j + t * 2) % 6) / 6, g = Math.min(1, f + 0.07);
      const pt = (u) => [side * (4 + 30 * u), Y_TAIL - 10 - 62 * u];
      out.push(ripple(k.lineOnTop(pt(f), pt(g), 0, P), 0.55 * (1 - f), 1));
    }
  }

  // ---- the body: one turned profile cut into tail, middle (under the board) and head bands
  const profile = Array.from({ length: 41 }, (_, i) => { const sv = (i / 40) * ORCA_L; return [sv, orcaR(sv)]; });
  const cutBack = sOf(PL.y), cutFront = sOf(PL.y + PL.d);
  const body = G.bandsOf(profile, [cutBack, cutFront], F, P, { radius: orcaR, slope: orcaSlope, steps: 84, rows: 6 });
  const [tail, mid, head] = body.bands;
  const band = (b, name, extra = "", bias = 0) => {
    const sides = body.sidesOf(b.s0, b.s1);
    put(name, G.pointOf(F, (b.s0 + b.s1) / 2, orcaR((b.s0 + b.s1) / 2) * 0.4, Math.PI / 2),
      S(b.paths, { tone: "mid", crease: "none", inner: extra }) + L(sides.d, { tone: "hi" }),
      [rec(A.solid(F, b.profile, { radius: orcaR, name, owner: "orca", ground: true }))], bias);   // the sea carries it
  };

  // markings: a white flank sweep, the eye patch, the eye and the mouth, on the side facing us
  const surf = (sv, ang, lift = 0.25) => G.pointOf(F, sv, orcaR(sv) + lift, ang);
  const patch = (s0, s1, lo, hi0, hi1, fill) => {
    const n = 10, pts = [];
    for (let i = 0; i <= n; i++) { const sv = mix(s0, s1, i / n); pts.push(surf(sv, mix(hi0, hi1, i / n))); }
    for (let i = n; i >= 0; i--) { const sv = mix(s0, s1, i / n); pts.push(surf(sv, lo + 0.08 * Math.sin((Math.PI * i) / n))); }
    return `<path d="${path3(pts, true)}" fill="${fill}" stroke="none"/>`;
  };
  const markV = T.marks ?? 0;
  const flank = patch(cutBack - 30, cutBack - 2, -0.62, -0.18 + 0.1 * markV, 0.22 + 0.1 * markV, "#ece9e2");
  const eyeS = cutFront + 10.5, eyeA = 0.2;
  const eyePatch = patch(cutFront + 0.8, cutFront + 9.2, 0.34, 0.62 + 0.08 * markV, 0.5, "#f1eee8");
  const eye = at(surf(eyeS, eyeA, 0.3));
  const eyeSvg = asleep
    ? L(path3([surf(eyeS - 1.2, eyeA - 0.02, 0.3), surf(eyeS + 1.2, eyeA + 0.02, 0.3)]), { tone: "hi", free: true })
    : `<circle cx="${eye[0].toFixed(2)}" cy="${eye[1].toFixed(2)}" r="1.15" fill="#08080b"/><circle cx="${(eye[0] + 0.35).toFixed(2)}" cy="${(eye[1] - 0.4).toFixed(2)}" r="0.35" fill="#ffffff"/>`;
  const mouth = L(path3(Array.from({ length: 8 }, (_, i) => surf(cutFront + 3 + i * 1.7, -0.12 + 0.05 * Math.sin((i / 7) * Math.PI), 0.3))), { tone: "lo", free: true });

  band(tail, "orca.tail", flank, -1);
  band(mid, "orca.mid", L([cutBack + 5, cutFront - 5].map((sv) => G.arcOf(F, sv, orcaR(sv) + 0.2, P, { slope: orcaSlope(sv) })).join(""), { tone: "lo" }), -0.5);
  band(head, "orca.head", eyePatch + eyeSvg + mouth, 0.5);

  // dorsal fin, tall and swept back, behind the board
  const yFin = PL.y - 18;
  const Ff = G.frameOf([0, yFin, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
  // a short base chord that lies on the back's gentle curve, so the fin stands on it, not in it
  const fin = [[-10, backAt(yFin - 10) - 0.2], [10, backAt(yFin + 10) - 0.2], [4, backAt(yFin) + 24], [-12, backAt(yFin) + 44]];
  put("orca.fin", [0, yFin - 4, backAt(yFin) + 16], S(G.prismOf(Ff, fin, -1.8, 1.8, P), { tone: "mid" }), [rec(A.prism(Ff, fin, -1.8, 1.8, { name: "orca.fin", owner: "orca" }))], 0.2);

  // flukes: two flat blades at the tail, beating while the orca swims
  const beat = working ? 0.24 * Math.sin(TAU * t * 2) : asleep ? 0 : attention ? 0.12 * Math.sin(TAU * t * 2) : 0.07 * Math.sin(TAU * t);
  const root = [0, Y_TAIL + 3, ZC];
  const Fk = G.frameOf(root, G.unit3([0, Math.sin(beat), Math.cos(beat)]), [1, 0, 0], G.unit3([0, -Math.cos(beat), Math.sin(beat)]));
  for (const side of [1, -1]) {
    const blade = side > 0 ? [[0, 0], [30, 14], [24, 22], [0, 12]] : [[0, 0], [0, 12], [-24, 22], [-30, 14]];
    put(`orca.fluke`, G.add3(root, [side * 14, -10, 0]), S(G.prismOf(Fk, blade, -1.2, 1.2, P), { tone: "mid" }), [rec(A.prism(Fk, blade, -1.2, 1.2, { name: `orca.fluke${side}`, owner: "orca" }))], 0.1);
  }

  // the pectoral fin on the side facing us, half in the water
  const sp = cutFront - 22;
  const Fp = G.frameOf(surf(sp, -0.3, -0.6), G.unit3(G.cross3(G.unit3([0.86, 0, -0.5]), [0, 1, 0])), G.unit3([0.86, 0, -0.5]), [0, 1, 0]);
  const pec = [[0, -7], [0, 6], [15, 3], [22, -5], [15, -11]];
  put("orca.pec", Fp.o, S(G.prismOf(Fp, pec, -0.9, 0.9, P), { tone: "mid" }), [rec(A.prism(Fp, pec, -0.9, 0.9, { name: "orca.pec", owner: "orca" }))], 0.3);

  // the saddle: a lacquered board on the back, wooden blocks under its ends, a brass name plate
  for (const y of [PL.y + 7, PL.y + PL.d - 7]) {
    const plan = { x: -5, y: y - 4, w: 10, d: 8, r: 1 };
    const z0 = Math.max(backAt(y - 4), backAt(y + 4)) - 0.3;   // resting on the back
    put("saddle.block", [0, y, (z0 + BOARD_Z) / 2], S(k.slabOf(plan, z0, BOARD_Z - z0, P, 2, 0.4), { tone: "mid" }), [rec(A.slab(plan, z0, BOARD_Z - z0, { name: "saddle.block", owner: "orca" }, 2))], 0.4);
  }
  if (T.plinth === "hex") {
    const lip = HEX.map(([x, y]) => [x * (HEX_R + 1.6) / HEX_R, y * (HEX_R + 1.6) / HEX_R]);
    put("board", [0, 0, BOARD_Z + BODY / 2], S(k.extrude(HEX, BOARD_Z, BODY, P, { bevel: 0.6 }), { tone: "mid" }), [rec(A.extruded(HEX, BOARD_Z, BODY, { name: "board", owner: "orca" }))], 1);
    put("board.lip", [0, 0, BOARD_Z + BODY + 1], S(k.extrude(lip, BOARD_Z + BODY, 2, P, { bevel: 0.6 }), { tone: "mid" }) +
      L(k.onTop(HEX.map(([x, y]) => [x * 0.92, y * 0.92]), TOP, P, true), { tone: "faint" }) + D(HEX.map(([x, y]) => at([x * 0.96, y * 0.96, TOP])), { size: 0.55 }),
      [rec(A.extruded(lip, BOARD_Z + BODY, 2, { name: "board.lip", owner: "orca" }))], 1.1);
    namePlate(T, put, rec, -6, HEX_FRONT);
  } else {
    put("board", [0, 0, BOARD_Z + BODY / 2], S(k.slabOf(PL, BOARD_Z, BODY, P, 6, 0.6), { tone: "mid" }), [rec(A.slab(PL, BOARD_Z, BODY, { name: "board", owner: "orca" }, 6))], 1);
    put("board.lip", [0, 0, BOARD_Z + BODY + 1], S(k.slabOf(k.insetPlan(PL, -1.6), BOARD_Z + BODY, 2, P, 6, 0.6), { tone: "mid" }) +
      L(k.planOutline(k.insetPlan(PL, 3.2), TOP, P, 6), { tone: "faint" }) + D(k.corners(PL, 1.6).map(([x, y]) => at([x, y, TOP])), { size: 0.55 }),
      [rec(A.slab(k.insetPlan(PL, -1.6), BOARD_Z + BODY, 2, { name: "board.lip", owner: "orca" }, 6))], 1.1);
    namePlate(T, put, rec, -10, PL.y + PL.d);
  }

  // the spout, when an agent needs you: a fan of spray from the blowhole on the head
  const spoutH = attention ? 52 * Math.sin(Math.PI * ((t * 2) % 1)) : 0;
  if (spoutH > 4) {   // between spouts there is no spray at all
    const hole = G.pointOf(F, cutFront + 12, orcaR(cutFront + 12) * 0.98, Math.PI / 2 - 0.12);
    const h = spoutH;
    let spray = "";
    const jets = [];
    for (let i = -2; i <= 2; i++) {
      const pts3 = Array.from({ length: 9 }, (_, j) => { const u = j / 8; return [hole[0] + i * 3.2 * u * u, hole[1] + i * 1.2 * u, hole[2] + 2.2 + Math.max(0.5, h) * u - 6 * u * u * Math.abs(i) * 0.4]; });
      spray += k.fadeLineSvg(pts3.map(at), { fade: [2, 6], tone: "hi" });
      jets.push(A.tube(pts3, 0.5, { name: "spout" }));
    }
    const drops = [-6, -3, 0, 3, 6].map((dx, i) => at([hole[0] + dx * 1.4, hole[1] + dx * 0.5, hole[2] + h * (0.9 - 0.08 * Math.abs(dx)) + (i % 2) * 2]));
    put("spout", hole, `<g style="--anatomy-hi:#d6e8ff">${spray}</g>` + drops.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="0.9" fill="#d6e8ff" opacity="0.8"/>`).join(""), jets, 0.5);
  }

  // the near water surface, over whatever is below the waterline on the side facing us
  const wl = [];
  const FAR_END = 0.9;
  for (let i = 0; i <= 60; i++) {
    const sv = 1 + (i / 60) * (ORCA_L - 1.5);
    const r = orcaR(sv);
    if (r <= ZC) continue;
    if (VIEWER[1] < 0 && sv > ORCA_L * FAR_END) continue;   // from behind, the nose is the far end: hidden by the head
    // on whichever flank faces the camera (+x from the front, -x from behind)
    wl.push(G.pointOf(F, sv, r, VIEWER[0] >= 0 ? -Math.asin(ZC / r) : Math.PI + Math.asin(ZC / r)));
  }
  // down to the body's underside at each ring, so the surface covers only what is submerged
  const deep = wl.map((p) => { const sv = p[1] - Y_TAIL; return [p[0] + 1.5 * Math.sign(VIEWER[0]), p[1] + 1.5 * Math.sign(VIEWER[1]), -(orcaR(sv) - ZC) - 2]; }).reverse();
  const foamPts = wl.map(at);
  // its true shape is the patch of water plane in front of the waterline that hides the
  // submerged body: each deep point seen through the surface lands d·cot(30°) nearer the viewer
  const look = VIEWER;
  const lift = (p) => [p[0] - p[2] * Math.sqrt(3) * look[0], p[1] - p[2] * Math.sqrt(3) * look[1]];
  // In short lengths along the body, each ordered on its own: seen from behind, the water
  // by the far (head) end lies behind the nearer, dry middle of the body, while further back
  // it covers the submerged flank, so one patch can't be both. Neighbours overlap by a ring.
  const down = [...deep].reverse();     // deep[i] under wl[i]
  const PIECES = 10;
  const cut = (j) => Math.round((j / PIECES) * (wl.length - 1));
  for (let j = 0; j < PIECES; j++) {
    const i0 = Math.max(0, cut(j) - (j ? 1 : 0)), i1 = cut(j + 1);
    const top = wl.slice(i0, i1 + 1), under = down.slice(i0, i1 + 1).reverse();
    const plane = [...top.map((p) => [p[0], p[1]]), ...under.map(lift)];
    const shape = A.extruded(plane, -0.06, 0.06, { name: `water.front:${j}` });
    const mid = top[Math.floor(top.length / 2)];
    put(`water.front:${j}`, [mid[0], mid[1], -6], `<path d="${path3([...top, ...under], true)}" fill="#1b2c54" opacity="0.94"/>` +
      `<path d="${k.pathOf(foamPts.slice(i0, i1 + 1))}" fill="none" stroke="#dbe8ff" stroke-width="0.9" stroke-linecap="round" opacity="0.55"/>`, [shape], 0.2);
  }
}

/** The host's initials on a brass plate, screwed to the board's front edge. */
function namePlate(T, put, rec, cx, faceY) {
  const plan = { x: cx - 9, y: faceY, w: 18, d: 0.8, r: 0.3 };
  const z0 = BOARD_Z + 0.6, h = BODY - 1.2;
  const fy = faceY + 0.8;
  put("nameplate", [cx, faceY + 0.4, z0 + h / 2], S(k.slabOf(plan, z0, h, P, 2, 0.2), { tone: "lo" }) +
    k.faceTextSvg(k.sideMatrix([cx, fy], z0 + 0.9, P, "left"), T.monogram, { size: 3.1, tone: "lo", anchor: "middle" }) +
    D([[cx - 7.6, fy, z0 + h / 2], [cx + 7.6, fy, z0 + h / 2]].map(at), { size: 0.45 }),
    [rec(A.slab(plan, z0, h, { name: "nameplate", owner: "orca" }, 2))], 1.3);
}

// ---------------------------------------------------------------- the sage

function face(head, r, bow, T) {
  const dir = (phi, e) => [Math.sin(phi) * Math.cos(e), Math.cos(phi) * Math.cos(e), Math.sin(e)];
  const on = (phi, e) => G.add3(head, G.mul3(dir(phi, e), r));
  const visible = (phi, e) => G.dot3(dir(phi, e), V) > 0.15;
  const down = bow ? -0.22 : 0;
  const arc = (a0, a1, e, bend) => {
    const pts = [];
    for (let i = 0; i <= 6; i++) { const a = mix(a0, a1, i / 6); pts.push(on(a, e + down - bend * Math.sin((Math.PI * i) / 6))); }
    return pts.every(([x, y, z]) => true) && visible((a0 + a1) / 2, e) ? path3(pts) : "";
  };
  const deg = Math.PI / 180;
  let s = "";
  s += L(arc(-38 * deg, -14 * deg, -4 * deg, 0.05) + arc(14 * deg, 38 * deg, -4 * deg, 0.05), { tone: "mid", free: true });
  if (T.hat !== "kasa") s += L(arc(-44 * deg, -12 * deg, 12 * deg, -0.06) + arc(12 * deg, 44 * deg, 12 * deg, -0.06), { tone: "hi", free: true });
  return s;
}

function beard(put, rec, head, r, bow) {
  // hung from the chin: the beard's top rim rests on the head's sphere
  const axis = G.unit3([0, 0.62 + 0.2 * bow, -1]);
  const TOP_R = 3 * U;
  const chin = G.add3(head, G.mul3(axis, Math.sqrt(r * r - TOP_R * TOP_R)));
  const F = G.frameAlong(chin, axis);
  const profile = [[0, 3], [1.6, 2.7, 1], [4.4, 1.7, 1], [7.6, 0.5, 1], [8.2, 0]].map(([s, r, f]) => (f ? [s * U, r * U, f] : [s * U, r * U]));
  put("beard", G.add3(chin, [0, 0.8, -4]), S(G.solidOf(profile, F, P), { tone: "hi" }),
    [rec(A.solid(F, profile, { name: "beard", owner: "sage" }))], 0.6);
}

function hat(T, put, rec, head, r, bow) {
  const tilt = G.unit3([0, 0.18 * bow, 1]);
  if (T.hat === "kasa") {
    const F = G.frameAlong(G.add3(head, G.mul3(tilt, 3.2 * U)), tilt);
    const profile = [[0, 14.6], [0.5, 14.3, 1], [2.2, 10.6, 1], [6, 2.4, 1], [6.9, 0]].map(([s, r, f]) => (f ? [s * U, r * U, f] : [s * U, r * U]));
    const ribs = G.ribsOf(F, 0.5 * U, 5.6 * U, 14.3 * U, 30, P, { r1: 3.2 * U, fade: [0.1, 0.55] });
    put("hat", G.add3(head, [0, 0, 6.5]), S(G.solidOf(profile, F, P), { tone: "hi", inner: k.fadedSvg(ribs, { tone: "lo" }) }) +
      L(G.arcOf(F, 0.5 * U, 14.3 * U, P, { slope: -2.2 }), { tone: "lo" }),
      [rec(A.solid(F, profile, { name: "hat", owner: "sage" }))], 1);
  } else if (T.hat === "eboshi") {
    const base = 4.4 * U;           // the cap's rim rests on the head's sphere
    const F = G.frameAlong(G.add3(head, G.mul3(tilt, Math.sqrt(r * r - base * base))), tilt);
    const profile = [[0, 4.4], [3.6, 4.7, 1], [8.4, 4.3, 1], [11.2, 3, 1], [12.4, 0]].map(([s, r, f]) => (f ? [s * U, r * U, f] : [s * U, r * U]));
    put("hat", G.add3(head, [0, 0, 13]), S(G.solidOf(profile, F, P), { tone: "mid", inner: L(G.arcOf(F, 1.4 * U, 4.55 * U, P), { tone: "lo" }) }),
      [rec(A.solid(F, profile, { name: "hat", owner: "sage" }))], 1);
  } else if (T.hat === "topknot") {
    // a band whose rim rests on the crown, tipped toward the back, and the bun resting on the band's rim
    const axis = G.unit3([0, -0.38 + 0.18 * bow, 1]);
    const BAND_R = 2.1, BAND_H = 1.5, BUN_R = 2.4 * U;
    const F = G.frameAlong(G.add3(head, G.mul3(axis, Math.sqrt(r * r - BAND_R * BAND_R))), axis);
    const bun = G.pointOf(F, BAND_H + Math.sqrt(BUN_R * BUN_R - BAND_R * BAND_R), 0, 0);
    put("hat.band", G.pointOf(F, BAND_H / 2, 0, 0), S(G.disc(0, BAND_H, BAND_R, F, P, { steps: 20 }), { tone: "mid" }), [rec(A.disc(F, 0, BAND_H, BAND_R, { name: "hat.band", owner: "sage" }))], 0.9);
    put("hat", bun, S(G.sphereOf(bun, BUN_R, P, { steps: 32 }), { tone: "hi" }), [rec(A.ball(bun, BUN_R, { name: "hat", owner: "sage" }))], 1);
  } else {
    // nimbus: a turned bronze ring standing behind the head on a short rod
    const c = G.add3(head, [0, -9.4, 1.6]);
    const F = G.frameAlong(c, [0, 1, 0]);
    const dots = G.dotsOf(F, 0.9, 11.4, 14, P, { all: true });
    put("hat", c, S(G.ringBand(0, 0.9, 9.8, 13, F, P, { steps: 72 }), { tone: "mid" }) + D(dots, { size: 0.55 }),
      [rec(A.ring(F, 0, 0.9, 9.8, 13, { name: "hat" }))], -1.5);
    // the rod rises from the torso's back, where the shoulder dome is as far out as the rod
    const rodY = SAGE[1] - 9.8;
    let rs = 12 * U;
    while (rs < TORSO_H && torsoR(rs) > 9.8 - 0.8) rs += 0.05;   // its inner rim touches the dome
    const rodZ = MAT_TOP + TORSO_Z + rs;
    const rod = G.frameAlong([SAGE[0], rodY, rodZ], [0, 0, 1]);
    const rodH = c[2] - 13 - rodZ;
    put("hat.rod", [SAGE[0], rodY, rodZ + rodH / 2], S(G.disc(0, rodH, 0.8, rod, P, { steps: 12 }), { tone: "mid", crease: "none" }),
      [rec(A.disc(rod, 0, rodH, 0.8, { name: "hat.rod" }))], -2);
  }
}

// ---------------------------------------------------------------- desk, scroll, laptop

function desk(T, put, rec, ink) {
  for (const [x, y] of k.corners(DESK, 1.8)) {
    const plan = { x: x - 1.1, y: y - 1.1, w: 2.2, d: 2.2, r: 0.4 };
    put("desk.leg", [x, y, TOP + DESK_LEG / 2], S(k.slabOf(plan, TOP, DESK_LEG - 2, P, 2), { tone: "mid", crease: "none" }), [rec(A.slab(plan, TOP, DESK_LEG - 2, { name: "desk.leg" }, 2))]);
  }
  put("desk.top", [0, DESK.y + DESK.d / 2, DESK_TOP - 1], S(k.slabOf(DESK, DESK_TOP - 2, 2, P, 3, 0.4), { tone: "mid" }), [rec(A.slab(DESK, DESK_TOP - 2, 2, { name: "desk.top" }, 3))], 0.1);
  if (T.desk === "scroll") {
    put("paper", [0, PAPER.y + PAPER.d / 2, DESK_TOP + 0.15], S(k.slabOf(PAPER, DESK_TOP, 0.3, P, 1), { tone: "hi", flat: true }) + ink, [rec(A.slab(PAPER, DESK_TOP, 0.3, { name: "paper" }, 1))], 0.2);
    for (const x of [PAPER.x - 1.3, PAPER.x + PAPER.w + 1.3]) {
      const F = G.frameOf([x, PAPER.y + PAPER.d / 2, DESK_TOP + 1.4], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
      const half = PAPER.d / 2 + 0.6;
      put("roller", [x, PAPER.y + PAPER.d / 2, DESK_TOP + 1.4],
        S(G.disc(-half, half, 1.4, F, P, { steps: 20 }), { tone: "mid" }) +
          S(G.disc(-half - 0.9, -half, 1.9, F, P, { steps: 20 }), { tone: "mid" }) +
          S(G.disc(half, half + 0.9, 1.9, F, P, { steps: 20 }), { tone: "mid" }),
        [rec(A.disc(F, -half - 0.9, half + 0.9, 1.9, { name: "roller" }))], 0.3);
    }
  } else {
    const base = { x: -8.5, y: 9.8, w: 17, d: 10.6, r: 0.8 };
    const keys = k.dotGrid(-6.4, 11.4, 9, 4, 1.6, DESK_TOP + 0.9, P);
    put("laptop", [0, 15.1, DESK_TOP + 0.45], S(k.slabOf(base, DESK_TOP, 0.9, P, 2, 0.3), { tone: "mid" }) +
      L(k.planOutline({ x: -7.4, y: 10.6, w: 14.8, d: 6.4, r: 0.4 }, DESK_TOP + 0.9, P, 2), { tone: "faint" }) + D(keys, { size: 0.4, tone: "lo" }),
      [rec(A.slab(base, DESK_TOP, 0.9, { name: "laptop" }, 2))], 0.2);
    const lid = { x: -8.5, y: 19.8, w: 17, d: 0.7, r: 0.3 };
    put("laptop.lid", [0, 20.2, DESK_TOP + 6], S(k.slabOf(lid, DESK_TOP + 0.9, 10.5, P, 2, 0.3), { tone: "mid" }) +
      D([at([0, 20.5, DESK_TOP + 6.6])], { size: 0.8, tone: "hi" }),
      [rec(A.slab(lid, DESK_TOP + 0.9, 10.5, { name: "laptop.lid" }, 2))], 0.4);
  }
}

/** Where the brush tip is: on a stroke, lifted between strokes, or waiting while the scroll rolls on. */
function penAt(T, state, t) {
  const strokes = columnStrokes(T, PEN_X);
  const start = strokes[0][0];
  if (state !== "working") return { tip: G.add3(start, [1.2, -1.4, 3.2]), stroke: -1, f: 0 };
  const WRITE = 0.72;
  const slot = WRITE / strokes.length;
  if (t < WRITE) {
    const i = Math.min(strokes.length - 1, Math.floor(t / slot));
    const u = (t - i * slot) / slot;
    const [a, b] = strokes[i];
    if (u < 0.7) { const f = smooth(0, 0.7, u); return { tip: mix3(a, b, f), stroke: i, f }; }
    const next = strokes[(i + 1) % strokes.length][0];
    const v = smooth(0.7, 1, u);
    const tip = mix3(b, i + 1 < strokes.length ? next : G.add3(b, [0, 0, 1.6]), v);
    tip[2] += 1.6 * Math.sin(Math.PI * v);
    return { tip, stroke: i, f: 1 };
  }
  const v = smooth(WRITE, 1, t);
  const last = strokes[strokes.length - 1][1];
  const tip = mix3(G.add3(last, [0, 0, 1.6]), start, v);
  tip[2] += 1.6 * Math.sin(Math.PI * v) * 0.6;
  return { tip, stroke: strokes.length, f: 1 };
}

function columnStrokes(T, cx) {
  const out = [];
  T.glyphs.forEach((glyph, cell) => {
    const top = PAPER.y + PAPER.d - 0.7 - cell * (CELL + 0.8);
    for (const [[u0, v0], [u1, v1]] of glyph) {
      out.push([[cx - CELL / 2 + CELL * u0, top - CELL * v0, INK], [cx - CELL / 2 + CELL * u1, top - CELL * v1, INK]]);
    }
  });
  return out;
}

/** Ink on the scroll: finished columns roll toward the far roller, the current one grows. */
function writing(T, state, t, uid) {
  const shift = state === "working" ? PITCH * smooth(0.72, 1, t) : 0;
  const pen = penAt(T, state, t);
  const corners = [[PAPER.x, PAPER.y], [PAPER.x + PAPER.w, PAPER.y], [PAPER.x + PAPER.w, PAPER.y + PAPER.d], [PAPER.x, PAPER.y + PAPER.d]].map(([x, y]) => [x, y, INK]);
  const id = `pc-${uid}`;
  let ink = "";
  for (let c = 1; c <= 4; c++) {
    for (const [a, b] of columnStrokes(T, PEN_X - c * PITCH - shift)) ink += path3([a, b]);
  }
  let wet = "";
  if (state === "working") {
    const current = columnStrokes(T, PEN_X - shift);
    current.forEach(([a, b], i) => {
      if (i < pen.stroke) ink += path3([a, b]);
      else if (i === pen.stroke && pen.f > 0.02) wet += path3([a, mix3(a, b, pen.f)]);
    });
  }
  return `<clipPath id="${id}"><path d="${path3(corners, true)}"/></clipPath><g clip-path="url(#${id})">` +
    `<path class="iso-line" data-tone="hi" data-free="both" style="stroke-width:0.9" d="${ink}"/>` +
    (wet ? `<path class="iso-line" data-tone="lit" data-free="both" style="stroke-width:1.1" d="${wet}"/>` : "") + `</g>`;
}

function brush(put, rec, tip, axis, lit) {
  const F = G.frameAlong(tip, axis);
  const profile = [[0, 0.1], [0.4, 0.5, 1], [1.4, 0.88, 1], [2.5, 0.9], [2.5, 1.05], [3.4, 1.05], [3.4, 0.7], [11, 0.7]];
  put("brush", G.add3(tip, G.mul3(axis, 5)), S(G.solidOf(profile, F, P, { steps: 20 }), { tone: "hi", lit }),
    [rec(A.solid(F, profile, { name: "brush" }))], 0.35);
}

// ---------------------------------------------------------------- bowl and mallet

function bowlAndMallet(T, put, rec, state, t, LS, knee) {
  const FC = zUp([BOWL[0], BOWL[1], TOP]);
  const cushion = [[0, 8.4], [1.1, 9.3, 1], [2.1, 8.8, 1], [2.8, 6.6, 1], [2.9, 0]].map(([s, r, f]) => (f ? [s * BU, r * BU, f] : [s * BU, r * BU]));
  put("cushion", [BOWL[0], BOWL[1], TOP + 1.4], S(G.solidOf(cushion, FC, P), { tone: "lo" }), [rec(A.solid(FC, cushion, { name: "cushion" }))], -0.5);
  const BASE = TOP + 2.85 * BU;
  const FB = zUp([BOWL[0], BOWL[1], BASE]);
  const bowl = [[0, 4.4], [1.2, 6, 1], [2.8, 7.4, 1], [4.6, 8.1, 1], [6.2, 8.3]].map(([s, r, f]) => (f ? [s * BU, r * BU, f] : [s * BU, r * BU]));
  const RIM_S = 6.2 * BU, RIM_R = 8.3 * BU, LIP_R = 7.5 * BU;
  const strikeT = 0.5;
  const pulse = state === "attention" ? (t < strikeT ? 0 : 1 - smooth(strikeT, 1, t)) : 0;
  const ring = state === "attention"
    ? `<g style="--anatomy-lit:#ff9a3c"><path class="iso-line" data-tone="lit" style="stroke-width:${(1 + 1.2 * pulse).toFixed(2)};opacity:${(0.45 + 0.55 * pulse).toFixed(2)}" d="${G.circleOf(FB, RIM_S, RIM_R - 0.3, P)}"/></g>`
    : "";
  put("bowl", [BOWL[0], BOWL[1], TOP + 6], S(G.solidOf(bowl, FB, P), { tone: "mid" }) +
    `<path class="sg-void" d="${G.circleOf(FB, RIM_S, LIP_R, P)}"/>` + L(G.circleOf(FB, RIM_S, LIP_R, P), { tone: "lo" }) + ring,
    [rec(A.solid(FB, bowl, { name: "bowl" }))], -0.3);

  // the mallet: resting in the left hand, or swung to strike the rim
  const rest = { hand: knee, dir: G.unit3([-0.5, 0.62, 0.6]) };
  const raised = { hand: [SAGE[0] - 16, SAGE[1] + 9, MAT_TOP + 28], dir: G.unit3([-0.35, 0.3, 0.88]) };
  const rim = [BOWL[0] + RIM_R * 0.83, BOWL[1] + RIM_R * 0.55, BASE + RIM_S];
  const hitDir = G.unit3([-0.55, 0.33, -0.77]);
  const head = G.add3(rim, [1.3, 0.9, 2.1]);
  const strike = { hand: G.sub3(head, G.mul3(hitDir, 10.6)), dir: hitDir };
  const recoil = { hand: G.add3(strike.hand, [0.6, -0.2, 2.4]), dir: G.unit3([-0.5, 0.3, -0.62]) };
  const lerpPose = (a, b, u) => ({ hand: mix3(a.hand, b.hand, u), dir: G.unit3(mix3(a.dir, b.dir, u)) });
  let pose = rest;
  if (state === "attention") {
    if (t < 0.38) pose = lerpPose(rest, raised, smooth(0, 0.38, t));
    else if (t < strikeT) pose = lerpPose(raised, strike, smooth(0.38, strikeT, t));
    else if (t < 0.62) pose = lerpPose(strike, recoil, smooth(strikeT, 0.62, t));
    else pose = lerpPose(recoil, rest, smooth(0.62, 1, t));
  }
  const typing = T.desk === "laptop" && state === "working";
  if (T.desk === "laptop" && state !== "attention") {
    // laid down in front of the cushion when the hands are busy or resting
    const F = G.frameAlong([BOWL[0] + 3, BOWL[1] + 11, TOP + 0.6], G.unit3([1, 0.2, 0]));
    const headC = G.add3(G.pointOf(F, -1.5, 0, 0), [0, 0, 1.2]);
    put("mallet", [BOWL[0] + 8, BOWL[1] + 12, TOP + 0.6], S(G.disc(0, 10, 0.55, F, P, { steps: 12 }), { tone: "mid", crease: "none" }), [rec(A.disc(F, 0, 10, 0.55, { name: "mallet", owner: "mallet" }))], 0.1);
    put("mallet.head", headC, S(G.sphereOf(headC, 1.75, P, { steps: 28 }), { tone: "hi" }), [rec(A.ball(headC, 1.75, { name: "mallet.head", owner: "mallet" }))], 0.15);
    if (!typing) armL(put, LS, knee);
    return;
  }
  const hand = armL(put, LS, pose.hand);
  const F = G.frameAlong(hand, pose.dir);
  const s0 = R_HAND, s1 = R_HAND + 8.6;
  const headC = G.pointOf(F, s1 + 1.8 - 0.25, 0, 0);
  put("mallet", G.pointOf(F, (s0 + s1) / 2, 0, 0), S(G.disc(s0, s1, 0.55, F, P, { steps: 12 }), { tone: "mid", crease: "none" }), [rec(A.disc(F, s0, s1, 0.55, { name: "mallet", owner: "mallet" }))], 0.45);
  put("mallet.head", headC, S(G.sphereOf(headC, 1.8, P, { steps: 28 }), { tone: "hi" }), [rec(A.ball(headC, 1.8, { name: "mallet.head", owner: "mallet" }))], 0.5);

  function armL(put, shoulder, hand) { return jointedArm(null, "arm.l", put, shoulder, hand, -1); }
}

// ---------------------------------------------------------------- lantern or incense

function accessory(T, put, rec, online, t) {
  const [x, y] = LAMP;
  if (T.accessory === "lantern") {
    put("lamp.base", [x, y, TOP + 1], S(k.cylinder(x, y, 4.4, TOP, 2.2, P, 32, 0.4), { tone: "mid" }), [rec(A.cylinder(x, y, 4.4, TOP, 2.2, { name: "lamp.base" }))]);
    put("lamp.post", [x, y, TOP + 7], S(k.cylinder(x, y, 2.1, TOP + 2.2, 10, P, 20), { tone: "mid", crease: "none" }) +
      L(k.sideArc(x, y, 2.1, TOP + 7, P, 16), { tone: "faint" }), [rec(A.cylinder(x, y, 2.1, TOP + 2.2, 10, { name: "lamp.post" }))]);
    const deck = { x: x - 4.9, y: y - 4.9, w: 9.8, d: 9.8, r: 1 };
    put("lamp.deck", [x, y, TOP + 13], S(k.slabOf(deck, TOP + 12.2, 1.8, P, 3, 0.4), { tone: "mid" }), [rec(A.slab(deck, TOP + 12.2, 1.8, { name: "lamp.deck" }, 3))]);
    const box = { x: x - 3.8, y: y - 3.8, w: 7.6, d: 7.6, r: 0.5 };
    const z0 = TOP + 14, z1 = z0 + 7;
    const flicker = 0.78 + 0.12 * Math.sin(TAU * t * 3) + 0.06 * Math.sin(TAU * t * 7 + 1);
    const glow = online ? `class="sg-lamp" style="opacity:${flicker.toFixed(2)}"` : `class="sg-void"`;
    const win = (pts) => `<path ${glow} d="${path3(pts, true)}"/>` + L(path3(pts, true), { tone: "lo" });
    const front = [[x - 2, y + 3.8, z0 + 1], [x + 2, y + 3.8, z0 + 1], [x + 2, y + 3.8, z1 - 1.2], [x - 2, y + 3.8, z1 - 1.2]];
    const side = [[x + 3.8, y + 2, z0 + 1], [x + 3.8, y - 2, z0 + 1], [x + 3.8, y - 2, z1 - 1.2], [x + 3.8, y + 2, z1 - 1.2]];
    put("lamp.box", [x, y, (z0 + z1) / 2], S(k.slabOf(box, z0, 7, P, 2), { tone: "mid" }) + win(front) + win(side),
      [rec(A.slab(box, z0, 7, { name: "lamp.box" }, 2))]);
    const FR = zUp([x, y, z1]);
    const roof = [[0, 6.8], [0.8, 6.8], [1.6, 5.7, 1], [3.4, 3.1, 1], [5.2, 1.2, 1], [5.6, 0]];
    put("lamp.roof", [x, y, z1 + 2.5], S(G.solidOf(roof, FR, P), { tone: "mid" }), [rec(A.solid(FR, roof, { name: "lamp.roof" }))]);
    const tip = [x, y, z1 + 6.6];
    put("lamp.tip", tip, S(G.sphereOf(tip, 1.25, P, { steps: 24 }), { tone: "mid" }), [rec(A.ball(tip, 1.25, { name: "lamp.tip" }))], 0.2);
  } else {
    for (const a of [0.5, 2.6, 4.7]) {
      const lx = x + 3.2 * Math.cos(a), ly = y + 3.2 * Math.sin(a);
      put("censer.leg", [lx, ly, TOP + 0.9], S(k.cylinder(lx, ly, 0.9, TOP, 1.8, P, 12), { tone: "mid", crease: "none" }), [rec(A.cylinder(lx, ly, 0.9, TOP, 1.8, { name: "censer.leg" }))]);
    }
    const FC = zUp([x, y, TOP + 1.8]);
    const pot = [[0, 3.4], [0.4, 4.8, 1], [2.4, 5.6, 1], [4.2, 5.2, 1], [4.8, 5.6], [5.4, 5.6]];
    put("censer", [x, y, TOP + 4], S(G.solidOf(pot, FC, P), { tone: "mid", inner: L(G.arcOf(FC, 4.8, 5.4, P), { tone: "faint" }) }) +
      `<path class="sg-ash" d="${G.circleOf(FC, 5.4, 4.8, P)}"/>`, [rec(A.solid(FC, pot, { name: "censer" }))]);
    let sticks = "";
    let smoke = "";
    const strands = [];
    [[-1.4, -0.6, 0.1], [0.3, 1.2, -0.06], [1.6, -0.4, 0.14]].forEach(([dx, dy, lean], i) => {
      const foot = [x + dx, y + dy, TOP + 1.8 + 5.4];
      const top = G.add3(foot, [lean * 8, -lean * 4, 8.6 - i * 0.8]);
      sticks += L(path3([foot, top]), { tone: "mid" });
      strands.push(A.tube([foot, top], 0.35, { name: "incense" }));
      if (online) {
        sticks += `<circle class="sg-ember" cx="${at(top)[0].toFixed(1)}" cy="${at(top)[1].toFixed(1)}" r="${(0.75 + 0.15 * Math.sin(TAU * (t + i / 3))).toFixed(2)}"/>`;
        const pts3 = [];
        for (let j = 0; j <= 10; j++) {
          const h = 0.6 + j * 2.2;
          pts3.push([top[0] + 1.3 * Math.sin(TAU * (t + j / 7 + i / 3)) * (j / 10), top[1] - 0.4 * j * 0.1, top[2] + h]);
        }
        smoke += k.fadeLineSvg(pts3.map(at), { fade: [1, 9], tone: "lo" });
        strands.push(A.tube(pts3, 0.4, { name: "incense" }));
      }
    });
    put("incense", [x, y, TOP + 12], sticks + smoke, strands, 1);
  }
}

// ---------------------------------------------------------------- pages

export const SAGE_CSS = `
.sg-void{fill:var(--anatomy-shade-0);stroke:none}
.sg-ash{fill:var(--anatomy-shade-2);stroke:var(--anatomy-faint);stroke-width:var(--anatomy-weight)}
.sg-lamp{fill:#ffd38f;stroke:none}
.sg-ember{fill:#ffb15c;stroke:none}
`;

export function describe(T) {
  return describeRider(T);
}
function describeRider(T) {
  const hat = { kasa: "a straw kasa hat", eboshi: "a tall lacquered eboshi cap", topknot: "a topknot", nimbus: "a bronze nimbus ring behind its head" }[T.hat];
  return `A karakuri sage automaton with ${hat}${T.beard ? " and a long beard" : ""}, in a ${T.robe[0]} silk robe, riding an orca. It sits on a ${T.plinth === "hex" ? "hexagonal" : "square"} lacquered saddle board strapped to the orca's back, in front of its tall dorsal fin, with the initials ${T.monogram} on a brass plate. On the board a low desk holds ${T.desk === "laptop" ? "a laptop" : "a scroll between two rollers"}, a singing bowl sits on a cushion at its left and a ${T.accessory === "lantern" ? "stone lantern" : "censer of incense"} stands behind.`;
}
