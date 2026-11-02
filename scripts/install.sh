#!/usr/bin/env bash
set -euo pipefail

UUID="lumalens@luanthnh.dev"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
TARGET="$DATA_HOME/gnome-shell/extensions/$UUID"
NO_ENABLE=0

if [[ "${1:-}" == "--no-enable" ]]; then
  NO_ENABLE=1
fi

if ! command -v gnome-shell >/dev/null 2>&1; then
  echo "[Zumi] gnome-shell was not found."
  exit 1
fi

SHELL_VERSION_RAW="$(gnome-shell --version 2>/dev/null || true)"
SHELL_MAJOR="$(printf '%s' "$SHELL_VERSION_RAW" | grep -oE '[0-9]+' | head -n1 || true)"
SESSION_TYPE="${XDG_SESSION_TYPE:-unknown}"

echo "[Zumi] $SHELL_VERSION_RAW"
echo "[Zumi] Session: $SESSION_TYPE"

if [[ "$SHELL_MAJOR" != "50" ]]; then
  echo "[Zumi] GNOME Shell 50.x is required."
  exit 2
fi

EXPECTED_KEYS=(
  zoom-mode draw-mode break-timer live-zoom live-draw
  record-full record-region record-window
  snip-copy snip-save snip-ocr
  demo-type demo-type-previous panorama cursor-highlight
)

# Validate the package before touching the live extension directory without
# leaving schemas/gschemas.compiled in the source tree (EGO packages for GNOME 50
# must ship the XML schema, not the compiled cache).
if ! command -v glib-compile-schemas >/dev/null 2>&1; then
  echo "[Zumi] ERROR: glib-compile-schemas is required."
  exit 1
fi

SCHEMA_TMP="$(mktemp -d)"
trap 'rm -rf "$SCHEMA_TMP"' EXIT
cp "$ROOT/schemas/org.gnome.shell.extensions.lumalens.gschema.xml" "$SCHEMA_TMP/"
glib-compile-schemas --strict "$SCHEMA_TMP"

export GSETTINGS_SCHEMA_DIR="$SCHEMA_TMP"
for key in "${EXPECTED_KEYS[@]}"; do
  if ! gsettings range org.gnome.shell.extensions.lumalens "$key" >/dev/null 2>&1; then
    echo "[Zumi] ERROR: schema is missing shortcut key: $key"
    exit 3
  fi
done
for key in show-panel-indicator clipboard-shortcuts-enabled break-message break-show-end-time focus-radius focus-dim-opacity cursor-highlight-enabled cursor-highlight-size cursor-highlight-color; do
  if ! gsettings range org.gnome.shell.extensions.lumalens "$key" >/dev/null 2>&1; then
    echo "[Zumi] ERROR: schema is missing setting key: $key"
    exit 3
  fi
done
unset GSETTINGS_SCHEMA_DIR

KNOWN=0
if gnome-extensions info "$UUID" >/dev/null 2>&1; then
  KNOWN=1
  echo "[Zumi] Existing extension detected; disabling it before replacing files..."
  gnome-extensions disable "$UUID" >/dev/null 2>&1 || true
fi

mkdir -p "$(dirname "$TARGET")"
rm -rf "$TARGET"
mkdir -p "$TARGET"
cp -r "$ROOT/extension.js" "$ROOT/prefs.js" "$ROOT/metadata.json" "$ROOT/stylesheet.css" "$ROOT/src" "$ROOT/schemas" "$ROOT/icons" "$TARGET/"
glib-compile-schemas --strict "$TARGET/schemas"

echo
echo "[Zumi] Installed Zumi to: $TARGET"
echo "[Zumi] Package contract: GNOME 50.x / Beacon icon / clipboard shortcuts off by default / clean schema"

if (( NO_ENABLE == 0 )); then
  if (( KNOWN == 1 )); then
    gnome-extensions enable "$UUID" >/dev/null 2>&1 || true
    echo "[Zumi] Enable requested."
    if [[ "$SESSION_TYPE" == "wayland" ]]; then
      echo
      echo "[Zumi] ================================================================"
      echo "[Zumi] REQUIRED: LOG OUT and LOG BACK IN before testing v32 on Wayland."
      echo "[Zumi] GNOME Shell has cached JavaScript from the OLD extension."
      echo "[Zumi] Installing or toggling the extension does NOT reload those files."
      echo "[Zumi] ================================================================"
    fi
  else
    echo "[Zumi] New UUID must be discovered by a Shell process first."
  fi
else
  echo "[Zumi] Skipped enable (--no-enable); intended for nested DevKit testing."
fi

echo
echo "ZoomIt-compatible shortcuts: Ctrl+1 .. Ctrl+8"
echo "Clipboard shortcuts: disabled by default; opt in from Preferences"
echo "Diagnostics: $ROOT/scripts/doctor.sh"
echo "Top-bar icon: enabled by default; change it in Zumi Preferences"
