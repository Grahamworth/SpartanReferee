#!/usr/bin/env bash
# Builds Burpee Judge Receiver (the judging computer's Windows app).
#   bash scripts/build-receiver.sh          the installer: downloads/burpee-judge-receiver-setup.exe
#   bash scripts/build-receiver.sh run      just start it (for testing; RECEIVER_BIND=127.0.0.1 keeps it to this computer)
# Assembles in a short temporary folder (deep folders break Windows tools): the app, the Burpee Judge's web files,
# and MediaMTX (downloaded from its GitHub release and checked against the published checksum).
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="${RECEIVER_BUILD:-${TEMP:-/tmp}/receiver-app}"
MTX_VERSION=v1.21.3
mkdir -p "$BUILD/site" "$BUILD/bin" "$BUILD/ui" "$SRC/downloads"
cp "$SRC"/receiver/*.js "$SRC/receiver/package.json" "$BUILD/"
cp "$SRC"/receiver/ui/* "$BUILD/ui/"
cp "$SRC/icons/icon-512.png" "$BUILD/ui/icon.png"
cp "$SRC/icons/icon-512.png" "$BUILD/icon.png"

# the Burpee Judge (served inside the app as app://site/judge.html)
SITE="judge.html styles.css app.js judge-gate.js api-base.js burpee.js exercises.js pose-filter.js multi.js finder.js
  ocr-prep.js readers.js digit-model.js digit-model.json rtmo-s.onnx"
for f in $SITE; do cp "$SRC/$f" "$BUILD/site/"; done
cp -r "$SRC/icons" "$BUILD/site/"
# the pose engine, person finder and models, built in so judging works offline (app.js / finder.js load them from vendor/)
mkdir -p "$BUILD/site/vendor" && cp -r "$SRC/vendor/mediapipe" "$SRC/vendor/ort" "$BUILD/site/vendor/"
cp "$SRC/looks.css" "$SRC/looks.js" "$BUILD/site/"
# the video review page (served by the app to this laptop and the iPad)
rm -rf "$BUILD/review" && cp -r "$SRC/receiver/review" "$BUILD/review"

# MediaMTX
if [ ! -f "$BUILD/bin/mediamtx.exe" ] || ! grep -q "$MTX_VERSION" "$BUILD/bin/VERSION" 2>/dev/null; then
  ZIP="mediamtx_${MTX_VERSION}_windows_amd64.zip"
  BASE="https://github.com/bluenviron/mediamtx/releases/download/$MTX_VERSION"
  curl -sSL -o "$BUILD/$ZIP" "$BASE/$ZIP"
  want=$(curl -sSL "$BASE/checksums.sha256" | grep -E " \*?$ZIP\$" | cut -d' ' -f1)
  have=$(cd "$BUILD" && sha256sum "$ZIP" | cut -d' ' -f1)
  [ -n "$want" ] && [ "$want" = "$have" ] || { echo "MediaMTX download doesn't match its checksum" >&2; exit 1; }
  (cd "$BUILD/bin" && unzip -o -q "../$ZIP" mediamtx.exe LICENSE)
  echo "$MTX_VERSION" > "$BUILD/bin/VERSION"
  rm -f "$BUILD/$ZIP"
fi

cd "$BUILD"
[ -d node_modules/electron ] || npm install --no-audit --no-fund
if [ "${1:-}" = "prep" ]; then exit 0; fi
if [ "${1:-}" = "run" ]; then exec npx electron . "${@:2}"; fi
npx electron-builder --win nsis
VER=$(node -p "require('./package.json').version")
cp "$BUILD/dist/Burpee Judge Receiver Setup $VER.exe" "$SRC/downloads/burpee-judge-receiver-setup.exe"
ls -la "$SRC/downloads/burpee-judge-receiver-setup.exe"
# receiver-version.json (deployed with the site): the Receivers compare it with their own version on start
node -e "
const fs = require('fs'), c = require('crypto'), f = process.argv[1], b = fs.readFileSync(f);
fs.writeFileSync(process.argv[2], JSON.stringify({ version: process.argv[3], url: 'https://yellow-forest-09b984e03.6.azurestaticapps.net/downloads/burpee-judge-receiver-setup.exe',
  size: b.length, sha512: c.createHash('sha512').update(b).digest('base64'), notes: process.env.RECEIVER_NOTES || '' }, null, 1));
" "$SRC/downloads/burpee-judge-receiver-setup.exe" "$SRC/receiver-version.json" "$VER"
cat "$SRC/receiver-version.json"
