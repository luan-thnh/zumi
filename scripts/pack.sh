#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/dist"

mkdir -p "$OUT"
rm -f "$OUT"/*.zip

cd "$ROOT"
gnome-extensions pack \
  --force \
  --out-dir="$OUT" \
  --extra-source=src \
  --extra-source=stylesheet.css \
  --extra-source=icons \
  .

echo "Package written to $OUT"
