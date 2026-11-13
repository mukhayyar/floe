// Everything the island shows and does: a port of the Mac app's IslandStore.

import { batch, computed, effect, signal } from "@preact/signals";
import { enc, getJson, post, setPort, sse } from "./api";
import { native, on } from "./native";
import type {
  Activity,
  Agent,
  AgentKind,
  Boot,
  ChatMessage,
  HostNav,
  HostView,
  MenuOption,
  Mood,
  Peek,
  Presentation,
  ProjectView,
  ProxyState,
  ScreenView,
  Snapshot,
  Tab,
  Target,
  TerminalInfo,
  WorkspaceView,
} from "./types";

// MARK: state

export const boot = signal<Boot | null>(null);
export const proxyState = signal<ProxyState | null>(null);
export const snapshot = signal<Snapshot | null>(null);
export const proxyOnline = signal(false);
export const presentation = signal<Presentation>("compact");
export const peek = signal<Peek | null>(null);
export const tab = signal<Tab>("live");
export const hostNav = signal<HostNav[]>([]);
export const projectFilter = signal("");
export const terminals = signal<Record<string, TerminalInfo[]>>({});
export const termScreens = signal<Record<string, string[]>>({});
export const openTerminal = signal<string | null>(null);
export const expandedAgent = signal<string | null>(null);
export const screens = signal<Record<string, ScreenView>>({});
export const chat = signal<ChatMessage[]>([]);
export const streaming = signal(false);
export const input = signal("");
export const target = signal<Target>({ kind: "brain" });
export const sending = signal(false);
export const toast = signal<string | null>(null);
export const pinned = signal(false);
export const focusToken = signal(0);
/** agent id → the option being sent right now (-1 next, -2 back). */
export const answering = signal<Record<string, number>>({});
export const autoDeliver = signal(false);
export const autostart = signal<boolean | null>(null);
/** Ticks so "ago" labels and timers move; fast only while a timer is on screen. */
export const now = signal(Date.now());

function stored(key: string, fallback: boolean) {
  let v = fallback;
  try {
    const s = localStorage.getItem(key);
    if (s !== null) v = s === "1";
  } catch {}
  const sig = signal(v);
  effect(() => {
    try {
      localStorage.setItem(key, sig.value ? "1" : "0");
    } catch {}
  });
  return sig;
}
export const sound = stored("sound", true);
export const peekOnDone = stored("peekOnDone", true);
export const border = stored("border", true);

// MARK: derived

export const agents = computed(() => snapshot.value?.agents ?? []);
export const hosts = computed(() => snapshot.value?.hosts ?? []);
export const attentionAgents = computed(() => agents.value.filter((a) => a.attention != null));

export function agent(id: string): Agent | undefined {
  return agents.value.find((a) => a.id === id);
}

/** Needs-you, working, and recently finished agents on every host. */
export const liveAgents = computed(() => {
  const cutoff = Date.now() - 20 * 60 * 1000;
  const list = agents.value.filter((a) => a.attention != null || a.state === "working" || (a.state === "done" && a.since > cutoff));
  const rank = (a: Agent) => (a.attention != null ? 0 : a.state === "working" ? 1 : 2);
  return [...list].sort((a, b) => rank(a) - rank(b) || b.since - a.since);
});

export const host = (id: string) => hosts.value.find((h) => h.id === id);
export const project = (h: string, key: string) => host(h)?.projects.find((p) => p.key === key);
export const workspace = (h: string, p: string, key: string) => project(h, p)?.workspaces.find((w) => w.key === key);

export function hostMood(h: HostView): Mood {
  if (!h.online) return "offline";
  if (h.counts.attention > 0) return "attention";
  if (h.counts.working > 0) return "working";
  return "idle";
}

export function agentMood(a: Agent): Mood {
  if (a.attention != null) return "attention";
  if (a.state === "working") return "working";
  if (a.state === "done") return "done";
  return "idle";
}

export const kindName = (a: Agent) => a.agentLabel || a.agentType;
export const isRemote = (a: Agent) => !a.id.startsWith("local|");
export const place = (a: Agent) => (isRemote(a) ? `${a.hostName} · ${a.workspace}` : a.workspace);

const FALLBACK_KINDS: AgentKind[] = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
];
export const launchable = (h: HostView) => (h.agents && h.agents.length ? h.agents : FALLBACK_KINDS);

export const mood = computed<Mood>(() => {
  if (!proxyOnline.value) return "offline";
  const s = snapshot.value;
  if (s?.mood === "attention") return "attention";
  if (streaming.value) return "thinking";
  if (!s || !s.online) return "offline";
  return (["idle", "working", "attention", "done", "thinking", "offline"].includes(s.mood) ? s.mood : "idle") as Mood;
});

export const compactText = computed(() => {
  if (!proxyOnline.value) return proxyState.value && !["running", "external"].includes(proxyState.value.state) ? proxyState.value.message : "Floe proxy offline";
  const s = snapshot.value;
  if (mood.value === "attention" && s) return s.headline;
  if (streaming.value) {
    const last = chat.value[chat.value.length - 1]?.text.split("\n").filter(Boolean).pop() ?? "";
    return last || "Orca is thinking…";
  }
  return s?.headline ?? "Connecting…";
});

export const targetAgent = computed(() => {
  const t = target.value;
  return t.kind === "agent" ? agent(t.id) : undefined;
});

/** "codex" → "Codex", from what the hosts report. */
export function agentName(id: string): string {
  for (const h of hosts.value) {
    const k = h.agents?.find((k) => k.id === id);
    if (k) return k.label;
  }
  return agents.value.find((a) => a.agentType === id)?.agentLabel ?? id.charAt(0).toUpperCase() + id.slice(1);
}

export function defaultKind(wsKey: string): AgentKind {
  const h = hosts.value.find((h) => h.projects.some((p) => p.workspaces.some((w) => w.key === wsKey)));
  return h ? launchable(h)[0] : FALLBACK_KINDS[0];
}

/** Who hears a message sent to a worktree: whoever needs you, else whoever works, else the latest. */
export function bestAgent(wsKey: string): Agent | undefined {
  const here = agents.value.filter((a) => a.workspaceKey === wsKey);
  return here.find((a) => a.attention != null) ?? here.find((a) => a.state === "working") ?? [...here].sort((a, b) => b.since - a.since)[0];
}

export function placeLabel(h: HostView, p: ProjectView, w: WorkspaceView) {
  const where = w.name === p.name ? p.name : `${p.name}/${w.name}`;
  return h.kind === "local" ? where : `${where} · ${h.name}`;
}

export const currentWorkspaceKey = computed(() => {
  const last = hostNav.value[hostNav.value.length - 1];
  return last?.kind === "workspace" ? last.workspace : null;
});

// MARK: island geometry (the Rust side moves the window; the island animates inside it)

export const BAR = 32;
export const TOP_INSET = 8;

/** How much bigger the page draws than its CSS size (the desktop's text scale on Linux). */
export const zoom = computed(() => boot.value?.zoom ?? 1);

export const expandedSize = computed(() => {
  const b = boot.value;
  // in CSS pixels, which the page zoom makes bigger on screen
  const sw = (b?.screenWidth ?? 1440) / zoom.value;
  const sh = (b?.screenHeight ?? 900) / zoom.value;
  return { w: Math.round(Math.min(480, sw - 16)), h: Math.round(Math.min(600, sh * 0.74)) };
});

export const islandSize = computed(() => {
  switch (presentation.value) {
    case "expanded":
      return expandedSize.value;
    case "peek":
      return { w: Math.min(420, expandedSize.value.w), h: TOP_INSET + 66 };
    default: {
      const active = mood.value !== "idle" && mood.value !== "offline";
      return { w: active ? 300 : 112, h: BAR };
    }
  }
});

// MARK: navigation

export function push(n: HostNav) {
  projectFilter.value = "";
  hostNav.value = [...hostNav.value, n];
  if (n.kind === "workspace") loadTerminals(n.workspace);
  followNav();
}

export function pop(to = -1) {
  hostNav.value = to < 0 ? hostNav.value.slice(0, -1) : hostNav.value.slice(0, to);
  openTerminal.value = null;
  followNav();
}

/** The input follows where you are: a worktree (or a project's main one) becomes the target. */
function followNav() {
  const last = hostNav.value[hostNav.value.length - 1];
  if (last?.kind === "workspace") {
    const h = host(last.host), p = project(last.host, last.project), w = workspace(last.host, last.project, last.workspace);
    if (h && p && w) target.value = { kind: "workspace", key: w.key, label: placeLabel(h, p, w) };
  } else if (last?.kind === "project") {
    const h = host(last.host), p = project(last.host, last.project);
    const w = p?.workspaces.find((w) => w.isMain) ?? p?.workspaces[0];
    if (h && p && w) target.value = { kind: "workspace", key: w.key, label: placeLabel(h, p, w) };
  } else {
    target.value = { kind: "brain" };
  }
}

export async function loadTerminals(wsKey: string) {
  const r = await getJson<{ terminals: TerminalInfo[] }>(`workspaces/${enc(wsKey)}/terminals`);
  if (r?.terminals && JSON.stringify(terminals.value[wsKey]) !== JSON.stringify(r.terminals)) {
    terminals.value = { ...terminals.value, [wsKey]: r.terminals };
  }
}

export async function loadTerminalScreen(id: string) {
  const r = await getJson<{ lines: string[] }>(`terminals/${enc(id)}/screen`);
  if (r?.lines && JSON.stringify(termScreens.value[id]) !== JSON.stringify(r.lines)) {
    termScreens.value = { ...termScreens.value, [id]: r.lines };
  }
}

export function toggleTerminal(t: TerminalInfo) {
  openTerminal.value = openTerminal.value === t.id ? null : t.id;
  if (openTerminal.value === t.id) loadTerminalScreen(t.id);
}

export function beginTerminal(t: TerminalInfo, where: string) {
  target.value = t.agentId ? { kind: "agent", id: t.agentId } : { kind: "terminal", id: t.id, label: `${t.title} · ${where}` };
  focusInput();
}

export async function focusTerminal(t: TerminalInfo) {
  const r = await post(`terminals/${enc(t.id)}/focus`, {}, proxyOnline.value);
  if (!r.ok) say(r.message);
  else collapse();
}

export async function newTerminal(w: WorkspaceView) {
  const r = await post(`workspaces/${enc(w.key)}/terminal`, {}, proxyOnline.value);
  say(r.ok ? `Opened a terminal in ${w.name}` : r.message);
  loadTerminals(w.key);
}

export function beginLaunch(w: WorkspaceView, projectName: string, h: HostView, agentId: string) {
  const label = h.kind === "local" ? `${projectName}/${w.name}` : `${projectName}/${w.name} on ${h.name}`;
  target.value = { kind: "launch", key: w.key, agent: agentId, label };
  focusInput();
}

export async function focusWorkspace(w: WorkspaceView) {
  const r = await post(`workspaces/${enc(w.key)}/focus`, {}, proxyOnline.value);
  if (!r.ok) say(r.message);
  else collapse();
}

// MARK: presentation

let peekTimer: number | undefined;
let toastTimer: number | undefined;
let screenTimer: number | undefined;

export function showPeek(p: Peek, seconds: number) {
  if (presentation.value === "expanded") return;
  batch(() => {
    peek.value = p;
    presentation.value = "peek";
  });
  clearTimeout(peekTimer);
  peekTimer = window.setTimeout(() => {
    if (presentation.value !== "peek") return;
    batch(() => {
      presentation.value = "compact";
      peek.value = null;
    });
  }, seconds * 1000);
}

export function expand(opts: { agent?: string | null; tab?: Tab; focus?: boolean } = {}) {
  clearTimeout(peekTimer);
  const attention = attentionAgents.value[0];
  const t = target.value;
  if (t.kind === "launch") target.value = { kind: "brain" };
  if (t.kind === "terminal" && opts.focus) target.value = { kind: "brain" };
  if (t.kind === "workspace" && tab.value !== "hosts") target.value = { kind: "brain" };
  if (opts.agent) {
    tab.value = "live";
    expandedAgent.value = opts.agent;
    target.value = { kind: "agent", id: opts.agent };
  } else if (opts.tab) {
    tab.value = opts.tab;
  } else if (attention) {
    tab.value = "live";
    expandedAgent.value = attention.id;
    target.value = { kind: "agent", id: attention.id };
  } else if (opts.focus) {
    tab.value = "ask";
    target.value = { kind: "brain" };
  }
  batch(() => {
    presentation.value = "expanded";
    peek.value = null;
  });
  // On Linux and Windows, opening Floe takes the keyboard (and gives it back when it folds),
  // so clicking anywhere else can fold it up, like the Mac app's global click monitor.
  native.takeFocus();
  refreshScreens();
  clearInterval(screenTimer);
  screenTimer = window.setInterval(refreshScreens, 2500);
  if (opts.focus !== false) focusInput();
}

export function collapse() {
  clearInterval(screenTimer);
  screenTimer = undefined;
  if (presentation.value === "compact") return;
  batch(() => {
    presentation.value = "compact";
    peek.value = null;
  });
  native.releaseFocus();
}

export function toggle() {
  if (presentation.value === "expanded") collapse();
  else expand({ focus: true });
}

export function focusInput() {
  focusToken.value++;
}

export function select(a: Agent) {
  if (expandedAgent.value === a.id) {
    expandedAgent.value = null;
    const t = target.value;
    if (t.kind === "agent" && t.id === a.id) target.value = { kind: "brain" };
  } else {
    expandedAgent.value = a.id;
    target.value = { kind: "agent", id: a.id };
    fetchScreen(a.id);
  }
}

export function say(text: string) {
  clearTimeout(toastTimer);
  toast.value = text;
  toastTimer = window.setTimeout(() => (toast.value = null), 2600);
}

// MARK: agents

export function refreshScreens() {
  const ids = new Set(attentionAgents.value.map((a) => a.id));
  if (expandedAgent.value) ids.add(expandedAgent.value);
  ids.forEach((id) => fetchScreen(id));
  const ws = currentWorkspaceKey.value;
  if (tab.value === "hosts" && ws) {
    loadTerminals(ws);
    if (openTerminal.value) loadTerminalScreen(openTerminal.value);
  }
}

export async function fetchScreen(id: string) {
  const v = await getJson<ScreenView & { ok?: boolean }>(`agents/${enc(id)}/screen`);
  if (!v || !Array.isArray(v.lines)) return;
  const view: ScreenView = { lines: v.lines, options: v.options ?? [], multi: v.multi, tabs: v.tabs, steps: v.steps };
  if (JSON.stringify(screens.value[id]) !== JSON.stringify(view)) screens.value = { ...screens.value, [id]: view };
}

/** The prompt's own lines, without the options drawn again below them. */
export function promptLines(s: ScreenView): string[] {
  const first = s.options[0]?.label;
  if (!first) return s.lines;
  const cut = s.lines.findIndex((l) => l.includes(first));
  return cut < 0 ? s.lines : s.lines.slice(0, cut);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setAnswering(id: string, v: number | null) {
  const next = { ...answering.value };
  if (v === null) delete next[id];
  else next[id] = v;
  answering.value = next;
}

export async function answer(a: Agent, o: MenuOption) {
  if (o.freeText) {
    target.value = { kind: "agent", id: a.id };
    expandedAgent.value = a.id;
    focusInput();
    say(`Type your answer for ${a.workspace}`);
    return;
  }
  if (answering.value[a.id] !== undefined) return;
  setAnswering(a.id, o.n);
  const toggleBox = o.checked != null;
  const r = await post(`agents/${enc(a.id)}/answer`, { option: o.n }, proxyOnline.value);
  const s = screens.value[a.id];
  if (r.ok && s) {
    // A box flips and the question stays up; any other pick answers it.
    const next: ScreenView = toggleBox
      ? { ...s, options: s.options.map((x) => (x.n === o.n ? { ...x, checked: !x.checked } : x)) }
      : { lines: s.lines, options: [] };
    screens.value = { ...screens.value, [a.id]: next };
  }
  setAnswering(a.id, null);
  if (!r.ok) say(r.message);
  else if (!toggleBox) say(`Picked ${o.n} · ${o.label}`);
  await sleep(350);
  fetchScreen(a.id);
}

/** Back / Next between the questions of a multi-question prompt. */
export async function step(a: Agent, dir: "next" | "back") {
  if (answering.value[a.id] !== undefined) return;
  setAnswering(a.id, dir === "next" ? -1 : -2);
  const r = await post(`agents/${enc(a.id)}/answer`, { step: dir }, proxyOnline.value);
  setAnswering(a.id, null);
  if (!r.ok) say(r.message);
  await sleep(300);
  fetchScreen(a.id);
}

export async function focusInOrca(a: Agent) {
  const r = await post(`agents/${enc(a.id)}/focus`, {}, proxyOnline.value);
  if (!r.ok) say(r.message);
  else collapse();
}

// MARK: input

export async function send() {
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  const t = target.value;
  const online = proxyOnline.value;
  switch (t.kind) {
    case "brain":
      ask(text);
      return;
    case "workspace": {
      sending.value = true;
      const a = bestAgent(t.key);
      if (a) {
        const r = await post(`agents/${enc(a.id)}/answer`, { text }, online);
        sending.value = false;
        say(r.ok ? `Sent to ${kindName(a)} in ${t.label}` : r.message);
        await sleep(700);
        fetchScreen(a.id);
      } else {
        const k = defaultKind(t.key);
        const r = await post(`workspaces/${enc(t.key)}/launch`, { agent: k.id, prompt: text }, online);
        sending.value = false;
        say(r.ok ? `Started ${k.label} in ${t.label}` : r.message);
      }
      return;
    }
    case "launch": {
      sending.value = true;
      const r = await post(`workspaces/${enc(t.key)}/launch`, { agent: t.agent, prompt: text }, online);
      sending.value = false;
      say(r.ok ? `Started ${agentName(t.agent)} in ${t.label}` : r.message);
      if (r.ok) {
        if (tab.value === "hosts" && hostNav.value.length) followNav();
        else {
          target.value = { kind: "brain" };
          tab.value = "live";
        }
      }
      return;
    }
    case "terminal": {
      sending.value = true;
      const r = await post(`terminals/${enc(t.id)}/send`, { text, enter: true }, online);
      sending.value = false;
      say(r.ok ? `Ran in ${t.label}` : r.message);
      await sleep(900);
      loadTerminalScreen(t.id);
      openTerminal.value = t.id;
      return;
    }
    case "agent": {
      const name = agent(t.id) ? place(agent(t.id)!) : "agent";
      sending.value = true;
      const r = await post(`agents/${enc(t.id)}/answer`, { text }, online);
      sending.value = false;
      say(r.ok ? `Sent to ${name}` : r.message);
      await sleep(700);
      fetchScreen(t.id);
      return;
    }
  }
}

let askAbort: AbortController | null = null;
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export async function ask(text: string) {
  askAbort?.abort();
  const ctrl = new AbortController();
  askAbort = ctrl;
  tab.value = "ask";
  const id = uid();
  chat.value = [
    ...chat.value,
    { id: uid(), role: "user", text, at: Date.now() },
    { id, role: "assistant", text: "", at: Date.now(), tools: [], toolAt: [] },
  ];
  streaming.value = true;
  const patch = (f: (m: ChatMessage) => ChatMessage) => {
    chat.value = chat.value.map((m) => (m.id === id ? f(m) : m));
  };
  let finalText: string | null = null;
  try {
    for await (const ev of sse("ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: ctrl.signal,
    })) {
      let obj: any;
      try {
        obj = JSON.parse(ev.data);
      } catch {
        continue;
      }
      switch (ev.event) {
        case "delta":
          patch((m) => ({ ...m, text: m.text + (obj.text ?? "") }));
          break;
        case "tool": {
          const name = obj.name ?? "tool";
          const summary = obj.summary ?? "";
          patch((m) => ({ ...m, tools: [...(m.tools ?? []), summary ? `${name}: ${summary}` : name], toolAt: [...(m.toolAt ?? []), Date.now()] }));
          break;
        }
        case "done":
          if (obj.text) patch((m) => ({ ...m, text: obj.text }));
          finalText = chat.value.find((m) => m.id === id)?.text ?? "";
          break;
        case "error":
          patch((m) => ({ ...m, text: m.text + (m.text ? "\n" : "") + `⚠︎ ${obj.message ?? "error"}` }));
          break;
      }
    }
  } catch (e) {
    if (!ctrl.signal.aborted) patch((m) => ({ ...m, text: m.text + `\n⚠︎ ${(e as Error).message}` }));
  }
  if (askAbort === ctrl) streaming.value = false;
  if (finalText && presentation.value !== "expanded") {
    showPeek({ mood: "thinking", title: "Orca", text: finalText.replace(/\n/g, " "), agentId: null }, 12);
  }
}

export const stopAsking = () => post("ask/stop", {}, proxyOnline.value);

export function newChat() {
  askAbort?.abort();
  streaming.value = false;
  chat.value = [];
  post("chat/new", {}, proxyOnline.value);
  say("New conversation");
}

export async function openChatInOrca() {
  const r = await post("chat/open", {}, proxyOnline.value);
  if (r.ok) collapse();
  else say(r.message);
}

export async function setAutoDeliver(onOff: boolean) {
  autoDeliver.value = onOff;
  const r = await post("prefs", { autoDeliver: onOff }, proxyOnline.value);
  if (!r.ok) {
    autoDeliver.value = !onOff;
    say(r.message || "Couldn't change auto-deliver");
  }
}

export async function setAutostart(onOff: boolean) {
  try {
    const v = await native.autostartSet(onOff);
    autostart.value = v ?? onOff;
  } catch (e) {
    say(`Couldn't change launch at login: ${e}`);
  }
}

async function loadPrefs() {
  const j = await getJson<{ autoDeliver?: boolean }>("prefs");
  if (j) autoDeliver.value = j.autoDeliver === true;
}

async function loadChat() {
  for (let i = 0; i < 20; i++) {
    const h = await getJson<{ messages: Omit<ChatMessage, "id">[] }>("chat");
    if (h?.messages) {
      if (!chat.value.length) chat.value = h.messages.map((m) => ({ ...m, id: uid() }));
      return;
    }
    await sleep(1500);
  }
}

// MARK: events

function apply(s: Snapshot) {
  snapshot.value = s;
  const ids = new Set(s.agents.map((a) => a.id));
  const kept: Record<string, ScreenView> = {};
  for (const [k, v] of Object.entries(screens.value)) if (ids.has(k)) kept[k] = v;
  if (Object.keys(kept).length !== Object.keys(screens.value).length) screens.value = kept;
  const t = target.value;
  if (t.kind === "agent" && !ids.has(t.id)) {
    target.value = { kind: "brain" };
    if (tab.value === "hosts") followNav();
  }
  if (expandedAgent.value && !ids.has(expandedAgent.value)) expandedAgent.value = null;
  if (presentation.value === "expanded") refreshScreens();
}

let audio: AudioContext | null = null;
/** A small bell, like the Mac's "Tink". */
function tink() {
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime;
    for (const [f, g] of [
      [1760, 0.12],
      [2640, 0.05],
    ] as const) {
      const o = audio.createOscillator();
      const v = audio.createGain();
      o.frequency.value = f;
      v.gain.setValueAtTime(g, t);
      v.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(v).connect(audio.destination);
      o.start(t);
      o.stop(t + 0.26);
    }
  } catch {}
}

function onActivity(a: Activity) {
  switch (a.kind) {
    case "attention":
      if (sound.value) tink();
      fetchScreen(a.agentId);
      showPeek({ mood: "attention", title: `${a.workspace} needs you`, text: a.text, agentId: a.agentId }, 9);
      break;
    case "auto":
      showPeek({ mood: "done", title: `Floe answered for ${a.workspace}`, text: a.text, agentId: a.agentId }, 5);
      break;
    case "done":
      if (peekOnDone.value) showPeek({ mood: "done", title: `${a.workspace} finished`, text: a.text, agentId: a.agentId }, 6);
      break;
  }
}

async function runEvents() {
  let backoff = 1;
  for (;;) {
    try {
      for await (const ev of sse("events")) {
        if (!proxyOnline.value) {
          proxyOnline.value = true;
          native.log("connected to the proxy");
          loadPrefs();
          if (!chat.value.length) loadChat();
        }
        backoff = 1;
        try {
          if (ev.event === "snapshot") apply(JSON.parse(ev.data));
          else if (ev.event === "activity") onActivity(JSON.parse(ev.data));
        } catch {}
      }
    } catch (e) {
      if (proxyOnline.value) native.log(`lost the proxy: ${(e as Error)?.message ?? e}`);
    }
    proxyOnline.value = false;
    await sleep(backoff * 1000);
    backoff = Math.min(backoff * 2, 8);
  }
}

// MARK: start

export async function start() {
  const b = await native.boot();
  if (b) {
    boot.value = b;
    setPort(b.port);
    proxyState.value = b.proxy;
  } else {
    // In a plain browser (vite dev): ?port=7799 points at another proxy, e.g. a demo one.
    const port = Number(new URLSearchParams(location.search).get("port"));
    if (port > 0) setPort(port);
  }
  on<ProxyState>("proxy", (p) => (proxyState.value = p));
  on("hotkey", () => toggle());
  on<string>("tray", (what) => (what === "settings" ? expand({ tab: "settings" }) : expand({ focus: true })));
  on("blur", () => {
    if (presentation.value === "expanded" && !pinned.value) collapse();
  });
  on("screen", async () => {
    const nb = await native.boot();
    if (nb) boot.value = nb;
  });
  native.autostartGet().then((v) => (autostart.value = v ?? null)).catch(() => {});
  runEvents();
  loadChat();

  // FLOE_OPEN=hosts (or ?open=hosts in a browser): open on that tab, for tests and screenshots.
  const open = b?.open ?? new URLSearchParams(location.search).get("open");
  if (open && ["live", "hosts", "ask", "settings"].includes(open)) setTimeout(() => expand({ tab: open as Tab, focus: false }), 400);

  // A slow clock for "ago" labels; a 1 s one while the panel is open.
  let tick: number | undefined;
  effect(() => {
    clearInterval(tick);
    const ms = presentation.value === "expanded" ? 1000 : 30000;
    tick = window.setInterval(() => (now.value = Date.now()), ms);
  });
}

export function ago(ms: number, at = now.value): string {
  const s = Math.max(0, (at - ms) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
