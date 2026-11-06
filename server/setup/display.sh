#!/usr/bin/env bash
# A screen that's only there for the graphics card: Chrome only uses the card fully when it has a display on it.
set -e
if [ ! -f /etc/X11/xorg.conf ]; then
  BUS=$(nvidia-xconfig --query-gpu-info | awk '/PCI BusID/{print $4; exit}')
  nvidia-xconfig -a --allow-empty-initial-configuration --virtual=1920x1080 --busid="$BUS" >/dev/null
fi
# only local programs can reach it (it doesn't listen on the network)
exec /usr/bin/Xorg :0 -noreset -ac -nolisten tcp
