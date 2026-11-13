// Shared bits: mood indicator, buttons, tags, pebbles, inline markdown, drag-to-move.

import type { ComponentChildren, JSX } from "preact";
import { useRef } from "preact/hooks";
import { Icon, OrcaGlyph } from "../icons";
import { native } from "../native";
import type { Agent, Mood } from "../types";
import { agentMood } from "../store";

export const moodColor: Record<Mood, string> = {
  working: "var(--blue)",
  attention: "var(--orange)",
  done: "var(--green)",
  thinking: "var(--purple)",
  idle: "rgba(255,255,255,0.7)",
  offline: "#8e8e93",
};

export function Spinner({ size = 14, color = "var(--blue)", width }: { size?: number; color?: string; width?: number }) {
  const w = width ?? Math.max(1.5, size * 0.15);
  return <span class="spinner" style={{ width: size, height: size, borderWidth: w, borderColor: color, borderRightColor: "transparent" }} />;
}

export function MoodIndicator({ mood, size = 16 }: { mood: Mood; size?: number }) {
  return (
    <span class="mood" style={{ width: size, height: size }}>
      {mood === "working" && <Spinner size={size} color="var(--blue)" />}
      {mood === "attention" && <Icon name="alert" size={size} class="pulse" style={{ color: "var(--orange)" }} />}
      {mood === "done" && <Icon name="checkCircle" size={size} style={{ color: "var(--green)" }} />}
      {mood === "thinking" && <Icon name="sparkle" size={size} class="pulse" style={{ color: "var(--purple)" }} />}
      {mood === "idle" && (
        <span style={{ color: "rgba(255,255,255,0.85)", display: "flex" }}>
          <OrcaGlyph size={size} />
        </span>
      )}
      {mood === "offline" && <Icon name="bolt" size={size} style={{ color: "#8e8e93" }} />}
    </span>
  );
}

export function ActionButton(p: { title: string; icon: string; prominent?: boolean; onClick: () => void; disabled?: boolean; tip?: string }) {
  return (
    <button
      class={`action ${p.prominent ? "prominent" : ""}`}
      disabled={p.disabled}
      title={p.tip}
      onClick={(e) => {
        e.stopPropagation();
        p.onClick();
      }}
    >
      <Icon name={p.icon} size={11} />
      <span>{p.title}</span>
    </button>
  );
}

export function SmallButton(p: { title: string; icon: string; onClick: () => void }) {
  return (
    <button class="small" onClick={p.onClick}>
      <Icon name={p.icon} size={10} />
      <span>{p.title}</span>
    </button>
  );
}

export function IconButton(p: { icon: string; on?: boolean; onClick: () => void; tip?: string }) {
  return (
    <button class={`iconbtn ${p.on ? "on" : ""}`} title={p.tip} onClick={p.onClick}>
      <Icon name={p.icon} size={11} />
    </button>
  );
}

export function TabButton(p: { title: string; count?: number | null; on: boolean; onClick: () => void }) {
  return (
    <button class={`tab ${p.on ? "on" : ""}`} onClick={p.onClick}>
      {p.title}
      {p.count ? <span class="count">{p.count}</span> : null}
    </button>
  );
}

export const Tag = ({ text }: { text: string }) => <span class="tag">{text}</span>;

export function SectionTitle({ text, count }: { text: string; count: number }) {
  return (
    <div class="section-title">
      <span>{text.toUpperCase()}</span>
      {count > 0 && <span>{count}</span>}
      <i />
    </div>
  );
}

export function Toggle(p: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; children: ComponentChildren }) {
  return (
    <label class={`toggle ${p.disabled ? "disabled" : ""}`}>
      <span class="toggle-text">{p.children}</span>
      <input type="checkbox" checked={p.on} disabled={p.disabled} onChange={(e) => p.onChange((e.target as HTMLInputElement).checked)} />
      <span class="switch" />
    </label>
  );
}

export function AgentDots({ agents }: { agents: Agent[] }) {
  return (
    <span class="dots">
      {agents.slice(0, 6).map((a) => (
        <i key={a.id} style={{ background: moodColor[agentMood(a)] }} />
      ))}
      {agents.length > 6 && <span>+{agents.length - 6}</span>}
    </span>
  );
}

// MARK: seeds, stones, tints

export function fnv(s: string): bigint {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(s)) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h;
}

/** A stable 0..1 from a string (the Mac app's `fnv(id) % 997 / 997`). */
export const phaseOf = (s: string, mod = 997) => Number(fnv(s) % BigInt(mod)) / mod;

const STONES: [string, string][] = [
  ["#5c6170", "#383b42"],
  ["#707d8f", "#474f5e"],
  ["#a89175", "#73614c"],
  ["#5c877a", "#385c52"],
  ["#9e7366", "#6b4a42"],
  ["#8c8c91", "#5c5c61"],
];

export function monogram(name: string) {
  const parts = name.split(/[-_ ./]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const caps = name.replace(/[^A-Z]/g, "");
  if (caps.length >= 2) return caps.slice(0, 2);
  return name.slice(0, 2).toUpperCase();
}

export function Pebble({ name, glow, width = 46 }: { name: string; glow?: string | null; width?: number }) {
  const seed = fnv(name);
  const [a, b] = STONES[Number(seed % BigInt(STONES.length))];
  const r = (i: number) => 42 + Number((seed >> BigInt((i * 5) % 60)) & 0xfn);
  const radius = `${r(0)}% ${100 - r(1)}% ${r(2)}% ${100 - r(3)}% / ${r(4)}% ${r(5)}% ${100 - r(6)}% ${100 - r(7)}%`;
  return (
    <span
      class="pebble"
      style={{
        width,
        height: width * 0.68,
        borderRadius: radius,
        background: `linear-gradient(135deg, ${a}, ${b})`,
        boxShadow: glow ? `0 0 7px ${glow}, inset 0 0 0 1.6px ${glow}` : "0 1px 3px rgba(0,0,0,.45), inset 0 0 0 0.6px rgba(255,255,255,.1)",
        fontSize: width * 0.24,
      }}
    >
      {monogram(name)}
    </span>
  );
}

const TINTS: [string, string][] = [
  ["#122129", "#0a1217"],
  ["#17172b", "#0d0d1a"],
  ["#14211a", "#0a120d"],
  ["#261a17", "#140d0d"],
  ["#1f1a26", "#0f0d17"],
];
export const zoneTint = (seed: string) => TINTS[Number(fnv(seed) % BigInt(TINTS.length))];

// MARK: inline markdown (bold, italics, code, links), escaped first

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function mdInline(s: string): string {
  let h = esc(s);
  const codes: string[] = [];
  h = h.replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  h = h
    .replace(/\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" data-ext="1">$1</a>')
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<i>$2</i>")
    .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<i>$2</i>");
  return h.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
}

export function Md({ text, class: cls, style }: { text: string; class?: string; style?: JSX.CSSProperties }) {
  return (
    <div
      class={`md ${cls ?? ""}`}
      style={style}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest("a[data-ext]") as HTMLAnchorElement | null;
        if (a) {
          e.preventDefault();
          native.openUrl(a.href);
        }
      }}
      dangerouslySetInnerHTML={{ __html: mdInline(text) }}
    />
  );
}

// MARK: drag along the top edge

const INTERACTIVE = "button, input, textarea, select, a, label, .no-drag";

/** Horizontal drag that moves the window along the top edge; a press without a drag is a click. */
export function useDrag(onClick?: () => void) {
  const st = useRef<{ x: number; id: number; dragging: boolean } | null>(null);
  return {
    onPointerDown(e: PointerEvent) {
      if (e.button !== 0 || (e.target as HTMLElement).closest(INTERACTIVE)) return;
      st.current = { x: e.screenX, id: e.pointerId, dragging: false };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    onPointerMove(e: PointerEvent) {
      const s = st.current;
      if (!s || s.id !== e.pointerId) return;
      const dx = e.screenX - s.x;
      if (!s.dragging && Math.abs(dx) > 3) {
        s.dragging = true;
        document.body.classList.add("dragging");
        native.dragBegin();
      }
      if (s.dragging) native.dragMove(dx);
    },
    onPointerUp(e: PointerEvent) {
      const s = st.current;
      if (!s || s.id !== e.pointerId) return;
      st.current = null;
      if (s.dragging) {
        document.body.classList.remove("dragging");
        native.dragEnd();
      } else {
        onClick?.();
      }
    },
    onPointerCancel() {
      if (st.current?.dragging) {
        document.body.classList.remove("dragging");
        native.dragEnd();
      }
      st.current = null;
    },
  };
}
