// Each obstacle's animation (obstacle-anim.js plays them): its structure, drawn from the side (or from behind, for the ones crossed
// sideways), and its timelines: the good run, and fails. A mark's text is one of the obstacle's own Good or Bad lines (learn/obstacles.js),
// so it's translated with them. Positions are in the 400 × 225 picture: the ground is at G, about 52 px to a metre.
import { t } from './core.js';
import { G, HIP, GRAV, timeline, stand, walk, fly, flightTime, solve, figure, ln, rc, ci, pl, pg, tx, ground, hl } from './obstacle-anim.js';

const D = Math.PI / 180;
const shoulder = (s) => [s.x + Math.sin(s.a * D) * Math.max(-1, Math.min(1, s.f * 1.5)) * 29, s.y - Math.cos(s.a * D) * 29];
const bell = (x, y, ring = 0, red) => {
  const r = ring > 0 && ring < 1 ? Math.sin(ring * Math.PI * 4) * 28 : 0;
  return `<g transform="rotate(${r.toFixed(1)} ${x} ${y - 14})">${ln(x, y - 16, x, y - 9, 'pr prThin')}<path class="${hl(red, 'prBell')}" d="M${x - 6} ${y + 3} Q${x - 6} ${y - 10} ${x} ${y - 10} Q${x + 6} ${y - 10} ${x + 6} ${y + 3} Z"/></g>`;
};
const flag = (x) => `${ln(x, G, x, G - 60, 'pr')}${pg([[x, G - 60], [x + 18, G - 54], [x, G - 47]], 'prFlag')}`;
/** landing from a hang or a jump, then standing */
const land = (o, x, f = 1) => {
  const w = f ? 0 : 11;
  fly(o, { x, y: G - 35, a: f ? 12 : 4, f, lf: [x - 9 * f - w, G], rf: [x + 7 * f + w, G], lh: [x + 4 * f - w, G - 52], rh: [x + 8 * f + w, G - 49], ring: 1 });
  return o.to(0.14, { y: G - 32, a: f ? 16 : 6 }).to(0.4, stand(x, f));
};
/** a jump: up to an apex pose rise pixels above the take-off, then down to the landing pose, both halves under gravity */
const leap = (o, apex, landing, rise) => {
  const y0 = o.s.y, t1 = flightTime(y0, y0 - rise, rise), t2 = flightTime(y0 - rise, landing.y, 0), x0 = o.s.x;
  o.to(t1, { ...apex, x: x0 + (landing.x - x0) * t1 / (t1 + t2), y: y0 - rise }, 'g');
  return o.to(t2, landing, 'g');
};

const ringBell = (o, at) => o.to(0.3, { rh: at, ring: 0 }).to(0.6, { ring: 1 });
const lerpP = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

// ================================================================================================ walls and climbs
/** a vertical wall: jump to the top, walk the feet up, over, and hang down the far side */
function overWall(o, x0, top, th, { stepFoot, faultFar, good = 'Over the top and down, using the wall itself.' } = {}) {
  const bx = x0 + th;
  fly(o, { x: x0 - 24, y: top + 56, a: 8, lh: [x0 + 1, top], rh: [x0 + 4, top], lf: stepFoot || [x0 - 1, top + 84], rf: [x0 - 1, top + 72] }, Math.max(6, o.s.y - (top + 56)) + 4);
  if (stepFoot) o.mark('A man using the red step: it’s for women only.', 'lf', { kind: 'bad', hl: ['step'] });
  o.to(0.35, { x: x0 - 22, y: top + 30, a: 22, lf: [x0 - 1, top + 58], rf: [x0 - 1, top + 50] });
  o.to(0.35, { x: x0 - 8, y: top + 14, a: 50, lh: [x0 + 3, top], rh: [x0 + 7, top], rf: [x0 - 1, top + 32], lf: [x0 - 1, top + 44] });
  o.to(0.4, { x: x0 + th / 2, y: top - 5, a: 86, lh: [x0 + 1, top], rh: [bx - 1, top], rf: [x0 - 24, top + 24], lf: [x0 - 30, top + 30] });
  if (good) o.mark(good, 'hip');
  if (faultFar) { o.to(0.5, { x: bx + 24, y: top + 58, a: 10, f: -1, lh: [bx - 1, top], rh: [bx - 4, top], lf: faultFar.foot, rf: [bx + 1, top + 84] }); o.mark(faultFar.text, 'lf', { kind: 'bad', hl: [faultFar.hl] }); }
  else o.to(0.5, { x: bx + 24, y: top + 56, a: 8, f: -1, lh: [bx - 1, top], rh: [bx - 4, top], lf: [bx + 1, top + 92], rf: [bx + 1, top + 84] });
  o.to(0.3, { y: Math.min(G - HIP, top + 80), lh: [bx - 1, top + 6], rh: [bx - 3, top + 8] });
  return land(o, bx + 26, -1);
}

function walls() {
  const x0 = 230, h = 125, top = G - h, th = 10, bx = x0 + th, brace = [bx + 25, top + 25 + (G - top - 25) * 0.45];
  const run = (fault) => {
    const o = timeline(stand(40));
    walk(o, x0 - 75, { run: true });
    overWall(o, x0, top, th, { stepFoot: fault === 'step' && [x0 - 6, G - 39], faultFar: fault === 'brace' && { foot: brace, text: 'Using the support bracing, the sides of the wall, flag poles or straps.', hl: 'brace' } });
    o.to(0.3, stand(bx + 30, 1));
    return walk(o, 380, { run: true });
  };
  return {
    back: (s, H) => `${ground()}${ln(bx, top + 25, bx + 55, G, hl(H.has('brace'), 'pr prThick'))}${ln(bx + 18, top + 60, bx + 18, G, hl(H.has('brace'), 'pr'))}
      ${rc(x0, top, th, h, 'prF prWood')}${rc(x0 - 9, G - 41, 9, 5, hl(H.has('step'), 'prRed'))}`,
    good: run(), fails: [run('step'), run('brace')],
  };
}

function inverted() {
  // the face leans over the athlete: from the bottom at x0 + 30 up to the top edge at x0
  const x0 = 210, top = G - 118, th = 9, post = x0 + 62;
  const faceX = (y) => x0 + 30 * (y - top) / (G - top);
  const run = (fault) => {
    const o = timeline(stand(30));
    walk(o, x0 - 70, { run: true });
    fly(o, { x: x0 - 16, y: top + 62, a: 0, lh: [x0 - 1, top], rh: [x0 + 2, top], lf: [x0 - 20, top + 104], rf: [x0 - 14, top + 102] }, Math.max(6, o.s.y - (top + 62)) + 4);
    o.to(0.4, { x: x0 - 10, y: top + 32, a: 10, rf: [x0 - 14, top + 74], lf: [x0 - 20, top + 70] });
    o.to(0.4, { x: x0 + 5, y: top - 5, a: 86, lh: [x0 + 1, top], rh: [x0 + 8, top], rf: [x0 - 24, top + 24], lf: [x0 - 30, top + 30] });
    o.mark('Over the top and down the far side.', 'hip');
    const foot = fault ? [post, top + 70] : [faceX(top + 78) + th, top + 78];
    o.to(0.5, { x: x0 + th + 30, y: top + 54, a: 6, f: -1, lh: [x0 + th, top], rh: [x0 + th - 3, top], lf: foot, rf: [faceX(top + 66) + th, top + 66] });
    if (fault) o.mark('Touching the supports, the sides or straps.', 'lf', { kind: 'bad', hl: ['post'] });
    land(o, x0 + 62, -1);
    o.to(0.3, stand(x0 + 64, 1));
    return walk(o, 380, { run: true });
  };
  return {
    back: (s, H) => `${ground()}${ln(post, top + 20, post, G, hl(H.has('post'), 'pr prThick'))}${ln(post, top + 30, faceX(top + 30) + th, top + 30, hl(H.has('post'), 'pr'))}
      ${pg([[x0, top], [x0 + th, top], [x0 + 30 + th, G], [x0 + 30, G]], 'prF prWood')}`,
    good: run(), fails: [run('post')],
  };
}

/** climbing up onto a ledge at (ex, ey) from where the athlete stands (on gy) */
function mantle(o, ex, ey, gy, { pre } = {}) {
  const d = gy - ey;
  o.to(0.35, { x: ex - 20, y: Math.min(gy - HIP, ey + 56), a: 8, lh: [ex + 1, ey], rh: [ex + 4, ey], lf: pre || [ex - 1, Math.min(gy, ey + 70)], rf: [ex - 4, gy] });
  o.to(0.35, { x: ex - 16, y: ey + 18, a: 30, lf: [ex - 1, ey + Math.min(52, d)], rf: [ex - 1, ey + Math.min(44, d)] });
  o.to(0.3, { x: ex + 4, y: ey - 5, a: 86, lh: [ex + 18, ey], rh: [ex + 22, ey], rf: [ex - 18, ey + 24], lf: [ex - 24, ey + 30] });
  o.to(0.25, { x: ex + 6, y: ey - 14, a: 66, rf: [ex - 10, ey + 26], lf: [ex - 16, ey + 30] });
  o.to(0.3, { x: ex + 8, y: ey - 27, a: 30, lh: [ex + 26, ey], rh: [ex + 29, ey], rf: [ex + 12, ey], lf: [ex - 2, ey + 6] });
  return o.to(0.35, stand(ex + 10, 1, ey));
}

function stairway() {
  // three tall steps up, then a ladder down the back
  const x0 = 150, steps = [[x0, G - 50], [x0 + 32, G - 100], [x0 + 64, G - 145]], back = x0 + 100, brace = [x0 + 80, G - 60];
  const run = (fault) => {
    const o = timeline(stand(30));
    walk(o, x0 - 30, {});
    o.to(0.25, { rf: [x0 - 10, G - 16] });
    o.mark('Anyone using the step.', 'rf');
    mantle(o, steps[0][0], steps[0][1], G, { pre: [x0 - 10, G - 16] });
    walk(o, steps[1][0] - 22, { v: 50, gy: steps[0][1] });
    mantle(o, steps[1][0], steps[1][1], steps[0][1], fault ? { pre: brace } : {});
    if (fault) o.mark('Using the bracing, the sides or straps.', 'lf', { kind: 'bad', hl: ['brace'], dt: -0.9 });
    walk(o, steps[2][0] - 22, { v: 50, gy: steps[1][1] });
    mantle(o, steps[2][0], steps[2][1], steps[1][1]);
    walk(o, back - 8, { v: 50, gy: steps[2][1] });
    o.to(0.45, { x: back + 14, y: steps[2][1] + 40, a: 6, f: -1, lh: [back, steps[2][1]], rh: [back - 2, steps[2][1] + 4], lf: [back + 2, steps[2][1] + 70], rf: [back + 2, steps[2][1] + 56] });
    o.to(0.6, { y: G - 70, lh: [back, G - 115], rh: [back, G - 100], lf: [back + 2, G - 28], rf: [back + 2, G - 42] });
    land(o, back + 22, -1);
    o.to(0.3, stand(back + 24, 1));
    return walk(o, 380, {});
  };
  return {
    back: (s, H) => `${ground()}${ln(x0 + 60, G - 120, x0 + 95, G, hl(H.has('brace'), 'pr prThick'))}
      ${steps.map(([x, y], i) => rc(x, y, (i === 2 ? back : steps[i + 1][0]) - x, G - y, 'prF prWood')).join('')}
      ${rc(x0 - 18, G - 16, 18, 16, 'prF prWood')}${ln(back, steps[2][1], back, G, 'pr prThick')}`,
    good: run(), fails: [run('brace')],
  };
}

/** climbing a structure by its rungs or net: hands and feet alternately along a path of grips (up, over, down) */
function rungs(o, grips, { faceX, off = -18, fault } = {}) {
  // grips: points the hands use in order; the feet use the grips two to three below the hands
  for (let i = 2; i < grips.length; i++) {
    const g = grips[i], lo = grips[i - 2], hand = i % 2 ? 'lh' : 'rh', foot = i % 2 ? 'rf' : 'lf';
    const hx = (g[0] + lo[0]) / 2 + off, hy = Math.min((g[1] + lo[1]) / 2 + 30, G - 36);
    const fp = fault && fault.at === i ? fault.foot : [grips[Math.max(0, i - 4)][0], Math.min(G, grips[Math.max(0, i - 4)][1] + 6)];
    o.to(0.32, { x: hx, y: hy, a: 14, [hand]: g, [foot]: fp });
    if (fault && fault.at === i) o.mark(fault.text, fault.limb || 'lf', { kind: 'bad', hl: [fault.hl] });
  }
  return o;
}

function bender() {
  // angled rungs leaning over the athlete, a flag pole at the top, a ladder down the back
  const base = [250, G], tip = [196, G - 140], n = 7, back = 262, pole = [tip[0] + 10, tip[1]];
  const R = Array.from({ length: n }, (_, i) => lerpP(base, tip, (i + 0.5) / n));
  const run = (fault) => {
    const o = timeline(stand(40));
    walk(o, 170, {});
    const u = [(tip[0] - base[0]) / 150, (tip[1] - base[1]) / 150], nrm = [u[1], -u[0]]; // up the rungs, and out from under them
    const under = (hand, foot) => { const h = lerpP(foot, hand, 0.4); return { x: h[0] + nrm[0] * 14, y: h[1] + nrm[1] * 14, a: Math.atan2(u[0], -u[1]) * 180 / Math.PI }; };
    walk(o, 214, {});
    o.to(0.4, { ...under(R[2], [218, G]), lh: R[1], rh: R[2], lf: R[0], rf: [212, G] });
    o.mark('Feet on the rungs.', 'lf');
    for (let i = 3; i < n; i++) o.to(0.4, { ...under(R[i], R[Math.max(0, i - 3)]), [i % 2 ? 'rh' : 'lh']: R[i], [i % 2 ? 'lf' : 'rf']: R[Math.max(0, i - 3)] });
    if (fault) { o.to(0.35, { rh: [pole[0] - 2, pole[1] - 10] }); o.mark('Using the structure, straps or flag poles.', 'rh', { kind: 'bad', hl: ['pole'] }); }
    o.to(0.2, (st) => ({ lf: [st.x - 6 * st.f, st.y + 40], rf: [st.x + 2 * st.f, st.y + 41] }));
    o.to(0.4, { x: tip[0] + 6, y: tip[1] - 5, a: 86, lh: tip, rh: [tip[0] + 6, tip[1]], rf: [tip[0] - 24, tip[1] + 20], lf: [tip[0] - 30, tip[1] + 26] });
    o.to(0.5, { x: back + 22, y: tip[1] + 56, a: 6, f: -1, lh: [back, tip[1] + 4], rh: [back, tip[1] + 10], lf: [back + 1, tip[1] + 90], rf: [back + 1, tip[1] + 76] });
    o.to(0.6, { y: G - 70, lh: [back, G - 110], rh: [back, G - 98], lf: [back + 1, G - 26], rf: [back + 1, G - 40] });
    land(o, back + 24, -1);
    o.to(0.3, stand(back + 26, 1));
    return walk(o, 380, {});
  };
  return {
    back: (s, H) => `${ground()}${ln(back, tip[1], back, G, 'pr prThick')}${ln(tip[0], tip[1], back, tip[1], 'pr prThick')}${ln(pole[0], pole[1], pole[0], pole[1] - 26, hl(H.has('pole'), 'pr'))}${pg([[pole[0], pole[1] - 26], [pole[0] + 14, pole[1] - 21], [pole[0], pole[1] - 16]], 'prFlag')}
      ${ln(base[0] - 4, base[1], tip[0] - 4, tip[1], 'pr prThick')}${R.map((r) => ci(r[0], r[1], 2.6, 'prMetal')).join('')}`,
    good: run(), fails: [run('pole')],
  };
}

function slip() {
  // a slope with ropes from the top, a platform, a ladder down the back
  const x0 = 140, x1 = 250, top = G - 110, back = 262;
  const slopeY = (x) => Math.min(G, G - (x - x0) * (G - top) / (x1 - x0));
  const run = (fault) => {
    const o = timeline(stand(30));
    walk(o, x0 - 14, {});
    for (let k = 0; k <= 6; k++) {
      const fx = x0 + 6 + k * 15, hx = fx + 6;
      o.to(0.36, { x: hx - 16, y: slopeY(fx) - 30, a: -14, f: 1, lf: [fx - (k % 2 ? 0 : 10), slopeY(fx - (k % 2 ? 0 : 10))], rf: [fx + (k % 2 ? 10 : 0), slopeY(fx + (k % 2 ? 10 : 0))], lh: [hx + 14, slopeY(hx + 14) - 40], rh: [hx + 22, slopeY(hx + 22) - 44] });
      if (k === 3) o.mark('Using the ropes, and swapping from one rope to another.', 'rh');
    }
    o.to(0.4, stand(x1 + 4, 1, top));
    o.to(0.45, { x: back + 22, y: top + 46, a: 6, f: -1, lh: [back, top], rh: [back, top + 6], lf: fault ? [back + 30, top + 66] : [back + 1, top + 80], rf: [back + 1, top + 66] });
    if (fault) o.mark('Using the supports or the sides of the wall.', 'lf', { kind: 'bad', hl: ['sup'] });
    o.to(0.6, { y: G - 70, lh: [back, G - 108], rh: [back, G - 96], lf: [back + 1, G - 26], rf: [back + 1, G - 40] });
    land(o, back + 24, -1);
    o.to(0.3, stand(back + 26, 1));
    return walk(o, 380, {});
  };
  return {
    back: (s, H) => `${ground()}${ln(back, top, back + 40, G, hl(H.has('sup'), 'pr prThick'))}${pg([[x0, G], [x1, top], [back, top], [back, G]], 'prF prWood')}
      ${pl([[x1 - 2, top - 2], [x1 - 40, slopeY(x1 - 40) - 34], [x0 + 20, slopeY(x0 + 20) - 10]], 'pr prThin')}${pl([[x1 - 6, top - 2], [x1 - 46, slopeY(x1 - 46) - 30], [x0 + 30, slopeY(x0 + 30) - 6]], 'pr prThin')}
      ${ln(back, top, back, G, 'pr prThick')}`,
    good: run(), fails: [run('sup')],
  };
}

function cargo() {
  // an A-frame: a net up one side and down the other, a bar along the top, and an upright in the middle
  const ax = 220, ay = G - 190, half = 96;
  const up = Array.from({ length: 11 }, (_, i) => lerpP([ax - half + 6, G - 4], [ax - 4, ay + 6], i / 10));
  const run = (fault) => {
    const o = timeline({ ...stand(30), cam: [215, 100, 0.86] });
    walk(o, ax - half - 22, {});
    o.to(0.35, { x: ax - half - 12, y: G - 52, a: 18, lh: up[2], rh: up[3], lf: up[0], rf: [ax - half - 6, G] });
    rungs(o, up, { off: -16 });
    if (fault) { o.to(0.3, { rh: [ax, ay + 40] }); o.mark('Using the side or middle uprights.', 'rh', { kind: 'bad', hl: ['upright'] }); }
    o.to(0.4, { x: ax, y: ay - 6, a: 84, lh: [ax - 2, ay], rh: [ax + 2, ay], lf: [ax - 34, ay + 14], rf: [ax - 30, ay + 20] });
    o.mark('Using the net, the horizontal bars at the base and the top, and horizontal pipes.', 'rh');
    const down = up.map(([x, y]) => [2 * ax - x, y]).reverse();
    o.to(0.45, { x: down[2][0] + 14, y: down[2][1] - 4, a: -10, f: -1, lh: down[0], rh: down[1], lf: down[3], rf: down[4] });
    for (let i = 2; i < down.length - 2; i++) { const m = lerpP(down[i - 1], down[i + 2], 0.5); o.to(0.3, { x: m[0] + 14, y: m[1] - 4, [i % 2 ? 'lh' : 'rh']: down[i - 1], [i % 2 ? 'lf' : 'rf']: down[i + 2] }); }
    land(o, ax + half + 14, -1);
    o.to(0.3, stand(ax + half + 16, 1));
    return walk(o, 390, {});
  };
  return {
    back: (s, H) => {
      const net = [];
      for (let i = 0; i <= 10; i++) { const a = lerpP([ax - half, G], [ax, ay], i / 10); net.push(ln(a[0], a[1], 2 * ax - a[0], a[1], 'pr prThin')); }
      return `${ground()}${ln(ax, ay, ax, G, hl(H.has('upright'), 'pr prThick'))}${pl([[ax - half, G], [ax, ay], [ax + half, G]], 'pr prThick')}${net.join('')}${ln(ax - 6, ay, ax + 6, ay, 'pr prThick')}`;
    },
    good: run(), fails: [run('upright')],
  };
}

function cargoplus() {
  // a shelf, then a vertical net up to a top bar, and down a net on the other side
  const sx = 150, sy = G - 55, nx = 205, ty = G - 180;
  const net = Array.from({ length: 10 }, (_, i) => [nx, sy - 8 - i * 13]);
  const run = (fault) => {
    const o = timeline({ ...stand(30), cam: [210, 104, 0.9] });
    walk(o, sx - 22, {});
    mantle(o, sx, sy, G, fault ? { pre: [sx + 2, sy + 20] } : {});
    if (fault) o.mark('Using the sides of the shelf.', 'lf', { kind: 'bad', hl: ['shelf'], dt: -1 });
    walk(o, nx - 20, { v: 50, gy: sy });
    o.mark('Using the webbing, the shelf, the horizontal bars at the base and the top, and horizontal pipes.', 'rf');
    for (let i = 5; i < net.length; i++) { const hy = Math.min(net[i][1] + 50, sy - 44); o.to(0.34, { x: nx - 22, y: hy, a: 6, [i % 2 ? 'lh' : 'rh']: net[i], [i % 2 ? 'rf' : 'lf']: [nx - 1, Math.min(sy, hy + 34)] }); }
    o.to(0.4, { x: nx + 2, y: ty - 5, a: 86, lh: [nx, ty], rh: [nx + 3, ty], lf: [nx - 30, ty + 26], rf: [nx - 24, ty + 20] });
    o.to(0.45, { x: nx + 20, y: ty + 52, a: 6, f: -1, lh: [nx + 1, ty + 2], rh: [nx + 1, ty + 8], lf: [nx + 2, ty + 84], rf: [nx + 2, ty + 70] });
    o.to(0.9, { y: G - 72, lh: [nx + 1, G - 110], rh: [nx + 1, G - 96], lf: [nx + 2, G - 28], rf: [nx + 2, G - 40] });
    land(o, nx + 24, -1);
    o.to(0.3, stand(nx + 26, 1));
    return walk(o, 380, {});
  };
  return {
    back: (s, H) => `${ground()}${rc(sx, sy, nx - sx, 6, hl(H.has('shelf'), 'prF prWood'))}${ln(sx + 3, sy + 6, sx + 3, G, hl(H.has('shelf'), 'pr'))}
      ${ln(nx, ty, nx, G, 'pr prThin')}${Array.from({ length: 13 }, (_, i) => ln(nx - 3, ty + 8 + i * 13, nx + 3, ty + 8 + i * 13, 'pr prThin')).join('')}${ln(nx - 8, ty, nx + 8, ty, 'pr prThick')}
      ${ln(nx - 30, ty, nx - 30, G, 'pr prThick')}${ln(nx + 30, ty, nx + 30, G, 'pr prThick')}${ln(nx - 30, ty, nx + 30, ty, 'pr')}`,
    good: run(), fails: [run('shelf')],
  };
}

function hurdles() {
  const H3 = [120, 210, 300], h = 70, top = G - h;
  const run = (fault) => {
    const o = timeline(stand(20));
    H3.forEach((x, i) => {
      walk(o, x - 30, { run: true });
      o.to(0.25, { x: x - 14, y: top + 18, a: 40, lh: [x, top], rh: [x + 3, top], lf: fault && i === 1 ? [x - 10, G - 30] : [x - 26, top + 46], rf: [x - 20, top + 50] });
      if (fault && i === 1) o.mark('Using the supports, the sides or straps.', 'lf', { kind: 'bad', hl: ['sup'] });
      o.to(0.3, { x: x + 4, y: top - 8, a: 84, rf: [x - 34, top - 2], lf: [x - 38, top + 4] });
      if (i === 2 && !fault) o.mark('Over every one of them.', 'hip');
      o.to(0.3, { x: x + 26, y: G - 32, a: 14, lh: [x + 12, top + 26], rh: [x + 14, top + 30], lf: [x + 20, G], rf: [x + 34, G] });
    });
    return walk(o, 390, { run: true });
  };
  return {
    back: (s, H) => `${ground()}${H3.map((x, i) => `${ln(x - 12, top + 20, x - 12, G, hl(H.has('sup') && i === 1, 'pr'))}${ln(x, top + 12, x - 12, top + 20, hl(H.has('sup') && i === 1, 'pr'))}${rc(x, top, 6, h, 'prF prWood')}`).join('')}`,
    good: run(), fails: [run('sup')],
  };
}

function out() {
  // over the first wall, under the second (a gap below it), through the window in the third
  const w1 = 110, w2 = 210, w3 = 310, gap = G - 46, win = [G - 92, G - 52];
  const run = (fault) => {
    const o = timeline(stand(10));
    walk(o, w1 - 30, { run: true });
    o.to(0.25, { x: w1 - 14, y: G - 68, a: 40, lh: [w1, G - 86], rh: [w1 + 3, G - 86], lf: [w1 - 26, G - 40], rf: [w1 - 20, G - 36] });
    o.to(0.3, { x: w1 + 4, y: G - 94, a: 84, rf: [w1 - 34, G - 88], lf: [w1 - 38, G - 82] });
    o.to(0.3, { x: w1 + 26, y: G - 32, a: 14, lh: [w1 + 12, G - 60], rh: [w1 + 14, G - 56], lf: [w1 + 20, G], rf: [w1 + 34, G] });
    walk(o, w2 - 40, {});
    if (fault) {
      o.to(0.35, { x: w2 - 22, y: G - 86, a: 10, lh: [w2 + 1, G - 120], rh: [w2 + 4, G - 120], lf: [w2 - 1, G - 50], rf: [w2 - 1, G - 62] });
      o.to(0.2, (st) => ({ lf: [st.x - 6 * st.f, st.y + 40], rf: [st.x + 2 * st.f, st.y + 41] }));
      o.to(0.4, { x: w2 + 4, y: G - 126, a: 86, rf: [w2 - 26, G - 116], lf: [w2 - 32, G - 110] });
      o.mark('Taking a wall the wrong way, over instead of under or the other way round.', 'hip', { kind: 'bad', hl: ['w2'] });
      land(o, w2 + 26, 1);
    } else {
      o.to(0.35, { x: w2 - 34, y: G - 12, a: 88, lh: [w2 - 6, G], rh: [w2 - 2, G], lf: [w2 - 70, G], rf: [w2 - 64, G], kp: [0, 1] });
      o.to(0.6, { x: w2 + 8, lh: [w2 + 36, G], rh: [w2 + 30, G], lf: [w2 - 30, G], rf: [w2 - 24, G] });
      o.mark('Each wall taken the way it’s set.', 'hip');
      o.to(0.5, { ...stand(w2 + 40, 1), kp: undefined });
    }
    walk(o, w3 - 24, {});
    o.to(0.35, { x: w3 - 12, y: G - 52, a: 50, lh: [w3 + 2, win[1]], rh: [w3 + 5, win[1]], lf: [w3 - 22, G], rf: [w3 - 12, G] });
    o.to(0.4, { x: w3 + 10, y: win[1] - 18, a: 105, lh: [w3 + 30, G - 30], rh: [w3 + 34, G - 26], rf: [w3 - 26, win[1] - 26], lf: [w3 - 30, win[1] - 20] });
    land(o, w3 + 34, 1);
    return walk(o, 395, {});
  };
  return {
    back: (s, H) => `${ground()}${rc(w1, G - 86, 7, 86, 'prF prWood')}${rc(w2, G - 140, 7, 140 - (G - gap), hl(H.has('w2'), 'prF prWood'))}${ln(w2 - 4, G - 140, w2 - 4, G, 'pr prThin')}${ln(w2 + 11, G - 140, w2 + 11, G, 'pr prThin')}
      ${rc(w3, G - 140, 7, win[0] - (G - 140), 'prF prWood')}${rc(w3, win[1], 7, G - win[1], 'prF prWood')}`,
    good: run(), fails: [run('w2')],
  };
}

function rope() {
  // a 15 ft rope (the camera pulls back), the bell beside the top
  const rx = 215, top = G - 240, bx = rx + 14, by = top + 20;
  const run = (fault) => {
    const o = timeline({ ...stand(170), cam: [215, 90, 0.78], ring: 0 });
    walk(o, rx - 13, {});
    o.to(0.35, { x: rx - 12, y: G - 52, a: 4, lh: [rx - 1, G - 88], rh: [rx + 1, G - 100], lf: [rx, G - 22], rf: [rx - 2, G - 12] });
    let y = G - 52;
    const cycles = 4;
    for (let i = 0; i < cycles; i++) {
      o.to(0.4, (s) => ({ lh: [rx - 1, y - 36 - 34], rh: [rx + 1, y - 36 - 22], y: y - 6 }));
      if (fault === 'tworopes' && i === 2) { o.to(0.35, { rh: [rx + 18, y - 70] }); o.mark('Using more than one rope in a single attempt.', 'rh', { kind: 'bad', hl: ['rope2'] }); }
      o.to(0.4, { y: y - 36, lf: [rx, y - 36 + 30], rf: [rx - 2, y - 36 + 40] });
      y -= 36;
    }
    if (fault === 'nobell') {
      o.hold(0.6);
      o.mark('Not ringing the bell.', [bx, by], { kind: 'bad', hl: ['bell'] });
    } else {
      ringBell(o, [bx, by + 2]);
      o.mark('The bell rung with any part of the body above the waist.', 'rh');
    }
    if (fault === 'drop') {
      o.to(0.25, { lh: [rx - 14, y - 40], rh: [rx + 12, y - 44], lf: [rx - 10, y + 40], rf: [rx + 6, y + 40] });
      o.mark('Coming down out of control, or without a hand on the rope.', 'hip', { kind: 'bad', body: true });
      return land(o, rx - 14, 1);
    }
    for (let i = 0; i < cycles; i++) {
      o.to(0.3, { y: y + 36, lf: [rx, y + 36 + 30], rf: [rx - 2, y + 36 + 40] });
      o.to(0.3, { lh: [rx - 1, y + 36 - 34], rh: [rx + 1, y + 36 - 22] });
      y += 36;
    }
    o.to(0.3, stand(rx - 12, 1));
    return walk(o, rx - 60, {});
  };
  return {
    back: (s, H) => `${ground()}${ln(150, top - 10, 300, top - 10, 'pr prThick')}${ln(160, top - 10, 160, G, 'pr prThick')}${ln(290, top - 10, 290, G, 'pr prThick')}
      ${ln(rx, top - 10, rx, G - 4, 'pr')}${ln(rx + 18, top - 10, rx + 18, G - 4, hl(H.has('rope2'), 'pr'))}${ln(bx, top - 10, bx, by - 14, 'pr prThin')}${bell(bx, by, s.ring, H.has('bell'))}`,
    good: run(), fails: [run('nobell'), run('drop'), run('tworopes')],
  };
}

// ================================================================================================ hanging and traverses (from the side)
/** hand over hand along grips (points), then the bell, then down */
/** hand over hand along grips: the body swings under the hand(s) holding on, forward to reach the next grip and back under the new one */
function traverse(o, grips, { R = 60, bellAt, fault, noBell } = {}) {
  const hang = (pivot, deg, extra = {}) => {
    const r = deg * D, hip = [pivot[0] - Math.sin(r) * R, pivot[1] + Math.cos(r) * R], lag = r * 0.55, leg = [Math.sin(-lag) * 42, Math.cos(lag) * 42];
    return { x: hip[0], y: hip[1], a: deg, lf: [hip[0] + leg[0] - 4, hip[1] + leg[1] - 2], rf: [hip[0] + leg[0] + 3, hip[1] + leg[1]], kp: [1, 0.3], ...extra };
  };
  const g0 = grips[0];
  o.to(0.4, { ...hang(g0, 0), lh: g0, rh: [g0[0] + 3, g0[1]] });
  for (let i = 1; i < grips.length; i++) {
    const g = grips[i], p = grips[i - 1], lead = i % 2 ? 'rh' : 'lh';
    // swing forward on the last grip, reach the next at the front of the swing, then hang between the two
    o.to(0.3, { ...hang(p, -16), [lead]: [g[0] - 7, g[1] + 5] });
    const st = { ...hang([(p[0] + g[0]) / 2, (p[1] + g[1]) / 2], 6), [lead]: g };
    if (fault && fault.at === i && fault.pre) o.to(0.22, fault.pre(st.x, st.y, g));
    if (fault && fault.at === i) Object.assign(st, fault.pose(st.x, st.y, g));
    o.to(0.32, st);
    if (fault && fault.at === i) o.mark(fault.text, fault.limb, { kind: 'bad', hl: fault.hl || [], body: fault.body });
    if (fault && fault.at === i && fault.end) return fault.end(o, st.x, st.y);
    if (fault && fault.at === i && fault.pre) o.to(0.22, fault.pre(st.x, st.y, g));
  }
  const last = grips[grips.length - 1];
  o.to(0.35, { ...hang(last, 0), lh: last, rh: [last[0] + 3, last[1]] });
  if (noBell) { o.mark('Not ringing the bell.', bellAt, { kind: 'bad', hl: ['bell'] }); return land(o, last[0] + 4, 1); }
  o.to(0.3, hang(last, -8, { rh: bellAt, ring: 0 })).to(0.6, { ring: 1 });
  o.mark('The bell rung at the end.', 'rh');
  return land(o, last[0] + 14, 1);
}

const rig = (kind) => () => {
  const y = G - ({ rings: 150, hydra: 158, twister: 140, monkey: 136, tilting: 138, mitm: 140 }[kind]), xs = Array.from({ length: 8 }, (_, i) => 108 + i * 30), bx = 348, by = y + 22;
  const mid = (i) => kind === 'mitm' && i >= 3 && i <= 5;
  const drop = { rings: 34, hydra: 20, twister: 6, monkey: 0, tilting: 0, mitm: 8 }[kind];
  const tilt = kind === 'tilting' ? (i) => (i - 3.5) * 3 : () => 0;
  const grips = xs.map((x, i) => [x, y + (mid(i) ? 0 : drop) + tilt(i)]);
  const ups = [96, 330];
  const run = (fault) => {
    const o = timeline({ ...stand(36), ring: 0 });
    walk(o, 62, {});
    o.to(0.3, { ...stand(76, 1, G - 24) });
    traverse(o, grips, { bellAt: [bx, by + 2], noBell: fault === 'nobell', fault: FAULTS[fault] });
    return walk(o, 392, {});
  };
  const FAULTS = {
    feet: { at: 4, pre: (hx, hy, g) => ({ lf: [g[0] + 34, g[1] + 46], rf: [g[0] + 32, g[1] + 50], x: g[0] + 4, y: g[1] + 56, a: -18 }), pose: (hx, hy, g) => ({ lf: [g[0] + 30, g[1] + 3], rf: [g[0] + 26, g[1] + 4], x: g[0] + 10, y: g[1] + 50, a: -35 }), text: kind === 'mitm' ? 'Feet or legs touching the handles or bars, or going over the top.' : kind === 'tilting' ? 'Feet on the bars.' : kind === 'twister' ? 'Feet on the handles.' : kind === 'hydra' ? 'Feet on the attachments.' : kind === 'rings' ? 'Feet on the attachments.' : 'Feet or legs touching the bars.', limb: 'lf' },
    ground: { at: 4, pose: (hx, hy) => ({ lf: [hx + 2, G], rf: [hx - 8, G - 12], y: hy + 8 }), text: 'Feet touching the ground to gain an advantage.', limb: 'lf' },
    truss: { at: 1, pose: (hx, hy) => ({ lf: [ups[0] + 1, hy + 24], rf: [ups[0] + 1, hy + 36] }), text: kind === 'tilting' ? 'Using the uprights as a ladder.' : 'Using the vertical truss as a ladder.', limb: 'lf', hl: ['truss'] },
    rope: { at: 3, pose: (hx, hy, g) => ({ rh: [g[0] + 2, g[1] - 18], y: hy - 18, rf: [hx + 4, hy + 22], lf: [hx - 2, hy + 26] }), text: kind === 'hydra' ? 'Grabbing the tubing that holds the attachments.' : 'Grabbing the ropes, slings or chains that hold the rings and handles.', limb: 'rh', hl: ['rope'] },
    fall: { at: 5, pose: (hx, hy, g) => ({ lh: [hx - 12, hy - 52], rh: [hx + 10, hy - 54], y: hy + 6 }), text: 'Falling off.', limb: 'hip', body: true, end: (o, hx) => land(o, hx, 1) },
  };
  const fails = { monkey: ['feet', 'truss', 'nobell'], rings: ['rope', 'ground', 'nobell'], twister: ['fall', 'feet'], hydra: ['rope', 'fall'], tilting: ['truss', 'feet'], mitm: ['feet', 'fall'] }[kind];
  return {
    back: (s, H) => {
      let st = `${ground()}${rc(56, G - 24, 34, 24, 'prF prWood')}${ups.map((x) => ln(x, y - 8, x, G, hl(H.has('truss') && x === ups[0], 'pr prThick'))).join('')}${ln(ups[0], y - 8, ups[1] + 24, y - 8, 'pr prThick')}`;
      if (kind === 'monkey' || kind === 'tilting') st += `${ln(xs[0] - 12, grips[0][1] - 4, xs[7] + 12, grips[7][1] - 4, 'pr')}${grips.map(([x, gy]) => ci(x, gy, 2.6, 'prMetal')).join('')}`;
      if (kind === 'rings' || kind === 'hydra') st += grips.map(([x, gy], i) => `${ln(x, y - 8, x, gy - 5, hl(H.has('rope') && i === 3, kind === 'hydra' ? 'pr prThick' : 'pr prThin'))}${kind === 'hydra' ? rc(x - 5, gy - 4, 10, 6, 'prMetal', 2) : `<circle class="pr" cx="${x}" cy="${gy}" r="5"/>`}`).join('');
      if (kind === 'mitm') st += `${ln(xs[0] - 12, y - 2, xs[7] + 12, y - 2, 'pr prThick')}${grips.map(([x, gy], i) => (mid(i) ? ci(x, gy, 2.6, 'prMetal') : `${ln(x, y - 2, x, gy - 3, 'pr')}${ln(x - 4, gy, x + 4, gy, 'pr prThick')}`)).join('')}`;
      if (kind === 'twister') st += `${ln(xs[0] - 12, y - 2, xs[7] + 12, y - 2, 'pr prThick')}${grips.map(([x, gy], i) => ln(x, y - 2, x + (i % 2 ? 5 : -5), gy + 2, 'pr')).join('')}`;
      return `${st}${ln(bx, y - 8, bx, by - 14, 'pr prThin')}${bell(bx, by, s.ring, H.has('bell'))}`;
    },
    good: run(), fails: fails.map(run),
  };
};

function ape() {
  // a rope (or rope ladder) up to the bars, then across, the bell at the far end
  const y = G - 170, rx = 84, xs = Array.from({ length: 7 }, (_, i) => 108 + i * 30), bx = 330, by = y + 22;
  const grips = xs.map((x) => [x, y]);
  const run = (fault) => {
    const o = timeline({ ...stand(36), ring: 0 });
    walk(o, rx - 12, {});
    let hy = G - 52;
    o.to(0.35, { x: rx - 12, y: hy, a: 4, lh: [rx - 1, G - 88], rh: [rx + 1, G - 100], lf: [rx, G - 22], rf: [rx - 2, G - 12] });
    o.mark('Trying the climb up to the bars again: that part can be retried.', 'rh');
    for (let i = 0; i < 2; i++) { o.to(0.4, { lh: [rx - 1, hy - 70], rh: [rx + 1, hy - 58], y: hy - 6 }); o.to(0.4, { y: hy - 36, lf: [rx, hy - 6], rf: [rx - 2, hy + 4] }); hy -= 36; }
    o.to(0.4, { lh: [rx - 1, y + 6], rh: [rx + 1, y + 16], y: y + 52 });
    traverse(o, grips, { bellAt: [bx, by + 2], fault: fault === 'feet' ? { at: 3, pre: (hx, h2, g) => ({ lf: [g[0] + 34, g[1] + 46], rf: [g[0] + 32, g[1] + 50], x: g[0] + 4, y: g[1] + 56, a: -18 }), pose: (hx, h2, g) => ({ lf: [g[0] + 30, g[1] + 3], rf: [g[0] + 26, g[1] + 4], x: g[0] + 10, y: g[1] + 50, a: -35 }), text: 'Feet touching the bars.', limb: 'lf' }
      : fault === 'fall' ? { at: 4, pose: (hx, h2) => ({ lh: [hx - 12, h2 - 52], rh: [hx + 10, h2 - 54], y: h2 + 6 }), text: 'Not finishing once a bar has been touched: from then on the athlete is committed.', limb: 'hip', body: true, end: (o2, hx) => land(o2, hx, 1) } : undefined });
    return walk(o, 392, {});
  };
  return {
    back: (s) => `${ground()}${ln(rx, y - 6, rx, G - 6, 'pr')}${ln(70, y - 8, 350, y - 8, 'pr prThick')}${ln(70, y - 8, 70, G, 'pr prThick')}${ln(350, y - 8, 350, G, 'pr prThick')}
      ${ln(xs[0] - 12, y - 4, xs[6] + 12, y - 4, 'pr')}${grips.map(([x, gy]) => ci(x, gy, 2.6, 'prMetal')).join('')}${ln(bx, y - 8, bx, by - 14, 'pr prThin')}${bell(bx, by, s.ring)}`,
    good: run(), fails: [run('feet'), run('fall')],
  };
}

function tyrolean() {
  // a rope across water: hanging under it, legs hooked over, hand over hand to the bell
  const ry = G - 100, x0 = 60, x1 = 330, bx = 340, by = ry + 2;
  const pose = (x, k, fault) => ({ x, y: ry + 20, a: -74, f: -1, lh: [x + 34 + (k % 2 ? 8 : 0), ry], rh: [x + 28 + (k % 2 ? 0 : 8), ry], lf: [x - 30, ry], rf: [x - 26, ry] });
  const run = (fault) => {
    const o = timeline({ ...stand(20), ring: 0 });
    walk(o, x0 + 6, {});
    o.to(0.35, { ...stand(x0 + 8, -1), lh: [x0 + 4, ry], rh: [x0 + 12, ry] });
    o.to(0.45, pose(x0 + 30, 0));
    for (let k = 1; k <= 8; k++) {
      const st = pose(x0 + 30 + k * 26, k);
      if (fault && k === 4) { st.lf = [st.x - 2, G + 6]; st.rf = [st.x - 12, ry + 8]; st.a = -20; st.y += 36; }
      o.to(0.45, st, 'lin');
      if (fault && k === 4) o.mark('Using the ground or the water below to help.', 'lf', { kind: 'bad', hl: ['water'] });
    }
    o.to(0.3, { rh: [bx, by + 2], ring: 0 }).to(0.6, { ring: 1 });
    o.mark('Getting off once the bell is rung.', 'rh');
    o.to(0.35, { kp: undefined, ep: undefined, x: x1 + 18, y: G - 41, a: 4, lf: [x1 + 14, G], rf: [x1 + 22, G], lh: [x1 + 12, G - 40], rh: [x1 + 24, G - 40] });
    return o.to(0.3, stand(x1 + 20, 1));
  };
  return {
    back: (s, H) => `${ground()}${rc(x0 + 24, G - 3, x1 - x0 - 34, 30, hl(H.has('water'), 'prWater'))}${ln(x0 - 10, ry - 30, x0 - 10, G, 'pr prThick')}${ln(x1 + 26, ry - 30, x1 + 26, G, 'pr prThick')}
      ${ln(x0 - 10, ry, x1 + 26, ry, 'pr')}${ln(bx, ry - 30, bx, by - 14, 'pr prThin')}${bell(bx, by, s.ring, H.has('bell'))}`,
    good: run(), fails: [run('water')],
  };
}

// ================================================================================================ sideways traverses (seen from behind)
/** the hand holds (top row) and foot holds (bottom row), crossed to the right; f = 0: facing the wall, back to us */
function lateral(o, hands, feet, { fault, bellAt } = {}) {
  o.to(0.4, { x: hands[0][0] + 6, y: hands[0][1] + 45, a: 0, f: 0, lh: hands[0], rh: hands[1], lf: feet[0], rf: feet[1] });
  for (let i = 1; i < hands.length - 1; i++) {
    const st = { x: (hands[i][0] + hands[i + 1][0]) / 2, rh: hands[i + 1] };
    o.to(0.35, st);
    o.to(0.3, { rf: feet[Math.min(feet.length - 1, i + 1)] });
    const f2 = { lh: hands[i], lf: feet[i] };
    if (fault && fault.at === i) Object.assign(f2, fault.pose(hands[i], feet[i]));
    o.to(0.35, f2);
    if (fault && fault.at === i) { o.mark(fault.text, fault.limb, { kind: 'bad', hl: fault.hl || [] }); if (fault.stop) return land(o, o.s.x, 0); }
  }
  if (bellAt) { ringBell(o, bellAt); o.mark('The bell rung at the end.', 'rh'); }
  return land(o, o.s.x + 6, 0);
}
const wallTraverse = (kind) => () => {
  const x0 = 70, x1 = 330, n = 9, step = (x1 - x0) / (n - 1), top = G - 134, bx = x1 + 16, by = G - 124;
  const hands = Array.from({ length: n }, (_, i) => [x0 + i * step, G - 108 + (kind === 'helix' ? Math.sin(i * 1.3) * 6 : 0)]);
  const feet = Array.from({ length: n }, (_, i) => [x0 + i * step + 4, G - 30 + (kind === 'helix' ? Math.sin(i * 1.3) * 6 : 0)]);
  const F = {
    ground: { at: 4, pose: (h, f) => ({ lf: [f[0], G], rh: [h[0] + 14, G - 68], y: G - 46 }), text: kind === 'hanging' ? 'Feet on the ground after starting.' : 'Touching the ground.', limb: 'lf', hl: [] },
    top: { at: 4, pose: (h) => ({ lh: [h[0], top], y: top + 62 }), text: kind === 'zwall' ? 'Touching the top of the wall or any of the braces.' : kind === 'olympus' ? 'Touching the top of the wall.' : 'Touching the top.', limb: 'lh', hl: ['top'] },
    holdfoot: { at: 4, pose: (h) => ({ lf: [h[0] + 12, h[1] + 14] }), text: 'Feet or knees on or in any of the holds or holes.', limb: 'lf', hl: ['hold'] },
    grey: { at: 4, pose: (h) => ({ lh: [h[0] + 10, h[1] + 16] }), text: 'Using holds that aren’t red, or the other face.', limb: 'lh', hl: ['grey'] },
    lane: { at: 4, pose: (h) => ({ lh: [h[0], G - 130], y: G - 78 }), text: 'Using bars from another lane.', limb: 'lh', hl: ['lane'] },
    cut: { at: 3, pose: (h) => ({ lh: [x0 + 3 * step + 2, G - 75] }), text: 'Touching the top or bottom of any cut-out.', limb: 'lh', hl: ['cut'] },
  };
  const fails = { olympus: ['ground', 'holdfoot', 'top'], zwall: ['ground', 'top', 'cut'], hanging: ['grey', 'ground'], helix: ['lane', 'top', 'ground'] }[kind];
  const run = (fault) => {
    const o = timeline({ ...stand(40, 1), ring: 0 });
    walk(o, x0 - 6, {});
    o.to(0.4, stand(x0 + 6, 0));
    if (kind === 'olympus') o.mark('Feet and knees resting against the wall.', 'lf', { dt: 0.8 });
    if (kind === 'hanging') o.mark('Red holds only, on one face, all the way to the bell.', 'lh', { dt: 0.8 });
    if (kind === 'helix') o.mark('Only that lane’s bars, all the way to the bell.', 'lh', { dt: 0.8 });
    lateral(o, hands, feet, { fault: F[fault], bellAt: [bx, by + 2] });
    return o.to(0.3, stand(o.s.x, 1));
  };
  return {
    back: (s, H) => {
      let w = `${ground()}`;
      if (kind === 'olympus') w += `${rc(x0 - 20, top, x1 - x0 + 40, G - top - 10, hl(H.has('top'), 'prF prWood'))}${hands.map(([x, y]) => `${ci(x, y, 4, 'prRed')}${ci(x + 12, y + 14, 3.2, hl(H.has('hold'), 'prF'))}`).join('')}${feet.map(([x, y]) => ci(x, y + 3, 2.5, 'prF')).join('')}`;
      if (kind === 'zwall') w += `${pg([[x0 - 20, top], [x0 + 2.5 * step, top], [x0 + 2.5 * step, top + 18], [x0 + 5.5 * step, top + 18], [x0 + 5.5 * step, top], [x1 + 20, top], [x1 + 20, G - 12], [x0 - 20, G - 12]], hl(H.has('top'), 'prF prWood'))}${rc(x0 + 3 * step - 12, G - 80, 24, 26, hl(H.has('cut'), 'gnd'))}${hands.map(([x, y]) => rc(x - 4, y - 3, 8, 6, 'prMetal')).join('')}${feet.map(([x, y]) => rc(x - 5, y - 3, 10, 6, 'prMetal')).join('')}`;
      if (kind === 'hanging') w += `${[0, 1, 2].map((k) => rc(x0 - 20 + k * 96, top + 14, 90, 92, 'prF prWood')).join('')}${ln(x0 - 30, top, x1 + 30, top, 'pr prThick')}${[0, 1, 2].map((k) => `${ln(x0 + 25 + k * 96, top, x0 + 25 + k * 96, top + 14, 'pr prThin')}`).join('')}${hands.map(([x, y]) => `${ci(x, y, 4, 'prRed')}${ci(x + 10, y + 16, 3.4, hl(H.has('grey'), 'prMetal'))}`).join('')}`;
      if (kind === 'helix') w += `${ln(x0 - 30, top, x1 + 30, top, hl(H.has('top'), 'pr prThick'))}${hands.map(([x, y]) => `${ln(x - 8, y, x + 8, y, 'pr prThick')}${ln(x - 8, G - 130, x + 8, G - 130, hl(H.has('lane'), 'pr'))}`).join('')}${feet.map(([x, y]) => ln(x - 8, y, x + 8, y, 'pr prThick')).join('')}`;
      return `${w}${ln(bx, top - 4, bx, by - 14, 'pr prThin')}${bell(bx, by, s.ring)}`;
    },
    good: run(), fails: fails.map(run),
  };
};

// ================================================================================================ carries, drags and lifts
/** carried items: where they sit when carried (from the shoulder and hips), the hands, and the drawing */
const ITEMS = {
  sandbag: { at: (sh, hip, f) => [sh[0] - f * 2, sh[1] - 6], hands: (sh, f) => ({ lh: [sh[0] - f * 5, sh[1] - 9], rh: [sh[0] + f * 7, sh[1] - 10] }), r: 6, draw: (p, c) => `<rect class="${c} prBag" x="${(p[0] - 12).toFixed(1)}" y="${(p[1] - 6).toFixed(1)}" width="24" height="12" rx="6"/>`, behind: true },
  log: { at: (sh, hip, f) => [sh[0], sh[1] - 5], hands: (sh, f) => ({ lh: [sh[0] - f * 6, sh[1] - 8], rh: [sh[0] + f * 8, sh[1] - 8] }), r: 5, draw: (p, c, s) => `<rect class="${c} prWood" x="${(p[0] - 30).toFixed(1)}" y="${(p[1] - 5).toFixed(1)}" width="60" height="10" rx="5" transform="rotate(${(s.spin || 0).toFixed(1)} ${p[0].toFixed(1)} ${p[1].toFixed(1)})"/>`, behind: true },
  chain: { at: (sh, hip, f) => [sh[0] + f * 3, sh[1] + 2], hands: (sh, f) => ({ lh: [sh[0] + f * 9, sh[1] + 12], rh: [sh[0] + f * 11, sh[1] + 16] }), r: 4, draw: (p, c, s) => Array.from({ length: 7 }, (_, i) => `<circle class="${c} prMetal" cx="${(p[0] - 9 + i * 3).toFixed(1)}" cy="${(p[1] + (s.hold > 0.5 ? Math.abs(i - 3) * 3 - 6 : 0)).toFixed(1)}" r="2.6"/>`).join(''), behind: true },
  bucket: { at: (sh, hip, f) => [sh[0] + f * 11, sh[1] + 17], hands: (sh, f) => ({ lh: [sh[0] + f * 17, sh[1] + 14], rh: [sh[0] + f * 15, sh[1] + 24] }), r: 11, draw: (p, c) => `<path class="${c} prMetal" d="M${(p[0] - 9).toFixed(1)} ${(p[1] - 11).toFixed(1)} h18 l-2 22 h-14 z"/>${rc(p[0] - 10, p[1] - 13, 20, 3, 'prRed')}` },
  armer: { at: (sh, hip, f) => [hip[0] + f * 10, hip[1] + 6], hands: (sh, f, hip) => ({ lh: [hip[0] + f * 7, hip[1] - 2], rh: [hip[0] + f * 13, hip[1] - 2] }), r: 7, draw: (p, c) => `${rc(p[0] - 10, p[1] - 5, 20, 12, `${c} prMetal`, 2)}<path class="pr prThin" d="M${(p[0] - 6).toFixed(1)} ${(p[1] - 5).toFixed(1)} v-4 h4 v4 M${(p[0] + 2).toFixed(1)} ${(p[1] - 5).toFixed(1)} v-4 h4 v4"/>` },
  atlas: { at: (sh, hip, f) => [sh[0] + f * 13, sh[1] + 24], hands: (sh, f) => ({ lh: [sh[0] + f * 19, sh[1] + 22], rh: [sh[0] + f * 11, sh[1] + 33] }), r: 11, draw: (p, c, s) => `<circle class="${c} prMetal" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="11"/>${ln(p[0] - 6, p[1] - 3 + (s.spin || 0) % 6, p[0] + 2, p[1] + 4, 'pr prThin')}` },
};
const FAILS = {
  sandbag: [['drag', 'Dragging, rolling, throwing or pushing the bag.']],
  log: [['moved', 'Setting off again from anywhere but where it was put down.'], ['roll', 'Dragging, rolling, throwing or pushing the log.']],
  chain: [['drag', 'Dragging, rolling, throwing or pushing the chain.']],
  bucket: [['spill', 'Coming back with material missing: the whole course is done again with a properly filled bucket.']],
  armer: [['hug', 'Not carrying it by the handles.'], ['drag', 'Dragging, rolling, throwing or pushing the weight.']],
  atlas: [['roll', 'Rolling the stone.']],
};
const REST = {
  sandbag: 'Putting it down to rest, then setting off again from wherever it landed.',
  log: 'Putting it down to rest; if it moves, bringing it back to where it was put down before carrying on.',
  chain: 'Putting it down to rest, then setting off again from where it was put down.',
  bucket: 'Resting the bucket on the ground.',
  armer: 'Putting it down to rest; if it moves, bringing it back to that spot before carrying on.',
  atlas: 'Putting the stone down to rest.',
};
const carry = (kind) => () => {
  const START = 66, FLAG = kind === 'atlas' ? 300 : 335, it = ITEMS[kind], REST_X = 200;
  const on = (s) => { const sh = shoulder(s); return { ...it.hands(sh, s.f, [s.x, s.y]), hold: 1 }; };
  const squat = (x, f, objX) => ({ x, y: G - 26, a: 38, f, lf: [x - 6 * f, G], rf: [x + 7 * f, G], lh: [objX - 4, G - it.r * 2 + 2], rh: [objX + 4, G - it.r * 2] });
  const pick = (o, x, f, objX) => o.to(0.45, squat(x, f, objX)).to(0.5, (s) => ({ ...stand(x, f), ...on({ ...s, ...stand(x, f) }) }));
  const put = (o, x, f, objX) => o.to(0.05, { obj: [objX, G - it.r] }).to(0.45, squat(x, f, objX)).to(0.01, { hold: 0 }).to(0.4, stand(x, f));
  const run = (fault) => {
    const o = timeline({ ...stand(START - 30), obj: [START, G - it.r], hold: 0, spin: 0, ghost: 0, spill: 0 });
    pick(o, START - 16, 1, START);
    walk(o, FLAG - 14, { hands: on });
    o.to(0.6, (s) => ({ f: -1, ...on({ ...s, f: -1 }) }));
    const low = (s) => ({ lh: [s.x - 14, G - 20], rh: [s.x - 12, G - 16], hold: 0 });
    if (fault === 'drag' || fault === 'roll') {
      const lead = fault === 'roll' ? -22 : 26;
      const h = (s) => ({ ...low(s), ...(fault === 'roll' ? { lh: [s.x - 18, G - 12], rh: [s.x - 16, G - 10] } : { lh: [s.x + 10, G - 22], rh: [s.x + 13, G - 20] }), obj: [s.x + lead, G - it.r], spin: s.x * 4 });
      o.to(0.5, (s) => ({ a: 32, y: G - 36, ...h(s) }));
      walk(o, 190, { hands: h, lean: 32, v: 55 });
      o.mark(FAILS[kind].find(([k]) => k === fault)[1], (s) => s.obj, { kind: 'bad', hl: ['item'] });
      walk(o, START + 34, { hands: h, lean: 32, v: 55 });
      return o.to(0.4, { ...stand(START + 40, -1), obj: [START, G - it.r] });
    }
    if (fault === 'hug') {
      const hug = (s) => { const sh = shoulder(s); return { lh: [sh[0] + s.f * 16, sh[1] + 14], rh: [sh[0] + s.f * 14, sh[1] + 22], hold: 1, hugged: 1 }; };
      o.to(0.4, (s) => hug(s));
      walk(o, 190, { hands: hug });
      o.mark('Not carrying it by the handles.', (s, P) => [P.sh[0] + s.f * 12, P.sh[1] + 18], { kind: 'bad', hl: ['item'] });
      walk(o, START + 14, { hands: hug });
      return put(o, START + 14, -1, START);
    }
    if (fault === 'spill') {
      walk(o, 230, { hands: on });
      o.to(0.8, { spill: 1 });
      o.mark(FAILS.bucket[0][1], (s, P) => [P.sh[0] - 11, P.sh[1] + 17], { kind: 'bad', hl: ['item'] });
      walk(o, START + 14, { hands: on });
      return put(o, START + 14, -1, START);
    }
    walk(o, REST_X + 12, { hands: on });
    put(o, REST_X + 12, -1, REST_X);
    if (fault === 'moved') {
      o.to(0.5, { obj: [REST_X - 26, G - it.r], spin: -180, ghost: REST_X });
      pick(o, REST_X - 14, -1, REST_X - 26);
      o.mark('Setting off again from anywhere but where it was put down.', [REST_X, G - it.r], { kind: 'bad', hl: ['ghost'] });
      walk(o, START + 14, { hands: on });
      return put(o, START + 14, -1, START);
    }
    o.mark(REST[kind], [REST_X, G - it.r - 2]);
    o.hold(0.3);
    pick(o, REST_X + 12, -1, REST_X);
    walk(o, START + 14, { hands: on });
    return put(o, START + 14, -1, START);
  };
  const item = (s, H, P) => {
    const carried = it.at(P.sh, P.hip, s.f), hug = s.hugged ? [P.sh[0] + s.f * 12, P.sh[1] + 18] : carried;
    const p = [s.obj[0] + (hug[0] - s.obj[0]) * s.hold, s.obj[1] + (hug[1] - s.obj[1]) * s.hold];
    const drops = s.spill > 0 && s.spill < 1 ? Array.from({ length: 4 }, (_, i) => ci(p[0] - s.f * 9, p[1] + 14 + ((s.spill * 60 + i * 9) % 30), 1.6, 'prBag')).join('') : '';
    return `${s.ghost ? `<rect class="${hl(H.has('ghost'), 'prGhost')}" x="${s.ghost - 14}" y="${G - it.r * 2}" width="28" height="${it.r * 2}" rx="4"/>` : ''}${it.draw(p, hl(H.has('item'), ''), s)}${drops}`;
  };
  return {
    back: (s, H, P) => `${ground()}${flag(FLAG + 6)}${rc(START - 22, G - 3, 44, 3, 'prF')}${it.behind ? item(s, H, P) : ''}`,
    front: (s, H, P) => (it.behind ? '' : item(s, H, P)),
    good: run(), fails: FAILS[kind].map(([k]) => run(k)),
  };
};

function tireflip() {
  // the tyre lies flat (1.2 m across); it turns about the middle of its far edge, so a half turn lands it flat beyond, and back again
  const NX = 120, W = 64, TH = 16, PV = [NX + W, G - TH / 2];
  const edge = (deg) => { const r = deg * D, c = Math.cos(r), sn = Math.sin(r); return [PV[0] - W * c + (TH / 2) * sn, PV[1] - W * sn - (TH / 2) * c]; };
  const grip = (deg, f) => { const e = edge(deg); return { lh: [e[0] - f * 2, Math.min(G - 1, e[1] + 2)], rh: [e[0] + f * 2, Math.min(G - 1, e[1])] }; };
  const run = (fault) => {
    const o = timeline({ ...stand(40), tr: 0 });
    walk(o, NX - 16, {});
    // the first flip: squat, hands under the near edge, drive it up and push it over
    o.to(0.5, { x: NX - 12, y: G - 26, a: 42, lf: [NX - 18, G], rf: [NX - 6, G], ...grip(0, 1) });
    o.to(0.5, { tr: 35, x: NX - 8, y: G - 38, a: 24, ...grip(35, 1) });
    o.to(0.45, { tr: 64, x: NX + 16, y: G - 42, a: 22, lf: [NX + 2, G], rf: [NX + 24, G], ...grip(64, 1) });
    o.to(0.4, { tr: 88, x: PV[0] - 30, y: G - 43, a: 26, lf: [PV[0] - 46, G], rf: [PV[0] - 24, G], ...grip(88, 1) });
    if (fault === 'touch') {
      o.to(0.45, { tr: 150, x: PV[0] - 4, y: G - 50, a: 30, lf: [PV[0] - 14, G], rf: [PV[0] + 2, G], ...grip(150, 1) }, { g: { tr: 1 } });
      o.mark('Touching it before it has come to rest after the first flip.', 'rh', { kind: 'bad', hl: ['tyre'] });
      o.to(0.2, { tr: 180 }, { g: { tr: 1 } });
      return o.to(0.4, stand(PV[0] - 20, 1));
    }
    // let go: it falls the rest of the way on its own, under gravity
    o.to(0.5, { tr: 180, ...stand(PV[0] - 34, 1) }, { g: { tr: 1 } });
    o.mark('Let go of it completely, hands and feet, then flip it back over to where it started.', [PV[0] + W / 2, G - 10]);
    // round to the other side, and flip it back
    walk(o, PV[0] + W + 16, {});
    o.to(0.3, { f: -1 });
    o.to(0.5, { x: PV[0] + W + 20, y: G - 27, a: 68, lf: [PV[0] + W + 26, G], rf: [PV[0] + W + 15, G], ...grip(180, -1) });
    o.to(0.5, { tr: 145, x: PV[0] + W + 8, y: G - 38, a: 24, ...grip(145, -1) });
    o.to(0.45, { tr: 116, x: PV[0] + W - 16, y: G - 42, a: 22, lf: [PV[0] + W - 2, G], rf: [PV[0] + W - 24, G], ...grip(116, -1) });
    o.to(0.4, { tr: 92, x: PV[0] + 30, y: G - 43, a: 26, lf: [PV[0] + 46, G], rf: [PV[0] + 24, G], ...grip(92, -1) });
    o.to(0.5, { tr: 0, ...stand(PV[0] + 34, -1) }, { g: { tr: -1 } });
    return o.hold(0.4);
  };
  return {
    back: (s, H) => `${ground()}<g transform="rotate(${s.tr.toFixed(1)} ${PV[0]} ${PV[1]})"><rect class="${hl(H.has('tyre'), 'prTyre')}" x="${NX}" y="${G - TH}" width="${W}" height="${TH}" rx="7"/><rect class="prTyreIn" x="${NX + 14}" y="${G - TH + 4}" width="${W - 28}" height="${TH - 8}" rx="3"/></g>`,
    good: run(), fails: [run('touch')],
  };
}

function drag() {
  // the plate starts at the left; the stake on the right; pull it in with the rope, torso behind the stake, then drag it back
  const P0 = 70, STAKE = 290;
  const ropeTo = (s, P) => P.ra[2];
  const run = (fault) => {
    const o = timeline({ ...stand(320, -1), px: P0, py: 0, back: 0 });
    o.to(0.4, { a: -14, lh: [306, G - 70], rh: [300, G - 64], lf: [318, G], rf: [304, G] });
    for (let k = 0; k < 6; k++) {
      const px = P0 + (STAKE - 18 - P0) * (k + 1) / 6;
      const st = { px, [k % 2 ? 'lh' : 'rh']: [k % 2 ? 300 : 296, G - (k % 2 ? 72 : 66)], [k % 2 ? 'rh' : 'lh']: [314, G - 50] };
      if (fault === 'torso' && k === 3) Object.assign(st, { x: STAKE - 6, a: 30, lf: [STAKE + 4, G], rf: [STAKE - 10, G] });
      if (fault === 'lift' && k === 3) Object.assign(st, { py: 26 });
      o.to(0.45, st);
      if (fault === 'torso' && k === 3) { o.mark('The torso going past the stake (a foot or leg slipping past is fine).', 'sh', { kind: 'bad', body: true, hl: ['stake'] }); o.to(0.3, { x: 320, a: -14, lf: [318, G], rf: [304, G] }); }
      if (fault === 'lift' && k === 3) { o.mark('Lifting, carrying or rolling it.', (s) => [s.px, G - 8 - s.py], { kind: 'bad', hl: ['plate'] }); o.to(0.3, { py: 0 }); }
    }
    o.mark('The load on the ground the whole time.', (s) => [s.px, G - 6]);
    o.to(0.3, stand(316, -1));
    walk(o, STAKE - 48, {});
    o.to(0.4, { a: -18, lh: [STAKE - 38, G - 46], rh: [STAKE - 34, G - 42], back: 1 });
    walk(o, P0 - 30, { hands: (s) => ({ lh: [s.x + 10, G - 46], rh: [s.x + 14, G - 42], px: s.x + 30 }), lean: -18, v: 50 });
    return o.to(0.4, { ...stand(P0 - 30, -1), px: P0 });
  };
  return {
    back: (s, H, P) => {
      const hand = ropeTo(s, P), plate = [s.px, G - 4 - s.py];
      return `${ground()}${rc(STAKE - 3, G - 34, 6, 34, hl(H.has('stake'), 'prF prWood'))}${rc(P0 - 14, G - 2, 28, 2, 'prF')}${pl(s.back ? [[plate[0] - 12, plate[1]], hand] : [[plate[0] + 12, plate[1]], [STAKE, G - 20], hand], 'pr prThin')}
        <ellipse class="${hl(H.has('plate'), 'prMetal')}" cx="${plate[0].toFixed(1)}" cy="${plate[1].toFixed(1)}" rx="13" ry="4"/>`;
    },
    good: run(), fails: [run('torso'), run('lift')],
  };
}

function hoist() {
  // the athlete behind a low barrier pulls a rope that runs over a pulley at the top of a tower to the weight
  const BAR = 196, PUL = [300, G - 208], WX = 300, KNOT = PUL[1] + 6, WH = 18;
  const top = (w) => G - WH - w, wMax = G - WH - (KNOT + 12);
  const pullPose = (k) => ({ lh: k % 2 ? [178, G - 96] : [172, G - 70], rh: k % 2 ? [172, G - 68] : [178, G - 94] });
  const run = (fault) => {
    const o = timeline({ ...stand(150), w: 0, cam: [235, 98, 0.84] });
    walk(o, 168, {});
    o.to(0.4, { x: 166, y: G - 42, a: -16, lf: [BAR - 2, G - 26], rf: [158, G], ...pullPose(0) });
    o.mark('Feet pushing against the barrier.', 'lf');
    if (fault === 'stand') { o.to(0.4, { x: BAR - 6, y: G - 40 - HIP, a: -10, lf: [BAR - 2, G - 40], rf: [BAR + 5, G - 40] }); o.mark('Standing on or climbing over the barrier.', 'lf', { kind: 'bad', hl: ['barrier'] }); }
    for (let k = 1; k <= 7; k++) o.to(0.42, { w: wMax * k / 7, ...pullPose(k) });
    o.mark('The knot touching the pulley.', [PUL[0] + 6, PUL[1] + 8]);
    if (fault === 'drop') {
      o.to(0.12, { lh: [176, G - 62], rh: [180, G - 58] });
      o.to(Math.sqrt((2 * wMax) / GRAV), { w: 0 }, { g: { w: -1 } });
      o.mark('Dropping the weight to the ground out of control, for any reason.', [WX + 6, G - 10], { kind: 'bad', hl: ['weight'] });
      return o.to(0.4, stand(160));
    }
    for (let k = 6; k >= 0; k--) o.to(0.5, { w: wMax * k / 7, ...pullPose(k + 1) });
    o.mark('The weight under control, not falling, when it touches the ground.', [WX + 6, G - 10]);
    return o.to(0.4, stand(160));
  };
  return {
    back: (s, H, P) => {
      const tp = top(s.w), hand = P.ra[2];
      return `${ground()}${ln(256, PUL[1] - 12, 256, G, 'pr prThick')}${ln(350, PUL[1] - 12, 350, G, 'pr prThick')}${ln(246, PUL[1] - 8, 360, PUL[1] - 8, 'pr prThick')}${ln(256, PUL[1] + 40, 350, PUL[1] + 40, 'pr prThin')}
        ${ci(PUL[0] + 6, PUL[1], 7, 'prMetal')}${ln(WX + 12, PUL[1], WX + 12, tp, 'pr')}${pl([[PUL[0], PUL[1]], hand], 'pr')}${ci(WX + 12, tp - 12, 2.8, 'prRed')}
        ${rc(WX, tp, 24, WH, hl(H.has('weight'), 'prBag'), 4)}${rc(BAR, G - 40, 8, 40, hl(H.has('barrier'), 'prF prWood'))}`;
    },
    good: run(), fails: [run('drop'), run('stand')],
  };
}

// ================================================================================================ crawls, jumps, water and balance
function crawl() {
  const x0 = 110, x1 = 320, wy = G - 26;
  const prone = (x, k) => ({ x, y: G - 9, a: 88, f: 1, lh: [x + 38 + (k % 2 ? 10 : 0), G], rh: [x + 40 + (k % 2 ? 0 : 10), G], lf: [x - 40 - (k % 2 ? 0 : 6), G], rf: [x - 42 - (k % 2 ? 6 : 0), G], kp: [0, 1], ep: [0, 1] });
  const run = (fault) => {
    const o = timeline(stand(20));
    walk(o, x0 - 50, {});
    o.to(0.5, prone(x0 - 50, 0));
    for (let k = 1; k <= 10; k++) {
      o.to(0.4, prone(x0 - 50 + k * 22, k), 'lin');
      if (k === 5 && !fault) { o.to(0.25, { y: G - 13 }); o.mark('Touching the wire or the net.', 'hip'); o.to(0.25, { y: G - 9 }); }
      if (k === 4 && fault) {
        o.to(0.5, { ...stand(x0 - 50 + k * 22 + 10, 1), kp: undefined, ep: undefined });
        o.mark('Not going under it the whole way, end to end.', 'head', { kind: 'bad', body: true, hl: ['wire'] });
        return walk(o, 390, {});
      }
    }
    o.to(0.5, { ...stand(x1 + 30, 1), kp: undefined, ep: undefined });
    return walk(o, 390, {});
  };
  return {
    back: (s, H) => {
      const posts = Array.from({ length: 6 }, (_, i) => x0 + i * (x1 - x0) / 5);
      return `${ground()}${posts.map((x) => ln(x, wy - 6, x, G, 'pr')).join('')}${pl(Array.from({ length: 43 }, (_, i) => [x0 + i * 5, wy + (i % 2 ? 2 : -2)]), hl(H.has('wire'), 'pr prThin'))}`;
    },
    front: (s, H) => pl(Array.from({ length: 22 }, (_, i) => [x0 + i * 10, wy - 2 + (i % 2 ? 2 : -2)]), hl(H.has('wire'), 'pr prThin')),
    good: run(), fails: [run('stand')],
  };
}

function fire() {
  const fx = 220;
  const run = (fault) => {
    const o = timeline(stand(20));
    if (fault) {
      walk(o, fx - 46, {});
      o.to(0.4, { dim: 1, y: G - 10 - HIP, lf: [fx - 50, G - 10], rf: [fx - 42, G - 10] });
      walk(o, fx + 46, { gy: G - 10 });
      o.mark('Going round the fire.', 'hip', { kind: 'bad', hl: ['path'] });
      o.to(0.4, { dim: 0, ...stand(fx + 50, 1) });
      return walk(o, 390, {});
    }
    walk(o, fx - 66, { run: true });
    // take-off: the last foot down, arms driving up
    o.to(0.12, { x: fx - 52, y: G - 42, a: 16, lf: [fx - 60, G], rf: [fx - 36, G - 16], lh: [fx - 34, G - 98], rh: [fx - 66, G - 70] });
    leap(o, { a: 10, lf: [fx - 18, G - 58], rf: [fx + 10, G - 54], lh: [fx + 22, G - 104], rh: [fx - 20, G - 96], kp: [1, 0] },
      { x: fx + 50, y: G - 38, a: 18, lf: [fx + 42, G], rf: [fx + 62, G - 4], lh: [fx + 64, G - 72], rh: [fx + 36, G - 66], kp: undefined }, 26);
    o.mark('Over the fire.', (s, P) => [fx, G - 30], { dt: -0.35 });
    return walk(o, 390, { run: true });
  };
  return {
    back: (s, H, P, now = 0) => {
      const fl = (k) => (Math.sin(now / 90 + k) * 4).toFixed(1);
      return `${ground()}${s.dim || H.has('path') ? `<ellipse class="${hl(H.has('path'), 'pr prThin prDash')}" cx="${fx}" cy="${G - 8}" rx="48" ry="12"/>` : ''}${rc(fx - 18, G - 6, 36, 6, 'prWood')}
        <path class="prFire" d="M${fx - 16} ${G - 6} Q${fx - 10} ${G - 30 + +fl(1)} ${fx - 4} ${G - 16} Q${fx} ${G - 40 + +fl(2)} ${fx + 5} ${G - 18} Q${fx + 11} ${G - 32 + +fl(3)} ${fx + 16} ${G - 6} Z"/>`;
    },
    good: run(), fails: [run('round')],
  };
}

function swim() {
  const x0 = 110, x1 = 300, wy = G - 6;
  const stroke = (x, k) => ({ x, y: wy + 2, a: 86, f: 1, lh: k % 2 ? [x + 62, wy] : [x + 10, wy + 12], rh: k % 2 ? [x + 8, wy + 12] : [x + 62, wy - 2], lf: [x - 40, wy + 4], rf: [x - 40, wy + 10], kp: [0, -1] });
  const run = (fault) => {
    const o = timeline(stand(30));
    walk(o, x0 - 12, {});
    if (fault) {
      o.to(0.3, { a: 50, y: G - 34, lh: [x0 + 14, G - 50], rh: [x0 + 16, G - 46] });
      o.to(0.35, { x: x0 + 30, y: G - 50, a: 100, lh: [x0 + 74, G - 30], rh: [x0 + 76, G - 26], lf: [x0 - 6, G - 66], rf: [x0 - 2, G - 62] });
      o.mark('Diving.', 'head', { kind: 'bad', body: true });
      o.to(0.35, { ...stroke(x0 + 50, 0) });
    } else {
      o.to(0.3, { x: x0 - 4, lf: [x0 - 8, G], rf: [x0 + 6, G - 6] });
      o.to(0.6, { x: x0 + 14, y: wy - 20, a: 30, lf: [x0 + 6, wy + 18], rf: [x0 + 18, wy + 18] });
      o.to(0.5, stroke(x0 + 40, 0));
    }
    for (let k = 1; k <= 7; k++) { o.to(0.5, stroke(x0 + 40 + k * 20, k), 'lin'); if (k === 4 && !fault) o.mark('Inside the marked course the whole way.', 'hip'); }
    o.to(0.6, { ...stand(x1 + 18, 1), kp: undefined });
    return walk(o, 390, {});
  };
  return {
    back: (s, H, P, now = 0) => `${ground()}${ci(x0 + 4, wy, 4, 'prRed')}${ci(x1 - 4, wy, 4, 'prRed')}`,
    front: (s, H, P, now = 0) => `<path class="prWater" d="M${x0} ${wy} ${Array.from({ length: 20 }, (_, i) => `Q${x0 + i * 9.5 + 4.7} ${wy + Math.sin(now / 300 + i) * 1.5 - 2} ${x0 + (i + 1) * 9.5} ${wy}`).join(' ')} V${G + 30} H${x0} Z"/>`,
    good: run(), fails: [run('dive')],
  };
}

function balance() {
  // up a ramp, along the beam, down the last (descending) beam, land past the line
  const a0 = 90, a1 = 130, b1 = 280, c1 = 320, by = G - 16, line = 336;
  const beamY = (x) => (x < a1 ? G - (x - a0) * 16 / (a1 - a0) : x < b1 ? by : by + (x - b1) * 16 / (c1 - b1));
  const arms = (s) => { const sh = shoulder(s); return { lh: [sh[0] - 26, sh[1] + 4], rh: [sh[0] + 26, sh[1] + 2] }; };
  const run = (fault) => {
    const o = timeline(stand(40));
    walk(o, a0 - 6, {});
    let x = a0 + 4;
    for (let k = 0; x < c1 - 10; k++) {
      x += 18;
      const st = { x, y: beamY(x) - HIP, a: 2, lf: k % 2 ? [x - 9, beamY(x - 9)] : [x + 9, beamY(x + 9)], rf: k % 2 ? [x + 9, beamY(x + 9)] : [x - 9, beamY(x - 9)], ...arms({ x, y: beamY(x) - HIP, a: 2, f: 1 }) };
      if (fault && k === 5) { st.lf = [x + 6, G]; st.a = -12; st.y = G - 46; }
      o.to(0.42, st, 'lin');
      if (fault && k === 5) { o.mark('Touching the ground, or using anything but the feet.', 'lf', { kind: 'bad' }); return o.to(0.4, stand(x + 8, 1)); }
    }
    o.to(0.3, { x: c1 + 6, y: G - 70, a: 6, lf: [c1 - 2, beamY(c1 - 2)], rf: [c1 + 14, G - 30], lh: [c1 - 18, G - 98], rh: [c1 + 32, G - 98] });
    o.to(0.35, { x: line + 14, y: G - 34, a: 14, lf: [line + 7, G], rf: [line + 21, G], lh: [line + 6, G - 64], rh: [line + 30, G - 66] });
    o.mark('Touching the last (descending) beam before getting off, and landing past the line.', 'lf');
    return o.to(0.4, stand(line + 16, 1));
  };
  return {
    back: (s, H) => `${ground()}${pl([[a0, G], [a1, by], [b1, by], [c1, G]], 'pr prThick')}${ln(160, by, 160, G, 'pr')}${ln(250, by, 250, G, 'pr')}${ln(line, G, line, G + 6, 'prLine')}`,
    good: run(), fails: [run('ground')],
  };
}

function slackline() {
  const a0 = 80, a1 = 320, ay = G - 34, line = 336;
  const arms = (s) => { const sh = shoulder(s); return { lh: [sh[0] - 26, sh[1] - 6], rh: [sh[0] + 26, sh[1] + 6] }; };
  const sagAt = (x, px) => ay + 14 * Math.max(0, 1 - Math.abs(x - px) / 160);
  const run = (fault) => {
    const o = timeline(stand(40));
    walk(o, a0 - 6, {});
    o.to(0.4, { x: a0 + 4, y: ay - HIP, rf: [a0 + 6, ay], lf: [a0 - 4, ay + 2], ...arms({ x: a0 + 4, y: ay - HIP, a: 4, f: 1 }) });
    let x = a0 + 4;
    for (let k = 0; x < a1 - 12; k++) {
      x += 20;
      const fy = sagAt(x, x), st = { x, y: fy - HIP, a: k % 2 ? 3 : -3, lf: k % 2 ? [x - 8, fy] : [x + 8, fy], rf: k % 2 ? [x + 8, fy] : [x - 8, fy], ...arms({ x, y: fy - HIP, a: 0, f: 1 }) };
      if (fault && k === 5) { st.lf = [x + 4, G]; st.y = G - 56; }
      o.to(0.45, st, 'lin');
      if (fault && k === 5) { o.mark('Stepping down before the finish line.', 'lf', { kind: 'bad' }); return o.to(0.4, stand(x + 8, 1)); }
    }
    o.to(0.4, { x: line + 14, y: G - 34, a: 14, lf: [line + 7, G], rf: [line + 21, G], lh: [line + 6, G - 64], rh: [line + 30, G - 66] });
    o.mark('Stepping down beyond the finish line.', 'lf');
    return o.to(0.4, stand(line + 16, 1));
  };
  return {
    back: (s, H, P) => {
      const px = s.x, on = s.y < G - 50;
      const mid = on ? sagAt(px, px) : ay;
      return `${ground()}${ln(a0 - 6, ay - 10, a0 - 6, G, 'pr prThick')}${ln(a1 + 6, ay - 10, a1 + 6, G, 'pr prThick')}${pl([[a0 - 6, ay], [px, mid], [a1 + 6, ay]], 'pr prThin')}${ln(line, G, line, G + 6, 'prLine')}`;
    },
    good: run(), fails: [run('ground')],
  };
}

// ================================================================================================ aim and memory
function spear() {
  const BAR = 70, TX = BAR + 390, TY = G - 58, LEN = 100, REL = [BAR + 6, G - 100], HIT = [TX - 10, TY], T = 0.78;
  // the launch velocity that carries the spear's tip from the hand to the target in T seconds under gravity
  const tip0 = [REL[0] + LEN * 0.55, REL[1] - 4], V = [(HIT[0] - tip0[0]) / T, (HIT[1] - tip0[1] - (GRAV * T * T) / 2) / T];
  const flight = (k) => { const tt = k * T; return { tip: [tip0[0] + V[0] * tt, tip0[1] + V[1] * tt + (GRAV * tt * tt) / 2], ang: Math.atan2(V[1] + GRAV * tt, V[0]) }; };
  const carry = (s) => ({ rh: [s.x + 12, G - 92], lh: [s.x + 30, G - 88] });
  const run = (fault) => {
    const o = timeline({ ...stand(20), fl: 0, droop: 0, cam: [250, 128, 0.7], ...carry({ x: 20 }) });
    walk(o, BAR - 34, { hands: carry });
    // wind up: the throwing arm back, the other pointing at the target
    o.to(0.5, { x: BAR - 30, a: -14, rh: [BAR - 66, G - 92], lh: [BAR - 4, G - 96], lf: [BAR - 48, G], rf: [BAR - 14, G] });
    const fwd = fault === 'foot' ? [BAR + 12, G] : [BAR - 6, G];
    o.to(0.2, { x: BAR - 14, a: 20, rh: REL, lh: [BAR - 50, G - 70], rf: fwd, lf: [BAR - 44, G - 6] });
    if (fault === 'foot') o.mark('A foot over the barrier.', 'rf', { kind: 'bad', hl: ['barrier'] });
    o.to(T, { fl: 1, rh: [BAR + 4, G - 64], a: 26 }, 'lin');
    if (fault === 'falls') {
      o.hold(0.3).to(0.6, { droop: 1 }, { g: { droop: 1 } });
      o.mark('A miss, or the spear falling out or touching the ground.', [HIT[0] - 40, G - 6], { kind: 'bad', hl: ['spear'] });
      return o.to(0.4, stand(BAR - 18, 1));
    }
    o.mark('The spear sticks in the target and stays there, not touching the ground.', HIT);
    o.to(0.4, stand(BAR - 14, 1)).to(0.3, { f: -1 });
    return walk(o, BAR - 130, {});
  };
  return {
    back: (s, H) => `${ground()}${rc(BAR - 2, G - 10, 5, 10, hl(H.has('barrier'), 'prF prWood'))}${ln(TX + 6, TY + 20, TX + 6, G, 'pr prThick')}${rc(TX - 10, TY - 24, 34, 48, 'prBag', 3)}${ci(TX - 10, TY, 7, 'prRed')}${tx(TX - 22, TY - 30, '7.5 m')}`,
    front: (s, H, P) => {
      let tip, ang;
      if (s.fl <= 0) { const h = P.ra[2]; ang = Math.atan2(-0.08, 1); tip = [h[0] + LEN * 0.55, h[1] - 4]; }
      else ({ tip, ang } = flight(Math.min(1, s.fl)));
      if (s.droop > 0) { ang += s.droop * 1.3; tip = [tip[0] - s.droop * 14, lerpP([0, tip[1]], [0, G - 2], s.droop)[1]]; }
      const tail = [tip[0] - Math.cos(ang) * LEN, tip[1] - Math.sin(ang) * LEN];
      return `${ln(tail[0], tail[1], tip[0], tip[1], hl(H.has('spear'), 'prSpear'))}${ci(tip[0], tip[1], 2, 'prMetal')}`;
    },
    good: run(), fails: [run('foot'), run('falls')],
  };
}

function laser() {
  const TAB = 150, TX = 360, TY = G - 82;
  const aim = (x) => ({ x, y: G - HIP, a: 2, f: 1, lh: [x + 31, G - 82], rh: [x + 32, G - 78], lf: [x - 6, G], rf: [x + 8, G] });
  const run = (fault) => {
    const o = timeline({ ...stand(40), hits: 0, clock: 0, miss: 0 });
    const x = fault === 'out' ? TAB + 34 : TAB - 36;
    walk(o, x, {});
    o.to(0.4, aim(x));
    if (fault === 'out') o.mark('Shooting from outside the shooting area, or at another target.', 'rf', { kind: 'bad', hl: ['area'] });
    o.to(0.5, { hits: 1, clock: 0 }).to(0.01, {});
    o.to(1.2, { hits: 2, clock: 7 }, 'lin');
    if (fault === 'few') {
      o.to(1.4, { miss: 1, clock: 14 }, 'lin').to(1.2, { clock: 20 }, 'lin');
      o.mark('Fewer than 3 hits on the black centre in the 20 seconds.', [TX, TY], { kind: 'bad', hl: ['target'] });
      return o.to(0.5, stand(x, 1));
    }
    o.to(1.2, { hits: 3, clock: 12 }, 'lin');
    o.mark('3 hits on the black centre within 20 seconds (the time starts at the first hit).', [TX, TY]);
    return o.to(0.5, stand(x, 1));
  };
  const spots = [[-2, -1], [2, 2], [-1, 3]];
  return {
    back: (s, H) => `${ground()}${rc(TAB - 54, G - 2, 54, 2, hl(H.has('area'), 'prRed'))}${rc(TAB, G - 46, 30, 4, 'prF prWood')}${ln(TAB + 4, G - 42, TAB + 4, G, 'pr')}${ln(TAB + 26, G - 42, TAB + 26, G, 'pr')}
      ${ln(TX, TY + 18, TX, G, 'pr prThick')}${ci(TX, TY, 18, hl(H.has('target'), 'prF'))}${ci(TX, TY, 7, 'prBlack')}
      ${spots.slice(0, Math.floor(s.hits)).map(([dx, dy]) => ci(TX + dx, TY + dy, 1.8, 'prHit')).join('')}${s.miss >= 1 ? ci(TX + 12, TY - 9, 1.8, 'prHit') : ''}
      ${s.hits >= 1 ? tx(TX - 24, TY - 26, `${Math.floor(s.clock)} s`) : ''}`,
    front: (s, H, P) => rc(P.ra[2][0] - 2, P.ra[2][1] - 6, 9, 5, 'prMetal', 1),
    good: run(), fails: [run('few'), run('out')],
  };
}

function memory() {
  const BX = 120, OX = 320;
  const run = (fault) => {
    const o = timeline({ ...stand(20), think: 0, say: 0 });
    walk(o, BX - 30, {});
    o.to(0.3, { think: 1 });
    if (fault) {
      o.to(0.5, (s) => { const sh = shoulder(s); return { lh: [sh[0] + 12, sh[1] + 20], rh: [sh[0] + 16, sh[1] + 14] }; });
      o.mark('Writing it down.', 'rh', { kind: 'bad', body: true });
      o.to(0.4, { think: 0, ...stand(BX - 30, 1) });
      return walk(o, OX - 30, {});
    }
    o.hold(0.8).to(0.3, { think: 0 });
    walk(o, OX - 30, {});
    o.to(0.3, { say: 1 }).hold(0.4);
    o.mark('Said back exactly.', 'head');
    return o.hold(0.6);
  };
  return {
    back: (s) => `${ground()}${ln(BX - 26, G - 70, BX - 26, G, 'pr')}${ln(BX + 26, G - 70, BX + 26, G, 'pr')}${rc(BX - 32, G - 124, 64, 56, 'prF')}
      ${tx(BX - 26, G - 110, '16 DELTA 482')}${tx(BX - 26, G - 96, '17 GOLF 735')}${tx(BX - 26, G - 82, '18 ECHO 961')}
      ${figure(solve({ x: OX, y: G - HIP, a: 2, f: -1, lf: [OX + 4, G], rf: [OX - 5, G], lh: [OX + 4, G - 40], rh: [OX - 8, G - 60] }), 'fOfficial')}
      ${s.think ? `${rc(s.x - 10, G - 140, 70, 18, 'prBubble', 9)}${tx(s.x - 4, G - 128, '17 GOLF 735')}` : ''}${s.say ? `${rc(s.x - 10, G - 140, 70, 18, 'prBubble', 9)}${tx(s.x - 4, G - 128, 'GOLF 735')}` : ''}`,
    good: run(), fails: [run('write')],
  };
}

// ================================================================================================ movements for the lessons
/** the burpee standard (rule 3.17.4): chest to the ground, back up with hips and knees extended, then a jump with the hands above the ears */
function burpee() {
  const X = 196;
  const plank = { x: X - 8, y: G - 20, a: 70, lh: [X + 18, G], rh: [X + 21, G], lf: [X - 44, G], rf: [X - 40, G], kp: [0, 1] };
  const run = (fault) => {
    const o = timeline({ ...stand(X - 6), cam: [X - 6, 150, 1.4] });
    o.to(0.3, { x: X - 4, y: G - 25, a: 55, lh: [X + 18, G], rh: [X + 21, G], lf: [X - 10, G], rf: [X - 2, G] });
    o.to(0.28, plank);
    if (fault === 'chest') { o.to(0.32, { y: G - 15, a: 78, ep: [-0.4, -1] }); o.mark('Chest not touching the ground.', [X + 12, G - 4], { kind: 'bad', body: true }); }
    else { o.to(0.32, { y: G - 8, a: 88, ep: [-0.4, -1] }); o.mark('Chest to the ground at the bottom.', [X + 12, G - 4]); }
    o.to(0.3, { ...plank, ep: undefined });
    o.to(0.16, { x: X - 6, y: G - 36, a: 122 });
    o.to(0.28, { x: X - 2, y: G - 34, a: 45, lf: [X + 2, G], rf: [X + 9, G], lh: [X + 14, G - 40], rh: [X + 16, G - 38], kp: undefined });
    if (fault === 'hips') { o.to(0.3, { x: X + 4, y: G - 36, a: 30, lh: [X + 14, G - 30], rh: [X + 18, G - 28], lf: [X - 2, G], rf: [X + 8, G] }); o.mark('Hips not extended at the top.', 'hip', { kind: 'bad', body: true }); }
    else { o.to(0.3, { ...stand(X + 4), a: 0 }); o.mark('Hips and knees fully extended at the top.', 'hip'); }
    const top = G - HIP - 18, sh = top - 29;
    const hands = fault === 'hands' ? { lh: [X + 2, sh + 22], rh: [X + 9, sh + 20] } : { lh: [X + 1, sh - 31], rh: [X + 8, sh - 31] };
    fly(o, { x: X + 4, y: top, a: 0, ...hands, lf: [X + 2, G - 18], rf: [X + 9, G - 16] }, 18);
    if (fault === 'hands') o.mark('Hands not above the ears on the jump.', 'rh', { kind: 'bad', body: true });
    else o.mark('A jump with the hands above the ears.', 'rh');
    fly(o, { ...stand(X + 4), y: G - HIP + 2, lh: [X - 1, G - 70], rh: [X + 9, G - 72] });
    return o.to(0.4, stand(X + 4));
  };
  return {
    back: () => `${ground()}${rc(X - 70, G - 2, 130, 2, 'prF')}${tx(X - 66, G + 12, t('Burpee zone'))}`,
    good: run(), fails: [run('chest'), run('hips'), run('hands')],
  };
}
/** the scenes that aren't an obstacle (the obstacles page leaves them out) */
export const MOVEMENTS = ['burpee'];

export const SCENES = {
  burpee,
  walls, inverted, slip, stairway, bender, rope, cargoplus, cargo, hurdles, out,
  monkey: rig('monkey'), ape, multirig: rig('rings'), twister: rig('twister'), hydra: rig('hydra'), helix: wallTraverse('helix'),
  olympus: wallTraverse('olympus'), zwall: wallTraverse('zwall'), hanging: wallTraverse('hanging'), tilting: rig('tilting'), tyrolean,
  hoist, atlas: carry('atlas'), tireflip, mitm: rig('mitm'), sandbag: carry('sandbag'), bucket: carry('bucket'), log: carry('log'), chain: carry('chain'), armer: carry('armer'), drag,
  crawl, fire, swim, balance, slackline,
  spear, laser, memory,
};
