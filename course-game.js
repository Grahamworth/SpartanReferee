// Course Run: a 3D game of an obstacle race course, built from the organisers'
// route file on the real terrain. Controls follow SkiTour's play mode: thumb
// pad (left/right steers, forward runs, back slows / steps back), Jump (hold =
// higher), and an action button (here Sprint, held). Keyboard: arrows / WASD,
// Space jumps, Shift sprints, R resets, Esc pauses, C changes the camera.
/* global THREE */
import { makeTerrain, buildWorld, pointAt, cullThings, wallHeight, rng, makeGrass, obstacleKind as obstacleKindOf, TRAIL_W } from './course-world.js?v=2';
import { loadPeople, makePerson, animatePerson, showProp, DEFAULT_LOOK } from './course-people.js?v=2';
import { makeCrowd } from './course-crowd.js?v=2';
import { makeSky, WX } from './course-sky.js?v=2';
import { makeMap, makeSim } from './course-map.js?v=2';
import { GAMES, gameFor, difficulty } from './course-games.js?v=3';
import { rulesFor, TYPE_TEXT, RULES_PAGE, RULEBOOK_PDF } from './course-rules.js?v=2';
import { bindLook } from './course-look.js?v=2';
import { act } from './course-obstacles.js?v=2';

// Colours are given as sRGB (as on screen); the renderer works in linear light and converts back on output.
const _setHex = THREE.Color.prototype.setHex, _setStyle = THREE.Color.prototype.setStyle;
THREE.Color.prototype.setHex = function (h) { _setHex.call(this, h); return this.convertSRGBToLinear(); };
THREE.Color.prototype.setStyle = function (st) { _setStyle.call(this, st); return /^#/.test(st) ? this.convertSRGBToLinear() : this; };

// every race's course pack (courses/index.json: add a new race there); the picker starts on the most recent
const PACK_DIR = 'courses/';
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const fmtClock = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
const store = { get(k, d) { try { const v = localStorage.getItem('cr_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('cr_' + k, JSON.stringify(v)); } catch { /* private mode */ } } };

// Pace on a slope (grade g = rise / run), after Tobler's hiking function; gentler in the game so climbs aren't a crawl.
const slopeFactor = (g) => clamp(Math.exp(-2.4 * Math.abs(g + 0.05)) / Math.exp(-0.12), 0.35, 1.15);
// Real-life pace for the race clock when skipping (a fit amateur: about 3 m/s on the flat)
const realFactor = (g) => clamp(Math.exp(-3.5 * Math.abs(g + 0.05)) / Math.exp(-0.175), 0.2, 1.15);
// How long each kind of obstacle takes in real life (s), for the race clock.
const REAL_TIME = { climb: 25, hurdle: 12, rig: 60, carry: 300, crawl: 150, balance: 40, hoist: 60, aim: 30, bell: 25, memoryBoard: 15, memoryTest: 15 };
const MAX_TRIES = 5; // goes at each obstacle before a penalty
const SPRINT = false; // the Sprint button is put away for now (it comes back by setting this)
const PENALTY_KINDS = new Set(['climb', 'rig', 'balance', 'hoist', 'aim', 'memoryTest']); // the others can't be failed

let PACK = null, T = null, G = null; // the course pack, its terrain, the running game

// ---------------------------------------------------------------- menu
async function loadRaces() {
  const r = await fetch(PACK_DIR + 'index.json');
  if (!r.ok) throw new Error('Could not load the courses (' + r.status + ').');
  const races = (await r.json()).sort((a, b) => (a.date < b.date ? 1 : -1));
  const pick = $('racePick');
  pick.innerHTML = races.map((x) => `<option value="${x.file}">${x.name}</option>`).join('');
  pick.onchange = () => loadPack(pick.value).catch((e) => { $('courseTitle').textContent = e.message; });
  await loadPack(races[0].file);
}
async function loadPack(file) {
  $('courseTitle').textContent = 'Loading the course…';
  const r = await fetch(PACK_DIR + file);
  if (!r.ok) throw new Error('Could not load the course (' + r.status + ').');
  PACK = await r.json();
  T = makeTerrain(PACK);
  $('courseTitle').textContent = 'Pick a course';
  const list = $('courses');
  list.innerHTML = '';
  const ORDER = ['kids4', 'kids7', 'kids10', 'sprint', 'super', 'beast', 'ultra'];
  for (const c of [...PACK.courses].sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id))) {
    // climb from the terrain, with a little hysteresis so the 30 m grid's wobble doesn't count
    let up = 0, ref = null;
    for (let d = 0; d < c.length; d += 20) {
      const p = c.line[Math.min(c.line.length - 1, Math.round((d / c.length) * (c.line.length - 1)))], [x, z] = T.toXZ(p[0], p[1]), h = T.hAt(x, z);
      if (ref === null) ref = h; else if (h > ref + 3) { up += h - ref; ref = h; } else if (h < ref - 3) ref = h;
    }
    const b = document.createElement('button');
    b.className = 'course' + (c.kids ? ' kids' : '');
    b.innerHTML = `<b>${c.name}</b><small>${(c.length / 1000).toFixed(1)} km · ${c.obstacles.length} obstacles · ↑ ${Math.round(up / 10) * 10} m</small><span class="go">GO ›</span>`;
    b.onclick = () => openSheet(c.id);
    list.appendChild(b);
  }
  // obstacle practice: every obstacle once (from the shortest course it's on), any level
  const seen = new Set(), pl = $('pracList'); pl.innerHTML = '';
  for (const id of ['sprint', 'super', 'beast', 'ultra', 'kids10', 'kids7', 'kids4']) {
    const c = PACK.courses.find((x) => x.id === id); if (!c) continue;
    for (const o of c.obstacles) {
      const name = o.name.replace(/\s*\(.*?\)\s*/g, ' ').trim(), key = name.toUpperCase().replace(/\s*ULTRA\s*/, '');
      if (seen.has(key)) continue; seen.add(key);
      const li = document.createElement('button'); li.type = 'button'; li.className = 'prac-item';
      li.innerHTML = `<b>${name}</b><small>${c.kids ? 'Kids · ' : ''}${GAME_NAMES[gameFor(o.name, obstacleKindOf(o.name))] || ''}</small>`;
      li.onclick = () => start(c.id, Math.max(0, o.at - 25), { name: o.name, at: o.at, level: +$('pracLevel').value });
      pl.appendChild(li);
    }
  }
}
$('optCam').value = store.get('cam', 'far');
// two steps: your runner, then the course
// (each screen is a step in the page's history, so the phone's back button goes back through them)
const showStep = (courses) => { $('lookStep').hidden = courses; $('courseStep').hidden = !courses; $('menu').scrollTo(0, 0); };
const screenNow = () => history.state?.screen || (location.hash === '#courses' ? 'courses' : 'look');
function enterScreen(screen) {
  if (history.state?.screen === screen) return;
  if (history.state?.screen === 'sheet' && screen === 'game') history.replaceState({ screen }, ''); // back from a run: the courses
  else history.pushState({ screen }, '', screen === 'courses' ? '#courses' : location.hash);
}
$('toCourses').onclick = () => { enterScreen('courses'); showStep(true); };
$('toLook').onclick = () => {
  if (history.state?.screen === 'courses') return history.back();
  history.replaceState({ screen: 'look' }, '', location.pathname + location.search); showStep(false); // came straight here from the home page
};
window.addEventListener('popstate', () => {
  if (!$('game').hidden) {
    // mid-run, back pauses first (Quit is there); back again leaves
    if (G && !G.ended && !G.paused) { history.pushState({ screen: 'game' }, ''); togglePause(); return; }
    toMenu();
  }
  if (!$('sheet').hidden) closeSheet();
  showStep(screenNow() === 'courses');
});
// from the home page's Courses button: straight to the courses
if (location.hash === '#courses') { $('lookStep').hidden = true; $('courseStep').hidden = false; }
$('optWeather').value = store.get('weather', 'auto');
$('optTime').value = store.get('time', 'midday');
$('optWeather').onchange = () => store.set('weather', $('optWeather').value);
$('optTime').onchange = () => store.set('time', $('optTime').value);
bindLook(store);
$('optAssist').checked = store.get('assist', false);
$('optQuality').value = store.get('quality', 'auto');
$('optCam').onchange = () => store.set('cam', $('optCam').value);
$('optAssist').onchange = () => store.set('assist', $('optAssist').checked);
$('optQuality').onchange = () => store.set('quality', $('optQuality').value);
loadRaces().catch((e) => { $('courseTitle').textContent = e.message; });


// ---------------------------------------------------------------- the course sheet (2D map, simulation, where to start)
let SHEET = null;
function openSheet(id) {
  const course = PACK.courses.find((c) => c.id === id);
  if (SHEET) SHEET.map.stop();
  enterScreen('sheet');
  $('menu').hidden = true; $('sheet').hidden = false;
  $('shTitle').textContent = course.name;
  $('shStats').textContent = `${(course.length / 1000).toFixed(1)} km · ${course.obstacles.length} obstacles · ${course.water.length} water stations`;
  const map = makeMap($('shMap'), PACK, T, course, { onTap: (d) => pick(d) });
  const sim = makeSim(map);
  SHEET = { course, map, sim, pickD: null };
  map.start();
  // the obstacle list
  $('shList').innerHTML = map.obs.map((o) => `<li data-k="${o.k}"><b>${o.k + 1}</b> ${o.name.replace(/\s*\(.*?\)\s*/g, ' ').trim()} <span>${(o.at / 1000).toFixed(1)} km${o.penalty ? ' · penalty loop' : ''}</span></li>`).join('');
  $('shList').onclick = (e) => {
    const li = e.target.closest('li'); if (!li) return; const o = map.obs[+li.dataset.k];
    map.highlight = o.k; map.centreOn(o.at, Math.max(map.view.s, 0.8));
    // what the obstacle is and how a referee judges it
    const r = rulesFor(o.name);
    $('shInfo').hidden = false;
    $('shInfo').innerHTML = `<h4>#${o.k + 1} ${o.name.replace(/\s*\(.*?\)\s*/g, ' ').trim()}</h4><p class="sh-km">${(o.at / 1000).toFixed(1)} km${o.penalty ? ' · has a penalty loop' : ''} · mini-game: ${GAME_NAMES[gameFor(o.name, o.kind)] || '–'}</p>`
      + (r ? `<p class="sh-type">${TYPE_TEXT[r.type]}</p><ul>${r.points.map((x) => `<li>${x}</li>`).join('')}</ul><p class="sh-src">Summary of Spartan’s 2026 rules · <a href="${RULES_PAGE}" target="_blank" rel="noopener">official rules</a></p>` : '<p class="sh-src">No official rule summary for this one: it’s briefed on the day.</p>')
      + `<div class="row"><button type="button" class="btn" id="shTry">Try this obstacle</button></div>`;
    $('shTry').onclick = () => start(SHEET.course.id, Math.max(0, o.at - 25), { name: o.name, at: o.at, level: 3 });
    $('shInfo').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  // the other stations on the course: water, medical, timing, the burpee station, penalty loops
  const near = (la, lo, m) => { const [x, z] = T.toXZ(la, lo); let best = null, bd = m; for (let i = 0; i < map.cs.length; i += 2) { const p = map.cs[i], d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } } return best; };
  const sc = PACK.scenery || {}, st = [];
  for (const w of course.water) st.push([w.at, '💧', w.name.replace(/^WATER STATION/i, 'Water station')]);
  for (const [la, lo] of sc.medical || []) { const p = near(la, lo, 80); if (p) st.push([p.d, '⛑️', 'Medical point']); }
  for (const [la, lo, name] of sc.timing || []) { const p = near(la, lo, 60); if (p) st.push([p.d, '⏱️', name.replace(/^Timing/i, 'Timing point')]); }
  for (const poly of PACK.burpeeAreas || []) { const la = poly.reduce((a, q) => a + q[0], 0) / poly.length, lo = poly.reduce((a, q) => a + q[1], 0) / poly.length, p = near(la, lo, 60); if (p) st.push([p.d, '🔥', 'Burpee station']); }
  for (const o of map.obs) if (o.penalty) st.push([o.at, '↩️', `Penalty loop (${o.name.replace(/\s*\(.*?\)\s*/g, ' ').trim()})`]);
  st.sort((a, b) => a[0] - b[0]);
  $('shStations').innerHTML = st.length ? st.map(([d, ic, t]) => `<li><b>${ic}</b> ${t} <span>${(d / 1000).toFixed(1)} km</span></li>`).join('') : '<li>None listed</li>';
  $('shInfo').hidden = true;
  drawSheetProfile();
  pick(null);
  simUi();
}
function pick(d) {
  const S = SHEET; S.pickD = d; S.map.marker = d; S.map.redraw();
  const next = d === null ? null : S.map.obs.find((o) => o.at > d + 3);
  $('shStartHere').disabled = d === null;
  $('shStartHere').textContent = d === null ? 'Tap the course to pick a start' : `Start at ${(d / 1000).toFixed(2)} km`;
  $('shPickInfo').textContent = d === null ? 'Tap anywhere on the red line to start from there.' : next ? `Next obstacle: #${next.k + 1} ${next.name.replace(/\s*\(.*?\)\s*/g, ' ').trim()}` : 'After the last obstacle';
  drawSheetProfile();
}
function drawSheetProfile() {
  const S = SHEET, cv = $('shProf'), g = cv.getContext('2d'), W = cv.width, H = cv.height, cs = S.map.cs, L = S.map.total;
  let lo = Infinity, hi = -Infinity; for (const p of cs) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); }
  const span = Math.max(50, hi - lo), X = (d) => (d / L) * W, Y = (y) => H - 14 - ((y - lo) / span) * (H - 26);
  g.clearRect(0, 0, W, H); g.fillStyle = '#161616'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#5b4a33'; g.beginPath(); g.moveTo(0, H); for (let i = 0; i < cs.length; i += 6) g.lineTo(X(cs[i].d), Y(cs[i].y)); g.lineTo(W, H); g.fill();
  for (const o of S.map.obs) { g.fillStyle = S.sim.playing || S.sim.t ? (o.at < S.sim.d ? '#777' : '#e2231a') : '#e2231a'; g.fillRect(X(o.at) - 1, H - 10, 2, 8); }
  g.fillStyle = '#9a9a9a'; g.font = '20px system-ui'; g.fillText(`${Math.round(hi)} m`, 6, 22); g.fillText(`${Math.round(lo)} m`, 6, H - 18);
  if (S.pickD !== null) { g.fillStyle = '#facc15'; g.fillRect(X(S.pickD) - 2, 0, 4, H); }
  if (S.sim.t) { g.fillStyle = '#ffffff'; g.fillRect(X(S.sim.d) - 2, 0, 4, H); }
}
// tap the height profile to jump the map (and the simulation) there
$('shProf').onclick = (e) => {
  const S = SHEET, r = e.target.getBoundingClientRect(), d = ((e.clientX - r.left) / r.width) * S.map.total;
  if (S.sim.t) { S.sim.reset(d); S.sim.t = 1; S.map.runner = { d }; } else pick(d);
  S.map.centreOn(d); drawSheetProfile();
};
function simUi() {
  const S = SHEET, sim = S.sim;
  $('shPlay').textContent = sim.playing ? '⏸ Pause' : sim.t ? '▶ Carry on' : '▶ Simulate the course';
  const at = sim.at ? (sim.at.water ? '💧 Water station' : `At #${sim.at.k + 1} ${sim.at.name.replace(/\s*\(.*?\)\s*/g, ' ').trim()}`) : sim.done ? '🏁 Finished' : sim.t ? 'Running' : '';
  $('shSim').innerHTML = sim.t ? `<b>${fmtClock(sim.t)}</b> · ${(sim.d / 1000).toFixed(2)} km · ${Math.round(pointAt(S.map.cs, sim.d).y)} m<br><span>${at}</span>` : '<span>Plays the whole course at a fit amateur’s pace, with real time at each obstacle and water station: an estimated finish time.</span>';
}
$('shPlay').onclick = () => {
  const S = SHEET, sim = S.sim;
  if (!sim.t || sim.done) { sim.reset(S.pickD || 0); sim.t = 0.001; }
  sim.playing = !sim.playing; S.map.runner = { d: sim.d }; S.map.follow = sim.playing && S.map.view.s > 0.3;
  simUi();
};
$('shSpeed').onchange = () => { SHEET.sim.speed = +$('shSpeed').value; };
$('shFollow').onclick = () => { const S = SHEET; S.map.follow = true; if (S.map.view.s < 0.5) S.map.view.s = 0.8; S.map.redraw(); };
$('shZoomIn').onclick = () => SHEET.map.zoom(1.6);
$('shZoomOut').onclick = () => SHEET.map.zoom(1 / 1.6);
$('shFit').onclick = () => { SHEET.map.follow = false; SHEET.map.fit(); };
function closeSheet() { SHEET.map.stop(); SHEET.sim.playing = false; $('sheet').hidden = true; $('menu').hidden = false; }
$('shBack').onclick = () => { if (history.state?.screen === 'sheet') history.back(); else closeSheet(); };
$('shStartBegin').onclick = () => start(SHEET.course.id, 0);
$('shStartHere').onclick = () => { if (SHEET.pickD !== null) start(SHEET.course.id, Math.max(0, SHEET.pickD - 5)); };
// the simulation's clock
let simLast = 0;
(function simLoop(now) {
  requestAnimationFrame(simLoop);
  const dt = Math.min(0.1, (now - simLast) / 1000 || 0); simLast = now;
  if (!SHEET || $('sheet').hidden || !SHEET.sim.playing) return;
  const sim = SHEET.sim; sim.step(dt); SHEET.map.runner = { d: sim.d }; SHEET.map.redraw();
  if (sim.done) sim.playing = false;
  simUi(); drawSheetProfile();
})(0);

// ---------------------------------------------------------------- sound (synthesised; woken by the first touch)
const Sound = {
  ctx: null, on: store.get('sound', true),
  wake() { if (!this.ctx) try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* no audio */ } if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  beep(f, dur = 0.12, type = 'square', vol = 0.08) {
    if (!this.on || !this.ctx) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur);
  },
  good() { this.beep(660, 0.1); setTimeout(() => this.beep(990, 0.14), 90); },
  bad() { this.beep(180, 0.3, 'sawtooth'); },
  tick() { this.beep(1200, 0.03, 'square', 0.04); },
  step() { this.beep(90 + Math.random() * 30, 0.05, 'triangle', 0.05); },
  // looping noise beds for the crowd and the rain, faded to a level
  noise() {
    if (this.nb) return this.nb;
    const n = this.ctx.sampleRate * 2, b = this.ctx.createBuffer(1, n, this.ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return (this.nb = b);
  },
  bed(name, freq, q) {
    if (this[name]) return this[name];
    const src = this.ctx.createBufferSource(); src.buffer = this.noise(); src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(this.ctx.destination); src.start();
    return (this[name] = { g, f });
  },
  level(name, freq, q, v) {
    if (!this.ctx) return;
    const b = this.bed(name, freq, q);
    b.g.gain.setTargetAtTime(this.on ? v : 0, this.ctx.currentTime, 0.4);
    return b;
  },
  crowd(n) {
    // a cheering crowd: a swell of voices that wavers
    const b = this.level('crowdBed', 900, 0.7, Math.min(0.12, n * 0.012));
    if (b) b.f.frequency.setTargetAtTime(800 + Math.sin(performance.now() / 700) * 250, this.ctx.currentTime, 0.2);
  },
  weather(rain, wind) { this.level('rainBed', 3500, 0.4, rain * 0.08); this.level('windBed', 300, 0.6, wind * 0.035); },
  thunder() {
    if (!this.on || !this.ctx) return;
    const src = this.ctx.createBufferSource(); src.buffer = this.noise();
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 140;
    const g = this.ctx.createGain(), t = this.ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
    src.connect(f).connect(g).connect(this.ctx.destination); src.start(t); src.stop(t + 3.6);
  },
};
document.addEventListener('pointerdown', () => Sound.wake(), true);

// ---------------------------------------------------------------- input (the thumb pad, buttons, keyboard, drag-to-look)
const stick = { x: 0, y: 0 }, keys = {};
const GAME_KEYS = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down' };
function bindInput() {
  const pad = $('pad'), knob = $('knob');
  let id = null;
  const knobTo = (x, y) => { knob.style.transform = `translate(calc(-50% + ${x * 38}px), calc(-50% + ${-y * 38}px))`; };
  const set = (e) => {
    const r = pad.getBoundingClientRect(), R = r.width / 2;
    let dx = (e.clientX - r.left - R) / R, dy = (e.clientY - r.top - R) / R;
    const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
    stick.x = Math.abs(dx) < 0.08 ? 0 : dx; stick.y = Math.abs(dy) < 0.08 ? 0 : -dy; knobTo(dx, -dy);
  };
  pad.onpointerdown = (e) => { id = e.pointerId; if (pad.setPointerCapture) pad.setPointerCapture(id); set(e); e.preventDefault(); };
  pad.onpointermove = (e) => { if (e.pointerId === id) set(e); };
  pad.onpointerup = pad.onpointercancel = (e) => { if (e.pointerId === id) { id = null; stick.x = stick.y = 0; knobTo(0, 0); } };
  const j = $('jump'), sp = $('sprint');
  j.onpointerdown = (e) => { jumpPress(); e.preventDefault(); };
  j.onpointerup = j.onpointercancel = j.onpointerleave = (e) => { jumpRelease(); e.preventDefault(); };
  sp.onpointerdown = (e) => { if (G) G.sprintHeld = true; sp.classList.add('on'); e.preventDefault(); };
  sp.onpointerup = sp.onpointercancel = sp.onpointerleave = () => { if (G) G.sprintHeld = false; sp.classList.remove('on'); };
  $('game').oncontextmenu = (e) => e.preventDefault();
  // drag on the picture to look around; the view eases back to the running direction
  const cv = $('c');
  let drag = null;
  cv.onpointerdown = (e) => { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; if (cv.setPointerCapture) cv.setPointerCapture(e.pointerId); };
  cv.onpointermove = (e) => {
    if (!drag || e.pointerId !== drag.id || !G) return;
    G.yawOff -= (e.clientX - drag.x) * 0.006; G.pitchOff = clamp(G.pitchOff - (e.clientY - drag.y) * 0.004, -0.9, 0.9);
    drag.x = e.clientX; drag.y = e.clientY; G.dragging = true;
  };
  cv.onpointerup = cv.onpointercancel = () => { drag = null; if (G) { G.dragging = false; G.released = performance.now(); } };
  addEventListener('keydown', (e) => {
    if (!G) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) { keys[e.code] = true; e.preventDefault(); }
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) { if (G.chal) chalKey('tap', true); else if (G.penalty) burpeeTap(); else jumpPress(); } }
    const gk = GAME_KEYS[e.code];
    if (gk && G.chal && !e.repeat) { e.preventDefault(); chalKey(gk, true); }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') G.sprintHeld = true;
    if (e.code === 'KeyR') resetToCourse();
    if (e.code === 'KeyC') cycleCam();
    if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
  });
  addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (G && G.chal) { if (e.code === 'Space') chalKey('tap', false); if (GAME_KEYS[e.code]) chalKey(GAME_KEYS[e.code], false); }
    if (e.code === 'Space') jumpRelease();
    if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && G) G.sprintHeld = false;
  });
}
function inputs() {
  const kx = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
  // holding Run (or Shift) runs forward on its own; the pad still steers
  const ky = G && G.sprintHeld ? 1 : (keys.ArrowUp || keys.KeyW ? 1 : 0) - (keys.ArrowDown || keys.KeyS ? 1 : 0);
  return [Math.abs(kx) > Math.abs(stick.x) ? kx : stick.x, Math.abs(ky) > Math.abs(stick.y) ? ky : stick.y];
}
const JUMP_FULL = 900;
function jumpPress() { if (!G || G.chal || G.penalty || G.air) return; G.jumpAt = performance.now(); $('jump').classList.add('charging'); }
function jumpRelease() {
  if (!G || !G.jumpAt) return;
  const k = clamp((performance.now() - G.jumpAt) / JUMP_FULL, 0, 1);
  G.jumpAt = 0; $('jump').classList.remove('charging'); $('jump').style.setProperty('--c', 0);
  if (G.air || G.chal || G.penalty) return;
  G.vy = 3.2 + 2.4 * k; G.air = true;
}

// ---------------------------------------------------------------- start a run
let renderer = null, startAt = 0, PRACTICE = null;
function start(id, fromD = 0, practice = null) {
  const course = PACK.courses.find((c) => c.id === id);
  startAt = fromD; PRACTICE = practice;
  enterScreen('game');
  $('sheet').hidden = true; if (SHEET) SHEET.map.stop();
  $('menu').hidden = true; $('loading').hidden = false; $('game').hidden = false;
  $('loadMsg').textContent = `${course.name}: terrain, forests and buildings`;
  setTimeout(async () => { // let the loading card paint first
    try { await loadPeople(); build(course); } catch (e) { console.error(e); $('loading').hidden = true; $('glErr').hidden = false; $('glMsg').textContent = e.message; }
  }, 30);
}

function build(course) {
  close();
  if (!renderer) {
    try { renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, powerPreference: 'high-performance' }); } catch { throw new Error('This browser couldn’t start WebGL.'); }
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping;
    $('c').addEventListener('webglcontextlost', (e) => { e.preventDefault(); $('glErr').hidden = false; $('glMsg').textContent = 'The graphics were reset by the phone. Reload to carry on.'; });
    bindInput();
  }
  const quality = $('optQuality').value === 'auto' ? (Math.min(screen.width, screen.height) < 500 ? 'low' : 'high') : $('optQuality').value;
  // on a computer draw at least 1.5x the screen's pixels (cleaner edges, no shimmer on thin ropes and wires)
  renderer.setPixelRatio(quality === 'low' ? Math.min(devicePixelRatio || 1, 1.5) : Math.min(2, Math.max(devicePixelRatio || 1, 1.5)));
  const low = quality === 'low', scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xbcd6ea, 700, 9500);
  const hemi = new THREE.HemisphereLight(0xdcecff, 0x4f5a36, 0.65);
  const sun = new THREE.DirectionalLight(0xfff3dd, 2.6);
  // shadows everywhere, sharper and further on a computer
  renderer.shadowMap.enabled = true; sun.castShadow = true;
  // a tight, high-resolution shadow box around the runner: crisp shadows from ropes, rungs and nets
  const sb = low ? 32 : 42;
  sun.shadow.mapSize.set(low ? 1024 : 4096, low ? 1024 : 4096);
  Object.assign(sun.shadow.camera, { left: -sb, right: sb, top: sb, bottom: -sb, near: 5, far: 400 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = low ? 0.12 : 0.05; sun.shadow.radius = 2;
  scene.add(hemi, sun, sun.target);

  const W = buildWorld(scene, PACK, T, course, quality);
  const sky = makeSky(scene, renderer, sun, hemi, $('optWeather').value, $('optTime').value, low);
  if (!low) sky.makeEnv(renderer, scene); // light from the whole sky (and the ground), reflected in steel and water
  const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 40000), rig = new THREE.Object3D();
  rig.add(camera); scene.add(rig);
  const R = makePerson({ ...DEFAULT_LOOK, ...store.get('look', {}) });
  scene.add(R.root);
  // a soft shadow blob under the runner (for when real shadows are dropped on a slow phone)
  R.blob = new THREE.Mesh(new THREE.CircleGeometry(0.45, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  R.blob.rotation.x = -Math.PI / 2; R.blob.position.y = 0.06; R.blob.visible = false; R.root.add(R.blob);
  const crowd = makeCrowd(scene, W, T, { contestants: low ? 6 : 14, officials: low ? 3 : 6, spectators: low ? 10 : 26, shadows: true, slopeFactor });
  const grass = makeGrass(scene, T, W.grassOK, low ? 3000 : 26000);
  const arrowShape = new THREE.Shape([[0, 1.1], [0.6, 0.2], [0.22, 0.2], [0.22, -0.9], [-0.22, -0.9], [-0.22, 0.2], [-0.6, 0.2]].map(([x, y]) => new THREE.Vector2(x, y)));
  const arrowGeo = new THREE.ShapeGeometry(arrowShape); arrowGeo.rotateX(-Math.PI / 2); arrowGeo.rotateY(Math.PI); // points along +z
  const arrow = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
  arrow.renderOrder = 2; scene.add(arrow);
  const p0 = startAt > 0 ? pointAt(W.cs, startAt) : W.cs[0], p1 = pointAt(W.cs, startAt + 6);

  G = {
    course, scene, camera, rig, sun, hemi, W, R, quality, sky, crowd, grass, arrow, owed: 0, practice: PRACTICE,
    cam: $('optCam').value, assist: $('optAssist').checked,
    x: p0.x, z: p0.z, y: p0.y, h: p1.h, v: 0, vy: 0, air: false, jumpAt: 0, sprintHeld: false,
    stamina: 1, path: W.cs, pathName: null, idx: p0.i || 0, offSince: 0, nextOb: Math.max(0, W.obs.findIndex((o) => o.at > startAt + 3)) + (W.obs.every((o) => o.at <= startAt + 3) ? W.obs.length : 0),
    yawOff: 0, pitchOff: 0, camYaw: p1.h, yS: p0.y, dragging: false, released: 0,
    play: 0, extra: 0, burpees: 0, passed: 0, failed: 0, loopsRun: 0, skipped: 0,
    chal: null, penalty: null, paused: false, ended: false, memory: null, stumble: 0,
    last: performance.now(), ft: 0, fsum: 0, q1: false, q2: false, cullAt: 0, ghostAt: 0, ghosts: [], stepAt: 0,
  };
  if (startAt > 0) { for (const w of W.water) if (w.at < startAt) w.used = true; for (const b of crowd.bots) b.d = startAt + 1 + Math.random() * 22; G.startedAt = startAt; }
  drawMiniBase();
  if (G.mini) G.mini.stop();
  G.mini = makeMap($('mini'), PACK, T, course, { interactive: false, cs: W.cs }); G.mini.start(); G.mini.view.s = 0.5;
  resize();
  $('loading').hidden = true;
  $('pauseCard').hidden = $('finish').hidden = $('chal').hidden = $('pen').hidden = true;
  if (PRACTICE) { G.nextOb = Math.max(0, W.obs.findIndex((o) => Math.abs(o.at - PRACTICE.at) < 1)); for (const b of crowd.bots) b.d = -9999; }
  toast(PRACTICE ? `Practice: ${PRACTICE.name.replace(/\s*\(.*?\)\s*/g, ' ').trim()} – run to it` : startAt > 0 ? `${course.name} from ${(startAt / 1000).toFixed(1)} km – go!` : course.name + ' – go!', 2000);
  G.raf = requestAnimationFrame(frame);
}

function close() {
  if (!G) return;
  cancelAnimationFrame(G.raf);
  if (G.mini) G.mini.stop();
  G.scene.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) { if (m.map) m.map.dispose(); m.dispose(); }
  });
  renderer.renderLists.dispose();
  G = null;
}

function resize() {
  if (!renderer || !G) return;
  const w = $('game').clientWidth, h = $('game').clientHeight;
  renderer.setSize(w, h, false);
  G.camera.aspect = w / h; G.camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
// a run pauses itself when the phone locks or the tab is hidden
document.addEventListener('visibilitychange', () => { if (document.hidden && G && !G.ended && !G.paused && !/nopause/.test(location.search)) togglePause(); }); // (?nopause: for testing)

// ---------------------------------------------------------------- the course: where am I on it?
function track() {
  const P = G.path;
  let best = Infinity, bi = G.idx;
  for (let i = Math.max(0, G.idx - 25); i < Math.min(P.length, G.idx + 80); i++) {
    const d = (P[i].x - G.x) ** 2 + (P[i].z - G.z) ** 2;
    if (d < best) { best = d; bi = i; }
  }
  best = Math.sqrt(best);
  if (best < 35) G.idx = bi;
  return best;
}
const progress = () => G.path[G.idx].d;

function resetToCourse() {
  if (!G || G.chal || G.penalty || G.anim) return;
  const p = G.path[G.idx], q = pointAt(G.path, p.d + 4);
  G.x = p.x; G.z = p.z; G.y = T.hAt(p.x, p.z); G.h = q.h; G.v = 0; G.vy = 0; G.air = false; G.camYaw = G.h;
  $('offc').hidden = true; G.offSince = 0;
}

// Time a runner would take between two points on the course (for Skip).
function estimate(P, d0, d1) {
  let t = 0;
  for (let d = d0; d < d1; d += 10) {
    const a = pointAt(P, d), b = pointAt(P, Math.min(d1, d + 10)), L = Math.min(10, d1 - d);
    t += L / (2.9 * realFactor((b.y - a.y) / Math.max(1, L)));
  }
  return t;
}
function skipAhead() {
  if (!G || G.chal || G.penalty || G.anim || G.ended) return;
  const d0 = progress(), o = G.W.obs[G.nextOb];
  const target = G.pathName ? G.path[G.path.length - 1].d - 3 : o ? o.at - 9 : G.path[G.path.length - 1].d - 12;
  if (target <= d0 + 5) return;
  G.extra += estimate(G.path, d0, target); G.skipped++;
  const p = pointAt(G.path, target), q = pointAt(G.path, target + 4);
  G.x = p.x; G.z = p.z; G.y = T.hAt(p.x, p.z); G.h = q.h; G.camYaw = q.h; G.v = 0; G.idx = p.i; G.stamina = Math.max(G.stamina, 0.6);
  toast('Skipped ahead (+' + fmtClock(estimate(G.path, d0, target)) + ')', 1500);
}

// ---------------------------------------------------------------- physics (sub-stepped, never more than 20 ms at a time)
function physics(dt) {
  const [sx, sy] = G.chal || G.penalty || G.anim ? [0, 0] : G.auto ? [0, G.autoStop ? 0 : 1] : inputs();
  const off = track();
  // steering: the pad turns you; steer assist eases you along the course ahead
  G.h -= Math.sign(sx) * Math.abs(sx) ** 1.5 * 2.4 * dt;
  if ((G.assist || G.auto) && off < 30 && G.v > 0.3 && Math.abs(sx) < 0.5) {
    const ahead = pointAt(G.path, progress() + 9), want = Math.atan2(ahead.x - G.x, ahead.z - G.z);
    G.h += angDiff(G.h, want) * Math.min(1, dt * 2.6);
  }
  // pace: forward runs, Sprint (or Shift) runs harder while there's energy, back slows and steps back
  const fx = Math.sin(G.h), fz = Math.cos(G.h);
  const g = (T.hAt(G.x + fx * 2, G.z + fz * 2) - T.hAt(G.x, G.z)) / 2;
  const sprint = SPRINT && G.sprintHeld && G.stamina > 0.02 && sy > 0.2;
  let target = sy > 0.1 ? (sprint ? 7 : G.stamina > 0.02 ? 5.4 : 2.2) * Math.min(1, sy * 1.25) : sy < -0.3 ? -1.1 : 0;
  target *= slopeFactor(g);
  if (off > 4) target *= 0.85; // rough ground off the trail
  if (G.stumble > 0) { G.stumble -= dt; target = 0; }
  G.v += clamp(target - G.v, -7 * dt, 3.2 * dt);
  // energy: sprinting and climbing use it; walking, standing and downhill give it back
  // energy goes by the metre: a full tank lasts about 10 km of running on the flat (less uphill, and sprinting uses
  // it three times as fast), so it always reaches the second water station; walking and standing give a little back
  const metres = Math.max(0, G.v) * dt, climb = 1 + 5 * Math.max(0, g);
  if (G.v > 2) G.stamina -= (metres / 10000) * climb * (sprint ? 3 : 1);
  else G.stamina += (G.v < 0.3 ? 0.01 : 0.004) * dt;
  G.stamina = clamp(G.stamina, 0, 1);
  // move, then push out of trees, buildings and pylons
  let nx = G.x + fx * G.v * dt, nz = G.z + fz * G.v * dt, hit = false;
  // the track: the tapes hold you in (a soft push back once you're over them, never further than a step past)
  if (!G.free) {
    const P = G.path, i = G.idx, a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    const tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz) || 1, ux = tx / tl, uz = tz / tl;
    const rx = nx - P[i].x, rz = nz - P[i].z, side = rx * uz - rz * ux, lim = TRAIL_W / 2 + 0.25, hard = TRAIL_W / 2 + 0.8;
    if (Math.abs(side) > lim) {
      const over = Math.abs(side) - lim, back = Math.min(over, over * 10 * dt + Math.max(0, Math.abs(side) - hard));
      nx -= uz * Math.sign(side) * back; nz += ux * Math.sign(side) * back;
      if (over > 0.3 && G.v > 3) { G.v *= 1 - 1.5 * dt; G.tapeAt = G.tapeAt || 0; if (performance.now() - G.tapeAt > 2500) { G.tapeAt = performance.now(); Sound.tick(); } }
    }
  }
  G.W.obstacles.near(nx, nz, (o) => {
    if (o.t === 'obox') { // an obstacle's frame or wall (a box turned to the course)
      const dx = nx - o.x, dz = nz - o.z, lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c, px = o.hx + 0.32 - Math.abs(lx), pz = o.hz + 0.32 - Math.abs(lz);
      if (px > 0 && pz > 0) {
        let ax = lx, az = lz; if (px < pz) ax += Math.sign(lx || 1) * px; else az += Math.sign(lz || 1) * pz;
        nx = o.x + ax * o.c + az * o.s; nz = o.z - ax * o.s + az * o.c; hit = true;
      }
    } else if (o.t === 'tree' || o.t === 'post') {
      const dx = nx - o.x, dz = nz - o.z, d = Math.hypot(dx, dz), min = o.r + 0.35;
      if (d < min && d > 1e-4) { nx = o.x + (dx / d) * min; nz = o.z + (dz / d) * min; hit = true; }
    } else if (o.t === 'box') {
      const dx = nx - o.x, dz = nz - o.z, px = o.hx + 0.35 - Math.abs(dx), pz = o.hz + 0.35 - Math.abs(dz);
      if (px > 0 && pz > 0) { if (px < pz) nx += Math.sign(dx) * px; else nz += Math.sign(dz) * pz; hit = true; }
    }
  });
  if (hit && Math.abs(G.v) > 4.5 && !G.air) { G.stumble = 0.8; G.v = 0; toast('Ouch!', 700); Sound.bad(); }
  const bump = G.crowd.bump(nx, nz, fx * G.v, fz * G.v, dt); // other contestants: you shove them aside (and they shove back)
  if (bump) { nx = bump.x; nz = bump.z; G.v *= bump.slow; if (bump.hard && performance.now() - (G.bumpAt || 0) > 900) { G.bumpAt = performance.now(); Sound.bad(); toast(bump.down ? 'Knocked them flying!' : 'Bump!', 600); } }
  G.x = clamp(nx, T.minX + 5, T.maxX - 5); G.z = clamp(nz, T.minZ + 5, T.maxZ - 5);
  const ground = T.hAt(G.x, G.z);
  if (G.air) { G.vy -= 9.8 * dt; G.y += G.vy * dt; if (G.y <= ground) { G.y = ground; G.air = false; G.vy = 0; } }
  else G.y = ground;
  return off;
}

// ---------------------------------------------------------------- obstacles and penalties
function checkCourse(off, dt) {
  // off course for a while: say so (Reset puts you back)
  if (off > 35) { if (!G.offSince) G.offSince = performance.now(); } else G.offSince = 0;
  $('offc').hidden = !(G.offSince && performance.now() - G.offSince > 2500);
  const d = progress();
  // water stations top up your energy
  // water stations: stop at one (a second or two standing still) and your energy fills right up
  if (G.autoStop && !G.W.water.some((w) => !w.used && Math.abs(d - w.at) < 14)) G.autoStop = false;
  if (!G.pathName) for (const w of G.W.water) {
    if (w.used) continue;
    if (!w.hinted && w.at - d < 60 && w.at - d > 15) { w.hinted = true; toast('💧 Water station ahead – stop to drink', 2200); }
    if (Math.abs(d - w.at) < 14) {
      if (G.auto) G.autoStop = G.stamina < 0.7;
      if (Math.abs(G.v) < 0.6 && !G.air) {
        G.drink = (G.drink || 0) + dt;
        if (G.drink > 1.5) { w.used = true; G.drink = 0; G.stamina = 1; G.autoStop = false; G.extra += 20; toast('Water station – energy full', 1600); Sound.good(); }
        else toast('Drinking…', 600);
      } else G.drink = 0;
    }
  }
  if (G.pathName) { // on a penalty loop: back to the course at its end
    if (d >= G.path[G.path.length - 1].d - 4) endLoop();
    return;
  }
  // a burpee station: do the burpees you owe here
  if (G.owed > 0) for (const b of G.W.burpeeStations) if (!b.done && d >= b.at - 6 && d < b.at + 30) { b.done = true; startPenalty({ name: 'Burpee station', at: b.at, station: true }, G.owed); return; }
  const o = G.W.obs[G.nextOb];
  if (o && d >= o.at - 5 && Math.hypot(G.x - o.x, G.z - o.z) < 16) startChallenge(o);
  else if (o && d > o.at + 12) { // went round it: back you go
    G.x = o.x - Math.sin(o.h) * 4; G.z = o.z - Math.cos(o.h) * 4; startChallenge(o);
  } else if (!o && d >= G.path[G.path.length - 1].d - 10) {
    if (G.owed > 0) { startPenalty({ name: 'Finish', at: d, station: true }, G.owed); return; } // owed burpees before you can finish
    finish();
  }
}

function placeAfter(o, metres = 7) {
  const p = pointAt(G.W.cs, o.at + metres), q = pointAt(G.W.cs, o.at + metres + 4);
  G.x = p.x; G.z = p.z; G.y = T.hAt(p.x, p.z); G.h = q.h; G.camYaw = q.h; G.v = 1.5; G.idx = p.i;
}

const MEMORY_WORDS = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL', 'INDIA', 'JULIET', 'KILO', 'LIMA', 'MIKE', 'NOVEMBER', 'OSCAR', 'PAPA', 'ROMEO', 'SIERRA', 'TANGO', 'VICTOR'];
const randCode = (r) => `${MEMORY_WORDS[Math.floor(r() * MEMORY_WORDS.length)]} ${100 + Math.floor(r() * 900)}-${1000 + Math.floor(r() * 9000)}`;

function startChallenge(o) {
  const kind = o.kind, rr = rng(Date.now() & 0xffffff);
  G.v = 0; G.chal = { o, kind, t0: performance.now(), t: 0, done: false, r: rr, kids: G.course.kids };
  const C = G.chal, title = o.name.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  { const a = act(o.spec, 0), p = pointAt(G.W.cs, o.at + a.along); G.x = p.x; G.z = p.z; G.y = T.hAt(p.x, p.z); G.h = o.h; }
  $('chalTitle').textContent = title;
  $('chalChoices').hidden = true; $('chalCv').hidden = false;
  // buttons send presses and releases (holding matters in some games)
  const btns = (list) => {
    $('chalBtns').innerHTML = '';
    for (const [label, key] of list) {
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = label;
      b.onpointerdown = (e) => { e.preventDefault(); if (b.setPointerCapture) b.setPointerCapture(e.pointerId); chalKey(key, true); };
      b.onpointerup = b.onpointercancel = (e) => { e.preventDefault(); chalKey(key, false); };
      $('chalBtns').appendChild(b);
    }
  };
  const text = (s) => { $('chalText').textContent = s; };
  const name = gameFor(o.name, kind);
  if (GAMES[name]) {
    C.game = GAMES[name]; C.diff = G.practice ? (G.practice.level - 1) / 4 : difficulty(G.course, o.at); C.energy = G.stamina;
    C.game.init(C);
    const level = Math.min(5, 1 + Math.floor(C.diff * 5)), tries = o.tries || 0;
    // first say what to do; the game starts when you press Start
    C.intro = !G.auto;
    text(`${C.game.help}`);
    $('chalTitle').textContent = `${title} · level ${level}/5${tries && !G.practice ? ` · try ${tries + 1} of ${MAX_TRIES}` : ''}`;
    C.startGame = () => { C.intro = false; C.t = 0; btns(C.game.buttons); };
    if (C.intro) btns(rulesFor(o.name) ? [['📖 Official rules', 'rules'], ['Start', 'start']] : [['Start', 'start']]); else C.startGame();
  } else if (kind === 'memoryBoard') {
    G.memory = G.memory || randCode(rr); C.until = performance.now() + 9000;
    text('Remember your code for the memory test later on:'); btns([['Got it', 'tap']]);
  } else if (kind === 'memoryTest') {
    if (!G.memory) { // never saw the board on this course: a free pass
      text('No memory board on your course – straight through.'); btns([['Go', 'tap']]); C.free = true;
    } else {
      const opts = new Set([G.memory]); while (opts.size < 4) { const [w, n] = randCode(rr).split(' '); opts.add(rr() < 0.5 ? `${G.memory.split(' ')[0]} ${n}` : `${w} ${G.memory.split(' ')[1]}`); }
      text('What was your code?'); $('chalCv').hidden = true; $('chalBtns').innerHTML = '';
      const ch = $('chalChoices'); ch.innerHTML = ''; ch.hidden = false;
      for (const s of [...opts].sort(() => rr() - 0.5)) { const b = document.createElement('button'); b.className = 'btn btn-dark'; b.textContent = s; b.onclick = () => endChallenge(s === G.memory); ch.appendChild(b); }
    }
  }
  $('chal').hidden = false;
}

// a press (down) or release of a game key: tap, left, right, up, down
function chalKey(key, down = true) {
  const C = G && G.chal; if (!C || C.done) return;
  if (C.intro) { if (down && key === 'rules') showRules(C.o); else if (down && (key === 'start' || key === 'tap')) C.startGame(); return; }
  if (C.game) {
    const before = C.result;
    C.game.key(C, key, down);
    if (down && !C.result) Sound.tick();
    if (C.result && !before) endChallenge(C.result === 'win');
    return;
  }
  if (down && key === 'tap' && (C.kind === 'memoryBoard' || (C.kind === 'memoryTest' && C.free))) endChallenge(true);
}

function challengeTick(dt) {
  const C = G.chal, cv = $('chalCv'), g = cv.getContext('2d'), W = cv.width, H = cv.height;
  C.t += dt;
  if (G.auto && C.t > 0.9) { endChallenge(true); return; } // the bot always gets it
  g.clearRect(0, 0, W, H); g.fillStyle = '#161616'; g.fillRect(0, 0, W, H);
  const k = C.kind;
  if (C.intro) { // what to do, until Start
    C.t = 0;
    g.fillStyle = '#fff'; g.font = 'bold 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText((C.game && C.game.title) || 'Get ready', W / 2, 70);
    g.font = '24px system-ui, sans-serif'; g.fillStyle = '#bbb'; g.fillText('Press Start (or Space) when you’re ready', W / 2, 140);
    return;
  }
  if (C.game) {
    C.energy = G.stamina; C.stick = inputs()[0];
    const r = C.game.tick(C, dt, g, W, H);
    if (r) { endChallenge(r === 'win'); return; }
  } else if (k === 'memoryBoard') {
    g.fillStyle = '#fff'; g.font = 'bold 64px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(G.memory, W / 2, 110);
    if (performance.now() > C.until) { endChallenge(true); return; }
  }
  // the runner acts the obstacle out as you play: each good grab climbs higher, each swing moves along the rig,
  // the carry and the crawl go as far as your taps, the balance walk follows the bar
  if (DOING[k] && G.chal === C && C.o.spec.shape !== 'through') {
    C.A = C.A || makeDoing(C.o);
    const sh = C.o.spec.shape;
    const share = sh === 'rope' ? 0.5 : sh === 'frame' || sh === 'slip' || sh === 'stair' ? 0.4 : sh === 'wall' ? 0.42 : sh === 'rig' || sh === 'tyrolean' || sh === 'traverse' || sh === 'spider' ? 0.88 : sh === 'carry' || sh === 'crawl' ? 0.95 : sh === 'balance' ? 0.92 : sh === 'hoist' ? 0.78 : 0;
    C.u = Math.max(0, (C.game ? C.game.progress(C) : 0) * share);
    applyDoing(C.A, C.u);
    if (k === 'aim') G.pose = 'throw';
  } else G.pose = null;
}

function endChallenge(ok) {
  const C = G.chal; if (!C || C.done) return;
  C.done = true;
  const o = C.o, spent = (performance.now() - C.t0) / 1000;
  G.extra += Math.max(0, (REAL_TIME[C.kind] || 20) * (/LOG|ATLAS|PLATE|TIRE/i.test(o.name) ? 1.4 : 1) - spent);
  $('chal').hidden = true; G.chal = null; G.nextOb++;
  if (C.penaltyTime) G.extra += C.penaltyTime;
  const canFail = C.game ? (C.canFail ?? C.game.fail) : PENALTY_KINDS.has(C.kind);
  if (ok || !canFail) {
    if (ok) { G.passed++; Sound.good(); toast(C.kind === 'memoryBoard' ? 'Code saved' : 'Done!', 900); }
    else { G.passed++; G.extra += 8; toast('Messy, but through', 900); }
    startDoing(o, C.u || 0);
    return;
  }
  Sound.bad();
  if (G.practice) { practiceCard(o, false); return; }
  o.tries = (o.tries || 0) + 1;
  if (o.tries < MAX_TRIES) { // another go
    toast(`Missed – try ${o.tries + 1} of ${MAX_TRIES}`, 1400); G.nextOb--;
    setTimeout(() => { if (G && !G.chal) startChallenge(o); }, 700);
    return;
  }
  G.failed++;
  if (G.course.kids) { toast('Good try – carry on!', 1200); placeAfter(o); return; }
  // a penalty loop where the course has one, otherwise 30 burpees
  const loop = o.penalty && G.W.loops[o.penalty];
  if (loop) {
    // run it from the end nearest you
    const a = loop[0], b = loop[loop.length - 1], rev = Math.hypot(b.x - G.x, b.z - G.z) < Math.hypot(a.x - G.x, a.z - G.z);
    let P = rev ? loop.slice().reverse() : loop;
    if (rev) { const L = P[0].d; P = P.map((p) => ({ ...p, d: L - p.d, h: p.h + Math.PI })); }
    G.path = P; G.pathName = o.penalty; G.idx = 0; G.loopFrom = o; G.loopsRun++;
    G.x = P[0].x; G.z = P[0].z; G.y = T.hAt(G.x, G.z); G.h = pointAt(P, 6).h; G.camYaw = G.h;
    toast(`Failed – penalty loop (${Math.round(P[P.length - 1].d)} m)`, 2200);
  } else {
    // 30 burpees, done at the next burpee station (or at the finish)
    G.owed = (G.owed || 0) + 30;
    toast(`5 misses: 30 burpees owed – do them at the burpee station (${G.owed} owed)`, 2600);
    placeAfter(o);
  }
}
function endLoop() {
  const o = G.loopFrom;
  G.path = G.W.cs; G.pathName = null; G.loopFrom = null;
  placeAfter(o, 8);
  toast('Penalty loop done', 1200);
}

function startPenalty(o, count = 30) {
  G.penalty = { left: count, o, animT: -1 };
  $('burpeeCount').textContent = String(count);
  $('penTitle').textContent = o.station ? `Burpee station: ${count} burpees` : `Penalty: ${count} burpees`;
  $('penText').textContent = `${o.station ? 'Your penalties from missed obstacles.' : `Missed ${o.name.replace(/\s*\(.*?\)\s*/g, ' ').trim()}.`} Tap BURPEE (or Space) for each one – wait for the jump before the next.`;
  $('pen').hidden = false;
}
function burpeeTap() {
  const P = G && G.penalty; if (!P || P.animT >= 0) return;
  P.animT = 0;
}
$('bBurpee').onpointerdown = (e) => { e.preventDefault(); burpeeTap(); };
function penaltyTick(dt) {
  const P = G.penalty;
  if (P.animT >= 0) {
    P.animT += dt / 0.7;
    if (P.animT >= 1) {
      P.animT = -1; P.left--; G.burpees++; G.extra += 1.6; Sound.tick();
      $('burpeeCount').textContent = String(P.left);
      if (P.left <= 0) {
        $('pen').hidden = true; G.penalty = null; toast('Penalty done', 1000);
        if (P.o.station) { G.owed = 0; if (P.o.name === 'Finish') { finish(); return; } G.v = 0; return; } // carry on from the station
        placeAfter(P.o); return;
      }
    }
  }
  G.pose = 'burpee'; G.poseT = Math.max(0, P.animT);
}

function finish() {
  G.ended = true;
  const total = G.play + G.extra, c = G.course;
  $('finTitle').textContent = `${c.name} finished!`;
  const rows = [['Race time', fmtClock(total)], ['Distance', (c.length / 1000).toFixed(1) + ' km'], ['Obstacles done', `${G.passed} / ${G.W.obs.length}`], ['Failed', G.failed], ['Burpees', G.burpees], ['Penalty loops', G.loopsRun], ['Skips', G.skipped]];
  $('finRes').innerHTML = rows.map(([a, b]) => `<span>${a}</span><b>${b}</b>`).join('');
  const best = store.get('best_' + c.id, null);
  if (!G.skipped && (!best || total < best)) { store.set('best_' + c.id, total); $('finRes').innerHTML += '<span>Personal best!</span><b>★</b>'; }
  else if (best) $('finRes').innerHTML += `<span>Best (no skips)</span><b>${fmtClock(best)}</b>`;
  $('finish').hidden = false;
  Sound.good();
}

// ---------------------------------------------------------------- official rules and practice
function showRules(o) {
  const r = rulesFor(o.name); if (!r) return;
  $('rulesTitle').textContent = r.title;
  $('rulesType').textContent = TYPE_TEXT[r.type];
  $('rulesList').innerHTML = r.points.map((p) => `<li>${p}</li>`).join('');
  $('rulesPage').href = RULES_PAGE; $('rulesPdf').href = RULEBOOK_PDF;
  $('rulesCard').hidden = false;
}
$('rulesClose').onclick = () => { $('rulesCard').hidden = true; };
function practiceCard(o, ok) {
  G.v = 0;
  $('pracTitle').textContent = ok ? 'Nailed it!' : 'Missed';
  $('pracText').textContent = `${o.name.replace(/\s*\(.*?\)\s*/g, ' ').trim()} at level ${G.practice.level}/5.`;
  $('pracCard').hidden = false;
}
$('pracAgain').onclick = () => {
  const o = G.W.obs.find((x) => Math.abs(x.at - G.practice.at) < 1);
  G.practice.level = +$('pracLvl2').value;
  $('pracCard').hidden = true; G.chal = null; G.anim = null; G.nextOb = o.k; o.tries = 0;
  const p = pointAt(G.W.cs, o.at - 12), q = pointAt(G.W.cs, o.at - 8);
  G.x = p.x; G.z = p.z; G.y = T.hAt(p.x, p.z); G.h = q.h; G.camYaw = q.h; G.v = 0; G.idx = p.i;
};
$('pracOther').onclick = () => { $('pracCard').hidden = true; toMenu(); if (history.state?.screen === 'game') history.replaceState({ screen: 'courses' }, '', '#courses'); $('lookStep').hidden = true; $('courseStep').hidden = false; $('pracSec').scrollIntoView(); };
// each game's short name (for the course list and the map), and the memory obstacles
const GAME_NAMES = new Proxy({ memoryBoard: 'Memory', memoryTest: 'Memory' }, { get: (t, k) => t[k] || (GAMES[k] && GAMES[k].label) });

// ---------------------------------------------------------------- doing the obstacle
// After a challenge is passed the runner does the obstacle for real: over the wall, along the rig, the carry, the crawl...
// Each kind is a short scripted move along the course (from just before the obstacle to just after it) with a height and a pose.
const DOING = {
  climb: { dur: 3.2, from: -2.5, to: 5 },
  hurdle: { dur: 2.2, from: -4, to: 5 },
  rig: { dur: 4.5, from: -4.5, to: 6 },
  carry: { dur: 5, from: -2, to: 7 },
  crawl: { dur: 5, from: -5, to: 6 },
  balance: { dur: 4, from: -4, to: 6 },
  hoist: { dur: 3, from: -1, to: 4 },
  aim: { dur: 2.4, from: -0.5, to: 4 },
  bell: { dur: 2.4, from: -1.5, to: 4 },
};
const makeDoing = (o) => ({ o, dur: o.spec.dur, from: o.spec.from, to: o.spec.to, t: 0, lane: o.spec.lanes[Math.floor((o.spec.lanes.length - 1) / 2)] });
// from = how far through the move the mini-game already got (0..1): the runner carries on from there
function startDoing(o, from = 0) {
  if (!o.spec || o.spec.shape === 'through') { placeAfter(o, o.spec ? o.spec.to : 7); if (G.practice) practiceCard(o, true); return; }
  G.anim = makeDoing(o); G.anim.t = from * G.anim.dur;
  if (o.kind === 'aim') throwSpear(o);
}
function doingTick(dt) {
  const A = G.anim; A.t += dt;
  applyDoing(A, Math.min(1, A.t / A.dur));
  if (A.t >= A.dur) { G.anim = null; G.pose = null; placeAfter(A.o, A.to + 1); if (G.practice) practiceCard(A.o, true); }
}
function applyDoing(A, u) {
  const o = A.o, a = act(o.spec, u, A.lane);
  const p = pointAt(G.W.cs, o.at + a.along), c = Math.cos(o.h), s = Math.sin(o.h);
  G.x = p.x + a.lat * c; G.z = p.z - a.lat * s; G.h = o.h + a.face; G.y = T.hAt(G.x, G.z) + a.up; G.idx = p.i;
  G.v = a.pose ? 0 : 3.5; G.pose = a.pose; G.poseT = 0;
  if (o.spec.state) o.spec.state.u = o.spec.shape === 'hoist' ? Math.min(1, u / 0.75) * (u < 0.8 ? 1 : 1 - seg01(u, 0.8, 0.95)) : u;
  // the bell: rung at the top of the rope, at the end of a traverse, the tyrolean, the iconic bell
  if (o.bells.length && !A.rang && ((o.spec.shape === 'rope' && u > 0.55) || (o.spec.shape === 'traverse' && u > 0.88) || (o.spec.shape === 'tyrolean' && u > 0.86) || (o.spec.shape === 'bell' && u > 0.25))) {
    A.rang = true; let best = o.bells[0], bd = Infinity;
    for (const b of o.bells) { const w = b.getWorldPosition(new THREE.Vector3()), d = (w.x - G.x) ** 2 + (w.z - G.z) ** 2; if (d < bd) { bd = d; best = b; } }
    best.userData.swing = 1; Sound.beep(o.spec.shape === 'bell' ? 900 : 1500, 0.6, 'sine', 0.12);
  }
}
const seg01 = (u, a, b) => clamp((u - a) / (b - a), 0, 1);
// a spear (or a laser flash) that flies to the target
function throwSpear(o) {
  const laser = /LASER/i.test(o.name);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, laser ? 8 : 1.8, 6), new THREE.MeshBasicMaterial({ color: laser ? 0xff2020 : 0x9a6b3f }));
  m.rotation.x = Math.PI / 2; const holder = new THREE.Group(); holder.add(m); holder.visible = false; G.scene.add(holder);
  const start = performance.now(), from = pointAt(G.W.cs, o.at - 0.5), y0 = T.hAt(from.x, from.z) + 1.8, fx = Math.sin(o.h), fz = Math.cos(o.h), scene = G.scene;
  const fly = () => {
    const el = performance.now() - start, k = Math.min(1, (el - 700) / (laser ? 150 : 700));
    if (!G || G.scene !== scene) return;
    if (el > (laser ? 2200 : 9000)) { scene.remove(holder); return; } // (a spear stays stuck in the bale for a while)
    if (k >= 0) {
      holder.visible = !laser || el < 1100;
      const dist = laser ? 4 : ((o.spec && o.spec.target) || 8) * 1.02 * k + 0.6 * k;
      holder.position.set(from.x + fx * dist, y0 + (laser ? -0.3 : Math.sin(k * Math.PI) * 0.8 - 0.3 * k), from.z + fz * dist); holder.rotation.y = o.h;
    }
    requestAnimationFrame(fly);
  };
  requestAnimationFrame(fly);
}

// ---------------------------------------------------------------- camera
function cycleCam() { if (!G) return; G.cam = { far: 'close', close: 'first', first: 'far' }[G.cam]; store.set('cam', G.cam); toast({ far: 'Far view', close: 'Close view', first: 'First person' }[G.cam], 700); }
function placeCamera(dt) {
  const { rig, camera } = G;
  const now = performance.now();
  if (!G.dragging && G.released && now - G.released > 500) { const k = Math.min(1, dt * 3.5); G.yawOff -= G.yawOff * k; G.pitchOff -= G.pitchOff * k; }
  G.camYaw += angDiff(G.camYaw, G.h) * Math.min(1, dt * (G.cam === 'first' ? 9 : 3.2));
  G.yS += (G.y - G.yS) * Math.min(1, dt * 8);
  const yaw = G.camYaw + G.yawOff;
  rig.position.set(G.x, G.yS, G.z); rig.rotation.set(0, yaw + Math.PI, 0);
  if (G.cam === 'first') { camera.position.set(0, 1.65, -0.15); camera.rotation.set(-0.12 + G.pitchOff, 0, 0); camera.near = 0.15; }
  else {
    const far = G.cam === 'far' && !(G.chal || G.penalty), dist = (far ? 11 : 5) + Math.abs(G.v) * (far ? 0.4 : 0.2);
    // stay above the ground behind the runner
    const bx = G.x - Math.sin(yaw) * dist, bz = G.z - Math.cos(yaw) * dist;
    const h = Math.max(far ? 5 : 2.4, T.hAt(bx, bz) + (far ? 3 : 1.6) - G.yS);
    camera.position.set(0, h, dist); camera.rotation.set(-Math.atan((h - 1.3) / (dist + (far ? 8 : 4))) + G.pitchOff * 0.5, 0, 0);
    camera.near = far ? 0.5 : 0.3;
  }
  camera.fov = 62 + Math.min(8, Math.abs(G.v) * 0.8);
  // at an obstacle the card covers the bottom of the screen: lift the picture so the runner stays in view
  const card = !!(G.chal || G.penalty), w = renderer.domElement.width, hh = renderer.domElement.height;
  if (card) camera.setViewOffset(w, hh, 0, hh * 0.26, w, hh); else if (camera.view && camera.view.enabled) camera.clearViewOffset();
  camera.updateProjectionMatrix();
  rig.updateMatrixWorld(true);
  // never below the ground
  const cp = camera.getWorldPosition(new THREE.Vector3()), floor = T.hAt(cp.x, cp.z) + (G.cam === 'first' ? 0.3 : 1);
  if (cp.y < floor) { rig.position.y += floor - cp.y; rig.updateMatrixWorld(true); }
  // the sun (and its shadow box) follows the runner
  const sd = G.sky.sunDir; G.sun.position.set(G.x + sd.x * 200, G.y + sd.y * 200, G.z + sd.z * 200); G.sun.target.position.set(G.x, G.y, G.z); G.sun.target.updateMatrixWorld();
}
// Trees between the camera and the runner are hidden so they never block the view.
function ghostTrees() {
  const m4 = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const cp = G.camera.getWorldPosition(new THREE.Vector3()), hide = new Set();
  for (let k = 0; k <= 6; k++) {
    const x = cp.x + (G.x - cp.x) * (k / 6), z = cp.z + (G.z - cp.z) * (k / 6);
    G.W.obstacles.near(x, z, (o) => { if (o.t === 'tree' && o.item.mesh && Math.hypot(o.x - x, o.z - z) < 4 && Math.hypot(o.x - G.x, o.z - G.z) > 1.2) hide.add(o.item); });
  }
  const touched = new Set();
  for (const it of G.ghosts) if (!hide.has(it)) { q.setFromAxisAngle(up, it.ry || 0); m4.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.sx, it.sy, it.sz)); it.mesh.setMatrixAt(it.i, m4); touched.add(it.mesh); }
  for (const it of hide) { it.mesh.setMatrixAt(it.i, zero); touched.add(it.mesh); }
  for (const m of touched) m.instanceMatrix.needsUpdate = true;
  G.ghosts = [...hide];
}

// The way to go: an arrow on the ground just ahead, pointing along the course (or back to it when you've wandered off).
// Green while you're heading the right way, red when you're not.
function placeArrow() {
  const a = G.arrow, busy = G.chal || G.penalty || G.anim || G.ended;
  a.visible = !busy;
  if (busy) return;
  const here = G.path[G.idx], off = Math.hypot(G.x - here.x, G.z - here.z);
  const target = off > 12 ? here : pointAt(G.path, here.d + 14);
  const want = Math.atan2(target.x - G.x, target.z - G.z);
  const right = Math.abs(angDiff(G.h, want)) < 1.1;
  const x = G.x + Math.sin(want) * 2.4, z = G.z + Math.cos(want) * 2.4;
  a.position.set(x, T.hAt(x, z) + 0.25, z); a.rotation.y = want;
  a.material.color.setHex(right ? 0x22c55e : 0xe2231a);
  a.scale.setScalar(right ? 0.9 : 1.15 + Math.sin(performance.now() / 150) * 0.08);
}

// ---------------------------------------------------------------- HUD and map
let miniBase = null;
function drawMiniBase() {
  const cs = G.W.cs; let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of cs) { a = Math.min(a, p.x); b = Math.min(b, p.z); c = Math.max(c, p.x); d = Math.max(d, p.z); }
  const pad = 60; a -= pad; b -= pad; c += pad; d += pad;
  const s = Math.max(c - a, d - b);
  miniBase = { a: (a + c) / 2 - s / 2, b: (b + d) / 2 - s / 2, s };
  let ymin = Infinity, ymax = -Infinity; for (const p of cs) { ymin = Math.min(ymin, p.y); ymax = Math.max(ymax, p.y); }
  miniBase.ymin = ymin; miniBase.ymax = ymax;
}
function drawHud() {
  const c = G.course, d = G.pathName ? G.loopFrom.at : progress();
  $('clock').textContent = fmtClock(G.play + G.extra);
  $('dist').textContent = `${(d / 1000).toFixed(2)} / ${(c.length / 1000).toFixed(1)} km`;
  const g = (T.hAt(G.x + Math.sin(G.h) * 6, G.z + Math.cos(G.h) * 6) - T.hAt(G.x - Math.sin(G.h) * 6, G.z - Math.cos(G.h) * 6)) / 12;
  $('elev').textContent = `${Math.round(G.y)} m · ${g >= 0 ? '↗' : '↘'} ${Math.abs(Math.round(g * 100))}%`;
  $('tally').textContent = `Obstacles ${G.passed}/${G.W.obs.length} · Burpees ${G.burpees}${G.owed ? ` · ${G.owed} owed` : ''}`;
  const o = G.W.obs[G.nextOb];
  $('next').innerHTML = G.pathName ? `PENALTY LOOP<small>${Math.max(0, Math.round(G.path[G.path.length - 1].d - progress()))} m to go</small>`
    : o ? `#${G.nextOb + 1} ${o.name.replace(/\s*\(.*?\)\s*/g, ' ').trim()}<small>in ${Math.max(0, Math.round(o.at - d))} m</small>` : `FINISH<small>in ${Math.max(0, Math.round(c.length - d))} m</small>`;
  $('stamBar').style.width = Math.round(G.stamina * 100) + '%';
  if (G.jumpAt) $('jump').style.setProperty('--c', clamp((performance.now() - G.jumpAt) / JUMP_FULL, 0, 1));
  // the mini-map: the course map (terrain, roads, numbered obstacles, water stations), close up and following you
  const mm = G.mini;
  mm.player = { x: G.x, z: G.z, h: G.h }; mm.runner = { d: G.pathName ? G.loopFrom.at : progress() };
  mm.highlight = o ? o.k : -1; mm.follow = !$('mapBox').classList.contains('big'); mm.redraw();
  const cs = G.W.cs, B = miniBase;
  // height profile with where you are
  const pv = $('prof'), q = pv.getContext('2d'), PW = pv.width, PH = pv.height, L = cs[cs.length - 1].d, span = Math.max(50, B.ymax - B.ymin);
  q.fillStyle = '#161616'; q.fillRect(0, 0, PW, PH); q.fillStyle = '#5b4a33'; q.beginPath(); q.moveTo(0, PH);
  for (let i = 0; i < cs.length; i += 8) q.lineTo((cs[i].d / L) * PW, PH - 4 - ((cs[i].y - B.ymin) / span) * (PH - 10));
  q.lineTo(PW, PH); q.fill(); q.fillStyle = '#e2231a'; q.fillRect((d / L) * PW - 1.5, 0, 3, PH);
}
let toastTimer = 0;
function toast(s, ms = 1000) { const t = $('toast'); t.textContent = s; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ms); }

// ---------------------------------------------------------------- buttons
function togglePause() {
  if (!G || G.ended) return;
  G.paused = !G.paused;
  $('pauseCard').hidden = !G.paused; $('pAssist').checked = G.assist;
  G.last = performance.now();
}
$('bPause').onclick = togglePause;
$('bResume').onclick = togglePause;
$('pAssist').onchange = () => { G.assist = $('pAssist').checked; store.set('assist', G.assist); };
$('bCam').onclick = cycleCam;
$('bWx').onclick = () => {
  if (!G) return;
  const order = ['auto', ...Object.keys(WX)], next = order[(order.indexOf(G.sky.mode) + 1) % order.length];
  G.sky.mode = next; G.sky.auto = null; $('optWeather').value = next; store.set('weather', next);
  toast(next === 'auto' ? 'Weather: changes as you go' : `${WX[next].ic} ${WX[next].name}`, 1200);
};
$('bSkip').onclick = skipAhead;
$('bAuto').onclick = () => {
  if (!G) return;
  G.auto = !G.auto; G.autoStop = false;
  $('bAuto').classList.toggle('on', G.auto);
  toast(G.auto ? '🤖 Auto: running the course by itself' : 'Auto off: you’re running', 1600);
};
$('bReset').onclick = resetToCourse;
$('bSound').onclick = () => { Sound.on = !Sound.on; store.set('sound', Sound.on); $('bSound').firstChild.textContent = Sound.on ? '🔊' : '🔇'; };
$('bSound').firstChild.textContent = Sound.on ? '🔊' : '🔇';
const toMenu = () => { close(); $('game').hidden = true; $('menu').hidden = false; $('sheet').hidden = true; $('pracCard').hidden = true; $('rulesCard').hidden = true; };
const leaveGame = () => { if (G && !G.ended) G.paused = true; if (history.state?.screen === 'game') history.back(); else toMenu(); };
$('bQuit').onclick = leaveGame;
$('bMenu').onclick = leaveGame;
$('bAgain').onclick = () => { const id = G.course.id; start(id, G.startedAt || 0); };
$('mapBox').onclick = () => {
  const big = $('mapBox').classList.toggle('big');
  if (G && G.mini) { G.mini.resize(); if (big) G.mini.fit(); else { G.mini.view.s = 0.5; } G.mini.redraw(); }
  if (G && !G.ended && big !== G.paused) { G.paused = big; G.last = performance.now(); }
};

// ---------------------------------------------------------------- the frame loop
function frame(now) {
  if (!G) return;
  G.raf = requestAnimationFrame(frame);
  const dt = G.paused || G.ended ? 0 : Math.min(0.1, (now - G.last) / 1000); // a long gap (tab hidden, slow frame) never jumps the runner
  G.last = now;
  if (!G.chal && !G.penalty && !G.anim) G.pose = null; // (kept through a paused frame, so the runner holds the pose)
  if (dt > 0) {
    G.play += dt;
    if (G.chal) challengeTick(dt);
    else if (G.penalty) penaltyTick(dt);
    else if (G.anim) doingTick(dt);
    else {
      const n = Math.ceil(dt / 0.02); let off = 0;
      for (let i = 0; i < n; i++) off = physics(dt / n);
      checkCourse(off, dt);
      if (G.v > 1.5 && !G.air && now - G.stepAt > 3400 / (3 + G.v * 1.7)) { G.stepAt = now; if (G.v > 3) Sound.step(); }
    }
  }
  // the runner
  const R = G.R;
  R.root.position.set(G.x, G.y, G.z); R.root.rotation.y = G.h;
  animatePerson(R, dt, G.chal || G.penalty ? 0 : Math.abs(G.v), G.pose || (G.air ? 'jump' : null), G.poseT || 0);
  R.root.visible = G.cam !== 'first' || !!G.chal || !!G.penalty;
  // carrying: show what this obstacle has you carry
  const carryOb = (G.chal && G.chal.o) || (G.anim && G.anim.o);
  showProp(R, G.pose === 'carry' && carryOb ? carryOb.name : null);
  placeCamera(dt || 0.016);
  const cp = G.camera.getWorldPosition(new THREE.Vector3());
  const cheering = G.crowd.update(dt, now, G, G.pathName ? G.loopFrom.at : progress(), cp, G.ended);
  Sound.crowd(cheering);
  G.sky.step(dt, cp, G.scene.fog, toast, Sound);
  G.grass(G.x, G.z, dt);
  // the obstacles' moving parts: ropes, flags, the twister, flames, the hoist (only those near enough to see)
  for (const o of G.W.obs) if (o.tick && o.model.visible && (o.x - cp.x) ** 2 + (o.z - cp.z) ** 2 < 160 * 160) o.tick(dt, cp);
  placeArrow();
  if (now > G.cullAt) { G.cullAt = now + 250; cullThings(G.W.things, G.camera); }
  if (now > G.ghostAt && G.cam !== 'first') { G.ghostAt = now + 150; ghostTrees(); }
  renderer.render(G.scene, G.camera);
  drawHud();
  // drop shadows, then resolution, then view distance if the frame rate sags (SkiTour's approach)
  G.ft++; G.fsum += dt || 0.016;
  if (G.ft === 90) {
    if (G.fsum / 90 > 0.036 && $('optQuality').value === 'auto') {
      // keep the shadows as long as possible: resolution first, then a smaller shadow map, then view distance, shadows last
      if (!G.q1) { G.q1 = true; renderer.setPixelRatio(1); resize(); }
      else if (!G.q2) { G.q2 = true; G.sun.shadow.map && G.sun.shadow.map.dispose(); G.sun.shadow.map = null; G.sun.shadow.mapSize.set(1024, 1024); }
      else if (!G.q3) { G.q3 = true; for (const t of G.W.things) t.userData.scale = 0.6; }
      else if (G.sun.castShadow) { G.sun.castShadow = false; renderer.shadowMap.enabled = false; G.R.blob.visible = true; G.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); }
    }
    G.ft = 0; G.fsum = 0;
  }
}

// for testing in a browser console
window.__CR = { get G() { return G; }, get renderer() { return renderer; }, start, skipAhead, chalKey, burpeeTap, frame, openSheet, startChallenge, get SHEET() { return SHEET; } };
