// Each host's karakuri sage, rendered by the proxy as a sprite sheet (one row of frames per
// state). The frames play as a stepped CSS transform, which the compositor runs by itself.

import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { JSX } from "preact";
import { base, enc } from "../api";
import { Icon } from "../icons";
import { native } from "../native";
import type { Mood } from "../types";
import { phaseOf } from "./parts";

export interface Loop {
  row: number;
  n: number;
  secs: number;
}
export interface Sheet {
  url: string;
  cell: number;
  cols: number;
  rows: number;
  loops: Record<string, Loop>;
}

const DEFAULT_LAYOUT = "idle:8:3.2,working:20:2,attention:12:1.3,asleep:4:4,back.idle:8:3.2,back.working:20:2,back.attention:12:1.3,back.asleep:4:4;cell=192;cols=20";

/** "idle:8:3.2,working:20:2,…;cell=192;cols=20" → rows of frames. */
export function parseLayout(layout: string): Omit<Sheet, "url"> {
  const [rowSpec, ...rest] = layout.split(";");
  let cell = 192;
  let cols = 20;
  for (const p of rest) {
    if (p.startsWith("cell=")) cell = Number(p.slice(5)) || cell;
    if (p.startsWith("cols=")) cols = Number(p.slice(5)) || cols;
  }
  const loops: Record<string, Loop> = {};
  const specs = rowSpec.split(",");
  specs.forEach((spec, row) => {
    const [name, n, secs] = spec.split(":");
    if (name && Number(n) > 0) loops[name] = { row, n: Number(n), secs: Number(secs) || 2 };
  });
  return { cell, cols: Math.max(cols, ...Object.values(loops).map((l) => l.n)), rows: specs.length, loops };
}

export const sheets = signal<Record<string, Sheet>>({});
const loading = new Set<string>();

export function loadSheet(id: string, attempt = 0) {
  if (sheets.value[id] || loading.has(id) || attempt > 60) return;
  loading.add(id);
  (async () => {
    let wait = 15000;
    try {
      const r = await fetch(`${base}/sage/${enc(id)}.png`);
      if (r.status === 200) {
        const layout = r.headers.get("x-sage-layout") || DEFAULT_LAYOUT;
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        sheets.value = { ...sheets.value, [id]: { url, ...parseLayout(layout) } };
        loading.delete(id);
        if (attempt === 0 && !r.headers.get("x-sage-layout")) native.log("sage sheet came without x-sage-layout (CORS expose-headers?); using the default layout");
        return;
      }
      if (r.status === 202) wait = (Number(r.headers.get("retry-after")) || 8) * 1000;
    } catch (e) {
      if (attempt === 0) native.log(`couldn't load a sage sheet: ${(e as Error)?.message ?? e}`);
    }
    loading.delete(id);
    setTimeout(() => loadSheet(id, attempt + 1), wait);
  })();
}

export function useSheet(id: string): Sheet | undefined {
  useEffect(() => loadSheet(id), [id]);
  return sheets.value[id];
}

export function stateOf(mood: Mood): string {
  switch (mood) {
    case "offline":
      return "asleep";
    case "attention":
      return "attention";
    case "working":
    case "thinking":
      return "working";
    default:
      return "idle";
  }
}

/** One loop of a sheet at `size` px, clipped to one cell. */
export function SpriteLoop({ sheet, state, size, style }: { sheet: Sheet; state: string; size: number; style?: JSX.CSSProperties }) {
  const loop = sheet.loops[state] ?? sheet.loops["idle"] ?? Object.values(sheet.loops)[0];
  if (!loop) return null;
  const vars = {
    "--x": `${-loop.n * size}px`,
    "--y": `${-loop.row * size}px`,
    width: `${sheet.cols * size}px`,
    height: `${sheet.rows * size}px`,
    backgroundImage: `url(${sheet.url})`,
    animation: loop.n > 1 ? `sprite ${loop.secs}s steps(${loop.n}) infinite` : "none",
    transform: `translate(0, ${-loop.row * size}px)`,
  } as JSX.CSSProperties;
  return (
    <div class="sprite" style={{ width: size, height: size, ...style }}>
      <div class="sprite-sheet" style={vars} />
    </div>
  );
}

const SWELL: Record<string, [number, number, number, number]> = {
  // bob (fraction of size), bob period, rock (degrees), rock period
  working: [0.016, 2.4, 1.8, 3.6],
  attention: [0.02, 1.7, 2.4, 2.6],
  offline: [0.007, 5, 0.7, 7],
  idle: [0.012, 3.4, 1.3, 4.6],
};

export function swellStyle(id: string, mood: Mood, size: number, pivotX = 0.398, pivotY = 0.59) {
  const m = SWELL[mood === "thinking" ? "working" : mood === "done" ? "idle" : mood] ?? SWELL.idle;
  const phase = phaseOf(id);
  return {
    bob: { "--bob": `${m[0] * size}px`, animation: `bob ${m[1]}s ease-in-out ${-phase * m[1]}s infinite alternate` } as JSX.CSSProperties,
    rock: {
      "--rock": `${m[2]}deg`,
      transformOrigin: `${pivotX * 100}% ${pivotY * 100}%`,
      animation: `rock ${m[3]}s ease-in-out ${-((phase + 0.31) % 1) * m[3]}s infinite alternate`,
    } as JSX.CSSProperties,
  };
}

export const RGB = { blue: "102,173,255", orange: "255,161,56", green: "84,219,133", purple: "189,148,255" };

/** The glow under a sage, as a radial gradient (or none when idle or asleep). */
export function glowFill(mood: Mood): string | null {
  const g: [string, number] | null =
    mood === "attention" ? [RGB.orange, 0.42] : mood === "working" ? [RGB.blue, 0.3] : mood === "thinking" ? [RGB.purple, 0.3] : mood === "done" ? [RGB.green, 0.24] : null;
  return g ? `radial-gradient(closest-side, rgba(${g[0]},${g[1]}), rgba(${g[0]},0))` : null;
}

/** A host's sage on its own: the loop for the host's state, riding the swell, over a glow. */
export function SageAvatar({ id, mood, size }: { id: string; mood: Mood; size: number }) {
  const sheet = useSheet(id);
  const glow = glowFill(mood);
  const sw = swellStyle(id, mood, size);
  return (
    <div class="sage" style={{ width: size, height: size }}>
      {glow && <div class={`sage-glow ${mood === "attention" ? "fast" : ""}`} style={{ background: glow }} />}
      <div class="swell" style={sw.bob}>
        <div class="swell" style={sw.rock}>
          {sheet ? (
            <SpriteLoop sheet={sheet} state={stateOf(mood)} size={size} style={{ opacity: mood === "offline" ? 0.62 : 1 }} />
          ) : (
            <div class="sage-placeholder">
              <Icon name="person" size={Math.max(18, size * 0.3)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
