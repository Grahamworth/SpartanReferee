#!/usr/bin/env bash
# Each time the server starts: its settings from the details given when it was created (Azure's user data), the latest software, and the
# HTTPS front door for its address. A local file stands in for the user data when testing.
set -euo pipefail
CONF=/etc/headjudge/config.json; SEED=/etc/headjudge/seed.json
if [ ! -s "$SEED" ]; then
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS -m 5 -H Metadata:true "http://169.254.169.254/metadata/instance/compute/userData?api-version=2021-01-01&format=text" | base64 -d > "$SEED.new" && [ -s "$SEED.new" ]; then mv "$SEED.new" "$SEED"; break; fi
    sleep 5
  done
fi
[ -s "$SEED" ] || { echo "No settings were given to this server"; exit 1; }
chmod 600 "$SEED"

# the software: fetched fresh if it's offered, otherwise what's already here
URL=$(jq -r '.bundleUrl // empty' "$SEED")
if [ -n "$URL" ]; then
  if curl -fsSL -m 600 -o /tmp/headjudge.tar.gz "$URL"; then
    rm -rf /opt/headjudge.new; mkdir -p /opt/headjudge.new
    tar xzf /tmp/headjudge.tar.gz -C /opt/headjudge.new
    rm -rf /opt/headjudge.old; [ -d /opt/headjudge ] && mv /opt/headjudge /opt/headjudge.old; mv /opt/headjudge.new /opt/headjudge
    rm -f /tmp/headjudge.tar.gz
  else echo "Couldn't fetch the software: using what's here"; fi
fi

# this machine's public address, for the pictures to reach browsers by
IP=$(curl -fsS -m 5 -H Metadata:true "http://169.254.169.254/metadata/instance/network/interface/0/ipv4/ipAddress/0/publicIpAddress?api-version=2021-02-01&format=text" || true)
jq --arg ip "$IP" 'del(.bundleUrl) + { publicIp: (if $ip == "" then .host else $ip end), dataDir: "/var/lib/headjudge", mediamtx: "/usr/local/bin/mediamtx", chrome: "google-chrome", display: ":0" }' "$SEED" > "$CONF.new"
install -m 640 -o root -g headjudge "$CONF.new" "$CONF"; rm -f "$CONF.new"
chown -R headjudge:headjudge /var/lib/headjudge

HOST=$(jq -r '.host' "$SEED")
cat > /etc/caddy/Caddyfile <<EOF
$HOST {
  reverse_proxy 127.0.0.1:8800 {
    flush_interval -1
  }
}
EOF
systemctl reload-or-restart caddy
