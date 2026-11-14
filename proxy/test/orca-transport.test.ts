// End to end against a fake Orca (test/fake-orca.cjs) on this OS's real transport: a unix socket,
// or a named pipe on Windows. Reads the agents, reads the question off the screen, answers it.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { OrcaWatcher, type Snapshot } from "../src/orca";
import { prefs } from "../src/prefs";
import { THIS_MACHINE } from "../src/platform";

// Orca is a Node server; use Node when it's here so the pair matches real use.
const runner = Bun.which("node") ?? process.execPath;
const dir = mkdtempSync(join(tmpdir(), "floe-"));
let fake: ReturnType<typeof Bun.spawn>;
const sent: any[] = [];
let watcher: OrcaWatcher;

async function until<T>(what: string, fn: () => T | undefined | false, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(50);
  }
}

beforeAll(async () => {
  // never answer for the test (this Mac may have these on)
  prefs.autoDeliver = false;
  prefs.autoAnswer = false;
  fake = Bun.spawn([runner, join(import.meta.dir, "fake-orca.cjs"), dir], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
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
        else if (line.startsWith("{")) sent.push(JSON.parse(line).sent);
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

test("reads this computer's agents over the local transport", async () => {
  const snap: Snapshot = await until("an online snapshot", () => watcher.snapshot.online && watcher.snapshot.agents.length > 0 && watcher.snapshot);
  const host = snap.hosts.find((h) => h.id === "local")!;
  expect(host.name).toBe(THIS_MACHINE);
  expect(host.online).toBe(true);
  expect(host.projects.map((p) => p.name)).toEqual(["demo-app"]);
  const a = snap.agents[0];
  expect(a.state).toBe("waiting");
  expect(a.attention).toBe("question");
  expect(a.title).toBe("Cache the sessions");
  expect(snap.mood).toBe("attention");
});

test("reads the question off the agent's screen", async () => {
  const id = watcher.snapshot.agents[0].id;
  const view = await watcher.screen(id);
  expect(view.options.map((o) => o.label)).toEqual(["Redis (Recommended)", "In memory", "Type something.", "Chat about this"]);
  expect(view.lines).toContain("Where should sessions live?");
});

test("answers with the option's digit and sees the agent go back to work", async () => {
  const id = watcher.snapshot.agents[0].id;
  const said = await watcher.answer(id, { option: 2 });
  expect(said).toBe("picked “In memory”");
  // the fake reports keystrokes on stdout, which can land after its reply on the socket
  await until("the keystroke to reach Orca", () => sent.length > 0);
  expect(sent).toEqual([expect.objectContaining({ terminal: "term-1", text: "2", enter: false })]);
  await until("the agent to work again", () => watcher.snapshot.agents[0]?.state === "working");
  expect(watcher.snapshot.mood).toBe("working");
});

test("finds the harnesses the host has installed", async () => {
  await until("detected harnesses", () => watcher.snapshot.hosts.find((h) => h.id === "local")?.agents.length);
  const ids = watcher.snapshot.hosts.find((h) => h.id === "local")!.agents.map((k) => k.id);
  expect(ids).toContain("claude");
  expect(ids).toContain("codex");
});
