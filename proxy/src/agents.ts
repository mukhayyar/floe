// The agent harnesses Orca can run, in Orca's own catalog order (Orca's renderer, agent-catalog).
// Floe shows whatever agentType Orca reports; this only gives each one its proper name and order.

export const CATALOG: [id: string, label: string][] = [
  ["claude", "Claude"],
  ["claude-agent-teams", "Claude Agent Teams"],
  ["openclaude", "OpenClaude"],
  ["codex", "Codex"],
  ["grok", "Grok"],
  ["copilot", "GitHub Copilot"],
  ["opencode2", "OpenCode 2"],
  ["opencode", "OpenCode"],
  ["mimo-code", "MiMo Code"],
  ["ante", "Ante"],
  ["trae", "Trae"],
  ["muse", "Muse"],
  ["dsh", "DeepSeek Harness"],
  ["qoder", "Qoder CLI"],
  ["qoder-cn", "Qoder CLI China"],
  ["zcode", "ZCode"],
  ["pi", "Pi"],
  ["omp", "OMP"],
  ["prime-agent", "Prime Agent"],
  ["gemini", "Gemini"],
  ["antigravity", "Antigravity"],
  ["aider", "Aider"],
  ["goose", "Goose"],
  ["amp", "Amp"],
  ["kilo", "Kilocode"],
  ["kiro", "Kiro"],
  ["crush", "Crush"],
  ["aug", "Auggie"],
  ["autohand", "Autohand Code"],
  ["cline", "Cline"],
  ["codebuff", "Codebuff"],
  ["freebuff", "Freebuff"],
  ["command-code", "Command Code"],
  ["continue", "Continue"],
  ["cursor", "Cursor"],
  ["droid", "Droid"],
  ["kimi", "Kimi"],
  ["mistral-vibe", "Mistral Vibe"],
  ["qwen-code", "Qwen Code"],
  ["rovo", "Rovo Dev"],
  ["hermes", "Hermes"],
  ["devin", "Devin"],
  ["openclaw", "OpenClaw"],
  ["codebuddy", "CodeBuddy"],
  ["jcode", "Jcode"],
];

const LABELS = new Map(CATALOG);
const ORDER = new Map(CATALOG.map(([id], i) => [id, i]));

/** "codex" → "Codex"; an id Floe doesn't know yet → "Some-agent" rather than nothing. */
export function agentLabel(id: string | null | undefined): string {
  if (!id) return "Agent";
  return LABELS.get(id) ?? id.charAt(0).toUpperCase() + id.slice(1);
}

export function byCatalog(a: string, b: string): number {
  return (ORDER.get(a) ?? 999) - (ORDER.get(b) ?? 999) || a.localeCompare(b);
}

export interface AgentKind {
  id: string;
  label: string;
}

export const kind = (id: string): AgentKind => ({ id, label: agentLabel(id) });
