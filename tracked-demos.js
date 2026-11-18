// What the AI judge can track, shown as looping animations: an athlete with the judge's tracking drawn over them, and each rule
// lighting up at the moment it's checked. The names and rules come from exercises.js, the same list the judge itself uses.
import { EXERCISES } from './exercises.js';

// Poses are in a 100 by 100 picture, with the ground at y = 90. s shoulder, e elbow, w wrist, h hip, k knee, a ankle, t toe.
const side = (head, s, e, w, h, k, a, t) => ({ head, arm: [s, e, w], torso: [s, h], leg: [h, k, a, t] });
const front = (head, sL, eL, wL, sR, eR, wR, hL, kL, aL, hR, kR, aR) => ({ head, arms: [[sL, eL, wL], [sR, eR, wR]], torso: [sL, sR, hR, hL], legs: [[hL, kL, aL], [hR, kR, aR]] });

const STAND = side([50, 20], [50, 30], [50, 43], [53, 55], [50, 54], [51, 71], [50, 87], [57, 89]);
const CROUCH = side([64, 44], [58, 50], [66, 66], [70, 87], [43, 62], [57, 67], [49, 87], [56, 89]);
const PLANK = side([79, 58], [72, 63], [73, 75], [73, 87], [46, 70], [31, 78], [16, 86], [19, 89]);
const CHEST_DOWN = side([80, 78], [72, 83], [80, 75], [74, 87], [46, 83], [31, 85], [16, 86], [19, 89]);
const JUMP = side([50, 13], [50, 23], [57, 13], [52, 3], [50, 46], [50, 62], [50, 76], [56, 79]);
const SQUAT_LOW = side([60, 37], [53, 45], [65, 49], [76, 47], [37, 66], [55, 65], [49, 87], [56, 89]);
const SQUAT_ARMS = side([50, 20], [50, 30], [58, 38], [69, 39], [50, 54], [51, 71], [50, 87], [57, 89]);
const PUSH_DOWN = side([81, 71], [73, 76], [63, 72], [73, 87], [46, 79], [31, 83], [16, 86], [19, 89]);
const LIE = side([18, 80], [26, 83], [34, 79], [28, 71], [50, 84], [64, 68], [73, 87], [80, 89]);
const SIT = side([42, 40], [44, 50], [53, 58], [62, 58], [50, 84], [64, 68], [73, 87], [80, 89]);
const JACK_IN = front([50, 20], [45, 31], [43, 44], [43, 56], [55, 31], [57, 44], [57, 56], [47, 54], [47, 71], [47, 87], [53, 54], [53, 71], [53, 87]);
const JACK_OUT = front([50, 16], [45, 27], [35, 18], [41, 5], [55, 27], [65, 18], [59, 5], [47, 50], [36, 65], [27, 84], [53, 50], [64, 65], [73, 84]);

// Each step: the pose to reach, how long getting there takes, how long it holds, and which of the exercise's rules it shows.
const MOVES = {
  burpees: [
    { pose: STAND, move: 0.2, hold: 0.25 },
    { pose: CROUCH, move: 0.35, hold: 0.02 },
    { pose: PLANK, move: 0.28, hold: 0.04 },
    { pose: CHEST_DOWN, move: 0.28, hold: 0.45, rule: 0 },
    { pose: PLANK, move: 0.28, hold: 0.04 },
    { pose: CROUCH, move: 0.28, hold: 0.02 },
    { pose: STAND, move: 0.22, hold: 0.0 },
    { pose: JUMP, move: 0.22, hold: 0.45, rule: [1, 2, 3] },
  ],
  squats: [
    { pose: STAND, move: 0.35, hold: 0.35, rule: 1 },
    { pose: SQUAT_ARMS, move: 0.15, hold: 0.0 },
    { pose: SQUAT_LOW, move: 0.45, hold: 0.45, rule: 0 },
    { pose: SQUAT_ARMS, move: 0.4, hold: 0.0 },
  ],
  pushups: [
    { pose: PLANK, move: 0.4, hold: 0.45, rule: [1, 2] },
    { pose: PUSH_DOWN, move: 0.55, hold: 0.45, rule: [0, 2] },
  ],
  jacks: [
    { pose: JACK_IN, move: 0.28, hold: 0.32, rule: 2 },
    { pose: JACK_OUT, move: 0.28, hold: 0.42, rule: [0, 1] },
  ],
  situps: [
    { pose: LIE, move: 0.6, hold: 0.45, rule: 0 },
    { pose: SIT, move: 0.65, hold: 0.45, rule: 1 },
  ],
};

const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) ** 2);
const mix = (a, b, k) => {
  if (typeof a[0] === 'number') return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  return a.map((x, i) => mix(x, b[i], k));
};
const mixPose = (a, b, k) => Object.fromEntries(Object.keys(a).map((key) => [key, mix(a[key], b[key], k)]));

/** Where an exercise's loop is at a moment: the pose, and the rules lit. Only exported so it can be tested. */
export function poseAt(steps, seconds) {
  const total = steps.reduce((n, s) => n + s.move + s.hold, 0);
  let t = seconds % total;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i], before = steps[(i + steps.length - 1) % steps.length];
    if (t < step.move) return { pose: mixPose(before.pose, step.pose, ease(t / step.move)), rules: [] };
    t -= step.move;
    if (t < step.hold) return { pose: step.pose, rules: [].concat(step.rule ?? []) };
    t -= step.hold;
  }
  return { pose: steps[0].pose, rules: [] };
}

function drawFrame(ctx, size, pose, colours, hit) {
  const u = size / 100, X = (p) => p[0] * u, Y = (p) => p[1] * u;
  ctx.clearRect(0, 0, size, size);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const line = (points, width, colour) => {
    ctx.beginPath(); ctx.strokeStyle = colour; ctx.lineWidth = width * u;
    points.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p))));
    ctx.stroke();
  };
  const dots = (points, colour) => {
    ctx.fillStyle = colour;
    for (const p of points) { ctx.beginPath(); ctx.arc(X(p), Y(p), 1.25 * u, 0, Math.PI * 2); ctx.fill(); }
  };
  // the floor
  line([[6, 90.5], [94, 90.5]], 0.7, colours.line);
  const arms = pose.arms ?? [pose.arm], legs = pose.legs ?? [pose.leg], torso = pose.torso;
  // the athlete
  for (const limb of legs) line(limb, 6, colours.body);
  if (pose.torso.length === 2) line(torso, 9, colours.top);
  else { ctx.beginPath(); ctx.fillStyle = colours.top; ctx.strokeStyle = colours.top; ctx.lineWidth = 3 * u; torso.forEach((p, i) => (i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p)))); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  for (const limb of arms) line(limb, 4.2, colours.body);
  ctx.beginPath(); ctx.fillStyle = colours.body; ctx.arc(X(pose.head), Y(pose.head), 5.2 * u, 0, Math.PI * 2); ctx.fill();
  // what the judge sees, drawn over them
  const track = hit ? colours.hit : colours.track;
  for (const limb of legs) line(limb, 1, track);
  if (torso.length === 2) line(torso, 1, track); else line([...torso, torso[0]], 1, track);
  for (const limb of arms) line(limb, 1, track);
  dots([...legs.flat(), ...arms.flat(), ...torso], colours.dot);
}

function card(key, steps) {
  const x = EXERCISES[key], el = document.createElement('article');
  el.className = 'trackCard';
  el.innerHTML = '<canvas width="180" height="180" aria-hidden="true"></canvas><div><h3></h3><ul></ul></div>';
  el.querySelector('canvas').setAttribute('role', 'presentation');
  el.querySelector('h3').textContent = x.label;
  const list = el.querySelector('ul'), rules = x.standards.map(([name, about]) => {
    const li = document.createElement('li'); li.textContent = name; li.title = about; list.append(li); return li;
  });
  return { el, steps, rules, ctx: el.querySelector('canvas').getContext('2d') };
}

/** Fills holder with one animated card per exercise. Animates only what's on screen, and holds still for anyone who prefers that. */
export function drawTracked(holder) {
  const cards = Object.keys(MOVES).map((key) => card(key, MOVES[key]));
  holder.replaceChildren(...cards.map((c) => c.el));
  const css = getComputedStyle(holder), read = (name) => css.getPropertyValue(name).trim();
  const colours = () => ({ line: read('--line'), body: read('--muted'), top: read('--primary'), track: read('--accent'), hit: read('--accent'), dot: read('--text') });
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const seen = new Set();
  const paint = (c, seconds, shades) => {
    const { pose, rules } = poseAt(c.steps, seconds);
    drawFrame(c.ctx, 180, pose, shades, rules.length > 0);
    c.rules.forEach((li, i) => li.classList.toggle('lit', rules.includes(i)));
  };
  if (still) { const shades = colours(); for (const c of cards) paint(c, 0.3, shades); return; }
  const watcher = new IntersectionObserver((entries) => {
    for (const e of entries) { const c = cards.find((x) => x.el === e.target); if (e.isIntersecting) seen.add(c); else seen.delete(c); }
  });
  for (const c of cards) watcher.observe(c.el);
  let shades = colours(), checked = 0;
  const frame = (ms) => {
    if (ms - checked > 2000) { shades = colours(); checked = ms; } // the company's colours can arrive after the page does
    for (const c of seen) paint(c, ms / 1000, shades);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

export const TRACKED = Object.keys(MOVES);
export const MOVES_FOR_TEST = MOVES;
// for the learning platform's video judgement items (learn/judgement.js): the poses and the drawing, to show a burpee done wrong
export const POSES = { STAND, CROUCH, PLANK, CHEST_DOWN, JUMP };
export { drawFrame };
