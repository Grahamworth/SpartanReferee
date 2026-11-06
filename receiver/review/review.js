'use strict';
// The review page, on the laptop and on an iPad.
//  Live: every camera live with its AI judge (tracking shown or hidden per camera), the timeline to rewind through
//        everything recorded, a marker for each athlete picked up, both cameras or one, Pick athlete.
//  Upload video: every frame analysed first, with the results beside it; everyone it tracks joins the AI judge list.
//  AI judge: everyone tracked (picture, number, when and how long on screen, reps), filtered by number, camera,
//        source and time: Watch them in the recording, or a detailed analysis (heavy pose model) to check the count.
//  Log: camera connect/lost events.
// The day picker shows any day's history; the number search finds an athlete from any tab.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = (n, w = 2) => String(n).padStart(w, '0');
const hms = (d, tenths) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${tenths ? '.' + Math.floor(d.getMilliseconds() / 100) : ''}`;
const dayStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localInput = (d) => `${dayStr(d)}T${hms(d)}`;
const mss = (s) => `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}`;
const span = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${pad(s % 60)} s`; };
const params = new URLSearchParams(location.search);
const device = params.get('device') || (/iPad|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document ? 'iPad' : /iPhone|Android/.test(navigator.userAgent) ? 'Phone' : 'Browser');
let st = null, skew = 0;   // the laptop's state; laptop clock − this device's clock (ms)

function toast(s) { const t = $('toast'); t.textContent = s; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2500); }
const laptopNow = () => new Date(Date.now() + skew);
$('who').textContent = `${device} · laptop time`;

// ---------------------------------------------------------------- tabs
// The Upload tab is moved out of sight rather than hidden, so a video being judged carries on.
document.querySelectorAll('header .tabs button').forEach((b) => b.onclick = () => showTab(b.dataset.tab));
function showTab(name) {
  document.querySelectorAll('header .tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  for (const p of document.querySelectorAll('.pane')) {
    if (p.id === 'upload') p.classList.toggle('offstage', name !== 'upload');
    else p.hidden = p.id !== name;
  }
  if (name !== 'live') pauseAll();
  if (name === 'upload') loadUploads();
  if (name === 'judge') renderAthletes(true);
  renderSides();
  if (name === 'live' && !clipStart && !live && st) { if (isToday()) goLive(); else openDay(); }
  placeDock();
}

// ---------------------------------------------------------------- the day shown
// Today by default (live); any earlier day shows that day's recordings, athletes and log.
let dayKey = dayStr(new Date());
const isToday = () => dayKey === dayStr(laptopNow());
function dayBounds() { const [y, m, d] = dayKey.split('-').map(Number); const a = new Date(y, m - 1, d).getTime(); return [a, new Date(y, m - 1, d + 1).getTime()]; }
async function loadDays() {
  const days = await fetch('/api/days').then((r) => r.json()).catch(() => null) || [];
  const today = dayStr(laptopNow()), yest = dayStr(new Date(laptopNow().getTime() - 864e5));
  if (!days.includes(today)) days.unshift(today);
  if (!days.includes(dayKey)) days.push(dayKey);
  const label = (k) => { if (k === today) return 'Today'; if (k === yest) return 'Yesterday'; const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: y === new Date().getFullYear() ? undefined : 'numeric' }); };
  const html = days.map((k) => `<option value="${esc(k)}">${esc(label(k))}</option>`).join('');
  if ($('day').dataset.html !== html) { $('day').innerHTML = html; $('day').dataset.html = html; }
  $('day').value = dayKey;
}
$('day').onchange = () => {
  dayKey = $('day').value; athRev = -1; $('athletePop').hidden = true;
  loadAthletes(); logSig = ''; renderLog();
  if (isToday()) goLive(); else openDay();
};
setInterval(loadDays, 60000);

// ---------------------------------------------------------------- the laptop's state, every second
async function poll() {
  try {
    const t0 = Date.now();
    const r = await fetch('/api/state', { cache: 'no-store' });
    const s = await r.json();
    skew = Date.parse(s.now) - (t0 + Date.now()) / 2;
    const first = !st;
    st = s; $('offline').hidden = true;
    if (first) { loadDays(); if (isToday()) goLive(); else openDay(); }
  } catch { $('offline').hidden = false; return; }
  // (a mistake drawing the page isn't the laptop being out of reach)
  for (const f of [renderJudges, renderViewPick, renderLog]) { try { f(); } catch (e) { console.error(e); } }
  if (st.athletesRev !== athRev) loadAthletes();
}
setInterval(poll, 1000); poll();
setInterval(() => { $('clock').textContent = hms(laptopNow()); }, 200);

// ---------------------------------------------------------------- AI judge on each live camera
// Each live camera gets the Burpee Judge (served by the laptop, models built in) judging its stream. They always run:
// on the Live tab while it's live they are the cameras; otherwise they carry on out of sight. A camera with its judge
// off shows its plain live picture.
const judges = {};   // n → { tile, frame, view }
const judgeUrl = (n) => '/judge/judge.html?stream=' + encodeURIComponent(`http://${location.hostname}:${st.webrtcPort}/live/station${n}/whep`) + `&go=1&cfg=cam${n}`;
const camName = (n) => { try { return (JSON.parse(localStorage.getItem('burpeeJudge.settings.cam' + n)) || {}).station || ''; } catch { return ''; } };
const aiOff = (n) => { try { return localStorage.getItem('review.aiOn.' + n) !== '1'; } catch { return true; } };
function renderJudges() {
  if (!st) return;
  for (const c of st.cams) {
    let j = judges[c.n];
    if (!j) {
      const tile = document.createElement('div');
      tile.className = 'jtile'; tile.dataset.cam = c.n;
      tile.innerHTML = `<div class="msg">Waiting for camera ${c.n}</div><div class="label">Camera ${c.n}</div><span class="livetag">LIVE</span>
        <div class="tools"><button class="btn track"></button><button class="btn cfg" title="This camera's AI judge settings">⚙ Config</button></div>`;
      tile.onclick = (e) => { if (!e.target.closest('button')) toggleBig(c.n); };
      tile.querySelector('.cfg').onclick = (e) => { e.stopPropagation(); openCamSettings(c.n); };
      tile.querySelector('.track').onclick = (e) => { e.stopPropagation(); if (aiOff(c.n)) openCamSettings(c.n, true); else setAi(c.n, false); };
      $('judgeGrid').appendChild(tile);
      j = judges[c.n] = { tile, frame: null, view: null };
      applyView();
    }
    j.tile.classList.toggle('live', c.live);
    // a camera's judge starts once it's live, then stays (it reconnects by itself if the camera drops)
    if (c.live && !j.frame && !aiOff(c.n)) {
      j.view?.pc?.close(); j.view?.video.remove(); j.view = null;
      j.frame = document.createElement('iframe');
      j.frame.title = `AI judge camera ${c.n}`;
      j.frame.allow = 'autoplay; fullscreen';
      j.frame.src = judgeUrl(c.n);
      // a click on the picture (not on the judge's own buttons) makes the camera big
      j.frame.addEventListener('load', () => { try { j.frame.contentDocument.addEventListener('click', (e) => { if (!e.target.closest('button, a, input, select, label, dialog')) toggleBig(c.n); }); } catch { /* not ready */ } });
      j.tile.querySelector('.msg')?.remove();
      j.tile.prepend(j.frame);
    }
    const off = aiOff(c.n), t = j.tile.querySelector('.track');
    t.textContent = off ? '▶ Start AI judge' : '■ Stop AI judge'; t.classList.toggle('red', off);
    if (off && c.live) plainView(c.n, j); else if (j.view && !c.live) { j.view.pc?.close(); j.view.video.remove(); j.view = null; }
    if (!c.live && !j.frame && !j.tile.querySelector('.msg')) j.tile.insertAdjacentHTML('afterbegin', `<div class="msg">Waiting for camera ${c.n}</div>`);
    const nm = camName(c.n); j.tile.querySelector('.label').innerHTML = `Camera ${c.n}${nm ? `<small>${esc(nm)}</small>` : ''}${off ? '<small>AI judge off</small>' : ''}`;
  }
}
function setAi(n, on) {
  try { localStorage.setItem('review.aiOn.' + n, on ? '1' : ''); } catch { /* private mode */ }
  const j = judges[n]; if (!j) return;
  if (!on && j.frame) { saveRound(j).finally(() => { j.frame?.remove(); j.frame = null; renderJudges(); }); return; }
  renderJudges();
}
// a judge's round in progress is saved before it's stopped or restarted (its athletes' records are completed)
async function saveRound(j) { try { await j.frame?.contentWindow?.__finishRound?.(); } catch { /* not ready */ } }
async function restartJudges() { for (const [n, j] of Object.entries(judges)) if (j.frame) { await saveRound(j); j.frame.src = judgeUrl(+n); } }
$('judgeRestart').onclick = () => { restartJudges(); toast('Judges restarted'); };
// one camera big; click it again for all of them
function toggleBig(n) {
  const j = judges[n]; if (!j) return;
  const big = !j.tile.classList.contains('big');
  for (const x of Object.values(judges)) x.tile.classList.remove('big');
  j.tile.classList.toggle('big', big); $('judgeGrid').classList.toggle('focused', big);
}
// a camera with its judge off: its live picture (WebRTC straight from the streaming server)
function plainView(n, j) {
  if (j.view) { const ok = j.view.pc && j.view.pc.connectionState === 'connected'; if (ok || j.view.connecting) return; }
  if (!j.view) {
    const video = Object.assign(document.createElement('video'), { muted: true, autoplay: true, playsInline: true });
    video.className = 'plain';
    j.tile.querySelector('.msg')?.remove();
    j.tile.prepend(video);
    j.view = { video, pc: null, connecting: false };
  }
  const v = j.view; v.connecting = true;
  (async () => {
    try {
      v.pc?.close();
      const pc = v.pc = new RTCPeerConnection();
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.ontrack = (e) => { v.video.srcObject = e.streams[0] || new MediaStream([e.track]); v.video.play().catch(() => {}); };
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise((ok) => { if (pc.iceGatheringState === 'complete') ok(); pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && ok()); setTimeout(ok, 1500); });
      const res = await fetch(`http://${location.hostname}:${st.webrtcPort}/live/station${n}/whep`, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription.sdp });
      if (!res.ok) throw new Error(res.status);
      await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
      await new Promise((ok) => setTimeout(ok, 4000));
    } catch { await new Promise((ok) => setTimeout(ok, 2000)); }
    v.connecting = false;
  })();
}
// The judges sit in their own box (moving an iframe would restart it): laid over the Live tab's camera area while
// it's live, kept running out of sight otherwise.
function placeDock() {
  fitLive();
  const dock = $('judgeGrid'), spot = $('liveSpot');
  const show = !$('live').hidden && live && $('judgeSettings').hidden;
  dock.classList.toggle('offstage', !show);
  if (!show) { spot.style.height = '0px'; return; }
  const r = spot.getBoundingClientRect();
  dock.style.left = `${r.left + scrollX}px`; dock.style.top = `${r.top + scrollY}px`; dock.style.width = `${r.width}px`;
  spot.style.height = `${dock.offsetHeight}px`;
}
setInterval(placeDock, 300); addEventListener('resize', placeDock);
// the Live tab fits the window: the cameras take the height left under the controls (and above the replay bar)
function fitLive() {
  if ($('live').hidden) return;
  const top = (live ? $('liveSpot') : $('replayGrid')).getBoundingClientRect().top + scrollY;
  const bar = $('transport').hidden ? 0 : $('transport').offsetHeight + 12;
  document.documentElement.style.setProperty('--avail', `${Math.max(220, innerHeight - top - bar - 14)}px`);
}

// one camera's settings (from its ⚙ Config): the judge's settings for that camera, with Close / Save at its foot
let settingsFor = 0, startAfter = false;
function openCamSettings(n, start) {
  settingsFor = n; startAfter = !!start;
  $('settingsTitle').textContent = start ? `Start the AI judge on camera ${n}${camName(n) ? ' · ' + camName(n) : ''}` : `Camera ${n}${camName(n) ? ' · ' + camName(n) : ''} settings`;
  $('settingsNote').textContent = start ? 'Check its settings, then Save to start judging (Close: not now).' : 'Saved for this camera on this device. Save restarts its judge with them.';
  $('settingsFrame').src = `/judge/judge.html?settings=1&cfg=cam${n}`;
  if ($('live').hidden) showTab('live');
  $('judgeSettings').hidden = false; $('replayGrid').hidden = true; placeDock();
}
function closeCamSettings() { $('judgeSettings').hidden = true; $('replayGrid').hidden = false; $('settingsFrame').src = 'about:blank'; placeDock(); }
addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data || !e.data.judge) return;
  const cfg = String(e.data.cfg || '');
  if (cfg === 'upload') {
    if (e.data.judge === 'analysed') { $('upStatus').textContent = 'Analysis finished. Press play on the video to watch it, or Watch an athlete on the right.'; athRev = -1; loadAthletes(); return; }
    if (e.data.judge === 'close' || e.data.judge === 'saved') { $('upSettings').hidden = true; $('upSettingsFrame').src = 'about:blank'; }
    if (e.data.judge === 'saved' && upPending) { upPending.go = true; if (!upPending.saved) $('upStatus').textContent = 'Starting as soon as the video is on the laptop…'; upReady(); }
    else if (e.data.judge === 'saved') toast('Upload settings saved: used for the next video');
    else if (upPending) { upPending = null; $('upStatus').textContent = 'Not started. Judge it from the list below when you\'re ready.'; }
    return;
  }
  if (e.data.judge === 'exit') { const n = +cfg.replace(/\D/g, ''); if (n) setAi(n, false); return; }
  if (!$('rulesBox').hidden) { $('rulesBox').hidden = true; $('rulesFrame').src = 'about:blank'; return; }
  const n = settingsFor; closeCamSettings();
  if (e.data.judge === 'saved' && startAfter) { startAfter = false; setAi(n, true); toast(`AI judge started on camera ${n}`); return; }
  startAfter = false;
  if (e.data.judge === 'saved') { const j = judges[n]; if (j && j.frame) saveRound(j).then(() => { j.frame.src = judgeUrl(n); }); toast(`Camera ${n} settings saved`); }
});
// opened from a camera in the Receiver (?focus=1): that camera big, live
window.focusCamera = (n) => { showTab('live'); const tryIt = () => { if (judges[n]) { if (!judges[n].tile.classList.contains('big')) toggleBig(n); } else setTimeout(tryIt, 300); }; if (n) tryIt(); };

// ---------------------------------------------------------------- both cameras, or one
let viewCam = 0;
function renderViewPick() {
  const box = $('viewPick'); if (!st) return;
  const want = ['0', ...st.cams.map((c) => String(c.n))].join(',');
  if (box.dataset.want !== want) {
    box.dataset.want = want;
    box.innerHTML = [`<button class="btn" data-view="0">${st.cams.length > 2 ? 'All' : 'Both'}</button>`, ...st.cams.map((c) => `<button class="btn" data-view="${c.n}">Camera ${c.n}</button>`)].join('');
    box.querySelectorAll('button').forEach((b) => b.onclick = () => { viewCam = +b.dataset.view; applyView(); });
    applyView();
  }
}
function applyView() {
  for (const t of document.querySelectorAll('#replayGrid .tile, #judgeGrid .jtile')) t.hidden = !!viewCam && +t.dataset.cam !== viewCam;
  $('replayGrid').classList.toggle('single', !!viewCam); $('judgeGrid').classList.toggle('single', !!viewCam);
  $('viewPick').querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.view === viewCam));
}

// ---------------------------------------------------------------- Live: live by default, rewind through the recordings
// Drag the timeline back to any moment recorded and the recordings play from there, every camera in step, carrying
// on clip after clip; ● Live comes back. An earlier day (the day picker) shows that day's timeline.
const CHUNK = 180;   // seconds of recording loaded at a time
let live = false, tlFrom = 0, tlToFixed = 0, recSegs = {};
const tlEnd = () => (isToday() ? laptopNow().getTime() : tlToFixed);
async function goLive() {
  if (!st) return;
  if (!isToday()) { dayKey = dayStr(laptopNow()); $('day').value = dayKey; athRev = -1; loadAthletes(); logSig = ''; renderLog(); }
  ++replayGen; live = true; clipStart = null; pauseAll(); vids = []; master = null;
  $('goLive').classList.add('on'); $('goLive').disabled = false; $('transport').hidden = true; $('tlAt').textContent = 'LIVE'; $('timeline').value = 1000;
  $('replayGrid').innerHTML = '';
  placeDock();
  await loadTimeline();
}
// an earlier day: its timeline, starting at its first recording
async function openDay() {
  if (!st) return;
  ++replayGen; live = false; clipStart = null; pauseAll(); vids = []; master = null;
  $('goLive').classList.remove('on'); $('transport').hidden = true;
  await loadTimeline();
  if (tlToFixed > tlFrom) replay(new Date(tlFrom), Math.min(CHUNK, Math.floor((tlToFixed - tlFrom) / 1000)), false);
  else { $('replayGrid').innerHTML = '<p class="muted">Nothing was recorded on this day.</p>'; $('tlAt').textContent = '--:--:--'; }
  placeDock();
}
// the timeline runs from the day's oldest recording kept to now (today) or its last recording
async function loadTimeline() {
  const [a, b] = dayBounds();
  let oldest = Infinity, newest = 0; recSegs = {};
  for (const c of st.cams) {
    const list = await fetch(`/api/recorded?cam=${c.n}`).then((x) => x.json()).catch(() => []);
    recSegs[c.n] = list.map((x) => [Date.parse(x.start), Date.parse(x.start) + x.duration * 1000]).filter(([s, e]) => e > a && s < b);
    for (const [s, e] of recSegs[c.n]) { oldest = Math.min(oldest, s); newest = Math.max(newest, e); }
  }
  tlFrom = Math.max(a, oldest === Infinity ? (isToday() ? laptopNow().getTime() - 3600e3 : a) : oldest);
  tlToFixed = Math.min(b, newest || b);
  showRanges(); renderMarkers(true);
}
function showTimeline(at) { if (scrubTl) return; $('timeline').value = Math.round(1000 * (at - tlFrom) / Math.max(1, tlEnd() - tlFrom)); $('tlAt').textContent = hms(new Date(at)); }
let scrubTl = false;
const tlTime = () => tlFrom + ($('timeline').value / 1000) * (tlEnd() - tlFrom);
$('timeline').oninput = () => { scrubTl = true; const at = tlTime(); $('tlAt').textContent = isToday() && laptopNow() - at < 8000 ? 'LIVE' : hms(new Date(at)); };
$('timeline').onchange = () => {
  scrubTl = false; const at = tlTime(), end = tlEnd();
  if (isToday() && laptopNow() - at < 8000) goLive(); else replay(new Date(at), Math.max(3, Math.min(CHUNK, Math.floor((end - at) / 1000) - 2)), true);
};
$('goLive').onclick = () => goLive();
setInterval(() => { if (live && !scrubTl) $('timeline').value = 1000; renderMarkers(); }, 3000);

// what's been recorded on the day, per camera (gaps show when a camera was lost)
function showRanges() {
  if (!st) return;
  const out = st.cams.map((c) => {
    const merged = [];
    for (const [a, b] of recSegs[c.n] || []) { const last = merged[merged.length - 1]; if (last && a - last[1] < 3000) last[1] = Math.max(last[1], b); else merged.push([a, b]); }
    return `<b>Camera ${c.n}</b>: ${merged.length ? merged.slice(-4).map(([a, b]) => `${hms(new Date(a))}–${hms(new Date(b))}`).join(', ') : 'nothing recorded'}`;
  });
  $('ranges').innerHTML = 'Recorded: ' + out.join(' &nbsp;·&nbsp; ');
}

// ---------------------------------------------------------------- replay: every camera, the same moment, in step
let clipStart = null, clipDur = 0, vids = [], master = null;
$('when').value = localInput(laptopNow());
$('go').onclick = () => { const t = new Date($('when').value); if (!isNaN(t)) replay(new Date(t.getTime() - lead() * 1000)); };
document.querySelectorAll('[data-ago]').forEach((b) => b.onclick = () => replay(new Date(laptopNow().getTime() - +b.dataset.ago * 1000), +b.dataset.ago));
const lead = () => Math.round(+$('win').value / 4);   // start a little before the chosen time

let replayGen = 0;   // each replay; answers for an older one are ignored
async function replay(start, dur, autoplay) {
  if (!st) return toast('Can\'t reach the laptop yet');
  const gen = ++replayGen;
  if ($('live').hidden) showTab('live');
  if (dayStr(start) !== dayKey) { dayKey = dayStr(start); $('day').value = dayKey; athRev = -1; loadAthletes(); await loadTimeline(); }
  else if (!tlFrom) loadTimeline();
  live = false; $('goLive').classList.remove('on'); placeDock();
  clipDur = dur || +$('win').value;
  // a clip can't run past now: the camera hasn't recorded it yet
  const maxDur = (laptopNow() - start) / 1000 - 2;
  if (maxDur < clipDur) clipDur = Math.max(3, Math.floor(maxDur));
  clipStart = start;
  $('when').value = localInput(new Date(start.getTime() + lead() * 1000));
  const grid = $('replayGrid'); grid.innerHTML = ''; vids = []; master = null;
  for (const c of st.cams) {
    const src = `/clip?cam=${c.n}&start=${encodeURIComponent(start.toISOString())}&duration=${clipDur}`;
    const tile = document.createElement('div');
    tile.className = 'tile'; tile.dataset.cam = c.n;
    tile.innerHTML = `<video playsinline muted preload="auto"></video><div class="label">Camera ${c.n}<small>replay</small></div><div class="msg">Loading…</div><a class="dl" href="${src}&download=1">Save clip</a><button class="btn cfgbtn" title="AI judge settings for this camera">⚙ Config</button>`;
    grid.appendChild(tile);
    const v = tile.querySelector('video'), msg = tile.querySelector('.msg');
    tile.querySelector('.cfgbtn').onclick = (e) => { e.stopPropagation(); openCamSettings(c.n); };
    tile.onclick = (e) => { if (e.target.closest('a, button')) return; if (picking) return pickAt(e, c.n, v); tile.classList.toggle('big'); };
    // ask first, so a missing recording says why
    fetch(src, { headers: { Range: 'bytes=0-0' } }).then(async (r) => {
      if (gen !== replayGen) return;
      if (!r.ok) { msg.textContent = (await r.json().catch(() => ({}))).error || 'No recording at that time'; tile.querySelector('.dl').remove(); return; }
      v.src = src;
      v.addEventListener('loadeddata', () => { msg.textContent = ''; if (!master) { master = v; hookMaster(); if (autoplay) v.play().catch(() => {}); } }, { once: true });
      v.addEventListener('error', () => { msg.textContent = 'Could not play this recording'; });
      vids.push(v);
    }).catch(() => { msg.textContent = 'Can\'t reach the laptop'; });
  }
  $('transport').hidden = false;
  setRate(1); updateAt(); applyView();
}
function hookMaster() {
  master.addEventListener('timeupdate', () => { updateAt(); sync(); });
  master.addEventListener('ended', () => {
    if (!clipStart) return;
    const next = new Date(clipStart.getTime() + clipDur * 1000);
    if (laptopNow() - next > 6000 && next.getTime() < tlEnd() - 2000) replay(next, Math.min(CHUNK, Math.floor((tlEnd() - next) / 1000)), true);
    else if (isToday()) goLive();
  });
  master.addEventListener('play', () => { $('play').textContent = 'Pause'; vids.forEach((v) => v !== master && v.play().catch(() => {})); });
  master.addEventListener('pause', () => { $('play').textContent = 'Play'; vids.forEach((v) => v !== master && v.pause()); sync(true); });
}
function sync(hard) {
  for (const v of vids) if (v !== master && v.readyState > 0 && Math.abs(v.currentTime - master.currentTime) > (hard ? 0.02 : 0.15)) v.currentTime = master.currentTime;
}
function seek(t) { t = Math.max(0, Math.min(clipDur, t)); vids.forEach((v) => { if (v.readyState > 0) v.currentTime = t; }); updateAt(t); }
function pauseAll() { vids.forEach((v) => v.pause()); }
function setRate(r) { vids.forEach((v) => { v.playbackRate = r; }); document.querySelectorAll('[data-rate]').forEach((b) => b.classList.toggle('on', +b.dataset.rate === r)); }
function updateAt(t) {
  const cur = t !== undefined ? t : master ? master.currentTime : 0;
  if (!clipStart) return;
  $('at').textContent = hms(new Date(clipStart.getTime() + cur * 1000), true);
  showTimeline(clipStart.getTime() + cur * 1000);
  if (!scrubbing) $('scrub').value = Math.round((cur / clipDur) * 1000);
}
let scrubbing = false;
$('scrub').oninput = () => { scrubbing = true; seek(($('scrub').value / 1000) * clipDur); };
$('scrub').onchange = () => { scrubbing = false; };
$('play').onclick = () => { if (!master) return; master.paused ? master.play() : master.pause(); };
document.querySelectorAll('[data-step]').forEach((b) => b.onclick = () => { if (!master) return; master.pause(); seek(master.currentTime + +b.dataset.step); });
document.querySelectorAll('[data-rate]').forEach((b) => b.onclick = () => setRate(+b.dataset.rate));
// keyboard on the laptop: space play/pause, arrows step a frame, shift+arrows 5 s
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || $('live').hidden || !master) return;
  if (e.key === ' ') { e.preventDefault(); $('play').click(); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); master.pause(); seek(master.currentTime + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1 / 30)); }
});

// ---------------------------------------------------------------- Pick athlete: click someone in the recording
// The AI judge finds when they're on screen (up to 3 minutes either side) and analyses just that stretch in detail.
let picking = false;
function setPicking(on) { picking = on; document.body.classList.toggle('picking', on); $('pickHint').hidden = !on; }
$('pickBtn').onclick = $('pickBtnTop').onclick = async () => {
  if (live || !clipStart) { await replay(new Date(laptopNow().getTime() - 60000), 58); toast('The last minute is loaded: pause where the athlete is clear, then click them'); }
  pauseAll(); setPicking(true);
};
$('pickCancel').onclick = () => setPicking(false);
function pickAt(e, cam, v) {
  setPicking(false);
  // where in the picture, allowing for the black bars around it
  const r = v.getBoundingClientRect(), vw = v.videoWidth || 16, vh = v.videoHeight || 9;
  const scale = Math.min(r.width / vw, r.height / vh), w = vw * scale, h = vh * scale;
  const x = (e.clientX - r.left - (r.width - w) / 2) / w, y = (e.clientY - r.top - (r.height - h) / 2) / h;
  if (x < 0 || x > 1 || y < 0 || y > 1) return toast('Click on the picture itself');
  const at = clipStart.getTime() + (master ? master.currentTime : v.currentTime) * 1000;
  detailedAt(cam, at, at, x, y, `Camera ${cam} · athlete picked at ${hms(new Date(at))}`);
}

// ---------------------------------------------------------------- everyone the AI judges tracked (the chosen day)
let athRev = -1, athList = [], athLoading = false, numbersSeen = [];
async function loadAthletes() {
  if (athLoading) return; athLoading = true;
  try {
    const [a, b] = dayBounds();
    const r = await fetch(`/api/athletes?from=${encodeURIComponent(new Date(a).toISOString())}&to=${encodeURIComponent(new Date(b).toISOString())}`).then((x) => x.json()).catch(() => null);
    if (r) { athRev = r.rev; athList = r.list; numbersSeen = r.numbers || []; renderAthletes(); renderSides(); renderMarkers(true); fillCamFilter(); numSearch(); }
  } finally { athLoading = false; }
}
const athName = (a) => (a.bib && a.bib !== 'No number' ? `#${a.bib}` : `No number <small>(athlete ${a.label})</small>`);
const upName = (v) => String(v || '').replace(/^[\dTZ-]+_/, '');
const picUrl = (a) => (a.pic ? `/api/athlete-pic?n=${a.n}&v=${a.pic}` : '');
function whereText(a) { return a.src === 'upload' ? `Uploaded video · ${esc(upName(a.video))}` : `Camera ${a.cam}${camName(a.cam) ? ' · ' + esc(camName(a.cam)) : ''} · live`; }
function whenText(a) {
  const f = new Date(a.firstAt), l = new Date(a.lastAt);
  if (a.src === 'upload' && a.firstT != null) return `In the video ${mss(a.firstT)}–${mss(a.lastT)} (${span((a.lastT - a.firstT) * 1000)}) · judged at ${hms(f)}`;
  return `On screen ${hms(f)}–${hms(l)} (${span(l - f)})`;
}
const repsText = (a) => `<b>${Number(a.reps)}</b> reps${a.noReps ? ` · ${Number(a.noReps)} no reps` : ''} · ${a.done ? 'finished' : 'being judged'}`;

// the AI judge tab: the list, filtered
function fillCamFilter() {
  const cams = [...new Set([...(st ? st.cams.map((c) => c.n) : []), ...athList.filter((a) => a.src === 'live').map((a) => a.cam)])].sort((a, b) => a - b);
  const html = '<option value="">All</option>' + cams.map((n) => `<option value="${n}">Camera ${n}</option>`).join('');
  if ($('fCam').dataset.html !== html) { const v = $('fCam').value; $('fCam').innerHTML = html; $('fCam').dataset.html = html; $('fCam').value = v; }
}
function filtered() {
  const num = $('fNum').value.trim().toLowerCase(), cam = $('fCam').value, src = $('fSrc').value;
  const tod = (iso) => { const d = new Date(iso); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  const from = $('fFrom').value, to = $('fTo').value;
  return athList.filter((a) => (!num || (num === 'no' || num === 'none' ? !a.bib || a.bib === 'No number' : String(a.bib).toLowerCase().includes(num)))
    && (!cam || (a.src === 'live' && a.cam === +cam)) && (!src || a.src === src)
    && (!from || tod(a.lastAt) >= from) && (!to || tod(a.firstAt) <= to));
}
// an athlete's card: their count first, then who, where and what you can do
const shortName = (a) => (hasNum(a) ? `#${esc(a.bib)}` : `Athlete ${a.label}`);
const athBody = (a, lines) => `<div class="pic">${a.pic ? `<img src="${picUrl(a)}" alt="" loading="lazy">` : '<span>no picture</span>'}</div>
    <div class="info"><span class="reps"><b>${Number(a.reps)}</b> rep${Number(a.reps) === 1 ? '' : 's'}${a.noReps ? `<small> · ${Number(a.noReps)} no rep${Number(a.noReps) === 1 ? '' : 's'}</small>` : ''}</span><b class="num">${shortName(a)}</b>${lines}</div>
    <div class="acts"><button class="btn watch" data-watch="${a.n}">▶ Watch</button><button class="linkbtn" data-detail="${a.n}">Details</button><button class="btn del" data-del="${a.n}" title="Delete this entry" aria-label="Delete this entry">🗑</button></div>`;
let listSig = '';
function renderAthletes(force) {
  if ($('judge').hidden && !force) return;
  const list = filtered();
  const sig = JSON.stringify(list.map((a) => [a.n, a.bib, a.reps, a.noReps, a.done, a.pic, a.lastAt]));
  if (sig === listSig && !force) return; listSig = sig;
  const numbered = list.filter((a) => a.bib && a.bib !== 'No number').length;
  $('athleteSummary').textContent = athList.length ? `${list.length} athlete${list.length === 1 ? '' : 's'}${list.length < athList.length ? ` (of ${athList.length})` : ''} · ${numbered} with a number read` : 'Nobody tracked on this day yet. Turn the AI judge on for a camera (Live tab) or upload a video.';
  $('athleteList').innerHTML = list.map((a) => `<div class="ath${a.done ? '' : ' going'}" data-n="${a.n}">
    ${athBody(a, `<span>${whereText(a)}</span><span>${whenText(a)}</span>${a.done ? '' : '<span class="going">Being judged</span>'}`)}
  </div>`).join('');
}
// beside the cameras and the uploaded video: people who have finished or gone, with their own filters
const hasNum = (a) => a.bib && a.bib !== 'No number';
const sideMatch = (a, num, res) => (!num || (hasNum(a) && String(a.bib).toLowerCase().includes(num)))
  && (res !== 'reps' || a.reps > 0) && (res !== 'noreps' || (!a.reps && a.noReps > 0)) && (res !== 'nonum' || !hasNum(a));
const sideCard = (a) => `<div class="ath" data-n="${a.n}">
    ${athBody(a, a.src === 'upload' ? `<span>${mss(a.firstT ?? 0)}–${mss(a.lastT ?? 0)} in the video</span>` : `<span>Camera ${a.cam} · ${hms(new Date(a.lastAt))}</span>`)}
  </div>`;
function fillSide(el, count, list, total, empty) {
  const sig = JSON.stringify(list.map((a) => [a.n, a.bib, a.reps, a.noReps, a.pic, a.lastAt])) + empty;
  count.textContent = total ? `${list.length}${list.length < total ? ` of ${total}` : ''}` : '';
  if (el.dataset.sig === sig) return; el.dataset.sig = sig;
  el.innerHTML = list.map(sideCard).join('') || `<p class="empty">${esc(empty)}</p>`;
}
let upShown = '';   // the uploaded video whose results are beside it
function renderSides() {
  const cams = [...new Set([...(st ? st.cams.map((c) => c.n) : []), ...athList.filter((a) => a.src === 'live').map((a) => a.cam)])].sort((a, b) => a - b);
  const camHtml = '<option value="">All cameras</option>' + cams.map((n) => `<option value="${n}">Camera ${n}</option>`).join('');
  if ($('lsCam').dataset.html !== camHtml) { const v = $('lsCam').value; $('lsCam').innerHTML = camHtml; $('lsCam').dataset.html = camHtml; $('lsCam').value = v; }
  const live = athList.filter((a) => a.src === 'live' && a.done);
  const lNum = $('lsNum').value.trim().toLowerCase(), lCam = $('lsCam').value, lRes = $('lsRes').value;
  fillSide($('liveList'), $('liveCount'), live.filter((a) => (!lCam || a.cam === +lCam) && sideMatch(a, lNum, lRes)).sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt)), live.length,
    live.length ? 'Nobody matches these filters.' : 'Athletes appear here, newest first, once they finish or leave the picture.');
  // the latest judging of the video shown (Judge again makes a new one)
  const ofVideo = athList.filter((a) => a.src === 'upload' && a.video === upShown);
  const newest = ofVideo.reduce((x, a) => (!x || a.firstAt > x.firstAt ? a : x), null);
  const ups = ofVideo.filter((a) => a.done && a.round === newest?.round);
  const uNum = $('usNum').value.trim().toLowerCase(), uRes = $('usRes').value, order = $('usSort').value;
  fillSide($('upResults'), $('upCount'), ups.filter((a) => sideMatch(a, uNum, uRes)).sort(order === 'reps' ? (a, b) => b.reps - a.reps : (a, b) => (a.firstT ?? 0) - (b.firstT ?? 0)), ups.length,
    !upShown ? 'Choose a video to see its results here.' : ups.length ? 'Nobody matches these filters.' : 'Results appear here as the video is analysed.');
}
for (const id of ['lsNum', 'lsCam', 'lsRes', 'usNum', 'usRes', 'usSort']) $(id).addEventListener('input', renderSides);
$('lsClear').onclick = () => { for (const id of ['lsNum', 'lsCam', 'lsRes']) $(id).value = ''; renderSides(); };
$('usClear').onclick = () => { for (const id of ['usNum', 'usRes']) $(id).value = ''; $('usSort').value = 'video'; renderSides(); };
$('liveList').onclick = $('upResults').onclick = $('athleteList').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const a = athList.find((x) => x.n === +(b.dataset.watch || b.dataset.detail || b.dataset.del)); if (!a) return;
  if (b.dataset.del) { if (confirm(`Delete ${a.bib && a.bib !== 'No number' ? '#' + a.bib : 'athlete ' + a.label} from the AI judge list?`)) fetch(`/api/athlete?n=${a.n}`, { method: 'DELETE' }).then(() => { athRev = -1; loadAthletes(); toast('Deleted'); }); return; }
  if (b.dataset.watch) watch(a); else detailed(a);
};
for (const id of ['fNum', 'fCam', 'fSrc', 'fFrom', 'fTo']) $(id).addEventListener('input', () => renderAthletes(true));
$('fClear').onclick = () => { for (const id of ['fNum', 'fCam', 'fSrc', 'fFrom', 'fTo']) $(id).value = ''; renderAthletes(true); };

// Watch: the recording (or uploaded video) from just before they started, with what the AI judge saw drawn on it: their
// skeleton, their count beside them, each rep and no rep as it was given. A rep in the list below plays just that rep.
// (Times in a proof: ms into an uploaded video, or the laptop's clock for a live camera.)
const PROOF_POINTS = [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
const PROOF_BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32]].map((b) => b.map((i) => PROOF_POINTS.indexOf(i)));
const PROOF_CLIP = 600;   // seconds of a live recording loaded at once
let proof = null, proofLag = 0;
const pv = $('proofVideo');
try { proofLag = +localStorage.getItem('proofLag') || 0; } catch { /* not kept */ }
function showProofLag() { $('proofShift').textContent = `${proofLag > 0 ? '+' : ''}${(proofLag / 1000).toFixed(1)} s`; }
function watchInLive(a) {
  viewCam = a.cam;
  const t0 = Date.parse(a.firstAt) - 5000, t1 = Math.min(Date.parse(a.lastAt) + 8000, laptopNow().getTime() - 3000);
  replay(new Date(t0), Math.max(20, Math.min(600, Math.round((t1 - t0) / 1000))), true);
}
async function watch(a) {
  $('athletePop').hidden = true;
  showTab('judge');
  const r = await fetch(`/api/athlete-track?n=${a.n}`).then((x) => x.json()).catch(() => null);
  const frames = r?.frames || [], evs = r?.events || [], up = a.src === 'upload';
  const times = [...(frames.length ? [frames[0][0], frames.at(-1)[0]] : []), ...evs.flatMap((e) => (e.from != null ? [e.from, e.t] : [e.t])),
    ...(up ? [(a.firstT ?? 0) * 1000, ...(a.lastT != null ? [a.lastT * 1000] : [])] : [Date.parse(a.firstAt), Date.parse(a.lastAt)])];
  cancelAnimationFrame(proof?.raf);
  proof = { a, frames, evs, up, first: Math.min(...times) - 3000, last: Math.max(...times) + 3000, base: 0, dur: 0, stopAt: null, raf: 0 };
  if (up) proof.first = Math.max(0, proof.first);
  $('proofTitle').innerHTML = `${athName(a)} · ${up ? esc(upName(a.video)) : 'camera ' + a.cam}`;
  $('proofNote').textContent = frames.length ? 'What the AI judge saw: their skeleton and count as it judged them.' : 'No skeleton saved for this athlete: they were judged before this was added. Detailed analysis draws one.';
  $('proofLive').hidden = up; $('proofSync').hidden = up || !frames.length; showProofLag();
  const nth = (e) => (e.type === 'rep' ? `✓ Rep ${e.count}` : '✗ No rep');
  const stamp = (t) => (up ? mss(t / 1000) : hms(new Date(t)));
  $('proofReps').innerHTML = evs.map((e, i) => `<button class="btn ${e.type === 'rep' ? 'good' : 'bad'}" data-ev="${i}" title="${esc(e.reasons.join(' · '))}">${nth(e)} <small>${stamp(e.t)}${e.reasons.length ? ' · ' + esc(e.reasons[0]) : ''}</small></button>`).join('') || '<span class="muted small">No reps or no reps saved for this athlete.</span>';
  $('proof').hidden = false; $('athleteBox').hidden = true; $('analysis').hidden = true; $('rulesBox').hidden = true;
  setProofRate(1);
  proofGo(proof.first, true);
  proofDraw();
  scrollTo({ top: 0 });
}
// the recording at a time: a live camera's is cut from the recordings, a stretch at a time
function proofGo(at, play) {
  const p = proof; if (!p) return;
  at = Math.max(p.first, Math.min(p.last, at));
  const loaded = pv.getAttribute('src');
  let src;
  if (p.up) src = `/uploads/${encodeURIComponent(p.a.video)}`;
  else if (loaded && p.dur && at >= p.base && at < p.base + p.dur * 1000 - 500) src = loaded;
  else {
    const end = Math.min(p.last, laptopNow().getTime() - 3000);
    p.base = at; p.dur = Math.max(5, Math.min(PROOF_CLIP, Math.round((end - at) / 1000)));
    src = `/clip?cam=${p.a.cam}&start=${encodeURIComponent(new Date(at).toISOString())}&duration=${p.dur}`;
  }
  const pos = (at - p.base) / 1000;
  if (src === loaded && pv.readyState > 0) { pv.currentTime = pos; if (play) pv.play().catch(() => {}); return; }
  pv.onloadedmetadata = () => { pv.currentTime = pos; if (play) pv.play().catch(() => {}); };
  pv.src = src;
}
pv.addEventListener('error', () => { if (proof && pv.getAttribute('src')) $('proofNote').textContent = proof.up ? 'That video is no longer on the laptop.' : `No recording of that time (recordings are kept for ${st ? st.keepDays : '?'} days).`; });
pv.addEventListener('ended', () => { const p = proof; if (p && !p.up && p.base + p.dur * 1000 < p.last - 1000) proofGo(p.base + p.dur * 1000, true); });
function setProofRate(r) { pv.defaultPlaybackRate = r; pv.playbackRate = r; document.querySelectorAll('[data-prate]').forEach((b) => b.classList.toggle('on', +b.dataset.prate === r)); }
function proofClose() { if (proof) cancelAnimationFrame(proof.raf); proof = null; pv.pause(); pv.removeAttribute('src'); pv.load(); $('proof').hidden = true; $('athleteBox').hidden = false; }
$('proofClose').onclick = proofClose;
$('proofLive').onclick = () => { const a = proof?.a; proofClose(); if (a) watchInLive(a); };
$('proofSpeeds').onclick = (e) => { const b = e.target.closest('[data-prate]'); if (b) setProofRate(+b.dataset.prate); };
$('proofSync').onclick = (e) => { const b = e.target.closest('[data-shift]'); if (!b) return; proofLag += +b.dataset.shift; showProofLag(); try { localStorage.setItem('proofLag', proofLag); } catch { /* not kept */ } };
$('proofReps').onclick = (e) => {
  const b = e.target.closest('[data-ev]'); if (!b || !proof) return;
  const ev = proof.evs[+b.dataset.ev], from = ev.from ?? ev.t - 4000;
  proof.stopAt = ev.t + 1200;
  proofGo(from - 1000 - (proof.up ? 0 : proofLag), true);
};
// where everything is at this moment of the recording, drawn over the picture
function proofDraw() {
  const p = proof; if (!p) return;
  p.raf = requestAnimationFrame(proofDraw);
  if ($('judge').hidden) { if (!pv.paused) pv.pause(); return; }
  const vw = pv.videoWidth, vh = pv.videoHeight, cv = $('proofCanvas'); if (!vw) return;
  const dpr = devicePixelRatio || 1, W = Math.round(pv.clientWidth * dpr), H = Math.round(pv.clientHeight * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const c = cv.getContext('2d'); c.clearRect(0, 0, W, H);
  const T = p.base + pv.currentTime * 1000 + (p.up ? 0 : proofLag);
  if (p.stopAt != null && T >= p.stopAt) { p.stopAt = null; pv.pause(); }
  const s = Math.min(W / vw, H / vh), w = vw * s, h = vh * s, ox = (W - w) / 2, oy = (H - h) / 2;
  // the rep count so far, and a rep or no rep just given
  let count = 0, noReps = 0, flash = null;
  for (const e of p.evs) {
    if (e.t > T) break;
    if (e.type === 'rep') count = e.count; else noReps++;
    if (T - e.t < (e.type === 'rep' ? 900 : 1800)) flash = e;
  }
  const fs = Math.max(15, Math.round(h / 24));
  c.font = `700 ${fs}px Arial, sans-serif`; c.textBaseline = 'middle'; c.textAlign = 'left';
  const tag = (text, x, y, bg) => { const tw = c.measureText(text).width + fs * 0.8; x = Math.max(ox, Math.min(ox + w - tw, x - tw / 2)); y = Math.max(oy, y); c.fillStyle = bg; c.fillRect(x, y, tw, fs * 1.4); c.fillStyle = '#fff'; c.fillText(text, x + fs * 0.4, y + fs * 0.72); };
  const sum = `Reps ${count}${noReps ? ' · no reps ' + noReps : ''}`;
  tag(sum, ox + (c.measureText(sum).width + fs * 0.8) / 2, oy, 'rgba(0,0,0,.65)');
  if (!$('proofShow').checked || !p.frames.length) return;
  // their skeleton, between the two saved frames either side of now; nothing if they weren't seen around now
  let lo = 0, hi = p.frames.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (p.frames[m][0] <= T) lo = m; else hi = m - 1; }
  const f0 = p.frames[lo], f1 = p.frames[lo + 1];
  if (f0[0] > T || T - f0[0] > 500) return;
  const mix = f1 && f1[0] - f0[0] < 500 ? (T - f0[0]) / (f1[0] - f0[0]) : 0;
  const pt = (i) => { const x0 = f0[2 + i * 2], y0 = f0[3 + i * 2]; if (x0 < 0) return null; const x1 = mix ? f1[2 + i * 2] : x0, y1 = mix ? f1[3 + i * 2] : y0; const a = x1 < 0 ? 0 : mix; return { x: ox + ((x0 + (x1 - x0) * a) / 10000) * w, y: oy + ((y0 + (y1 - y0) * a) / 10000) * h, guess: !!(f0[1] & (1 << i)) }; };
  const col = flash ? (flash.type === 'rep' ? '#16a34a' : '#dc2626') : '#38bdf8', lw = Math.max(3, w / 280);
  c.lineWidth = lw; c.lineCap = 'round'; c.strokeStyle = col;
  for (const dashed of [false, true]) {
    c.setLineDash(dashed ? [lw * 2, lw * 2] : []); c.beginPath();
    for (const [a, b] of PROOF_BONES) { const m = pt(a), n = pt(b); if (m && n && (m.guess || n.guess) === dashed) { c.moveTo(m.x, m.y); c.lineTo(n.x, n.y); } }
    c.stroke();
  }
  c.setLineDash([]); c.fillStyle = '#fff';
  let top = Infinity, xs = 0, nx = 0;
  PROOF_POINTS.forEach((_, i) => { const m = pt(i); if (!m) return; top = Math.min(top, m.y); xs += m.x; nx++; c.beginPath(); c.arc(m.x, m.y, lw * 0.9, 0, Math.PI * 2); c.fill(); });
  if (!nx) return;
  const who = p.a.bib && p.a.bib !== 'No number' ? '#' + p.a.bib : 'A' + p.a.label, bx = xs / nx, by = top - fs * 1.9;
  tag(`${who}  ${count}`, bx, by, flash ? col : 'rgba(0,0,0,.75)');
  if (flash) tag(flash.type === 'rep' ? `✓ Rep ${flash.count}` : `✗ No rep${flash.reasons[0] ? ': ' + flash.reasons[0] : ''}`, bx, by - fs * 1.6, col);
}
// Detailed analysis: the AI judge, heavy model, frame by frame through the stretch they were on screen; their reps
// and no reps with the reasons
function detailed(a) {
  $('athletePop').hidden = true;
  if (!a.box) return toast('No position recorded for them yet: Watch, then Pick athlete and click them');
  const title = `${a.bib && a.bib !== 'No number' ? '#' + a.bib : 'Athlete ' + a.label} · ${a.src === 'upload' ? upName(a.video) : 'camera ' + a.cam}`;
  if (a.src === 'upload') {
    openAnalysis(`/judge/judge.html?clip=${encodeURIComponent('/uploads/' + encodeURIComponent(a.video))}&pickx=${a.box.x}&picky=${a.box.y}&pickt=${(a.boxT ?? a.firstT ?? 0).toFixed(2)}&heavy=1&cfg=upload`, title);
    return;
  }
  detailedAt(a.cam, Date.parse(a.boxAt || a.firstAt), Date.parse(a.lastAt), a.box.x, a.box.y, title, Date.parse(a.firstAt));
}
// the recording around one moment (up to 3 minutes either side, inside what they were on screen if known); the judge
// follows whoever is at x, y then and analyses only the stretch they're in the picture
function detailedAt(cam, at, lastAt, x, y, title, firstAt) {
  const now = laptopNow().getTime() - 3000;
  let s = Math.max((firstAt || at) - 20000, at - 180000, tlFrom || 0), e = Math.min(Math.max(lastAt, at) + 20000, at + 180000, now);
  if (e - s > 600000) { s = Math.max(s, at - 300000); e = Math.min(e, s + 600000); }
  const src = `/clip?cam=${cam}&start=${encodeURIComponent(new Date(s).toISOString())}&duration=${Math.max(5, Math.round((e - s) / 1000))}`;
  openAnalysis(`/judge/judge.html?clip=${encodeURIComponent(src)}&pickx=${(+x).toFixed(4)}&picky=${(+y).toFixed(4)}&pickt=${((at - s) / 1000).toFixed(2)}&heavy=1&cfg=cam${cam}`, title);
}
function openAnalysis(url, title) {
  showTab('judge');
  $('analysisTitle').textContent = `Detailed analysis: ${title}`;
  $('analysisNote').textContent = 'Heavy pose model, every frame of the stretch they were on screen: every rep and no rep, with the reasons.';
  $('analysisFrame').src = url;
  $('analysis').hidden = false; $('athleteBox').hidden = true; $('rulesBox').hidden = true;
  scrollTo({ top: 0 });
}
$('analysisClose').onclick = () => { $('analysis').hidden = true; $('athleteBox').hidden = false; $('analysisFrame').src = 'about:blank'; };
$('whatCounts').onclick = () => { $('rulesFrame').src = '/judge/judge.html?rules=1&cfg=cam1'; $('rulesBox').hidden = false; };
$('rulesClose').onclick = () => { $('rulesBox').hidden = true; $('rulesFrame').src = 'about:blank'; };

// one athlete, from the timeline or the number search: Watch or Detailed analysis
function showAthlete(a) {
  const pop = $('athletePop');
  pop.hidden = false;
  pop.innerHTML = `${a.pic ? `<img src="${picUrl(a)}" alt="">` : ''}<div class="info"><b>${athName(a)}</b><span class="muted">${whereText(a)} · ${whenText(a)}</span><span>${repsText(a)}</span></div><span class="spacer"></span>
    <button class="btn" id="apWatch">▶ Watch</button><button class="btn red" id="apDetail">Detailed analysis</button><button class="btn" id="apClose" title="Close">✕</button>`;
  $('apClose').onclick = () => { pop.hidden = true; };
  $('apWatch').onclick = () => watch(a);
  $('apDetail').onclick = () => detailed(a);
}

// a marker on the timeline for each athlete picked up on a live camera: their number once read, in their camera's colour
const CAM_COLOURS = ['#2563eb', '#ea580c', '#9333ea', '#0891b2', '#db2777', '#ca8a04'];
let markSig = '';
function renderMarkers(force) {
  if (!st || !tlFrom) return;
  const end = tlEnd(), list = athList.filter((a) => a.src === 'live' && Date.parse(a.firstAt) >= tlFrom && Date.parse(a.firstAt) <= end);
  const shown = numbersSeen.filter((x) => x.src === 'live' && Date.parse(x.firstAt) >= tlFrom && Date.parse(x.firstAt) <= end);
  const sig = JSON.stringify([list.map((a) => [a.n, a.bib]), shown.map((x) => x.id), tlFrom, Math.round(end / 30000)]);
  if (sig === markSig && !force) return; markSig = sig;
  $('tlMarks').innerHTML = list.map((a) => `<button data-n="${a.n}" style="left:${(100 * (Date.parse(a.firstAt) - tlFrom) / Math.max(1, end - tlFrom)).toFixed(2)}%;background:${CAM_COLOURS[(a.cam - 1 + CAM_COLOURS.length) % CAM_COLOURS.length]}" title="Camera ${a.cam} · ${a.bib && a.bib !== 'No number' ? 'No. ' + esc(a.bib) : 'athlete ' + a.label + ' (no number yet)'} · ${hms(new Date(a.firstAt))} · ${Number(a.reps)} reps">${a.bib && a.bib !== 'No number' ? '#' + esc(a.bib) : 'A' + a.label}</button>`).join('');
  $('tlMarks').insertAdjacentHTML('beforeend', shown.map((x) => `<button class="seen" data-seen="${esc(x.id)}" style="left:${(100 * (Date.parse(x.firstAt) - tlFrom) / Math.max(1, end - tlFrom)).toFixed(2)}%" title="#${esc(x.number)} shown to camera ${x.cam} at ${hms(new Date(x.firstAt))}">#${esc(x.number)}</button>`).join(''));
  $('tlMarks').querySelectorAll('button').forEach((b) => b.onclick = () => (b.dataset.seen ? goToNumber(numbersSeen.find((x) => x.id === b.dataset.seen)) : showAthlete(athList.find((a) => a.n === +b.dataset.n))));
}

// ---------------------------------------------------------------- find an athlete by number, from any tab
// a few seconds before a number was shown: the recording of that camera, or the uploaded video if it's the one open
function goToNumber(x) {
  if (!x) return;
  if (x.src === 'live') { viewCam = x.cam; showTab('live'); replay(new Date(Date.parse(x.firstAt) - 3000), 40, true); return; }
  const v = upRunning === x.video && document.querySelector('#upStage iframe')?.contentDocument?.querySelector('video');
  if (!v) { showTab('upload'); upShown = x.video; renderSides(); toast('That video isn\'t open: use Judge again in the list below, then search again.'); return; }
  showTab('upload'); v.currentTime = Math.max(0, (x.firstT ?? 0) - 3);
}
function numSearch() {
  const q = $('numSearch').value.trim().toLowerCase(), box = $('numResults');
  if (!q) { box.hidden = true; return; }
  const found = athList.filter((a) => a.bib && a.bib !== 'No number' && String(a.bib).toLowerCase().includes(q)).slice(0, 12);
  // when that number was shown to a camera, newest first, with who started next to narrow down who to watch
  const seen = numbersSeen.filter((x) => x.number.includes(q)).sort((a, b) => b.firstAt.localeCompare(a.firstAt)).slice(0, 12);
  const nextUp = (x) => athList.filter((a) => a.src === x.src && a.cam === x.cam && a.video === x.video && a.firstAt >= x.firstAt).sort((a, b) => a.firstAt.localeCompare(b.firstAt))[0];
  const seenHtml = seen.map((x) => { const a = nextUp(x), start = a && (x.src !== 'live' || Date.parse(a.firstAt) - Date.parse(x.firstAt) < 120000) ? a : null; return `<button data-seen="${esc(x.id)}"><span><b>#${esc(x.number)} shown</b> ${x.src === 'upload' ? `at ${mss(x.firstT ?? 0)} in ${esc(upName(x.video))}` : `at ${hms(new Date(x.firstAt))} · Camera ${x.cam}`}<br><small>${start ? `Next to start: ${shortName(start)}` : 'Go to this moment'}</small></span></button>`; }).join('');
  box.hidden = false;
  if (seenHtml || found.length) box.innerHTML = seenHtml + (found.length ? found.map((a) => `<button data-n="${a.n}">${a.pic ? `<img src="${picUrl(a)}" alt="">` : ''}<span><b>#${esc(a.bib)}</b> ${whereText(a)}<br><small>${whenText(a)} · ${Number(a.reps)} reps</small></span></button>`).join('')
    : '');
  else box.innerHTML = `<p class="muted">That number wasn't seen ${isToday() ? 'today' : 'on this day'}. Try another day, or find them in the recording and use Pick athlete.</p>`;
  box.querySelectorAll('button').forEach((b) => b.onmousedown = (e) => { e.preventDefault(); box.hidden = true; if (b.dataset.seen) goToNumber(numbersSeen.find((x) => x.id === b.dataset.seen)); else showAthlete(athList.find((a) => a.n === +b.dataset.n)); });
}
$('numSearch').oninput = numSearch;
$('numSearch').onfocus = numSearch;
$('numSearch').onblur = () => setTimeout(() => { $('numResults').hidden = true; }, 150);
$('numSearch').onkeydown = (e) => { if (e.key === 'Enter') { const b = $('numResults').querySelector('button'); if (b) b.dispatchEvent(new MouseEvent('mousedown')); } if (e.key === 'Escape') $('numSearch').blur(); };

// ---------------------------------------------------------------- Upload video: judged as it plays, like a live camera
// The video goes to the laptop first (kept in its training folder), then the AI judge (always on) plays and judges
// it from there, reporting everyone it tracks to the AI judge list.
let upRunning = '';
function uploadName(saved) { return upName(saved); }
async function loadUploads() {
  const list = await fetch('/api/uploads').then((r) => r.json()).catch(() => []);
  const whenUp = (n) => { const m = /^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)/.exec(n); return m ? `${m[1]} ${m[2]}:${m[3]}` : ''; };
  $('upList').innerHTML = list.map((x) => `<tr><td>${esc(uploadName(x.name))}</td><td class="t">${esc(whenUp(x.name))}</td><td>${(x.size / 1e6).toFixed(0)} MB</td>
    <td>${athList.filter((a) => a.src === 'upload' && a.video === x.name).length || '–'}</td>
    <td><button class="btn" data-show="${esc(x.name)}">Results</button> <button class="btn" data-judge="${esc(x.name)}">Judge again</button> <button class="btn" data-delup="${esc(x.name)}" title="Delete this video and its AI judge entries">🗑 Delete</button></td></tr>`).join('')
    || '<tr><td colspan="5" class="muted">No videos uploaded yet.</td></tr>';
}
$('upList').onclick = async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.show) { upShown = b.dataset.show; renderSides(); return; }
  if (b.dataset.judge) return upConfig(uploadName(b.dataset.judge), b.dataset.judge);
  const name = b.dataset.delup;
  if (!confirm(`Delete ${uploadName(name)} from the laptop, with the athletes the AI judge found in it?`)) return;
  if (upRunning === name) { $('upStage').innerHTML = '<div class="msg">Choose a video to judge it.</div>'; upRunning = ''; await new Promise((r) => setTimeout(r, 500)); }
  const r = await fetch('/api/uploads?name=' + encodeURIComponent(name), { method: 'DELETE' }).then((x) => x.json()).catch(() => ({ error: 'can\'t reach the laptop' }));
  toast(r.ok ? 'Deleted' : `Couldn't delete it: ${r.error}`); athRev = -1; loadAthletes(); loadUploads();
};
function judgeUpload(saved, name) {
  if (upRunning && !confirm('A video is still being judged. Stop it and judge this one instead?')) return;
  upRunning = saved; upShown = saved; renderSides();
  $('upStage').innerHTML = `<iframe title="AI judge: uploaded video" allow="autoplay; fullscreen" src="/judge/judge.html?video=${encodeURIComponent('/uploads/' + encodeURIComponent(saved))}&name=${encodeURIComponent(name)}&go=1&cfg=upload"></iframe>`;
  $('upStatus').textContent = `Analysing ${name}: every frame is checked before anything plays, so no jump is missed. Results appear on the right as athletes finish or leave.`;
}
let upPending = null;   // { name, saved, go } the video chosen, while its Config is open
function upConfig(name, saved) {
  upPending = { name, saved: saved || '', go: false };
  $('upSettingsFrame').src = '/judge/judge.html?settings=1&cfg=upload';
  $('upSettings').hidden = false; $('upSettings').scrollIntoView({ behavior: 'smooth' });
}
function upReady() { if (upPending && upPending.go && upPending.saved) { const p = upPending; upPending = null; judgeUpload(p.saved, p.name); } }
$('upFile').onchange = () => {
  const file = $('upFile').files[0]; $('upFile').value = ''; if (!file) return;
  upConfig(file.name);
  const mine = upPending;
  const x = new XMLHttpRequest();
  x.open('POST', '/api/upload?name=' + encodeURIComponent(file.name));
  x.upload.onprogress = (e) => { if (e.lengthComputable) $('upStatus').textContent = `Sending ${file.name} to the laptop… ${Math.round((100 * e.loaded) / e.total)}%`; };
  x.onload = () => {
    let r = {}; try { r = JSON.parse(x.responseText); } catch { /* not JSON */ }
    if (x.status !== 200 || !r.saved) { $('upStatus').textContent = `The upload didn't work: ${r.error || x.status}`; if (upPending === mine) upPending = null; return; }
    loadUploads(); mine.saved = r.saved;
    $('upStatus').textContent = mine.go ? `Starting ${file.name}…` : `${file.name} is on the laptop: check the settings, then Save to start judging.`;
    upReady();
  };
  x.onerror = () => { $('upStatus').textContent = 'The upload didn\'t work: can\'t reach the laptop'; };
  x.send(file);
};
$('upCfg').onclick = () => { $('upSettingsFrame').src = '/judge/judge.html?settings=1&cfg=upload'; $('upSettings').hidden = false; };

// ---------------------------------------------------------------- log: camera events on the day
let logSig = '';
function renderLog() {
  if (!st) return;
  const [a, b] = dayBounds();
  const ev = st.events.filter((e) => { const t = Date.parse(e.t); return t >= a && t < b; });
  const sig = JSON.stringify([dayKey, ev.length]);
  if (sig === logSig) return; logSig = sig;
  $('eventList').innerHTML = ev.slice().reverse().slice(0, 200).map((e) => `<tr>
    <td class="t">${esc(dayStr(new Date(e.t)))} <b>${esc(hms(new Date(e.t)))}</b></td><td>Camera ${e.cam}</td>
    <td class="${e.type}">${e.type === 'lost' ? 'Signal lost' : `Connected${e.route ? ' (' + esc(e.route) + ')' : ''}`}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No camera events on this day.</td></tr>';
}
$('csv').onclick = () => {
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const [a, b] = dayBounds(), rows = [];
  for (const e of st.events) { const t = Date.parse(e.t); if (t >= a && t < b) rows.push([e.t, e.type === 'lost' ? 'camera lost' : 'camera connected', e.cam, e.route || '', '', '', '']); }
  for (const x of athList) rows.push([x.firstAt, 'athlete', x.src === 'upload' ? 'upload: ' + upName(x.video) : x.cam, x.bib || 'No number', x.reps, x.noReps, x.lastAt]);
  rows.sort((p, r) => (p[0] < r[0] ? -1 : 1));
  rows.unshift(['time', 'type', 'camera', 'detail / number', 'reps', 'no reps', 'last seen']);
  const el = document.createElement('a');
  el.href = URL.createObjectURL(new Blob([rows.map((r) => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' }));
  el.download = `review-log-${dayKey}.csv`; el.click();
};

// opened from a camera in the Receiver (?focus=1): that camera big, once everything above is set up
if (params.get('focus')) window.focusCamera(+params.get('focus'));
