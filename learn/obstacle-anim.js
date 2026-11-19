// The obstacle animations' engine (#/obstacles/<id>): an athlete drawn in SVG, posed by keyframes. A keyframe gives where the hips are,
// the lean, which way they face, and where each hand (its grip) and foot (its sole) goes; elbows and knees are worked out (two-bone IK),
// and the feet turn with the shins. Between keyframes everything moves on smooth curves that never overshoot (monotone cubic: a hand stops
// on its grip, a foot doesn't dip through the ground), and a flight or a fall follows gravity. Each obstacle's scene (obstacle-scenes.js)
// draws its structure and builds timelines: a good run, and one or more fails. The player loops: the good run at real speed, the same
// slowed down stopping on what counts (✓, green), then each fail slowed down stopping on the moment it goes wrong (✗, red).
import { esc, t } from './core.js';

export const G = 200; // the ground, in a 400 × 225 picture
export const PX = 52; // pixels to a metre: the athlete is 1.78 m
export const GRAV = 9.81 * PX; // gravity, in pixels a second a second
export const HIP = 44; // the hips' height standing
// body proportions (pixels): hip to shoulder, neck, head radius, upper arm, forearm to the grip, thigh, shin to the ankle, ankle to sole
const L = { T: 29, NECK: 4, HEAD: 6.6, U: 17, F: 17.5, TH: 22, SH: 21.5, ANK: 3.5 };
const D = Math.PI / 180;
export const lerp = (a, b, k) => a + (b - a) * k;

/** standing at x on the ground (or on gy), facing f (1 right, -1 left, 0 towards the obstacle, back to us) */
export const stand = (x, f = 1, gy = G) => {
  const w = f ? 0 : 6;
  return { x, y: gy - HIP, a: 4, f, lf: [x - 4 * f - w, gy], rf: [x + 5 * f + w, gy], lh: [x - 3 * f - w * 1.6, gy - 41], rh: [x + 4 * f + w * 1.6, gy - 41] };
};

/** a timeline: keyframes, each the whole state (what a keyframe doesn't say carries on), and the moments to point at */
export function timeline(start) {
  const keys = [[0, { cam: [200, 112, 1], ...start }, 'e']];
  const o = {
    keys, marks: [],
    get s() { return keys[keys.length - 1][1]; },
    get end() { return keys[keys.length - 1][0]; },
    /** move to a new state over dt seconds. ez 'g': the hips fly under gravity (and x at a steady speed); { g: { w: -1 } }: w falls (up is +) */
    to(dt, p, ez = 'e') { const [t0, s] = keys[keys.length - 1]; keys.push([t0 + dt, { ...s, ...(typeof p === 'function' ? p(s) : p) }, ez]); return o; },
    hold(dt) { return o.to(dt, {}); },
    /** point at something now: text (a Good or Bad line), at = 'lh' | 'rh' | 'lf' | 'rf' | 'hip' | 'head' | 'sh' | [x, y] | (s, P) => [x, y], hl = parts to show red */
    mark(text, at, opt = {}) { o.marks.push({ t: o.end + (opt.dt || 0), text, at, ...opt }); return o; },
  };
  return o;
}

// ------------------------------------------------------------------------------------------------ smooth, physical motion
/** the slope at a keyframe that keeps the curve from overshooting (Fritsch–Butland); a missing neighbour gives a one-sided slope */
function tangent(vp, v, vn, hp, hn) {
  const dp = hp > 0 ? (v - vp) / hp : null, dn = hn > 0 ? (vn - v) / hn : null;
  if (dp === null) return dn ?? 0;
  if (dn === null) return dp;
  if (dp * dn <= 0) return 0;
  return (3 * (hp + hn)) / ((2 * hn + hp) / dp + (hn + 2 * hp) / dn);
}
const herm = (v1, v2, m1, m2, h, x) => { const x2 = x * x, x3 = x2 * x; return (2 * x3 - 3 * x2 + 1) * v1 + (x3 - 2 * x2 + x) * h * m1 + (-2 * x3 + 3 * x2) * v2 + (x3 - x2) * h * m2; };
const num = (v) => typeof v === 'number';
function interp(a, b, ap, bn, hp, h, hn, x) {
  if (num(a) && num(b)) return herm(a, b, tangent(num(ap) ? ap : a, a, b, num(ap) ? hp : 0, h), tangent(a, b, num(bn) ? bn : b, h, num(bn) ? hn : 0), h, x);
  if (Array.isArray(a) && Array.isArray(b)) return a.map((v, i) => interp(v, b[i], ap?.[i], bn?.[i], hp, h, hn, x));
  // a whole state: each of its values moves on its own curve (what only one side has, or isn't a number, switches at the end)
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const o = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) o[k] = k in a && k in b ? interp(a[k], b[k], ap?.[k], bn?.[k], hp, h, hn, x) : x < 1 ? a[k] : b[k];
    return o;
  }
  return x < 1 ? a : b;
}
/** a value thrown from v0 that lands on v1 after T seconds, at time tau, with gravity of sign sg (+1: pulled towards larger values) */
const ballistic = (v0, v1, T, tau, sg) => { const vel = (v1 - v0) / T - (sg * GRAV * T) / 2; return v0 + vel * tau + (sg * GRAV * tau * tau) / 2; };
export function sample(tl, time) {
  const k = tl.keys;
  if (time <= 0) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    if (time > k[i][0]) continue;
    const [t1, a] = k[i - 1], [t2, b, ez] = k[i], h = t2 - t1, x = h > 0 ? (time - t1) / h : 1;
    const p = k[i - 2], q = k[i + 1];
    const s = interp(a, b, p?.[1], q?.[1], p ? t1 - p[0] : 0, h, q ? q[0] - t2 : 0, x);
    if (ez === 'lin') for (const f of Object.keys(b)) { if (num(a[f]) && num(b[f])) s[f] = lerp(a[f], b[f], x); }
    if (ez === 'g') {
      const y = ballistic(a.y, b.y, h, x * h, 1), dy = y - lerp(a.y, b.y, x);
      s.y = y; s.x = lerp(a.x, b.x, x);
      for (const k of ['lf', 'rf', 'lh', 'rh']) if (Array.isArray(s[k])) s[k] = [lerp(a[k][0], b[k][0], x), lerp(a[k][1], b[k][1], x) + dy];
    }
    else if (ez && ez.g) for (const [f, sg] of Object.entries(ez.g)) s[f] = ballistic(a[f], b[f], h, x * h, sg);
    return s;
  }
  return k[k.length - 1][1];
}
/** the time to fall (or fly) from y0 to y1 rising first by rise: gravity decides how long a jump or a drop takes */
export const flightTime = (y0, y1, rise = 0) => Math.sqrt((2 * rise) / GRAV) + Math.sqrt((2 * Math.max(0, y1 - (y0 - rise))) / GRAV);
/** a jump or a drop to p (its hips at p.y), rising rise pixels first; the hips follow gravity */
export function fly(o, p, rise = 0, extra = 0) {
  const s = o.s, y1 = (typeof p === 'function' ? p(s) : p).y ?? s.y;
  return o.to(Math.max(0.12, flightTime(s.y, y1, rise) + extra), p, 'g');
}

// ------------------------------------------------------------------------------------------------ moving about
const shoulderAt = (x, y, a, f) => [x + Math.sin(a * D) * Math.max(-1, Math.min(1, f * 1.5)) * L.T, y - Math.cos(a * D) * L.T];
/** walk or run to x1. hands(s) gives the hands (and anything carried) for a carry; otherwise the arms swing against the legs */
export function walk(o, x1, opt = {}) {
  const base = opt.run ? { v: 160, stride: 44, lift: 16, lean: 12, bob: 3 } : { v: 75, stride: 27, lift: 6, lean: 4, bob: 1.6 };
  const { v, stride, lift, lean, bob, hands, run, gy = G } = { ...base, ...opt };
  let s = o.s;
  const f = Math.sign(x1 - s.x) || s.f, n = Math.max(1, Math.round(Math.abs(x1 - s.x) / stride)), dx = (x1 - s.x) / n, dt = Math.abs(dx) / v;
  let back = f * s.lf[0] <= f * s.rf[0] ? 'lf' : 'rf';
  for (let i = 0; i < n; i++) {
    const x = s.x + dx, xm = s.x + dx / 2, sw = back, land = [x + f * stride * 0.42, gy], from = s[sw];
    const arms = (hx, hy, swing) => {
      if (hands) return hands({ ...o.s, x: hx, y: hy, a: lean, f });
      const sh = shoulderAt(hx, hy, lean, f), fw = run ? [sh[0] + f * 17, sh[1] + 16] : [sh[0] + f * 12, sh[1] + 31], bk = run ? [sh[0] - f * 13, sh[1] + 22] : [sh[0] - f * 10, sh[1] + 32];
      return swing === 'lf' ? { rh: fw, lh: bk } : { lh: fw, rh: bk };
    };
    // mid-stride: the swinging foot passes under the hips, knee up; the hips are at their highest (in a run, both feet are off the ground)
    o.to(dt / 2, { x: xm, y: gy - HIP - bob, a: lean, f, [sw]: [(from[0] + land[0]) / 2, gy - lift], ...arms(xm, gy - HIP - bob, sw) });
    o.to(dt / 2, { x, y: gy - HIP + (run ? 1.5 : 0), [sw]: land, ...arms(x, gy - HIP, sw) });
    back = sw === 'lf' ? 'rf' : 'lf'; s = o.s;
  }
  return o;
}
/** feet together under the hips, arms down: stopping */
export const settle = (o, dt = 0.25, extra = {}) => o.to(dt, (s) => ({ ...stand(s.x, s.f), ...extra }));

// ------------------------------------------------------------------------------------------------ the figure
/** a two-bone limb from root towards target; of the two ways it can bend, pick(m1, m2, root, end) chooses (or the one nearer pref) */
function ik(root, target, a, b, pref, pick) {
  let dx = target[0] - root[0], dy = target[1] - root[1], d = Math.hypot(dx, dy) || 0.001;
  const max = a + b - 0.01;
  if (d > max) { dx *= max / d; dy *= max / d; d = max; }
  const end = [root[0] + dx, root[1] + dy], base = Math.atan2(dy, dx), A = Math.acos(Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d))));
  const m1 = [root[0] + a * Math.cos(base + A), root[1] + a * Math.sin(base + A)], m2 = [root[0] + a * Math.cos(base - A), root[1] + a * Math.sin(base - A)];
  if (pick) return [root, pick(m1, m2, root, end), end];
  const c = [(root[0] + end[0]) / 2, (root[1] + end[1]) / 2], dot = (m) => (m[0] - c[0]) * pref[0] + (m[1] - c[1]) * pref[1];
  return [root, dot(m1) >= dot(m2) ? m1 : m2, end];
}
const unit = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
const add = (p, v, k = 1) => [p[0] + v[0] * k, p[1] + v[1] * k];
/** where everything is: hips, shoulders, head, each limb's points, and which way each foot points */
export function solve(s) {
  const f = s.f, side = 1 - Math.min(1, Math.abs(f)), a = s.a * D, d = [Math.sin(a) * Math.max(-1, Math.min(1, f * 1.5)), -Math.cos(a)];
  const fs = Math.sign(f) || 1;
  // the body moves to what it holds and stands on: if a hand or foot can't reach where it's put, the hips shift towards it (as a person
  // leans or sinks to reach), sharing the shift between the limbs that are short, up to about 0.45 m
  let hip = [s.x, s.y];
  const off = (p, k) => [p[0] + k * side, p[1]];
  for (let it = 0; it < 4; it++) {
    const shp = add(hip, d, L.T), need = [0, 0];
    let n = 0;
    for (const [root, t, max] of [[off(hip, -5), [s.lf[0], s.lf[1] - L.ANK], L.TH + L.SH], [off(hip, 5), [s.rf[0], s.rf[1] - L.ANK], L.TH + L.SH], [off(shp, -8), s.lh, L.U + L.F], [off(shp, 8), s.rh, L.U + L.F]]) {
      const v = [t[0] - root[0], t[1] - root[1]], dist = Math.hypot(v[0], v[1]);
      if (dist > max - 0.3) { const k = (dist - max + 0.3) / dist; need[0] += v[0] * k; need[1] += v[1] * k; n++; }
    }
    if (!n) break;
    hip = [hip[0] + (need[0] / n) * 0.9, hip[1] + (need[1] / n) * 0.9];
  }
  const shift = Math.hypot(hip[0] - s.x, hip[1] - s.y);
  if (shift > 24) hip = [s.x + (hip[0] - s.x) * 24 / shift, s.y + (hip[1] - s.y) * 24 / shift];
  const sh = add(hip, d, L.T), head = add(hip, d, L.T + L.NECK + L.HEAD);
  const kn = (lr) => s.kp || [lerp(fs, lr, side), lerp(0.15, 0.2, side)], el = (lr) => s.ep || [lerp(-fs * 0.8, lr, side), lerp(0.6, 0.3, side)];
  const o = (p, k) => [p[0] + k * side, p[1]];
  // seen from the side, a knee only bends one way and an elbow the other, whatever the limb's angle: facing right, the shin turns
  // clockwise from the thigh (cross > 0) and the forearm anticlockwise from the upper arm. Seen from behind, they bend outwards.
  const bend = (m, root, end) => { const u = [m[0] - root[0], m[1] - root[1]], v = [end[0] - m[0], end[1] - m[1]]; return (u[0] * v[1] - u[1] * v[0]) * fs; };
  const knee = side < 0.5 ? (m1, m2, r, e) => (bend(m1, r, e) >= bend(m2, r, e) ? m1 : m2) : null;
  const elbow = side < 0.5 ? (m1, m2, r, e) => (bend(m1, r, e) <= bend(m2, r, e) ? m1 : m2) : null;
  const leg = (root, sole, pref) => {
    const l = ik(root, [sole[0], sole[1] - L.ANK], L.TH, L.SH, pref, knee), shin = unit([l[2][0] - l[1][0], l[2][1] - l[1][1]]);
    // the foot: flat when the shin is near upright, at a right angle to the shin when it's far from it (on a wall, a rung, in the air)
    const tilt = Math.abs(Math.atan2(shin[0], shin[1])) / D, k = Math.max(0, Math.min(1, (tilt - 35) / 40));
    const perp = [shin[1] * fs, -shin[0] * fs], toe = unit([lerp(fs, perp[0], k), lerp(0, perp[1], k)]);
    return [...l, toe];
  };
  return {
    hip, sh, head, d, side, f: fs,
    ll: leg(o(hip, -5), s.lf, kn(-1)), rl: leg(o(hip, 5), s.rf, kn(1)),
    la: ik(o(sh, -8), s.lh, L.U, L.F, el(-1), elbow), ra: ik(o(sh, 8), s.rh, L.U, L.F, el(1), elbow),
  };
}
const n1 = (v) => v.toFixed(1);
const pts = (p) => p.map((q) => `${n1(q[0])},${n1(q[1])}`).join(' ');
const seg = (p, q, c) => `<line class="${c}" x1="${n1(p[0])}" y1="${n1(p[1])}" x2="${n1(q[0])}" y2="${n1(q[1])}"/>`;
const dot = (p, r, c) => `<circle class="${c}" cx="${n1(p[0])}" cy="${n1(p[1])}" r="${r}"/>`;
const poly = (ps, c) => `<polygon class="${c}" points="${ps.map((q) => `${n1(q[0])},${n1(q[1])}`).join(' ')}"/>`;
/** a leg: thigh (shorts over its top), knee, shin, and a shoe pointing along the foot */
function legSvg(l, far, front) {
  const [hip, knee, ank, u] = l;
  // n points from the ankle to the sole: at a right angle to the toes, on the side away from the knee
  const shin = unit([ank[0] - knee[0], ank[1] - knee[1]]), c = [-u[1], u[0]], n = c[0] * shin[0] + c[1] * shin[1] >= 0 ? c : [u[1], -u[0]];
  const shoe = front ? dot(add(ank, [0, 2.5]), 3.4, 'fShoe') : poly([add(add(ank, u, -3.6), n, -0.8), add(add(ank, u, 4.5), n, -1.6), add(add(ank, u, 10), n, 1.2), add(add(ank, u, 10.5), n, 3.4), add(add(ank, u, -4.2), n, 3.4)], 'fShoe');
  return `<g class="fLeg${far}">${seg(hip, knee, 'fSkin fThigh')}${seg(hip, add(hip, [knee[0] - hip[0], knee[1] - hip[1]], 0.55), 'fShorts fThighS')}${seg(knee, ank, 'fSkin fShin')}${dot(knee, 3.3, 'fSkinF')}${shoe}</g>`;
}
/** an arm: sleeve, upper arm, forearm, and a fist on the grip */
function armSvg(l, far) {
  const [sh, el, hand] = l;
  return `<g class="fArm${far}">${seg(sh, el, 'fSkin fUpper')}${seg(sh, add(sh, [el[0] - sh[0], el[1] - sh[1]], 0.42), 'fShirt fSleeve')}${seg(el, hand, 'fSkin fFore')}${dot(hand, 3.1, 'fSkinF')}</g>`;
}
export function figure(P, cls = '') {
  const front = P.side > 0.5, far = front ? '' : ' fFar', up = P.d, fwd = [-up[1] * P.f, up[0] * P.f], h = P.head;
  const waist = add(P.hip, up, 9);
  // the head: hair at the back, the face forward, a red headband, from behind all hair
  const head = front
    ? `${dot(h, 7, 'fHair')}${seg(add(h, [-7, -1.5]), add(h, [7, -1.5]), 'fBand')}${seg(add(h, [0, -1.5]), add(h, [-2, 6]), 'fBand fTail')}`
    : `${dot(add(add(h, fwd, -1.3), up, 0.6), 7, 'fHair')}${dot(add(h, fwd, 0.7), 6.3, 'fSkinF')}${poly([add(add(h, fwd, 6.6), up, 1), add(add(h, fwd, 8.6), up, -1.2), add(add(h, fwd, 6.4), up, -2)], 'fSkinF')}
       ${dot(add(add(h, fwd, 3.8), up, 1), 0.9, 'fEye')}${seg(add(add(h, fwd, -7.2), up, 2.6), add(add(h, fwd, 6.9), up, 3.2), 'fBand')}${seg(add(add(h, fwd, -6.8), up, 2.6), add(add(h, fwd, -10.5), up, 0.2), 'fBand fTail')}`;
  const body = `${seg(P.sh, add(P.sh, up, L.NECK + 1), 'fSkin fNeck')}${seg(waist, P.sh, 'fShirt fChest')}${seg(P.hip, add(waist, up, 1), 'fShorts fPelvis')}`;
  const [lA, rA, lL, rL] = [armSvg(P.la, far), armSvg(P.ra, ''), legSvg(P.ll, far, front), legSvg(P.rl, '', front)];
  return `<g class="fig ${cls}">${front ? `${body}${lL}${rL}${lA}${rA}${head}` : `${lL}${lA}${body}${head}${rL}${rA}`}</g>`;
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
/** the player's markup: a card on an obstacle's page, or (inline) just the player, for a lesson slide */
export const playerHtml = (title, inline = false) => `<${inline ? 'div' : 'section'} class="${inline ? 'obInline ' : 'card '}obAnim"${inline ? '' : ' id="obAnim"'}>
  <div class="obStage"><svg viewBox="0 0 400 225" role="img" aria-label="${esc(t('Animation: {title}', { title: t(title) }))}"><g class="obWorld"></g></svg><span class="obPhase"></span></div>
  <p class="obCaption" aria-live="polite">&nbsp;</p>
  <div class="obControls"><button type="button" class="small obPlay"></button>
    <span class="obChips"><button type="button" class="small" data-phase="0">${esc(t('Real speed'))}</button><button type="button" class="small" data-phase="1">${esc(t('What counts'))}</button><button type="button" class="small" data-phase="2">${esc(t('A fail'))}</button></span></div></${inline ? 'div' : 'section'}>`;
