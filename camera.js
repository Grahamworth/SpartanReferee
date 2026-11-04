// Camera station: set up where this phone sends its picture (the judging computer, YouTube, or both), then open
// the native camera screen (StationActivity in the Android app), which streams to both at once.
// The judging computer's details come from its connection page: the station's Larix QR code or link, or the RTMP
// address. Everything is kept on this phone only.
const $ = (id) => document.getElementById(id);
const STORE = 'sp_station';
const MAX_STATIONS = 12;

function toast(s) { const t = $('toast'); t.textContent = s; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600); }
const load = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } };
const save = (o) => { try { localStorage.setItem(STORE, JSON.stringify(o)); } catch { /* private mode */ } };

const cap = window.Capacitor;
const plugin = cap && cap.isNativePlatform && cap.isNativePlatform() && cap.getPlatform() === 'android'
  ? (cap.Plugins && cap.Plugins.Station) || (cap.registerPlugin && cap.registerPlugin('Station')) : null;

const isTs = (ip) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);

// The station's link → { hosts (in the order to try), port, station, user, pass }. From the Receiver app:
// "spartans://station?n=1&lan=192.168.1.5&ts=100.x.y.z&port=1935&user=…&pass=…" (direct first, then Tailscale).
// Also a Larix link ("larix://set/v1?conn[][url]=rtmp%3A…", every connection in it) or an RTMP address.
export function parseStationLink(text) {
  let s = (text || '').trim();
  if (!s) return null;
  if (/^spartans:\/\/station\?/i.test(s)) {
    const q = new URLSearchParams(s.slice(s.indexOf('?') + 1));
    const hosts = [...q.getAll('lan'), ...(q.get('ts') ? [q.get('ts')] : [])].filter((h) => /^[\w.-]+$/.test(h));
    const n = parseInt(q.get('n'), 10);
    if (!hosts.length || !(n > 0)) return null;
    return { hosts, port: q.get('port') || '1935', station: n, user: q.get('user') || '', pass: q.get('pass') || '' };
  }
  let urls = [s];
  if (/^larix:/i.test(s)) {
    urls = [];
    for (const [k, v] of new URLSearchParams(s.slice(s.indexOf('?') + 1))) if (/\[url\]$/.test(k) && /^rtmp/i.test(v)) urls.push(v);
  }
  let out = null;
  for (const u of urls) {
    const m = u.match(/^rtmps?:\/\/([^/:?\s]+)(?::(\d+))?\/live\/station(\d+)(?:\?(\S*))?/i);
    if (!m) continue;
    const q = new URLSearchParams(m[4] || '');
    if (!out) out = { hosts: [], port: m[2] || '1935', station: +m[3], user: q.get('user') || '', pass: q.get('pass') || '' };
    out.hosts.push(m[1]);
  }
  if (out) out.hosts.sort((a, b) => isTs(a) - isTs(b));   // direct before Tailscale
  return out;
}
// one address per route, in order; the camera screen tries the next when one won't connect
const judgeUrls = (c) => c.hosts.map((h) => `rtmp://${h}:${c.port}/live/station${c.station}${c.user ? `?user=${encodeURIComponent(c.user)}&pass=${encodeURIComponent(c.pass)}` : ''}`);
const ytUrl = (key) => `rtmps://a.rtmps.youtube.com/live2/${key}`;

let S = load();
if (S.judge && S.judge.host && !S.judge.hosts) S.judge.hosts = [S.judge.host];   // saved before routes
function render() {
  const c = S.judge;
  $('judgeSummary').innerHTML = c
    ? `Station <b>${c.station}</b>${c.user ? ' · password set' : ''}<br>${c.hosts.map((h, i) => `${i ? 'then ' : 'Tries '}${isTs(h) ? '<span class="ok">Tailscale</span>' : 'direct (same Wi-Fi)'} <b>${h}</b>`).join('<br>')}`
    : 'No station set yet: scan the QR code or paste the link.';
  $('station').value = c ? String(c.station) : '1';
  $('judgeOn').checked = S.judgeOn !== false;
  $('ytOn').checked = !!S.ytOn;
  $('ytKey').value = S.ytKey || '';
  $('ytFields').hidden = !S.ytOn;
  if (S.quality) $('quality').value = S.quality;
}
function setLink(text) {
  const c = parseStationLink(text);
  if (!c) { toast("That isn't a station link: use the QR code or RTMP address from the connection details page"); return false; }
  S.judge = c; S.judgeOn = true; save(S); render();
  toast(`Station ${c.station} set`);
  return true;
}

$('station').innerHTML = Array.from({ length: MAX_STATIONS }, (_, i) => `<option value="${i + 1}">Station ${i + 1}</option>`).join('');
$('station').onchange = () => { if (S.judge) { S.judge.station = +$('station').value; save(S); render(); } };
$('link').onchange = () => { if ($('link').value.trim()) setLink($('link').value); };
$('judgeOn').onchange = () => { S.judgeOn = $('judgeOn').checked; save(S); };
$('ytOn').onchange = () => { S.ytOn = $('ytOn').checked; save(S); render(); };
$('ytKey').onchange = () => { S.ytKey = $('ytKey').value.trim(); save(S); };
$('quality').onchange = () => { S.quality = $('quality').value; save(S); };

// ---- scanning the station's QR code (the Larix one on the connection page works)
let scanStream = null;
async function scan() {
  try { scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); }
  catch { toast('The camera is needed to scan: allow it, or paste the link instead'); return; }
  const v = $('scanVideo'); v.srcObject = scanStream; await v.play();
  $('scanBox').hidden = false;
  const detector = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
  const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
  const look = async () => {
    if (!scanStream) return;
    let text = null;
    try {
      if (detector) { const r = await detector.detect(v); if (r[0]) text = r[0].rawValue; }
      else if (window.jsQR && v.videoWidth) {
        cv.width = v.videoWidth; cv.height = v.videoHeight; cx.drawImage(v, 0, 0);
        const r = window.jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height);
        if (r) text = r.data;
      }
    } catch { /* keep looking */ }
    if (text && parseStationLink(text)) { stopScan(); if (setLink(text) && plugin) setTimeout(() => $('goForm').requestSubmit(), 300); return; }
    setTimeout(look, 250);
  };
  look();
}
function stopScan() { if (scanStream) scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; $('scanBox').hidden = true; }
$('scanBtn').onclick = scan;
$('scanClose').onclick = stopScan;

// ---- open the camera screen
$('goForm').onsubmit = async (e) => {
  e.preventDefault();
  S.ytKey = $('ytKey').value.trim(); save(S);
  const toJudge = S.judgeOn !== false && S.judge, toYt = S.ytOn && S.ytKey;
  if (S.ytOn && !/^[\w-]{4,}$/.test(S.ytKey || '')) { toast('Paste the YouTube stream key first'); return; }
  if (!toJudge && !toYt) { toast('Set the judging computer or YouTube (or both) first'); return; }
  if (!plugin) { $('notApp').hidden = false; $('notApp').scrollIntoView({ behavior: 'smooth' }); return; }
  const [height, bitrate] = $('quality').value.split(':').map(Number);
  try {
    await plugin.open({
      judge: toJudge ? judgeUrls(S.judge).join('|') : '', youtube: toYt ? ytUrl(S.ytKey) : '',
      label: toJudge ? `Station ${S.judge.station}` : 'YouTube live', height, bitrate,
    });
  } catch (err) { toast(`Couldn't open the camera: ${err.message || err}`); }
};

if (!plugin) $('notApp').hidden = false;
render();
