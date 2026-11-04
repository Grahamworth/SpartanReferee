// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXERCISES, applyStrictness, SquatJudge, SQUAT_REASONS, PushupJudge, PUSHUP_REASONS, JackJudge, JACK_REASONS, SitupJudge, SITUP_REASONS,
} from '../exercises.js';

// Feeds frames ([metrics, count] pairs) and returns the outcomes.
function run(judge, seq) {
  const events = [];
  let t = 0;
  for (const [m, n] of seq) for (let i = 0; i < n; i++) {
    const e = judge.update(m, (t += 33));
    if (e) events.push(e.type === 'rep' ? 'rep' : e.reasons);
  }
  return events;
}

// ---- squats
const sq = (knee, hip, drop) => ({ kneeAngle: knee, hipAngle: hip, hipDrop: drop });
const STAND = sq(175, 175, -0.9), MID = sq(130, 120, -0.5);
const squat = (bottomDrop) => [[STAND, 4], [MID, 3], [sq(80, 70, bottomDrop), 4], [MID, 3], [STAND, 4]];

test('squats: below parallel and stand up is a rep', () => {
  assert.deepEqual(run(new SquatJudge(), squat(0.1)), ['rep']);
});

test('squats: too shallow is a no rep', () => {
  assert.deepEqual(run(new SquatJudge(), squat(-0.3)), [[SQUAT_REASONS.depth]]);
});

test('squats: not standing up between reps is a no rep', () => {
  const seq = [[STAND, 4], [sq(80, 70, 0.1), 4], [sq(150, 150, -0.6), 4], [sq(80, 70, 0.1), 4], [STAND, 4]];
  assert.deepEqual(run(new SquatJudge(), seq), [[SQUAT_REASONS.stand], 'rep']);
});

test('squats: the target finishes the set', () => {
  const j = new SquatJudge({ targetReps: 3 });
  run(j, [...squat(0.1), ...squat(0.1), ...squat(0.1), ...squat(0.1)]);
  assert.equal(j.count, 3);
  assert.equal(j.done, true);
});

// ---- push-ups
const pu = (elbow, hip = 172, tilt = 80) => ({ elbowAngle: elbow, hipAngle: hip, tilt });
const pushup = (low, hip) => [[pu(170), 4], [pu(110, hip), 3], [pu(low, hip), 4], [pu(120, hip), 3], [pu(170), 4]];

test('push-ups: elbows past 90 and lock out is a rep', () => {
  assert.deepEqual(run(new PushupJudge(), pushup(75)), ['rep']);
});

test('push-ups: shallow, or hips piked, is a no rep', () => {
  assert.deepEqual(run(new PushupJudge(), pushup(105)), [[PUSHUP_REASONS.depth]]);
  assert.deepEqual(run(new PushupJudge(), pushup(75, 130)), [[PUSHUP_REASONS.straight]]);
});

test('push-ups: not locking out between reps is a no rep', () => {
  const seq = [[pu(170), 4], [pu(75), 4], [pu(140), 4], [pu(75), 4], [pu(170), 4]];
  assert.deepEqual(run(new PushupJudge(), seq), [[PUSHUP_REASONS.lockout], 'rep']);
});

test('push-ups: bending the arms while standing counts nothing', () => {
  const seq = [[pu(170, 175, 5), 4], [pu(60, 175, 5), 4], [pu(170, 175, 5), 4]];
  assert.deepEqual(run(new PushupJudge(), seq), []);
});

// ---- jumping jacks: hands y in the picture (smaller = higher), shoulders at 0.3, head top at 0.12
const jk = (hand, spread) => ({ handYL: hand, handYR: hand, shY: 0.3, headTopY: 0.12, feetSpread: spread });
const jack = (hand = 0.05, spread = 1.8) => [[jk(0.55, 0.7), 4], [jk(0.2, 1.2), 2], [jk(hand, spread), 4], [jk(0.55, 0.7), 4]];

test('jumping jacks: hands over head and feet wide is a rep', () => {
  assert.deepEqual(run(new JackJudge(), jack()), ['rep']);
});

test('jumping jacks: hands only to shoulder height, or feet narrow, is a no rep', () => {
  assert.deepEqual(run(new JackJudge(), jack(0.2)), [[JACK_REASONS.hands]]);
  assert.deepEqual(run(new JackJudge(), jack(0.05, 1.0)), [[JACK_REASONS.wide]]);
});

test('jumping jacks: feet not back together before the next rep is a no rep', () => {
  // Lands from the first rep with the feet still wide, then goes again.
  const seq = [[jk(0.55, 0.7), 4], [jk(0.05, 1.8), 4], [jk(0.55, 1.6), 4], [jk(0.05, 1.8), 4], [jk(0.55, 0.7), 4]];
  assert.deepEqual(run(new JackJudge(), seq), ['rep', [JACK_REASONS.together]]);
});

// ---- sit-ups
const su = (tilt) => ({ tilt });
const situp = (low = 85) => [[su(low), 4], [su(55), 2], [su(40), 2], [su(15), 4], [su(50), 2]];

test('sit-ups: lie back and sit up is a rep', () => {
  assert.deepEqual(run(new SitupJudge(), situp()), ['rep']);
});

test('sit-ups: not lying back is a no rep, not sitting up is a no rep', () => {
  assert.deepEqual(run(new SitupJudge(), situp(70)), [[SITUP_REASONS.down]]);
  const seq = [[su(85), 4], [su(45), 4], [su(85), 4], [su(15), 4]];
  assert.deepEqual(run(new SitupJudge(), seq), [[SITUP_REASONS.up], 'rep']);
});

test('every exercise has a label, a judge, a start check and standards', () => {
  for (const [key, ex] of Object.entries(EXERCISES)) {
    assert.ok(ex.label && ex.unit && ex.ready?.title && ex.standards.length, key);
    const j = ex.make(5, {});
    assert.equal(j.o.targetReps, 5, key);
    assert.equal(typeof j.update, 'function', key);
  }
});

test('push-ups: arms at 145° count as straight by default, and the setting can demand more', () => {
  const ready = EXERCISES.pushups.ready;
  const plank = { tilt: 80, elbowAngle: 145 };
  assert.equal(ready.test(plank, { pushupStraight: 140 }), true);
  assert.equal(ready.test(plank, { pushupStraight: 160 }), false);
  const run = (j) => {
    let t = 0, reps = 0;
    for (const [e, n] of [[145, 4], [80, 4], [145, 4]]) for (let i = 0; i < n; i++) {
      if (j.update({ tilt: 80, elbowAngle: e, hipAngle: 175 }, (t += 33))?.type === 'rep') reps++;
    }
    return reps;
  };
  assert.equal(run(EXERCISES.pushups.make(5, { pushupStraight: 140 })), 1);
  assert.equal(run(EXERCISES.pushups.make(5, { pushupStraight: 160 })), 0);
});

test('strictness: the less strict half passes a shallow push-up that the middle and above refuse', () => {
  const run = (level) => {
    const j = applyStrictness(EXERCISES.pushups.make(5, { pushupStraight: 140 }), 'pushups', level);
    let t = 0, reps = 0;
    for (const [e, n] of [[150, 4], [95, 4], [150, 4]]) for (let i = 0; i < n; i++) {
      if (j.update({ tilt: 80, elbowAngle: e, hipAngle: 175 }, (t += 33))?.type === 'rep') reps++;
    }
    return reps;
  };
  assert.deepEqual([run(0), run(25), run(50), run(75), run(100)], [1, 1, 0, 0, 0]);
});

test('strictness: every exercise gets sensible, finite limits at each level', () => {
  for (const key of ['burpees', 'squats', 'pushups', 'jacks', 'situps']) {
    for (const level of [0, 25, 50, 75, 100, 'lenient', 'strict']) {
      const j = applyStrictness(EXERCISES[key].make(30, { chestMaxRatio: 0.35, jumpMinLift: 0.025, hipMinAngle: 160, handsTolerance: 0.02, downEnterTilt: 60, pushupStraight: 140 }), key, level);
      for (const [k, v] of Object.entries(j.o)) assert.ok(Number.isFinite(v), `${key} ${level} ${k}=${v}`);
    }
  }
  const p = applyStrictness(EXERCISES.pushups.make(30, { pushupStraight: 140 }), 'pushups', 100).o;
  assert.ok(p.downElbow < p.risingElbow && p.risingElbow < p.lockElbow);
});

test('strictness: push-up angles stay in order across the whole slider', () => {
  for (let v = 0; v <= 100; v += 5) {
    const o = applyStrictness(EXERCISES.pushups.make(30, { pushupStraight: 140 }), 'pushups', v).o;
    assert.ok(o.depthElbow <= o.downElbow && o.downElbow < o.risingElbow && o.risingElbow < o.lockElbow, `at ${v}: ${JSON.stringify(o)}`);
  }
});

// Good and borderline reps for every exercise, run across the whole slider.
// Lowering strictness must never stop a rep counting.
const SLIDER = [0, 10, 25, 40, 50, 60, 75, 90, 100];
const BURPEE_OPTS = { chestMaxRatio: 0.35, jumpMinLift: 0.025, hipMinAngle: 160, handsTolerance: 0.02, downEnterTilt: 60, pushupStraight: 140 };
const repsAt = (key, seq, v) => run(applyStrictness(EXERCISES[key].make(30, BURPEE_OPTS), key, v), seq).filter((e) => e === 'rep').length;
const CASES = {
  squats: { good: squat(0.1), borderline: [[STAND, 4], [MID, 3], [sq(100, 95, -0.15), 4], [MID, 3], [sq(150, 150, -0.8), 4]] },
  // Camera reads arms compressed: straight looks like 130°, the bottom like 100°.
  pushups: { good: pushup(75), borderline: [[pu(130), 4], [pu(112), 3], [pu(100), 4], [pu(112), 3], [pu(130), 4]] },
  jacks: { good: jack(), borderline: [[jk(0.55, 0.85), 4], [jk(0.2, 1.1), 2], [jk(0.05, 1.15), 4], [jk(0.55, 1.15), 4]] },
  situps: { good: situp(), borderline: [[su(70), 4], [su(55), 2], [su(48), 2], [su(42), 4], [su(50), 2]] },
};

test('strictness: a good rep counts for every exercise at every slider position', () => {
  for (const [key, { good }] of Object.entries(CASES)) {
    for (const v of SLIDER) assert.equal(repsAt(key, good, v), 1, `${key} at ${v}`);
  }
});

test('strictness: moving the slider down never stops a rep counting, and a borderline rep counts at the bottom', () => {
  for (const [key, cases] of Object.entries(CASES)) {
    for (const seq of Object.values(cases)) {
      const counts = SLIDER.map((v) => repsAt(key, seq, v));
      for (let i = 1; i < counts.length; i++) assert.ok(counts[i - 1] >= counts[i], `${key}: ${counts.join(',')}`);
    }
    assert.equal(repsAt(key, cases.borderline, 0), 1, `${key} borderline at 0`);
    assert.equal(repsAt(key, cases.borderline, 100), 0, `${key} borderline at 100`);
  }
});
