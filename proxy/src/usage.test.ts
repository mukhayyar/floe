import { expect, test } from "bun:test";
import { parseUsage, usageLevel, usageWarnings } from "./usage";

// accounts.list's rateLimits as Orca 1.4.259 returns them (trimmed).
const res = (claude5h: number, claudeWeek: number, resetsAt = 1_794_716_400_290) => ({
  claude: { accounts: [] },
  rateLimits: {
    claude: { provider: "claude", status: "ok", updatedAt: 1, session: { usedPercent: claude5h, windowMinutes: 300, resetsAt, resetDescription: "12:20 PM" },
      weekly: { usedPercent: claudeWeek, windowMinutes: 10080, resetsAt: 1_795_212_000_290, resetDescription: "Sat 6:00 AM" }, monthly: null },
    codex: { provider: "codex", status: "ok", updatedAt: 2, session: { usedPercent: 0, windowMinutes: 300, resetsAt: 1_797_303_992_000, resetDescription: "Tue 11:06 AM" }, weekly: null },
    gemini: { provider: "gemini", status: "unavailable", session: null, weekly: null, error: "off" },
    antigravity: { provider: "antigravity", status: "ok", session: { usedPercent: 0, resetsAt: 5 }, weekly: { usedPercent: 0, resetsAt: 6 } },
    kimi: { provider: "kimi", status: "ok", session: { usedPercent: 7.6, resetsAt: 9 }, weekly: null },
    claudeTarget: { runtime: "host" },
    inactiveClaudeAccounts: [],
  },
});

test("keeps Claude and Codex, plus anything else in use, and skips what isn't signed in", () => {
  const u = parseUsage(res(11, 39));
  expect(u.map((x) => x.label)).toEqual(["Claude", "Codex", "Kimi"]);
  expect(u[0].session).toEqual({ usedPercent: 11, resetsAt: 1_794_716_400_290, resets: "12:20 PM" });
  expect(u[1].weekly).toBeNull();
  expect(u[2].session?.usedPercent).toBe(8);
  expect(parseUsage({})).toEqual([]);
  expect(parseUsage(null)).toEqual([]);
});

test("warns once per level as a window climbs, never on the first look, and again after a reset", () => {
  const seen = new Map();
  expect(usageWarnings(parseUsage(res(85, 39)), seen)).toEqual([]); // first look: only recorded
  expect(usageWarnings(parseUsage(res(86, 39)), seen)).toEqual([]);
  expect(usageWarnings(parseUsage(res(96, 39)), seen).map((w) => [w.label, w.window, w.usedPercent])).toEqual([["Claude", "session", 96]]);
  expect(usageWarnings(parseUsage(res(99, 81)), seen).map((w) => [w.window, w.usedPercent])).toEqual([["weekly", 81]]); // 5h already warned at 95
  const next = 1_794_716_400_290 + 5 * 3600_000; // a new 5-hour window
  expect(usageWarnings(parseUsage(res(3, 81, next)), seen)).toEqual([]);
  expect(usageWarnings(parseUsage(res(82, 81, next)), seen).map((w) => w.usedPercent)).toEqual([82]);
});

test("levels", () => {
  expect([usageLevel(null), usageLevel({ usedPercent: 79, resetsAt: null, resets: null }), usageLevel({ usedPercent: 80, resetsAt: null, resets: null }), usageLevel({ usedPercent: 100, resetsAt: null, resets: null })]).toEqual([0, 0, 80, 95]);
});
