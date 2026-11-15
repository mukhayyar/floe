// Long-lived bridge to remote Orca servers (paired "environments"), run under Orca's own
// Electron in node mode so it uses the exact runtime client the `orca` CLI ships:
//   ELECTRON_RUN_AS_NODE=1 /Applications/Orca.app/Contents/MacOS/Orca orca-bridge.cjs
//   ELECTRON_RUN_AS_NODE=1 /opt/Orca/orca-ide orca-bridge.cjs          (Linux; or inside an AppImage mount)
//   ELECTRON_RUN_AS_NODE=1 %LOCALAPPDATA%\Programs\Orca\Orca.exe orca-bridge.cjs   (Windows)
// Spawning the CLI per poll costs ~330ms CPU; reusing a client costs ~20ms.
//
// Protocol: JSON lines on stdin  {id, env, method, params}
//                     on stdout {id, ok, result} | {id, ok:false, error:{code,message}}

const path = require("node:path");
// Orca's code sits next to the Electron binary this runs under.
const exeDir = path.dirname(process.execPath);
const resources = process.platform === "darwin" ? path.join(exeDir, "..", "Resources") : path.join(exeDir, "resources");
const out = process.env.ORCA_APP_OUT || path.join(resources, "app.asar.unpacked", "out");
// Orca moves this file now and then (1.4.259: cli/runtime-client.js → cli/runtime/client.js).
function runtimeClient() {
  const fs = require("node:fs");
  const cli = path.join(out, "cli");
  const known = [path.join(cli, "runtime", "client.js"), path.join(cli, "runtime-client.js")];
  for (const f of known) if (fs.existsSync(f)) return require(f).RuntimeClient;
  // Not where it used to be: look for the module that exports it.
  const walk = (dir, depth) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory() && depth < 3 && e.name !== "fixtures") {
        const hit = walk(f, depth + 1);
        if (hit) return hit;
      } else if (e.isFile() && e.name.endsWith(".js") && !/test|fixture|harness/.test(e.name)) {
        const src = fs.readFileSync(f, "utf8");
        if (src.includes("class RuntimeClient") && src.includes("exports.RuntimeClient")) return f;
      }
    }
    return null;
  };
  const found = walk(cli, 0);
  if (!found) throw new Error(`Orca's runtime client isn't under ${cli}`);
  return require(found).RuntimeClient;
}
const RuntimeClient = runtimeClient();

// The CLI tells a paired host it can do only a few things (agent launch, chat rename). Chat
// sessions answer only clients that say they handle them (agent-session.structured.v1), so a
// request with `caps` goes out on its own socket that says so, the way Orca's desktop app does.
let withCaps = null;
try {
  withCaps = require(path.join(out, "shared", "remote-runtime", "requests", "remote-runtime-request-socket.js")).sendRemoteRuntimeRequestOnSocket;
} catch {}

const clients = new Map();

function client(env) {
  let c = clients.get(env);
  if (!c) {
    c = new RuntimeClient(undefined, 20000, null, env);
    // Polling must not rewrite orca-environments.json (lastUsedAt) every few seconds.
    c.environmentSelector = null;
    clients.set(env, c);
  }
  return c;
}

function reply(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

const rl = require("node:readline").createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  try {
    const c = client(req.env);
    const res = req.caps?.length && c.remote && withCaps
      ? await withCaps(c.remote, req.method, req.params ?? {}, req.timeoutMs ?? 20000, {}, undefined, undefined, req.caps)
      : await c.call(req.method, req.params ?? {}, req.timeoutMs ? { timeoutMs: req.timeoutMs } : undefined);
    if (res?.ok === false) {
      const err = res.error ?? {};
      reply({ id: req.id, ok: false, error: { code: err.code ?? "runtime_error", message: String(err.message ?? "refused").slice(0, 400), data: err.data } });
      return;
    }
    reply({ id: req.id, ok: true, result: res.result });
  } catch (e) {
    clients.delete(req.env); // reconnect fresh next time (endpoint or pairing may have changed)
    reply({ id: req.id, ok: false, error: { code: e?.code ?? "bridge_error", message: String(e?.message ?? e).slice(0, 400), data: e?.data } });
  }
});
rl.on("close", () => process.exit(0));
