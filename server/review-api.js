'use strict';
// The review page's API: cameras and their history, incident marks, athletes and their proof, uploaded videos, hand counts,
// and clips cut from the recordings by time. Clips are read from the recorded files, so replay never interrupts recording or a judge.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { mergeAthletes } = require('./merge.js');
const { givesWay } = require('./deep.js');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.onnx': 'application/octet-stream' };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const readBody = (req, max = 1e5) => new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > max) { req.destroy(); ok(null); } }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); req.on('error', () => ok(null)); });
// marks only from this page's own scripts: a JSON request (another website can't send one without asking first)
const isJson = (req) => /^application\/json\b/i.test(req.headers['content-type'] || '');

// segments (segments.js): how late each recording's own clock runs. Every time the page gives or gets is when it really happened
// (the judge's clock); only what's asked of the streaming server is in the recording's.
function createReview({ DATA, S, REVIEW, SITE_DIR, segments = null, extraState = () => ({}) }) {
  const clipCache = new Map();   // the last few clips, kept whole so an iPad can seek in them (Safari needs ranges)
  let serverOk = false;
  const MTX_API = () => `http://127.0.0.1:${S.apiPort}`;
const EVENTS = path.join(DATA, 'events.json'), MARKS = path.join(DATA, 'marks.json'), ATHLETES = path.join(DATA, 'athletes.json'), PICS = path.join(DATA, 'athlete-pics'), TRACKS = path.join(DATA, 'athlete-tracks');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; } };
let events = readJson(EVENTS), marks = readJson(MARKS), cams = [], wasLive = {};
// a camera whose phone keeps dropping off and reconnecting (a weak mobile connection): each reconnect starts a new stream, so its readyTime changes
const DROP_WINDOW_MS = 3 * 60e3, lastReady = {}, drops = {}, ups = {};
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

const clipLoading = new Map();
const CLIP_CACHE_BYTES = 400e6;
async function clip(cam, start, dur) {
  const late = segments ? segments.latenessAt(cam, Date.parse(start)) : 0;
  const key = `${cam}|${start}|${dur}|${Math.round(late / 20)}`;
  if (clipCache.has(key)) return clipCache.get(key);
  if (clipLoading.has(key)) return clipLoading.get(key);
  if (clipLoading.size >= 6) throw new Error('Busy cutting other clips: try again in a moment');
  const p = loadClip(cam, new Date(Date.parse(start) + late).toISOString(), dur, key).finally(() => clipLoading.delete(key));
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

  async function watchCameras() {
    let list = [], conns = [], ok = true;
    try {
      list = (await (await fetch(`${MTX_API()}/v3/paths/list`, { signal: AbortSignal.timeout(1500) })).json()).items || [];
      conns = await fetch(`${MTX_API()}/v3/rtmpconns/list`, { signal: AbortSignal.timeout(1500) }).then((x) => x.json()).then((j) => j.items || []).catch(() => []);
    } catch { ok = false; }
    const now = [];
    for (let n = 1; n <= S.stations; n++) {
      const p = list.find((x) => x.name === `live/station${n}`);
      const conn = p && p.source && conns.find((c) => c.id === p.source.id);
      const from = conn && conn.remoteAddr ? conn.remoteAddr.replace(/:\d+$/, '') : '';
      const video = p && (p.tracks2 || []).find((t) => t.codecProps && t.codecProps.width);
      const live = !!(p && p.ready);
      if (live && !wasLive[n]) ups[n] = (ups[n] || 0) + 1;
      const at = Date.now(), ready = live ? p.readyTime ?? `up${ups[n]}` : null; // (each time it came back, if the streaming server doesn't say)
      if (ok && ready && lastReady[n] && ready !== lastReady[n]) (drops[n] ||= []).push(at);
      if (ready) lastReady[n] = ready;
      drops[n] = (drops[n] || []).filter((t) => at - t < DROP_WINDOW_MS);
      now.push({ n, live, from, route: from ? 'internet' : '', video: video ? `${video.codecProps.width}×${video.codecProps.height}` : '', watchers: p ? (p.readers || []).length : 0, drops: drops[n].length });
      if (ok && live !== !!wasLive[n]) { events.push({ t: new Date().toISOString(), cam: n, type: live ? 'connected' : 'lost', route: live ? 'internet' : '' }); saveEvents(); }
      if (ok) wasLive[n] = live;
    }
    cams = now; serverOk = ok;
    return ok;
  }

  async function handler(req, res) {
  try {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    if (p === '/api/state') {
      const extra = extraState(cams);
      return send(res, 200, { now: new Date().toISOString(), cams: extra.cams || cams, marks: marks.slice(-300), events: events.slice(-300), athletesRev, record: S.record, keepDays: S.keepDays, ...extra, cams: extra.cams || cams });
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
      // when each rep and no rep was, kept with the athlete: two cameras filming the same athletes are put together by them
      let timed = false;
      for (const e of Array.isArray(b.events) ? b.events : []) {
        const t = e && num(e.t); if (t == null || (e.type !== 'rep' && e.type !== 'norep')) continue;
        const list = e.type === 'rep' ? (a.repTimes ??= []) : (a.noRepTimes ??= []);
        if (!list.includes(t) && list.length < 500) { list.push(t); timed = true; }
      }
      if (timed) saveAthletes();
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
      if (!video || !fs.existsSync(path.join(DATA, 'training', video))) return send(res, 400, { error: 'That video isn\'t on the server' });
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
      const list = athletes.filter((a) => !a.replaced && a.lastAt >= from && a.firstAt <= to).slice(-2000).reverse();
      // athletes seen on two cameras that film the same athletes, put together (the review's "Same athletes" setting)
      return send(res, 200, { rev: athletesRev, list, numbers: numbersSeen.filter((x) => x.lastAt >= from && x.firstAt <= to), merged: mergeAthletes(list, S.sameAthletes || []), groups: S.sameAthletes || [] });
    }
    if (p === '/api/athlete-pic') {
      const file = path.join(PICS, (+u.searchParams.get('n') | 0) + '.jpg');
      if (!fs.existsSync(file)) return send(res, 404, 'none', 'text/plain');
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache' }); return fs.createReadStream(file).pipe(res);
    }
    // the days anything was recorded, tracked or uploaded (the server's time zone), newest first
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
      // each stretch from when it really started
      const real = (x) => { const t = Date.parse(x.start), late = segments ? segments.latenessFrom(cam, t) : 0; return late ? new Date(t - late).toISOString() : x.start; };
      return send(res, 200, r && r.ok ? (await r.json()).map((x) => ({ start: real(x), duration: x.duration })) : []);
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
  }
  // A camera's recording has been analysed again in full (deep.js: a crowd was in view, more than its live judge could follow).
  // What the live judge counted in that stretch gives way to it, unless the deep analysis counted fewer reps than the live judge
  // did: then something went wrong with it and both stay listed. Returns { replaced } or { kept: why }.
  function replaceLive(cam, from, to, video) {
    const { live, kept } = givesWay(athletes, cam, from, to, String(video).replace(/[^\w.-]+/g, '_').slice(0, 140));
    const at = new Date().toISOString();
    for (const a of live) a.replaced = at;
    if (live.length) saveAthletes();
    return { replaced: live.length, kept };
  }
  // A deep analysis that stopped part of the way through: what it had found is only part of the recording, so it isn't listed
  // (beside the live counts it would count some athletes twice). The live counts stand until the recording is analysed in full.
  function hideVideo(video) {
    const name = String(video).replace(/[^\w.-]+/g, '_').slice(0, 140), at = new Date().toISOString();
    const part = athletes.filter((a) => a.src === 'upload' && a.video === name && !a.replaced);
    for (const a of part) a.replaced = at;
    if (part.length) saveAthletes();
    return part.length;
  }
  // what goes to cloud storage, to be seen when this server is off
  const results = () => { const shown = athletes.filter((a) => !a.replaced); return {
    athletes: shown.map(({ n, src, video, cam, bib, label, firstT, lastT, firstAt, lastAt, reps, noReps, questionable, done, pic }) => ({ n, src, video, cam, bib, label, firstT, lastT, firstAt, lastAt, reps, noReps, questionable, done, pic })),
    numbers: numbersSeen,
    merged: mergeAthletes(shown, S.sameAthletes || []),
    files: shown.flatMap((a) => [{ name: `tracks/${a.n}.jsonl`, path: path.join(TRACKS, `${a.n}.jsonl`) }, { name: `pics/${a.n}.jpg`, path: path.join(PICS, `${a.n}.jpg`) }]),
  }; };
  return { handler, watchCameras, cams: () => cams, serverOk: () => serverOk, results, replaceLive, hideVideo };
}

module.exports = { createReview, send, readBody, isJson, TYPES };
