// Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PoseFilter, TRACKING } from '../pose-filter.js';
import { BurpeeJudge, computeMetrics, LM } from '../burpee.js';
import { SquatJudge, EXERCISES } from '../exercises.js';

// A pose where every point is seen at (0.5, 0.5) unless overridden.
function pose(over = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
  const wlm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  for (const [i, p] of Object.entries(over)) { Object.assign(lm[i], p); Object.assign(wlm[i], { x: p.x ?? 0, y: p.y ?? 0 }); }
  return { lm, wlm };
}

test('filter: a point hidden briefly stays where it was last seen', () => {
  const f = new PoseFilter(TRACKING.balanced);
  f.update(pose({ [LM.L_WR]: { x: 0.3, y: 0.2 } }), 0);
  const out = f.update(pose({ [LM.L_WR]: { x: 0.9, y: 0.9, visibility: 0.1 } }), 200);
  assert.deepEqual([out.lm[LM.L_WR].x, out.lm[LM.L_WR].y], [0.3, 0.2]);
  assert.equal(out.lm[LM.L_WR].filled, 'held');
  assert.equal(out.lm[LM.L_WR].visibility, TRACKING.balanced.minVis);
});

test('filter: hidden for longer, a point is placed from the other side with the last known gap', () => {
  const f = new PoseFilter(TRACKING.balanced);
  f.update(pose({ [LM.L_KNEE]: { x: 0.40, y: 0.7 }, [LM.R_KNEE]: { x: 0.45, y: 0.7 } }), 0);
  const out = f.update(pose({ [LM.L_KNEE]: { visibility: 0.1 }, [LM.R_KNEE]: { x: 0.55, y: 0.6 } }), 1000);
  assert.equal(out.lm[LM.L_KNEE].filled, 'mirrored');
  assert.ok(Math.abs(out.lm[LM.L_KNEE].x - 0.50) < 1e-9 && Math.abs(out.lm[LM.L_KNEE].y - 0.6) < 1e-9);
});

test('filter: strict mode does not guess from the other side', () => {
  const f = new PoseFilter(TRACKING.strict);
  f.update(pose(), 0);
  const out = f.update(pose({ [LM.L_KNEE]: { visibility: 0.1 } }), 1000);
  assert.equal(out.lm[LM.L_KNEE].filled, undefined);
  assert.equal(out.lm[LM.L_KNEE].visibility, 0.1);
});

test('metrics: torso and chest still measured with only one side seen', () => {
  const P = pose({
    [LM.L_SH]: { x: 0.3, y: 0.55 }, [LM.L_EL]: { x: 0.3, y: 0.6 }, [LM.L_WR]: { x: 0.3, y: 0.62 },
    [LM.L_HIP]: { x: 0.6, y: 0.56 }, [LM.L_KNEE]: { x: 0.8, y: 0.58 },
    [LM.R_SH]: { visibility: 0.1 }, [LM.R_EL]: { visibility: 0.1 }, [LM.R_WR]: { visibility: 0.1 }, [LM.R_HIP]: { visibility: 0.1 },
  });
  const m = computeMetrics(P.lm, P.wlm);
  assert.ok(m.tilt > 80, `tilt ${m.tilt}`);
  assert.ok(m.chestRatio != null && m.hipAngle != null);
});

test('burpee: a frame where the torso is hidden does not reset the move to the ground', () => {
  const stand = { tilt: 5, chestRatio: 0.95, hipAngle: 176, handYL: 0.5, handYR: 0.5, earY: 0.15, footY: 0.9, noseY: 0.12, wristsBelowHips: false };
  const plank = { ...stand, tilt: 85, wristsBelowHips: true, chestRatio: 0.9, footY: null };
  const hidden = { ...stand, tilt: null, chestRatio: null, hipAngle: null };
  const j = new BurpeeJudge();
  let t = 0;
  for (const m of [...Array(10).fill(stand), plank, hidden, plank]) j.update(m, (t += 33));
  assert.equal(j.phase, 'down');
});

test('squats: standing up still counts when the hips are hidden', () => {
  const j = new SquatJudge();
  let t = 0, reps = 0;
  const seq = [[175, 175, -0.9, 4], [80, 70, 0.1, 4], [175, null, null, 4]];
  for (const [knee, hip, drop, n] of seq) for (let i = 0; i < n; i++) {
    const e = j.update({ kneeAngle: knee, hipAngle: hip, hipDrop: drop }, (t += 33));
    if (e?.type === 'rep') reps++;
  }
  assert.equal(reps, 1);
});

// Side-on standing pose: only the near (left) side is seen, no ears.
function sideStanding() {
  const hide = { visibility: 0.1 };
  return pose({
    [LM.NOSE]: { x: 0.52, y: 0.12 }, [LM.L_EYE]: { x: 0.51, y: 0.11 }, [LM.L_EAR]: hide, [LM.R_EAR]: hide, [LM.R_EYE]: hide,
    [LM.L_SH]: { x: 0.5, y: 0.25 }, [LM.L_EL]: { x: 0.5, y: 0.38 }, [LM.L_WR]: { x: 0.5, y: 0.5 },
    [LM.L_HIP]: { x: 0.5, y: 0.52 }, [LM.L_KNEE]: { x: 0.5, y: 0.72 },
    [LM.L_ANK]: { x: 0.5, y: 0.9 }, [LM.L_HEEL]: { x: 0.49, y: 0.91 }, [LM.L_FOOT]: { x: 0.53, y: 0.92 },
    ...Object.fromEntries([LM.R_SH, LM.R_EL, LM.R_WR, LM.R_INDEX, LM.R_PINKY, LM.R_HIP, LM.R_KNEE, LM.R_ANK, LM.R_HEEL, LM.R_FOOT].map((i) => [i, hide])),
  });
}

test('metrics: side on, with only one side and no ears seen, still counts as in full view', () => {
  const P = sideStanding();
  const m = computeMetrics(P.lm, P.wlm);
  assert.equal(m.fullBody, true);
  assert.ok(m.footY != null && m.earY != null && m.shY != null);
});

test('burpee: hands over ears judged from the near hand when the far hand is hidden', () => {
  const stand = { tilt: 5, chestRatio: 0.95, hipAngle: 176, handYL: 0.5, handYR: null, earY: 0.15, footY: 0.9, noseY: 0.12, wristsBelowHips: false };
  const plank = { ...stand, tilt: 85, wristsBelowHips: true, chestRatio: 0.1 };
  const jump = { ...stand, handYL: 0.05, footY: 0.8 };
  const j = new BurpeeJudge();
  let t = 0, reps = 0;
  for (const m of [...Array(10).fill(stand), plank, plank, plank, stand, stand, stand, jump, jump, jump, stand]) {
    if (j.update(m, (t += 33))?.type === 'rep') reps++;
  }
  assert.equal(reps, 1);
});

test('metrics: head points are ignored; ear and head height come from the torso', () => {
  const P = sideStanding();
  const a = computeMetrics(P.lm, P.wlm);
  for (const i of [LM.NOSE, LM.L_EYE, LM.R_EYE, LM.L_EAR, LM.R_EAR]) Object.assign(P.lm[i], { y: 0.9, visibility: 0.1 });
  const b = computeMetrics(P.lm, P.wlm);
  assert.equal(b.fullBody, true);
  assert.equal(b.earY, a.earY);
  // Torso runs 0.25 -> 0.52, so ears at 0.25 - 0.35 * 0.27 and head top above that.
  assert.ok(Math.abs(b.earY - (0.25 - 0.35 * 0.27)) < 1e-9);
  assert.ok(b.headTopY < b.earY);
});

test('push-ups: side on, an arm straight in the picture counts as straight even when the 3D estimate reads it bent', () => {
  const hide = { visibility: 0.1 };
  // Plank side on: near (left) arm straight down in the picture; far arm hidden.
  const P = pose({
    [LM.L_SH]: { x: 0.35, y: 0.5 }, [LM.L_EL]: { x: 0.35, y: 0.62 }, [LM.L_WR]: { x: 0.35, y: 0.74 },
    [LM.L_HIP]: { x: 0.6, y: 0.53 }, [LM.L_KNEE]: { x: 0.75, y: 0.56 }, [LM.L_ANK]: { x: 0.9, y: 0.6 },
    [LM.R_SH]: hide, [LM.R_EL]: hide, [LM.R_WR]: hide, [LM.R_HIP]: hide,
  });
  // The 3D estimate puts the elbow well off the line (reads about 120°).
  Object.assign(P.wlm[LM.L_SH], { x: 0, y: 0, z: 0 });
  Object.assign(P.wlm[LM.L_EL], { x: 0, y: 0.15, z: 0.09 });
  Object.assign(P.wlm[LM.L_WR], { x: 0, y: 0.3, z: 0 });
  Object.assign(P.wlm[LM.L_HIP], { x: 0.5, y: 0.05, z: 0 });
  const m = computeMetrics(P.lm, P.wlm, { aspect: 16 / 9 });
  assert.ok(m.elbowAngle < 130, `3D ${m.elbowAngle}`);
  assert.ok(m.elbowStraight > 175, `straight ${m.elbowStraight}`);
  assert.equal(EXERCISES.pushups.ready.test(m, { lockElbow: 140 }), true);
});
