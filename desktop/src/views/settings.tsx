// Settings: what this app keeps (sound, banners, border, launch at login), what the proxy keeps
// (auto-deliver), and where things are when something's wrong.

import { native } from "../native";
import {
  autoDeliver,
  autostart,
  boot,
  border,
  newChat,
  peekOnDone,
  proxyOnline,
  proxyState,
  setAutoDeliver,
  setAutostart,
  sound,
} from "../store";
import { SmallButton, Toggle } from "./parts";

const PROXY_LABEL: Record<string, string> = {
  running: "Running (started by Floe)",
  external: "Running",
  starting: "Starting…",
  "no-bun": "Bun isn't installed",
  "no-proxy": "Not installed",
  crashed: "Couldn't start",
  offline: "Not answering",
};

export function SettingsView() {
  const b = boot.value;
  const p = proxyState.value;
  const ok = proxyOnline.value;
  return (
    <div class="scroll settings">
      <Toggle on={sound.value} onChange={(v) => (sound.value = v)}>
        Play a sound when an agent asks something
      </Toggle>
      <Toggle on={peekOnDone.value} onChange={(v) => (peekOnDone.value = v)}>
        Show a banner when an agent finishes
      </Toggle>
      <Toggle on={border.value} onChange={(v) => (border.value = v)}>
        Colored border so Floe is easy to spot
      </Toggle>
      <Toggle on={autoDeliver.value} onChange={setAutoDeliver} disabled={!ok}>
        <span>Auto-deliver</span>
        <small>
          Delivers messages held from other sessions and picks the option an agent marks “Recommended”, without asking. Permission prompts still wait for you.
        </small>
      </Toggle>
      {native.inTauri && (
        <Toggle on={autostart.value === true} onChange={setAutostart} disabled={autostart.value === null}>
          <span>Launch at login</span>
          <small>Floe starts with your session, and keeps its proxy running.</small>
        </Toggle>
      )}

      <div class="setting">
        <div class="label">Hotkey</div>
        <div class="soft">
          <kbd>{prettyHotkey(b?.hotkey ?? "alt+space")}</kbd> opens Floe and puts the cursor in its input; Esc folds it away. Change it with
          "hotkey" in ~/.config/floe/config.json, then restart Floe.
        </div>
        {b?.hotkeyError && <div class="error">{b.hotkeyError}</div>}
      </div>

      <div class="setting">
        <div class="label">Proxy</div>
        <div class="row gap6">
          <i class="dot" style={{ background: ok ? "var(--green)" : p?.state === "starting" ? "var(--blue)" : "var(--orange)" }} />
          <span class="soft">
            {ok ? "Connected" : p ? PROXY_LABEL[p.state] ?? p.state : "Not connected"} · 127.0.0.1:{b?.port ?? 7717}
          </span>
        </div>
        {!ok && p?.message && <div class="soft small-text">{p.message}</div>}
      </div>

      <div class="setting">
        <div class="label">Position</div>
        <div class="soft">Drag Floe left or right along the top edge. The tray icon can move it back to the center.</div>
      </div>

      <div class="row gap6 wrap">
        <SmallButton title="New chat" icon="plus" onClick={newChat} />
        {native.inTauri && <SmallButton title="Move to center" icon="up" onClick={() => native.snapCenter()} />}
        {native.inTauri && <SmallButton title="Open logs" icon="folder" onClick={() => native.openLogs()} />}
        {native.inTauri && <SmallButton title="Quit Floe" icon="power" onClick={() => native.quit()} />}
      </div>
      <div class="faint tiny">
        Floe {b?.version ?? ""} · {b?.platform ?? "web"}
        {b?.logsDir ? ` · logs in ${b.logsDir}` : ""}
      </div>
    </div>
  );
}

function prettyHotkey(spec: string) {
  const mac = boot.value?.platform === "macos";
  return spec
    .split("+")
    .map((p) => {
      const k = p.trim().toLowerCase();
      if (k === "option" || k === "opt" || k === "alt") return mac ? "⌥" : "Alt";
      if (k === "cmd" || k === "command" || k === "super") return mac ? "⌘" : "Super";
      if (k === "ctrl" || k === "control") return mac ? "⌃" : "Ctrl";
      if (k === "shift") return mac ? "⇧" : "Shift";
      return k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase() + k.slice(1);
    })
    .join(mac ? "" : "+");
}
