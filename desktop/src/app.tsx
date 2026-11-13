// The island: a black shape hanging from the top edge, as a pill, a peek banner, or the panel.
// The window grows first and the island animates inside it; when it shrinks, the island animates
// first and the window follows, so it never clips mid-animation.

import { useEffect } from "preact/hooks";
import { Icon } from "./icons";
import { native } from "./native";
import {
  border,
  chat,
  collapse,
  compactText,
  expand,
  hosts,
  islandSize,
  liveAgents,
  mood,
  peek,
  pinned,
  presentation,
  proxyOnline,
  proxyState,
  snapshot,
  agents,
  attentionAgents,
  streaming,
  tab,
  TOP_INSET,
} from "./store";
import type { Mood } from "./types";
import { ChatView } from "./views/chat";
import { HostsView } from "./views/hosts";
import { InputBar } from "./views/input";
import { LiveView } from "./views/live";
import { IconButton, MoodIndicator, TabButton, useDrag } from "./views/parts";
import { SettingsView } from "./views/settings";

const EAR = 6;
let windowSize = { w: 0, h: 0 };
let shrinkTimer: number | undefined;

function useWindowLayout() {
  const { w, h } = islandSize.value;
  useEffect(() => {
    const W = w + EAR * 2;
    const H = h + 2;
    clearTimeout(shrinkTimer);
    if (!windowSize.w) {
      windowSize = { w: W, h: H };
      native.layout(W, H);
      return;
    }
    const grow = { w: Math.max(windowSize.w, W), h: Math.max(windowSize.h, H) };
    if (grow.w !== windowSize.w || grow.h !== windowSize.h) {
      windowSize = grow;
      native.layout(grow.w, grow.h);
    }
    if (grow.w !== W || grow.h !== H) {
      shrinkTimer = window.setTimeout(() => {
        windowSize = { w: W, h: H };
        native.layout(W, H);
      }, 380);
    }
  }, [w, h]);
}

const RIM: Record<Mood, [string, number]> = {
  idle: ["191,242,230", 0.45],
  offline: ["142,142,147", 0.45],
  working: ["102,173,255", 0.95],
  attention: ["255,161,56", 0.95],
  done: ["84,219,133", 0.95],
  thinking: ["189,148,255", 0.95],
};

export function App() {
  useWindowLayout();
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && presentation.value === "expanded") {
        e.preventDefault();
        collapse();
      }
    };
    const menu = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("input, textarea, pre, .md")) e.preventDefault();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("contextmenu", menu);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("contextmenu", menu);
    };
  }, []);

  const p = presentation.value;
  const { w, h } = islandSize.value;
  const radius = p === "compact" ? h / 2 : p === "peek" ? 22 : 26;
  const [rgb, strong] = RIM[mood.value];
  const rim = border.value
    ? `linear-gradient(90deg, rgba(${rgb},${strong}), rgba(${rgb},${strong * 0.45}), rgba(${rgb},${strong}))`
    : "linear-gradient(90deg, rgba(255,255,255,.07), rgba(255,255,255,.07))";
  return (
    <div class="stage">
      <div class={`island ${p}`} style={{ width: w + EAR * 2, height: h }}>
        <i class="ear left" />
        <i class="ear right" />
        <div
          class="body"
          style={{
            borderRadius: `0 0 ${radius}px ${radius}px`,
            background: `linear-gradient(#000, #000) padding-box, ${rim} border-box`,
            borderWidth: border.value ? "0 1.4px 1.4px" : "0 1px 1px",
          }}
        >
          <div class="content" key={p} style={{ width: w, height: h }}>
            {p === "compact" ? <Compact /> : p === "peek" ? <PeekView /> : <Expanded />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Compact() {
  const m = mood.value;
  const drag = useDrag(() => expand());
  return (
    <div class="compact" {...drag} title={compactText.value}>
      <MoodIndicator mood={m} size={15} />
      {m === "idle" ? <span class="compact-name">Orca</span> : <span class="compact-text">{compactText.value}</span>}
      <span class="spacer" />
      <TrailingBadge mood={m} />
    </div>
  );
}

function TrailingBadge({ mood: m }: { mood: Mood }) {
  const c = snapshot.value?.counts;
  switch (m) {
    case "attention":
      return <span class="badge" style={{ background: "var(--orange)" }}>{c?.attention || 1}</span>;
    case "working":
      return <span class="badge" style={{ background: "var(--blue)" }}>{c?.working || 1}</span>;
    case "done":
      return <Icon name="check" size={12} style={{ color: "var(--green)" }} />;
    case "thinking":
      return <Icon name="wave" size={12} class="pulse" style={{ color: "var(--purple)" }} />;
    case "idle":
      return c?.total ? <span class="dim count-idle">{c.total}</span> : null;
    default:
      return null;
  }
}

function PeekView() {
  const pk = peek.value;
  const drag = useDrag(() => {
    if (!pk) return;
    if (pk.agentId) expand({ agent: pk.agentId });
    else expand({ tab: "ask" });
  });
  if (!pk) return null;
  return (
    <div class="peek" {...drag} style={{ paddingTop: TOP_INSET + 6 }}>
      <MoodIndicator mood={pk.mood} size={24} />
      <div class="col gap3 grow">
        <div class="peek-title" style={{ color: `var(--${pk.mood === "attention" ? "orange" : pk.mood === "done" ? "green" : pk.mood === "thinking" ? "purple" : "blue"})` }}>
          {pk.title}
        </div>
        <div class="peek-text">{pk.text}</div>
      </div>
    </div>
  );
}

function summary(): string {
  if (!proxyOnline.value) return proxyState.value?.message || "Floe proxy offline";
  const s = snapshot.value;
  if (!s) return "Connecting…";
  if (!s.online) return s.headline;
  const bits: string[] = [];
  const online = s.hosts.filter((h) => h.online && h.counts.workspaces > 0).length;
  if (online > 1) bits.push(`${online} hosts`);
  if (s.counts.attention > 0) bits.push(`${s.counts.attention} need you`);
  if (s.counts.working > 0) bits.push(`${s.counts.working} working`);
  if (s.counts.done > 0) bits.push(`${s.counts.done} done`);
  return bits.length ? bits.join(" · ") : "No agents running";
}

function Expanded() {
  const header = useDrag();
  const band = useDrag(() => collapse());
  const t = tab.value;
  // keep these subscribed so the header counts stay live
  void agents.value;
  void attentionAgents.value;
  void chat.value.length;
  void streaming.value;
  return (
    <div class="expanded">
      <div class="collapse-band" {...band} title="Click to collapse" />
      <div class="header" {...header}>
        <MoodIndicator mood={mood.value} size={16} />
        <div class="col grow min0">
          <span class="header-title">Orca</span>
          <span class="header-sub one">{summary()}</span>
        </div>
        <TabButton title="Live" count={liveAgents.value.length} on={t === "live"} onClick={() => (tab.value = "live")} />
        <TabButton title="Hosts" count={hosts.value.filter((h) => h.online).length} on={t === "hosts"} onClick={() => (tab.value = "hosts")} />
        <TabButton title="Ask" on={t === "ask"} onClick={() => (tab.value = "ask")} />
        <IconButton icon="gear" on={t === "settings"} onClick={() => (tab.value = t === "settings" ? "live" : "settings")} tip="Settings" />
        <IconButton icon={pinned.value ? "pinFill" : "pin"} on={pinned.value} onClick={() => (pinned.value = !pinned.value)} tip="Keep open when clicking elsewhere" />
        <IconButton icon="up" onClick={collapse} tip="Fold up (Esc)" />
      </div>
      <div class="divider" />
      <div class="tab-body">{t === "live" ? <LiveView /> : t === "hosts" ? <HostsView /> : t === "ask" ? <ChatView /> : <SettingsView />}</div>
      {t !== "settings" && <InputBar />}
    </div>
  );
}

export function startApp() {
  if (!native.inTauri) document.body.classList.add("browser");
}
