// A message another session sent, held by Claude behind Deliver / Deny, on an agent whose host
// reports nothing about its screen (a paired Orca server does that for idle agents). Floe must
// notice it from the screen, leave it alone while only answering is on, and deliver it when
// delivering is on.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { OrcaWatcher } from "../src/orca";
import { prefs } from "../src/prefs";

const runner = Bun.which("node") ?? process.execPath;
const dir = mkdtempSync(join(tmpdir(), "floe-held-"));
let fake: ReturnType<typeof Bun.spawn>;
const sent: any[] = [];
let watcher: OrcaWatcher;

async function until<T>(what: string, fn: () => T | undefined | false, ms = 12_000): Promise<T> {
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
  prefs.autoAnswer = true; // answering questions is on: that alone must not deliver messages
  prefs.letAgentChoose = true;
  fake = Bun.spawn([runner, join(import.meta.dir, "fake-orca.cjs"), dir, "--held"], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
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

test("a held message shows up from the screen alone", async () => {
  const a = await until("the held message to be noticed", () => watcher.snapshot.agents.find((x) => x.attention));
  expect(a.attention).toBe("input");
  expect(a.detail).toBe("Held message from another session");
  expect(watcher.snapshot.mood).toBe("attention");
}, 20_000);

test("answering questions automatically doesn't deliver messages", async () => {
  await Bun.sleep(1500);
  expect(sent).toEqual([]);
  expect(watcher.snapshot.agents[0].attention).toBe("input");
});

test("delivering automatically delivers it", async () => {
  prefs.autoDeliver = true;
  await until("the Deliver keys", () => sent.some((p) => p.enter && !p.text));
  expect(sent.map((p) => (p.enter ? "Enter" : p.text === "\x1b[B" ? "Down" : p.text))).toEqual(["Down", "Enter"]);
  await until("the agent to get to work", () => watcher.snapshot.agents[0]?.state === "working" && !watcher.snapshot.agents[0].attention);
}, 20_000);
