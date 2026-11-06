#!/usr/bin/env bash
# Prepares a fresh Ubuntu 22.04 graphics-card server (run once, as root): driver, Chrome, Node, streaming server, HTTPS, and the services
# that start HeadJudge. Everything comes from its maker's own download, with checksums checked where they publish them. Reboots at the end.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
MTX_VERSION="${MTX_VERSION:-v1.21.3}"; NODE_VERSION="${NODE_VERSION:-v22.14.0}"
HERE="$(cd "$(dirname "$0")" && pwd)"

apt-get -y -qq update
apt-get -y -qq install nvidia-driver-535 xserver-xorg-core xinit x11-xserver-utils libvulkan1 vulkan-tools curl ca-certificates debian-keyring debian-archive-keyring apt-transport-https jq >/dev/null

curl -fsSL -o /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
apt-get -y -qq install /tmp/chrome.deb >/dev/null

cd /tmp
curl -fsSLO "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz"
curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" | grep " node-$NODE_VERSION-linux-x64.tar.xz$" | sha256sum -c -
tar xJf "node-$NODE_VERSION-linux-x64.tar.xz" -C /usr/local --strip-components=1

Z="mediamtx_${MTX_VERSION}_linux_amd64.tar.gz"; B="https://github.com/bluenviron/mediamtx/releases/download/$MTX_VERSION"
curl -fsSLO "$B/$Z"; curl -fsSL "$B/checksums.sha256" | grep " \*\?$Z$" | sha256sum -c -
tar xzf "$Z" -C /usr/local/bin mediamtx

curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt-get -y -qq update; apt-get -y -qq install caddy >/dev/null

id headjudge >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/headjudge --shell /usr/sbin/nologin headjudge
usermod -aG video,render headjudge 2>/dev/null || true
mkdir -p /opt/headjudge /etc/headjudge
install -m 755 "$HERE/boot.sh" /usr/local/bin/headjudge-boot
install -m 755 "$HERE/display.sh" /usr/local/bin/headjudge-display
install -m 644 "$HERE/headjudge-boot.service" "$HERE/headjudge-display.service" "$HERE/headjudge.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable headjudge-boot headjudge-display headjudge caddy >/dev/null
echo 'install finished'
