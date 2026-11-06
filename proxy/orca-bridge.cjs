// Long-lived bridge to remote Orca servers (paired "environments"), run under Orca's own
// Electron in node mode so it uses the exact runtime client the `orca` CLI ships:
//   ELECTRON_RUN_AS_NODE=1 /Applications/Orca.app/Contents/MacOS/Orca orca-bridge.cjs
// Spawning the CLI per poll costs ~330ms CPU; reusing a client costs ~20ms.
//
// Protocol: JSON lines on stdin  {id, env, method, params}
//                     on stdout {id, ok, result} | {id, ok:false, error:{code,message}}

const out = process.env.ORCA_APP_OUT || "/Applications/Orca.app/Contents/Resources/app.asar.unpacked/out";
const { RuntimeClient } = require(out + "/cli/runtime-client.js");

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
    const res = await client(req.env).call(req.method, req.params ?? {}, req.timeoutMs ? { timeoutMs: req.timeoutMs } : undefined);
    reply({ id: req.id, ok: true, result: res.result });
  } catch (e) {
    clients.delete(req.env); // reconnect fresh next time (endpoint or pairing may have changed)
    reply({ id: req.id, ok: false, error: { code: e?.code ?? "bridge_error", message: String(e?.message ?? e).slice(0, 400) } });
  }
});
rl.on("close", () => process.exit(0));
