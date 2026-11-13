#!/usr/bin/env bash
# Floe's icon, every size, from one drawing (desktop/assets/icon.mjs): the Linux/Windows app's
# icons (Tauri's set, the tray) and the Mac app's Floe.icns. Needs Node, Bun, Chrome, and macOS
# for iconutil/sips.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

node desktop/assets/icon.mjs
(cd desktop && bun x tauri icon assets/icon.png -o src-tauri/icons >/dev/null 2>&1)
rm -rf desktop/src-tauri/icons/android desktop/src-tauri/icons/ios # mobile sizes Floe doesn't ship
cp desktop/assets/tray.png desktop/src-tauri/icons/tray.png

SET="$(mktemp -d)/Floe.iconset"
mkdir -p "$SET"
for z in 16 32 128 256 512; do
  sips -z $z $z desktop/assets/icon.png --out "$SET/icon_${z}x${z}.png" >/dev/null
  sips -z $((z * 2)) $((z * 2)) desktop/assets/icon.png --out "$SET/icon_${z}x${z}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o app/Floe.icns
echo "icons: desktop/src-tauri/icons, app/Floe.icns"
