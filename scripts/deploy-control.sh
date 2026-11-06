#!/usr/bin/env bash
# Publishes the control app: the small always-on app that starts, stops and watches customers' servers. It runs on a pay-per-use plan,
# about a minute's work a minute at most, which falls inside Azure's free allowance. Safe to run again.
set -euo pipefail
SUB=65c0ccca-69f7-43eb-9246-3bd6a6a06b24; RG=rg-headjudge-uksouth; APP=headjudge-control; SERVERS=rg-headjudge-servers; SITE=https://zealous-island-03d6db503.8.azurestaticapps.net
SRC="$(cd "$(dirname "$0")/.." && pwd)"; BUILD="${TEMP:-/tmp}/headjudge-control"
ARM="https://management.azure.com/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.Web/sites/$APP"
if ! az rest --method get --url "$ARM?api-version=2023-12-01" -o none 2>/dev/null; then
  az functionapp create -g $RG -n $APP --subscription HeadJudge --storage-account headjudge --consumption-plan-location uksouth --os-type Windows --runtime node --runtime-version 24 --functions-version 4 --disable-app-insights true --assign-identity '[system]' -o none --only-show-errors
fi
CONN=$(az storage account show-connection-string -n headjudge -g $RG --subscription $SUB -o tsv | tr -d '\r')
ACCOUNT_KEY=$(az storage account keys list --account-name headjudge -g $RG --subscription $SUB --query "[0].value" -o tsv | tr -d '\r')
# a link good for years: servers fetch their software with it each time they start
BUNDLE=$(az storage blob generate-sas --account-name headjudge --account-key "$ACCOUNT_KEY" -c downloads -n headjudge-server.tar.gz --permissions r --expiry 2028-11-02T19:58Z --https-only --full-uri -o tsv | tr -d '\r')
IMG=$(az sig image-definition show -g $SERVERS --gallery-name headjudge_gallery --gallery-image-definition receiver --subscription $SUB --query id -o tsv | tr -d '\r')
SUBNET=$(az network vnet subnet show -g $SERVERS --vnet-name hj-vnet -n servers --subscription $SUB --query id -o tsv | tr -d '\r')
NSG=$(az network nsg show -g $SERVERS -n hj-nsg --subscription $SUB --query id -o tsv | tr -d '\r')

# the settings go up through a file so that none of them ever appears on a command line or in a log
BODY=$(mktemp)
CONN="$CONN" BUNDLE="$BUNDLE" IMG="$IMG" SUBNET="$SUBNET" NSG="$NSG" SUB="$SUB" SERVERS="$SERVERS" SITE="$SITE" KEY="$(cat "$SRC/server/setup/fixed-login-key.pub")" node -e "
const e = process.env;
console.log(JSON.stringify({ properties: {
  FUNCTIONS_EXTENSION_VERSION: '~4', FUNCTIONS_WORKER_RUNTIME: 'node', WEBSITE_NODE_DEFAULT_VERSION: '~24',
  AzureWebJobsStorage: e.CONN, WEBSITE_CONTENTAZUREFILECONNECTIONSTRING: e.CONN, WEBSITE_CONTENTSHARE: 'headjudge-control',
  STORAGE_CONNECTION: e.CONN, SITE: e.SITE, BUNDLE_URL: e.BUNDLE,
  SERVERS_SUBSCRIPTION: e.SUB, SERVERS_GROUP: e.SERVERS, SERVERS_REGION: 'italynorth', SERVERS_IMAGE: e.IMG, SERVERS_SUBNET: e.SUBNET, SERVERS_NSG: e.NSG, SERVERS_SSH_KEY: e.KEY.trim(),
} }));
" > "$BODY"
az rest --method put --url "$ARM/config/appsettings?api-version=2023-12-01" --body "@$(cygpath -w "$BODY")" -o none
rm -f "$BODY"

node -e "require('fs').rmSync(process.argv[1], { recursive: true, force: true })" "$BUILD"
mkdir -p "$BUILD/src"
cp "$SRC/control/package.json" "$SRC/control/host.json" "$BUILD/"; cp "$SRC"/control/src/*.js "$BUILD/src/"
cp "$SRC/api/src/store.js" "$BUILD/src/store.js"
(cd "$BUILD" && npm install --omit=dev --silent --no-audit --no-fund)
ZIP="$(dirname "$BUILD")/headjudge-control.zip"
(cd "$BUILD" && powershell.exe -NoProfile -Command "Compress-Archive -Force -Path * -DestinationPath '$(cygpath -w "$ZIP")'")
TOKEN=$(az account get-access-token --subscription $SUB --query accessToken -o tsv | tr -d '\r')
for i in 1 2 3 4 5 6; do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 300 -X POST "https://$APP.scm.azurewebsites.net/api/zipdeploy" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/zip" --data-binary "@$ZIP")
  echo "publish: $CODE"; [ "$CODE" = "200" ] && break; sleep 20
done
az rest --method get --url "$ARM/functions?api-version=2023-12-01" --query "value[].name" -o tsv
