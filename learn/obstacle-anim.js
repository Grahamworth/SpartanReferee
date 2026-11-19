// The obstacle animations' engine (#/obstacles/<id>): a jointed athlete drawn in SVG, posed by keyframes. A keyframe gives where the hips are,
// the lean, which way they face, and where each hand and foot goes; the elbows and knees are worked out (two-bone IK). Each obstacle's scene
// (obstacle-scenes.js) draws its structure and builds timelines: a good run, and one or more fails. The player loops: the good run at real
// speed, the same slowed down stopping on what counts (✓, green), then each fail slowed down stopping on the moment it goes wrong (✗, red).
import { esc, t } from './core.js';

export const G = 200; // the ground, in a 400 × 225 picture (about 52 px to a metre)
const L = { T: 32, U: 17, F: 16, TH: 21, SH: 21 };
const D = Math.PI / 180;
export const lerp = (a, b, k) => a + (b - a) * k;
const ease = (k) => k * k * (3 - 2 * k);
function mix(a, b, k) {
  if (typeof a === 'number' && typeof b === 'number') return lerp(a, b, k);
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => mix(v, b[i], k));
  return k < 1 ? a : b;
}

/** standing at x on the ground (or on gy), facing f (1 right, -1 left, 0 towards the obstacle, back to us) */
export const stand = (x, f = 1, gy = G) => {
  const w = f ? 0 : 6;
  return { x, y: gy - 41, a: 4, f, lf: [x - 4 * f - w, gy], rf: [x + 5 * f + w, gy], lh: [x - 3 * f - w * 1.6, gy - 39], rh: [x + 4 * f + w * 1.6, gy - 39] };
};

/** a timeline: keyframes, each the whole state (what a keyframe doesn't say carries on), and the moments to point at */
export function timeline(start) {
  const keys = [[0, { cam: [200, 112, 1], ...start }, 'e']];
  const o = {
    keys, marks: [],
    get s() { return keys[keys.length - 1][1]; },
    get end() { return keys[keys.length - 1][0]; },
    /** move to a new state over dt seconds ('lin' keeps an even pace, for walking) */
    to(dt, p, ez = 'e') { const [t0, s] = keys[keys.length - 1]; keys.push([t0 + dt, { ...s, ...(typeof p === 'function' ? p(s) : p) }, ez]); return o; },
    hold(dt) { return o.to(dt, {}); },
    /** point at something now: text (a Good or Bad line), at = 'lh' | 'rh' | 'lf' | 'rf' | 'hip' | 'head' | 'sh' | [x, y], hl = parts to show red */
    mark(text, at, opt = {}) { o.marks.push({ t: o.end + (opt.dt || 0), text, at, ...opt }); return o; },
  };
  return o;
}
export function sample(tl, time) {
  const k = tl.keys;
  if (time <= 0) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (time <= k[i][0]) {
      const span = k[i][0] - k[i - 1][0], x = span ? (time - k[i - 1][0]) / span : 1;
      return mix(k[i - 1][1], k[i][1], k[i][2] === 'lin' ? x : ease(x));
    }
  }
  return k[k.length - 1][1];
}

// ------------------------------------------------------------------------------------------------ moving about
const shoulderAt = (x, y, a, f) => [x + Math.sin(a * D) * f * (L.T - 3), y - Math.cos(a * D) * (L.T - 3)];
/** walk or run to x1. hands(s) gives the hands (and anything carried) for a carry; otherwise the arms swing */
export function walk(o, x1, opt = {}) {
  const base = opt.run ? { v: 150, stride: 40, lift: 14, lean: 14, bob: 3 } : { v: 75, stride: 26, lift: 6, lean: 5, bob: 2 };
  const { v, stride, lift, lean, bob, hands, run, gy = G } = { ...base, ...opt };
  let s = o.s;
  const f = Math.sign(x1 - s.x) || s.f, n = Math.max(1, Math.round(Math.abs(x1 - s.x) / stride)), dx = (x1 - s.x) / n, dt = Math.abs(dx) / v;
  let back = f * s.lf[0] <= f * s.rf[0] ? 'lf' : 'rf';
  for (let i = 0; i < n; i++) {
    const x = s.x + dx, xm = s.x + dx / 2, sw = back, land = [x + f * stride * 0.42, gy], from = s[sw];
    const arms = (hx, hy, swing) => {
      if (hands) return hands({ ...o.s, x: hx, y: hy, a: lean, f });
      const sh = shoulderAt(hx, hy, lean, f), fw = run ? [sh[0] + f * 15, sh[1] + 17] : [sh[0] + f * 11, sh[1] + 29], bk = run ? [sh[0] - f * 11, sh[1] + 22] : [sh[0] - f * 9, sh[1] + 30];
      return swing === 'lf' ? { rh: fw, lh: bk } : { lh: fw, rh: bk };
    };
    o.to(dt / 2, { x: xm, y: gy - 41 - bob, a: lean, f, [sw]: [(from[0] + land[0]) / 2, gy - lift], ...arms(xm, gy - 41 - bob, sw) }, 'lin');
    o.to(dt / 2, { x, y: gy - 41, [sw]: land, ...arms(x, gy - 41, sw) }, 'lin');
    back = sw === 'lf' ? 'rf' : 'lf'; s = o.s;
  }
  return o;
}
/** feet together under the hips, arms down: stopping */
export const settle = (o, dt = 0.25, extra = {}) => o.to(dt, (s) => ({ ...stand(s.x, s.f), ...extra }));

// ------------------------------------------------------------------------------------------------ the figure
function ik(root, target, a, b, pref) {
  let dx = target[0] - root[0], dy = target[1] - root[1], d = Math.hypot(dx, dy) || 0.001;
  const max = a + b - 0.01;
  if (d > max) { dx *= max / d; dy *= max / d; d = max; }
  const end = [root[0] + dx, root[1] + dy], base = Math.atan2(dy, dx), A = Math.acos(Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d))));
  const m1 = [root[0] + a * Math.cos(base + A), root[1] + a * Math.sin(base + A)], m2 = [root[0] + a * Math.cos(base - A), root[1] + a * Math.sin(base - A)];
  const c = [(root[0] + end[0]) / 2, (root[1] + end[1]) / 2], dot = (m) => (m[0] - c[0]) * pref[0] + (m[1] - c[1]) * pref[1];
  return [root, dot(m1) >= dot(m2) ? m1 : m2, end];
}
/** where everything is: hips, shoulders, head, and each limb's three points */
export function solve(s) {
  const f = s.f, side = 1 - Math.min(1, Math.abs(f)), a = s.a * D, d = [Math.sin(a) * Math.max(-1, Math.min(1, f * 1.5)), -Math.cos(a)];
  const hip = [s.x, s.y], sh = [hip[0] + d[0] * (L.T - 3), hip[1] + d[1] * (L.T - 3)], head = [hip[0] + d[0] * (L.T + 8), hip[1] + d[1] * (L.T + 8)];
  const fs = Math.sign(f) || 1;
  const kn = (lr) => s.kp || [lerp(fs, lr, side), lerp(0.15, 0.2, side)], el = (lr) => s.ep || [lerp(-fs * 0.8, lr, side), lerp(0.6, 0.3, side)];
  const o = (p, k) => [p[0] + k * side, p[1]];
  return {
    hip, sh, head, d, side,
    ll: ik(o(hip, -5), s.lf, L.TH, L.SH, kn(-1)), rl: ik(o(hip, 5), s.rf, L.TH, L.SH, kn(1)),
    la: ik(o(sh, -8), s.lh, L.U, L.F, el(-1)), ra: ik(o(sh, 8), s.rh, L.U, L.F, el(1)),
  };
}
const pts = (p) => p.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
export function figure(P, cls = '') {
  const far = P.side > 0.5 ? '' : ' fFar', limb = (p, c) => `<polyline class="fLimb${c}" points="${pts(p)}"/>`;
  return `<g class="fig ${cls}">${limb(P.ll, far)}${limb(P.la, far)}<line class="fTorso" x1="${P.hip[0].toFixed(1)}" y1="${P.hip[1].toFixed(1)}" x2="${P.sh[0].toFixed(1)}" y2="${P.sh[1].toFixed(1)}"/>
    <circle class="fHead" cx="${P.head[0].toFixed(1)}" cy="${P.head[1].toFixed(1)}" r="7.5"/>${limb(P.rl, '')}${limb(P.ra, '')}</g>`;
}
/** a point on the figure, by name */
export function pointOf(P, at) {
  if (Array.isArray(at)) return at;
  return { lh: P.la[2], rh: P.ra[2], lf: P.ll[2], rf: P.rl[2], hip: P.hip, head: P.head, sh: P.sh, lk: P.ll[1], rk: P.rl[1] }[at] || P.hip;
}

// ------------------------------------------------------------------------------------------------ drawing helpers for the scenes
const n = (v) => (+v).toFixed(1);
export const ln = (x1, y1, x2, y2, c = 'pr') => `<line class="${c}" x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"/>`;
export const rc = (x, y, w, h, c = 'prF', r = 0) => `<rect class="${c}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${r}"/>`;
export const ci = (x, y, r, c = 'prF') => `<circle class="${c}" cx="${n(x)}" cy="${n(y)}" r="${n(r)}"/>`;
export const pl = (p, c = 'pr') => `<polyline class="${c}" points="${pts(p)}"/>`;
export const pg = (p, c = 'prF') => `<polygon class="${c}" points="${pts(p)}"/>`;
export const tx = (x, y, s, c = 'prT') => `<text class="${c}" x="${n(x)}" y="${n(y)}">${esc(s)}</text>`;
export const ground = (c = '') => `<rect class="gnd${c}" x="-2000" y="${G}" width="5000" height="400"/>${ln(-2000, G, 3000, G, 'gndLine')}`;
/** a part drawn red when the fail is about it */
export const hl = (on, c) => (on ? `${c} hlBad` : c);

// ------------------------------------------------------------------------------------------------ the player
const PHASES = { run: 'Good run at real speed', good: 'Slow motion: what counts', bad: 'Slow motion: a fail' };
/** plays scene in the element (its markup from playerHtml); stops by itself once the element leaves the page */
export function play(root, scene) {
  const svg = root.querySelector('svg'), world = svg.querySelector('.obWorld'), cap = root.querySelector('.obCaption'), tag = root.querySelector('.obPhase'), btn = root.querySelector('.obPlay');
  // the slowed-down phases start a little before their first moment and stop a little after the last; between moments they run at real speed
  const slow = (kind, tl) => {
    const ts = tl.marks.filter((m) => (kind === 'bad' ? m.kind === 'bad' : !m.kind)).map((m) => m.t);
    return { kind, tl, ts, from: ts.length ? Math.max(0, Math.min(...ts) - 1.6) : 0, to: ts.length ? Math.min(tl.end, Math.max(...ts) + 1.4) : tl.end };
  };
  const phases = [{ kind: 'run', tl: scene.good, ts: [], from: 0, to: scene.good.end }, slow('good', scene.good), ...scene.fails.map((tl) => slow('bad', tl))];
  const speedAt = (p, x) => (p.kind === 'run' ? 1 : p.ts.some((m) => Math.abs(m - x) < 0.9) ? 0.3 : 1);
  const chips = [...root.querySelectorAll('[data-phase]')];
  let ph = 0, at = 0, last = 0, frozen = 0, mark = null, paused = matchMedia('(prefers-reduced-motion: reduce)').matches, seen = true, hold = 0;
  const caption = (m, kind) => {
    if (!m) { cap.className = 'obCaption'; cap.innerHTML = kind === 'run' ? esc(t('A good run, at real speed. Then it plays slowly, stopping on what counts and on what would be a fail.')) : '&nbsp;'; return; }
    cap.className = `obCaption ${m.kind}`; cap.innerHTML = `<span aria-hidden="true">${m.kind === 'bad' ? '✗' : '✓'}</span> ${esc(t(m.text))}`;
  };
  const go = (i) => {
    ph = (i + phases.length) % phases.length; frozen = 0; mark = null; hold = 0;
    const p = phases[ph];
    at = p.from;
    tag.textContent = t(PHASES[p.kind]);
    for (const c of chips) c.classList.toggle('on', +c.dataset.phase === Math.min(ph, 2));
    caption(null, p.kind);
  };
  const draw = (now) => {
    const p = phases[ph], s = sample(p.tl, at), P = solve(s), cam = s.cam;
    const showMark = mark && p.kind !== 'run';
    const ring = showMark ? (() => { const q = typeof mark.at === 'function' ? mark.at(s, P) : pointOf(P, mark.at); return `<circle class="obRing ${mark.kind}" cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="${(11 + 3 * Math.sin(now / 160)).toFixed(1)}"/>`; })() : '';
    const H = showMark && mark.kind === 'bad' ? new Set(mark.hl || []) : new Set();
    world.setAttribute('transform', `translate(200 112) scale(${cam[2]}) translate(${-cam[0]} ${-cam[1]})`);
    world.innerHTML = `${scene.back(s, H, P, now)}${figure(P, `${showMark && mark.kind === 'bad' && mark.body ? 'hlFig' : ''}${s.dim ? ' fDim' : ''}`)}${scene.front ? scene.front(s, H, P, now) : ''}${ring}`;
  };
  const tick = (now) => {
    if (!root.isConnected) return;
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    if (paused || !seen || document.hidden) { draw(now); return; }
    const p = phases[ph];
    if (frozen > 0) { frozen -= dt; draw(now); return; }
    const next = at + dt * speedAt(p, at);
    if (p.kind !== 'run') {
      const m = p.tl.marks.find((k) => k.t > at && k.t <= next && (p.kind === 'bad' ? k.kind === 'bad' : !k.kind));
      if (m) { at = m.t; mark = { ...m, kind: p.kind === 'bad' ? 'bad' : 'good' }; caption(mark); frozen = 2.2; draw(now); return; }
    }
    at = Math.min(next, p.to);
    if (at >= p.to) { hold += dt; if (hold > 0.9) go(ph + 1); }
    draw(now);
  };
  btn.addEventListener('click', () => { paused = !paused; btn.setAttribute('aria-pressed', String(!paused)); btn.textContent = t(paused ? 'Play' : 'Pause'); });
  for (const c of chips) c.addEventListener('click', () => { go(+c.dataset.phase); if (paused) btn.click(); });
  if ('IntersectionObserver' in window) new IntersectionObserver((e) => { seen = e[0].isIntersecting; }).observe(svg);
  btn.textContent = t(paused ? 'Play' : 'Pause'); btn.setAttribute('aria-pressed', String(!paused));
  go(0); requestAnimationFrame(tick);
}
export const playerHtml = (title) => `<section class="card obAnim" id="obAnim">
  <div class="obStage"><svg viewBox="0 0 400 225" role="img" aria-label="${esc(t('Animation: {title}', { title: t(title) }))}"><g class="obWorld"></g></svg><span class="obPhase"></span></div>
  <p class="obCaption" aria-live="polite">&nbsp;</p>
  <div class="obControls"><button type="button" class="small obPlay"></button>
    <span class="obChips"><button type="button" class="small" data-phase="0">${esc(t('Real speed'))}</button><button type="button" class="small" data-phase="1">${esc(t('What counts'))}</button><button type="button" class="small" data-phase="2">${esc(t('A fail'))}</button></span></div></section>`;
