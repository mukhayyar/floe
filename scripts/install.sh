#!/usr/bin/env bash
# Build Floe and start it at login: the proxy (kept alive) and the overlay app.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
LOGS="$HOME/Library/Logs/Floe"
UID_NUM="$(id -u)"
BUN="$(command -v bun || echo "$HOME/.bun/bin/bun")"
mkdir -p "$AGENTS" "$LOGS"

"$ROOT/scripts/build.sh"

cat > "$AGENTS/com.mukhayyar.floe.proxy.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.mukhayyar.floe.proxy</string>
  <key>ProgramArguments</key>
  <array><string>$BUN</string><string>src/server.ts</string></array>
  <key>WorkingDirectory</key><string>$ROOT/proxy</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:$HOME/.local/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOGS/proxy.log</string>
  <key>StandardErrorPath</key><string>$LOGS/proxy.log</string>
</dict>
</plist>
PLIST

cat > "$AGENTS/com.mukhayyar.floe.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.mukhayyar.floe</string>
  <key>ProgramArguments</key>
  <array><string>$HOME/Applications/Floe.app/Contents/MacOS/Floe</string></array>
  <key>RunAtLoad</key><true/>
  <!-- Restart after a crash, but stay quit when you choose Quit Floe. -->
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$LOGS/app.log</string>
  <key>StandardErrorPath</key><string>$LOGS/app.log</string>
</dict>
</plist>
PLIST

# Stop any copies started by hand, then (re)load both agents.
pkill -f "bun src/server.ts" 2>/dev/null || true
pkill -f "Floe.app/Contents/MacOS/Floe" 2>/dev/null || true
for label in com.mukhayyar.floe.proxy com.mukhayyar.floe; do
  launchctl bootout "gui/$UID_NUM/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_NUM" "$AGENTS/$label.plist"
done
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$HOME/Applications/Floe.app" || true

sleep 2
curl -fsS "http://127.0.0.1:7717/health" && echo && echo "Floe is running. Logs: $LOGS"
