#!/usr/bin/env bash
# Build the Floe overlay and bundle it as ~/Applications/Floe.app
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Applications/Floe.app"

cd "$ROOT/app"
swift build -c release

mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
# Replace atomically (new inode) so a running Floe is never overwritten in place.
cp .build/release/Floe "$APP/Contents/MacOS/Floe.new" && mv -f "$APP/Contents/MacOS/Floe.new" "$APP/Contents/MacOS/Floe"
cp Info.plist "$APP/Contents/Info.plist.new" && mv -f "$APP/Contents/Info.plist.new" "$APP/Contents/Info.plist"
cp Floe.icns "$APP/Contents/Resources/Floe.icns"
codesign --force --sign - "$APP" >/dev/null 2>&1
# tell Finder and the Dock about a new icon
touch "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP" >/dev/null 2>&1 || true
echo "built $APP"
