// The island's "talk to Orca" brain: a headless Claude Code session (claude -p) that can
// read every Orca repo and drive Orca through its CLI. One conversation, resumed across
// asks, so follow-ups work. It runs from Floe's brain/ folder, which is also an
// Orca folder workspace, so "Open in Orca" can resume the same session in an Orca terminal.

import { childEnv, loadState, saveState, type ChatMessage, type Config, type State } from "./config";
import type { OrcaWatcher, Snapshot } from "./orca";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { IS_MAC, IS_WIN, dirs, openOrca, orcaCli } from "./platform";

const MACHINE = IS_MAC ? "Mac" : "computer";

export type BrainEvent =
  | { type: "start"; sessionId: string | null }
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "done"; sessionId: string | null; text: string; costUsd: number | null; durationMs: number | null }
  | { type: "error"; message: string };

const SYSTEM = (repos: string, hosts: string) => `You are Floe: the voice of the user's Orca (the Stably AI agent IDE), shown in a small Dynamic-Island overlay at the top of their screen. They may be mid-game, glancing at you between fights.

Style: answer in 1-4 short sentences or a tight list. Plain text only: no markdown headings, tables or code fences (it renders in a tiny panel). Lead with the answer. Don't ask clarifying questions unless you truly cannot act.

Orca spans several hosts: this ${MACHINE}, paired Orca servers (other machines running Orca), and SSH targets that this ${MACHINE}'s Orca drives. Each host has its own projects, workspaces (worktrees), terminals and coding agents. You drive all of it through the \`orca\` CLI. Always pass --json. For a paired Orca server add --environment "<host id>" to every command; for this ${MACHINE} and its SSH targets add nothing. Terminal handles and worktree ids belong to the host that issued them.

Each user message starts with an <orca_live> block: the live state of every agent on every host right now, with its host, workspace id and current tool. Trust it for "what's going on" questions.

Useful commands:
- orca worktree ps --json: every workspace and its agents (state working|waiting|done|idle, lastAssistantMessage, toolName, toolInput)
- orca terminal list --json, then orca terminal read --terminal <handle> --screen --json: see exactly what an agent's terminal shows (match the agent's paneKey to recordedPaneKey)
- orca terminal send --terminal <handle> --text "..." --enter --json: send an agent a follow-up. To answer a numbered menu send just the digit as --text, without --enter.
- orca agent launch --agent claude|codex --worktree id:<worktreeId> --prompt "..." --json: start an agent in an existing workspace
- orca worktree create --repo id:<repoId> --name <slug> --no-parent --agent codex --prompt "..." --json: new worktree + agent
- orca repo list --json: projects on a host
- orca search "<distinctive phrase>" --json: agent session history (may be disabled)
- orca skills get orca-cli: the full CLI guide, read it before unfamiliar commands
You are not inside an Orca terminal: never use the active/current selectors, always use explicit id: selectors.
Never remove worktrees, close terminals, interrupt agents, discard changes or push code unless the user explicitly asks in this conversation.

You can read this ${MACHINE}'s repos directly with Read/Grep/Glob, and run read-only git as \`git -C <repo path> log|status|diff|show|branch …\`. Remote hosts' files are only reachable through their Orca terminals. Anything outside your allowed tools is denied automatically because nobody is at the keyboard to approve it: if you hit a denial, say what you would have run and suggest doing it from Orca. Never ask the user to approve a tool.

Hosts (name, kind, host id for --environment):
${hosts}

This ${MACHINE}'s repos (name, repoId, path):
${repos}`;

function liveBlock(s: Snapshot): string {
  if (!s.online) return `<orca_live>Orca is not reachable: ${s.error ?? "unknown"}</orca_live>`;
  const t = new Date(s.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const rows = s.agents.map((a) => {
    const runtime = a.id.split("|")[0];
    const bits = [
      `${a.state}${a.attention ? `(${a.attention})` : ""}`,
      `host=${a.hostName}${runtime === "local" ? "" : ` (--environment ${runtime})`}`,
      `${a.workspace} [${a.agentType}] "${a.title}"`,
      `worktreeId=${a.worktreeId}`,
      `paneKey=${a.paneKey}`,
    ];
    if (a.detail) bits.push(`now: ${a.detail}`);
    if (a.lastMessage && !a.attention) bits.push(`last said: ${a.lastMessage.slice(0, 200).replace(/\s+/g, " ")}`);
    return "- " + bits.join(" | ");
  });
  const hosts = s.hosts
    .filter((h) => h.counts.workspaces > 0)
    .map((h) => `${h.name}: ${h.projects.length} projects, ${h.counts.workspaces} workspaces${h.online ? "" : " (offline)"}`);
  return `<orca_live time="${t}">\nhosts: ${hosts.join("; ")}\n${rows.length ? rows.join("\n") : "no agents running"}\n</orca_live>`;
}

export class Brain {
  state: State = loadState();
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private repoDirs: string[] = [];
  private system = "";

  constructor(private cfg: Config, private orca: OrcaWatcher) {}

  get busy() {
    return this.proc !== null;
  }

  private async prepare() {
    const hostLines = this.orca.snapshot.hosts
      .map((h) => `- ${h.name} | ${h.kind}${h.online ? "" : " (offline)"} | ${h.kind === "environment" ? h.via : `(none: this ${MACHINE}'s runtime)`}`)
      .join("\n");
    try {
      const res = await this.orca.rpc.call<any>("local", "repo.list", {});
      const repos: any[] = res.repos ?? [];
      this.repoDirs = repos.map((r) => r.path).filter((p: string) => p && p.startsWith("/"));
      const repoLines = repos.map((r) => `- ${r.displayName} | ${r.id} | ${r.path}`).join("\n");
      this.system = SYSTEM(repoLines || "(none)", hostLines || "(unknown)");
    } catch {
      if (!this.system) this.system = SYSTEM("(Orca unreachable at session start; run orca repo list --json)", hostLines || "(unknown)");
    }
  }

  reset() {
    this.stop();
    this.state = { sessionId: null, messages: [] };
    saveState(this.state);
  }

  stop() {
    this.proc?.kill();
    this.proc = null;
  }

  async ask(text: string, emit: (e: BrainEvent) => void, retried = false): Promise<void> {
    this.stop();
    await this.prepare();
    const resume = this.state.sessionId;
    const dirs = [...this.repoDirs, ...this.cfg.extraDirs];
    const args = [
      this.cfg.claudeBin, "-p",
      "--output-format", "stream-json", "--verbose", "--include-partial-messages",
      "--model", this.cfg.model,
      // Skip user-level hooks, plugins and MCP servers: faster start, no side effects.
      "--setting-sources", "project,local", "--strict-mcp-config",
      "--append-system-prompt", this.system,
      ...(dirs.length ? ["--add-dir", ...dirs] : []),
      "--allowedTools", ...this.cfg.allowedTools,
      ...(resume ? ["--resume", resume] : []),
    ];
    const proc = Bun.spawn(args, { cwd: this.cfg.brainDir, stdin: "pipe", stdout: "pipe", stderr: "pipe", env: brainEnv(this.cfg), windowsHide: true });
    this.proc = proc;
    proc.stdin.write(`${liveBlock(this.orca.snapshot)}\n\n${text}`);
    proc.stdin.end();

    if (!retried) this.push({ role: "user", text, at: Date.now() });
    emit({ type: "start", sessionId: resume });

    let answer = "";
    let textBlocks = 0;
    const tools: string[] = [];
    let finished = false;
    const decoder = new TextDecoder();
    let buf = "";
    const handle = (e: any) => {
      if (e.type === "system" && e.subtype === "init" && e.session_id) this.state.sessionId = e.session_id;
      else if (e.type === "stream_event") {
        const ev = e.event;
        if (ev?.type === "content_block_start" && ev.content_block?.type === "text") {
          if (textBlocks++ > 0 && answer) {
            answer += "\n\n";
            emit({ type: "delta", text: "\n\n" });
          }
        } else if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          answer += ev.delta.text;
          emit({ type: "delta", text: ev.delta.text });
        }
      } else if (e.type === "assistant") {
        for (const b of e.message?.content ?? []) {
          if (b.type !== "tool_use") continue;
          const i = b.input ?? {};
          const summary = String(i.command ?? i.file_path ?? i.pattern ?? i.query ?? i.url ?? i.description ?? "").split("\n")[0].slice(0, 120);
          tools.push(`${b.name}${summary ? ": " + summary : ""}`);
          emit({ type: "tool", name: b.name, summary });
        }
      } else if (e.type === "result") {
        finished = true;
        if (e.session_id) this.state.sessionId = e.session_id;
        if (e.is_error || e.subtype !== "success") {
          emit({ type: "error", message: String(e.result ?? e.subtype ?? "brain failed").slice(0, 400) });
        } else {
          const final = answer.trim() || String(e.result ?? "").trim();
          this.push({ role: "assistant", text: final, at: Date.now(), tools });
          emit({ type: "done", sessionId: this.state.sessionId, text: final, costUsd: e.total_cost_usd ?? null, durationMs: e.duration_ms ?? null });
        }
      }
    };

    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          handle(JSON.parse(line));
        } catch {}
      }
    }
    const code = await proc.exited;
    const stderr = await new Response(proc.stderr as ReadableStream).text();
    if (this.proc === proc) this.proc = null;
    saveState(this.state);
    if (finished) return;
    if (resume && !retried && /no conversation found|session/i.test(stderr)) {
      // The saved session vanished (cleared, or claude upgraded): start fresh once.
      this.state.sessionId = null;
      return this.ask(text, emit, true);
    }
    if (code !== 0 && code !== null && proc.signalCode !== "SIGTERM")
      emit({ type: "error", message: stderr.trim().split("\n").slice(-3).join(" ").slice(0, 400) || `claude exited ${code}` });
    else if (proc.signalCode === "SIGTERM") emit({ type: "error", message: "stopped" });
  }

  private push(m: ChatMessage) {
    this.state.messages.push(m);
    if (this.state.messages.length > 60) this.state.messages.splice(0, this.state.messages.length - 60);
    saveState(this.state);
  }

  /** Continue this conversation in a real Orca terminal (at your desk, with full Claude Code). */
  async openInOrca(): Promise<string> {
    const sid = this.state.sessionId;
    if (!sid) throw new Error("No Floe conversation yet");
    const ws = this.orca.snapshot.hosts
      .find((h) => h.id === "local")
      ?.projects.flatMap((p) => p.workspaces)
      .find((w) => w.path === this.cfg.brainDir);
    if (!ws) throw new Error(`Add ${this.cfg.brainDir} to Orca first (orca repo add --path … --kind folder)`);
    const res = await this.orca.rpc.cli<any>("local", [
      "terminal", "create", "--worktree", `id:${ws.worktreeId}`, "--title", "Floe chat", "--command", `${shellPath(this.cfg.claudeBin)} --resume ${sid}`,
    ]);
    const handle = res.terminal?.handle ?? res.handle;
    if (handle) await this.orca.rpc.cli("local", ["terminal", "switch", "--terminal", handle]).catch(() => {});
    openOrca(this.cfg.orcaUserData, this.cfg.orcaApp);
    return handle ?? "opened";
  }
}

/** A program path as the host's shell needs it (PowerShell runs a quoted path with `&`). */
function shellPath(p: string): string {
  if (!/\s/.test(p)) return p;
  return IS_WIN ? `& "${p}"` : `'${p.replace(/'/g, "'\\''")}'`;
}

/**
 * The brain runs `orca …`. On Linux a bare `orca` is the GNOME screen reader and Orca's own CLI
 * (`orca-ide`) is often only inside its AppImage, whose mount moves every launch; on Windows it may
 * not be on PATH. So an `orca` that runs this Orca's real CLI goes first on the brain's PATH,
 * rewritten for every ask.
 */
export function brainEnv(cfg: Config): Record<string, string> {
  const env = childEnv();
  if (IS_MAC) return env;
  try {
    const cli = orcaCli(cfg.orcaUserData, cfg.orcaApp, cfg.orcaBin);
    const bin = join(dirs.cache, "brain-bin");
    mkdirSync(bin, { recursive: true });
    // sh for Linux and for Claude Code's Git Bash on Windows; .cmd for cmd and PowerShell
    writeFileSync(join(bin, "orca"), `#!/bin/sh\nexec "${cli.replace(/\\/g, "/")}" "$@"\n`);
    chmodSync(join(bin, "orca"), 0o755);
    if (IS_WIN) writeFileSync(join(bin, "orca.cmd"), `@"${cli}" %*\r\n`);
    const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
    env[key] = bin + delimiter + (env[key] ?? "");
  } catch {}
  return env;
}
