'use strict';
// This computer's addresses as the phones see them: on Tailscale (100.64.0.0/10: the usual route, any Wi-Fi or 4G)
// and on the local network (same Wi-Fi / hotspot). Also the links the phones scan.
const os = require('os');

const isTailscale = (ip) => { const [a, b] = ip.split('.').map(Number); return a === 100 && b >= 64 && b <= 127; };
const isPrivate = (ip) => /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
// virtual adapters that phones can't reach (Hyper-V, WSL, VirtualBox, VMware, Docker)
const isVirtual = (name) => /vEthernet|WSL|VirtualBox|VMware|Docker|Loopback|Hyper-V/i.test(name);

function addresses() {
  const lan = [], tailscale = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (isTailscale(a.address)) tailscale.push(a.address);
      else if (isPrivate(a.address) && !isVirtual(name)) lan.push({ ip: a.address, name });
    }
  }
  // Wi-Fi / Ethernet first, a phone hotspot or anything else after
  lan.sort((x, y) => rank(x.name) - rank(y.name));
  return { lan: lan.map((x) => x.ip), lanNames: lan.map((x) => x.name), tailscale: tailscale[0] || null };
}
const rank = (n) => (/wi-?fi|wlan|wireless/i.test(n) ? 0 : /ethernet/i.test(n) ? 1 : 2);

/** The routes a phone can use: Tailscale first (works from anywhere), then direct (each local address). */
function routes(addr) {
  return [...(addr.tailscale ? [{ kind: 'tailscale', ip: addr.tailscale }] : []), ...addr.lan.map((ip) => ({ kind: 'direct', ip }))];
}

// over Tailscale no password is needed (see config.js), so the link has nothing after a '&' to lose
const rtmp = (ip, n, cfg) => `rtmp://${ip}:${cfg.rtmpPort}/live/station${n}${cfg.password && !isTailscale(ip) ? `?user=larix&pass=${cfg.password}` : ''}`;

/** What the Spartans app scans: every route, so it can go direct first and fall back to Tailscale by itself. */
function spartansLink(addr, n, cfg) {
  const q = new URLSearchParams({ n: String(n), port: String(cfg.rtmpPort) });
  for (const ip of addr.lan) q.append('lan', ip);
  if (addr.tailscale) q.set('ts', addr.tailscale);
  if (cfg.password) { q.set('user', 'larix'); q.set('pass', cfg.password); }
  return `spartans://station?${q}`;
}

/** What Larix scans: the laptop (over Tailscale when this computer has it, otherwise the same Wi-Fi) and, when the
 *  camera has a YouTube key, YouTube too: both active, each on its own connection, so one failing doesn't stop the
 *  other. Also the video settings, 1 s keyframes (for precise replay), and a backup recording on the phone. */
function larixLink(addr, n, cfg) {
  const r = routes(addr)[0];
  const conns = [];
  const shown = n + (cfg.firstCamera || 1) - 1;
  if (r) conns.push({ url: rtmp(r.ip, n, cfg), name: `Camera ${shown} to laptop` });
  const key = (cfg.youtube || {})[n];
  if (key) conns.push({ url: `rtmp://a.rtmp.youtube.com/live2/${key}`, name: `Camera ${shown} to YouTube` });
  const q = conns.map((c) => [
    `conn[][url]=${encodeURIComponent(c.url)}`, `conn[][name]=${encodeURIComponent(c.name)}`,
    'conn[][mode]=av', 'conn[][active]=on', 'conn[][overwrite]=on',
  ].join('&'));
  const enc = [
    'enc[vid][res]=1280x720', 'enc[vid][fps]=30', `enc[vid][bitrate]=${cfg.bitrate || 3500}`, 'enc[vid][keyframe]=1',
    'enc[vid][format]=avc', 'enc[vid][orientation]=landscape', 'enc[adv][max_conn]=3', 'enc[record][enabled]=on',
  ];
  return `larix://set/v1?${[...q, ...enc].join('&')}`;
}

module.exports = { addresses, routes, rtmp, spartansLink, larixLink, isTailscale };
