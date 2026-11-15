// An agent in an Orca chat tab (no terminal): its question lives in the session's journal and is
// answered through agentSession.respondToQuestion with a fingerprinted envelope. Over this OS's
// real transport, with auto-answer on: Floe must walk the two-question form picking each
// "(Recommended)" option, submit both answers in one call, then send a follow-up message.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { OrcaWatcher } from "../src/orca";
import { prefs } from "../src/prefs";

const runner = Bun.which("node") ?? process.execPath;
const dir = mkdtempSync(join(tmpdir(), "floe-chat-"));
let fake: ReturnType<typeof Bun.spawn>;
const events: any[] = [];
let watcher: OrcaWatcher;

async function until<T>(what: string, fn: () => T | undefined | false, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(50);
  }
}

beforeAll(async () => {
  prefs.autoDeliver = false;
  prefs.autoAnswer = false; // turned on once the first look is done
  prefs.letAgentChoose = true;
  fake = Bun.spawn([runner, join(import.meta.dir, "fake-orca.cjs"), dir, "--chat"], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
  let ready!: () => void;
  const up = new Promise<void>((r) => (ready = r));
  (async () => {
    let buf = "";
    for await (const chunk of fake.stdout as ReadableStream<Uint8Array>) {
      buf += new TextDecoder().decode(chunk);
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line === "ready") ready();
        else if (line.startsWith("{")) events.push(JSON.parse(line));
      }
    }
  })();
  await up;
  watcher = new OrcaWatcher({ ...loadConfig(), orcaUserData: dir, pollMs: 100, remotePollMs: 60_000, hiddenHosts: [] });
  watcher.start();
});

afterAll(() => {
  watcher?.stop();
  (fake?.stdin as any)?.end();
  fake?.kill();
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
});

test("reads a chat tab's question from its journal", async () => {
  const a = await until("the chat agent", () => watcher.snapshot.agents.find((x) => x.paneKey.startsWith("structured-agent-session-")));
  expect(a.state).toBe("waiting");
  const view = await watcher.screen(a.id);
  expect(view.lines).toEqual(["Question 1 of 2", "Which colour?"]);
  expect(view.options.map((o) => o.label)).toEqual(["Teal (Recommended)", "Amber", "Type something."]);
  expect(view.tabs?.map((t) => t.label)).toEqual(["Colour", "Size"]);
  // once Floe has read the journal, the row says what it's waiting on
  await until("attention to say question", () => watcher.snapshot.agents.find((x) => x.id === a.id)?.attention === "question");
});

test("auto-answer walks the form and submits both answers at once", async () => {
  prefs.autoAnswer = true;
  const r = await until("the answers to reach Orca", () => events.find((e) => e.responded)?.responded, 25_000);
  expect(r.answers).toEqual([{ questionId: "q1", optionIds: ["q1:choice-1"] }, { questionId: "q2", optionIds: ["q2:choice-2"] }]);
  prefs.autoAnswer = false;
  await until("the agent to work again", () => watcher.snapshot.agents[0]?.state === "working");
});

test("a message to a chat with nothing open is a follow-up, queued if it's busy", async () => {
  const id = watcher.snapshot.agents[0].id;
  expect(await watcher.answer(id, { text: "Make it bold" })).toBe("sent");
  const s = await until("the message to reach Orca", () => events.find((e) => e.chatSent)?.chatSent);
  expect(s).toEqual({ text: "Make it bold", delivery: "queue-if-active" });
});

test("offers the chats Orca stopped when it updated, and lets them carry on", async () => {
  const offer = await until("the offer", () => watcher.snapshot.hosts.find((h) => h.id === "local")?.resumable[0]);
  expect(offer).toMatchObject({ sessionId: "claude_0000stopped", trigger: "update", prompt: "Refactor the parser", agentId: null });
  expect(await watcher.resume("local")).toBe("carrying on with 1 chat");
  expect(await until("Orca to hear it", () => events.find((e) => e.continued)?.continued)).toBe("all");
  await until("the offer to go", () => watcher.snapshot.hosts.find((h) => h.id === "local")?.resumable.length === 0);
});
