#!/usr/bin/env bash
# Turns a prepared server (one that's had server/setup/install.sh) into the image customers' servers start from, so a new one takes minutes, not a
# reinstall. Everything personal to that machine is wiped first. The machine can't be used afterwards. Usage: make-server-image.sh <group> <vm> <ip> <ssh key> <version>
set -euo pipefail
GROUP="$1"; VM="$2"; IP="$3"; KEY="$4"; VERSION="$5"
SUB=65c0ccca-69f7-43eb-9246-3bd6a6a06b24; SERVERS=rg-headjudge-servers
ssh -i "$KEY" -o UserKnownHostsFile="${KNOWN:-/dev/null}" -o StrictHostKeyChecking=no "azureuser@$IP" 'sudo bash -s' <<'WIPE'
set -e
systemctl stop headjudge caddy headjudge-boot || true
pkill -9 ffmpeg || true; pkill -9 chrome || true
rm -rf /etc/headjudge/seed.json /etc/headjudge/config.json /var/lib/headjudge/* /var/lib/headjudge/.config /var/lib/headjudge/.cache /var/lib/caddy/.local /var/lib/caddy/.config /tmp/*
: > /etc/caddy/Caddyfile
journalctl --rotate >/dev/null 2>&1; journalctl --vacuum-time=1s >/dev/null 2>&1 || true
apt-get -y -qq clean
waagent -deprovision+user -force >/dev/null 2>&1
sync
WIPE
az vm deallocate -g "$GROUP" -n "$VM" --subscription $SUB -o none
az vm generalize -g "$GROUP" -n "$VM" --subscription $SUB -o none
ID=$(az vm show -g "$GROUP" -n "$VM" --subscription $SUB --query id -o tsv | tr -d '\r')
az sig image-version create -g $SERVERS --gallery-name headjudge_gallery --gallery-image-definition receiver --gallery-image-version "$VERSION" --subscription $SUB -l italynorth --virtual-machine "$ID" --storage-account-type Standard_LRS --replica-count 1 --target-regions italynorth=1=standard_lrs -o none --only-show-errors
az sig image-version show -g $SERVERS --gallery-name headjudge_gallery --gallery-image-definition receiver --gallery-image-version "$VERSION" --subscription $SUB --query "{v:name,state:provisioningState,gb:storageProfile.osDiskImage.sizeInGb}" -o tsv
