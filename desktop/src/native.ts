// The Rust side: window geometry, keyboard, launch at login, the proxy supervisor.
// Outside Tauri (plain `vite` in a browser) every call is a harmless no-op.

import type { Boot, ProxyState } from "./types";

type Unlisten = () => void;
const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (!inTauri) return undefined;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function on<T>(event: string, handler: (payload: T) => void): Promise<Unlisten> {
  if (!inTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(event, (e) => handler(e.payload));
}

export const native = {
  inTauri,
  boot: () => call<Boot>("boot"),
  layout: (width: number, height: number) => call("layout", { width, height }),
  dragBegin: () => call("drag_begin"),
  dragMove: (dx: number) => call("drag_move", { dx }),
  dragEnd: () => call("drag_end"),
  snapCenter: () => call("snap_center"),
  takeFocus: () => call("take_focus"),
  releaseFocus: () => call("release_focus"),
  proxyState: () => call<ProxyState | null>("proxy_state"),
  autostartGet: () => call<boolean>("autostart_get"),
  autostartSet: (on: boolean) => call<boolean>("autostart_set", { on }),
  openLogs: () => call("open_logs"),
  openUrl: (url: string) => call("open_url", { url }),
  quit: () => call("quit"),
  log: (msg: string) => call("log_line", { msg }).catch(() => {}),
};
