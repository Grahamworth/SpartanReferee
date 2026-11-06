'use strict';
// HeadJudge Receiver: the judging computer's one app. (Inside, it's still "Burpee Judge Receiver": the install folder, saved
// settings and recordings, and firewall rules all follow that name, so changing it would strand them.) It runs the streaming server (MediaMTX, hidden inside),
// sets up Tailscale and the firewall, shows each camera's QR code for the phones, which cameras are live and by
// which route, opens the Burpee Judge on a camera, keeps the recordings, and serves the review page (live view,
// incident marks, and replay of the recordings by time) to this computer and to an iPad.
const { app, BrowserWindow, WebContentsView, ipcMain, protocol, net, shell, clipboard, Tray, Menu, nativeImage, Notification } = require('electron');
const { spawn, execFile, execFileSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const QRCode = require('qrcode');
const { loadSettings, saveSettings, mediamtxYaml } = require('./config');
const { addresses, routes, rtmp, spartansLink, larixLink, isTailscale } = require('./network');
const { createCloud } = require('./cloud');

// Testing on the building laptop: RECEIVER_BIND=127.0.0.1 keeps the servers to this computer (no firewall prompt).
const BIND = process.env.RECEIVER_BIND || '';
// testing: RECEIVER_DATA keeps the settings, recordings and the one-copy lock apart from an installed copy
if (process.env.RECEIVER_DATA) app.setPath('userData', process.env.RECEIVER_DATA);
const DATA = app.getPath('userData');
// one copy only: a second start brings the first to the front and starts nothing of its own
const FIRST_COPY = app.requestSingleInstanceLock();
// the AI judges in the video review keep judging when its window is minimised or behind another (Chromium would
// otherwise pause their videos and slow their timers)
app.commandLine.appendSwitch('disable-background-media-suspend');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'BackgroundVideoTrackOptimization');
if (!FIRST_COPY) app.exit(0);
// a value inside a single-quoted PowerShell string (a user name like O'Brien in a path)
const psq = (s) => String(s).replace(/'/g, "''");
const RECORDINGS = path.join(DATA, 'recordings');
const BIN = app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, 'bin');
const MTX = path.join(BIN, 'mediamtx.exe');
const ICON = path.join(__dirname, 'ui', 'icon.png');
const RULE = 'Burpee Judge Receiver', RULE_REVIEW = 'Burpee Judge Receiver (review page)';
const SITE = 'https://zealous-island-03d6db503.8.azurestaticapps.net';
const TS = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe');
const TS_APP = path.join(path.dirname(TS), 'tailscale-ipn.exe');
const TS_DOWNLOAD = 'https://tailscale.com/download/windows';
const CLOUD_API = process.env.RECEIVER_CLOUD_API || `${SITE}/api`;

let S = loadSettings(DATA);
const cloud = createCloud({ dir: RECORDINGS, stateFile: path.join(DATA, 'cloud-sent.json'), api: () => CLOUD_API, settings: () => S });
let mtx = null, mtxLog = [], stopping = false, win = null;

// ---------------------------------------------------------------- the streaming server
function startServer() {
  fs.mkdirSync(RECORDINGS, { recursive: true });
  fs.writeFileSync(path.join(DATA, 'mediamtx.yml'), mediamtxYaml(S, { recordDir: RECORDINGS, bind: BIND }));
  if (!fs.existsSync(MTX)) { log(`The streaming server is missing (${MTX}). Reinstall the app.`); return; }
  mtx = spawn(MTX, [path.join(DATA, 'mediamtx.yml')], { cwd: DATA, windowsHide: true });
  const take = (b) => String(b).split(/\r?\n/).filter(Boolean).forEach(log);
  mtx.stdout.on('data', take); mtx.stderr.on('data', take);
  mtx.on('exit', (code) => {
    log(`Streaming server stopped (${code}).`); mtx = null;
    if (!stopping) setTimeout(startServer, 2000);   // it shouldn't stop: start it again
  });
}
function restartServer() { stopServerNow(); startServer(); }
function log(line) { mtxLog.push(line.replace(/^\d{4}\/\d\d\/\d\d /, '')); if (mtxLog.length > 300) mtxLog.shift(); }

async function serverPaths() {
  try {
    const r = await fetch(`http://127.0.0.1:${S.apiPort}/v3/paths/list`, { signal: AbortSignal.timeout(1500) });
    const list = (await r.json()).items || [];
    const conns = await fetch(`http://127.0.0.1:${S.apiPort}/v3/rtmpconns/list`, { signal: AbortSignal.timeout(1500) }).then((x) => x.json()).then((j) => j.items || []).catch(() => []);
    return { ok: true, list, conns };
  } catch { return { ok: false, list: [], conns: [] }; }
}

// ---------------------------------------------------------------- the cameras now, and a log of when each came and went
const EVENTS = path.join(DATA, 'events.json'), MARKS = path.join(DATA, 'marks.json'), ATHLETES = path.join(DATA, 'athletes.json'), PICS = path.join(DATA, 'athlete-pics'), TRACKS = path.join(DATA, 'athlete-tracks');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; } };
let events = readJson(EVENTS), marks = readJson(MARKS), cams = [], wasLive = {};
const COUNTS = path.join(DATA, 'rep-counts.json');
let repCounts = readJson(COUNTS), countSaveT = null;
const saveCounts = () => { clearTimeout(countSaveT); countSaveT = setTimeout(() => fs.writeFile(COUNTS, JSON.stringify(repCounts), () => {}), 300); };
const NUMBERS = path.join(DATA, 'numbers-seen.json');
let numbersSeen = readJson(NUMBERS), numSaveT = null;
const saveNumbers = () => { clearTimeout(numSaveT); numSaveT = setTimeout(() => fs.writeFile(NUMBERS, JSON.stringify(numbersSeen), () => {}), 1000); };
// Everyone the AI judges track (live cameras and uploaded videos): one record per athlete, kept up to date as they go:
// their picture, number, first and last time seen (and seconds into an uploaded video), reps and no reps.
let athletes = readJson(ATHLETES).filter((a) => a && a.n), athleteSeq = athletes.reduce((m, a) => Math.max(m, a.n), 0), athletesRev = 1, athSaveT = null;
// an athlete's picture and their proof (skeleton and rep events, one JSON line each, for Watch)
const dropAthleteFiles = (n) => { fs.unlink(path.join(PICS, n + '.jpg'), () => {}); fs.unlink(path.join(TRACKS, n + '.jsonl'), () => {}); };
const saveAthletes = () => {
  athletesRev++;
  if (athletes.length > 5000) { for (const a of athletes.splice(0, athletes.length - 5000)) dropAthleteFiles(a.n); }
  clearTimeout(athSaveT); athSaveT = setTimeout(() => fs.writeFile(ATHLETES, JSON.stringify(athletes), () => {}), 1000);
};
// a live athlete's proof goes when the recording it's drawn on does
const pruneTracks = () => { const before = new Date(Date.now() - S.keepDays * 864e5).toISOString(); for (const a of athletes) if (a.src === 'live' && a.lastAt < before) fs.unlink(path.join(TRACKS, a.n + '.jsonl'), () => {}); };
const pruneNumbers = () => { const before = new Date(Date.now() - S.keepDays * 864e5).toISOString(); numbersSeen = numbersSeen.filter((x) => x.src === 'upload' || x.lastAt >= before); saveNumbers(); };
setTimeout(pruneTracks, 60000); setInterval(pruneTracks, 6 * 3600e3);
setTimeout(pruneNumbers, 60000); setInterval(pruneNumbers, 6 * 3600e3);
function athleteFor(b, at) {
  const src = b.src === 'upload' ? 'upload' : 'live', cam = Math.max(0, Math.min(99, +b.cam || 0)), video = String(b.video || '').replace(/[^\w.-]+/g, '_').slice(0, 140);
  const round = String(b.round || '').slice(0, 60), label = Math.max(0, Math.min(9999, +b.label || 0));
  let a = athletes.find((x) => x.src === src && x.cam === cam && x.video === video && x.round === round && x.label === label);
  if (!a) { a = { n: ++athleteSeq, src, cam, video, round, label, bib: '', firstAt: at, lastAt: at, reps: 0, noReps: 0, done: false, id: '', pic: false }; athletes.push(a); }
  return a;
}
const localDay = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// an uploaded video (the training folder), streamed with byte ranges so it can be played and seeked
function sendFileRange(req, res, file) {
  const size = fs.statSync(file).size, m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  const head = { 'Content-Type': /\.webm$/i.test(file) ? 'video/webm' : /\.mov$/i.test(file) ? 'video/quicktime' : 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (!m) { res.writeHead(200, { ...head, 'Content-Length': size }); return fs.createReadStream(file).pipe(res); }
  let a = m[1] ? +m[1] : size - +m[2], b = m[1] && m[2] ? +m[2] : size - 1;
  a = Math.max(0, a); b = Math.min(size - 1, b);
  if (!(m[1] || m[2]) || a > b || a >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
  res.writeHead(206, { ...head, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': b - a + 1 });
  fs.createReadStream(file, { start: a, end: b }).pipe(res);
}
const saveEvents = () => { if (events.length > 3000) events = events.slice(-3000); fs.writeFile(EVENTS, JSON.stringify(events), () => {}); };
const saveMarks = () => fs.writeFile(MARKS, JSON.stringify(marks), () => {});

async function watchCameras() {
  const srv = await serverPaths();
  cams = [];
  for (let n = 1; n <= S.stations; n++) {
    const p = srv.list.find((x) => x.name === `live/station${n}`);
    const conn = p && p.source && srv.conns.find((c) => c.id === p.source.id);
    const from = conn && conn.remoteAddr ? conn.remoteAddr.replace(/:\d+$/, '') : '';
    const video = p && (p.tracks2 || []).find((t) => t.codecProps && t.codecProps.width);
    const live = !!(p && p.ready);
    cams.push({ n, live, from, route: from ? (isTailscale(from) ? 'Tailscale' : 'direct') : '', video: video ? `${video.codecProps.width}×${video.codecProps.height}` : '', watchers: p ? (p.readers || []).length : 0 });
    if (srv.ok && live !== !!wasLive[n]) {
      events.push({ t: new Date().toISOString(), cam: n, type: live ? 'connected' : 'lost', route: live ? (from ? (isTailscale(from) ? 'Tailscale' : 'direct') : '') : '' });
      saveEvents();
    }
    if (srv.ok) wasLive[n] = live;
  }
  return srv.ok;
}
let serverOk = false;
if (FIRST_COPY) setInterval(async () => { serverOk = await watchCameras(); }, 1000);

// ---------------------------------------------------------------- Windows Firewall: let the phones (and the iPad) in
function ruleOk(name) {
  return new Promise((res) => execFile('netsh', ['advfirewall', 'firewall', 'show', 'rule', `name=${name}`], { windowsHide: true }, (err, out) => res(!err && /Enabled:\s+Yes/i.test(out))));
}
async function firewallOk() { return (await ruleOk(RULE)) && (await ruleOk(RULE_REVIEW)); }
function fixFirewall() {
  // the streaming server, from the local network (direct) and Tailscale; and this app's review page; Windows asks once
  const script = path.join(DATA, 'firewall.ps1');
  fs.writeFileSync(script, [
    `Remove-NetFirewallRule -DisplayName '${RULE}' -ErrorAction SilentlyContinue`,
    `New-NetFirewallRule -DisplayName '${RULE}' -Direction Inbound -Program '${psq(MTX)}' -Action Allow -Profile Any -RemoteAddress LocalSubnet,100.64.0.0/10 | Out-Null`,
    `Remove-NetFirewallRule -DisplayName '${RULE_REVIEW}' -ErrorAction SilentlyContinue`,
    `New-NetFirewallRule -DisplayName '${RULE_REVIEW}' -Direction Inbound -Program '${psq(process.execPath)}' -Protocol TCP -LocalPort ${S.reviewPort} -Action Allow -Profile Any -RemoteAddress LocalSubnet,100.64.0.0/10 | Out-Null`,
    // a "Block" rule Windows made when its own Allow box was cancelled would win over ours
    `Get-NetFirewallRule | Where-Object { ($_.DisplayName -like '*mediamtx*' -or $_.DisplayName -like '*Burpee Judge Receiver*') -and $_.Action -eq 'Block' } | Remove-NetFirewallRule`,
  ].join('\r\n'));
  return new Promise((res) => execFile('powershell.exe', ['-NoProfile', '-Command',
    `Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','"${script}"'`],
  { windowsHide: true }, () => res(firewallOk())));
}

// ---------------------------------------------------------------- the older script setup: its own server takes the ports
// The PowerShell kit (C:\ProgramData\BurpeeJudgeStreaming) starts another MediaMTX at log-in with a different
// password. It gets port 1935 first, so phones reach it instead of this app's server and are refused.
const OLD_DIR = path.join(process.env.ProgramData || 'C:\\ProgramData', 'BurpeeJudgeStreaming');
const OLD_EXE = path.join(OLD_DIR, 'mediamtx.exe');
const OLD_TASK = 'Burpee Judge streaming';
function otherServers() {
  // any MediaMTX running that isn't this app's own
  return new Promise((res) => execFile('powershell.exe', ['-NoProfile', '-Command', 'Get-Process mediamtx -ErrorAction SilentlyContinue | ForEach-Object { $_.Path }'],
    { windowsHide: true, timeout: 8000 }, (_e, out) => res(String(out || '').split(/\r?\n/).map((s) => s.trim()).filter((p) => p && path.resolve(p).toLowerCase() !== path.resolve(MTX).toLowerCase()))));
}
let oldCache = { at: 0, v: { installed: false, running: [] } };
async function oldServer() {
  if (Date.now() - oldCache.at < 10000) return oldCache.v;
  oldCache = { at: Date.now(), v: { installed: fs.existsSync(OLD_EXE), running: await otherServers() } };
  return oldCache.v;
}
function removeOldServer() {
  // stop it, take it out of log-in, its firewall rules and desktop shortcuts; its recordings stay where they are
  const script = path.join(DATA, 'remove-old.ps1');
  fs.writeFileSync(script, [
    `Get-Process mediamtx -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -ne '${psq(MTX)}' } | Stop-Process -Force -ErrorAction SilentlyContinue`,
    `Unregister-ScheduledTask -TaskName '${OLD_TASK}' -Confirm:$false -ErrorAction SilentlyContinue`,
    `Get-NetFirewallRule -Group '${OLD_TASK}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule`,
    `Get-ChildItem ([Environment]::GetFolderPath('CommonDesktopDirectory')) -Filter 'Streaming - *.lnk' -ErrorAction SilentlyContinue | Remove-Item -Force`,
    `if (Test-Path '${psq(OLD_EXE)}') { Rename-Item '${psq(OLD_EXE)}' 'mediamtx.exe.old' -ErrorAction SilentlyContinue }`,
  ].join('\r\n'));
  return new Promise((res) => execFile('powershell.exe', ['-NoProfile', '-Command',
    `Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','"${script}"'`],
  { windowsHide: true }, async () => { oldCache.at = 0; restartServer(); const o = await oldServer(); res(!o.installed && !o.running.length); }));
}

// ---------------------------------------------------------------- Tailscale on this computer: install, sign in, switch on
function tailscale() {
  if (!fs.existsSync(TS)) return Promise.resolve({ installed: false, phones: [] });
  return new Promise((res) => execFile(TS, ['status', '--json'], { windowsHide: true, timeout: 5000 }, (_err, out) => {
    try {
      const j = JSON.parse(out), self = j.Self || {}, me = (j.User || {})[self.UserID];
      const phones = Object.values(j.Peer || {}).filter((p) => /android|ios/i.test(p.OS || '')).map((p) => ({ name: p.HostName, os: p.OS, online: !!p.Online }));
      res({ installed: true, state: j.BackendState, account: me ? me.LoginName : '', phones });
    } catch { res({ installed: true, state: 'NotRunning', phones: [] }); }
  }));
}
let tsBusy = '';
function tailscaleInstall() {
  if (tsBusy) return Promise.resolve(false);
  tsBusy = 'Installing Tailscale…';
  // winget comes with Windows 10/11; Windows asks for permission. Without winget, the download page instead.
  return new Promise((res) => execFile('winget', ['install', '-e', '--id', 'Tailscale.Tailscale', '--silent', '--accept-package-agreements', '--accept-source-agreements'],
    { windowsHide: true, timeout: 10 * 60e3 }, (err) => {
      tsBusy = '';
      if (err && !fs.existsSync(TS)) { shell.openExternal('https://tailscale.com/download/windows'); return res(false); }
      res(tailscaleUp());
    }));
}
// Runs one Tailscale command that may print a sign-in link, and opens the link in the browser.
function tailscaleSignIn(args) {
  return new Promise((res) => {
    let said = '', opened = false;
    const p = spawn(TS, args, { windowsHide: true });
    const look = (b) => {
      said += b;
      const m = said.match(/https:\/\/login\.tailscale\.com\/\S+|To authenticate, visit:\s+(https:\/\/\S+)/);
      if (m && !opened) { opened = true; shell.openExternal(m[1] || m[0]); res({ ok: true }); }
    };
    p.stdout.on('data', look); p.stderr.on('data', look);
    p.on('error', (e) => res({ ok: false, error: e.message }));
    p.on('exit', (code) => res(code === 0 ? { ok: true } : { ok: false, error: said.trim().split('\n')[0].slice(0, 200) || `it stopped with code ${code}` }));
    setTimeout(() => res({ ok: false, error: 'it took too long to answer' }), 15000);
  });
}
async function tailscaleUp() {
  // signs in (opens the browser at Tailscale's sign-in page) or switches it on; --unattended keeps it running when
  // nobody is logged in to Windows
  if (tsBusy) return { ok: false };
  try { fs.writeFileSync(TS_OURS, ''); } catch { /* it just stays on at Quit */ }
  tsBusy = 'Opening Tailscale…';
  // its own app too, so there's always something to sign in with
  if (fs.existsSync(TS_APP)) { const a = spawn(TS_APP, [], { detached: true, stdio: 'ignore' }); a.on('error', () => {}); a.unref(); }
  let r = await tailscaleSignIn(['up', '--unattended']);
  // 'up' refuses if this computer's Tailscale settings differ from its flags; 'login' doesn't mind
  if (!r.ok) r = await tailscaleSignIn(['login']);
  tsBusy = '';
  return r;
}
// Switched on when this app opens and off again at Quit, but only if this app is what switched it on: one that was
// already connected may be in use for something else. The note is a file so it survives a crash.
const TS_OURS = path.join(DATA, 'tailscale-switched-on');
async function tailscaleOnStart() {
  const ts = await tailscale();
  if (ts.state === 'Stopped' || ts.state === 'NeedsLogin' || ts.state === 'NoState') tailscaleUp();
}
function tailscaleOffIfOurs() {
  if (BIND || !FIRST_COPY || !fs.existsSync(TS_OURS)) return;
  try { execFileSync(TS, ['down'], { windowsHide: true, stdio: 'ignore', timeout: 8000 }); } catch { /* already off */ }
  try { fs.rmSync(TS_OURS, { force: true }); } catch { /* next Quit tries again */ }
}
// A newer Tailscale shows in the window, and once as a Windows notification; the update itself is Tailscale's installer.
let tsLatest = '';
function checkTailscaleUpdate() {
  if (!fs.existsSync(TS)) return;
  execFile(TS, ['version', '--upstream', '--json'], { windowsHide: true, timeout: 15000 }, (_err, out) => {
    try {
      const v = JSON.parse(out), latest = String(v.upstream || '');
      const was = tsLatest;
      tsLatest = latest && newer(latest, v.majorMinorPatch) ? latest : '';
      if (tsLatest && tsLatest !== was && Notification.isSupported()) {
        const n = new Notification({ title: `Tailscale ${tsLatest} is available`, body: 'Click to download the update.', icon: ICON });
        n.on('click', () => shell.openExternal(TS_DOWNLOAD)); n.show();
      }
    } catch { /* offline: try again later */ }
  });
}

// ---------------------------------------------------------------- what the window shows
async function state() {
  const addr = addresses();
  const ts = await tailscale();
  const stations = [];
  for (const c of cams) {
    stations.push({
      ...c,
      spartans: await QRCode.toDataURL(spartansLink(addr, c.n, S), { margin: 1, width: 300 }),
      larix: await QRCode.toDataURL(larixLink(addr, c.n, S), { margin: 1, width: 300, errorCorrectionLevel: 'L' }),
      larixLink: larixLink(addr, c.n, S),
      youtube: !!(S.youtube || {})[c.n],
      addresses: routes(addr).map((r) => ({ kind: r.kind, url: rtmp(r.ip, c.n, S) })),
    });
  }
  const reviewHost = addr.tailscale || addr.lan[0];
  const review = reviewHost ? `http://${reviewHost}:${S.reviewPort}/` : '';
  return {
    server: serverOk, addr, stations, firewall: await firewallOk(), log: mtxLog.slice(-60),
    tailscale: { ...ts, busy: tsBusy, update: tsLatest },
    oldServer: await oldServer(),
    portBusy: mtxLog.slice(-40).some((l) => /address already in use|Only one usage of each socket/i.test(l)),
    phoneSetup: { url: `${SITE}/phone.html`, qr: await QRCode.toDataURL(`${SITE}/phone.html`, { margin: 1, width: 240 }) },
    review: { url: review, qr: review ? await QRCode.toDataURL(review, { margin: 1, width: 240 }) : '' },
    settings: { stations: S.stations, record: S.record, keepDays: S.keepDays }, cloud: { on: !!S.cloudOn, hasKey: !!S.cloudKey, ...cloud.status }, webrtcPort: S.webrtcPort, recordings: RECORDINGS, testMode: !!BIND,
    version: app.getVersion(), update: { state: update.state, version: update.version, notes: update.notes, got: update.got, size: update.size, error: update.error },
  };
}

ipcMain.handle('state', state);
ipcMain.handle('fixFirewall', fixFirewall);
ipcMain.handle('removeOldServer', removeOldServer);
ipcMain.handle('tailscaleInstall', tailscaleInstall);
ipcMain.handle('tailscaleUp', tailscaleUp);
ipcMain.handle('openRecordings', () => shell.openPath(RECORDINGS));
ipcMain.handle('copy', (_e, text) => clipboard.writeText(String(text)));
ipcMain.handle('tailscaleSite', () => shell.openExternal(TS_DOWNLOAD));
ipcMain.handle('settings', (_e, v) => {
  S = { ...S, stations: Math.max(1, Math.min(12, +v.stations || S.stations)), record: !!v.record, keepDays: Math.max(1, Math.min(90, +v.keepDays || S.keepDays)) };
  saveSettings(DATA, S); restartServer(); return true;
});
// one more camera, with no server restart: the server takes any station's stream, so the live ones carry on
// cloud backup: only recordings made from now on go up, and the key is never sent back to the window
ipcMain.handle('cloud', async (_e, v) => {
  const key = typeof v.key === 'string' ? v.key.trim().slice(0, 100) : S.cloudKey;
  const on = !!v.on && !!key;
  S = { ...S, cloudKey: key, cloudOn: on, cloudSince: on && !S.cloudOn ? Date.now() : S.cloudSince };
  saveSettings(DATA, S); cloud.tick().catch(() => {}); return true;
});
ipcMain.handle('addCamera', async () => {
  if (S.stations < 12) { S = { ...S, stations: S.stations + 1 }; saveSettings(DATA, S); serverOk = await watchCameras(); }
  return S.stations;
});
ipcMain.handle('youtube', (_e, n, key) => {
  S.youtube = { ...(S.youtube || {}) };
  const k = String(key || '').trim().replace(/^rtmps?:\/\/[^/]+\/live2\//, '');
  if (k) S.youtube[n] = k; else delete S.youtube[n];
  saveSettings(DATA, S); return true;
});
ipcMain.handle('judge', (_e, n) => openJudge(+n));
ipcMain.handle('judgeSettings', () => openJudgeSettings());
ipcMain.handle('review', (_e, n) => openReview(+n || 0));
ipcMain.handle('tab', (_e, name) => showTab(name === 'review' ? 'review' : 'setup'));
ipcMain.handle('checkUpdate', () => checkUpdate(true));
ipcMain.handle('installUpdate', () => installUpdate());

// ---------------------------------------------------------------- the Burpee Judge, built in (served as app://site/…)
function openJudge(n) {
  const w = new BrowserWindow({ width: 1280, height: 800, title: `HeadJudge – camera ${n}`, backgroundColor: '#0b0b0b', autoHideMenuBar: true });
  const stream = `http://127.0.0.1:${S.webrtcPort}/live/station${n}/whep`;
  w.loadURL(`http://127.0.0.1:${S.reviewPort}/judge/judge.html?stream=${encodeURIComponent(stream)}&go=1`);
}
// the judge's own home screen: exercise, strictness, pose model and the rest. Kept by this app, so every camera's
// judge window uses them.
function openJudgeSettings() {
  const w = new BrowserWindow({ width: 1100, height: 860, title: 'HeadJudge – settings', backgroundColor: '#1f2328', autoHideMenuBar: true });
  w.loadURL(`http://127.0.0.1:${S.reviewPort}/judge/judge.html?settings=1`);
}
// Video review is a tab of the main window, under its tab bar. Going back to Setup only moves it aside, so its AI
// judges carry on. Opening a camera shows that camera big on the Live tab.
const TAB_BAR = 44;   // ui.css: #appTabs
let reviewView = null, reviewOn = false;
function placeReview() {
  if (!win || !reviewView) return;
  const [width, height] = win.getContentSize();
  // on Setup it slides down with one pixel showing: fully hidden, its frame loop nearly stops and the judges miss reps
  reviewView.setBounds({ x: 0, y: reviewOn ? TAB_BAR : height - 1, width, height: Math.max(0, height - TAB_BAR) });
}
function showTab(name, n = 0) {
  if (!win) return;
  if (name === 'review' && !reviewView) {
    reviewView = new WebContentsView({ webPreferences: { backgroundThrottling: false } });
    reviewView.setBackgroundColor('#1f2328');
    win.contentView.addChildView(reviewView);
    placeReview();
    reviewView.webContents.loadURL(`http://127.0.0.1:${S.reviewPort}/?device=Laptop${n ? `&focus=${n}` : ''}`);
  } else if (name === 'review' && n) reviewView.webContents.executeJavaScript(`window.focusCamera && window.focusCamera(${n})`).catch(() => {});
  reviewOn = name === 'review';
  placeReview();
  if (reviewOn) reviewView.webContents.focus(); else win.webContents.focus();
  win.webContents.send('tab', name);
}
function openReview(n = 0) { showWindow(); showTab('review', n); }

// ---------------------------------------------------------------- the review page's server (this computer and the iPad)
// Serves review/ and: the cameras and their history, incident marks, the recordings' time ranges, and clips cut from
// the recordings by time. Clips are read from the recorded files, so replay never interrupts recording or the judge.
const REVIEW = path.join(__dirname, 'review');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };
const SITE_DIR = path.join(__dirname, 'site');   // the Burpee Judge, with its engines and models built in
const clipCache = new Map();   // the last few clips, kept whole so the iPad can seek in them (Safari needs ranges)

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e5) { req.destroy(); ok(null); } }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); req.on('error', () => ok(null)); });
// marks only from this page's own scripts: a JSON request (another website can't send one without asking first)
const isJson = (req) => /^application\/json\b/i.test(req.headers['content-type'] || '');

const clipLoading = new Map();
const CLIP_CACHE_BYTES = 400e6;
async function clip(cam, start, dur) {
  const key = `${cam}|${start}|${dur}`;
  if (clipCache.has(key)) return clipCache.get(key);
  if (clipLoading.has(key)) return clipLoading.get(key);
  if (clipLoading.size >= 6) throw new Error('Busy cutting other clips: try again in a moment');
  const p = loadClip(cam, start, dur, key).finally(() => clipLoading.delete(key));
  clipLoading.set(key, p);
  return p;
}
async function loadClip(cam, start, dur, key) {
  const u = `http://127.0.0.1:${S.playbackPort}/get?path=live/station${cam}&start=${encodeURIComponent(start)}&duration=${dur}&format=mp4`;
  const r = await fetch(u, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(r.status === 404 ? 'No recording at that time' : `Recording not available (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  clipCache.set(key, buf);
  let total = 0; for (const b of clipCache.values()) total += b.length;
  while (clipCache.size > 1 && total > CLIP_CACHE_BYTES) { const k = clipCache.keys().next().value; total -= clipCache.get(k).length; clipCache.delete(k); }
  return buf;
}
function sendRange(req, res, buf, name) {
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  const head = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (name) head['Content-Disposition'] = `attachment; filename="${name}"`;
  if (!m) { res.writeHead(200, { ...head, 'Content-Length': buf.length }); return res.end(buf); }
  let a = m[1] ? +m[1] : buf.length - +m[2], b = m[1] && m[2] ? +m[2] : buf.length - 1;
  a = Math.max(0, a); b = Math.min(buf.length - 1, b);
  if (!(m[1] || m[2]) || a > b || a >= buf.length) { res.writeHead(416, { 'Content-Range': `bytes */${buf.length}` }); return res.end(); }
  res.writeHead(206, { ...head, 'Content-Range': `bytes ${a}-${b}/${buf.length}`, 'Content-Length': b - a + 1 });
  res.end(buf.subarray(a, b + 1));
}

const reviewServer = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    if (p === '/api/state') {
      return send(res, 200, { now: new Date().toISOString(), webrtcPort: S.webrtcPort, cams, marks: marks.slice(-300), events: events.slice(-300), athletesRev, record: S.record, keepDays: S.keepDays });
    }
    if (p === '/api/mark' && (req.method === 'POST' || req.method === 'PATCH') && !isJson(req)) return send(res, 415, { error: 'JSON only' });
    if (p === '/api/mark' && req.method === 'POST') {
      const b = await readBody(req); if (!b) return send(res, 413, { error: 'too big' });
      const t = b.t && !isNaN(Date.parse(b.t)) ? new Date(b.t).toISOString() : new Date().toISOString();
      const m = { id: crypto.randomBytes(5).toString('hex'), t, note: String(b.note || '').slice(0, 200), by: String(b.by || '').slice(0, 40), cam: +b.cam || 0 };
      marks.push(m); if (marks.length > 5000) marks = marks.slice(-5000); saveMarks(); return send(res, 200, m);
    }
    if (p === '/api/mark' && req.method === 'PATCH') {
      const b = await readBody(req); if (!b) return send(res, 413, { error: 'too big' }); const m = marks.find((x) => x.id === b.id);
      if (!m) return send(res, 404, { error: 'not found' });
      if (b.note !== undefined) m.note = String(b.note).slice(0, 200);
      if (b.delete) marks = marks.filter((x) => x !== m);
      saveMarks(); return send(res, 200, m);
    }
    if (p === '/api/upload' && req.method === 'POST') {
      // an uploaded test video: kept in the training folder (the review page plays it from the viewer's own copy)
      const dir = path.join(DATA, 'training'); fs.mkdirSync(dir, { recursive: true });
      const name = `${new Date().toISOString().replace(/[:.]/g, '-')}_${String(u.searchParams.get('name') || 'video').replace(/[^\w.-]+/g, '_').slice(-80)}`;
      let used = 0; try { for (const f of fs.readdirSync(dir)) used += fs.statSync(path.join(dir, f)).size; } catch { /* empty */ }
      if (used > 50e9) return send(res, 507, { error: 'The training folder is full (50 GB)' });
      const file = path.join(dir, name), out = fs.createWriteStream(file); let size = 0, done = false;
      const fail = (code, msg) => { if (done) return; done = true; out.destroy(); fs.unlink(file, () => {}); send(res, code, { error: msg }); };
      req.on('data', (c) => { size += c.length; if (size > 2e9) { req.unpipe(out); req.destroy(); fail(413, 'Videos up to 2 GB'); } });
      req.on('aborted', () => fail(400, 'Upload cut off'));
      req.pipe(out); out.on('finish', () => { if (!done) { done = true; send(res, 200, { saved: name, size }); } }); out.on('error', (e) => fail(500, e.message));
      return;
    }
    if (p === '/api/athlete' && req.method === 'POST') {
      if (!isJson(req)) return send(res, 415, { error: 'JSON only' });
      const b = await readBody(req); if (!b) return send(res, 413, { error: 'too big' });
      const at = !isNaN(Date.parse(b.at)) ? new Date(b.at).toISOString() : new Date().toISOString();
      const a = athleteFor(b, at);
      if (at < a.firstAt) a.firstAt = at;
      if (at > a.lastAt) a.lastAt = at;
      if (Number.isFinite(+b.t) && b.t !== null && b.t !== '') { const t = +b.t; if (a.firstT == null || t < a.firstT) a.firstT = t; if (a.lastT == null || t > a.lastT) a.lastT = t; }
      if (b.bib) a.bib = String(b.bib).slice(0, 12);
      if (Number.isFinite(+b.reps) && b.reps != null) a.reps = Math.max(0, +b.reps | 0);
      if (Number.isFinite(+b.noReps) && b.noReps != null) a.noReps = Math.max(0, +b.noReps | 0);
      if (Number.isFinite(+b.questionable) && b.questionable != null) a.questionable = Math.max(0, +b.questionable | 0);
      if (b.firstAt && !isNaN(Date.parse(b.firstAt)) && new Date(b.firstAt).toISOString() < a.firstAt) a.firstAt = new Date(b.firstAt).toISOString();
      if (b.lastAt && !isNaN(Date.parse(b.lastAt)) && new Date(b.lastAt).toISOString() > a.lastAt) a.lastAt = new Date(b.lastAt).toISOString();
      if (b.box && [b.box.x, b.box.y].every((v) => Number.isFinite(+v))) { a.box = { x: +(+b.box.x).toFixed(4), y: +(+b.box.y).toFixed(4) }; a.boxAt = at; if (Number.isFinite(+b.t)) a.boxT = +b.t; }
      if (b.done) { a.done = true; a.id = String(b.id || '').slice(0, 80); }
      const pic = typeof b.pic === 'string' && /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(b.pic);
      if (pic) { fs.mkdirSync(PICS, { recursive: true }); fs.writeFile(path.join(PICS, a.n + '.jpg'), Buffer.from(pic[1], 'base64'), () => {}); a.pic = Date.now(); }
      saveAthletes(); return send(res, 200, { ok: true, n: a.n });
    }
    // the proof of an athlete's count, added to as they're judged
    if (p === '/api/athlete-track' && req.method === 'POST') {
      if (!isJson(req)) return send(res, 415, { error: 'JSON only' });
      const b = await readBody(req); if (!b) return send(res, 413, { error: 'too big' });
      const known = athletes.length, a = athleteFor(b, !isNaN(Date.parse(b.at)) ? new Date(b.at).toISOString() : new Date().toISOString());
      if (athletes.length !== known) saveAthletes();
      const num = (v) => (v == null || !Number.isFinite(+v) ? null : Math.round(+v));
      const lines = [];
      for (const f of Array.isArray(b.frames) ? b.frames : []) if (Array.isArray(f) && f.length === 40 && f.every((v) => Number.isFinite(v))) lines.push(JSON.stringify({ f: f.map(Math.round) }));
      for (const e of Array.isArray(b.events) ? b.events : []) if (e && (e.type === 'rep' || e.type === 'norep') && num(e.t) != null) lines.push(JSON.stringify({ e: { type: e.type, assumed: (Array.isArray(e.assumed) ? e.assumed : []).filter((x) => ['feet', 'hands', 'hips', 'chest'].includes(x)), count: num(e.count) || 0, t: num(e.t), from: num(e.from), reasons: (Array.isArray(e.reasons) ? e.reasons : []).slice(0, 8).map((r) => String(r).slice(0, 120)) } }));
      if (lines.length) { fs.mkdirSync(TRACKS, { recursive: true }); fs.appendFile(path.join(TRACKS, a.n + '.jsonl'), lines.join('\n') + '\n', () => {}); }
      return send(res, 200, { ok: true, n: a.n });
    }
    if (p === '/api/athlete-track') {
      const out = { frames: [], events: [] };
      let text = ''; try { text = await fs.promises.readFile(path.join(TRACKS, (+u.searchParams.get('n') | 0) + '.jsonl'), 'utf8'); } catch { return send(res, 200, out); }
      for (const l of text.split('\n')) { if (!l) continue; try { const o = JSON.parse(l); if (o.f) out.frames.push(o.f); else if (o.e) out.events.push(o.e); } catch { /* cut short */ } }
      out.frames.sort((x, y) => x[0] - y[0]); out.events.sort((x, y) => x.t - y.t);
      return send(res, 200, out);
    }
    // reps counted by hand, to measure the AI judge against (the review's Count reps)
    if (p === '/api/counts' && req.method === 'GET') return send(res, 200, { counts: repCounts });
    if (p === '/api/counts' && req.method === 'POST') {
      if (!isJson(req)) return send(res, 415, { error: 'JSON only' });
      const b = await readBody(req); if (!b) return send(res, 413, { error: 'too big' });
      const video = path.basename(String(b.video || ''));
      if (!video || !fs.existsSync(path.join(DATA, 'training', video))) return send(res, 400, { error: 'That video isn\'t on the laptop' });
      const marks = (Array.isArray(b.marks) ? b.marks : []).filter((m) => m && (m.type === 'rep' || m.type === 'norep') && Number.isFinite(+m.t) && +m.t >= 0).slice(0, 5000).map((m) => ({ t: Math.round(+m.t), type: m.type }));
      const id = /^[\w-]{1,40}$/.test(String(b.id || '')) ? String(b.id) : crypto.randomBytes(5).toString('hex');
      const c = { id, video, name: String(b.name || 'Athlete').slice(0, 60), marks, at: new Date().toISOString() };
      repCounts = [...repCounts.filter((x) => x.id !== id), c]; saveCounts();
      return send(res, 200, c);
    }
    if (p === '/api/counts' && req.method === 'DELETE') { repCounts = repCounts.filter((x) => x.id !== u.searchParams.get('id')); saveCounts(); return send(res, 200, { ok: true }); }
    // an AI judge entry deleted (its picture too)
    if (p === '/api/athlete' && req.method === 'DELETE') {
      const n = +u.searchParams.get('n') | 0, i = athletes.findIndex((a) => a.n === n);
      if (i < 0) return send(res, 404, { error: 'not found' });
      athletes.splice(i, 1); dropAthleteFiles(n); saveAthletes();
      return send(res, 200, { ok: true });
    }
    // the athletes tracked between two times (the review's chosen day), newest first
    if (p === '/api/number-seen' && req.method === 'POST') {
      if (!isJson(req)) return send(res, 415, { error: 'JSON only' });
      const b = await readBody(req); if (!b) return send(res, 413, { error: 'too big' });
      const number = String(b.number || '').replace(/\D/g, '').slice(0, 12); if (!number) return send(res, 400, { error: 'no number' });
      const at = !isNaN(Date.parse(b.at)) ? new Date(b.at).toISOString() : new Date().toISOString();
      const src = b.src === 'upload' ? 'upload' : 'live', cam = Math.max(0, Math.min(99, +b.cam || 0)), video = String(b.video || '').replace(/[^\w.-]+/g, '_').slice(0, 140);
      const t = b.t != null && Number.isFinite(+b.t) ? +b.t : null;
      // still in view: the same sighting (20 seconds' grace, in the video's own time for an upload)
      const same = numbersSeen.findLast((x) => x.number === number && x.src === src && x.cam === cam && x.video === video);
      const near = same && (src === 'upload' ? t != null && same.lastT != null && t >= same.lastT && t - same.lastT <= 20 : Date.parse(at) - Date.parse(same.lastAt) <= 20000);
      if (near) { same.lastAt = at; same.lastT = t; }
      else { numbersSeen.push({ id: crypto.randomBytes(5).toString('hex'), number, src, cam, video, firstAt: at, lastAt: at, firstT: t, lastT: t }); if (numbersSeen.length > 5000) numbersSeen = numbersSeen.slice(-5000); athletesRev++; }
      saveNumbers(); return send(res, 200, { ok: true });
    }
    if (p === '/api/athletes') {
      const from = u.searchParams.get('from') || '', to = u.searchParams.get('to') || '9';
      return send(res, 200, { rev: athletesRev, list: athletes.filter((a) => a.lastAt >= from && a.firstAt <= to).slice(-2000).reverse(), numbers: numbersSeen.filter((x) => x.lastAt >= from && x.firstAt <= to) });
    }
    if (p === '/api/athlete-pic') {
      const file = path.join(PICS, (+u.searchParams.get('n') | 0) + '.jpg');
      if (!fs.existsSync(file)) return send(res, 404, 'none', 'text/plain');
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache' }); return fs.createReadStream(file).pipe(res);
    }
    // the days anything was recorded, tracked or uploaded (laptop time), newest first
    if (p === '/api/days') {
      const days = new Set([localDay(Date.now())]);
      for (const a of athletes) days.add(localDay(a.firstAt));
      for (const e of events) days.add(localDay(e.t));
      for (const c of cams) {
        const r = await fetch(`http://127.0.0.1:${S.playbackPort}/list?path=live/station${c.n}`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
        if (r && r.ok) for (const x of await r.json().catch(() => [])) days.add(localDay(x.start));
      }
      return send(res, 200, [...days].sort().reverse());
    }
    // uploaded videos: the list, and each one streamed
    // an uploaded video deleted, with the AI judge entries from it
    if (p === '/api/uploads' && req.method === 'DELETE') {
      const name = path.basename(String(u.searchParams.get('name') || '')), file = path.join(DATA, 'training', name);
      if (!name || !fs.existsSync(file)) return send(res, 404, { error: 'not found' });
      try { fs.unlinkSync(file); } catch (e) { return send(res, 409, { error: `It's in use: ${e.message}` }); }
      for (const a of athletes.filter((x) => x.src === 'upload' && x.video === name)) dropAthleteFiles(a.n);
      athletes = athletes.filter((x) => !(x.src === 'upload' && x.video === name)); saveAthletes();
      repCounts = repCounts.filter((x) => x.video !== name); saveCounts();
      numbersSeen = numbersSeen.filter((x) => !(x.src === 'upload' && x.video === name)); saveNumbers();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/uploads') {
      const dir = path.join(DATA, 'training'); let list = [];
      try { list = fs.readdirSync(dir).map((f) => ({ name: f, size: fs.statSync(path.join(dir, f)).size })).sort((a, b) => (a.name < b.name ? 1 : -1)); } catch { /* none yet */ }
      return send(res, 200, list);
    }
    if (p.startsWith('/uploads/')) {
      let rel; try { rel = decodeURIComponent(p.slice(9)); } catch { return send(res, 400, 'Bad address', 'text/plain'); }
      const dir = path.join(DATA, 'training'), file = path.join(dir, path.basename(rel));
      if (!fs.existsSync(file)) return send(res, 404, 'Not found', 'text/plain');
      return sendFileRange(req, res, file);
    }
    if (p === '/api/recorded') {
      const cam = +u.searchParams.get('cam');
      const r = await fetch(`http://127.0.0.1:${S.playbackPort}/list?path=live/station${cam}`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      return send(res, 200, r && r.ok ? (await r.json()).map((x) => ({ start: x.start, duration: x.duration })) : []);
    }
    if (p === '/clip') {
      const cam = +u.searchParams.get('cam'), start = u.searchParams.get('start');
      const dur = Math.max(1, Math.min(600, +u.searchParams.get('duration') || 60));
      if (!cam || isNaN(Date.parse(start))) return send(res, 400, { error: 'cam and start needed' });
      try {
        const buf = await clip(cam, new Date(start).toISOString(), dur);
        const name = u.searchParams.get('download') ? `camera${cam}_${start.replace(/[:.]/g, '-')}.mp4` : '';
        return sendRange(req, res, buf, name);
      } catch (e) { return send(res, 404, { error: e.message }); }
    }
    // the Burpee Judge (in the review page's AI judge tab, and its own windows): streamed, the models are large
    if (p.startsWith('/judge/')) {
      let rel; try { rel = decodeURIComponent(p.slice(7)); } catch { return send(res, 400, 'Bad address', 'text/plain'); }
      const file = path.normalize(path.join(SITE_DIR, rel || 'judge.html'));
      if (!file.startsWith(SITE_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': fs.statSync(file).size, 'Cache-Control': 'no-cache' });
      return fs.createReadStream(file).pipe(res);
    }
    // the page itself
    let relp; try { relp = p === '/' ? 'index.html' : decodeURIComponent(p); } catch { return send(res, 400, 'Bad address', 'text/plain'); }
    const file = path.normalize(path.join(REVIEW, relp));
    if (!file.startsWith(REVIEW + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
  } catch (e) { send(res, 500, { error: e.message }); }
});

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

if (FIRST_COPY) app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    const root = path.join(__dirname, u.host === 'site' ? 'site' : 'ui');
    const file = path.normalize(path.join(root, decodeURIComponent(u.pathname)));
    if (!file.startsWith(root)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  stopLeftovers();
  startServer();
  reviewServer.listen(S.reviewPort, BIND || '0.0.0.0');
  win = new BrowserWindow({
    width: 1200, height: 900, title: 'HeadJudge Receiver', backgroundColor: '#1f2328', autoHideMenuBar: true,
    icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadURL('app://ui/index.html');
  // the window's cross hides it to the tray (the streaming server, recordings and judges carry on); the tray's Quit
  // shuts everything down
  hideToTray(win);
  win.on('resize', placeReview);
  // Windows shutting down or signing out: let everything close
  require('electron').powerMonitor.on('shutdown', () => { stopping = true; app.quit(); });
  win.on('closed', () => { win = null; app.quit(); });
  makeTray();
  // updates: a check soon after starting, then every 6 hours
  setTimeout(checkUpdate, 5000); setInterval(checkUpdate, 6 * 3600e3);
  setInterval(() => cloud.tick().catch(() => {}), 60000);
  if (!BIND) { tailscaleOnStart(); setTimeout(checkTailscaleUpdate, 5000); setInterval(checkTailscaleUpdate, 6 * 3600e3); }
  // first start: let the phones and the iPad through the firewall straight away (Windows asks once)
  if (!BIND) setTimeout(async () => { if (!(await firewallOk())) fixFirewall(); }, 3000);
});

// ---------------------------------------------------------------- updates
// The site says which version is the latest (receiver-version.json, written when the installer is built). A newer
// one shows in the window, and once as a Windows notification. Update now: the installer is downloaded, checked
// against its SHA-512, then this app closes (stopping the streaming server) and the installer runs.
const UPDATE_URL = process.env.RECEIVER_UPDATE_URL || `${SITE}/receiver-version.json`;
let update = { state: 'idle' };   // idle, checking, none, offline, available, downloading, error
const newer = (a, b) => { const p = (v) => String(v).split('.').map((x) => parseInt(x, 10) || 0); const x = p(a), y = p(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
async function checkUpdate(asked) {
  if (update.state === 'downloading') return update;
  const was = update;
  if (asked) update = { ...was, state: 'checking' };
  try {
    const r = await fetch(UPDATE_URL, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(r.status);
    const m = await r.json();
    if (m.version && /^https:\/\//.test(m.url || '') && newer(m.version, app.getVersion())) {
      update = { state: 'available', version: String(m.version), notes: String(m.notes || '').slice(0, 400), url: m.url, sha512: m.sha512 || '', size: +m.size || 0 };
      if (was.version !== update.version && Notification.isSupported()) {
        const n = new Notification({ title: `HeadJudge Receiver ${update.version} is available`, body: 'Open the Receiver and press Update now.', icon: ICON });
        n.on('click', showWindow); n.show();
      }
    } else update = { state: 'none' };
  } catch { update = was.state === 'available' ? was : { state: 'offline' }; }
  return update;
}
async function installUpdate() {
  if (update.state !== 'available' && update.state !== 'error') return update;
  const want = { ...update, state: 'available', error: '' };
  update = { ...want, state: 'downloading', got: 0 };
  try {
    const r = await fetch(want.url, { signal: AbortSignal.timeout(30 * 60e3) });
    if (!r.ok) throw new Error(`download failed (${r.status})`);
    if (!want.size) update.size = +r.headers.get('content-length') || 0;
    const file = path.join(app.getPath('temp'), `burpee-judge-receiver-setup-${want.version.replace(/[^\d.]/g, '')}.exe`);
    const out = fs.createWriteStream(file), hash = crypto.createHash('sha512');
    for await (const chunk of r.body) {
      hash.update(chunk); update.got += chunk.length;
      if (!out.write(chunk)) await new Promise((ok) => out.once('drain', ok));
    }
    await new Promise((ok, no) => out.end((e) => (e ? no(e) : ok())));
    if (want.sha512 && hash.digest('base64') !== want.sha512) { fs.unlink(file, () => {}); throw new Error('the download was damaged: try again'); }
    // testing (RECEIVER_BIND): downloaded and checked, not installed
    if (BIND) { update = { ...want, state: 'error', error: 'test mode: downloaded and checked, not installed' }; return update; }
    // the installer takes over: this app closes first so its files (and the streaming server) are free
    spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 800);
    update = { ...want, state: 'installing' };
  } catch (e) { update = { ...want, state: 'error', error: e.message }; }
  return update;
}

// ---------------------------------------------------------------- the icon by the clock while it runs
let tray = null, trayTipShown = false;
// a window's cross hides it (until Quit): the first time, a note by the clock says where it went
function hideToTray(w) {
  w.on('close', (e) => {
    if (stopping) return;
    e.preventDefault(); w.hide();
    if (!trayTipShown && tray) { trayTipShown = true; tray.displayBalloon({ iconType: 'info', title: 'HeadJudge Receiver is still running', content: 'The streaming server, recordings and AI judges carry on. Right-click this icon and Quit to shut it down.' }); }
  });
}
function showWindow() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
function makeTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('HeadJudge Receiver (streaming server running)');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open HeadJudge Receiver', click: showWindow },
    { label: 'Video review', click: () => openReview() },
    { type: 'separator' },
    { label: 'Restart streaming server', click: () => { stopServerNow(); startServer(); } },
    { label: 'Check for updates', click: async () => { await checkUpdate(true); showWindow(); } },
    { label: 'Quit (stops the streaming server and judges)', click: () => app.quit() },
  ]));
  tray.on('click', showWindow);
}

// ---------------------------------------------------------------- stopping: nothing left running
// The server is killed with its whole process tree, straight away, so the next start is a clean one.
function stopServerNow() {
  if (!mtx) return;
  const p = mtx; mtx = null;
  p.removeAllListeners('exit');
  try { execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { try { p.kill(); } catch { /* already gone */ } }
}
// a copy of this app's server left over from a crash would hold the ports: stop it before starting
function stopLeftovers() {
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `Get-Process mediamtx -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${psq(MTX)}' } | Stop-Process -Force`], { windowsHide: true, stdio: 'ignore', timeout: 8000 });
  } catch { /* none */ }
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { stopping = true; stopServerNow(); tailscaleOffIfOurs(); if (tray) { tray.destroy(); tray = null; } });
// one copy only: a second start brings the first to the front
if (FIRST_COPY) app.on('second-instance', showWindow);
