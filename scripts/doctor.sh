#!/usr/bin/env bash
set -u

UUID="lumalens@luanthnh.dev"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
TARGET="$DATA_HOME/gnome-shell/extensions/$UUID"

echo "=== Zumi diagnostics ==="
echo "GNOME:   $(gnome-shell --version 2>&1 || echo not-found)"
echo "Session: ${XDG_SESSION_TYPE:-unknown}"
echo "Target:  $TARGET"
echo

[[ -d "$TARGET" ]] && echo "[OK] Extension directory exists" || echo "[FAIL] Extension directory is missing"

DISK_VERSION=""
if [[ -f "$TARGET/metadata.json" ]]; then
  echo "[OK] metadata.json exists"
  cat "$TARGET/metadata.json"
  DISK_VERSION="$(grep -oE '"version"[[:space:]]*:[[:space:]]*[0-9]+' "$TARGET/metadata.json" | grep -oE '[0-9]+' | head -n1 || true)"
else
  echo "[FAIL] metadata.json is missing"
fi

echo
[[ -f "$TARGET/schemas/gschemas.compiled" ]] \
  && echo "[OK] GSettings schema is compiled" \
  || echo "[FAIL] schemas/gschemas.compiled is missing"

if [[ -f "$TARGET/schemas/gschemas.compiled" ]]; then
  export GSETTINGS_SCHEMA_DIR="$TARGET/schemas"
  echo
  echo "Shortcut schema contract:"
  for key in zoom-mode draw-mode break-timer live-zoom live-draw record-full record-region record-window snip-copy snip-save snip-ocr demo-type demo-type-previous panorama; do
    printf '  %-20s ' "$key"
    gsettings get org.gnome.shell.extensions.lumalens "$key" 2>/dev/null || echo "<MISSING>"
  done
  printf '  %-20s ' "show-panel-indicator"
  gsettings get org.gnome.shell.extensions.lumalens show-panel-indicator 2>/dev/null || echo "<MISSING>"
  printf '  %-20s ' "clipboard-shortcuts-enabled"
  gsettings get org.gnome.shell.extensions.lumalens clipboard-shortcuts-enabled 2>/dev/null || echo "<MISSING>"
  for key in break-message break-show-end-time focus-radius focus-dim-opacity; do
    printf '  %-20s ' "$key"
    gsettings get org.gnome.shell.extensions.lumalens "$key" 2>/dev/null || echo "<MISSING>"
  done

  if gsettings range org.gnome.shell.extensions.lumalens toggle-zoom >/dev/null 2>&1; then
    echo "[WARN] Obsolete toggle-zoom key is present"
  else
    echo "[OK] Obsolete toggle-zoom key is absent"
  fi
  unset GSETTINGS_SCHEMA_DIR
fi

echo
SHELL_INFO=""
SHELL_VERSION=""
if gnome-extensions info "$UUID" >/dev/null 2>&1; then
  echo "[OK] GNOME Shell knows the extension"
  SHELL_INFO="$(gnome-extensions info "$UUID")"
  echo "$SHELL_INFO"
  SHELL_VERSION="$(printf '%s\n' "$SHELL_INFO" | awk '/^[[:space:]]*Version:/ {print $2; exit}')"

  if [[ -n "$DISK_VERSION" && -n "$SHELL_VERSION" && "$DISK_VERSION" != "$SHELL_VERSION" ]]; then
    echo "[STALE] Files on disk are metadata v$DISK_VERSION but this GNOME Shell process still reports v$SHELL_VERSION."
    echo "[STALE] On the real Wayland session, log out and back in once to load the new JS modules."
  elif [[ -n "$DISK_VERSION" && "$DISK_VERSION" == "$SHELL_VERSION" ]]; then
    echo "[OK] Shell metadata version matches files on disk (v$DISK_VERSION)"
  fi
else
  echo "[WAIT] Current GNOME Shell process has not discovered the extension"
fi

echo
echo "Source compatibility checks:"
if grep -RqsE '\.raise_top[[:space:]]*\(' "$TARGET" 2>/dev/null; then
  echo "[FAIL] removed raise_top() call still exists"
else
  echo "[OK] no raise_top() calls"
fi

if grep -RqsE 'import[[:space:]]*\{[[:space:]]*UIMode[[:space:]]*\}.*screenshot\.js' "$TARGET" 2>/dev/null; then
  echo "[FAIL] removed screenshot UIMode import still exists"
else
  echo "[OK] no screenshot UIMode import"
fi

[[ -f "$TARGET/src/ui/panel-indicator.js" ]] \
  && echo "[OK] top-bar panel indicator source exists" \
  || echo "[FAIL] src/ui/panel-indicator.js is missing"

[[ -f "$TARGET/icons/zumi-symbolic.svg" ]] \
  && echo "[OK] Zumi single-color symbolic SVG panel icon exists" \
  || echo "[FAIL] icons/zumi-symbolic.svg is missing"

[[ -f "$TARGET/src/presentation/focus-spotlight-overlay.js" ]] \
  && echo "[OK] Focus Spotlight source exists" \
  || echo "[FAIL] Focus Spotlight source is missing"

if grep -qs 'new St.Entry' "$TARGET/src/overlay/zoomit-canvas-overlay.js" 2>/dev/null; then
  echo "[OK] Draw text mode uses native St.Entry input"
else
  echo "[FAIL] Draw text mode native editor is missing"
fi

echo
echo "OCR: $(command -v tesseract >/dev/null 2>&1 && echo ready || echo 'tesseract not installed')"
echo
echo "Recent Zumi errors from this boot (may include older builds loaded earlier in the same login session):"
journalctl -b -o cat /usr/bin/gnome-shell 2>/dev/null \
  | grep -Ei 'lumalens|zumi|SyntaxError|TypeError|ReferenceError' \
  | tail -n 80 || true
