#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/dist-ego"
STAGE="$OUT/stage"
ZIP="$OUT/lumalens@luanthnh.dev.zip"
REPO_URL="${ZUMI_REPOSITORY_URL:-${LUMALENS_REPOSITORY_URL:-}}"

if [[ -z "$REPO_URL" ]]; then
  echo "Set ZUMI_REPOSITORY_URL to your real GitHub/GitLab repository." >&2
  echo "Example: ZUMI_REPOSITORY_URL=https://github.com/YOUR_ACCOUNT/zumi ./scripts/pack-ego.sh" >&2
  exit 2
fi

ZUMI_REPOSITORY_URL="$REPO_URL" node "$ROOT/scripts/ego-preflight.mjs" --require-url

rm -rf "$OUT"
mkdir -p "$STAGE/src" "$STAGE/schemas" "$STAGE/icons"

cp "$ROOT/extension.js" "$STAGE/"
cp "$ROOT/prefs.js" "$STAGE/"
cp "$ROOT/stylesheet.css" "$STAGE/"
cp "$ROOT/LICENSE" "$STAGE/"
cp -R "$ROOT/src/." "$STAGE/src/"
cp "$ROOT/schemas/org.gnome.shell.extensions.lumalens.gschema.xml" "$STAGE/schemas/"
cp "$ROOT/icons/"*.svg "$STAGE/icons/"

ROOT="$ROOT" STAGE="$STAGE" REPO_URL="$REPO_URL" node <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

const metadata = JSON.parse(fs.readFileSync(path.join(process.env.ROOT, 'metadata.json'), 'utf8'));
delete metadata.version;
metadata.url = process.env.REPO_URL;
fs.writeFileSync(path.join(process.env.STAGE, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
NODE

if find "$STAGE" -name gschemas.compiled -print -quit | grep -q .; then
  echo "Refusing to package gschemas.compiled" >&2
  exit 3
fi

(
  cd "$STAGE"
  zip -q -r "$ZIP" .
)

# The EGO upload parser requires metadata.json and extension.js at archive root.
unzip -Z1 "$ZIP" | grep -qx 'metadata.json'
unzip -Z1 "$ZIP" | grep -qx 'extension.js'

rm -rf "$STAGE"
echo "EGO package: $ZIP"
