// The proxy's JSON, as the Mac app's Models.swift reads it.

export interface Step {
  kind: string; // tool | say
  tool: string | null;
  text: string;
  at: number;
  done: boolean;
}

export interface Agent {
  id: string;
  paneKey: string;
  hostId: string;
  hostName: string;
  worktreeId: string;
  workspaceKey: string;
  workspace: string;
  project: string;
  path: string;
  agentType: string;
  agentLabel?: string | null;
  state: string;
  title: string;
  tool: string | null;
  detail: string | null;
  attention: string | null;
  progress: number | null;
  lastMessage: string | null;
  since: number;
  updatedAt: number;
  steps: Step[];
}

export interface Counts {
  working: number;
  attention: number;
  done: number;
  idle: number;
  total: number;
}

export interface WorkspaceView {
  key: string;
  worktreeId: string;
  name: string;
  branch: string;
  path: string;
  status: string;
  unread: boolean;
  liveTerminals: number;
  isMain: boolean;
  agentIds: string[];
}

export interface ProjectView {
  key: string;
  name: string;
  workspaces: WorkspaceView[];
}

export interface AgentKind {
  id: string;
  label: string;
}

export interface HostView {
  id: string;
  name: string;
  kind: string; // local | environment | ssh
  via: string;
  online: boolean;
  error: string | null;
  projects: ProjectView[];
  counts: { working: number; attention: number; workspaces: number; agents: number };
  agents?: AgentKind[] | null;
}

export interface Snapshot {
  at: number;
  online: boolean;
  error: string | null;
  mood: string;
  headline: string;
  counts: Counts;
  agents: Agent[];
  hosts: HostView[];
}

export interface Activity {
  kind: string;
  agentId: string;
  workspace: string;
  title: string;
  text: string;
  at: number;
}

export interface MenuOption {
  n: number;
  label: string;
  selected: boolean;
  freeText: boolean;
  checked?: boolean | null;
  description?: string | null;
}

export interface MenuTab {
  label: string;
  done: boolean;
}

export interface ScreenView {
  lines: string[];
  options: MenuOption[];
  multi?: boolean | null;
  tabs?: MenuTab[] | null;
  steps?: boolean | null;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  tools?: string[];
  toolAt?: number[];
}

export interface TerminalInfo {
  id: string;
  title: string;
  agentType: string | null;
  agentLabel?: string | null;
  agentId: string | null;
  preview: string | null;
  lastOutputAt: number | null;
  connected: boolean;
  main: boolean;
}

export type Mood = "offline" | "idle" | "working" | "attention" | "done" | "thinking";
export type Presentation = "compact" | "peek" | "expanded";
export type Tab = "live" | "hosts" | "ask" | "settings";

export type Target =
  | { kind: "brain" }
  | { kind: "agent"; id: string }
  | { kind: "launch"; key: string; agent: string; label: string }
  | { kind: "terminal"; id: string; label: string }
  | { kind: "workspace"; key: string; label: string };

export type HostNav =
  | { kind: "host"; host: string }
  | { kind: "project"; host: string; project: string }
  | { kind: "workspace"; host: string; project: string; workspace: string };

export interface Peek {
  mood: Mood;
  title: string;
  text: string;
  agentId: string | null;
}

/** The proxy supervisor's view (Rust side). */
export interface ProxyState {
  state: "running" | "external" | "starting" | "no-bun" | "no-proxy" | "crashed" | "offline";
  message: string;
  port: number;
  installDir: string;
  logsDir: string;
  owned: boolean;
}

export interface Boot {
  port: number;
  hotkey: string;
  hotkeyError: string | null;
  version: string;
  platform: "linux" | "windows" | "macos";
  screenWidth: number;
  screenHeight: number;
  proxy: ProxyState | null;
  logsDir: string;
  open?: string | null;
  hotkeyHelp?: HotkeyHelp;
}

/** Wayland: the hotkey needs a desktop shortcut running `command`; on GNOME Floe can add it. */
export interface HotkeyHelp {
  wayland: boolean;
  command: string;
  gnome: boolean;
  bound: boolean;
  conflict: string | null;
}

/** The proxy's answer to "is a newer Floe out?" */
export interface UpdateInfo {
  current: string;
  latest: string | null;
  newer: boolean;
  url: string | null;
}
