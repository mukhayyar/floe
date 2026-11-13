// The proxy's HTTP API (see proxy/src/server.ts). Plain fetch: the proxy allows Floe's webview
// origins (tauri://localhost, http://tauri.localhost, the Vite dev server) and refuses others.

export let base = "http://127.0.0.1:7717";
export function setPort(port: number) {
  base = `http://127.0.0.1:${port}`;
}

export const enc = (id: string) => encodeURIComponent(id);

export async function getJson<T>(path: string, timeoutMs = 15000): Promise<T | null> {
  try {
    const r = await fetch(`${base}/${path}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export interface PostResult {
  ok: boolean;
  message: string;
  data?: any;
}

export async function post(path: string, body: Record<string, unknown> = {}, online = true): Promise<PostResult> {
  try {
    const r = await fetch(`${base}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(75000), // launching an agent on a remote host can take a minute
    });
    const j = await r.json().catch(() => null);
    const ok = j?.ok === true;
    return { ok, message: (typeof j?.result === "string" ? j.result : j?.error) ?? (ok ? "" : `HTTP ${r.status}`), data: j };
  } catch (e) {
    return { ok: false, message: online ? String((e as Error).message ?? e) : "Floe proxy is offline" };
  }
}

export interface SSEEvent {
  event: string;
  data: string;
}

/**
 * Server-sent events over fetch (works for GET /events and POST /ask alike). With `idleMs`, a
 * stream that goes quiet that long (the proxy pings every 15 s) is dropped, so a wedged proxy
 * shows as offline instead of a frozen snapshot.
 */
export async function* sse(path: string, init: RequestInit = {}, idleMs = 0): AsyncGenerator<SSEEvent> {
  const ctrl = new AbortController();
  init.signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
  let timer: number | undefined;
  const arm = () => {
    if (!idleMs) return;
    clearTimeout(timer);
    timer = window.setTimeout(() => ctrl.abort(new Error("the proxy went quiet")), idleMs);
  };
  arm();
  let r: Response;
  try {
    r = await fetch(`${base}/${path}`, { ...init, signal: ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
  if (!r.ok || !r.body) {
    clearTimeout(timer);
    throw new Error(`HTTP ${r.status}`);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let event = "message";
  let data: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      arm();
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        let line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line === "") {
          if (data.length) yield { event, data: data.join("\n") };
          event = "message";
          data = [];
        } else if (line.startsWith(":")) {
          // comment / keep-alive ping
        } else if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        }
      }
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}
