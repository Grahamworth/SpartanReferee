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
const CLIP_MS = 12 * 60e3; // a recording is cut every 10 minutes, so anything starting within this could hold a moment

let data = { athletes: [], numbers: [], recordings: [], sources: {}, merged: [] };
let playing = null; // { rec, athlete, frames, events, startMs }

const dayKey = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayLabel = (k) => new Date(`${k}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const when = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const size = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);
const plainName = (file) => String(file || '').replace(/^\d{4}-\d\d-\d\dT[\d-]+Z?_/, '');
const recName = (r) => (r.cam ? `Camera ${r.cam}` : r.name || plainName(r.file) || 'Uploaded video');
const sourceOf = (x) => (x.src === 'upload' ? `v:${x.video}` : `c:${x.cam}`);
const sourceName = (x) => (x.src === 'upload' ? plainName(x.video) : `Camera ${x.cam}`);
const athleteDay = (a) => dayKey(a.firstAt);

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
  const athletes = combined(data.athletes).filter((a) => (!q || String(a.bib || '').includes(q)) && (!day || athleteDay(a) === day) && (!source || sourceOf(a) === source || (a.other && sourceOf(a.other) === source)));
  $('athleteCount').textContent = athletes.length ? `(${athletes.length})` : '';
  $('athletes').innerHTML = athletes.map((a) => `<article class="pastCard">
      ${a.pic ? `<img src="${esc(a.pic)}" alt="">` : ''}
      <div><b class="reps">${esc(a.reps ?? 0)}</b> rep${a.reps === 1 ? '' : 's'}${a.noReps ? ` · ${esc(a.noReps)} no rep${a.noReps === 1 ? '' : 's'}` : ''}
        <small><b>${a.bib && a.bib !== 'No number' ? `Number ${esc(a.bib)}` : `Athlete ${esc(a.label ?? a.n)}`}</b> · ${a.other ? `Cameras ${esc(a.cam)} + ${esc(a.other.cam)}` : esc(sourceName(a))}</small>${a.other ? `
        <small>Camera ${esc(a.cam)}: ${esc(a.both.counts[0])} · Camera ${esc(a.other.cam)}: ${esc(a.both.counts[1])} · ${esc(a.both.both)} seen on both</small>` : ''}
        <small>${esc(dayLabel(athleteDay(a)))}, ${a.src === 'upload' && a.firstT != null ? `${esc(mmss(a.firstT))} in the video` : esc(when(a.firstAt))}</small></div>
      <div class="pastActions"><button class="small" type="button" data-watch="${esc(a.server)}~${esc(a.n)}">${a.other ? `Watch camera ${esc(a.cam)}` : 'Watch'}</button>${a.other ? `<button class="small" type="button" data-watch="${esc(a.server)}~${esc(a.other.n)}">Watch camera ${esc(a.other.cam)}</button>` : ''}</div>
    </article>`).join('') || `<p class="muted">${data.athletes.length ? 'Nobody matches that.' : 'No athletes in the last 7 days.'}</p>`;
  const numbers = data.numbers.filter((x) => (!q || x.number.includes(q)) && (!day || dayKey(x.firstAt) === day) && (!source || sourceOf(x) === source));
  $('numbers').innerHTML = numbers.map((x) => `<div class="pastRow"><div><b>${esc(x.number)}</b><small>${esc(sourceName(x))} · ${esc(dayLabel(dayKey(x.firstAt)))}, ${x.src === 'upload' && x.firstT != null ? `${esc(mmss(x.firstT))} in the video` : esc(when(x.firstAt))}</small></div>
      <button class="small" type="button" data-number="${esc(x.id)}">Go to it</button></div>`).join('') || `<p class="muted">${data.numbers.length ? 'None match that.' : 'No numbers were shown.'}</p>`;
  const recs = data.recordings.filter((r) => (!day || dayKey(r.startedAt) === day) && (!source || source === (r.cam ? `c:${r.cam}` : `f:${r.file}`) || source === `v:${r.file}`));
  $('recordings').innerHTML = recs.map((r) => `<div class="pastRow"><div><b>${esc(recName(r))}</b><small>${esc(dayLabel(dayKey(r.startedAt)))}, ${esc(when(r.startedAt))} · ${esc(size(r.size))}</small></div>
      <div class="pastActions"><button class="small" type="button" data-play="${esc(r.id)}">Play</button><a class="small" href="${esc(r.download)}" download>Download</a></div></div>`).join('') || '<p class="muted">No recordings in the last 7 days.</p>';
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
function play(rec, at, title) {
  playing = { ...playing, rec, startMs: rec.cam ? Date.parse(rec.startedAt) : 0 };
  show($('stageNote'), false); show(video, true); show($('playerHead'), true);
  $('playerTitle').textContent = title;
  $('playerDownload').href = rec.download;
  const seek = () => { video.currentTime = Math.max(0, (at - playing.startMs) / 1000); video.play().catch(() => {}); };
  if (video.getAttribute('src') === rec.url && video.readyState > 0) seek();
  else { video.onloadedmetadata = seek; video.src = rec.url; }
}
// a live camera's recording is cut every 10 minutes: carry on into the next piece
video.addEventListener('ended', () => {
  const rec = playing?.rec; if (!rec?.cam) return;
  const after = data.recordings.filter((r) => r.cam === rec.cam && Date.parse(r.startedAt) > Date.parse(rec.startedAt)).sort((x, y) => Date.parse(x.startedAt) - Date.parse(y.startedAt))[0];
  if (after && Date.parse(after.startedAt) - Date.parse(rec.startedAt) < CLIP_MS) play(after, Date.parse(after.startedAt), $('playerTitle').textContent);
});
function drawTrack() {
  requestAnimationFrame(drawTrack);
  const frames = playing?.frames, want = !!frames?.length && $('showTrack').checked && !video.hidden;
  if (canvas.hidden === want) canvas.hidden = !want;
  if (!want || !video.videoWidth) return;
  const box = video.getBoundingClientRect(), ratio = window.devicePixelRatio || 1, W = Math.round(box.width * ratio), H = Math.round(box.height * ratio);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  ctx.clearRect(0, 0, W, H);
  const T = playing.startMs + video.currentTime * 1000;
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (frames[m][0] <= T) lo = m; else hi = m - 1; }
  const f = frames[lo]; if (Math.abs(f[0] - T) > SEEN_MS) return;
  const k = Math.min(W / video.videoWidth, H / video.videoHeight), dw = video.videoWidth * k, dh = video.videoHeight * k, ox = (W - dw) / 2, oy = (H - dh) / 2;
  const pt = (p) => { const i = pointIndex.get(p), x = f[2 + i * 2], y = f[3 + i * 2]; return x < 0 || y < 0 ? null : { x: ox + (x / 10000) * dw, y: oy + (y / 10000) * dh }; };
  const colour = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3ddc97';
  ctx.strokeStyle = colour; ctx.lineWidth = Math.max(2, W / 320); ctx.lineCap = 'round';
  ctx.beginPath();
  for (const [a, b] of BONES) { const m = pt(a), n = pt(b); if (m && n) { ctx.moveTo(m.x, m.y); ctx.lineTo(n.x, n.y); } }
  ctx.stroke();
  ctx.fillStyle = '#fff';
  const seen = [];
  for (const p of POINTS) { const m = pt(p); if (m) { seen.push(m); ctx.beginPath(); ctx.arc(m.x, m.y, Math.max(2.5, W / 400), 0, 7); ctx.fill(); } }
  if (seen.length) drawCount(T, seen, W, H, colour);
}
// The athlete's count at that moment, just above their head, as the judge showed it live: green for a moment after a rep, red after a no rep.
function countAt(T) {
  let count = 0, noReps = 0, last = null;
  for (const e of playing.events || []) { if (e.t > T) break; count = e.count ?? count; if (e.type !== 'rep') noReps++; last = e; }
  return { count, noReps, flash: last && T - last.t < 700 ? (last.type === 'rep' ? 'good' : 'bad') : null };
}
function drawCount(T, seen, W, H, colour) {
  const a = playing.athlete; if (!a) return;
  const { count, noReps, flash } = countAt(T);
  const fs = Math.max(14, Math.round(H / 24));
  const name = a.bib && a.bib !== 'No number' ? `#${a.bib}` : `Athlete ${a.label ?? a.n}`;
  const text = `${name}  ${count}${noReps ? `  · ${noReps} ✕` : ''}`;
  ctx.font = `700 ${fs}px Barlow, Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  const tw = ctx.measureText(text).width + fs, x = Math.min(W - tw / 2, Math.max(tw / 2, seen.reduce((s, m) => s + m.x, 0) / seen.length));
  const y = Math.max(fs * 1.4, Math.min(...seen.map((m) => m.y)) - fs * 0.5);
  ctx.fillStyle = flash === 'good' ? '#22c55e' : flash === 'bad' ? '#e2231a' : colour;
  ctx.fillRect(x - tw / 2, y - fs * 1.2, tw, fs * 1.25);
  ctx.fillStyle = flash ? '#fff' : '#000';
  ctx.fillText(text, x, y);
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
}
async function watch(server, n) {
  const a = data.athletes.find((x) => x.server === server && String(x.n) === String(n)); if (!a) return;
  const rec = recordingFor(a);
  const title = `${a.bib && a.bib !== 'No number' ? `Number ${a.bib}` : `Athlete ${a.label ?? a.n}`} · ${sourceName(a)}`;
  if (!rec) { fail('That video has gone, or is still on its way to storage. Try again in a few minutes.'); return; }
  fail('');
  const t = await call(`recordings/track/${encodeURIComponent(`${server}~${n}`)}`).catch(() => ({ frames: [], events: [] }));
  playing = { rec, athlete: a, frames: t.frames, events: t.events, startMs: 0 };
  show($('trackRow'), t.frames.length > 0);
  $('events').innerHTML = t.events.map((e, i) => `<button type="button" class="${e.type === 'rep' ? '' : 'bad'}" data-event="${i}" title="${esc((e.reasons || []).join(' · '))}">${e.type === 'rep' ? `✓ Rep ${esc(e.count)}` : '✗ No rep'}</button>`).join('');
  const start = t.frames[0]?.[0] ?? (a.src === 'upload' ? (a.firstT ?? 0) * 1000 : Date.parse(a.firstAt));
  play(rec, Math.max(0, start - 1000), title);
  scrollTo({ top: 0, behavior: 'smooth' });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.watch) { const [server, n] = b.dataset.watch.split('~'); watch(server, n); }
  if (b.dataset.play) {
    const r = data.recordings.find((x) => x.id === b.dataset.play); if (!r) return;
    playing = { rec: r, frames: [], events: [], startMs: 0 }; $('events').innerHTML = ''; show($('trackRow'), false); fail('');
    play(r, r.cam ? Date.parse(r.startedAt) : 0, `${recName(r)}, ${when(r.startedAt)}`);
    scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (b.dataset.event != null && playing?.events) {
    const ev = playing.events[+b.dataset.event], cam = playing.athlete?.src !== 'upload' && playing.athlete?.cam;
    const at = (ev.from ?? ev.t) - 1500, rec = cam ? recordingAt(cam, at) || playing.rec : playing.rec;
    play(rec, at, $('playerTitle').textContent);
  }
  if (b.dataset.number) {
    const x = data.numbers.find((y) => y.id === b.dataset.number); if (!x) return;
    const at = x.src === 'upload' ? ((x.firstT ?? 0) * 1000) - 2000 : Date.parse(x.firstAt) - 2000;
    const rec = x.src === 'upload' ? data.recordings.find((r) => r.file === (data.sources[x.video] || x.video)) : recordingAt(x.cam, at);
    if (!rec) { fail('That video has gone, or is still on its way to storage. Try again in a few minutes.'); return; }
    fail(''); playing = { rec, frames: [], events: [], startMs: 0 }; $('events').innerHTML = ''; show($('trackRow'), false);
    play(rec, Math.max(0, at), `Number ${x.number} · ${sourceName(x)}`);
    scrollTo({ top: 0, behavior: 'smooth' });
  }
});
const fail = (msg) => { $('error').textContent = msg || ''; show($('error'), !!msg); };
for (const id of ['find', 'day', 'source']) $(id).addEventListener(id === 'find' ? 'input' : 'change', draw);

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
    data = { athletes: results.athletes, numbers: results.numbers, sources: results.sources, merged: results.merged || [], recordings: recs.recordings };
    $('keepNote').textContent = `Your recordings, athletes and numbers for the last ${results.keepDays} days. Download anything you want to keep: after ${results.keepDays} days it's deleted.`;
    fillFilters(); draw(); show($('content'), true);
    requestAnimationFrame(drawTrack);
  } catch (e) { fail(e.message); }
}
async function start() {
  if (signedIn()) return enter();
  show($('signIn'), true);
  const failed = (e) => { $('signInError').textContent = e.message || 'Sign-in didn\'t work: try again'; show($('signInError'), true); };
  microsoftButton($('msBtn'), 'results.html', failed);
  await devSignInButton($('devBtn'), () => enter(), failed);
}
start();
