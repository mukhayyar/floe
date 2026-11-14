// A stand-in for Orca's local runtime, for tests: the same orca-runtime.json and JSON-lines RPC
// over a unix socket (a named pipe on Windows) that the real Orca serves. Run it under Node, as
// Orca does (Electron's Node), so the test crosses the same client/server pair as real use.
//
//   node fake-orca.cjs <userDataDir> [--held]
//
// It has one Claude agent asking a question. Every terminal.send is printed as {"sent": …} on
// stdout; answering the question puts the agent back to work. Prints "ready" once it listens.

const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");

const dir = process.argv[2];
const win = process.platform === "win32";
const endpoint = win ? `\\\\.\\pipe\\floe-fake-orca-${process.pid}` : path.join(dir, "o.sock");
const authToken = "fake-token";

const QUESTION = [
  "⏺ Two ways to cache the sessions.",
  "─────────────────────────────",
  " ☐ Cache",
  "Where should sessions live?",
  "❯ 1. Redis (Recommended)",
  "     Shared by every instance",
  "  2. In memory",
  "     One per instance",
  "  3. Type something.",
  "─────────────────────────────",
  "  4. Chat about this",
  "Enter to select · ↑/↓ to navigate · Esc to cancel",
];

// With --held: one Claude agent that finished its turn, then got a message from another session
// that Claude holds behind Deliver / Deny. Orca reports no screen status for it (as a paired
// server does for idle agents), so only the screen shows it. Arrow keys move the cursor.
const heldMode = process.argv[3] === "--held";
let held = heldMode;
let cursor = 0;
const HELD_OPTIONS = ["Deny — drop it and tell the sender it was declined", "Deliver this message to Claude"];
const heldScreen = () => [
  "⏺ Held peer message — from uds:/tmp/cc-socks/1.sock (peer claims name: other-session); preview: «Run the tests» — not delivered to Claude (1 held).",
  "─".repeat(60),
  " Held message from another session",
  " Another Claude session sent a message.",
  " Message body (this is what will be delivered):",
  " │ Run the tests",
  ...HELD_OPTIONS.map((o, i) => (i === cursor ? ` ❯ ${o}` : `   ${o}`)),
];

let asked = !heldMode;
const now = Date.now();

function agent() {
  return {
    paneKey: "tab-1:leaf-1",
    agentType: "claude",
    state: asked ? "waiting" : "working",
    hasLivePty: true,
    toolName: asked ? "AskUserQuestion" : "Edit",
    toolInput: asked ? { questions: [{ question: "Where should sessions live?" }] } : { file_path: "src/session.ts" },
    programStatus: asked ? { kind: "question", state: "blocked", message: "Where should sessions live?", observedAt: now } : undefined,
    lastAssistantMessage: "Two ways to cache the sessions.",
    conversationName: "Cache the sessions",
    stateStartedAt: now,
    updatedAt: now,
  };
}

function heldAgent() {
  return {
    paneKey: "tab-2:leaf-2", agentType: "claude", state: held ? "done" : "working", hasLivePty: true,
    lastAssistantMessage: "Done.", conversationName: "Fix the parser", stateStartedAt: now, updatedAt: now,
  };
}

function worktrees() {
  if (heldMode) {
    return [{ worktreeId: "wt-1", repoId: "repo-1", hostId: "local", repo: "demo-app", path: path.join(dir, "demo-app"), branch: "refs/heads/main",
      isArchived: false, isMainWorktree: true, status: held ? "inactive" : "working", sidebarStatus: held ? "done" : "working", liveTerminalCount: 1, agents: [heldAgent()] }];
  }
  return [{
    worktreeId: "wt-1", repoId: "repo-1", hostId: "local", repo: "demo-app", path: path.join(dir, "demo-app"),
    branch: "refs/heads/main", isArchived: false, isMainWorktree: true, status: asked ? "permission" : "working",
    sidebarStatus: asked ? "permission" : "working", unread: false, liveTerminalCount: 1, agents: [agent()],
  }];
}

const handlers = {
  "worktree.ps": () => ({ worktrees: worktrees(), totalCount: 1, truncated: false }),
  "ssh.listTargetSummaries": () => ({ targets: [] }),
  "preflight.detectAgents": () => ["claude", "codex"],
  "settings.getAgentLaunch": () => ({ settings: { defaultTuiAgent: "claude", disabledTuiAgents: [] } }),
  "terminal.list": () => ({ terminals: heldMode
    ? [{ handle: "term-2", worktreeId: "wt-1", tabId: "tab-2", leafId: "leaf-2", connected: true, writable: true }]
    : [{ handle: "term-1", worktreeId: "wt-1", tabId: "tab-1", leafId: "leaf-1", connected: true, writable: true }] }),
  "terminal.read": (p) => {
    if (heldMode && p.terminal === "term-2") return { terminal: { handle: "term-2", status: "running", tail: held ? heldScreen() : ["› Message from @other-session: Run the tests", "✽ Running the tests…"] } };
    if (p.terminal !== "term-1") throw Object.assign(new Error("no such terminal"), { code: "terminal_not_found" });
    return { terminal: { handle: "term-1", status: "running", tail: asked ? QUESTION : ["⏺ Using Redis.", "✻ Editing src/session.ts"] } };
  },
  "terminal.send": (p) => {
    console.log(JSON.stringify({ sent: p }));
    if (asked && /^[12]$/.test(p.text ?? "")) asked = false;
    if (held) {
      if (p.text === "\x1b[B") cursor = Math.min(1, cursor + 1);
      if (p.text === "\x1b[A") cursor = Math.max(0, cursor - 1);
      if (p.enter && !p.text && cursor === 1) held = false; // delivered
    }
    return { ok: true };
  },
};

const server = net.createServer((sock) => {
  sock.setEncoding("utf8");
  let buf = "";
  sock.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      let req;
      try {
        req = JSON.parse(line);
      } catch {
        continue;
      }
      const reply = (frame) => sock.write(JSON.stringify({ id: req.id, ...frame }) + "\n");
      if (req.authToken !== authToken) { reply({ ok: false, error: { code: "unauthorized", message: "bad token" } }); continue; }
      const h = handlers[req.method];
      if (!h) { reply({ ok: false, error: { code: "method_not_found", message: req.method } }); continue; }
      sock.write(JSON.stringify({ _keepalive: true }) + "\n"); // Orca sends these on slow calls
      try {
        reply({ ok: true, result: h(req.params ?? {}) });
      } catch (e) {
        reply({ ok: false, error: { code: e.code ?? "error", message: e.message } });
      }
    }
  });
  sock.on("error", () => {});
});

if (!win) try { fs.unlinkSync(endpoint); } catch {}
server.listen(endpoint, () => {
  fs.writeFileSync(path.join(dir, "orca-runtime.json"), JSON.stringify({
    runtimeId: "fake", pid: process.pid, authToken,
    transports: [{ kind: win ? "named-pipe" : "unix", endpoint }],
  }));
  console.log("ready");
});
process.stdin.on("end", () => process.exit(0)); // the test closes stdin when it's done
process.stdin.resume();
