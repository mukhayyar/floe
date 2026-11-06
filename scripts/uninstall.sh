#!/usr/bin/env bash
# Stop Floe and remove its login items. Leaves the code, ~/.config/floe and the app bundle.
set -euo pipefail
UID_NUM="$(id -u)"
for label in com.mukhayyar.floe com.mukhayyar.floe.proxy; do
  launchctl bootout "gui/$UID_NUM/$label" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/$label.plist"
done
echo "Floe stopped and removed from login items."
