import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { HOME, ORCA_USER_DATA, claudeBin } from "./platform";

export { HOME, childEnv } from "./platform";
export const ROOT = resolve(import.meta.dir, "..", "..");
export const CONFIG_DIR = join(HOME, ".config", "floe");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const STATE_PATH = join(CONFIG_DIR, "state.json");

export interface Config {
  host: string;
  port: number;
  /** Orca user-data dir; holds orca-runtime.json (socket + token). */
  orcaUserData: string;
  /** macOS only: the Orca.app bundle. */
  orcaApp: string;
  /** The `orca` CLI; empty means find the running Orca's own (see platform.ts). */
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

const DEFAULTS: Config = {
  host: "127.0.0.1",
  port: 7717,
  orcaUserData: ORCA_USER_DATA,
  orcaApp: "/Applications/Orca.app",
  orcaBin: "",
  claudeBin: claudeBin(),
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
