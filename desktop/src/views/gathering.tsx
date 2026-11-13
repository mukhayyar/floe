// The gathering: every host's sage riding its orca in the sea before the shrine island.
//
// The island and the sea are one picture the proxy renders (/scene.png) with a layout that says
// where the open water is (/scene.json). Over it, each rider swims its own diamond loop along the
// picture's two isometric diagonals, always facing the way it swims (the sheet has the rider from
// the front and from behind; the other two headings are those mirrored). It's all CSS keyframes on
// transforms, so the compositor animates it and the page does no work per frame. Like the Mac
// app's Pod.swift: riders swim faster while their host works, a host that needs you waits at the
// front, an offline one drifts asleep by the island.

import { signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { base } from "../api";
import { attentionAgents, agents, hostMood, hosts, push } from "../store";
import type { HostView, Mood } from "../types";
import { phaseOf } from "./parts";
import { glowFill, SageAvatar, SpriteLoop, swellStyle, useSheet } from "./sage";

interface SageMarks {
  size: number;
  anchorX: number;
  anchorY: number;
}
interface SceneLayout {
  width: number;
  height: number;
  sage: SageMarks;
  sageBack?: SageMarks | null;
  lights: { x: number; y: number; r: number; color: string }[];
  scale?: Record<string, number> | null;
  ocean?: { top: number; bottom: number; left: number; right: number } | null;
  docks?: { x: number; y: number }[] | null;
  calls?: { x: number; y: number }[] | null;
  horizon?: number | null;
  sea?: { top: number; bottom: number } | null;
}

const scene = signal<{ url: string; layout: SceneLayout } | null>(null);
let sceneLoading = false;

function loadScene() {
  if (scene.value || sceneLoading) return;
  sceneLoading = true;
  (async () => {
    try {
      const j = await fetch(`${base}/scene.json`);
      if (j.status === 200) {
        const layout = (await j.json()) as SceneLayout;
        const p = await fetch(`${base}/scene.png`);
        if (p.status === 200) {
          scene.value = { url: URL.createObjectURL(await p.blob()), layout };
          sceneLoading = false;
          return;
        }
      }
    } catch {}
    sceneLoading = false;
    setTimeout(loadScene, 6000);
  })();
}

// MARK: geometry (y down, view pixels)

interface Pt {
  x: number;
  y: number;
}

class Fit {
  scale: number;
  dx: number;
  dy: number;
  constructor(private l: SceneLayout, W: number, H: number) {
    this.scale = Math.max(W / l.width, H / l.height);
    this.dx = (W - l.width * this.scale) / 2;
    this.dy = (H - l.height * this.scale) / 2;
  }
  point(fx: number, fy: number): Pt {
    return { x: fx * this.l.width * this.scale + this.dx, y: fy * this.l.height * this.scale + this.dy };
  }
  length(f: number) {
    return f * this.l.width * this.scale;
  }
}

type Facing = "downLeft" | "downRight" | "upRight" | "upLeft";
const isBack = (f: Facing) => f === "upRight" || f === "upLeft";
const isMirrored = (f: Facing) => f === "downRight" || f === "upLeft";
function facingOf(dx: number, dyDown: number): Facing {
  const up = dyDown <= 0;
  if (dx < 0) return up ? "upLeft" : "downLeft";
  return up ? "upRight" : "downRight";
}

class Sea {
  band: { x: number; y: number; w: number; h: number };
  docks: Pt[];
  calls: Pt[];
  speed: number;
  constructor(l: SceneLayout, fit: Fit, W: number, H: number, sprite: number) {
    const top = fit.point(0, l.ocean?.top ?? 0.5).y;
    const marginX = sprite * 0.34;
    const minY = top + sprite * 0.06;
    const maxY = H - sprite * 0.3;
    this.band = { x: marginX, y: minY, w: Math.max(10, W - marginX * 2), h: Math.max(10, maxY - minY) };
    this.docks = (l.docks ?? []).map((d) => fit.point(d.x, d.y));
    this.calls = (l.calls ?? []).map((c) => {
      const p = fit.point(c.x, c.y);
      return { x: p.x, y: Math.min(p.y, maxY) };
    });
    this.speed = Math.max(10, W / 30);
  }
  dock(i: number): Pt {
    return this.docks.length ? this.docks[i % this.docks.length] : { x: this.band.x + this.band.w / 2, y: this.band.y };
  }
  call(i: number): Pt {
    return this.calls.length ? this.calls[i % this.calls.length] : { x: this.band.x + this.band.w / 2, y: this.band.y + this.band.h * 0.75 };
  }
  /** A host's loop: a diamond with legs along the two diagonals, sized per host, inside the water. */
  lane(i: number, n: number, id: string): { corners: Pt[]; phase: number } {
    const b = this.band;
    const h1 = { x: -0.842, y: 0.539 };
    const h2 = { x: 0.842, y: 0.539 };
    const golden = (i * 0.618034) % 1;
    const maxSpan = Math.min(b.h / 0.539, b.w / 0.842);
    const span = maxSpan * (n === 1 ? 0.9 : n === 2 ? 0.66 : 0.46 + 0.2 * golden);
    const ratio = 0.32 + 0.36 * ((golden + 0.37) % 1);
    const A = span * ratio;
    const B = span - A;
    const t = (i + 0.5) / n;
    const c = { x: b.x + b.w * (0.14 + 0.72 * t), y: b.y + b.h / 2 + b.h * (i % 2 === 0 ? 0.16 : -0.16) };
    const hw = ((A + B) * 0.842) / 2;
    const hh = ((A + B) * 0.539) / 2;
    c.x = Math.min(Math.max(c.x, b.x + hw), b.x + b.w - hw);
    c.y = Math.min(Math.max(c.y, b.y + hh), b.y + b.h - hh);
    const top = { x: c.x - (A * h1.x + B * h2.x) / 2, y: c.y - (A * h1.y + B * h2.y) / 2 };
    const left = { x: top.x + A * h1.x, y: top.y + A * h1.y };
    const bottom = { x: left.x + B * h2.x, y: left.y + B * h2.y };
    const right = { x: bottom.x - A * h1.x, y: bottom.y - A * h1.y };
    const corners = i % 2 === 1 ? [top, right, bottom, left] : [top, left, bottom, right];
    return { corners, phase: phaseOf(id, 1000) };
  }
}

// MARK: keyframes

/** Where each rider's loop started, so a speed change keeps its place on the loop. */
const laps = new Map<string, { key: string; begin: number; duration: number }>();

interface Motion {
  css: string;
  rider: JSX.CSSProperties;
  tag: JSX.CSSProperties;
  flip: JSX.CSSProperties;
  front: JSX.CSSProperties;
  back: JSX.CSSProperties;
}

const px = (v: number) => `${v.toFixed(1)}px`;
const tr = (p: Pt, dy = 0) => `translate3d(${px(p.x)},${px(p.y + dy)},${px(p.y)})`;

function swimMotion(id: string, k: string, corners: Pt[], phase: number, speed: number, tagOffset: number): Motion {
  const legs = corners.map((a, i) => {
    const b = corners[(i + 1) % corners.length];
    return Math.hypot(b.x - a.x, b.y - a.y);
  });
  const total = Math.max(1, legs.reduce((s, v) => s + v, 0));
  const times = [0];
  let run = 0;
  for (const l of legs) {
    run += l;
    times.push(run / total);
  }
  const points = [...corners, corners[0]];
  const facings = corners.map((c, i) => {
    const n = corners[(i + 1) % corners.length];
    return facingOf(n.x - c.x, n.y - c.y);
  });
  const duration = total / speed;
  const laneKey = corners.map((c) => `${c.x.toFixed(0)},${c.y.toFixed(0)}`).join(";");
  const nowS = performance.now() / 1000;
  const prev = laps.get(id);
  let fraction = phase;
  if (prev && prev.key === laneKey) fraction = (((nowS - prev.begin) / prev.duration) % 1 + 1) % 1;
  laps.set(id, { key: laneKey, begin: nowS - fraction * duration, duration });

  const pct = (t: number) => `${(t * 100).toFixed(3)}%`;
  const move = (dy: number) => points.map((p, i) => `${pct(times[i])}{transform:${tr(p, dy)}}`).join("");
  const step = (f: (x: Facing) => string) =>
    facings.map((x, i) => `${pct(times[i])}{${f(x)};animation-timing-function:steps(1,end)}`).join("") + `100%{${f(facings[facings.length - 1])}}`;
  const css =
    `@keyframes swim-${k}{${move(0)}}` +
    `@keyframes tag-${k}{${move(tagOffset)}}` +
    `@keyframes flip-${k}{${step((x) => `transform:scaleX(${isMirrored(x) ? -1 : 1})`)}}` +
    `@keyframes front-${k}{${step((x) => `opacity:${isBack(x) ? 0 : 1}`)}}` +
    `@keyframes back-${k}{${step((x) => `opacity:${isBack(x) ? 1 : 0}`)}}`;
  const anim = (name: string, timing: string) => `${name}-${k} ${duration.toFixed(2)}s ${timing} ${(-fraction * duration).toFixed(2)}s infinite`;
  return {
    css,
    rider: { animation: anim("swim", "linear") },
    tag: { animation: anim("tag", "linear") },
    flip: { animation: anim("flip", "linear") },
    front: { animation: anim("front", "linear") },
    back: { animation: anim("back", "linear") },
  };
}

function parkMotion(id: string, p: Pt, f: Facing, tagOffset: number): Motion {
  laps.delete(id);
  return {
    css: "",
    rider: { transform: tr(p) },
    tag: { transform: tr(p, tagOffset) },
    flip: { transform: `scaleX(${isMirrored(f) ? -1 : 1})` },
    front: { opacity: isBack(f) ? 0 : 1 },
    back: { opacity: isBack(f) ? 1 : 0 },
  };
}

// MARK: views

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function subtitle(h: HostView) {
  if (!h.online) return "asleep";
  const n = h.projects.length;
  const a = h.counts.agents;
  const bits = [`${n} project${n === 1 ? "" : "s"}`];
  if (a > 0) bits.push(`${a} agent${a === 1 ? "" : "s"}`);
  return bits.join(" · ");
}

export function GatheringView() {
  useEffect(loadScene, []);
  const [ref, size] = useSize<HTMLDivElement>();
  const s = scene.value;
  const working = agents.value.filter((a) => a.state === "working").length;
  const attention = attentionAgents.value.length;
  const list = hosts.value.slice(0, 10);
  return (
    <div class="gathering" ref={ref}>
      {s && size.w > 20 ? (
        <>
          <img class="scene-img" src={s.url} alt="" draggable={false} />
          <SceneLife layout={s.layout} W={size.w} H={size.h} />
          <Pod list={list} layout={s.layout} W={size.w} H={size.h} />
          <div class="pond-status">
            <i style={{ background: attention > 0 ? "var(--orange)" : working > 0 ? "var(--blue)" : "rgba(255,255,255,.5)" }} />
            <span style={{ color: attention > 0 ? "var(--orange)" : "rgba(255,255,255,.88)" }}>
              {attention > 0
                ? `${attention} agent${attention === 1 ? "" : "s"} need${attention === 1 ? "s" : ""} you`
                : working > 0
                  ? `${working} agent${working === 1 ? "" : "s"} at work`
                  : `${hosts.value.length} sage${hosts.value.length === 1 ? "" : "s"} cruising`}
            </span>
          </div>
        </>
      ) : (
        <div class="gathering-wait">
          {list.map((h) => (
            <button key={h.id} class="seat bare" onClick={() => push({ kind: "host", host: h.id })} title={h.name}>
              <SageAvatar id={h.id} mood={hostMood(h)} size={84} />
              <span class="rider-tag static">
                <b>{h.name}</b>
                <small>{subtitle(h)}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Pod({ list, layout, W, H }: { list: HostView[]; layout: SceneLayout; W: number; H: number }) {
  const fit = new Fit(layout, W, H);
  const n = Math.max(1, list.length);
  const sprite = fit.length(layout.sage.size) * (layout.scale?.[String(n)] ?? 1.5);
  const sea = new Sea(layout, fit, W, H, sprite);
  const tagOffset = sprite * 0.24 + 8;
  let docked = 0;
  let called = 0;
  const motions = list.map((h, i) => {
    const mood = hostMood(h);
    const k = `${i}-${Math.round(W)}x${Math.round(H)}`;
    if (mood === "offline") {
      const p = sea.dock(docked++);
      return { h, mood, state: "asleep", m: parkMotion(h.id, p, p.x < W / 2 ? "downRight" : "downLeft", tagOffset) };
    }
    if (mood === "attention") {
      const p = sea.call(called++);
      return { h, mood, state: "attention", m: parkMotion(h.id, p, p.x < W / 2 ? "downRight" : "downLeft", tagOffset) };
    }
    const lane = sea.lane(i, n, h.id);
    const busy = mood === "working" || mood === "thinking";
    return { h, mood, state: busy ? "working" : "idle", m: swimMotion(h.id, k + (busy ? "w" : "i"), lane.corners, lane.phase, sea.speed * (busy ? 2.1 : 1), tagOffset) };
  });
  const front = layout.sage;
  const back = layout.sageBack ?? { ...front, anchorX: 1 - front.anchorX };
  return (
    <>
      <style>{motions.map((x) => x.m.css).join("")}</style>
      <div class="pod">
        {motions.map(({ h, mood, state, m }) => (
          <Rider key={h.id} host={h} mood={mood} state={state} m={m} sprite={sprite} front={front} back={back} />
        ))}
      </div>
      <div class="pod tags">
        {motions.map(({ h, m }) => (
          <div key={h.id} class="rider-tag-pos" style={m.tag}>
            <button class="rider-tag bare" onClick={() => push({ kind: "host", host: h.id })}>
              <b style={{ opacity: h.online ? 1 : 0.55 }}>{h.name}</b>
              <small>{subtitle(h)}</small>
              {h.counts.attention > 0 ? (
                <span class="rider-badge attention">!</span>
              ) : h.counts.working > 0 ? (
                <span class="rider-badge">{h.counts.working}</span>
              ) : null}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function Rider(p: { host: HostView; mood: Mood; state: string; m: Motion; sprite: number; front: SageMarks; back: SageMarks }) {
  const sheet = useSheet(p.host.id);
  const S = p.sprite;
  const glow = glowFill(p.mood);
  const sw = swellStyle(p.host.id, p.mood, S, 0, 0);
  return (
    <div class="rider" style={p.m.rider}>
      {glow && <div class={`rider-glow ${p.mood === "attention" ? "fast" : ""}`} style={{ left: -S * 0.45, top: -S * 0.37, width: S * 0.9, height: S * 0.5, background: glow }} />}
      <div class="swell" style={{ ...sw.bob, transformOrigin: "0 0" }}>
        <div class="swell" style={{ ...sw.rock, transformOrigin: "0 0" }}>
          <div class="flip" style={{ ...p.m.flip, opacity: p.mood === "offline" ? 0.62 : 1 }}>
            {sheet ? (
              <>
                <div class="view" style={{ left: -p.front.anchorX * S, top: -p.front.anchorY * S, ...p.m.front }}>
                  <SpriteLoop sheet={sheet} state={p.state} size={S} />
                </div>
                <div class="view" style={{ left: -p.back.anchorX * S, top: -p.back.anchorY * S, ...p.m.back }}>
                  <SpriteLoop sheet={sheet} state={sheet.loops[`back.${p.state}`] ? `back.${p.state}` : "back.idle"} size={S} />
                </div>
              </>
            ) : (
              <div class="view rider-wait" style={{ left: -S * 0.15, top: -S * 0.3, width: S * 0.3, height: S * 0.3 }} />
            )}
          </div>
        </div>
      </div>
      <button
        class="rider-hit bare"
        title={`${p.host.name}: click to open`}
        style={{ left: -S * 0.34, top: -S * 0.42, width: S * 0.68, height: S * 0.58 }}
        onClick={() => push({ kind: "host", host: p.host.id })}
      />
    </div>
  );
}

/** Lantern light that breathes over the island, and moonlight glinting on the sea. */
function SceneLife({ layout, W, H }: { layout: SceneLayout; W: number; H: number }) {
  const fit = new Fit(layout, W, H);
  const seaTop = fit.point(0, layout.ocean?.top ?? layout.sea?.top ?? 0.5).y;
  const glints = Array.from({ length: 14 }, (_, i) => {
    const r1 = phaseOf(`g${i}x`, 1009);
    const r2 = phaseOf(`g${i}y`, 1013);
    const r3 = phaseOf(`g${i}t`, 1019);
    return { x: r1 * W, y: seaTop + 6 + r2 * Math.max(10, H - seaTop - 12), d: 3.5 + r3 * 3, delay: -r3 * 7 };
  });
  return (
    <div class="scene-life">
      {layout.lights.map((l, i) => {
        const r = fit.length(l.r);
        const p = fit.point(l.x, l.y);
        return (
          <i
            key={i}
            class="lantern"
            style={{
              left: p.x - r,
              top: p.y - r,
              width: r * 2,
              height: r * 2,
              background: `radial-gradient(closest-side, ${l.color}8c, ${l.color}00)`,
              animationDuration: `${1.6 + i * 0.37}s`,
            }}
          />
        );
      })}
      {glints.map((g, i) => (
        <i key={`g${i}`} class="glint" style={{ left: g.x, top: g.y, animationDuration: `${g.d}s`, animationDelay: `${g.delay}s` }} />
      ))}
    </div>
  );
}

