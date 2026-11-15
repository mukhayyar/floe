// How much of each agent subscription's usage limits is gone, as Orca tracks it (accounts.list:
// a 5-hour session window and a weekly one per provider, with reset times). Floe reads Orca's
// cached figures and asks it to refresh stale ones now and then, never on every look.

export interface UsageWindow {
  usedPercent: number;
  /** ms epoch, or null when the provider didn't say. */
  resetsAt: number | null;
  /** Orca's own wording ("12:20 PM", "Sat 6:00 AM"). */
  resets: string | null;
}

export interface Usage {
  provider: string;
  label: string;
  session: UsageWindow | null;
  weekly: UsageWindow | null;
  updatedAt: number | null;
}

const LABELS: Record<string, string> = {
  claude: "Claude", codex: "Codex", gemini: "Gemini", kimi: "Kimi", grok: "Grok", cursor: "Cursor",
  antigravity: "Antigravity", "opencode-go": "OpenCode Go", minimax: "MiniMax", zcode: "ZCode", muse: "Muse",
};
/** Shown even at 0%: the subscriptions coding agents mostly run on. */
const ALWAYS = new Set(["claude", "codex"]);

function windowOf(w: any): UsageWindow | null {
  if (!w || typeof w.usedPercent !== "number" || !Number.isFinite(w.usedPercent)) return null;
  return {
    usedPercent: Math.max(0, Math.min(100, Math.round(w.usedPercent))),
    resetsAt: typeof w.resetsAt === "number" ? w.resetsAt : null,
    resets: typeof w.resetDescription === "string" && w.resetDescription ? w.resetDescription : null,
  };
}

/** accounts.list's rateLimits → the providers worth showing, most used first. */
export function parseUsage(res: any): Usage[] {
  const rl = res?.rateLimits;
  if (!rl || typeof rl !== "object") return [];
  const out: Usage[] = [];
  for (const v of Object.values(rl) as any[]) {
    if (!v || typeof v !== "object" || typeof v.provider !== "string" || v.status !== "ok") continue;
    const session = windowOf(v.session);
    const weekly = windowOf(v.weekly);
    if (!session && !weekly) continue;
    const used = Math.max(session?.usedPercent ?? 0, weekly?.usedPercent ?? 0);
    if (!ALWAYS.has(v.provider) && used === 0) continue;
    out.push({ provider: v.provider, label: LABELS[v.provider] ?? v.provider, session, weekly, updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : null });
  }
  const peak = (u: Usage) => Math.max(u.session?.usedPercent ?? 0, u.weekly?.usedPercent ?? 0);
  return out.sort((a, b) => Number(ALWAYS.has(b.provider)) - Number(ALWAYS.has(a.provider)) || peak(b) - peak(a) || a.label.localeCompare(b.label));
}

export const USAGE_LEVELS = [80, 95] as const;

/** The highest warning level a window has reached (0, 80 or 95). */
export function usageLevel(w: UsageWindow | null): number {
  let level = 0;
  for (const l of USAGE_LEVELS) if (w && w.usedPercent >= l) level = l;
  return level;
}

/**
 * Warnings to raise: a window that climbed past 80% or 95% since Floe last looked. A window is
 * known by its provider and reset time, so hosts on one account share it and a new window (after
 * a reset) starts fresh. The first look at a window only records it: a restart must not repeat old
 * warnings. `seen` is kept by the caller between looks.
 */
export function usageWarnings(
  usage: Usage[],
  seen: Map<string, { level: number; resetsAt: number | null }>,
  now = Date.now(),
): { provider: string; label: string; window: "session" | "weekly"; usedPercent: number; resets: string | null }[] {
  const out: ReturnType<typeof usageWarnings> = [];
  for (const u of usage) {
    for (const kind of ["session", "weekly"] as const) {
      const w = u[kind];
      if (!w) continue;
      const key = `${u.provider}|${kind}|${w.resetsAt ? Math.round(w.resetsAt / 600_000) : "-"}`;
      const level = usageLevel(w);
      const prev = seen.get(key);
      if (prev && level > prev.level) out.push({ provider: u.provider, label: u.label, window: kind, usedPercent: w.usedPercent, resets: w.resets });
      seen.set(key, { level: Math.max(level, prev?.level ?? 0), resetsAt: w.resetsAt });
    }
  }
  for (const [k, v] of seen) if (v.resetsAt && v.resetsAt < now - 86_400_000) seen.delete(k);
  return out;
}
