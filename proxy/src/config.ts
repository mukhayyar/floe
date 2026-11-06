import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const HOME = homedir();
export const ROOT = resolve(import.meta.dir, "..", "..");
export const CONFIG_DIR = join(HOME, ".config", "floe");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const STATE_PATH = join(CONFIG_DIR, "state.json");

export interface Config {
  host: string;
  port: number;
  /** Orca user-data dir; holds orca-runtime.json (socket + token). */
  orcaUserData: string;
  orcaApp: string;
  orcaBin: string;
  claudeBin: string;
  /** Model for the island brain. Short answers matter more than depth here. */
  model: string;
  /** Status poll interval for this Mac. A direct socket poll costs ~2ms. */
  pollMs: number;
  /** Poll interval per remote Orca server (~20ms CPU each through the bridge). */
  remotePollMs: number;
  /** Paired Orca servers to skip, by id or name. */
  hiddenHosts: string[];
  brainDir: string;
  /** Extra directories the brain may read, on top of every Orca repo. */
  extraDirs: string[];
  /** Tools the brain may use without asking. Anything else is denied (no one is there to approve). */
  allowedTools: string[];
}

function firstExisting(paths: string[]): string | undefined {
  return paths.find((p) => existsSync(p));
}

const DEFAULTS: Config = {
  host: "127.0.0.1",
  port: 7717,
  orcaUserData: join(HOME, "Library", "Application Support", "orca"),
  orcaApp: "/Applications/Orca.app",
  orcaBin: firstExisting(["/Applications/Orca.app/Contents/Resources/bin/orca", "/opt/homebrew/bin/orca", "/usr/local/bin/orca"]) ?? "orca",
  claudeBin: firstExisting([join(HOME, ".local", "bin", "claude"), join(HOME, ".claude", "local", "claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"]) ?? "claude",
  model: "sonnet",
  pollMs: 1500,
  remotePollMs: 4000,
  hiddenHosts: [],
  brainDir: join(ROOT, "brain"),
  extraDirs: [],
  allowedTools: [
    "Read",
    "Grep",
    "Glob",
    "Bash(orca:*)",
    // Read-only git, both plain and `git -C <repo> …` forms.
    ...["log", "status", "diff", "show", "branch", "rev-parse", "remote -v"].flatMap((c) => [`Bash(git ${c} *)`, `Bash(git ${c})`, `Bash(git -C * ${c} *)`, `Bash(git -C * ${c})`]),
    "Bash(ls:*)",
    "WebSearch",
    "WebFetch",
  ],
};

function readJson<T>(path: string): Partial<T> {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

export function loadConfig(): Config {
  mkdirSync(CONFIG_DIR, { recursive: true });
  if (!existsSync(CONFIG_PATH)) {
    // Write a starter file so the knobs are discoverable.
    const { allowedTools, ...rest } = DEFAULTS;
    writeFileSync(CONFIG_PATH, JSON.stringify({ model: rest.model, port: rest.port, extraDirs: [] }, null, 2) + "\n");
  }
  return { ...DEFAULTS, ...readJson<Config>(CONFIG_PATH) };
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  at: number;
  tools?: string[];
}

export interface State {
  sessionId: string | null;
  messages: ChatMessage[];
}

export function loadState(): State {
  const s = readJson<State>(STATE_PATH);
  return { sessionId: s.sessionId ?? null, messages: Array.isArray(s.messages) ? s.messages : [] };
}

export function saveState(state: State) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify({ ...state, messages: state.messages.slice(-60) }, null, 2));
}

/** launchd starts us with a bare PATH; children (orca, claude, git) need the user's tools. */
export function childEnv(): Record<string, string> {
  const extra = ["/opt/homebrew/bin", "/opt/homebrew/sbin", join(HOME, ".local", "bin"), join(HOME, ".bun", "bin"), "/usr/local/bin"];
  const path = [...extra, ...(process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin").split(":")];
  return { ...(process.env as Record<string, string>), PATH: [...new Set(path)].join(":"), HOME };
}
