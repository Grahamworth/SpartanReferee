#!/usr/bin/env bash
# Builds what goes on a SpartanReferee server: the server, the review page and the judge with its engines and models, as one archive.
# Only named files go in, so nothing else in this folder (test videos, say) can end up on a server.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="${TEMP:-/tmp}/headjudge-server"
OUT="$SRC/downloads/headjudge-server.tar.gz"

node -e "require('fs').rmSync(process.argv[1], { recursive: true, force: true })" "$BUILD"
mkdir -p "$BUILD/site/vendor" "$BUILD/setup"
cp "$SRC"/server/*.js "$SRC/server/package.json" "$SRC/server/package-lock.json" "$BUILD/"
cp -r "$SRC/server/review" "$BUILD/review"
cp "$SRC"/server/setup/* "$BUILD/setup/"

# the judge (served at /judge/)
SITE="judge.html styles.css app.js judge-gate.js api-base.js burpee.js exercises.js pose-filter.js multi.js finder.js
  cones.js ocr-prep.js readers.js digit-model.js digit-model.json rtmo-s.onnx looks.css looks.js brand.js"
for f in $SITE; do cp "$SRC/$f" "$BUILD/site/"; done
cp -r "$SRC/icons" "$BUILD/site/"
cp -r "$SRC/vendor/mediapipe" "$SRC/vendor/ort" "$BUILD/site/vendor/"

(cd "$BUILD" && npm ci --omit=dev --silent --no-audit --no-fund)

# nothing that isn't meant to be there
if find "$BUILD" -iname '*.mp4' -o -iname '*.mov' -o -iname '*.webm' -o -iname 'pub*.html' | grep -q .; then echo "A video or test page got into the server's files: stopping"; exit 1; fi

mkdir -p "$SRC/downloads"
tar --owner=0 --group=0 -czf "$OUT" -C "$BUILD" .
ls -la "$OUT"
