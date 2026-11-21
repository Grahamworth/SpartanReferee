// A company's past week, with or without a server running: what each camera recorded, every athlete found with their tracking and
// reps, and the numbers shown to a camera, to search, watch and download. It only reads: recording and uploading are on the server's page.
import { call, devSignInButton, signedIn, getMe, signOut, esc } from './api-base.js';
import { microsoftButton } from './email-signin-web.js';
import { drawAppTabs } from './apptabs.js';

const $ = (id) => document.getElementById(id);
const show = (el, on) => { el.hidden = !on; };
const POINTS = [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32], [7, 8]];
const pointIndex = new Map(POINTS.map((p, i) => [p, i]));
const SEEN_MS = 800; // tracking is only drawn near a saved frame, so it doesn't sit there once someone's gone
const BLEND_MS = 500; // saved frames this close together are the same movement: the skeleton is drawn part-way between them
const CLIP_MS = 12 * 60e3; // a recording is cut every 10 minutes, so anything starting within this could hold a moment

let data = { athletes: [], numbers: [], recordings: [], sources: {}, merged: [], deep: [] };
let playing = null; // { rec, athlete, frames, events, startMs }

const dayKey = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayLabel = (k) => new Date(`${k}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const when = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const size = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);
const plainName = (file) => String(file || '').replace(/^\d{4}-\d\d-\d\dT[\d-]+Z?_/, '');
const recName = (r) => (r.cam ? `Camera ${r.cam}` : r.name || plainName(r.file) || 'Uploaded video');
// Someone found in a camera's recording that was analysed afterwards (a previous recording) was filmed by that camera when the
// recording was made, not when it was analysed: they're listed under the camera, at the recording's start plus how far in they are.
const sourceRec = (x) => (x.src === 'upload' ? data.recordings.find((r) => r.file === (data.sources[x.video] || x.video)) || null : null);
const camOf = (x) => (x.src === 'upload' ? sourceRec(x)?.cam || 0 : x.cam);
const sourceOf = (x) => (camOf(x) ? `c:${camOf(x)}` : `v:${x.video}`);
const sourceName = (x) => (camOf(x) ? `Camera ${camOf(x)}` : plainName(x.video));
const filmedAt = (x) => { const rec = sourceRec(x); return rec?.cam && x.firstT != null ? Date.parse(rec.startedAt) + x.firstT * 1000 : Date.parse(x.firstAt); };
const filmedLine = (x) => (x.src === 'upload' && x.firstT != null ? (camOf(x) ? `${when(filmedAt(x))} · ${mmss(x.firstT)} in the video` : `${mmss(x.firstT)} in the video`) : when(x.firstAt));
const athleteDay = (a) => dayKey(filmedAt(a));
// The time of day something was filmed, against From and To (either can be left empty; a From later than To runs over midnight).
// lengthMin: how long it runs for, for a recording.
const clock = (v) => { const m = /^(\d\d):(\d\d)/.exec(v || ''); return m ? +m[1] * 60 + +m[2] : null; };
function inTime(ms, lengthMin = 0) {
  const from = clock($('from').value), to = clock($('to').value); if (from == null && to == null) return true;
  const d = new Date(ms), start = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60, end = start + lengthMin;
  const lo = from ?? 0, hi = (to ?? 24 * 60 - 1) + 1; // (To takes in the whole of its minute)
  return lo < hi ? end >= lo && start < hi : end >= lo || start < hi;
}

function fillFilters() {
  const days = [...new Set([...data.recordings.map((r) => dayKey(r.startedAt)), ...data.athletes.map(athleteDay)])].sort().reverse();
  const keepDay = $('day').value, keepSource = $('source').value;
  $('day').innerHTML = `<option value="">All ${days.length} days</option>${days.map((d) => `<option value="${d}">${esc(dayLabel(d))}</option>`).join('')}`;
  if (days.includes(keepDay)) $('day').value = keepDay;
  const sources = new Map();
  for (const r of data.recordings) sources.set(r.cam ? `c:${r.cam}` : `f:${r.file}`, recName(r));
  for (const a of data.athletes) sources.set(sourceOf(a), sourceName(a));
  const list = [...new Map([...sources].filter(([k]) => !k.startsWith('f:') || !sources.has(`v:${k.slice(2)}`)))];
  $('source').innerHTML = `<option value="">All cameras and videos</option>${list.map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('')}`;
  if (list.some(([k]) => k === keepSource)) $('source').value = keepSource;
}
// an athlete filmed by two cameras on the same athletes (the server's setting): one card, their reps put together
function combined(list) {
  const drop = new Set(), out = new Map(), key = (a) => `${a.server}~${a.n}`;
  for (const m of data.merged || []) {
    const a = list.find((x) => x.server === m.server && x.n === m.ns[0]), b = list.find((x) => x.server === m.server && x.n === m.ns[1]);
    if (!a || !b) continue;
    out.set(key(a), { ...a, bib: m.bib || a.bib, reps: m.reps, noReps: m.noReps, other: b, both: m });
    drop.add(key(b));
  }
  return list.filter((a) => !drop.has(key(a))).map((a) => out.get(key(a)) || a);
}
function draw() {
  const q = $('find').value.trim(), day = $('day').value, source = $('source').value;
  const athletes = combined(data.athletes).filter((a) => (!q || String(a.bib || '').includes(q)) && (!day || athleteDay(a) === day) && inTime(filmedAt(a)) && (!source || sourceOf(a) === source || (a.other && sourceOf(a.other) === source)))
    .sort((x, y) => filmedAt(y) - filmedAt(x));
  $('athleteCount').textContent = athletes.length ? `(${athletes.length})` : '';
  $('athletes').innerHTML = athletes.map((a) => `<article class="pastCard">
      ${a.pic ? `<img src="${esc(a.pic)}" alt="">` : ''}
      <div><b class="reps">${esc(a.reps ?? 0)}</b> rep${a.reps === 1 ? '' : 's'}${a.noReps ? ` · ${esc(a.noReps)} no rep${a.noReps === 1 ? '' : 's'}` : ''}
        <small><b>${a.bib && a.bib !== 'No number' ? `Number ${esc(a.bib)}` : `Athlete ${esc(a.label ?? a.n)}`}</b> · ${a.other ? `Cameras ${esc(a.cam)} + ${esc(a.other.cam)}` : esc(sourceName(a))}</small>${a.other ? `
        <small>Camera ${esc(a.cam)}: ${esc(a.both.counts[0])} · Camera ${esc(a.other.cam)}: ${esc(a.both.counts[1])} · ${esc(a.both.both)} seen on both</small>` : ''}
        <small>${esc(dayLabel(athleteDay(a)))}, ${esc(filmedLine(a))}</small></div>
      <div class="pastActions"><button class="small" type="button" data-watch="${esc(a.server)}~${esc(a.n)}">${a.other ? `Watch camera ${esc(a.cam)}` : 'Watch'}</button>${a.other ? `<button class="small" type="button" data-watch="${esc(a.server)}~${esc(a.other.n)}">Watch camera ${esc(a.other.cam)}</button>` : `<button class="small" type="button" data-save="${esc(a.server)}~${esc(a.n)}">Download with tracking</button>`}</div>
    </article>`).join('') || `<p class="muted">${data.athletes.length ? 'Nobody matches that.' : 'No athletes in the last 7 days.'}</p>`;
  const numbers = data.numbers.filter((x) => (!q || x.number.includes(q)) && (!day || dayKey(filmedAt(x)) === day) && inTime(filmedAt(x)) && (!source || sourceOf(x) === source))
    .sort((x, y) => filmedAt(y) - filmedAt(x));
  $('numbers').innerHTML = numbers.map((x) => `<div class="pastRow"><div><b>${esc(x.number)}</b><small>${esc(sourceName(x))} · ${esc(dayLabel(dayKey(filmedAt(x))))}, ${esc(filmedLine(x))}</small></div>
      <button class="small" type="button" data-number="${esc(x.id)}">Go to it</button></div>`).join('') || `<p class="muted">${data.numbers.length ? 'None match that.' : 'No numbers were shown.'}</p>`;
  // Only the recordings someone was counted in, unless the box is ticked: a day's cameras also leave long stretches with nobody
  // exercising, and a connection that keeps dropping leaves hundreds of clips under a second long.
  const counted = new Set(data.athletes.map((a) => recordingFor(a)?.id).filter(Boolean));
  const inView = data.recordings.filter((r) => (!day || dayKey(r.startedAt) === day) && inTime(Date.parse(r.startedAt), r.cam ? 10 : 0) && (!source || source === (r.cam ? `c:${r.cam}` : `f:${r.file}`) || source === `v:${r.file}`));
  const recs = $('allRecs').checked ? inView : inView.filter((r) => counted.has(r.id));
  $('recCount').textContent = recs.length ? `(${recs.length})` : '';
  show($('allRecsRow'), inView.some((r) => !counted.has(r.id)));
  $('recordings').innerHTML = recs.map((r) => `<div class="pastRow"><div><b>${esc(recName(r))}</b><small>${esc(dayLabel(dayKey(r.startedAt)))}, ${esc(when(r.startedAt))} · ${esc(size(r.size))}</small></div>
      <div class="pastActions"><button class="small" type="button" data-play="${esc(r.id)}">Play</button><a class="small" href="${esc(r.download)}" download>Download</a></div></div>`).join('') || `<p class="muted">${inView.length ? 'Nobody was counted in these recordings. Tick the box above to show them.' : 'No recordings in the last 7 days.'}</p>`;
}

// ---------- playing, with the judge's tracking over the picture
const video = $('player'), canvas = $('overlay'), ctx = canvas.getContext('2d');
const recordingFor = (a) => {
  if (a.src === 'upload') { const file = data.sources[a.video] || a.video; return data.recordings.find((r) => r.file === file) || null; }
  return recordingAt(a.cam, Date.parse(a.firstAt));
};
function recordingAt(cam, at) {
  const list = data.recordings.filter((r) => r.cam === cam && Date.parse(r.startedAt) <= at && at - Date.parse(r.startedAt) < CLIP_MS);
  return list.sort((x, y) => Date.parse(y.startedAt) - Date.parse(x.startedAt))[0] || null;
}
// videoClock: `at`, and the tracking and reps that go with it, count from the start of this video, not the time of day. That's so
// for anything found in a video analysed after it was made: an upload, and a camera's own recording analysed as a previous
// recording. (Taking a camera's recording to run on the time of day whoever was found in it sent Watch to its first frame with no
// tracking, and left the download waiting for ever: 20 November 2026.)
function play(rec, at, title, videoClock = false) {
  playing = { ...playing, rec, videoClock, startMs: videoClock || !rec.cam ? 0 : Date.parse(rec.startedAt) };
  show($('stageNote'), false); show(video, true); show($('playerHead'), true);
  $('playerTitle').textContent = title;
  $('playerDownload').href = rec.download;
  const seek = () => { video.currentTime = Math.max(0, (at - playing.startMs) / 1000); video.play().catch(() => {}); };
  if (video.getAttribute('src') === rec.url && video.readyState > 0) seek();
  else { video.onloadedmetadata = seek; video.src = rec.url; }
}
// a live camera's recording is cut every 10 minutes: carry on into the next piece
video.addEventListener('ended', () => {
  const after = playing?.videoClock ? null : pieceAfter(playing?.rec);
  if (after) play(after, Date.parse(after.startedAt), $('playerTitle').textContent);
});
function pieceAfter(rec) {
  if (!rec?.cam) return null;
  const after = data.recordings.filter((r) => r.cam === rec.cam && Date.parse(r.startedAt) > Date.parse(rec.startedAt)).sort((x, y) => Date.parse(x.startedAt) - Date.parse(y.startedAt))[0];
  return after && Date.parse(after.startedAt) - Date.parse(rec.startedAt) < CLIP_MS ? after : null;
}
const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3ddc97';
const athleteName = (a) => (a.bib && a.bib !== 'No number' ? `Number ${a.bib}` : `Athlete ${a.label ?? a.n}`);
function drawTrack() {
  requestAnimationFrame(drawTrack);
  const frames = playing?.frames, want = !!frames?.length && $('showTrack').checked && !video.hidden;
  if (canvas.hidden === want) canvas.hidden = !want;
  if (!want || !video.videoWidth) return;
  const box = video.getBoundingClientRect(), ratio = window.devicePixelRatio || 1, W = Math.round(box.width * ratio), H = Math.round(box.height * ratio);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  ctx.clearRect(0, 0, W, H);
  const k = Math.min(W / video.videoWidth, H / video.videoHeight), dw = video.videoWidth * k, dh = video.videoHeight * k;
  paintTrack(ctx, playing, playing.startMs + video.currentTime * 1000, { x: (W - dw) / 2, y: (H - dh) / 2, w: dw, h: dh }, accent());
}
// The judge's tracking and the athlete's count at time T, drawn on a canvas whose picture fills `area`: over the player on
// screen, and into the video someone downloads (saveAthlete). P: { frames, events, athlete }.
function paintTrack(c, P, T, area, colour) {
  const frames = P.frames, W = c.canvas.width, H = c.canvas.height; if (!frames?.length) return;
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (frames[m][0] <= T) lo = m; else hi = m - 1; }
  const f = frames[lo]; if (Math.abs(f[0] - T) > SEEN_MS) return;
  // between two saved frames (the judge saves a dozen a second at best): part of the way from one to the next, so it moves with the body
  const g = frames[lo + 1], mix = g && f[0] <= T && g[0] - f[0] < BLEND_MS ? (T - f[0]) / (g[0] - f[0]) : 0;
  const pt = (p) => {
    const i = pointIndex.get(p); let x = f[2 + i * 2], y = f[3 + i * 2]; if (x < 0 || y < 0) return null;
    if (mix && g[2 + i * 2] >= 0 && g[3 + i * 2] >= 0) { x += (g[2 + i * 2] - x) * mix; y += (g[3 + i * 2] - y) * mix; } // (a point the next frame didn't see stays where it was)
    return { x: area.x + (x / 10000) * area.w, y: area.y + (y / 10000) * area.h };
  };
  c.strokeStyle = colour; c.lineWidth = Math.max(2, W / 320); c.lineCap = 'round';
  c.beginPath();
  for (const [a, b] of BONES) { const m = pt(a), n = pt(b); if (m && n) { c.moveTo(m.x, m.y); c.lineTo(n.x, n.y); } }
  c.stroke();
  c.fillStyle = '#fff';
  const seen = [];
  for (const p of POINTS) { const m = pt(p); if (m) { seen.push(m); c.beginPath(); c.arc(m.x, m.y, Math.max(2.5, W / 400), 0, 7); c.fill(); } }
  if (seen.length) paintCount(c, P, T, seen, W, H, colour);
}
// The athlete's count at that moment, just above their head, as the judge showed it live: green for a moment after a rep, red after a no rep.
function countAt(events, T) {
  let count = 0, noReps = 0, last = null;
  for (const e of events || []) { if (e.t > T) break; count = e.count ?? count; if (e.type !== 'rep') noReps++; last = e; }
  return { count, noReps, flash: last && T - last.t < 700 ? (last.type === 'rep' ? 'good' : 'bad') : null };
}
function paintCount(c, P, T, seen, W, H, colour) {
  const a = P.athlete; if (!a) return;
  const { count, noReps, flash } = countAt(P.events, T);
  const fs = Math.max(14, Math.round(H / 24));
  const name = a.bib && a.bib !== 'No number' ? `#${a.bib}` : `Athlete ${a.label ?? a.n}`;
  const text = `${name}  ${count}${noReps ? `  · ${noReps} ✕` : ''}`;
  c.font = `700 ${fs}px Barlow, Arial, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'bottom';
  const tw = c.measureText(text).width + fs, x = Math.min(W - tw / 2, Math.max(tw / 2, seen.reduce((s, m) => s + m.x, 0) / seen.length));
  const y = Math.max(fs * 1.4, Math.min(...seen.map((m) => m.y)) - fs * 0.5);
  c.fillStyle = flash === 'good' ? '#22c55e' : flash === 'bad' ? '#e2231a' : colour;
  c.fillRect(x - tw / 2, y - fs * 1.2, tw, fs * 1.25);
  c.fillStyle = flash ? '#fff' : '#000';
  c.fillText(text, x, y);
  c.textAlign = 'start'; c.textBaseline = 'alphabetic';
}

// ---------- an athlete's video to keep, with the tracking and the count drawn into the picture
// The recording is played through once, off to the side, from just before the athlete appears to just after they're last
// seen. Each frame is drawn on a canvas with the tracking on top, and the canvas is recorded as it goes, with the recording's
// sound. So it takes as long as the athlete was in front of the camera, and it's made in this browser: nothing is sent anywhere.
const SAVE_BEFORE_MS = 3000, SAVE_AFTER_MS = 2000, SAVE_MAX_MS = 20 * 60e3;
let saving = null, savedUrl = '';
function saveKind(sound) {
  const R = window.MediaRecorder; if (!R || !HTMLCanvasElement.prototype.captureStream) return null;
  const kinds = sound ? [['video/mp4;codecs=avc1.640028,mp4a.40.2', 'mp4'], ['video/mp4', 'mp4'], ['video/webm;codecs=vp9,opus', 'webm'], ['video/webm', 'webm']]
    : [['video/mp4;codecs=avc1.640028', 'mp4'], ['video/mp4', 'mp4'], ['video/webm;codecs=vp9', 'webm'], ['video/webm', 'webm']];
  const k = kinds.find(([type]) => R.isTypeSupported(type));
  return k ? { type: k[0], ext: k[1] } : null;
}
const once = (el, ok) => new Promise((res, rej) => {
  const done = (f, v) => { el.removeEventListener(ok, yes); el.removeEventListener('error', no); f(v); };
  const yes = () => done(res), no = () => done(rej, new Error('unreadable'));
  el.addEventListener(ok, yes); el.addEventListener('error', no);
});
// (why it failed is for whoever looks into it: the person is told what to do next)
const failed = (why) => { console.warn('download with tracking:', why); fail('The video couldn\'t be made. Try again, or download the recording instead.'); };
async function saveAthlete(server, n) {
  if (saving) return;
  const a = data.athletes.find((x) => x.server === server && String(x.n) === String(n)); if (!a) return;
  const rec = recordingFor(a);
  if (!rec) { fail('That video has gone, or is still on its way to storage. Try again in a few minutes.'); return; }
  if (!saveKind(false)) { fail('This browser can\'t make that video. Use an up-to-date Chrome, Edge or Safari, or download the recording instead.'); return; }
  fail('');
  const S = saving = { a, rec, done: false, cancelled: false };
  const view = $('saveView'), g = view.getContext('2d'), name = athleteName(a);
  const say = (text, part) => { $('saveText').textContent = text; if (part != null) $('saveBar').value = part; };
  if (savedUrl) { URL.revokeObjectURL(savedUrl); savedUrl = ''; }
  show($('saveBox'), true); show($('saveBar'), true); show($('saveCancel'), true); show($('saveAgain'), false);
  say(`Getting ${name}'s video ready…`, 0);
  // A recording stored without its index (those made before 20 November 2026) has to be read through to find the place: over
  // two minutes for one six minutes in, with nothing on the page changing. So it says what it's doing, and gives up in the end.
  const slow = setTimeout(() => { if (saving === S && !S.recorder) say('Still finding the place in the recording. With an older recording this can take a few minutes: keep this page open.'); }, 8000);
  const within = (p) => Promise.race([p, new Promise((_, no) => { setTimeout(() => no(new Error('too slow')), 10 * 60e3); })]);
  video.pause();
  const v = S.v = document.createElement('video');
  v.crossOrigin = 'anonymous'; v.playsInline = true; v.preload = 'auto';
  view.before(v);
  const tidy = S.tidy = () => {
    clearTimeout(slow);
    try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* gone */ }
    v.remove(); S.ac?.close?.().catch?.(() => {}); if (saving === S) saving = null;
  };
  try {
    const t = await call(`recordings/track/${encodeURIComponent(`${server}~${n}`)}`).catch(() => ({ frames: [], events: [] }));
    if (!t.frames.length) { tidy(); show($('saveBox'), false); fail('No tracking was saved for that athlete, so there\'s nothing to draw in. Download the recording instead.'); return; }
    const startOf = (r) => (r.cam ? Date.parse(r.startedAt) : 0);
    const videoClock = a.src === 'upload'; // (see play)
    S.startMs = videoClock ? 0 : startOf(rec);
    const last = Math.max(t.frames.at(-1)[0], t.events.at(-1)?.t ?? 0);
    const from = Math.max(S.startMs, t.frames[0][0] - SAVE_BEFORE_MS), to = Math.min(last + SAVE_AFTER_MS, from + SAVE_MAX_MS);
    v.src = rec.url; await within(once(v, 'loadedmetadata'));
    v.currentTime = Math.max(0, (from - S.startMs) / 1000); await within(once(v, 'seeked'));
    if (S.cancelled) { tidy(); return; }
    const k = Math.min(1, 1920 / v.videoWidth);
    view.width = Math.round((v.videoWidth * k) / 2) * 2; view.height = Math.round((v.videoHeight * k) / 2) * 2;
    const P = { frames: t.frames, events: t.events, athlete: a }, colour = accent(), area = { x: 0, y: 0, w: view.width, h: view.height };
    const stream = view.captureStream(30);
    // the recording's sound, through the browser's sound engine so it isn't heard while the video's made
    let sound = false;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; S.ac = new AC();
      const out = S.ac.createMediaStreamDestination(); S.ac.createMediaElementSource(v).connect(out);
      await Promise.race([S.ac.resume(), new Promise((r) => setTimeout(r, 800))]);
      if (S.ac.state === 'running') for (const tr of out.stream.getAudioTracks()) { stream.addTrack(tr); sound = true; }
    } catch { /* it's made without sound */ }
    if (!sound) v.muted = true;
    const kind = saveKind(sound) || saveKind(false);
    const recorder = S.recorder = new MediaRecorder(stream, { mimeType: kind.type, videoBitsPerSecond: Math.round(Math.max(2e6, view.width * view.height * 6.5)), audioBitsPerSecond: 128000 });
    const parts = []; recorder.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    const finish = (why) => {
      if (S.done) return; S.done = true;
      recorder.onstop = () => {
        tidy();
        if (S.cancelled) { show($('saveBox'), false); return; }
        if (why || !parts.length) { show($('saveBox'), false); failed(why || 'nothing recorded'); return; }
        savedUrl = URL.createObjectURL(new Blob(parts, { type: kind.type.split(';')[0] }));
        const d = new Date(filmedAt(a)), file = `${name.replace(/[^\w]+/g, '-')}-${dayKey(filmedAt(a))}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.${kind.ext}`;
        const link = $('saveAgain'); link.href = savedUrl; link.download = file;
        show($('saveBar'), false); show($('saveCancel'), false); show(link, true);
        say(`${name}'s video is in your downloads, with the tracking and the count drawn in.`);
        link.click();
      };
      try { recorder.stop(); } catch { recorder.onstop(); }
    };
    S.finish = finish;
    const paint = (sec) => {
      const T = S.startMs + sec * 1000;
      g.drawImage(v, 0, 0, view.width, view.height);
      paintTrack(g, P, T, area, colour);
      say(`Making ${name}'s video: ${mmss(Math.max(0, T - from) / 1000)} of ${mmss((to - from) / 1000)}. Keep this page open and in front until it's done.`, Math.min(1, Math.max(0, (T - from) / (to - from))));
      if (T >= to) finish();
    };
    const step = (now, meta) => { if (S.done) return; paint(meta ? meta.mediaTime : v.currentTime); next(); };
    const next = () => (v.requestVideoFrameCallback ? v.requestVideoFrameCallback(step) : requestAnimationFrame(() => step()));
    v.addEventListener('error', () => finish('unreadable'));
    // a live camera's recording is cut every 10 minutes: carry on into the next piece
    v.addEventListener('ended', async () => {
      if (S.done) return;
      const after = videoClock ? null : pieceAfter(S.rec); if (!after) { finish(); return; }
      S.rec = after; S.startMs = Date.parse(after.startedAt);
      try { v.src = after.url; await once(v, 'loadedmetadata'); await v.play(); } catch { finish(); }
    });
    paint(v.currentTime);
    recorder.start(1000);
    next();
    try { await v.play(); } catch { v.muted = true; await v.play(); }
  } catch (e) {
    const why = e?.message || String(e);
    if (S.recorder && S.recorder.state !== 'inactive') S.finish(why);
    else { tidy(); show($('saveBox'), false); if (!S.cancelled) failed(why); }
  }
}
function cancelSave() {
  const S = saving; if (!S) return;
  S.cancelled = true;
  if (S.finish) S.finish(); else { S.tidy?.(); show($('saveBox'), false); } // (still getting ready: nothing's been recorded)
}
// a page that isn't in front isn't drawn, so the video would freeze while the sound ran on: wait until it's back
document.addEventListener('visibilitychange', () => {
  const S = saving; if (!S?.recorder || S.done) return;
  if (document.hidden) { S.v.pause(); if (S.recorder.state === 'recording') S.recorder.pause(); }
  else { if (S.recorder.state === 'paused') S.recorder.resume(); S.v.play().catch(() => {}); }
});
async function watch(server, n) {
  const a = data.athletes.find((x) => x.server === server && String(x.n) === String(n)); if (!a) return;
  const rec = recordingFor(a);
  const title = `${athleteName(a)} · ${sourceName(a)}`;
  if (!rec) { fail('That video has gone, or is still on its way to storage. Try again in a few minutes.'); return; }
  fail('');
  const t = await call(`recordings/track/${encodeURIComponent(`${server}~${n}`)}`).catch(() => ({ frames: [], events: [] }));
  playing = { rec, athlete: a, frames: t.frames, events: t.events, startMs: 0 };
  show($('trackRow'), t.frames.length > 0);
  $('saveThis').dataset.save = `${server}~${n}`; show($('saveThis'), t.frames.length > 0);
  $('events').innerHTML = t.events.map((e, i) => `<button type="button" class="${e.type === 'rep' ? '' : 'bad'}" data-event="${i}" title="${esc((e.reasons || []).join(' · '))}">${e.type === 'rep' ? `✓ Rep ${esc(e.count)}` : '✗ No rep'}</button>`).join('');
  const start = t.frames[0]?.[0] ?? (a.src === 'upload' ? (a.firstT ?? 0) * 1000 : Date.parse(a.firstAt));
  play(rec, Math.max(0, start - 1000), title, a.src === 'upload');
  scrollTo({ top: 0, behavior: 'smooth' });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.watch) { const [server, n] = b.dataset.watch.split('~'); watch(server, n); }
  if (b.dataset.save) { const [server, n] = b.dataset.save.split('~'); saveAthlete(server, n); scrollTo({ top: 0, behavior: 'smooth' }); }
  if (b.id === 'saveCancel') cancelSave();
  if (b.dataset.play) {
    const r = data.recordings.find((x) => x.id === b.dataset.play); if (!r) return;
    playing = { rec: r, frames: [], events: [], startMs: 0 }; $('events').innerHTML = ''; show($('trackRow'), false); show($('saveThis'), false); fail('');
    play(r, r.cam ? Date.parse(r.startedAt) : 0, `${recName(r)}, ${when(r.startedAt)}`);
    scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (b.dataset.event != null && playing?.events) {
    const ev = playing.events[+b.dataset.event], cam = playing.athlete?.src !== 'upload' && playing.athlete?.cam;
    const at = (ev.from ?? ev.t) - 1500, rec = cam ? recordingAt(cam, at) || playing.rec : playing.rec;
    play(rec, at, $('playerTitle').textContent, playing.athlete?.src === 'upload');
  }
  if (b.dataset.number) {
    const x = data.numbers.find((y) => y.id === b.dataset.number); if (!x) return;
    const at = x.src === 'upload' ? ((x.firstT ?? 0) * 1000) - 2000 : Date.parse(x.firstAt) - 2000;
    const rec = x.src === 'upload' ? data.recordings.find((r) => r.file === (data.sources[x.video] || x.video)) : recordingAt(x.cam, at);
    if (!rec) { fail('That video has gone, or is still on its way to storage. Try again in a few minutes.'); return; }
    fail(''); playing = { rec, frames: [], events: [], startMs: 0 }; $('events').innerHTML = ''; show($('trackRow'), false); show($('saveThis'), false);
    play(rec, Math.max(0, at), `Number ${x.number} · ${sourceName(x)}`, x.src === 'upload');
    scrollTo({ top: 0, behavior: 'smooth' });
  }
});
const fail = (msg) => { $('error').textContent = msg || ''; show($('error'), !!msg); };
for (const id of ['find', 'day', 'source', 'from', 'to', 'allRecs']) $(id).addEventListener(id === 'find' ? 'input' : 'change', draw);

async function enter() {
  const me = await getMe(true);
  if (!me.user) { signOut(); return start(); }
  // only an admin or a referee an admin added signs in here: anyone else is signed straight back out
  const { company: c } = await call('companies/mine').catch(() => ({}));
  if (!c && !me.admin) {
    signOut(); show($('signIn'), true);
    $('signInError').textContent = `${me.user.email || 'That account'} isn't on the list of referees. Ask an admin to add the address you sign in with.`;
    show($('signInError'), true);
    return start();
  }
  $('who').textContent = me.user.email;
  show($('signIn'), false);
  if (c) document.title = `Results: ${c.name}`; // the site's own look and name (study.css), not company colours
  // the console's tabs: this is Results while the servers are off (while they're on, Results is the video review's)
  Promise.all([call('servers/mine'), call('servers/mine/history')]).then(([{ server }, { bookings }]) => {
    drawAppTabs($('appTabs'), { active: 'results', server, hasBookings: bookings.length > 0, onError: fail });
  }).catch(() => { /* no company: no tabs */ });
  try {
    const [results, recs] = await Promise.all([call('recordings/results'), call('recordings')]);
    data = { athletes: results.athletes, numbers: results.numbers, sources: results.sources, merged: results.merged || [], deep: results.deep || [], recordings: recs.recordings };
    $('keepNote').textContent = `Your recordings, athletes and numbers for the last ${results.keepDays} days. Download anything you want to keep: after ${results.keepDays} days it's deleted.`;
    fillFilters();
    // a link from the Assistant (21 November 2026): results.html?bib=123&day=2026-11-20&athlete=<server>~<n> opens on that athlete's
    // number and day, and plays their video
    const p = new URLSearchParams(location.search), wantDay = p.get('day') || '';
    if (p.get('bib')) $('find').value = p.get('bib').replace(/\D/g, '').slice(0, 8);
    if (wantDay && [...$('day').options].some((o) => o.value === wantDay)) $('day').value = wantDay;
    draw(); drawDeep(); show($('content'), true);
    const watch = p.get('athlete') && [...document.querySelectorAll('[data-watch]')].find((b) => b.dataset.watch === p.get('athlete'));
    if (watch) { watch.scrollIntoView({ block: 'center' }); watch.click(); }
    requestAnimationFrame(drawTrack);
  } catch (e) { fail(e.message); }
}
// A crowd in front of a camera is more than its live judge can follow, so the server counts that recording again in full
// afterwards (a deep analysis: server/deep.js). Said here while one is still going, or when one never finished: until it has,
// that recording's counts are the live judge's, and low.
export function deepLines(list) {
  return (list || []).map((d) => {
    const cam = d.cam, day = new Date(d.startedAt).toLocaleDateString([], { day: 'numeric', month: 'short' }), at = new Date(d.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (d.state === 'running') return { live: true, text: `Deep analysis running on the server: camera ${cam}, the recording made on ${day} at ${at}, ${d.pct}%. A crowd was in view, more than a live judge can follow, so it is being counted again in full. Its counts here will change when that's done.` };
    if (['preparing', 'queued', 'waiting'].includes(d.state)) return { live: true, text: `Deep analysis waiting on the server: camera ${cam}, the recording made on ${day} at ${at}. A crowd was in view, so it will be counted again in full. Its counts here will change when that's done.` };
    if (d.state === 'done') return d.kept === 'fewer' ? { text: `Deep analysis: camera ${cam}, the recording made on ${day} at ${at}, was counted again in full, but that found fewer reps than the live judge did, so both are listed.` } : null;
    return { bad: true, text: `Deep analysis not finished: camera ${cam}, the recording made on ${day} at ${at}. A crowd was in view, more than a live judge can follow, and the server stopped before it could be counted again in full, so its counts are low. To count it, start a server and choose it under A previous recording in the video review's Results.` };
  }).filter(Boolean);
}
function drawDeep() {
  const lines = deepLines(data.deep).slice(0, 8);
  $('deepNote').innerHTML = lines.map((l) => `<p class="${l.live ? 'going' : l.bad ? 'bad' : ''}">${esc(l.text)}</p>`).join('');
  show($('deepNote'), lines.length > 0);
}
async function start() {
  if (signedIn()) return enter();
  show($('signIn'), true);
  const failed = (e) => { $('signInError').textContent = e.message || 'Sign-in didn\'t work: try again'; show($('signInError'), true); };
  microsoftButton($('msBtn'), 'results.html', failed);
  await devSignInButton($('devBtn'), () => enter(), failed);
}
start();
