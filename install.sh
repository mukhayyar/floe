#!/usr/bin/env bash
# Install Floe on macOS or Linux (on Windows, use install.ps1):
#
#   curl -fsSL https://raw.githubusercontent.com/mukhayyar/floe/main/install.sh | bash
#
# Options (after `bash -s --`):
#   --uninstall      stop Floe and remove it (your settings in ~/.config/floe stay; add --purge to remove them too)
#   --from-source    build the app here instead of downloading it (macOS: Xcode Command Line Tools;
#                    Linux: Rust and Tauri's system libraries, see desktop/README.md)
#   --version vX.Y.Z install that release instead of the latest
#
# What it does: checks for Orca, installs Bun if it's missing, downloads the latest release
# (a prebuilt app plus the proxy and sage sources) and starts Floe at login.
#   macOS: Floe.app in ~/Applications, the rest in ~/Library/Application Support/Floe, launchd.
#   Linux: Floe.AppImage and the rest in ~/.local/share/floe; the app starts the proxy itself
#          and adds itself to your desktop's autostart.
set -euo pipefail

REPO="mukhayyar/floe"
OS="$(uname -s)"
case "$OS" in
  Darwin | Linux) ;;
  MINGW* | MSYS* | CYGWIN*) printf 'On Windows, run this in PowerShell instead:\n  irm https://raw.githubusercontent.com/%s/main/install.ps1 | iex\n' "$REPO" >&2; exit 1 ;;
  *) printf 'Floe runs on macOS, Linux and Windows; this is %s.\n' "$OS" >&2; exit 1 ;;
esac
if [[ "$OS" == "Darwin" ]]; then
  PREFIX="${FLOE_PREFIX:-$HOME/Library/Application Support/Floe}"
  APPDIR="${FLOE_APPDIR:-$HOME/Applications}"
  AGENTS="${FLOE_AGENTS:-$HOME/Library/LaunchAgents}"
  LOGS="${FLOE_LOGS:-$HOME/Library/Logs/Floe}"
  CACHE="$HOME/Library/Caches/Floe"
else
  PREFIX="${FLOE_PREFIX:-${XDG_DATA_HOME:-$HOME/.local/share}/floe}"
  APPDIR="${FLOE_APPDIR:-${XDG_DATA_HOME:-$HOME/.local/share}/applications}"
  AGENTS="${FLOE_AGENTS:-${XDG_CONFIG_HOME:-$HOME/.config}/autostart}"
  LOGS="${FLOE_LOGS:-${XDG_STATE_HOME:-$HOME/.local/state}/floe}"
  CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/floe"
fi
LABEL_PROXY="com.mukhayyar.floe.proxy"
LABEL_APP="com.mukhayyar.floe"
UID_NUM="$(id -u)"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
say() { printf "\033[1;34m==>\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m !\033[0m %s\n" "$*"; }
die() { printf "\033[1;31m x\033[0m %s\n" "$*" >&2; exit 1; }

MODE="install" PURGE=0 FROM_SOURCE=0 VERSION="${FLOE_VERSION:-latest}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --uninstall) MODE="uninstall" ;;
    --purge) PURGE=1 ;;
    --from-source) FROM_SOURCE=1 ;;
    --version) VERSION="$2"; shift ;;
    -h|--help) sed -n '2,15p' "$0" 2>/dev/null || true; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

stop_agents() {
  # a sandboxed run (FLOE_PREFIX etc.) must never stop the Floe that's really installed
  [[ "${FLOE_NO_LAUNCHD:-0}" == "1" ]] && return 0
  if [[ "$OS" == "Linux" ]]; then
    # the app, then the proxy it supervises (matched by their install paths)
    pkill -f "$PREFIX/Floe.AppImage" 2>/dev/null || true
    pkill -f "$PREFIX/app/" 2>/dev/null || true
    pkill -f "$PREFIX/proxy/src/server.ts" 2>/dev/null || true
    return 0
  fi
  for label in "$LABEL_APP" "$LABEL_PROXY"; do
    launchctl bootout "gui/$UID_NUM/$label" 2>/dev/null || true
  done
  pkill -f "Floe.app/Contents/MacOS/Floe" 2>/dev/null || true
}

if [[ "$MODE" == "uninstall" ]]; then
  say "Stopping Floe"
  stop_agents
  if [[ "$OS" == "Linux" ]]; then
    rm -f "$AGENTS/Floe.desktop" "$APPDIR/floe.desktop"
    rm -rf "$PREFIX" "$CACHE"
  else
    rm -f "$AGENTS/$LABEL_APP.plist" "$AGENTS/$LABEL_PROXY.plist"
    rm -rf "$APPDIR/Floe.app" "$PREFIX" "$CACHE"
  fi
  [[ $PURGE == 1 ]] && rm -rf "$HOME/.config/floe" "$LOGS"
  bold "Floe is uninstalled."
  exit 0
fi

# ---------------------------------------------------------------- checks
if [[ "$OS" == "Linux" ]]; then
  case "$(uname -m)" in
    x86_64 | amd64) ARCH="x86_64" ;;
    aarch64 | arm64) ARCH="aarch64" ;;
    *) die "Floe's Linux build is for x86_64 and aarch64; this is $(uname -m)." ;;
  esac
  ORCA_SEEN=0
  [[ -d "${XDG_CONFIG_HOME:-$HOME/.config}/orca" ]] && ORCA_SEEN=1
  command -v orca-ide >/dev/null 2>&1 && ORCA_SEEN=1
  if [[ $ORCA_SEEN == 0 ]]; then
    warn "Orca doesn't seem to be installed. Floe talks to Orca; get it at https://orca.stably.ai"
    warn "Floe still installs, and shows \"Orca is offline\" until Orca is running."
  fi
fi
if [[ "$OS" == "Darwin" ]]; then
MAJOR="$(sw_vers -productVersion | cut -d. -f1)"
[[ "$MAJOR" -ge 14 ]] || die "Floe needs macOS 14 (Sonoma) or newer; this Mac has $(sw_vers -productVersion)."

if [[ ! -d "/Applications/Orca.app" ]]; then
  warn "Orca isn't in /Applications. Floe talks to Orca; get it at https://orca.stably.ai"
  warn "Floe still installs, and shows \"Orca is offline\" until Orca is running."
fi
fi

BUN="$(command -v bun || true)"
[[ -z "$BUN" && -x "$HOME/.bun/bin/bun" ]] && BUN="$HOME/.bun/bin/bun"
if [[ -z "$BUN" ]]; then
  say "Installing Bun (it runs Floe's proxy)"
  curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1 || die "Bun didn't install. Install it from https://bun.sh and run this again."
  BUN="$HOME/.bun/bin/bun"
fi

CHROME=""
if [[ "$OS" == "Darwin" ]]; then
  for c in "/Applications/Google Chrome.app" "/Applications/Chromium.app" "/Applications/Brave Browser.app" "/Applications/Microsoft Edge.app" "/Applications/Arc.app" "$HOME/Applications/Google Chrome.app"; do
    [[ -d "$c" ]] && { CHROME="$c"; break; }
  done
else
  for c in google-chrome google-chrome-stable chromium chromium-browser brave-browser microsoft-edge microsoft-edge-stable; do
    command -v "$c" >/dev/null 2>&1 && { CHROME="$c"; break; }
  done
fi
[[ -z "$CHROME" ]] && warn "No Chrome, Chromium, Brave or Edge found. Floe works without one, but needs one to draw the sages in the Hosts tab."

CLAUDE="$(command -v claude || true)"
[[ -z "$CLAUDE" && -x "$HOME/.local/bin/claude" ]] && CLAUDE="$HOME/.local/bin/claude"
[[ -z "$CLAUDE" ]] && warn "Claude Code isn't installed. Everything works except the Ask tab: https://claude.com/claude-code"

# ---------------------------------------------------------------- download
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
# download to a file with retries, and make sure what arrived is complete
fetch() {
  local url="$1" out="$2" n
  for n in 1 2 3 4; do
    if curl -fsSL --retry 2 -o "$out" "$url"; then
      case "$out" in
        *.tar.gz) gzip -t "$out" 2>/dev/null && return 0 ;;
        *.zip) unzip -tq "$out" >/dev/null 2>&1 && return 0 ;;
        *) return 0 ;;
      esac
    fi
    sleep $((n * 2))
  done
  return 1
}

if [[ "$VERSION" == "latest" ]]; then
  VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1 || true)"
fi
if [[ -n "$VERSION" ]]; then
  say "Downloading Floe $VERSION"
  fetch "https://github.com/$REPO/archive/refs/tags/$VERSION.tar.gz" "$TMP/src.tar.gz" || die "Couldn't download Floe $VERSION. Check your connection and try again."
  tar -xzf "$TMP/src.tar.gz" -C "$TMP"
else
  warn "No release found; installing the latest code from main"
  FROM_SOURCE=1
  fetch "https://github.com/$REPO/archive/refs/heads/main.tar.gz" "$TMP/src.tar.gz" || die "Couldn't download Floe. Check your connection and try again."
  tar -xzf "$TMP/src.tar.gz" -C "$TMP"
fi
SRC="$(find "$TMP" -maxdepth 1 -type d -name 'floe-*' | head -1)"
[[ -d "$SRC/proxy" ]] || die "The download doesn't look like Floe."

if [[ "$OS" == "Linux" ]]; then
  # ---------------------------------------------------------------- Linux app
  if [[ $FROM_SOURCE == 0 ]]; then
    fetch "https://github.com/$REPO/releases/download/$VERSION/Floe-linux-$ARCH.AppImage" "$TMP/Floe.AppImage" ||
      { warn "No prebuilt Linux app in $VERSION; building it here instead"; FROM_SOURCE=1; }
  fi
  if [[ $FROM_SOURCE == 1 ]]; then
    command -v cargo >/dev/null 2>&1 || die "Building Floe needs Rust (https://rustup.rs) and Tauri's libraries (see desktop/README.md)."
    say "Building Floe (a few minutes)"
    (cd "$SRC/desktop" && "$BUN" install >/dev/null && "$BUN" x tauri build --no-bundle >/dev/null) || die "The build failed. See desktop/README.md for the libraries it needs."
    BUILT="$(find "$SRC/desktop" -path '*/target/release/floe' -type f | head -1)"
    [[ -x "$BUILT" ]] || die "The build didn't produce Floe."
  fi

  say "Installing to $PREFIX"
  stop_agents
  mkdir -p "$PREFIX" "$APPDIR" "$LOGS"
  for part in proxy sage brain; do
    rm -rf "${PREFIX:?}/$part"
    cp -R "$SRC/$part" "$PREFIX/$part"
  done
  cp "$SRC/README.md" "$PREFIX/README.md" 2>/dev/null || true
  rm -rf "$PREFIX/app" "$PREFIX/Floe.AppImage" "$PREFIX/floe"
  if [[ $FROM_SOURCE == 1 ]]; then
    cp "$BUILT" "$PREFIX/floe"
    EXEC="$PREFIX/floe"
  else
    cp "$TMP/Floe.AppImage" "$PREFIX/Floe.AppImage"
    chmod +x "$PREFIX/Floe.AppImage"
    EXEC="$PREFIX/Floe.AppImage"
    # AppImages mount themselves with FUSE 2; without it, unpack once and run the unpacked copy
    # (FLOE_EXTRACT=1 unpacks it anyway, for systems where mounting AppImages fails)
    if [[ "${FLOE_EXTRACT:-0}" == "1" ]] || ! { ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; }; then
      say "Unpacking the AppImage, so it runs without FUSE 2"
      (cd "$PREFIX" && ./Floe.AppImage --appimage-extract >/dev/null) || die "Couldn't unpack Floe.AppImage."
      mv "$PREFIX/squashfs-root" "$PREFIX/app"
      rm -f "$PREFIX/Floe.AppImage"
      EXEC="$PREFIX/app/AppRun"
    fi
    (cd "$TMP" && "$PREFIX/Floe.AppImage" --appimage-extract '*.png' >/dev/null 2>&1) || true
  fi
  # the top-level floe.png is a symlink into usr/share/icons; Floe.png next to it is the file
  ICON="$(find "$TMP/squashfs-root" "$PREFIX/app" -maxdepth 1 -name '*.png' -type f 2>/dev/null | head -1 || true)"
  [[ -n "$ICON" ]] && { cp "$ICON" "$PREFIX/floe.png" || true; }
  cat > "$APPDIR/floe.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Floe
Comment=Your Orca agents at the top of the screen
Exec="$EXEC"
Icon=$PREFIX/floe.png
Terminal=false
Categories=Development;
StartupNotify=false
DESKTOP
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPDIR" >/dev/null 2>&1 || true

  if [[ "${FLOE_NO_LAUNCHD:-0}" == "1" ]]; then
    bold "Installed (not started)."
    exit 0
  fi
  if [[ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
    echo
    bold "Floe is installed."
    echo "  There's no desktop session here, so open Floe from your apps menu when you're at the desktop."
    echo "  It starts its proxy itself, and at login from then on."
    exit 0
  fi
  (setsid "$EXEC" >/dev/null 2>&1 &) || true
  for _ in $(seq 1 30); do
    curl -fsS "http://127.0.0.1:7717/health" >/dev/null 2>&1 && break
    sleep 0.5
  done
  echo
  if curl -fsS "http://127.0.0.1:7717/health" >/dev/null 2>&1; then
    bold "Floe is running at the top of your screen."
  else
    warn "Floe started, but its proxy didn't answer yet. Check $LOGS/proxy.log"
  fi
  echo "  Alt+Space opens it · drag the pill to move it · Floe's tray icon has Settings and Quit"
  echo "  Logs: $LOGS · Settings: ~/.config/floe/config.json"
  echo "  Uninstall: curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash -s -- --uninstall"
  exit 0
fi

if [[ $FROM_SOURCE == 0 ]]; then
  # curl doesn't set the quarantine flag, so the ad-hoc signed app opens without a Gatekeeper prompt
  if fetch "https://github.com/$REPO/releases/download/$VERSION/Floe-macOS.zip" "$TMP/Floe.zip"; then
    ditto -x -k "$TMP/Floe.zip" "$TMP/app"
  else
    warn "No prebuilt app in $VERSION; building it here instead"
    FROM_SOURCE=1
  fi
fi
if [[ $FROM_SOURCE == 1 ]]; then
  xcode-select -p >/dev/null 2>&1 || die "Building Floe needs the Xcode Command Line Tools: run  xcode-select --install  and try again."
  say "Building Floe.app (about a minute)"
  (cd "$SRC/app" && swift build -c release >/dev/null)
  mkdir -p "$TMP/app/Floe.app/Contents/MacOS"
  cp "$SRC/app/.build/release/Floe" "$TMP/app/Floe.app/Contents/MacOS/Floe"
  cp "$SRC/app/Info.plist" "$TMP/app/Floe.app/Contents/Info.plist"
  codesign --force --sign - "$TMP/app/Floe.app" >/dev/null 2>&1
fi
[[ -x "$TMP/app/Floe.app/Contents/MacOS/Floe" ]] || die "Floe.app is missing from the download."

# ---------------------------------------------------------------- install
say "Installing to $APPDIR/Floe.app and $PREFIX"
stop_agents
mkdir -p "$PREFIX" "$APPDIR" "$AGENTS" "$LOGS"
for part in proxy sage brain; do
  rm -rf "$PREFIX/$part"
  cp -R "$SRC/$part" "$PREFIX/$part"
done
cp "$SRC/README.md" "$PREFIX/README.md" 2>/dev/null || true
rm -rf "$APPDIR/Floe.app"
ditto "$TMP/app/Floe.app" "$APPDIR/Floe.app"
xattr -dr com.apple.quarantine "$APPDIR/Floe.app" 2>/dev/null || true

PATH_VALUE="/opt/homebrew/bin:$HOME/.local/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cat > "$AGENTS/$LABEL_PROXY.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL_PROXY</string>
  <key>ProgramArguments</key>
  <array><string>$BUN</string><string>src/server.ts</string></array>
  <key>WorkingDirectory</key><string>$PREFIX/proxy</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$PATH_VALUE</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOGS/proxy.log</string>
  <key>StandardErrorPath</key><string>$LOGS/proxy.log</string>
</dict>
</plist>
PLIST

cat > "$AGENTS/$LABEL_APP.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL_APP</string>
  <key>ProgramArguments</key>
  <array><string>$APPDIR/Floe.app/Contents/MacOS/Floe</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$LOGS/app.log</string>
  <key>StandardErrorPath</key><string>$LOGS/app.log</string>
</dict>
</plist>
PLIST

if [[ "${FLOE_NO_LAUNCHD:-0}" == "1" ]]; then
  bold "Installed (launchd skipped)."
  exit 0
fi

for label in "$LABEL_PROXY" "$LABEL_APP"; do
  launchctl bootstrap "gui/$UID_NUM" "$AGENTS/$label.plist"
done
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APPDIR/Floe.app" >/dev/null 2>&1 || true

for _ in $(seq 1 20); do
  curl -fsS "http://127.0.0.1:7717/health" >/dev/null 2>&1 && break
  sleep 0.5
done
if curl -fsS "http://127.0.0.1:7717/health" >/dev/null 2>&1; then
  echo
  bold "Floe is running at the top of your screen."
  echo "  ⌥ Space opens it · drag the pill to move it · right-click it for options"
  echo "  Logs: $LOGS · Settings: ~/.config/floe/config.json"
  echo "  Uninstall: curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash -s -- --uninstall"
else
  warn "Floe's proxy didn't answer yet. Check $LOGS/proxy.log"
fi
