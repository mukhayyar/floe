# Floe

**A Dynamic-Island overlay for [Orca](https://orca.stably.ai).** Floe sits in your Mac's notch and shows what
your Orca agents are doing on every host: live tool-call timelines, questions waiting for an answer,
and a moonlit lagoon where every machine is a mechanical sage riding an orca. It stays out of your
way, even in a full-screen game.

<p align="center">
  <img src="docs/floe.gif" width="380" alt="Floe: the Live tab with two agents, the Hosts tab with four karakuri sages riding orcas in a lagoon, and a host's projects">
  <br><a href="docs/floe.mp4">Watch the video (MP4)</a>
</p>

(An orca's favourite place: the ice floe. A floe is a floating island, and so is Floe.)

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/mukhayyar/floe/main/install.sh | bash
```

That's all. The installer:
- checks for Orca;
- installs [Bun](https://bun.sh) if you don't have it;
- downloads the latest release, a prebuilt universal `Floe.app` for Apple Silicon and Intel, into `~/Applications`;
- starts Floe at login.

You'll need macOS 14 (Sonoma) or newer and Orca. These are optional:
- [Claude Code](https://claude.com/claude-code), for the Ask tab.
- Google Chrome, Chromium, Brave or Edge, which draws the sages once per host.

```sh
curl -fsSL https://raw.githubusercontent.com/mukhayyar/floe/main/install.sh | bash -s -- --uninstall    # remove it
curl -fsSL https://raw.githubusercontent.com/mukhayyar/floe/main/install.sh | bash -s -- --from-source  # build the app here
```

## What it does

| | |
|---|---|
| <img src="docs/live.png" width="300" alt="Live tab"> | **Live.** Agents that need you come first, then working, then recently finished. Each one shows its tool calls as a timeline that draws itself step by step. When an agent asks a question or wants permission, its options are buttons: tap one, or type an answer. |
| <img src="docs/hosts.png" width="300" alt="Hosts tab"> | **Hosts.** Every Orca host is a karakuri sage riding an orca in a lagoon inside a ring of ice. While its agents work, the orca swims, beating its flukes and leaving a wake, and the sage writes on its scroll (or types, on this Mac). When one needs you, the orca spouts and the sage strikes its singing bowl. When the host is offline, the orca drifts with its eye shut and the lantern goes out. |
| <img src="docs/host.png" width="300" alt="A host"> | **Drill down.** Tap a sage, then a project, then a worktree: its agents and terminals (the main terminal is marked). Peek at a terminal, type into it, message an agent, start Claude or Codex, or jump to it in Orca. |
| <img src="docs/project.png" width="300" alt="A project"> | **Ask Orca.** The Ask tab is a headless Claude Code session that can read your repos and drive Orca through its CLI, on any host. Pick a worktree and its pill sits above the input, so you know where a message goes. |

The collapsed pill wraps the notch like a live activity: a spinner and a count while agents work, an
orange pulse when one needs you, and a green tick when one finishes.

<p align="center"><img src="docs/pill.png" width="430" alt="The collapsed pill at the notch"></p>

### The sages

<img src="docs/sage.png" width="330" align="right" alt="A karakuri sage riding an orca">

Each host gets its own automaton, drawn as an isometric figure with the
[anatomy](https://skills.wheresryan.sh/anatomy) kit: a turned wooden doll with ball-jointed arms,
riding an orca. The host is part of Orca, so its sage rides one.
- **The orca:** one turned body with a tall dorsal fin, beating flukes, pectoral fins and white
  markings. The saddle board on its back carries the sage, its desk, its singing bowl and a lantern
  or incense.
- **Seeded per host:** the hat, the silk robe's colour, the board's shape and lacquer, the beard,
  the orca's markings and the characters it writes. Floe picks them so no two hosts look alike.
- **Name plate:** the host's initials are on a brass plate at the front of the board.

The proxy renders each sage once per host as a sprite sheet. Floe plays it with Core Animation, so
it costs the app nothing per frame.

### Built for games

Floe never takes focus when you click it. It sits above borderless and full-screen games, including
Dota 2's SDL full-screen mode, and has no hover-to-expand, so edge-panning won't open it. Over Floe
you get the normal Mac cursor instead of the game's. Drag it along the top edge to clear your HUD.

## Use it

| | |
|---|---|
| `⌥ Space` | open Floe and focus the input (again, or `Esc`, to close it and hand focus back) |
| click the pill | open Floe |
| drag the pill | move it along the top edge (it snaps to the notch) |
| right-click the pill | snap to notch, click-through, border, sounds, quit |
| `open floe://hosts` | deep links: `live`, `hosts`, `ask`, `collapse`, `pin`, `unpin`, `host?id=…`, `project?host=…&key=…`, `workspace?host=…&project=…&key=…` |

**Click-through when collapsed** (right-click menu or Settings) makes the pill ignore the mouse
completely during games; open it with the hotkey instead.

## Settings

`~/.config/floe/config.json` (restart Floe after editing):

```json
{
  "hotkey": "option+space",
  "model": "sonnet",
  "level": "shielding",
  "hiddenHosts": [],
  "extraDirs": []
}
```

- `hotkey`: modifiers `cmd`, `ctrl`, `option` or `shift`, plus a key (`space`, letters, digits, `` ` ``, `f1`–`f12`).
- `level`: one of:
  - `shielding` (the default): above every game window mode, including SDL's full-screen
    `CGShieldingWindowLevel`.
  - `screensaver`.
  - `statusbar`.
- `model`: the model for the Ask tab.
- `hiddenHosts`: Orca servers to skip, by id or name.
- `orcaBin`, `claudeBin`: only needed if Floe can't find the `orca` or `claude` CLI on its own.

## How it works

```
Floe.app (Swift, AppKit + SwiftUI)  ──HTTP/SSE──▶  proxy (Bun, 127.0.0.1:7717)
                                                    ├─ this Mac: Orca's local runtime socket
                                                    ├─ Orca servers: one long-lived client on Orca's own RuntimeClient
                                                    ├─ writes: the official `orca` CLI
                                                    ├─ Ask: `claude -p`, resumable
                                                    └─ sages: anatomy-kit orca riders → sprite sheets (headless Chrome)
```

- `proxy/src/orca.ts` polls every host and builds the host → project → worktree → agent
  snapshot. It tracks each agent's tool steps and emits `snapshot` and `activity` events.
  `menu.ts` reads choice menus off an agent's screen (`bun test`).
- `sage/` holds the sages and the floe:
  - `sage.mjs` is the orca rider and its four loops; `palette.mjs` holds the materials.
  - `scene.mjs` is the ice ring and lagoon, with the seat layout for 1–10 hosts.
  - `build.mjs` renders them (`--sheet`, `--scene`, `--preview`) and runs the geometry audit
    (`--audit`, every state).
- `app/Sources/Floe/` is the overlay:
  - `IslandWindow`: the panel, dragging, focus and the cursor.
  - `Gathering` and `Sage`: the lagoon and the sprite players.
  - `HostsView`: the drill-down.
  - `Timeline`: the tool steps.
  - `AgentViews` and `ChatViews`.

Everything stays on your Mac. The proxy listens on 127.0.0.1 only and talks to Orca and the CLIs
you already have.

### Try it without Orca

`FLOE_DEMO=1 bun src/server.ts` (in `proxy/`) runs a made-up Orca with four hosts. One agent
works through tool calls, one asks a question you can answer, one has finished, and one host is
offline. The screenshots and video above come from it.

### Build from source

```sh
git clone https://github.com/mukhayyar/floe && cd floe
scripts/install.sh      # build Floe.app with Swift, start the proxy and the app at login
scripts/build.sh        # rebuild the app, then: launchctl kickstart -k gui/$(id -u)/com.mukhayyar.floe
scripts/uninstall.sh    # stop both and remove the login items
```

Logs are in `~/Library/Logs/Floe/`. Building needs the Xcode Command Line Tools and Bun.

## Credits

- [Orca](https://orca.stably.ai) by Stably.
- The sages are drawn with the [anatomy](https://skills.wheresryan.sh/anatomy) isometric kit by Ryan
  (MIT, vendored in `sage/kit/`).
