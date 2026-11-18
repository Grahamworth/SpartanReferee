#!/usr/bin/env bash
# Publishes SpartanReferee's website and API: the files listed in scripts/site-files.txt, the big media in site-extras/ (kept on
# this PC, not in git), and the review's test pages built from server/review. Nothing else in this folder (test videos, say)
# can end up on the site. Safe to run again.
set -euo pipefail
SUB=65c0ccca-69f7-43eb-9246-3bd6a6a06b24; RG=rg-spartanreferee-uksouth; SITE=spartanreferee
SRC="$(cd "$(dirname "$0")/.." && pwd)"; OUT="${TEMP:-/tmp}/spartanreferee-site"
node -e "require('fs').rmSync(process.argv[1], { recursive: true, force: true })" "$OUT"
mkdir -p "$OUT"
cd "$SRC"
while IFS= read -r f; do [ -n "$f" ] || continue; mkdir -p "$OUT/$(dirname "$f")"; cp "$f" "$OUT/$f"; done < scripts/site-files.txt
[ -d site-extras ] && cp -r site-extras/. "$OUT/"
mkdir -p "$OUT/downloads"
node scripts/build-review-test.mjs "$OUT" > /dev/null
if find "$OUT" -ipath '*clips*' -o -iname 'test.mp4' -o -iname 'pub*.html' | grep -q .; then echo "A test video or page got into the site: stopping"; exit 1; fi
(cd api && npm ci --silent --no-audit --no-fund)
TOKEN=$(az staticwebapp secrets list --name $SITE -g $RG --subscription $SUB --query properties.apiKey -o tsv | tr -d '\r')
swa deploy "$OUT" --api-location "$SRC/api" --api-language node --api-version 20 --env production --deployment-token "$TOKEN"
