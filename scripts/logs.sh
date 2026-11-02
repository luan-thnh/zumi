#!/usr/bin/env bash
set -euo pipefail
journalctl -f -o cat /usr/bin/gnome-shell
