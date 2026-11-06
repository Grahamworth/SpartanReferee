import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { compare, matchPeople } = createRequire(import.meta.url)('../server/review/counts.js');

const rep = (t, extra = {}) => ({ t, type: 'rep', ...extra });
const no = (t, reasons = []) => ({ t, type: 'norep', reasons });

test('your reps and the AI\'s line up, allowing for you pressing a little late or early', () => {
  const r = compare([rep(5000), rep(10300), rep(14700)], [rep(5200), rep(10000), rep(15000)]);
  assert.equal(r.agree, 3); assert.equal(r.missed, 0); assert.equal(r.extra, 0); assert.equal(r.score, 1);
});

test('a rep the AI didn\'t give is missed, with the reason when it gave a no rep', () => {
  const r = compare([rep(5000), rep(10000), rep(15000)], [rep(5000), no(10200, ['Hands over ears'])]);
  assert.equal(r.agree, 1); assert.equal(r.missed, 2);
  assert.match(r.items.find((x) => x.t === 10000).note, /Hands over ears/);
  assert.match(r.items.find((x) => x.t === 15000).note, /saw nothing/);
  assert.equal(r.score, 1 / 3);
});

test('a rep only the AI gave is extra, and says if you marked it a no rep', () => {
  const r = compare([rep(5000), no(10000)], [rep(5000), rep(10200), rep(20000)]);
  assert.equal(r.extra, 2);
  assert.match(r.items.find((x) => x.t === 10200).note, /no rep/);
  assert.match(r.items.find((x) => x.t === 20000).note, /didn't mark/);
});

test('each rep is only used once, nearest first', () => {
  const r = compare([rep(5000), rep(5500)], [rep(5400)]);
  assert.equal(r.agree, 1); assert.equal(r.missed, 1);
  assert.equal(r.items.find((x) => x.kind === 'agree').t, 5500);
});

test('reps too far apart in time aren\'t the same rep', () => {
  const r = compare([rep(5000)], [rep(7000)]);
  assert.equal(r.agree, 0); assert.equal(r.missed, 1); assert.equal(r.extra, 1); assert.equal(r.score, 0);
});

test('no reps agreeing are counted, and don\'t change the score', () => {
  const r = compare([rep(5000), no(10000)], [rep(5000), no(10500)]);
  assert.equal(r.noRepsAgree, 1); assert.equal(r.score, 1);
});

test('nothing counted gives no score rather than a false one', () => {
  assert.equal(compare([], []).score, null);
});

test('marks in any order give the same answer', () => {
  assert.deepEqual(compare([rep(9000), rep(3000)], [rep(3000), rep(9000)]).items.map((x) => x.t), [3000, 9000]);
});

test('a flagged rep stays flagged in the comparison', () => {
  assert.deepEqual(compare([rep(5000)], [rep(5000, { assumed: ['feet'] })]).items[0].assumed, ['feet']);
});

test('each counted person is matched to the AI athlete who agrees most, once each', () => {
  const counts = [{ id: 'a', marks: [rep(5000), rep(10000)] }, { id: 'b', marks: [rep(7000), rep(12000)] }];
  const athletes = [{ n: 1, label: 1, events: [rep(7000), rep(12000)] }, { n: 2, label: 2, events: [rep(5000), rep(10000)] }];
  const r = matchPeople(counts, athletes);
  assert.equal(r.find((x) => x.id === 'a').athlete.label, 2);
  assert.equal(r.find((x) => x.id === 'b').athlete.label, 1);
  assert.equal(r[0].result.score, 1);
});

test('someone the AI never found shows as everything missed', () => {
  const r = matchPeople([{ id: 'a', marks: [rep(5000), rep(10000)] }], [{ n: 1, label: 1, events: [rep(40000)] }]);
  assert.equal(r[0].athlete, null); assert.equal(r[0].result.missed, 2); assert.equal(r[0].result.aiReps, 0);
});

test('someone else on the same rhythm is no sign of tracking swapping', () => {
  const marks = [rep(5000), rep(10000), rep(15000), rep(20000)];
  const athletes = [{ n: 1, label: 1, events: marks }, { n: 2, label: 2, events: [rep(5500), rep(10500), rep(15500)] }];
  const [r] = matchPeople([{ id: 'a', marks }], athletes);
  assert.equal(r.athlete.label, 1); assert.deepEqual(r.also, []);
});

test('reps landing on another athlete point to tracking swapping between them', () => {
  const marks = [rep(5000), rep(10000), rep(15000), rep(20000), rep(25000)];
  const athletes = [{ n: 1, label: 1, events: marks.slice(0, 3) }, { n: 2, label: 2, events: marks.slice(3) }];
  const [r] = matchPeople([{ id: 'a', marks }], athletes);
  assert.equal(r.athlete.label, 1); assert.deepEqual(r.also.map((x) => x.label), [2]);
});
