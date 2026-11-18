'use strict';
// The streaming server's settings on the public internet. Phones send with the password. Watching only happens from this machine:
// the judges directly, and browsers through the login in index.js. Its picture reaches browsers over the ICE port, UDP where the
// venue allows it and TCP where it doesn't.
function mediamtxYaml(s, { recordDir, publicHost, viewBind = '127.0.0.1' }) {
  const rec = recordDir.replace(/\\/g, '/');
  return `# Written by SpartanReferee: changes here are lost when it restarts.
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
rtmpAddress: :${s.rtmpPort}
srt: true
srtAddress: :${s.srtPort}

webrtc: true
webrtcAddress: ${viewBind}:${s.webrtcPort}
webrtcAllowOrigins: ['*']
webrtcLocalUDPAddress: :${s.iceUdpPort}
webrtcLocalTCPAddress: :${s.iceUdpPort}
webrtcIPsFromInterfaces: false
webrtcAdditionalHosts: [${publicHost}, 127.0.0.1]
webrtcICEServers2: []

authMethod: internal
authInternalUsers:
  - user: larix
    pass: ${s.password}
    ips: []
    permissions:
      - action: publish
        path:
  - user: any
    pass:
    ips: ['127.0.0.1', '::1']
    permissions:
      - action: read
        path:
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
module.exports = { mediamtxYaml };
