#!/usr/bin/env bash
# Install PaperWM Niri for the current user (no root needed).
#   git clone https://github.com/hamidxgh/paperwm-niri && cd paperwm-niri && ./install.sh
set -euo pipefail
cd "$(dirname "$0")"
UUID=$(python3 -c 'import json;print(json.load(open("metadata.json"))["uuid"])')
ORIG=paperwm@paperwm.github.com

glib-compile-schemas schemas/
rm -f "$UUID.zip"
zip -qr "$UUID.zip" *.js *.ui resources config schemas metadata.json stylesheet.css LICENSE
gnome-extensions install --force "$UUID.zip"
rm -f "$UUID.zip"

# Same settings schema as PaperWM, so existing PaperWM settings/keybindings carry over,
# but the two can't run together: switch the original off.
if gnome-extensions list | grep -qx "$ORIG"; then
  gnome-extensions disable "$ORIG" 2>/dev/null || true
  echo "Disabled original PaperWM ($ORIG). Remove it with: gnome-extensions uninstall $ORIG"
fi
gnome-extensions enable "$UUID" 2>/dev/null || true

echo
echo "Installed $UUID."
if [[ "${XDG_SESSION_TYPE:-}" == x11 ]]; then
  echo "Restart GNOME Shell to load it: Alt+F2, type r, Enter."
else
  echo "Log out and back in to load it (Wayland can't restart the shell in place)."
fi
echo "Then, if needed: gnome-extensions enable $UUID"
