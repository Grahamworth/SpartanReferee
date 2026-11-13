// Run with: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { mergeAthletes, readGroups } = createRequire(import.meta.url)('../server/merge.js');

const T0 = Date.parse('2026-11-14T10:00:00Z');
const iso = (ms) => new Date(T0 + ms).toISOString();
// an athlete on a camera: reps at these seconds (from T0)
const ath = (n, cam, reps, { bib = '', noReps = [], from = 0, to = 120 } = {}) => ({
  n, src: 'live', cam, bib, firstAt: iso(from * 1000), lastAt: iso(to * 1000), reps: reps.length, noReps: noReps.length,
  repTimes: reps.map((s) => T0 + s * 1000), noRepTimes: noReps.map((s) => T0 + s * 1000),
});

test('merge: the same number on both cameras is one athlete; a rep seen on both counts once, one camera fills the other\'s gaps', () => {
  // camera 2 missed the reps at 12 and 15 s (someone in front of it); camera 1 missed the one at 24 s
  const a = ath(1, 1, [3, 6, 9, 12, 15, 18, 21, 27], { bib: '12' });
  const b = ath(2, 2, [3.3, 6.2, 9.4, 18.3, 21.1, 24.2, 27.4], { bib: '12' });
  const [m] = mergeAthletes([a, b], [[1, 2]]);
  assert.deepEqual(m.ns, [1, 2]);
  assert.equal(m.bib, '12');
  assert.equal(m.by, 'number');
  assert.equal(m.reps, 9, '3 6 9 12 15 18 21 24 27');
  assert.equal(m.both, 6);
  assert.deepEqual(m.counts, [8, 7]);
});

test('merge: without numbers, athletes are matched by their reps happening together, even with the feeds a second apart', () => {
  // two athletes side by side; camera 2's feed is 1.5 s behind camera 1's
  const lag = 1.5;
  const reps1 = [2, 5.5, 9, 12.5, 16, 19.5], reps2 = [3, 7, 11, 15, 19];
  const list = [ath(1, 1, reps1), ath(2, 1, reps2), ath(3, 2, reps2.map((s) => s + lag)), ath(4, 2, reps1.slice(1).map((s) => s + lag))];
  const merged = mergeAthletes(list, [[1, 2]]);
  assert.equal(merged.length, 2);
  const byFirst = Object.fromEntries(merged.map((m) => [m.ns[0], m]));
  assert.deepEqual(byFirst[1].ns, [1, 4]);
  assert.deepEqual(byFirst[2].ns, [2, 3]);
  assert.equal(byFirst[1].reps, 6, 'camera 2 missed the first rep: camera 1 has it');
  assert.equal(byFirst[2].reps, 5);
  assert.ok(Math.abs(byFirst[1].offsetMs + lag * 1000) <= 100, `the gap between the feeds is found: ${byFirst[1].offsetMs}`);
  assert.equal(byFirst[1].by, 'timing');
});

test('merge: different numbers, too few reps, not at the same time, or cameras not grouped: not merged', () => {
  const reps = [3, 6, 9, 12, 15];
  assert.equal(mergeAthletes([ath(1, 1, reps, { bib: '7' }), ath(2, 2, reps, { bib: '8' })], [[1, 2]]).length, 0, 'two numbers: two people');
  assert.equal(mergeAthletes([ath(1, 1, [3, 6]), ath(2, 2, [3, 6])], [[1, 2]]).length, 0, 'two reps prove nothing');
  assert.equal(mergeAthletes([ath(1, 1, reps, { to: 20 }), ath(2, 2, reps.map((s) => s + 100), { from: 100, to: 130 })], [[1, 2]]).length, 0, 'at different times');
  assert.equal(mergeAthletes([ath(1, 1, reps), ath(2, 2, reps)], []).length, 0, 'not set as filming the same athletes');
  assert.equal(mergeAthletes([ath(1, 1, reps), ath(2, 1, reps)], [[1, 2]]).length, 0, 'two people on one camera');
});

test('merge: a no rep counts only when neither camera counted a rep then', () => {
  const a = ath(1, 1, [3, 6, 9, 12], { bib: '5', noReps: [15] });     // camera 1 said no rep at 15 s ...
  const b = ath(2, 2, [3, 6, 9, 12, 15.2], { bib: '5', noReps: [18] }); // ... camera 2 saw it as good; 18 s was bad on camera 2 only
  const [m] = mergeAthletes([a, b], [[1, 2]]);
  assert.equal(m.reps, 5);
  assert.equal(m.noReps, 1);
});

test('merge: the groups setting keeps lists of two or more cameras, each camera in one list', () => {
  assert.deepEqual(readGroups([[2, 1], [1, 3], [4], ['5', 6, 6], 'x']), [[1, 2], [5, 6]]);
  assert.deepEqual(readGroups(null), []);
});
