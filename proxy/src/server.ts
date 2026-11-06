// Floe proxy: the bridge between the top-of-screen Floe overlay and the local Orca app.
//
//   GET  /health                     liveness
//   GET  /status                     snapshot: hosts → projects → workspaces, agents with step timelines
//   GET  /events                     SSE: `snapshot` on every change, `activity` on transitions
//   GET  /agents/:id/screen          what the agent's terminal shows + parsed menu options
//   POST /agents/:id/answer          {option:n} | {text}  answer a question / send a follow-up
//   POST /agents/:id/focus           jump to that agent in Orca
//   POST /workspaces/:key/launch     {agent, prompt?}  start claude/codex in any workspace on any host
//   POST /workspaces/:key/focus      open that workspace in Orca
//   GET  /workspaces/:key/terminals  its terminals (first = main terminal)
//   POST /workspaces/:key/terminal   {command?}  open a new terminal there
//   GET  /terminals/:id/screen       what a terminal shows right now
//   POST /terminals/:id/send         {text, enter?}  type into a terminal
//   POST /terminals/:id/focus        show that terminal in Orca
//   GET  /chat                       Floe conversation history
//   POST /ask                        {text} → SSE stream of the brain's answer
//   POST /ask/stop                   stop the current answer
//   POST /chat/new                   start a fresh conversation
//   POST /chat/open                  continue the conversation in an Orca terminal
//   GET  /sage/:host.png             that host's karakuri sage sprite sheet (202 while rendering)
//   GET  /scene.png, /scene.json     the sages' courtyard backdrop and its seat layout (202 while rendering)

import { loadConfig } from "./config";
import { Brain, type BrainEvent } from "./brain";
import { OrcaWatcher } from "./orca";
import { DemoWatcher } from "./demo";
import { Sages } from "./sages";

const cfg = loadConfig();
// FLOE_DEMO=1 runs against a made-up Orca (screenshots, videos, trying Floe without Orca).
const orca = (process.env.FLOE_DEMO ? new DemoWatcher() : new OrcaWatcher(cfg)) as OrcaWatcher;
const brain = new Brain(cfg, orca);
orca.start();
const sages = new Sages(() => orca.snapshot.hosts);
setTimeout(() => sages.warm(), 8000);
setInterval(() => sages.warm(), 60_000);

const enc = new TextEncoder();
const sse = (event: string, data: unknown) => enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (e: unknown, status = 400) => json({ ok: false, error: (e as Error).message ?? String(e) }, status);
const SSE_HEADERS = { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" };

function events(req: Request): Response {
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const send = (event: string, data: unknown) => {
        try {
          ctrl.enqueue(sse(event, data));
        } catch {
          cleanup();
        }
      };
      send("snapshot", orca.snapshot);
      const unsub = orca.subscribe((ev) => send(ev.type, ev.data));
      const beat = setInterval(() => {
        try {
          ctrl.enqueue(enc.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 15000);
      cleanup = () => {
        unsub();
        clearInterval(beat);
      };
      req.signal.addEventListener("abort", () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}

function ask(req: Request, text: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      let open = true;
      const emit = (e: BrainEvent) => {
        if (!open) return;
        try {
          ctrl.enqueue(sse(e.type, e));
        } catch {
          open = false;
        }
      };
      brain
        .ask(text, emit)
        .catch((e) => emit({ type: "error", message: (e as Error).message }))
        .finally(() => {
          if (open) {
            open = false;
            try {
              ctrl.close();
            } catch {}
          }
        });
      // Closing the island mid-answer should not kill the answer; it lands in /chat history.
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}

async function body(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

const server = Bun.serve({
  hostname: cfg.host,
  port: cfg.port,
  idleTimeout: 0, // SSE streams stay open
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;
    const m = req.method;
    try {
      if (m === "GET" && p === "/health") return json({ ok: true, orca: orca.snapshot.online, busy: brain.busy });
      if (m === "GET" && p === "/status") return json(orca.snapshot);
      if (m === "GET" && p === "/events") return events(req);
      if (m === "GET" && p === "/chat") return json({ sessionId: brain.state.sessionId, busy: brain.busy, messages: brain.state.messages });

      if (m === "GET" && (p === "/scene.png" || p === "/scene.json")) {
        const scene = await sages.scene();
        if (!scene) return new Response(null, { status: 202, headers: { "retry-after": "5", "cache-control": "no-store" } });
        return new Response(Bun.file(p.endsWith("png") ? scene.png : scene.json), {
          headers: { "content-type": p.endsWith("png") ? "image/png" : "application/json", "cache-control": "no-store" },
        });
      }

      const sage = p.match(/^\/sage\/([^/]+)\.png$/);
      if (m === "GET" && sage) {
        const file = await sages.sheet(decodeURIComponent(sage[1]));
        const headers = { "x-sage-layout": await sages.layout(), "cache-control": "no-store" };
        if (!file) return new Response(null, { status: 202, headers: { ...headers, "retry-after": "8" } });
        return new Response(Bun.file(file), { headers: { ...headers, "content-type": "image/png" } });
      }

      const agent = p.match(/^\/agents\/([^/]+)\/(screen|answer|focus)$/);
      if (agent) {
        const id = decodeURIComponent(agent[1]);
        if (m === "GET" && agent[2] === "screen") return json({ ok: true, ...(await orca.screen(id)) });
        if (m === "POST" && agent[2] === "answer") {
          const result = await orca.answer(id, await body(req));
          setTimeout(() => orca.poll(), 400); // reflect the change quickly
          return json({ ok: true, result });
        }
        if (m === "POST" && agent[2] === "focus") {
          await orca.focus(id);
          return json({ ok: true });
        }
      }

      const term = p.match(/^\/terminals\/([^/]+)\/(screen|send|focus)$/);
      if (term) {
        const id = decodeURIComponent(term[1]);
        if (m === "GET" && term[2] === "screen") return json({ ok: true, lines: await orca.terminalScreen(id) });
        if (m === "POST" && term[2] === "send") {
          const { text, enter } = await body(req);
          await orca.terminalSend(id, String(text ?? ""), enter !== false);
          return json({ ok: true, result: "sent" });
        }
        if (m === "POST" && term[2] === "focus") {
          await orca.terminalFocus(id);
          return json({ ok: true });
        }
      }
      const wsGet = p.match(/^\/workspaces\/([^/]+)\/terminals$/);
      if (wsGet && m === "GET") return json({ ok: true, terminals: await orca.terminals(decodeURIComponent(wsGet[1])) });
      const wsNew = p.match(/^\/workspaces\/([^/]+)\/terminal$/);
      if (wsNew && m === "POST") {
        const { command } = await body(req);
        return json({ ok: true, result: await orca.newTerminal(decodeURIComponent(wsNew[1]), command) });
      }

      const ws = p.match(/^\/workspaces\/([^/]+)\/(launch|focus)$/);
      if (ws && m === "POST") {
        const key = decodeURIComponent(ws[1]);
        if (ws[2] === "launch") {
          const { agent, prompt } = await body(req);
          return json({ ok: true, result: await orca.launch(key, agent || "claude", prompt) });
        }
        await orca.focusWorkspace(key);
        return json({ ok: true });
      }

      if (m === "POST" && p === "/ask") {
        const { text } = await body(req);
        if (!text || typeof text !== "string") return fail(new Error("text required"));
        return ask(req, text);
      }
      if (m === "POST" && p === "/ask/stop") {
        brain.stop();
        return json({ ok: true });
      }
      if (m === "POST" && p === "/chat/new") {
        brain.reset();
        return json({ ok: true });
      }
      if (m === "POST" && p === "/chat/open") return json({ ok: true, handle: await brain.openInOrca() });
      return json({ ok: false, error: "not found" }, 404);
    } catch (e) {
      return fail(e, 500);
    }
  },
});

console.log(`floe proxy on http://${server.hostname}:${server.port} (model ${cfg.model})`);
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    brain.stop();
    orca.stop();
    process.exit(0);
  });
