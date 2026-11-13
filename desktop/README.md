# Floe for Linux and Windows

The same top-of-screen island as the Mac app, as a [Tauri 2](https://tauri.app) window. The Rust side
(`src-tauri/`) owns the window, the global hotkey, the tray, launch at login and the proxy it keeps
running. Everything you see is the web UI in `src/` (Preact + TypeScript), which talks to Floe's proxy
over HTTP, like the Swift app does.

It builds and runs on macOS too, which is how it's developed, but on a Mac the Swift app in `../app` is Floe.

## Develop

```sh
bun install
bunx tauri dev                       # the window, with the UI hot-reloading from Vite on :1420
bun run dev                          # or just the UI in a browser: http://localhost:1420/?open=hosts
```

- The proxy must be running (`../proxy`, on `127.0.0.1:7717` or `port` in `~/.config/floe/config.json`).
- It answers only Floe's own origins (`tauri://localhost`, `http(s)://tauri.localhost`). Vite's `http://localhost:1420` counts only when the proxy runs with `FLOE_DEV=1`, which a dev build of the app sets when it starts the proxy; set it yourself for `bun run dev` in a browser.
- In a browser, `?port=7799` points the UI at another proxy (for example `FLOE_DEMO=1` on a scratch `HOME`).
- `?open=live|hosts|ask|settings` opens it on that tab.

Environment knobs, all optional:

| Variable | What it does |
| --- | --- |
| `FLOE_HOTKEY` | Overrides `hotkey` from config.json (`alt+space` by default; the Mac spelling `option+space` works). On a Mac running the Swift Floe, use another key here, e.g. `ctrl+alt+shift+f12`. |
| `FLOE_PORT` | Overrides the proxy port. |
| `FLOE_OPEN` | Opens on a tab at start (`hosts`, …), for tests and screenshots. |
| `FLOE_HOME` | Where the proxy is installed (see below). |
| `FLOE_SUPERVISE=1` | Lets the macOS build start the proxy itself (normally launchd does), for testing. |

Checks: `bunx tsc --noEmit` and `cargo check` in `src-tauri/`. Windows type-checks from a Mac with
`PATH="/opt/homebrew/opt/llvm/bin:$PATH" cargo check --target x86_64-pc-windows-msvc`, since tauri-build
needs `llvm-rc`.

## Build

```sh
bunx tauri build --bundles appimage,deb    # Linux: AppImage + .deb
bunx tauri build --bundles nsis            # Windows: per-user installer (no admin)
bunx tauri build --bundles app             # macOS (dev only)
```

The raw binary is `src-tauri/target/release/floe` (`floe.exe` on Windows). The install scripts use it
directly.

## Where things live

| | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Install (`proxy/`, `sage/`, `brain/`), or `FLOE_HOME` | `~/Library/Application Support/Floe` | `${XDG_DATA_HOME:-~/.local/share}/floe` | `%LOCALAPPDATA%\Floe` |
| Logs (`app.log`, `proxy.log`) | `~/Library/Logs/Floe` (`desktop.log` here) | `${XDG_STATE_HOME:-~/.local/state}/floe` | `%LOCALAPPDATA%\Floe\logs` |
| Config, shared with the proxy | `~/.config/floe/config.json` | same | `%USERPROFILE%\.config\floe\config.json` |
| This app's state (position, first-run flags) | `~/.config/floe/desktop.json` | same | same |

## How it behaves

- **The proxy:**
  - On start, if `/health` doesn't answer, it runs `bun <install>/proxy/src/server.ts`, logging to `proxy.log`, and restarts it with backoff when it exits.
  - Windows: no console window, and a job object stops the proxy when Floe exits.
  - Linux: `PR_SET_PDEATHSIG` stops the proxy when Floe exits.
  - A proxy someone else started (systemd, a dev shell, launchd on macOS) is left alone.
  - Bun is found at `~/.bun/bin/bun`, then on `PATH`.
- **The window:** transparent, undecorated, always on top, on every workspace, and left out of the taskbar.
  - It's created unfocused and not focusable, so it never takes the keyboard from a game.
  - Opening it (click, hotkey, tray) takes the keyboard and remembers who had it. Folding it (Esc, clicking elsewhere, the chevron) hands the keyboard back: `SetForegroundWindow` on Windows, an EWMH `_NET_ACTIVE_WINDOW` request on X11.
  - The UI sets the window's size (pill, peek banner or panel), and the Rust side keeps it centred on its anchor along the top edge.
  - Drag the pill sideways to move it; the position is saved.
- **Linux:**
  - It runs on X11, or on XWayland under Wayland: `GDK_BACKEND=x11` is set unless you set it yourself, because Wayland ignores where a window asks to be and whether it stays on top. Global hotkeys on a Wayland session only fire while an X11 window is focused.
  - `WEBKIT_DISABLE_DMABUF_RENDERER=1` is set unless you set it, to avoid blank windows on NVIDIA.
  - The tray needs `libayatana-appindicator3-1`. Without it Floe runs without a tray icon.
- **Launch at login:** switched on once on the first run (Linux/Windows), then left to the Settings toggle. Linux: `~/.config/autostart/Floe.desktop`, pointing at `$APPIMAGE` when run from an AppImage, else the real executable. Windows: the `Run` registry key.

## Layout

```
src/
  main.tsx, app.tsx      the island: pill, peek banner, panel; window sizing
  store.ts               state and actions (a port of the Swift IslandStore)
  api.ts, native.ts      the proxy (HTTP + SSE) and the Rust commands
  views/                 live (agents, question cards), hosts (drill-down), gathering (the sea scene),
                         sage (sprite sheets), chat (Ask), settings, timeline, input, parts
src-tauri/src/
  lib.rs                 window, commands, tray, hotkey, launch at login
  proxy.rs               the proxy supervisor
  focus.rs               keyboard hand-off per OS
  paths.rs, config.rs    where things live; config.json and desktop.json
```
