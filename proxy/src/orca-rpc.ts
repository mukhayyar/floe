// Transport to Orca, local and remote.
//
// Local reads: the unix socket (Windows: named pipe) named in orca-runtime.json (~2ms). The `orca` CLI boots
// Electron for every call (~0.3s CPU), too heavy to poll while a game is running.
// Remote reads (paired Orca servers): one long-lived orca-bridge.cjs process that reuses
// the CLI's own RuntimeClient (~20ms CPU per call).
// Writes (sending input, launching agents): the official CLI, which owns prompt-delivery
// preflight and retry semantics. They are rare.

import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { join, resolve } from "node:path";
import { childEnv, type Config } from "./config";
import { IS_WIN, orcaCli, orcaElectron } from "./platform";

export class OrcaError extends Error {
  constructor(message: string, public code = "orca_error") {
    super(message);
  }
}

export const LOCAL = "local";

interface RuntimeMeta {
  authToken: string;
  endpoint: string;
}

export class OrcaRpc {
  private bridge: ReturnType<typeof Bun.spawn> | null = null;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: Timer }>();

  constructor(private cfg: Config) {}

  // MARK: local socket

  private meta(): RuntimeMeta {
    let raw: any;
    try {
      raw = JSON.parse(readFileSync(join(this.cfg.orcaUserData, "orca-runtime.json"), "utf8"));
    } catch {
      throw new OrcaError("Orca is not running", "runtime_unavailable");
    }
    const local = raw?.transports?.find((t: any) => t.kind === (IS_WIN ? "named-pipe" : "unix"));
    if (!local?.endpoint || !raw.authToken) throw new OrcaError("Orca runtime metadata incomplete", "runtime_unavailable");
    return { authToken: raw.authToken, endpoint: local.endpoint };
  }

  private local<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    const meta = this.meta();
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const socket = connect(meta.endpoint);
      let buf = "";
      let done = false;
      const finish = (err: Error | null, value?: T) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.destroy();
        err ? reject(err) : resolve(value as T);
      };
      const timer = setTimeout(() => finish(new OrcaError(`${method} timed out`, "runtime_timeout")), timeoutMs);
      socket.setEncoding("utf8");
      socket.on("connect", () => socket.write(JSON.stringify({ id, authToken: meta.authToken, method, params }) + "\n"));
      socket.on("error", () => finish(new OrcaError("Orca is not running", "runtime_unavailable")));
      socket.on("close", () => finish(new OrcaError("Orca closed the connection", "runtime_unavailable")));
      socket.on("data", (chunk: string) => {
        buf += chunk;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let frame: any;
          try {
            frame = JSON.parse(line);
          } catch {
            return finish(new OrcaError("invalid frame from Orca", "invalid_runtime_response"));
          }
          if (frame._keepalive) {
            timer.refresh();
            continue;
          }
          if (frame.id !== id) continue;
          if (frame.ok === false) return finish(new OrcaError(frame.error?.message ?? "Orca error", frame.error?.code));
          return finish(null, frame.result as T);
        }
      });
    });
  }

  // MARK: remote bridge

  private ensureBridge() {
    if (this.bridge && this.bridge.exitCode === null) return this.bridge;
    const script = resolve(import.meta.dir, "..", "orca-bridge.cjs");
    const electron = orcaElectron(this.cfg.orcaUserData, this.cfg.orcaApp);
    if (!electron) throw new OrcaError("Orca isn't installed", "runtime_unavailable");
    // orca-bridge.cjs finds Orca's code next to the Electron binary it runs under
    const proc = Bun.spawn([electron, script], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
      env: { ...childEnv(), ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
    });
    this.bridge = proc;
    (async () => {
      const decoder = new TextDecoder();
      let buf = "";
      for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
        buf += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          let msg: any;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          const p = this.pending.get(msg.id);
          if (!p) continue;
          this.pending.delete(msg.id);
          clearTimeout(p.timer);
          msg.ok ? p.resolve(msg.result) : p.reject(new OrcaError(msg.error?.message ?? "remote error", msg.error?.code));
        }
      }
      // Bridge died: fail everything in flight; the next call respawns it.
      for (const [id, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new OrcaError("Orca bridge exited", "bridge_exited"));
        this.pending.delete(id);
      }
    })();
    return proc;
  }

  private remote<T>(env: string, method: string, params: unknown, timeoutMs: number): Promise<T> {
    const proc = this.ensureBridge();
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new OrcaError(`${method} timed out`, "runtime_timeout"));
      }, timeoutMs + 2000);
      this.pending.set(id, { resolve, reject, timer });
      (proc.stdin as any).write(JSON.stringify({ id, env, method, params, timeoutMs }) + "\n");
      (proc.stdin as any).flush?.();
    });
  }

  /** Read-only RPC against a host: "local" or a paired environment id. */
  call<T = any>(host: string, method: string, params: unknown = {}, timeoutMs = 8000): Promise<T> {
    return host === LOCAL ? this.local<T>(method, params, timeoutMs) : this.remote<T>(host, method, params, timeoutMs);
  }

  /** Run the official CLI against a host (writes and anything without a stable RPC shape). */
  async cli<T = any>(host: string, args: string[], timeoutMs = 30000): Promise<T> {
    const full = host === LOCAL ? args : [...args, "--environment", host];
    const bin = orcaCli(this.cfg.orcaUserData, this.cfg.orcaApp, this.cfg.orcaBin);
    const proc = Bun.spawn([bin, ...full, "--json"], { stdout: "pipe", stderr: "pipe", stdin: "ignore", env: childEnv(), windowsHide: true });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    await proc.exited;
    clearTimeout(timer);
    let parsed: any;
    try {
      parsed = JSON.parse(out);
    } catch {
      throw new OrcaError((err || out).trim().slice(0, 400) || `orca exited ${proc.exitCode}`);
    }
    if (!parsed.ok) throw new OrcaError(parsed.error?.message ?? "orca command failed", parsed.error?.code);
    return parsed.result as T;
  }

  close() {
    this.bridge?.kill();
  }
}
