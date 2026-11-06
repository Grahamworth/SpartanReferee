// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BurpeeJudge, computeMetrics, REASONS, LM, DEFAULTS } from '../burpee.js';

const FPS = 30;
const stand = { tilt: 5, chestRatio: 0.95, hipAngle: 176, handYL: 0.5, handYR: 0.5, earY: 0.15, footY: 0.9, noseY: 0.12, wristsBelowHips: false };

// Builds the metric frames for one burpee, with optional faults.
function burpee({ chest = 0.15, lift = 0.04, handY = 0.1, hip = 176, airFrames = 5 } = {}) {
  const f = [];
  for (let i = 0; i < 6; i++) f.push({ ...stand, tilt: 20 + i * 8, hipAngle: 120 });           // squat down
  for (let i = 0; i < 6; i++) f.push({ ...stand, tilt: 85, wristsBelowHips: true, hipAngle: 172, chestRatio: 0.9, footY: null }); // plank
  for (let i = 0; i < 6; i++) f.push({ ...stand, tilt: 88, wristsBelowHips: true, hipAngle: 172, chestRatio: chest, footY: null }); // chest down
  for (let i = 0; i < 6; i++) f.push({ ...stand, tilt: 85, wristsBelowHips: true, hipAngle: 172, chestRatio: 0.9, footY: null }); // push up
  for (let i = 0; i < 6; i++) f.push({ ...stand, tilt: 50 - i * 8, hipAngle: 120 });            // feet in, rise
  for (let i = 0; i < 4; i++) f.push({ ...stand, hipAngle: 115 });                               // planted, about to jump
  for (let i = 0; i < airFrames; i++) f.push({ ...stand, footY: 0.9 - lift * 0.78, handYL: handY, handYR: handY, hipAngle: hip });
  for (let i = 0; i < 4; i++) f.push({ ...stand, hipAngle: 115, handYL: 0.4, handYR: 0.4 });     // land, absorbing
  for (let i = 0; i < 6; i++) f.push({ ...stand });                                               // stand
  return f;
}

// events: outcomes only. details: the measurements recorded with each event.
function run(frames, opts) {
  const j = new BurpeeJudge(opts);
  const events = [], details = [];
  const keep = (e) => {
    if (!e) return;
    const { detail, ...rest } = e;
    events.push(rest);
    details.push(detail);
  };
  let t = 0;
  for (const fr of [...Array(10).fill(stand), ...frames]) {
    keep(j.update(fr, t));
    t += 1000 / FPS;
  }
  keep(j.finish());
  return { j, events, details };
}

test('a full burpee counts as one rep', () => {
  const { j, events } = run(burpee());
  assert.equal(j.count, 1);
  assert.deepEqual(events, [{ type: 'rep', count: 1, done: false }]);
});

// One burpee with parts outside the picture, as computeMetrics reports them.
function offBurpee({ hands = false, feet = false, knees = false, chest = false, handY = null } = {}) {
  return burpee().map((f) => {
    const g = { ...f, torsoLen: 0.27 };
    if (hands) Object.assign(g, { handYL: handY, handYR: handY, handsOff: handY == null });
    if (feet) Object.assign(g, { toeY: null, heelY: null, feetOff: true });
    if (knees) Object.assign(g, { hipAngle: null, kneesOff: true });
    if (chest && f.tilt >= DEFAULTS.upExitTilt) Object.assign(g, { chestRatio: null, armsOff: true });
    return g;
  });
}
const repsOf = (frames) => { const j = new BurpeeJudge(); const ev = frames.map((f, i) => j.update(f, i * (1000 / FPS))).filter(Boolean); return { j, ev }; };

test('hands above the picture count as good, and the rep is marked', () => {
  const { j, ev } = repsOf(offBurpee({ hands: true }));
  assert.equal(j.count, 1); assert.equal(j.questionable, 1);
  assert.deepEqual(ev.at(-1).assumed, ['hands']);
  assert.deepEqual(ev.at(-1).detail.assumed, ['hands']);
});

test('knees outside the picture count as good, and the rep is marked', () => {
  const { j, ev } = repsOf(offBurpee({ knees: true }));
  assert.equal(j.count, 1); assert.ok(ev.at(-1).assumed.includes('hips'));
});

test('arms outside the picture at the bottom count as good, and the rep is marked', () => {
  const { j, ev } = repsOf(offBurpee({ chest: true }));
  assert.equal(j.count, 1); assert.deepEqual(ev.at(-1).assumed, ['chest']);
});

test('feet outside the picture count as good when the jump can\'t be measured, and the rep is marked', () => {
  const { j, ev } = repsOf(offBurpee({ feet: true }));
  assert.equal(j.count, 1); assert.ok(ev.at(-1).assumed.includes('feet'));
});

test('arms seen only partway down, then outside the picture, count as good, and the rep is marked', () => {
  const { j, ev } = repsOf(burpee().map((f) => (f.chestRatio === 0.15 ? { ...f, chestRatio: null, armsOff: true } : f)));
  assert.equal(j.count, 1); assert.deepEqual(ev.at(-1).assumed, ['chest']);
});

test('a rep with everything in the picture isn\'t marked', () => {
  const { j, ev } = repsOf(burpee());
  assert.equal(j.count, 1); assert.equal(j.questionable, 0); assert.equal(ev.at(-1).assumed, undefined); assert.deepEqual(ev.at(-1).detail.assumed, []);
});

test('with the chest seen too high and nothing outside the picture, it still fails', () => {
  const { j } = repsOf(burpee({ chest: 0.9 }));
  assert.equal(j.count, 0); assert.equal(j.reasonCounts[REASONS.chest], 1);
});

test('hands seen below the line still fail, off screen or not', () => {
  const { j } = repsOf(offBurpee({ hands: true, handY: 0.6 }));
  assert.equal(j.count, 0); assert.equal(j.questionable, 0);
});

test('hands hidden inside the picture still don\'t count', () => {
  const { j } = repsOf(burpee().map((f) => ({ ...f, handYL: null, handYR: null })));
  assert.equal(j.count, 0);
});

test('a chest never seen, and not outside the picture, is still unseen', () => {
  const { j } = repsOf(burpee().map((f) => (f.tilt >= DEFAULTS.upExitTilt ? { ...f, chestRatio: null } : f)));
  assert.equal(j.count, 0); assert.equal(j.questionable, 0);
});

test('computeMetrics only leaves out points outside the picture when asked', () => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
  const wlm = lm.map((p) => ({ ...p }));
  lm[LM.L_SH] = { ...lm[LM.L_SH], y: 0.3 }; lm[LM.R_SH] = { ...lm[LM.R_SH], y: 0.3 };
  wlm[LM.L_SH] = { ...wlm[LM.L_SH], y: -0.3 }; wlm[LM.R_SH] = { ...wlm[LM.R_SH], y: -0.3 };
  for (const i of [LM.L_WR, LM.L_INDEX, LM.L_PINKY, LM.R_WR, LM.R_INDEX, LM.R_PINKY]) lm[i] = { ...lm[i], y: -0.1 };
  const on = computeMetrics(lm, wlm, { ...DEFAULTS, offScreen: true }), off = computeMetrics(lm, wlm, DEFAULTS);
  assert.equal(on.handYL, null); assert.equal(on.handsOff, true); assert.equal(on.armsOff, true);
  assert.equal(off.handYL, -0.1); assert.equal(off.handsOff, false); assert.equal(off.armsOff, false);
});

test('shallow chest is a no rep, even with a good jump', () => {
  const { j, events } = run(burpee({ chest: 0.55 }));
  assert.equal(j.count, 0);
  assert.deepEqual(events, [{ type: 'norep', reasons: [REASONS.chest] }]);
});

test('no jump is a no rep', () => {
  const { j, events } = run([...burpee({ lift: 0 }), ...burpee()]);
  assert.equal(j.count, 1);
  assert.deepEqual(events[0], { type: 'norep', reasons: [REASONS.jump] });
});

test('a jump seen in only one frame counts up to Strict, not at Very strict', () => {
  // A quick hop may only show in one frame; Very strict wants two in a row.
  const at = (v) => run(burpee({ airFrames: 1 }), applyStrictness(new BurpeeJudge(), 'burpees', v).o).j.count;
  assert.equal(at(50), 1);
  assert.equal(at(75), 1);
  assert.equal(at(100), 0);
});

test('hands below ears is a no rep', () => {
  const { events } = run(burpee({ handY: 0.3 }));
  assert.deepEqual(events, [{ type: 'norep', reasons: [REASONS.hands] }]);
});

test('bent hips at the top is a no rep', () => {
  const { events } = run(burpee({ hip: 110 }));
  assert.deepEqual(events, [{ type: 'norep', reasons: [REASONS.hips] }]);
});

test('several faults are all reported', () => {
  const { events } = run(burpee({ hip: 110, handY: 0.3 }));
  assert.deepEqual(events, [{ type: 'norep', reasons: [REASONS.hands, REASONS.hips] }]);
});

test('each event records what was measured', () => {
  const { details } = run([...burpee(), ...burpee({ chest: 0.55 }), ...burpee({ handY: 0.3 })]);
  const [good, chest, hands] = details;
  assert.equal(good.chestMin, 0.15);
  assert.ok(good.chestFrames > 0);
  assert.ok(good.maxLift > 0.025, `lift ${good.maxLift}`);
  assert.ok(good.airFrames >= 1); // decided as soon as the jump is confirmed
  assert.ok(good.maxHipAngle >= 170);
  assert.ok(good.maxHandMargin > 0);
  assert.deepEqual([good.jump, good.hands, good.hips], [true, true, true]);
  assert.ok(good.downAt < good.upAt && good.upAt <= good.endAt);
  // A chest no-rep is decided before the jump, so there are no jump measurements.
  assert.equal(chest.chestMin, 0.55);
  assert.equal(chest.jump, null);
  assert.ok(hands.maxHandMargin < 0);
  assert.equal(hands.hands, false);
});

test('jumping around without going to the ground counts nothing', () => {
  const jumps = [];
  for (let k = 0; k < 5; k++) jumps.push(...burpee().slice(30));
  const { j } = run(jumps);
  assert.equal(j.count, 0);
});

test('30 good reps finishes the set and stops counting', () => {
  const frames = [];
  for (let k = 0; k < 32; k++) frames.push(...burpee());
  const { j, events } = run(frames);
  assert.equal(j.count, 30);
  assert.equal(j.done, true);
  assert.deepEqual(events.at(-1), { type: 'rep', count: 30, done: true });
});

test('mixed set: only valid reps count', () => {
  const frames = [];
  for (let k = 0; k < 10; k++) frames.push(...burpee(), ...burpee({ chest: 0.6 }));
  const { j } = run(frames);
  assert.equal(j.count, 10);
  assert.equal(j.noReps, 10);
});

// Geometry check for computeMetrics with hand-built skeletons.
function skeleton(points) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  const wlm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  for (const [id, [x, y, z = 0]] of Object.entries(points)) {
    wlm[id] = { x, y, z };
    lm[id] = { x: 0.5 + x / 2, y: 0.5 + y / 2, z, visibility: 1 };
  }
  return { lm, wlm };
}

test('computeMetrics: standing tall', () => {
  const P = {};
  P[LM.NOSE] = [0, -0.65]; P[LM.L_EAR] = [-0.07, -0.62]; P[LM.R_EAR] = [0.07, -0.62];
  P[LM.L_SH] = [-0.18, -0.5]; P[LM.R_SH] = [0.18, -0.5];
  P[LM.L_EL] = [-0.2, -0.22]; P[LM.R_EL] = [0.2, -0.22];
  P[LM.L_WR] = [-0.2, 0.05]; P[LM.R_WR] = [0.2, 0.05];
  P[LM.L_HIP] = [-0.1, 0]; P[LM.R_HIP] = [0.1, 0];
  P[LM.L_KNEE] = [-0.1, 0.45]; P[LM.R_KNEE] = [0.1, 0.45];
  for (const id of [LM.L_ANK, LM.L_HEEL, LM.L_FOOT]) P[id] = [-0.1, 0.9];
  for (const id of [LM.R_ANK, LM.R_HEEL, LM.R_FOOT]) P[id] = [0.1, 0.9];
  const m = computeMetrics(...Object.values(skeleton(P)));
  assert.ok(m.tilt < 1, `tilt ${m.tilt}`);
  assert.ok(m.hipAngle > 175, `hip ${m.hipAngle}`);
  assert.ok(m.fullBody);
  assert.equal(m.wristsBelowHips, true);
  assert.ok(m.kneeAngle > 175, `knee ${m.kneeAngle}`);
  assert.ok(m.elbowAngle > 170, `elbow ${m.elbowAngle}`);
  assert.ok(m.hipDrop < -0.9, `hip drop ${m.hipDrop}`);
  assert.ok(Math.abs(m.feetSpread - 0.2 / 0.36) < 0.01, `spread ${m.feetSpread}`);
  assert.ok(m.headTopY < m.noseY, 'head top above nose');
});

test('computeMetrics: plank top vs chest on the ground', () => {
  // Side-on: body along x, floor at y = 0.6 (y down).
  const base = (shoulderY, elbow) => {
    const P = {};
    P[LM.L_SH] = [-0.5, shoulderY, -0.15]; P[LM.R_SH] = [-0.5, shoulderY, 0.15];
    P[LM.L_EL] = elbow(-0.15); P[LM.R_EL] = elbow(0.15);
    P[LM.L_WR] = [-0.5, 0.58, -0.15]; P[LM.R_WR] = [-0.5, 0.58, 0.15];
    P[LM.L_HIP] = [0, (shoulderY + 0.4) / 2, -0.1]; P[LM.R_HIP] = [0, (shoulderY + 0.4) / 2, 0.1];
    P[LM.L_KNEE] = [0.45, 0.5, -0.1]; P[LM.R_KNEE] = [0.45, 0.5, 0.1];
    return P;
  };
  const top = computeMetrics(...Object.values(skeleton(base(0.03, (z) => [-0.5, 0.3, z]))));
  const bottom = computeMetrics(...Object.values(skeleton(base(0.48, (z) => [-0.35, 0.33, z * 1.6]))));
  assert.ok(top.tilt > 60 && bottom.tilt > 60, `tilts ${top.tilt} ${bottom.tilt}`);
  assert.ok(top.chestRatio > 0.8, `top ratio ${top.chestRatio}`);
  assert.ok(bottom.chestRatio < 0.35, `bottom ratio ${bottom.chestRatio}`);
});

import { GestureJudge, PRACTICE_REASON } from '../burpee.js';

function gestures(seq, opts) {
  const j = new GestureJudge(opts);
  const events = [];
  let t = 0;
  for (const [g, n] of seq) for (let i = 0; i < n; i++) { const e = j.update(g, (t += 33)); if (e) events.push(e.type); }
  return { j, events };
}

test('practice: fist then open hand is one rep', () => {
  const { j, events } = gestures([['None', 5], ['Closed_Fist', 5], ['Open_Palm', 5]], { targetReps: 3 });
  assert.equal(j.count, 1);
  assert.deepEqual(events, ['rep']);
});

test('practice: open hand without a fist first counts nothing, flicker is ignored', () => {
  const { j } = gestures([['Open_Palm', 6], ['Closed_Fist', 2], ['Open_Palm', 6]], { targetReps: 3 });
  assert.equal(j.count, 0);
});

test('practice: thumbs down is a no rep, and the target finishes the set', () => {
  const seq = [['Thumb_Down', 4], ['None', 2]];
  for (let k = 0; k < 3; k++) seq.push(['Closed_Fist', 4], ['Open_Palm', 4]);
  const { j, events } = gestures(seq, { targetReps: 2 });
  assert.equal(j.noReps, 1);
  assert.equal(j.count, 2);
  assert.equal(j.done, true);
  assert.deepEqual(events, ['norep', 'rep', 'rep']);
  assert.ok(PRACTICE_REASON);
});

// Up on the toes vs a real jump, with toes and heels given separately.
// Body height 0.78 (feet 0.9, ears 0.12); heels on the ground at 0.88.
import { EXERCISES, applyStrictness } from '../exercises.js';
function feetBurpee({ toeLift = 0, heelLift = 0, toesSeen = true }) {
  const f = burpee({ lift: 0 });
  const start = f.length - 10 - 5; // burpee() ends: 5 airborne, 4 landing, 6 standing
  return f.map((m, i) => {
    if (m.footY == null) return { ...m, toeY: null, heelY: null };
    const inAir = i >= start && i < start + 5;
    const toeY = toesSeen ? 0.9 - (inAir ? toeLift * 0.78 : 0) : null;
    const heelY = 0.88 - (inAir ? heelLift * 0.78 : 0);
    return { ...m, footY: Math.max(toeY ?? 0, heelY), toeY, heelY };
  });
}
const burpeeAt = (frames, v) => {
  const j = applyStrictness(EXERCISES.burpees.make(5, { ...DEFAULTS }), 'burpees', v);
  let t = 0, reps = 0, reasons = [];
  for (const m of frames) { const e = j.update(m, (t += 33)); if (e?.type === 'rep') reps++; if (e?.type === 'norep') reasons.push(...e.reasons); }
  const e = j.finish(); if (e) reasons.push(...e.reasons);
  return { reps, reasons };
};

test('burpee: going up on the toes is not a jump, even at the least strict setting', () => {
  for (const v of [0, 50, 100]) {
    // Toes seen: heels rise 6 cm, toes stay down.
    assert.equal(burpeeAt(feetBurpee({ heelLift: 0.035 }), v).reps, 0, `toes seen at ${v}`);
    // Toes not seen: only the heels rise, by tiptoe height.
    assert.equal(burpeeAt(feetBurpee({ heelLift: 0.035, toesSeen: false }), v).reps, 0, `toes hidden at ${v}`);
  }
});

test('burpee: a real jump counts, whether or not the toes are seen', () => {
  assert.equal(burpeeAt(feetBurpee({ toeLift: 0.05, heelLift: 0.06 }), 50).reps, 1);
  assert.equal(burpeeAt(feetBurpee({ heelLift: 0.09, toesSeen: false }), 50).reps, 1);
  // A small hop (about 3 cm) passes at the least strict end but not the middle.
  assert.equal(burpeeAt(feetBurpee({ toeLift: 0.017, heelLift: 0.02 }), 0).reps, 1);
  assert.equal(burpeeAt(feetBurpee({ toeLift: 0.017, heelLift: 0.02 }), 50).reps, 0);
});

test('burpee: hands a little below the ears pass, well below fail', () => {
  // Ears at 0.15, body height 0.78: 0.1 * 0.78 = about 0.08 allowed below.
  assert.equal(run(burpee({ handY: 0.21 })).events[0].type, 'rep');
  assert.deepEqual(run(burpee({ handY: 0.27 })).events[0].reasons, [REASONS.hands]);
});

// Feet out of shot: the jump is seen from the hips rising above standing height.
// Hips stand at 0.5, torso 0.25 long, so body height is taken as 0.75.
function noFeetBurpee(hipRise) {
  const f = burpee({ lift: 0 });
  const start = f.length - 10 - 5;
  const lead = Array(10).fill({ ...stand, footY: null, toeY: null, heelY: null, hipY: 0.5, torsoLen: 0.25 });
  return [...lead, ...f.map((m, i) => {
    const inAir = i >= start && i < start + 5;
    const crouch = m.hipAngle != null && m.hipAngle < 150; // squatting down or rising
    const hipY = m.tilt > 60 ? 0.7 : crouch ? 0.62 : 0.5 - (inAir ? hipRise : 0);
    return { ...m, footY: null, toeY: null, heelY: null, hipY, torsoLen: 0.25 };
  })];
}
const repsNoFeet = (rise) => {
  const j = new BurpeeJudge();
  let t = 0, reps = 0;
  for (const m of noFeetBurpee(rise)) if (j.update(m, (t += 33))?.type === 'rep') reps++;
  return reps;
};

test('burpee: with the feet out of shot, the whole body rising is a jump', () => {
  assert.equal(repsNoFeet(0.1), 1); // hips up about 23 cm
});

test('burpee: with the feet out of shot, tiptoe or just standing up is not a jump', () => {
  assert.equal(repsNoFeet(0.03), 0); // hips up by tiptoe height
  assert.equal(repsNoFeet(0), 0);    // stands up from the crouch, no jump
});
