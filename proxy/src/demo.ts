// Demo mode (FLOE_DEMO=1): a made-up Orca with four hosts, for screenshots, videos and trying
// Floe without Orca. It has the same surface as OrcaWatcher. One agent works through a loop
// of tool calls, one asks a question you can answer from the overlay, one has finished, and
// one host is offline. Nothing here touches Orca or your files.

import type { Activity, HostView, IslandAgent, Snapshot, Step } from "./orca";
import type { ScreenView } from "./menu";
import { agentLabel, kind } from "./agents";

type Listener = (ev: { type: "snapshot"; data: Snapshot } | { type: "activity"; data: Activity }) => void;

const HOSTS = [
  { id: "local", name: "Studio Mac", kind: "local" as const, online: true, agents: ["claude", "codex", "omp", "gemini", "opencode"] },
  { id: "demo-build", name: "Build Server", kind: "environment" as const, online: true, agents: ["codex", "claude", "pi"] },
  { id: "demo-gpu", name: "GPU Rig", kind: "environment" as const, online: true, agents: ["codex", "gemini"] },
  { id: "demo-pi", name: "Pi Cluster", kind: "ssh" as const, online: false, agents: [] as string[] },
];

const PROJECTS: Record<string, [string, string[]][]> = {
  local: [["orbit-web", ["main", "feat/checkout", "fix/safari-scroll"]], ["design-system", ["main"]], ["pocket-api", ["main"]]],
  "demo-build": [["pocket-api", ["main", "fix/rate-limit"]], ["data-pipeline", ["main", "feat/backfill"]]],
  "demo-gpu": [["vision-lab", ["main", "exp/distill"]]],
  "demo-pi": [["home-automation", ["main"]]],
};

/** The working agent's loop of tool calls, one every ~2.4 s. */
const LOOP: [Step["kind"], string | null, string][] = [
  ["tool", "Read", "src/cart/applyCoupon.ts"],
  ["tool", "Grep", "\"couponCode\" in src/"],
  ["say", null, "The coupon is applied after tax. Moving it before the tax step."],
  ["tool", "Edit", "src/cart/applyCoupon.ts"],
  ["tool", "Edit", "src/cart/total.test.ts"],
  ["tool", "Bash", "npm test -- cart"],
  ["say", null, "18 tests pass. Checking the checkout page renders the discount."],
  ["tool", "Bash", "npx playwright test checkout.spec.ts"],
  ["tool", "Read", "playwright-report/index.html"],
];

const QUESTION = "Use a Redis-backed limiter, or keep it in memory?";
const OPTIONS = ["Redis, shared by every instance", "In memory, per instance", "Type something."];

export class DemoWatcher {
  snapshot: Snapshot = {
    at: 0, online: true, error: null, mood: "idle", headline: "", counts: { working: 0, attention: 0, done: 0, idle: 0, total: 0 }, agents: [], hosts: [],
  };
  private listeners = new Set<Listener>();
  private timers: Timer[] = [];
  private t0 = Date.now();
  private tick = 0;
  private answeredAt = 0;
  private answer = "";

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start() {
    this.build();
    this.timers.push(setInterval(() => { this.tick++; this.build(); }, 2400));
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
  }

  private emit(ev: Parameters<Listener>[0]) {
    for (const fn of this.listeners) try { fn(ev); } catch {}
  }

  private build() {
    const now = Date.now();
    const agents: IslandAgent[] = [];
    const agent = (hostId: string, project: string, ws: string, a: Partial<IslandAgent>): IslandAgent => {
      const host = HOSTS.find((h) => h.id === hostId)!;
      const key = `${hostId}|wt-${project}-${ws}`;
      return {
        id: `${hostId}|pane-${project}-${ws}`, paneKey: `pane-${project}-${ws}`, hostId, hostName: host.name,
        worktreeId: `wt-${project}-${ws}`, workspaceKey: key, workspace: ws, project, path: `~/code/${project}`,
        agentType: "claude", state: "idle", title: "", tool: null, detail: null, attention: null, progress: null,
        lastMessage: null, since: this.t0, updatedAt: now, steps: [], ...a, agentLabel: agentLabel(a.agentType ?? "claude"),
      };
    };

    // 1. writing a feature on this Mac: a rolling window of its tool calls
    const n = this.tick % (LOOP.length + 2);
    const steps: Step[] = LOOP.slice(0, Math.min(n + 1, LOOP.length)).map(([kind, tool, text], i, all) => ({
      kind, tool, text, at: this.t0 + i * 2400, done: i < all.length - 1,
    })).slice(-8);
    const last = steps.at(-1)!;
    agents.push(agent("local", "orbit-web", "feat/checkout", {
      state: "working", title: "Apply coupons before tax at checkout", tool: last.tool, detail: last.text, steps, since: now - 4 * 60_000,
    }));

    // 2. a question on the build server (comes back a while after you answer it)
    const asking = !this.answeredAt || now - this.answeredAt > 40_000;
    agents.push(agent("demo-build", "pocket-api", "fix/rate-limit", asking
      ? { state: "waiting", attention: "question", title: "Rate-limit the public API", detail: QUESTION, since: now - 90_000,
          steps: [
            { kind: "tool", tool: "Read", text: "src/middleware/index.ts", at: now - 80_000, done: true },
            { kind: "tool", tool: "Grep", text: "\"express-rate-limit\"", at: now - 70_000, done: true },
            { kind: "say", tool: null, text: QUESTION, at: now - 60_000, done: false },
          ] }
      : { state: "working", title: "Rate-limit the public API", tool: "Edit", detail: "src/middleware/rateLimit.ts", since: this.answeredAt,
          steps: [
            { kind: "say", tool: null, text: `Going with: ${this.answer}`, at: this.answeredAt, done: true },
            { kind: "tool", tool: "Edit", text: "src/middleware/rateLimit.ts", at: this.answeredAt + 2000, done: false },
          ] }));

    // 3. a training run on the GPU rig
    const epoch = 1 + (Math.floor(this.tick / 6) % 3);
    agents.push(agent("demo-gpu", "vision-lab", "exp/distill", {
      agentType: "codex", state: "working", title: "Distill the detector to a 4M-param student", tool: "Bash", detail: `python train.py --epoch ${epoch}/3`,
      progress: Math.min(99, ((this.tick % 18) / 18) * 100), since: now - 12 * 60_000,
      steps: [
        { kind: "tool", tool: "Bash", text: "python train.py --student tiny --epochs 3", at: now - 600_000, done: true },
        { kind: "say", tool: null, text: `Epoch ${epoch}/3 · val mAP 0.${71 + epoch}`, at: now - 30_000, done: true },
        { kind: "tool", tool: "Bash", text: "tail -f runs/distill/log.txt", at: now - 10_000, done: false },
      ],
    }));

    // 4. finished, and resting
    agents.push(agent("local", "design-system", "main", {
      state: "done", title: "Ship the new focus ring tokens", lastMessage: "Released v2.3.1: focus rings use the new tokens in light and dark, and the changelog is updated.", since: now - 50_000,
    }));
    agents.push(agent("demo-build", "data-pipeline", "feat/backfill", { state: "idle", title: "Backfill March events", lastMessage: "Backfill done: 1.2M rows." }));

    const hosts: HostView[] = HOSTS.map((h) => {
      const mine = agents.filter((a) => a.hostId === h.id);
      return {
        id: h.id, name: h.name, kind: h.kind, via: h.id, online: h.online, error: null,
        projects: (PROJECTS[h.id] ?? []).map(([name, wss]) => ({
          key: `${h.id}|${name}`, name,
          workspaces: wss.map((w, i) => ({
            key: `${h.id}|wt-${name}-${w}`, worktreeId: `wt-${name}-${w}`, name: w, branch: w, path: `~/code/${name}`, status: "active",
            unread: false, liveTerminals: 1, isMain: i === 0, agentIds: mine.filter((a) => a.project === name && a.workspace === w).map((a) => a.id),
          })),
        })),
        counts: {
          working: mine.filter((a) => a.state === "working").length, attention: mine.filter((a) => a.attention).length,
          workspaces: (PROJECTS[h.id] ?? []).reduce((s, [, w]) => s + w.length, 0), agents: mine.length,
        },
        agents: h.agents.map(kind),
      };
    });
    const att = agents.filter((a) => a.attention);
    const working = agents.filter((a) => a.state === "working");
    const prev = this.snapshot;
    this.snapshot = {
      at: now, online: true, error: null,
      mood: att.length ? "attention" : working.length ? "working" : "idle",
      headline: att.length ? `Build Server · fix/rate-limit: ${QUESTION}` : `${working.length} agents working · feat/checkout`,
      counts: { working: working.length, attention: att.length, done: agents.filter((a) => a.state === "done").length, idle: agents.filter((a) => a.state === "idle").length, total: agents.length },
      agents, hosts,
    };
    for (const a of att) if (!prev.agents.find((p) => p.id === a.id)?.attention && prev.at)
      this.emit({ type: "activity", data: { kind: "attention", agentId: a.id, workspace: `${a.hostName} · ${a.workspace}`, title: a.title, text: a.detail ?? "", at: now } });
    this.emit({ type: "snapshot", data: this.snapshot });
  }

  agent(id: string) { return this.snapshot.agents.find((a) => a.id === id); }

  async screen(id: string): Promise<ScreenView & { handle: string }> {
    const a = this.agent(id);
    if (a?.attention) {
      return {
        handle: "demo", numbered: true, options: OPTIONS.map((label, i) => ({ n: i + 1, label, selected: i === 0, freeText: i === 2 })),
        lines: ["● I found two places that create the Express app.", "", "  The limiter has to see every request, so it goes in", "  src/middleware/index.ts before the routers.", "", `  ${QUESTION}`],
      };
    }
    return { handle: "demo", numbered: true, options: [], lines: (a?.steps ?? []).map((s) => (s.kind === "tool" ? `⏺ ${s.tool}(${s.text})` : `● ${s.text}`)) };
  }

  async answer(id: string, body: { option?: number; text?: string }): Promise<string> {
    this.answeredAt = Date.now();
    this.answer = body.text ?? OPTIONS[(body.option ?? 1) - 1] ?? "your answer";
    this.build();
    return "sent";
  }

  async focus(_id: string) {}
  async launch(_key: string, agent: string, _prompt?: string) { return `started ${agent} (demo)`; }
  async terminals(key: string) {
    return [{ id: `${key}|t1`, title: "zsh", isMain: true, agentId: null, preview: "~/code $ " }];
  }
  async terminalScreen(_id: string) { return ["~/code $ git status", "On branch main", "nothing to commit, working tree clean", "~/code $ "]; }
  async terminalSend(_id: string, _text: string, _enter = true) {}
  async terminalFocus(_id: string) {}
  async newTerminal(_key: string, _command?: string) { return null; }
  async focusWorkspace(_key: string) {}
}
