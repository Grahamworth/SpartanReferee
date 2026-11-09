'use strict';
// HeadJudge's Receiver on a server: takes the phones' streams and records them, runs one AI judge per camera on the graphics card,
// and serves the review page, behind a login, to the company's own browsers. Settings come from a file written when the server was
// created (see config below); everything it keeps is in its data folder, and finished recordings go to cloud storage as well.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const QRCode = require('qrcode');
const { createReview, send, readBody, isJson } = require('./review-api');
const { createEngines } = require('./engines');
const { createCloud, QUIET_MS } = require('./cloud');
const { createSleep } = require('./idle');
const { mediamtxYaml } = require('./mediamtx');
const { rtmp, spartansLink, larixLink } = require('./network');
const { createUploadJobs } = require('./upload-jobs');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const auth = require('./auth');

const CONFIG = process.env.HJ_CONFIG || '/etc/headjudge/config.json';
const C = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
for (const need of ['secret', 'host', 'password', 'dataDir']) if (!C[need]) throw new Error(`${need} is missing from ${CONFIG}`);
const DATA = C.dataDir, RECORDINGS = path.join(DATA, 'recordings'), REVIEW = path.join(__dirname, 'review'), SITE_DIR = path.join(__dirname, 'site');
fs.mkdirSync(RECORDINGS, { recursive: true });

// what can change while it runs; the rest is fixed
const SETTINGS = path.join(DATA, 'settings.json');
const readFile = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const saved = readFile(SETTINGS, {});
const MAX_CAMERAS = C.maxCameras || 2;
const S = { stations: 2, rtmpPort: 1935, srtPort: 8890, webrtcPort: 8889, iceUdpPort: 8189, apiPort: 9997, playbackPort: 9996, viewPort: 8800, enginePort: 8801, record: true, keepDays: 7, bitrate: 3500, ...C, ...saved, password: C.password, youtube: saved.youtube || {} };
// how many of the booking's cameras this server has, and the number its first goes by: a booking's cameras are numbered 1, 2, 3… across its
// servers. Inside, this server's are always 1 and 2 (their stream paths); people see them by their number in the booking.
const booked = () => Math.max(1, Math.min(MAX_CAMERAS, S.bookedCameras || MAX_CAMERAS));
const camName = (n) => n + (S.firstCamera || 1) - 1;
S.stations = booked();
const save = () => fs.writeFile(SETTINGS, JSON.stringify({ stations: S.stations, ai: engines.list(), youtube: S.youtube }), () => {});
const JUDGE_SETTINGS = path.join(DATA, 'judge-settings.json');
let judgeSettings = readFile(JUDGE_SETTINGS, {});

// ---------------------------------------------------------------- the streaming server
let mtx = null, stopping = false; const mtxLog = [];
const log = (line) => { mtxLog.push(`${new Date().toISOString().slice(11, 19)} ${line}`); if (mtxLog.length > 300) mtxLog.shift(); if (process.env.HJ_VERBOSE) console.log(line); };
function startStreaming() {
  const yml = path.join(DATA, 'mediamtx.yml');
  fs.writeFileSync(yml, mediamtxYaml(S, { recordDir: RECORDINGS, publicHost: C.publicIp || C.host, viewBind: '127.0.0.1' }));
  mtx = spawn(C.mediamtx || 'mediamtx', [yml], { cwd: DATA, stdio: ['ignore', 'pipe', 'pipe'] });
  const take = (b) => String(b).split(/\r?\n/).filter(Boolean).forEach((l) => log(l.replace(/^\d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d /, '')));
  mtx.stdout.on('data', take); mtx.stderr.on('data', take);
  mtx.on('error', (e) => log(`The streaming server couldn't start: ${e.message}`));
  mtx.on('exit', (code) => { log(`Streaming server stopped (${code}).`); mtx = null; if (!stopping) setTimeout(startStreaming, 2000); });
}

// ---------------------------------------------------------------- the judges
const engines = (() => {
  const e = createEngines({
    chrome: C.chrome || 'google-chrome', dataDir: DATA, max: C.maxEngines || 2, extraFlags: C.chromeFlags || [], env: C.display ? { DISPLAY: C.display } : {}, log,
    pageUrl: (n) => `http://127.0.0.1:${S.enginePort}/judge/judge.html?stream=${encodeURIComponent(`http://127.0.0.1:${S.webrtcPort}/live/station${n}/whep`)}&go=1&cfg=cam${n}&engine=${n}`,
    settings: () => judgeSettings,
  });
  e.list = () => { const out = []; for (let n = 1; n <= S.stations; n++) if (e.wanted(n)) out.push(n); return out; };
  e.restore(saved.ai || []);
  return e;
})();
// uploaded videos, analysed here in the background. Live judges come first: if they're using all this server can give, it waits.
const uploadJobs = createUploadJobs({
  chrome: C.chrome || 'google-chrome', dataDir: DATA, extraFlags: C.chromeFlags || [], env: C.display ? { DISPLAY: C.display } : {}, log,
  pageUrl: (video, name) => `http://127.0.0.1:${S.enginePort}/judge/judge.html?video=${encodeURIComponent('/uploads/' + encodeURIComponent(video))}&name=${encodeURIComponent(name)}&go=1&cfg=upload&bg=1`,
  settings: () => judgeSettings,
  busy: () => engines.list().filter((n) => engines.running(n)).length >= engines.max,
});
// each judge's latest picture of the scene, passed on to whoever's watching that camera
const live = new Map();   // n → { last, at, viewers: Set<res>, frames: [timestamps] }
const liveOf = (n) => { if (!live.has(n)) live.set(n, { last: '', at: 0, viewers: new Set(), fps: 0 }); return live.get(n); };
const review = createReview({
  DATA, S, REVIEW, SITE_DIR,
  extraState: (cams) => ({
    brand, maxJudges: engines.max, until: sleeper.until(), firstCamera: S.firstCamera || 1, site: C.site || '', // the console, for the Booking and History tabs
    cams: cams.map((c) => { const l = live.get(c.n); return { ...c, ai: engines.wanted(c.n), judging: engines.running(c.n) && !!l && Date.now() - l.at < 4000, fps: l && Date.now() - l.at < 4000 ? l.fps : 0 }; }),
  }),
});

// ---------------------------------------------------------------- the company's brand, in case they've changed it
let brand = C.brand || null;
async function refreshBrand() {
  if (!C.api || !C.companyId) return;
  try { const r = await fetch(`${C.api}/companies/${encodeURIComponent(C.companyId)}`, { signal: AbortSignal.timeout(10000) }); if (r.ok) brand = await r.json(); } catch { /* what we have will do */ }
}
refreshBrand(); setInterval(refreshBrand, 5 * 60e3);

// ---------------------------------------------------------------- recordings to cloud storage
// what goes up names cameras by their number in the booking, as the past results show every server's together
const named = (x) => (x.src !== 'upload' && x.cam ? { ...x, cam: camName(x.cam) } : x);
const cloud = createCloud({ dir: RECORDINGS, uploadsDir: path.join(DATA, 'training'), stateFile: path.join(DATA, 'cloud-sent.json'), camName, results: () => { const r = review.results(); return { json: { athletes: r.athletes.map(named), numbers: r.numbers.map(named), sources: previousSources }, files: r.files }; }, api: () => C.api, settings: () => ({ cloudOn: !!(C.api && C.receiverKey), cloudKey: C.receiverKey, cloudSince: 0 }) });

// ---------------------------------------------------------------- the page's own requests beyond the review API
const ADDRESSES = () => ({ lan: [C.host], lanNames: ['internet'], tailscale: null });
async function cameraList() {
  const out = [];
  for (const c of review.cams()) {
    const link = spartansLink(ADDRESSES(), c.n, S), lx = larixLink(ADDRESSES(), c.n, S);
    out.push({ n: c.n, live: c.live, video: c.video, larixUrl: rtmp(C.host, c.n, S), phone: await QRCode.toDataURL(link, { margin: 1, width: 280 }), larix: await QRCode.toDataURL(lx, { margin: 1, width: 280, errorCorrectionLevel: 'L' }), rtmp: rtmp(C.host, c.n, S) });
  }
  return out;
}
// the viewer's WebRTC offer reaches the streaming server through here, so it needs the same login as everything else
function proxyWhep(req, res, target) {
  const up = http.request({ host: '127.0.0.1', port: S.webrtcPort, path: target, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${S.webrtcPort}`, cookie: '' } }, (r) => {
    const headers = { ...r.headers };
    if (headers.location) headers.location = `/whep${headers.location}`;
    res.writeHead(r.statusCode, headers); r.pipe(res);
  });
  up.on('error', () => { if (!res.headersSent) send(res, 502, { error: 'The streaming server isn\'t answering' }); else res.destroy(); });
  req.pipe(up);
}
function followLive(req, res, n) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');
  const l = liveOf(n);
  if (l.last && Date.now() - l.at < 3000) res.write(`data: ${l.last}\n\n`);
  l.viewers.add(res);
  req.on('close', () => l.viewers.delete(res));
}
setInterval(() => { for (const l of live.values()) for (const r of l.viewers) r.write(': still here\n\n'); }, 15000);

// which recording in cloud storage each fetched video came from, so its results can find it when this server is off
const PREVIOUS = path.join(DATA, 'previous-sources.json');
let previousSources = {}; try { previousSources = JSON.parse(fs.readFileSync(PREVIOUS, 'utf8')); } catch { /* none yet */ }
// a recording from cloud storage, fetched here to be analysed. It's already in the cloud, so it doesn't go back up.
async function fetchPrevious(id) {
  const r = await cloud.previousLink(id);
  const from = new Date(r.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const label = r.cam ? `Camera_${r.cam}_${from}` : String(r.name || r.file).replace(/\.[^.]*$/, '');
  const video = `${new Date().toISOString().replace(/[:.]/g, '-')}_${label.replace(/[^\w.-]+/g, '_').slice(-80)}${path.extname(r.file) || '.mp4'}`;
  const dir = path.join(DATA, 'training'), file = path.join(dir, video);
  fs.mkdirSync(dir, { recursive: true });
  cloud.markSent(`uploads/${video}`);
  previousSources[video] = r.file; fs.writeFile(PREVIOUS, JSON.stringify(previousSources), () => {});
  const got = await fetch(r.url);
  if (!got.ok || !got.body) throw new Error(`Storage said ${got.status}`);
  try { await pipeline(Readable.fromWeb(got.body), fs.createWriteStream(file)); }
  catch (e) { fs.rm(file, { force: true }, () => {}); throw e; }
  return { video, name: label.replace(/_/g, ' ') };
}

async function extra(req, res, u, { local }) {
  const p = u.pathname;
  const eng = /^\/api\/engine\/(\d{1,2})(?:\/(snap|live|restart))?$/.exec(p);
  if (eng) {
    const n = +eng[1];
    if (n < 1 || n > S.stations) return send(res, 404, { error: 'No such camera' }), true;
    if (eng[2] === 'snap' && req.method === 'POST') {
      if (!local) return send(res, 403, { error: 'Judges only' }), true;
      const raw = await new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 5e5) { req.destroy(); ok(''); } }); req.on('end', () => ok(b)); req.on('error', () => ok('')); });
      const l = liveOf(n), now = Date.now();
      if (raw) { l.fps = +(/"fps":([\d.]+)/.exec(raw) || [])[1] || 0; l.last = raw; l.at = now; for (const r of l.viewers) r.write(`data: ${raw}\n\n`); }
      send(res, 200, { ok: true }); return true;
    }
    if (eng[2] === 'live' && req.method === 'GET') { followLive(req, res, n); return true; }
    if (req.method !== 'POST' || !isJson(req)) return send(res, 415, { error: 'JSON only' }), true;
    const b = await readBody(req);
    if (eng[2] === 'restart') { await engines.restart(n); send(res, 200, { ok: true }); return true; }
    if (!eng[2]) { const why = engines.set(n, !!b?.on); if (why) return send(res, 409, { error: why }), true; save(); send(res, 200, { ok: true }); return true; }
  }
  if (p === '/api/upload-jobs' && req.method === 'GET') { send(res, 200, uploadJobs.list()); return true; }
  if (p === '/api/previous-recordings' && req.method === 'GET') {
    // with which local copy came from which recording, so a recording analysed here finds its athletes
    try { send(res, 200, { recordings: await cloud.previous(), sources: previousSources }); } catch (e) { send(res, 502, { error: e.message }); }
    return true;
  }
  if ((p === '/api/upload-jobs' || p === '/api/upload-jobs/stop') && req.method === 'POST') {
    if (!isJson(req)) return send(res, 415, { error: 'JSON only' }), true;
    const b = await readBody(req);
    if (b?.previous && !p.endsWith('/stop')) {
      try { const got = await fetchPrevious(String(b.previous)); send(res, 200, uploadJobs.add(got.video, got.name)); }
      catch (e) { send(res, 502, { error: e.message || 'That recording couldn\'t be fetched' }); }
      return true;
    }
    const video = path.basename(String(b?.video || ''));
    if (p.endsWith('/stop')) { send(res, 200, { stopped: uploadJobs.stop(video, 'Stopped. What it found so far is on the right.') }); return true; }
    if (!video || !fs.existsSync(path.join(DATA, 'training', video))) return send(res, 404, { error: 'That video isn\'t on the server' }), true;
    send(res, 200, uploadJobs.add(video, String(b.name || video).slice(0, 120))); return true;
  }
  if (p === '/api/judge-settings' && req.method === 'GET') { send(res, 200, judgeSettings); return true; }
  if (p === '/api/judge-settings' && req.method === 'PUT') {
    if (!isJson(req)) return send(res, 415, { error: 'JSON only' }), true;
    const b = await readBody(req);
    if (!b || !/^burpeeJudge\.settings(\.[a-z0-9]{1,20})?$/i.test(String(b.key || '')) || typeof b.value !== 'string' || b.value.length > 20000) return send(res, 400, { error: 'Not a judge setting' }), true;
    judgeSettings[b.key] = b.value;
    fs.writeFile(JUDGE_SETTINGS, JSON.stringify(judgeSettings), () => {});
    saveSettingsToSite().catch(() => {});
    send(res, 200, { ok: true }); return true;
  }
  if (p === '/api/cameras' && req.method === 'GET') { send(res, 200, { cameras: await cameraList(), bitrate: S.bitrate, max: booked(), firstCamera: S.firstCamera || 1 }); return true; }
  if (p === '/api/cameras' && req.method === 'POST') {
    if (!isJson(req)) return send(res, 415, { error: 'JSON only' }), true;
    if (S.stations < booked()) { S.stations++; save(); saveSettingsToSite().catch(() => {}); await review.watchCameras(); }
    send(res, 200, { stations: S.stations }); return true;
  }
  if (p === '/api/server' && req.method === 'GET') { send(res, 200, { log: mtxLog.slice(-60), cloud: { ...cloud.status }, idle: sleeper.status() }); return true; }
  if (p.startsWith('/whep/')) { proxyWhep(req, res, u.pathname.slice(5) + u.search); return true; }
  return false;
}
const NO_ACCESS = (site) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#12161c;color:#f4f6f8;font:16px/1.5 system-ui,sans-serif"><main style="max-width:420px;padding:24px"><h1 style="font-size:1.4rem;margin:0 0 8px">Open this from your HeadJudge account</h1><p style="color:#a3acb7;margin:0 0 16px">This page needs a sign-in link from your account. Links run out after a few minutes, so if you followed an old one, get a new one.</p>${site ? `<a style="color:#ffc400;font-weight:600" href="${site}">Go to my account</a>` : ''}</main>`;
const SIGNED_OUT = (site) => NO_ACCESS(site).replace(/<title>.*?<\/title>/, '<title>Signed out</title>').replace(/<h1([^>]*)>.*?<\/h1><p([^>]*)>.*?<\/p>/, '<h1$1>You’ve signed out of the video review</h1><p$2>This browser can’t see this server’s cameras or results any more. To come back, open the video review from your HeadJudge account.</p>');

// what browsers get: everything needs the login, except the login itself, signing out and the health check
const viewServer = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/healthz') return send(res, 200, { ok: true, streaming: review.serverOk() });
    if (u.pathname === '/login') {
      const s = auth.login(C.secret, u.searchParams.get('t'));
      if (!s) { res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(NO_ACCESS(C.site)); }
      res.writeHead(302, { 'Set-Cookie': s.cookie, Location: auth.landing(u.searchParams), 'Cache-Control': 'no-store' }); return res.end();
    }
    if (u.pathname === '/logout') {
      res.writeHead(200, { 'Set-Cookie': auth.logout(), 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(SIGNED_OUT(C.site));
    }
    if (!auth.session(C.secret, req)) {
      if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/whep/')) return send(res, 401, { error: 'Sign in again from your HeadJudge account' });
      res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(NO_ACCESS(C.site));
    }
    sleeper.seen();
    if (await extra(req, res, u, { local: false })) return;
    return review.handler(req, res);
  } catch (e) { if (!res.headersSent) send(res, 500, { error: e.message }); else res.destroy(); }
});
// what the judges on this machine use: nothing else can reach it
const engineServer = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    if (await extra(req, res, u, { local: true })) return;
    return review.handler(req, res);
  } catch (e) { if (!res.headersSent) send(res, 500, { error: e.message }); else res.destroy(); }
});

// ---------------------------------------------------------------- nobody using it: tell the site, which turns the server off
const sleeper = createSleep({
  idleMinutes: C.idleMinutes || 0, hardHours: C.hardHours || 0,
  busy: () => review.cams().some((c) => c.live) || [...live.values()].some((l) => l.viewers.size > 0),
  // judges finish their rounds; the streaming server stops, which closes the recordings; they go up; only then may the site turn the server off
  flush: async () => {
    await uploadJobs.stopAll('The booking ended before it finished. What it found so far is on the right.');
    await engines.stopAll();
    await cloud.sendResults(true).catch(() => {});
    stopping = true; try { mtx?.kill('SIGTERM'); } catch { /* gone */ }
    await new Promise((r) => setTimeout(r, QUIET_MS + 10000)); // a recording counts as finished once it's stopped changing
    for (let i = 0; i < 40; i++) { await cloud.tick().catch(() => {}); await cloud.sendResults(true).catch(() => {}); if (!cloud.status.waiting && cloud.status.state !== 'sending' && !cloud.status.resultsError) break; await new Promise((r) => setTimeout(r, 15000)); }
  },
  tell: (what) => callSite(what), log,
});
// Everything this server holds that anyone will want again: only once all of it is safe may the control app delete the server.
async function allSaved() {
  const settings = await saveSettingsToSite().then(() => true).catch(() => false);
  return settings && cloud.status.state !== 'off' && !cloud.status.waiting && !cloud.status.error && !cloud.status.resultsError;
}
// Camera settings live with the site, as the server's deleted when it's shut down.
async function saveSettingsToSite() {
  if (!C.api || !C.serverKey) throw new Error('not linked to the site');
  const r = await fetch(`${C.api}/servers/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Server-Key': C.serverKey }, body: JSON.stringify({ settings: { judge: judgeSettings, stations: S.stations, youtube: S.youtube || {} } }), signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`The site said ${r.status}`);
}
// On a new server, they come back from the site. A server that already has its own keeps them. Either way the site says which of the booking's
// cameras are this server's.
async function loadSettingsFromSite() {
  if (!C.api || !C.serverKey) return;
  const fresh = !Object.keys(judgeSettings).length;
  for (let i = 0; i < 10; i++) {
    try {
      const r = await fetch(`${C.api}/servers/settings`, { headers: { 'X-Server-Key': C.serverKey }, signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        const { settings, booked: mine } = await r.json();
        if (mine) { S.bookedCameras = +mine.cameras || S.bookedCameras; S.firstCamera = +mine.first || S.firstCamera; }
        if (settings && fresh) {
          Object.assign(judgeSettings, settings.judge || {});
          fs.writeFile(JUDGE_SETTINGS, JSON.stringify(judgeSettings), () => {});
          if (settings.youtube) S.youtube = settings.youtube;
          log('Camera settings restored from the last booking');
        }
        // every camera booked on it is ready for its phone; one no longer booked has its judge stopped
        const judging = engines.list();
        S.stations = booked();
        for (const n of judging) if (n > S.stations) engines.set(n, false);
        save(); await review.watchCameras().catch(() => {});
        return;
      }
    } catch { /* the internet may not be up yet */ }
    await new Promise((ok) => setTimeout(ok, 6000));
  }
}
loadSettingsFromSite().catch(() => {});
// the site is told we're alive, and asks us to stop by answering so
async function callSite(what) {
  if (!C.api || !C.serverKey) return null;
  const saved = what === 'finished' ? await allSaved() : undefined;
  return fetch(`${C.api}/servers/report`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Server-Key': C.serverKey }, body: JSON.stringify({ what, saved, cams: review.cams().filter((c) => c.live).length, judges: engines.list().length }), signal: AbortSignal.timeout(15000) })
    .then((r) => r.json()).catch(() => null);
}

// ---------------------------------------------------------------- room on the disk
// a full disk would stop the recordings, so the oldest go first: those already safe in cloud storage, then (with a warning) any others
const KEEP_FREE = (C.keepFreeGb || 12) * 1e9;
function makeRoom() {
  let free; try { const d = fs.statfsSync(DATA); free = d.bavail * d.bsize; } catch { return; }
  if (free >= KEEP_FREE) return;
  const sent = readFile(path.join(DATA, 'cloud-sent.json'), {}), files = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.mp4')) files.push({ p, rel: path.relative(RECORDINGS, p).replace(/\\/g, '/'), at: fs.statSync(p).mtimeMs }); } };
  try { walk(RECORDINGS); } catch { return; }
  const finished = files.filter((f) => Date.now() - f.at > 120e3).sort((a, b) => (!!sent[b.rel] - !!sent[a.rel]) || a.at - b.at);
  for (const f of finished.slice(0, 10)) { if (!sent[f.rel]) log(`Disk nearly full: deleting ${f.rel}, which hasn't reached cloud storage`); try { fs.unlinkSync(f.p); } catch { /* in use */ } }
}
setInterval(makeRoom, 60000);

// ---------------------------------------------------------------- running
startStreaming();
viewServer.listen(S.viewPort, C.bind || '127.0.0.1');
engineServer.listen(S.enginePort, '127.0.0.1');
setInterval(async () => { await review.watchCameras(); engines.tick(review.cams()); }, 1000);
setInterval(() => { cloud.tick().catch(() => {}); }, 60000);
sleeper.start();
const quit = async () => { if (stopping) return; stopping = true; await uploadJobs.stopAll().catch(() => {}); await engines.stopAll().catch(() => {}); await cloud.sendResults(true).catch(() => {}); try { mtx?.kill('SIGTERM'); } catch { /* gone */ } setTimeout(() => process.exit(0), 500); };
process.on('SIGTERM', quit); process.on('SIGINT', quit);
log('Server started');
