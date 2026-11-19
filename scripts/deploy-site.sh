#!/usr/bin/env bash
# Publishes SpartanReferee's website and API: the files listed in scripts/site-files.txt, the big media in site-extras/ (kept on
# this PC, not in git), and the review's test pages built from server/review. Nothing else in this folder (test videos, say)
# can end up on the site. Safe to run again.
# It deploys only what's committed (the site and API files must have no uncommitted changes), records the commit in version.json
# (shown at the foot of the admin page), and first applies the learning database's migrations with the admin login, as the site's
# own login (learn_app) can't make tables.
set -euo pipefail
SUB=65c0ccca-69f7-43eb-9246-3bd6a6a06b24; RG=rg-spartanreferee-uksouth; SITE=spartanreferee
SRC="$(cd "$(dirname "$0")/.." && pwd)"; OUT="${TEMP:-/tmp}/spartanreferee-site"
node -e "require('fs').rmSync(process.argv[1], { recursive: true, force: true })" "$OUT"
mkdir -p "$OUT"
cd "$SRC"
if [ -n "$(git status --porcelain -- $(tr '\n' ' ' < scripts/site-files.txt) api)" ]; then echo "Uncommitted changes in the site or API: commit them first, so what's live is a commit"; git status --short -- api $(tr '\n' ' ' < scripts/site-files.txt) | head; exit 1; fi
COMMIT=$(git rev-parse --short HEAD)
while IFS= read -r f; do [ -n "$f" ] || continue; mkdir -p "$OUT/$(dirname "$f")"; cp "$f" "$OUT/$f"; done < scripts/site-files.txt
[ -d site-extras ] && cp -r site-extras/. "$OUT/"
mkdir -p "$OUT/downloads"
node scripts/build-review-test.mjs "$OUT" > /dev/null
# the app's service worker names this deploy, so phones fetch its files afresh
sed -i "s/__VERSION__/$COMMIT/" "$OUT/sw.js"
printf '{"commit":"%s","deployedAt":"%s"}\n' "$COMMIT" "$(date -u +%Y-%m-%dT%H:%MZ)" > "$OUT/version.json"
# the learning database's tables, before the code that needs them
(source scripts/learn-env.sh && node scripts/learn-migrate.mjs)
if find "$OUT" -ipath '*clips*' -o -iname 'test.mp4' -o -iname 'pub*.html' | grep -q .; then echo "A test video or page got into the site: stopping"; exit 1; fi
(cd api && npm ci --silent --no-audit --no-fund)
TOKEN=$(az staticwebapp secrets list --name $SITE -g $RG --subscription $SUB --query properties.apiKey -o tsv | tr -d '\r')
swa deploy "$OUT" --api-location "$SRC/api" --api-language node --api-version 20 --env production --deployment-token "$TOKEN"
# what's live now
for i in 1 2 3 4 5 6; do LIVE=$(curl -s "https://brave-forest-022879f03.3.azurestaticapps.net/version.json?v=$RANDOM" || true); case "$LIVE" in *"$COMMIT"*) echo "Live: $COMMIT"; break;; esac; sleep 10; done
