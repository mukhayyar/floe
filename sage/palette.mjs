// Colour for the karakuri sages, through the anatomy kit's own tokens: a material is a
// group that redefines --anatomy-paper/top/shade-0..3 and the line tones as a ramp of one
// base colour, so the kit's four facing tones, creases and outlines still do the shading.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const css = (c) => `#${c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("")}`;
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
const BLACK = [0, 0, 0], WHITE = [255, 255, 255];

/** CSS custom properties for one material. Dark materials get light edges, light ones dark edges. */
export function material(base, { edge, ink } = {}) {
  const c = hex(base);
  const dark = lum(c) < 0.2;
  const line = (t) => css(dark ? mix(c, WHITE, t) : mix(c, BLACK, t));
  const v = {
    paper: css(mix(c, BLACK, 0.2)),
    face: css(mix(c, BLACK, 0.1)),
    top: css(mix(c, WHITE, 0.14)),
    "shade-0": css(mix(c, BLACK, 0.44)),
    "shade-1": css(mix(c, BLACK, 0.31)),
    "shade-2": css(mix(c, BLACK, 0.19)),
    "shade-3": css(mix(c, BLACK, 0.07)),
    "lit-top": css(mix(c, WHITE, 0.32)),
    "lit-shade": css(mix(c, WHITE, 0.12)),
    hi: edge ?? line(dark ? 0.62 : 0.58),
    mid: ink ?? line(dark ? 0.42 : 0.42),
    lo: line(dark ? 0.26 : 0.3),
    faint: line(dark ? 0.14 : 0.18),
  };
  return Object.entries(v).map(([k, x]) => `--anatomy-${k}:${x}`).join(";");
}

/** Silk for the robe: traditional Japanese dye colours, a little muted so they sit at night. */
export const ROBES = [
  ["shu", "#c4553c"],        // vermilion
  ["ai", "#3a5794"],         // indigo
  ["moegi", "#6f9a3f"],      // young-leaf green
  ["yamabuki", "#d29a2e"],   // kerria gold
  ["murasaki", "#7b5297"],   // purple
  ["asagi", "#2f8f9b"],      // pale-onion teal
  ["sakura", "#c4697f"],     // cherry
  ["matcha", "#8c9a4e"],     // tea
];
/** Lacquer for the plinth. */
export const LACQUERS = [
  ["urushi", "#2a2321"],     // black lacquer
  ["shu-urushi", "#9a3526"], // red lacquer
  ["keyaki", "#7d5434"],     // zelkova wood
];

const M = {
  skin: material("#efe6d6", { edge: "#6b5a4c", ink: "#2b2220" }),   // white gofun face, ink-drawn eyes
  hair: material("#1f1b1c"),
  beard: material("#e6e1d8", { edge: "#857a6e" }),
  brass: material("#b98b3e"),
  bronze: material("#9a6a3a"),
  gold: material("#d2a640"),
  wood: material("#86553a"),
  bamboo: material("#c2a96a"),
  washi: material("#efe6d1", { edge: "#3a2e26", ink: "#2a2220" }),
  silver: material("#a3a8ae"),
  stone: material("#8c8780"),
  straw: material("#c9a45c"),
  lacquerBlack: material("#1e1b1d"),
  tatami: material("#a9a46e"),
  zabuton: material("#6e2d3c"),
  felt: material("#8b3a2e"),
  orca: material("#1f1f25", { edge: "#9aa3b5" }),
};

/** Which material each drawn item wears, by name. */
export function paletteOf(T) {
  const robe = material(T.robe[1]);
  const lacquer = material(T.lacquer[1]);
  const hat = { kasa: M.straw, eboshi: M.lacquerBlack, topknot: M.hair, nimbus: M.gold }[T.hat];
  const rules = [
    [/^orca\./, M.orca],
    [/^(board|board\.lip)$/, lacquer],
    [/^nameplate$/, M.brass],
    [/^saddle\./, M.wood],
    [/^mat$/, M.tatami],
    [/^(lap|torso)$/, robe],
    [/^arm\.[rl]\.(upper|fore|shoulder|elbow)/, robe],
    [/^arm\.[rl]\.hand$/, M.skin],
    [/^(neck|head)$/, M.skin],
    [/^beard$/, M.beard],
    [/^hat$/, hat],
    [/^hat\.(band|rod)$/, M.gold],
    [/^desk\./, M.wood],
    [/^roller$/, M.wood],
    [/^paper$/, M.washi],
    [/^laptop/, M.silver],
    [/^brush$/, M.bamboo],
    [/^cushion$/, M.zabuton],
    [/^bowl$/, M.bronze],
    [/^mallet$/, M.wood],
    [/^mallet\.head$/, M.felt],
    [/^lamp\./, M.stone],
    [/^censer/, M.bronze],
    [/^incense$/, M.wood],
  ];
  return {
    of: (name) => rules.find(([re]) => re.test(name))?.[1] ?? null,
    lacquer,
    brass: M.brass,
  };
}
