// Checks every obstacle animation (learn/obstacle-scenes.js) for movements a person can't make, frame by frame at 30 a second, in
// every good run and every fail:   node scripts/check-motion.mjs [scene ...]
//   knee      a knee bent backwards (side views; seen from behind, knees point outwards and any bend is fine)
//   hip       the thigh further behind the body than a hip extends (45°), or further up than it bends (150°, knee to chest)
//   elbow     an elbow bent backwards by a lot (shoulders turn, so only a clear reversal counts)
//   reach     a hand or foot that doesn't get to where it's put (a grip, a step): the limb stops short
//   ground    a foot or hand below the ground (not in the water)
//   speed     hips faster than a sprinter (10 m/s), or a hand or foot jumping between frames
// Returns the problems as a list (the test uses it) and prints them grouped when run directly.
globalThis.location ??= { protocol: 'file:', hostname: '', port: '', hash: '' }; // the site's modules expect a page
const { sample, solve, G, PX } = await import('../learn/obstacle-anim.js');

const D = 180 / Math.PI;
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const ang = (a, b) => Math.atan2(cross(a, b), a[0] * b[0] + a[1] * b[1]) * D; // signed angle from a to b
const L = { U: 17, F: 17.5, TH: 22, SH: 21.5, ANK: 3.5 };

export function checkTimeline(tl, { water = null } = {}) {
  const out = [], step = 1 / 30;
  let prev = null;
  for (let t = 0; t <= tl.end + 1e-6; t += step) {
    const s = sample(tl, t), P = solve(s);
    if (P.side < 0.5) {
      const up = P.d, down = [-up[0], -up[1]], fwd = [-up[1] * P.f, up[0] * P.f], back = [-fwd[0], -fwd[1]], ref = Math.sign(cross(down, back)) || 1;
      for (const [name, l] of [['left', P.ll], ['right', P.rl]]) {
        const thigh = sub(l[1], l[0]), shin = sub(l[2], l[1]);
        const bend = ang(thigh, shin) * ref; // + is a knee bending the right way
        if (bend < -6) out.push({ t, kind: 'knee', side: name, value: Math.round(-bend) });
        // the hip: the thigh's angle from straight down the body, + forwards: a leg comes up to about 150° (knee to chest) and goes back about 45°
        const h = ang(down, thigh) * -ref;
        if (h < -45 || h > 150) out.push({ t, kind: 'hip', side: name, value: Math.round(Math.abs(h)) });
      }
      for (const [name, a] of [['left', P.la], ['right', P.ra]]) {
        const upper = sub(a[1], a[0]), fore = sub(a[2], a[1]);
        const bend = -ang(upper, fore) * ref; // + is an elbow bending the right way
        if (bend < -25) out.push({ t, kind: 'elbow', side: name, value: Math.round(-bend) });
      }
    }
    // reach: how far each hand and foot falls short of where it was put
    for (const [k, a, n] of [['lh', P.la, L.U + L.F], ['rh', P.ra, L.U + L.F]]) {
      const gap = len(sub(s[k], a[2]));
      if (gap > 3) out.push({ t, kind: 'reach', side: k, value: Math.round(gap) });
    }
    for (const [k, l] of [['lf', P.ll], ['rf', P.rl]]) {
      const gap = len(sub([s[k][0], s[k][1] - L.ANK], l[2]));
      if (gap > 3) out.push({ t, kind: 'reach', side: k, value: Math.round(gap) });
    }
    // the ground
    for (const k of ['lf', 'rf', 'lh', 'rh']) {
      const p = s[k];
      const inWater = water && p[0] > water[0] && p[0] < water[1];
      if (p[1] > G + 1.5 && !inWater) out.push({ t, kind: 'ground', side: k, value: Math.round(p[1] - G) });
    }
    if (prev) {
      const v = len(sub([s.x, s.y], [prev.x, prev.y])) / step;
      if (v > 10 * PX) out.push({ t, kind: 'speed', side: 'hips', value: Math.round(v / PX) });
      for (const k of ['lf', 'rf', 'lh', 'rh']) { const j = len(sub(s[k], prev[k])) / step; if (j > 16 * PX) out.push({ t, kind: 'speed', side: k, value: Math.round(j / PX) }); }
    }
    prev = s;
  }
  return out;
}
/** the problems in a scene's timelines: { timeline, kind, side, from, to, worst } runs of the same problem */
export function checkScene(id, scene) {
  const runs = [];
  const water = { swim: [100, 330], tyrolean: [80, 330] }[id] || null;
  [['good', scene.good], ...scene.fails.map((f, i) => [`fail ${i + 1}`, f])].forEach(([name, tl]) => {
    for (const p of checkTimeline(tl, { water })) {
      const last = runs.find((r) => r.timeline === name && r.kind === p.kind && r.side === p.side && p.t - r.to < 0.07);
      if (last) { last.to = p.t; last.worst = Math.max(last.worst, p.value); } else runs.push({ scene: id, timeline: name, kind: p.kind, side: p.side, from: p.t, to: p.t, worst: p.value });
    }
  });
  return runs;
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const { SCENES } = await import('../learn/obstacle-scenes.js');
  const only = process.argv.slice(2);
  let total = 0;
  for (const [id, make] of Object.entries(SCENES)) {
    if (only.length && !only.includes(id)) continue;
    const runs = checkScene(id, make());
    total += runs.length;
    if (runs.length) console.log(`${id}: ${runs.map((r) => `${r.timeline} ${r.kind} ${r.side} ${r.from.toFixed(2)}–${r.to.toFixed(2)}s (${r.worst}${r.kind === 'reach' || r.kind === 'ground' ? 'px' : r.kind === 'speed' ? 'm/s' : '°'})`).join('; ')}`);
  }
  console.log(`${total} problems`);
}
