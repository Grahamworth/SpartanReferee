'use strict';
// The receiver's settings (kept in the app's data folder) and the MediaMTX configuration written from them.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULTS = { stations: 2, rtmpPort: 1935, srtPort: 8890, webrtcPort: 8889, iceUdpPort: 8189, apiPort: 9997, playbackPort: 9996, reviewPort: 8800, record: true, keepDays: 14, bitrate: 3500, youtube: {} };

function loadSettings(dir) {
  const file = path.join(dir, 'settings.json');
  let s = {};
  try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  s = { ...DEFAULTS, ...s };
  if (!s.password) s.password = crypto.randomBytes(8).toString('base64url').replace(/[-_]/g, '').slice(0, 10).toLowerCase();
  saveSettings(dir, s);
  return s;
}
function saveSettings(dir, s) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(s, null, 2));
}

/** MediaMTX settings: phones publish (RTMP/SRT) with the password (over Tailscale, without); anyone may watch; this computer may use the API and
 *  the recordings (the review page reaches them through the app). */
function mediamtxYaml(s, { recordDir, bind = '' }) {
  const rec = recordDir.replace(/\\/g, '/');
  return `# Written by Spartans Receiver: change settings in the app, not here.
logLevel: info
logDestinations: [stdout]
api: true
apiAddress: 127.0.0.1:${s.apiPort}
rtsp: false
hls: false
moq: false
playback: true
playbackAddress: 127.0.0.1:${s.playbackPort}

rtmp: true
rtmpAddress: ${bind}:${s.rtmpPort}
srt: true
srtAddress: ${bind}:${s.srtPort}

webrtc: true
webrtcAddress: ${bind}:${s.webrtcPort}
webrtcAllowOrigins: ['*']
webrtcLocalUDPAddress: ${bind}:${s.iceUdpPort}
webrtcIPsFromInterfaces: true
webrtcICEServers2:
  - url: stun:stun.cloudflare.com:3478

authMethod: internal
authInternalUsers:
  - user: larix
    pass: ${s.password}
    ips: []
    permissions:
      - action: publish
        path:
  # phones on this laptop's own Tailscale network (only the owner's devices can reach it there) need no password:
  # a phone camera handing Larix its link can drop everything after the '&' in ?user=…&pass=…
  - user: any
    pass:
    ips: ['100.64.0.0/10']
    permissions:
      - action: publish
        path:
  - user: any
    pass:
    ips: []
    permissions:
      - action: read
        path:
  - user: any
    pass:
    ips: ['127.0.0.1', '::1']
    permissions:
      - action: api
        path:
      - action: playback
        path:
${s.record ? `
pathDefaults:
  record: yes
  recordPath: ${rec}/%path/%Y-%m-%d_%H-%M-%S-%f%z
  recordFormat: fmp4
  recordSegmentDuration: 10m
  recordDeleteAfter: ${s.keepDays}d
` : ''}
paths:
  all_others:
`;
}

module.exports = { loadSettings, saveSettings, mediamtxYaml };
