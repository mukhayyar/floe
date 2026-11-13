import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config";
import { type AgentKind, agentLabel, byCatalog, kind } from "./agents";
import { autoChoice, parseScreen, type ScreenView } from "./menu";
import { prefs } from "./prefs";
import { LOCAL, OrcaError, OrcaRpc } from "./orca-rpc";

export type Mood = "offline" | "idle" | "working" | "attention" | "done";

/** One line in an agent's live timeline: a tool call, or something it said. */
export interface Step {
  kind: "tool" | "say";
  tool: string | null;
  text: string;
  at: number;
  done: boolean;
}

export interface IslandAgent {
  id: string; // `${hostId}|${paneKey}`
  paneKey: string;
  hostId: string; // "local" | environment id
  hostName: string;
  worktreeId: string;
  workspaceKey: string;
  workspace: string;
  project: string;
  path: string;
  agentType: string;
  /** The harness's proper name: "Codex", "OMP", "Gemini"… */
  agentLabel: string;
  state: string; // working | waiting | done | idle
  title: string;
  tool: string | null;
  detail: string | null;
  attention: string | null; // question | permission | auth | input
  progress: number | null;
  lastMessage: string | null;
  since: number;
  updatedAt: number;
  steps: Step[];
}

export interface WorkspaceView {
  key: string; // `${hostId}|${worktreeId}`
  worktreeId: string;
  name: string;
  branch: string;
  path: string;
  status: string;
  unread: boolean;
  liveTerminals: number;
  isMain: boolean;
  agentIds: string[];
}

export interface ProjectView {
  key: string;
  name: string;
  workspaces: WorkspaceView[];
}

export interface HostView {
  id: string; // "local" | environment id | ssh target id
  name: string;
  kind: "local" | "environment" | "ssh";
  /** Which runtime answers for this host: "local" or the environment id. */
  via: string;
  online: boolean;
  error: string | null;
  projects: ProjectView[];
  counts: { working: number; attention: number; workspaces: number; agents: number };
  /** Harnesses installed on this host that Floe can start, your Orca default first. */
  agents: AgentKind[];
}

export interface Snapshot {
  at: number;
  online: boolean;
  error: string | null;
  mood: Mood;
  headline: string;
  counts: { working: number; attention: number; done: number; idle: number; total: number };
  agents: IslandAgent[];
  hosts: HostView[];
}

export interface Activity {
  kind: "attention" | "done" | "started" | "auto";
  agentId: string;
  workspace: string;
  title: string;
  text: string;
  at: number;
}

interface HostState {
  online: boolean;
  error: string | null;
  worktrees: any[];
  at: number;
}

/** Auto-deliver's view of one agent waiting on a prompt. */
interface Auto {
  /** Don't look before this (gives a fresh dialog time to accept keys, and backs off). */
  next: number;
  busy: boolean;
  /** The "needs you" ping, held back until auto-deliver knows it won't answer. */
  tell: (() => void) | null;
  /** Floe answered something for this agent while it waited. */
  picked: boolean;
  /** The prompt last answered, and how many times in a row: a prompt that keeps coming back means the keys aren't landing. */
  sig: string;
  tries: number;
  /** Back-off between looks at a prompt Floe leaves to you. */
  wait: number;
}

/** A dialog may refuse keys that arrive right after it opens (Claude's held-message dialog does). */
const AUTO_DELAY_MS = 1500;

interface Trail {
  key: string;
  say: string | null;
  steps: Step[];
}

const RECENT_DONE_MS = 90_000;
const MAX_STEPS = 10;
const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s) : null);
const firstLine = (s: string | null | undefined) => (s ? s.split("\n").find((l) => l.trim())?.trim() ?? null : null);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

function workspaceLabel(w: any): string {
  const name = w.displayName && w.displayName !== w.repo ? w.displayName : w.branch?.replace(/^refs\/heads\//, "") || "";
  return name || w.path?.split("/").pop() || "workspace";
}

function inputText(input: unknown): string | null {
  if (input == null) return null;
  if (typeof input === "string") return input;
  const i = input as any;
  return String(i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.query ?? i.url ?? i.description ?? JSON.stringify(i));
}

/** Orca's generic name for any prompt it reads off a screen. */
const GENERIC = /^permission prompt$/i;
const whereOf = (a: IslandAgent) => (a.hostId === LOCAL ? a.workspace : `${a.hostName} · ${a.workspace}`);
const RANK: Record<string, number> = { waiting: 0, working: 1, done: 2, idle: 3 };

export class OrcaWatcher {
  readonly rpc: OrcaRpc;
  snapshot: Snapshot = {
    at: 0, online: false, error: "starting", mood: "offline", headline: "Connecting to Orca…",
    counts: { working: 0, attention: 0, done: 0, idle: 0, total: 0 }, agents: [], hosts: [],
  };
  private listeners = new Set<(ev: { type: "snapshot"; data: Snapshot } | { type: "activity"; data: Activity }) => void>();
  private lastKey = "";
  private timers: Timer[] = [];
  private states = new Map<string, HostState>(); // by runtime: "local" | env id
  private environments: { id: string; name: string }[] = [];
  private sshTargets: { id: string; name: string; connected: boolean }[] = [];
  private trails = new Map<string, Trail>();
  private polling = new Set<string>();
  /** agent id → terminal handle (handles are stable for a terminal's life). */
  private handles = new Map<string, { runtime: string; handle: string }>();
  /** agent id → last screen we read, so answering doesn't re-read it. */
  private screens = new Map<string, { view: ScreenView & { handle: string }; at: number }>();
  /** Agents waiting on a prompt while auto-deliver is on. */
  private autos = new Map<string, Auto>();
  /** host id → the harnesses it has installed (Orca's preflight), your Orca default first. */
  private launchable = new Map<string, { agents: string[]; at: number }>();
  private detecting = new Set<string>();

  constructor(private cfg: Config) {
    this.rpc = new OrcaRpc(cfg);
  }

  subscribe(fn: Parameters<OrcaWatcher["listeners"]["add"]>[0]) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start() {
    this.refreshHosts();
    this.timers.push(setInterval(() => this.refreshHosts(), 30_000));
    const localLoop = async () => {
      await this.pollHost(LOCAL);
      this.timers.push(setTimeout(localLoop, this.states.get(LOCAL)?.online ? this.cfg.pollMs : 5000));
    };
    localLoop();
    this.timers.push(setInterval(() => {
      for (const env of this.environments) this.pollHost(env.id);
    }, this.cfg.remotePollMs));
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.rpc.close();
  }

  /** Paired Orca servers come from Orca's own store; SSH targets from the local runtime. */
  private async refreshHosts() {
    try {
      const raw = JSON.parse(readFileSync(join(this.cfg.orcaUserData, "orca-environments.json"), "utf8"));
      const hidden = new Set(this.cfg.hiddenHosts);
      const list: any[] = Array.isArray(raw) ? raw : raw.environments ?? [];
      const next = list.filter((e) => e?.id && !hidden.has(e.id) && !hidden.has(e.name)).map((e) => ({ id: e.id, name: e.name ?? e.id }));
      const fresh = next.filter((e) => !this.environments.some((o) => o.id === e.id));
      this.environments = next;
      for (const id of [...this.states.keys()]) if (id !== LOCAL && !next.some((e) => e.id === id)) this.states.delete(id);
      for (const e of fresh) this.pollHost(e.id);
    } catch {}
    try {
      const res = await this.rpc.call<any>(LOCAL, "ssh.listTargetSummaries", {});
      const targets: any[] = res?.targets ?? res ?? [];
      this.sshTargets = targets.map((t) => ({
        id: t.id,
        name: t.label ?? t.name ?? t.host ?? t.id,
        connected: t.state?.status === "connected" || t.status === "connected" || t.connectionStatus === "connected" || t.connected === true,
      }));
    } catch {}
  }

  async poll() {
    await Promise.all([this.pollHost(LOCAL), ...this.environments.map((e) => this.pollHost(e.id))]);
  }

  private async pollHost(runtime: string) {
    if (this.polling.has(runtime)) return;
    this.polling.add(runtime);
    try {
      const res = await this.rpc.call<any>(runtime, "worktree.ps", {});
      this.states.set(runtime, { online: true, error: null, worktrees: res.worktrees ?? [], at: Date.now() });
    } catch (e) {
      const prev = this.states.get(runtime);
      const offline = e instanceof OrcaError && /runtime_unavailable|bridge|timeout|ECONN/i.test(e.code + e.message);
      this.states.set(runtime, { online: false, error: offline ? "unreachable" : (e as Error).message, worktrees: prev?.worktrees ?? [], at: Date.now() });
    } finally {
      this.polling.delete(runtime);
    }
    this.rebuild();
  }

  private hostName(runtime: string): string {
    return runtime === LOCAL ? "This Mac" : this.environments.find((e) => e.id === runtime)?.name ?? runtime;
  }

  private track(id: string, a: any, now: number): Step[] {
    let trail = this.trails.get(id);
    const working = a.state === "working" || a.state === "waiting" || a.state === "blocked";
    if (!working) {
      if (trail) for (const s of trail.steps) s.done = true;
      return trail?.steps ?? [];
    }
    if (!trail || trail.steps.every((s) => s.done)) {
      trail = { key: "", say: a.lastAssistantMessage ?? null, steps: [] }; // a new turn starts a new trail
      this.trails.set(id, trail);
    }
    const push = (step: Omit<Step, "done" | "at">) => {
      for (const s of trail!.steps) s.done = true;
      trail!.steps.push({ ...step, at: now, done: false });
      if (trail!.steps.length > MAX_STEPS) trail!.steps.splice(0, trail!.steps.length - MAX_STEPS);
    };
    const said = a.lastAssistantMessage ?? null;
    if (said && said !== trail.say) {
      trail.say = said;
      push({ kind: "say", tool: null, text: clip(oneLine(said), 160)! });
    }
    const input = inputText(a.toolInput);
    const key = `${a.toolName ?? ""}|${input ?? ""}`;
    if (a.toolName && key !== trail.key) {
      trail.key = key;
      push({ kind: "tool", tool: a.toolName, text: clip(oneLine(firstLine(input) ?? a.programStatus?.message ?? ""), 140) ?? "" });
    }
    return trail.steps;
  }

  /**
   * Agent rows can keep saying "working" long after the agent stopped (interrupted, crashed,
   * terminal gone idle without a final hook). Orca's own sidebar trusts the worktree's
   * rolled-up status, so we do too: a "working" row only counts when its worktree is live.
   */
  private staleAgents(w: any, now: number): Set<string> {
    const stale = new Set<string>();
    const status = w.sidebarStatus ?? w.status;
    const live = status === "working" || status === "monitoring" || status === "permission";
    const working = (w.agents ?? []).filter((a: any) => a.state === "working");
    if (!live) {
      for (const a of working) stale.add(a.paneKey);
      return stale;
    }
    // Live worktree with several "working" rows: drop the ones that went quiet long ago
    // while another row in the same worktree is clearly current.
    const freshest = Math.max(0, ...working.map((a: any) => a.updatedAt ?? 0));
    for (const a of working) {
      if (freshest - (a.updatedAt ?? 0) > 60 * 60_000 && now - (a.updatedAt ?? 0) > 60 * 60_000) stale.add(a.paneKey);
    }
    return stale;
  }

  private toAgent(runtime: string, w: any, raw: any, now: number, stale = false): IslandAgent {
    // A stale "working" row is shown as idle: Orca itself no longer shows it running.
    const a = stale ? { ...raw, state: "idle", toolName: null, toolInput: null, programStatus: undefined } : raw;
    const id = `${runtime}|${a.paneKey}`;
    const facet = a.programStatus ?? {};
    const live = a.state === "working" || a.state === "waiting" || a.state === "blocked";
    let attention: string | null = null;
    // Orca reads prompts off the screen (programStatus) as well as from the agent's hooks. A
    // prompt can come up after the turn ended, with no hook (Claude holding a message from
    // another session for approval): the row still says "done" or "idle", so trust a blocked
    // screen whenever it was seen after the row last changed state.
    const seenSince = typeof facet.observedAt === "number" && facet.observedAt >= (a.stateStartedAt ?? a.updatedAt ?? Infinity);
    if (a.state === "waiting" || a.state === "blocked") attention = facet.kind ?? (a.toolName === "AskUserQuestion" ? "question" : "input");
    else if (facet.state === "blocked" && (a.state === "working" || seenSince)) attention = facet.kind ?? "input";
    const input = inputText(a.toolInput);
    const detail = attention && (!facet.message || GENERIC.test(facet.message)) ? (this.promptTitle(id) ?? facet.message ?? null)
      : attention && !live ? (facet.message ?? null) : live ? (facet.message ?? (a.toolName ? `${a.toolName}${input ? ": " + oneLine(firstLine(input) ?? "") : ""}` : null)) : null;
    const hostId = runtime === LOCAL && w.hostId && w.hostId !== LOCAL ? w.hostId : runtime;
    return {
      id,
      paneKey: a.paneKey,
      hostId,
      hostName: this.hostName(runtime),
      worktreeId: w.worktreeId,
      workspaceKey: `${runtime}|${w.worktreeId}`,
      workspace: `${w.repo}${workspaceLabel(w) !== w.repo && !["main", "master"].includes(workspaceLabel(w)) ? "/" + workspaceLabel(w) : ""}`,
      project: w.repo,
      path: w.path,
      agentType: a.agentType ?? "agent",
      agentLabel: agentLabel(a.agentType),
      state: attention ? "waiting" : a.state ?? "idle",
      title: clip(a.conversationName ?? a.taskTitle ?? a.displayName ?? firstLine(a.prompt) ?? a.agentType, 80)!,
      tool: live ? (a.toolName ?? null) : null,
      detail: clip(detail?.replace(/^answer:\s*/i, ""), 160),
      attention,
      progress: live && typeof facet.progress === "number" ? facet.progress : null,
      lastMessage: clip(a.lastAssistantMessage, 1200),
      since: a.stateStartedAt ?? a.updatedAt ?? now,
      updatedAt: a.updatedAt ?? now,
      steps: this.track(id, a, now).map((s) => ({ ...s })),
    };
  }

  private rebuild() {
    const now = Date.now();
    const agents: IslandAgent[] = [];
    const hosts: HostView[] = [];
    const seen = new Set<string>();

    const runtimes = [LOCAL, ...this.environments.map((e) => e.id)];
    for (const runtime of runtimes) {
      const st = this.states.get(runtime);
      // The local runtime also answers for SSH targets: split its rows by hostId.
      const groups = new Map<string, any[]>();
      for (const w of st?.worktrees ?? []) {
        if (w.isArchived) continue;
        const hid = runtime === LOCAL ? (w.hostId && w.hostId !== LOCAL ? w.hostId : LOCAL) : runtime;
        if (!groups.has(hid)) groups.set(hid, []);
        groups.get(hid)!.push(w);
      }
      if (!groups.has(runtime)) groups.set(runtime, []);
      if (runtime === LOCAL) for (const t of this.sshTargets) if (!groups.has(t.id)) groups.set(t.id, []);

      for (const [hid, rows] of groups) {
        const ssh = runtime === LOCAL && hid !== LOCAL ? this.sshTargets.find((t) => t.id === hid) : undefined;
        const projects = new Map<string, ProjectView>();
        let working = 0;
        let attention = 0;
        let agentCount = 0;
        for (const w of rows) {
          const ids: string[] = [];
          const stale = this.staleAgents(w, now);
          for (const a of w.agents ?? []) {
            if (!a.paneKey || a.hasLivePty === false) continue;
            const agent = this.toAgent(runtime, w, a, now, stale.has(a.paneKey));
            agents.push(agent);
            seen.add(agent.id);
            ids.push(agent.id);
            agentCount++;
            if (agent.attention) attention++;
            else if (agent.state === "working") working++;
          }
          const pkey = `${hid}|${w.repoId ?? w.repo}`;
          if (!projects.has(pkey)) projects.set(pkey, { key: pkey, name: w.repo || "project", workspaces: [] });
          projects.get(pkey)!.workspaces.push({
            key: `${runtime}|${w.worktreeId}`,
            worktreeId: w.worktreeId,
            name: workspaceLabel(w),
            branch: (w.branch ?? "").replace(/^refs\/heads\//, ""),
            path: w.path,
            status: w.status ?? "inactive",
            unread: !!w.unread,
            liveTerminals: w.liveTerminalCount ?? 0,
            isMain: !!w.isMainWorktree,
            agentIds: ids,
          });
        }
        const activity = (p: ProjectView) => {
          const ids = new Set(p.workspaces.flatMap((w) => w.agentIds));
          const mine = agents.filter((a) => ids.has(a.id));
          return mine.some((a) => a.attention) ? 0 : mine.some((a) => a.state === "working") ? 1 : mine.length ? 2 : p.workspaces.some((w) => w.status !== "inactive") ? 3 : 4;
        };
        const plist = [...projects.values()].sort((a, b) => activity(a) - activity(b) || a.name.localeCompare(b.name));
        for (const p of plist) p.workspaces.sort((a, b) => Number(b.isMain) - Number(a.isMain) || b.agentIds.length - a.agentIds.length || a.name.localeCompare(b.name));
        hosts.push({
          id: hid,
          name: hid === LOCAL ? "This Mac" : ssh ? ssh.name : this.hostName(runtime),
          kind: hid === LOCAL ? "local" : ssh || runtime === LOCAL ? "ssh" : "environment",
          via: runtime,
          online: ssh ? ssh.connected : !!st?.online,
          error: ssh ? (ssh.connected ? null : "disconnected") : st?.error ?? (st ? null : "connecting"),
          projects: plist,
          counts: { working, attention, workspaces: rows.length, agents: agentCount },
          agents: (this.launchable.get(hid)?.agents ?? []).map(kind),
        });
        if (ssh ? ssh.connected : st?.online) this.detectAgents(hid, runtime);
      }
    }
    for (const id of [...this.trails.keys()]) if (!seen.has(id)) this.trails.delete(id);

    const order = (h: HostView) => (h.kind === "local" ? 0 : h.kind === "environment" ? 1 : h.online ? 2 : 3);
    hosts.sort((a, b) => order(a) - order(b) || b.counts.agents - a.counts.agents || a.name.localeCompare(b.name));
    agents.sort((x, y) => (RANK[x.state] ?? 9) - (RANK[y.state] ?? 9) || y.since - x.since);

    const local = this.states.get(LOCAL);
    const anyOnline = [...this.states.values()].some((s) => s.online);
    const next: Snapshot = {
      at: now,
      online: anyOnline,
      error: local?.online ? null : local?.error ?? null,
      ...this.summarize(agents, now, anyOnline),
      agents,
      hosts,
    };
    this.diff(this.snapshot, next);
    this.snapshot = next;
    this.autoScan(next);
    const { at, ...rest } = next;
    const key = JSON.stringify(rest);
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.emit({ type: "snapshot", data: next });
    }
  }

  private summarize(agents: IslandAgent[], now: number, online: boolean): Pick<Snapshot, "mood" | "headline" | "counts"> {
    const att = agents.filter((a) => a.attention);
    const working = agents.filter((a) => a.state === "working");
    const done = agents.filter((a) => a.state === "done");
    const recentDone = done.filter((a) => now - a.since < RECENT_DONE_MS);
    const counts = { working: working.length, attention: att.length, done: done.length, idle: agents.length - att.length - working.length - done.length, total: agents.length };
    if (!online) return { mood: "offline", headline: "Orca is not reachable", counts };
    const where = whereOf;
    if (att.length) {
      const a = att[0];
      return { mood: "attention", headline: `${where(a)}: ${a.detail ?? "needs you"}${att.length > 1 ? ` (+${att.length - 1})` : ""}`, counts };
    }
    if (working.length) {
      const a = working[0];
      const step = a.steps.at(-1);
      const now1 = step ? (step.kind === "tool" ? `${step.tool}${step.text ? ": " + step.text : ""}` : step.text) : a.detail ?? "working";
      return { mood: "working", headline: working.length === 1 ? `${where(a)} · ${now1}` : `${working.length} agents working · ${where(a)}`, counts };
    }
    if (recentDone.length) return { mood: "done", headline: `${where(recentDone[0])} finished`, counts };
    return { mood: "idle", headline: agents.length ? `${agents.length} agent${agents.length > 1 ? "s" : ""} idle` : "Orca idle", counts };
  }

  private diff(prev: Snapshot, next: Snapshot) {
    const before = new Map(prev.agents.map((a) => [a.id, a]));
    const known = new Set(prev.hosts.filter((h) => h.online).map((h) => h.via));
    for (const a of next.agents) {
      const runtime = a.id.split("|")[0];
      if (!known.has(runtime)) continue; // first contact with a host: don't replay its history
      const p = before.get(a.id);
      const base = { agentId: a.id, workspace: whereOf(a), title: a.title, at: next.at };
      if (a.attention && !p?.attention) {
        const tell = (text?: string | null) => this.emit({ type: "activity", data: { ...base, kind: "attention", text: text || "needs your input" } });
        // "permission prompt" says little: read the prompt's own title off the screen first.
        const announce = () => {
          if (a.detail && !GENERIC.test(a.detail)) tell(a.detail);
          else this.screen(a.id).then(() => { this.rebuild(); tell(this.promptTitle(a.id) ?? a.detail); }, () => tell(a.detail));
        };
        if (prefs.autoDeliver) this.autoHold(a.id, announce);
        else announce();
      }
      else if (a.state === "done" && p && (p.state === "working" || p.state === "waiting"))
        this.emit({ type: "activity", data: { ...base, kind: "done", text: clip(a.lastMessage, 300) ?? "finished" } });
      else if (a.state === "working" && (!p || p.state === "done" || p.state === "idle"))
        this.emit({ type: "activity", data: { ...base, kind: "started", text: a.title } });
    }
  }

  /** The first line of the prompt last read off this agent's screen ("Held message from another session"). */
  private promptTitle(id: string): string | null {
    const seen = this.screens.get(id);
    if (!seen || Date.now() - seen.at > 120_000 || !seen.view.options.length) return null;
    return clip(seen.view.lines.find((l) => l.trim())?.trim(), 160) ?? null;
  }

  private emit(ev: Parameters<Parameters<OrcaWatcher["subscribe"]>[0]>[0]) {
    for (const fn of this.listeners) {
      try {
        fn(ev);
      } catch {}
    }
  }

  /**
   * Which harnesses a host can start: Orca's own detection (which CLIs are on that machine's
   * PATH), minus the ones you turned off in Orca, with your Orca default first. Checked every
   * 10 minutes per host.
   */
  private async detectAgents(hostId: string, runtime: string) {
    const known = this.launchable.get(hostId);
    if (this.detecting.has(hostId) || (known && Date.now() - known.at < 10 * 60_000)) return;
    this.detecting.add(hostId);
    try {
      const ssh = runtime === LOCAL && hostId !== LOCAL;
      const found = await this.rpc.call<any>(runtime, ssh ? "preflight.detectRemoteAgents" : "preflight.detectAgents", ssh ? { connectionId: hostId } : {});
      const ids: string[] = (Array.isArray(found) ? found : found?.agents ?? []).filter((x: unknown) => typeof x === "string");
      const launch = await this.rpc.call<any>(runtime, "settings.getAgentLaunch", {}).catch(() => null);
      const off = new Set<string>(launch?.settings?.disabledTuiAgents ?? []);
      const agents = [...new Set(ids)].filter((id) => !off.has(id)).sort(byCatalog);
      const preferred = launch?.settings?.defaultTuiAgent;
      if (preferred && agents.includes(preferred)) agents.unshift(...agents.splice(agents.indexOf(preferred), 1));
      this.launchable.set(hostId, { agents, at: Date.now() });
      this.rebuild();
    } catch {
      this.launchable.set(hostId, { agents: known?.agents ?? [], at: Date.now() - 8 * 60_000 }); // try again in ~2 min
    } finally {
      this.detecting.delete(hostId);
    }
  }

  // MARK: auto-deliver

  private autoFor(id: string): Auto {
    let st = this.autos.get(id);
    if (!st) {
      st = { next: Date.now() + AUTO_DELAY_MS, busy: false, tell: null, picked: false, sig: "", tries: 0, wait: 4000 };
      this.autos.set(id, st);
    }
    return st;
  }

  /** Hold the "needs you" ping until auto-deliver has looked; ping anyway if it can't look in time. */
  private autoHold(id: string, tell: () => void) {
    const st = this.autoFor(id);
    st.tell = tell;
    setTimeout(() => this.autos.get(id) === st && this.autoTell(st), 8000);
  }

  private autoTell(st: Auto) {
    const tell = st.tell;
    st.tell = null;
    tell?.();
  }

  private autoScan(snap: Snapshot) {
    const waiting = new Set(snap.agents.filter((a) => a.attention).map((a) => a.id));
    for (const id of this.autos.keys()) if (!waiting.has(id)) this.autos.delete(id);
    if (!prefs.autoDeliver) {
      for (const st of this.autos.values()) this.autoTell(st);
      this.autos.clear();
      return;
    }
    const now = Date.now();
    for (const id of waiting) {
      const st = this.autoFor(id);
      if (st.busy || now < st.next) continue;
      st.busy = true;
      this.autoAnswer(id, st).finally(() => (st.busy = false));
    }
  }

  private async autoAnswer(id: string, st: Auto) {
    let view: ScreenView;
    try {
      view = await this.screen(id);
    } catch {
      st.next = Date.now() + 5000;
      return;
    }
    const pick = autoChoice(view);
    if (!pick) {
      // Nothing to choose (a permission prompt, a question with no recommendation): it's
      // yours. An empty screen right after a pick is only the menu going away.
      if (view.options.length || !st.picked) this.autoTell(st);
      st.next = Date.now() + st.wait;
      st.wait = Math.min(st.wait * 2, 30_000);
      return;
    }
    const sig = [...view.lines, ...view.options.map((o) => o.label)].join("\n");
    st.tries = sig === st.sig ? st.tries + 1 : 1;
    st.sig = sig;
    if (st.tries > 3) {
      this.autoTell(st);
      st.next = Date.now() + 60_000;
      return;
    }
    try {
      await this.answer(id, { option: pick.option.n });
    } catch (e) {
      console.log(`[auto] ${id.split("|")[0]} ${pick.text}: failed, ${(e as Error).message}`);
      st.next = Date.now() + 2000;
      return;
    }
    st.picked = true;
    st.tell = null;
    st.wait = 4000;
    st.next = Date.now() + 2500;
    console.log(`[auto] ${id.split("|")[0]} ${pick.text}`);
    const a = this.agent(id);
    if (a) this.emit({ type: "activity", data: { kind: "auto", agentId: id, workspace: whereOf(a), title: a.title, text: pick.text, at: Date.now() } });
  }

  // MARK: actions

  private route(id: string): { runtime: string; key: string } {
    const i = id.indexOf("|");
    if (i < 0) return { runtime: LOCAL, key: id };
    return { runtime: id.slice(0, i), key: id.slice(i + 1) };
  }

  agent(id: string): IslandAgent | undefined {
    return this.snapshot.agents.find((a) => a.id === id);
  }

  async terminalFor(id: string, fresh = false): Promise<{ runtime: string; handle: string }> {
    const cached = this.handles.get(id);
    if (cached && !fresh) return cached;
    const { runtime, key } = this.route(id);
    const res = await this.rpc.call<any>(runtime, "terminal.list", {});
    const t = (res.terminals ?? []).find((t: any) => t.recordedPaneKey === key || `${t.tabId}:${t.leafId}` === key);
    if (!t) {
      this.handles.delete(id);
      throw new OrcaError("That agent's terminal is gone", "terminal_not_found");
    }
    const found = { runtime, handle: t.handle };
    this.handles.set(id, found);
    return found;
  }

  async screen(id: string): Promise<ScreenView & { handle: string }> {
    let { runtime, handle } = await this.terminalFor(id);
    let res: any;
    try {
      res = await this.rpc.call<any>(runtime, "terminal.read", { terminal: handle, screen: true });
    } catch (e) {
      if (!(e instanceof OrcaError) || !/stale|not_found/.test(e.code)) throw e;
      ({ runtime, handle } = await this.terminalFor(id, true)); // terminal restarted: look it up again
      res = await this.rpc.call<any>(runtime, "terminal.read", { terminal: handle, screen: true });
    }
    const view = { handle, ...parseScreen(res.terminal?.tail ?? [], { unnumbered: !!this.agent(id)?.attention }) };
    this.screens.set(id, { view, at: Date.now() });
    return view;
  }

  /** Raw keystrokes (menu digits, typed answers, Enter) go straight over RPC: no CLI spawn. */
  private async keys(runtime: string, handle: string, text: string | null, enter: boolean) {
    try {
      await this.rpc.call(runtime, "terminal.send", {
        terminal: handle, ...(text ? { text } : {}), enter, interrupt: false, client: { id: "floe", type: "desktop" },
      });
    } catch {
      const args = ["terminal", "send", "--terminal", handle];
      if (text) args.push("--text", text);
      if (enter) args.push("--enter");
      await this.rpc.cli(runtime, args);
    }
  }

  /** A follow-up prompt keeps the CLI's prompt delivery (bracketed paste, submit receipts). */
  private prompt(runtime: string, handle: string, text: string) {
    return this.rpc.cli(runtime, ["terminal", "send", "--terminal", handle, "--text", text, "--enter"]);
  }

  private settle(runtime: string) {
    setTimeout(() => this.pollHost(runtime), 250);
    setTimeout(() => this.pollHost(runtime), 1000);
  }

  /** Answer a menu option, type a free-text answer, or send a follow-up prompt. */
  async answer(id: string, body: { option?: number; text?: string }): Promise<string> {
    const { runtime } = this.route(id);
    // The island just showed this screen; reuse it if it's fresh instead of reading again.
    const recent = this.screens.get(id);
    const view = recent && Date.now() - recent.at < 8000 ? recent.view : await this.screen(id);
    const { handle, options } = view;
    if (body.option !== undefined) {
      if (!view.numbered) return this.pickByArrows(id, body.option);
      if (!options.some((o) => o.n === body.option)) {
        const now = await this.screen(id); // the menu may have changed: check the live screen once
        if (!now.options.some((o) => o.n === body.option)) throw new OrcaError(`Option ${body.option} is no longer on screen`, "stale_menu");
      }
      await this.keys(runtime, handle, String(body.option), false);
      this.screens.delete(id);
      this.settle(runtime);
      return `picked ${body.option}`;
    }
    const text = body.text?.trim();
    if (!text) throw new OrcaError("Nothing to send", "invalid_argument");
    if (options.length) {
      // A menu is up: route the text through its free-text option when it has one.
      const free = options.find((o) => o.freeText);
      if (!free) throw new OrcaError("This prompt only accepts one of its options", "menu_only");
      await this.keys(runtime, handle, String(free.n), false);
      await Bun.sleep(250);
      await this.keys(runtime, handle, text, false);
      await Bun.sleep(80);
      await this.keys(runtime, handle, null, true);
      this.screens.delete(id);
      this.settle(runtime);
      return `answered via “${free.label}”`;
    }
    await this.prompt(runtime, handle, text); // agent prompt: Orca bracket-pastes and submits
    this.settle(runtime);
    return "sent";
  }

  /**
   * A menu without numbers: read where the ❯ is right now (someone may have moved it in the
   * terminal), step it to the option with ↑/↓ one key at a time, then press Enter.
   */
  private async pickByArrows(id: string, n: number): Promise<string> {
    const { runtime } = this.route(id);
    const { handle, options } = await this.screen(id);
    const want = options.find((o) => o.n === n);
    const from = options.findIndex((o) => o.selected);
    if (!want || from < 0) throw new OrcaError(`Option ${n} is no longer on screen`, "stale_menu");
    const steps = n - 1 - from;
    for (let i = 0; i < Math.abs(steps); i++) {
      await this.keys(runtime, handle, steps > 0 ? "\x1b[B" : "\x1b[A", false);
      await Bun.sleep(90);
    }
    // Check the ❯ landed on the right option before committing to it.
    const now = await this.screen(id);
    if (!now.options.find((o) => o.n === n)?.selected) throw new OrcaError(`Couldn't move to “${want.label}”; pick it in the terminal`, "stale_menu");
    await this.keys(runtime, handle, null, true);
    this.screens.delete(id);
    this.settle(runtime);
    return `picked “${want.label}”`;
  }

  async focus(id: string) {
    const { runtime, handle } = await this.terminalFor(id);
    await this.rpc.cli(runtime, ["terminal", "switch", "--terminal", handle]);
    Bun.spawn(["/usr/bin/open", "-a", "Orca"]);
  }

  /** Start an agent in any workspace on any host. `workspaceKey` is `${runtime}|${worktreeId}`. */
  async launch(workspaceKey: string, agent: string, prompt?: string): Promise<string> {
    const { runtime, key: worktreeId } = this.route(workspaceKey);
    const args = ["agent", "launch", "--agent", agent, "--worktree", `id:${worktreeId}`];
    if (prompt?.trim()) args.push("--prompt", prompt.trim());
    const res = await this.rpc.cli<any>(runtime, args, 60_000);
    setTimeout(() => this.pollHost(runtime), 800);
    return res?.receipt?.detail ?? `started ${agent}`;
  }

  /** Terminals in one workspace on any host. The first is the workspace's main terminal. */
  async terminals(workspaceKey: string) {
    const { runtime, key: worktreeId } = this.route(workspaceKey);
    const res = await this.rpc.call<any>(runtime, "terminal.list", { worktree: `id:${worktreeId}` });
    const agentIds = new Set(this.snapshot.agents.map((a) => a.id));
    return (res.terminals ?? []).map((t: any, i: number) => {
      const keys = [t.recordedPaneKey, t.tabId && t.leafId ? `${t.tabId}:${t.leafId}` : null].filter(Boolean).map((k) => `${runtime}|${k}`);
      const agentId = keys.find((k) => agentIds.has(k)) ?? null;
      return {
        id: `${runtime}|${t.handle}`,
        title: t.paneTitle || t.title || `Terminal ${i + 1}`,
        agentType: t.agentIdentity ?? null,
        agentLabel: t.agentIdentity ? agentLabel(t.agentIdentity) : null,
        agentId,
        preview: clip(oneLine(String(t.preview ?? "")), 160),
        lastOutputAt: t.lastOutputAt ?? null,
        connected: t.connected !== false,
        main: i === 0,
      };
    });
  }

  async terminalScreen(id: string): Promise<string[]> {
    const { runtime, key: handle } = this.route(id);
    const res = await this.rpc.call<any>(runtime, "terminal.read", { terminal: handle, screen: true });
    const tail: string[] = (res.terminal?.tail ?? []).map((l: string) => l.replace(/\s+$/, ""));
    while (tail.length && !tail[tail.length - 1]) tail.pop();
    return tail.slice(-24);
  }

  async terminalSend(id: string, text: string, enter = true) {
    const { runtime, key: handle } = this.route(id);
    const args = ["terminal", "send", "--terminal", handle];
    if (text) args.push("--text", text);
    if (enter) args.push("--enter");
    await this.rpc.cli(runtime, args);
  }

  async terminalFocus(id: string) {
    const { runtime, key: handle } = this.route(id);
    await this.rpc.cli(runtime, ["terminal", "switch", "--terminal", handle]);
    Bun.spawn(["/usr/bin/open", "-a", "Orca"]);
  }

  async newTerminal(workspaceKey: string, command?: string): Promise<string | null> {
    const { runtime, key: worktreeId } = this.route(workspaceKey);
    const args = ["terminal", "create", "--worktree", `id:${worktreeId}`, "--title", "Floe"];
    if (command?.trim()) args.push("--command", command.trim());
    const res = await this.rpc.cli<any>(runtime, args);
    const handle = res?.terminal?.handle ?? res?.handle;
    return handle ? `${runtime}|${handle}` : null;
  }

  /** Bring Orca to a workspace: its first terminal if it has one. */
  async focusWorkspace(workspaceKey: string) {
    const { runtime, key: worktreeId } = this.route(workspaceKey);
    const res = await this.rpc.call<any>(runtime, "terminal.list", { worktree: `id:${worktreeId}` });
    const t = res.terminals?.[0];
    if (t) await this.rpc.cli(runtime, ["terminal", "switch", "--terminal", t.handle]).catch(() => {});
    Bun.spawn(["/usr/bin/open", "-a", "Orca"]);
  }
}
