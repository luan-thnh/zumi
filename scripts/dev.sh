#!/usr/bin/env bash
set -euo pipefail

UUID="lumalens@luanthnh.dev"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$ROOT/scripts/install.sh" --no-enable

if ! command -v dbus-run-session >/dev/null 2>&1; then
  echo "[Zumi] dbus-run-session is required for nested GNOME development."
  exit 1
fi

cat <<'MSG'
[Zumi] Starting a nested GNOME Shell DevKit session.
[Zumi] Your main Wayland session stays running; close the nested window when done.
MSG

exec dbus-run-session bash -lc '
  set -e
  UUID="lumalens@luanthnh.dev"
  gnome-shell --devkit --wayland &
  shell_pid=$!

  for i in $(seq 1 60); do
    if gnome-extensions list 2>/dev/null | grep -qx "$UUID"; then
      gnome-extensions enable "$UUID" >/dev/null 2>&1 || true
      break
    fi
    sleep 0.25
  done

  wait "$shell_pid"
'
