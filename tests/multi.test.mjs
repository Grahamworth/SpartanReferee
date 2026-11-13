// Run with: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MultiTracker, personBox, fromCrop, clothesColour, unclaimedBoxes } from '../multi.js';
import { TRACKING } from '../pose-filter.js';

// A standing person with hips at (x, y) and the given height (fraction of the frame).
function person(x, y = 0.6, h = 0.4) {
  const lm = Array.from({ length: 33 }, (_, i) => ({ x, y: y - h / 2 + (h * i) / 32, z: 0, visibility: 0.9 }));
  lm[23] = { x: x - 0.02, y, z: 0, visibility: 0.9 };
  lm[24] = { x: x + 0.02, y, z: 0, visibility: 0.9 };
  return lm;
}
const frame = (...people) => ({ landmarks: people, worldLandmarks: people.map((lm) => lm.map(() => ({ x: 0, y: 0, z: 0 }))) });

// A judge whose events the test hands it, one per frame.
class FakeJudge {
  constructor() { this.count = 0; this.noReps = 0; this.reasonCounts = {}; this.next = null; this.o = { targetReps: 30 }; }
  update() {
    const ev = this.next; this.next = null;
    if (ev?.type === 'rep') ev.count = ++this.count;
    if (ev?.type === 'norep') this.noReps++;
    return ev;
  }
  finish() { return null; }
}
const tracker = (opts = {}) => new MultiTracker({ make: () => new FakeJudge(), tracking: TRACKING.balanced, metricOpts: () => ({}), opts });
const trackAt = (mt, x) => mt.tracks.find((k) => Math.abs(k.box.x - x) < 0.06);

test('multi: each person keeps their own track as they move', () => {
  const mt = tracker();
  mt.update(frame(person(0.25), person(0.75)), 0);
  const a = trackAt(mt, 0.25), b = trackAt(mt, 0.75);
  // Both drift, and the model lists them in the other order.
  mt.update(frame(person(0.8), person(0.3)), 66);
  assert.equal(mt.tracks.length, 2);
  assert.ok(Math.abs(a.box.x - 0.3) < 0.01 && Math.abs(b.box.x - 0.8) < 0.01);
});

test('multi: people far in the background are ignored', () => {
  const mt = tracker();
  mt.update(frame(person(0.5), person(0.1, 0.3, 0.05)), 0);
  assert.equal(mt.tracks.length, 1);
});

test('multi: the same person found twice is one track', () => {
  const mt = tracker();
  mt.update(frame(person(0.5), person(0.51, 0.61, 0.38)), 0);
  assert.equal(mt.tracks.length, 1);
});

test('multi: someone becomes an athlete at their first good rep, with earlier no reps reported then', () => {
  const mt = tracker();
  mt.update(frame(person(0.3), person(0.7)), 0);
  const a = trackAt(mt, 0.3);
  a.judge.next = { type: 'norep', reasons: ['Chest to ground'] };
  assert.deepEqual(mt.update(frame(person(0.3), person(0.7)), 66), []);
  assert.equal(mt.athletes.length, 0);
  a.judge.next = { type: 'rep' };
  const evs = mt.update(frame(person(0.3), person(0.7)), 132);
  assert.deepEqual(evs.map((e) => e.ev.type), ['norep', 'rep']);
  assert.equal(mt.athletes.length, 1);
  assert.equal(a.label, 1);
});

test('multi: athletes are numbered in the order they start', () => {
  const mt = tracker();
  mt.update(frame(person(0.3), person(0.7)), 0);
  trackAt(mt, 0.7).judge.next = { type: 'rep' };
  mt.update(frame(person(0.3), person(0.7)), 66);
  trackAt(mt, 0.3).judge.next = { type: 'rep' };
  mt.update(frame(person(0.3), person(0.7)), 132);
  assert.deepEqual(mt.athletes.map((k) => [k.label, Math.round(k.box.x * 10) / 10]), [[1, 0.7], [2, 0.3]]);
});

test('multi: an athlete out of view for a while is picked up again with their count', () => {
  const mt = tracker();
  mt.update(frame(person(0.5)), 0);
  mt.tracks[0].judge.next = { type: 'rep' };
  mt.update(frame(person(0.5)), 66);
  mt.update(frame(), 3000); // hidden behind an official for 3 s
  mt.update(frame(person(0.56)), 3066);
  assert.equal(mt.tracks.length, 1);
  assert.equal(mt.athletes[0].judge.count, 1);
});

test('multi: an athlete missing for a while carries on their count when found again on their spot', () => {
  const mt = tracker();
  mt.update(frame(person(0.2, 0.6, 0.2)), 0);
  mt.tracks[0].judge.next = { type: 'rep' };
  mt.update(frame(person(0.2, 0.6, 0.2)), 66);
  // Hidden for 5 s (an official in front), then a new track finds them on the same spot.
  mt.update(frame(person(0.23, 0.6, 0.2)), 5000);
  const k = mt.tracks.find((x) => x.seenAt === 5000);
  k.judge.next = { type: 'rep' };
  const [e] = mt.update(frame(person(0.23, 0.6, 0.2)), 5066);
  assert.equal(mt.athletes.length, 1);
  assert.equal(k.label, 1);
  assert.equal(e.ev.count, 2);
});

test('multi: someone turning up away from a missing athlete\'s spot is a new athlete', () => {
  const mt = tracker();
  mt.update(frame(person(0.2, 0.6, 0.2)), 0);
  mt.tracks[0].judge.next = { type: 'rep' };
  mt.update(frame(person(0.2, 0.6, 0.2)), 66);
  mt.update(frame(person(0.8, 0.6, 0.2)), 5000);
  trackAt(mt, 0.8).judge.next = { type: 'rep' };
  mt.update(frame(person(0.8, 0.6, 0.2)), 5066);
  assert.deepEqual(mt.athletes.map((x) => x.label), [1, 2]);
});

test('multi: a new athlete is not merged into one who finished', () => {
  const mt = new MultiTracker({ make: () => Object.assign(new FakeJudge(), { o: { targetReps: 1 } }), tracking: TRACKING.balanced, metricOpts: () => ({}) });
  mt.update(frame(person(0.2, 0.6, 0.2)), 0);
  mt.tracks[0].judge.next = { type: 'rep' };
  mt.update(frame(person(0.2, 0.6, 0.2)), 66);
  mt.tracks[0].judge.done = true;
  mt.update(frame(person(0.8, 0.6, 0.2)), 5000);
  trackAt(mt, 0.8).judge.next = { type: 'rep' };
  mt.update(frame(person(0.8, 0.6, 0.2)), 5066);
  assert.equal(mt.athletes.length, 2);
});

test('multi: two athletes side by side are not taken for one person found twice', () => {
  const mt = tracker();
  mt.update(frame(person(0.45), person(0.55)), 0);
  assert.equal(mt.tracks.length, 2);
});

test('multi: zooms in around the people, with a look at the whole frame about once a second', () => {
  const mt = tracker();
  assert.equal(mt.region(0, 1), null); // nobody yet: the whole frame
  mt.update(frame(person(0.5, 0.6, 0.2)), 0);
  const r = mt.region(66, 1);
  assert.ok(r && r.w < 0.8 && r.h < 0.8 && r.x <= 0.45 && r.x + r.w >= 0.55, JSON.stringify(r));
  assert.equal(mt.wantsScan(66), true);
  assert.equal(mt.wantsScan(500), false);
  assert.equal(mt.wantsScan(1100), true);
});

test('multi: zoomed results map back to the whole frame', () => {
  const res = fromCrop({ landmarks: [[{ x: 0.5, y: 0.5, visibility: 1 }]] }, { x: 0.2, y: 0.4, w: 0.5, h: 0.2 });
  assert.deepEqual([res.landmarks[0][0].x, res.landmarks[0][0].y], [0.45, 0.5]);
});

test('multi: the look at the whole frame only adds people nobody is tracking', () => {
  const mt = tracker();
  mt.update(frame(person(0.5, 0.6, 0.2)), 0);
  // The rough second look finds the same athlete a little off, and someone new.
  mt.update(frame(person(0.5, 0.6, 0.2)), 66, 1, null, frame(person(0.55, 0.62, 0.18), person(0.1, 0.6, 0.2)));
  assert.equal(mt.tracks.length, 2);
  assert.ok(trackAt(mt, 0.1));
});

test('multi: one person tracked twice loses the spare copy', () => {
  const mt = tracker();
  mt.update(frame(person(0.5), person(0.15)), 0);
  const spare = trackAt(mt, 0.15);
  spare.box = { ...trackAt(mt, 0.5).box, cx: trackAt(mt, 0.5).box.cx + 0.05 }; // drifted onto the athlete
  mt.update(frame(person(0.5)), 66);
  assert.equal(mt.tracks.length, 1);
});

test('multi: a passer-by who never does a rep is forgotten', () => {
  const mt = tracker();
  mt.update(frame(person(0.5)), 0);
  mt.update(frame(), 20000);
  assert.equal(mt.tracks.length, 0);
});

test('multi: box is measured square, across and down', () => {
  const b = personBox(person(0.5, 0.5, 0.4), 0.5625);
  assert.ok(Math.abs(b.size - 0.4) < 1e-9);
  assert.ok(Math.abs(b.x - 0.5) < 1e-9);
});

test('multi: someone seen alongside an athlete never carries on that athlete\'s count', () => {
  const mt = tracker();
  mt.update(frame(person(0.2, 0.6, 0.2), person(0.8, 0.6, 0.2)), 0);
  trackAt(mt, 0.2).judge.next = { type: 'rep' };
  for (let t = 66; t < 1000; t += 66) mt.update(frame(person(0.2, 0.6, 0.2), person(0.8, 0.6, 0.2)), t);
  // Athlete 1 is hidden for 3 s while the other person, seen with them, keeps going.
  for (let t = 1056; t < 4200; t += 66) mt.update(frame(person(0.8, 0.6, 0.2)), t);
  trackAt(mt, 0.8).judge.next = { type: 'rep' };
  mt.update(frame(person(0.8, 0.6, 0.2)), 4266);
  assert.deepEqual(mt.athletes.map((k) => k.label), [1, 2]);
});

// Someone lying flat, hips at (x, y), body length len across the picture.
function lying(x, y = 0.8, len = 0.3) {
  const lm = Array.from({ length: 33 }, (_, i) => ({ x: x - len / 2 + (len * i) / 32, y, z: 0, visibility: 0.9 }));
  for (const i of [11, 12]) lm[i] = { x: x - len * 0.3, y, z: 0, visibility: 0.9 };
  for (const i of [23, 24]) lm[i] = { x, y, z: 0, visibility: 0.9 };
  return lm;
}

test('multi: a lying athlete\'s track is not handed to someone standing beside them a frame later', () => {
  const mt = tracker();
  mt.update(frame(lying(0.5)), 0);
  const athlete = mt.tracks[0];
  // Next frame the athlete isn't found; an official is standing right next to them.
  mt.update(frame(person(0.56, 0.7, 0.3)), 66);
  assert.equal(mt.tracks.length, 2);
  assert.ok(Math.abs(athlete.box.cx - 0.5) < 0.01, 'athlete track stays where they lie');
});

test('multi: a track is not handed to someone too far away to have got there in one frame', () => {
  const mt = tracker();
  mt.update(frame(person(0.3, 0.6, 0.3)), 0);
  mt.update(frame(person(0.55, 0.6, 0.3)), 66); // a quarter of the frame in 1/15 s
  assert.equal(mt.tracks.length, 2);
});

test('multi: clothes are read as the colour balance of the top and the shorts', () => {
  // A picture that's blue above y = 0.6 and red below: a blue top, red shorts.
  const sample = (x, y) => (y < 0.6 ? [20, 40, 200] : [200, 30, 30]);
  const c = clothesColour(person(0.5, 0.6, 0.4), sample);
  assert.ok(c.top[0] < 0.15 && c.shorts[0] > 0.7, JSON.stringify(c));
});

test('multi: someone in clearly different clothes doesn\'t take an athlete\'s track', () => {
  const mt = tracker();
  const blue = () => [20, 40, 200], pink = () => [220, 120, 150];
  for (let t = 0; t < 600; t += 66) mt.update(frame(person(0.5, 0.6, 0.3)), t, 1, blue);
  const k = mt.tracks[0];
  mt.update(frame(person(0.52, 0.6, 0.3)), 666, 1, pink); // same spot, but a pink top
  assert.equal(mt.tracks.length, 2);
  assert.ok(Math.abs(k.box.cx - 0.5) < 0.01);
});

test('multi: a copy of an athlete found on top of them, dressed the same, is not a new athlete', () => {
  const mt = tracker();
  const blue = () => [20, 40, 200];
  for (let t = 0; t < 400; t += 66) mt.update(frame(person(0.5, 0.6, 0.3)), t, 1, blue);
  mt.tracks[0].judge.next = { type: 'rep' };
  mt.update(frame(person(0.5, 0.6, 0.3)), 400, 1, blue);
  // A second, slightly offset copy of the same athlete appears and "does a rep".
  for (let t = 466; t < 800; t += 66) mt.update(frame(person(0.5, 0.6, 0.3), person(0.58, 0.6, 0.3)), t, 1, blue);
  const copy = trackAt(mt, 0.58);
  if (copy) copy.judge.next = { type: 'rep' };
  mt.update(frame(person(0.5, 0.6, 0.3), person(0.58, 0.6, 0.3)), 866, 1, blue);
  assert.equal(mt.athletes.length, 1);
});

test('multi: someone right beside an athlete but dressed differently is a new athlete', () => {
  const mt = tracker();
  const sample = (x) => (x < 0.54 ? [20, 40, 200] : [220, 160, 130]); // blue top on the left, skin on the right
  for (let t = 0; t < 400; t += 66) mt.update(frame(person(0.5, 0.6, 0.3), person(0.58, 0.6, 0.3)), t, 1, sample);
  trackAt(mt, 0.5).judge.next = { type: 'rep' };
  mt.update(frame(person(0.5, 0.6, 0.3), person(0.58, 0.6, 0.3)), 466, 1, sample);
  trackAt(mt, 0.58).judge.next = { type: 'rep' };
  mt.update(frame(person(0.5, 0.6, 0.3), person(0.58, 0.6, 0.3)), 532, 1, sample);
  assert.equal(mt.athletes.length, 2);
});

test('multi: an athlete who walked out of the side of the picture is not carried on by a newcomer', () => {
  const mt = tracker();
  mt.update(frame(person(0.5, 0.6, 0.2)), 0);
  mt.tracks[0].judge.next = { type: 'rep' };
  mt.update(frame(person(0.5, 0.6, 0.2)), 66);
  for (let t = 132, x = 0.5; x > 0.02; t += 66, x -= 0.03) mt.update(frame(person(x, 0.6, 0.2)), t); // walks off to the left
  mt.update(frame(), 2000);
  mt.update(frame(person(0.7, 0.6, 0.2)), 4000);
  trackAt(mt, 0.7).judge.next = { type: 'rep' };
  mt.update(frame(person(0.7, 0.6, 0.2)), 4066);
  assert.deepEqual(mt.athletes.map((k) => k.label), [1, 2]);
});

test('multi: the person finder\'s boxes for people already found are left out, others kept biggest first', () => {
  const found = [person(0.5, 0.6, 0.3)]; // outline x 0.5, y 0.45-0.75
  const boxes = [
    { x0: 0.46, y0: 0.44, x1: 0.54, y1: 0.76, score: 0.9 }, // the same person
    { x0: 0.55, y0: 0.5, x1: 0.7, y1: 0.74, score: 0.8 },   // someone half behind them
    { x0: 0.1, y0: 0.3, x1: 0.12, y1: 0.34, score: 0.7 },   // far in the background
    { x0: 0.75, y0: 0.4, x1: 0.85, y1: 0.8, score: 0.6 },   // someone else, bigger
  ];
  const left = unclaimedBoxes(boxes, found, 1);
  assert.deepEqual(left.map((b) => b.score), [0.6, 0.8]);
});

test('multi: someone in a hi-vis yellow top (an official) is never counted', () => {
  const mt = tracker();
  const hiVis = () => [210, 235, 40];
  for (let t = 0; t < 400; t += 66) mt.update(frame(person(0.5, 0.6, 0.3)), t, 1, hiVis);
  mt.tracks[0].judge.next = { type: 'rep' };
  mt.update(frame(person(0.5, 0.6, 0.3)), 466, 1, hiVis);
  assert.equal(mt.athletes.length, 0);
});

test('multi: an athlete out of sight for over 20 s has gone: nobody carries on their count', () => {
  const mt = tracker();
  mt.update(frame(person(0.5, 0.6, 0.2)), 0);
  mt.tracks[0].judge.next = { type: 'rep' };
  mt.update(frame(person(0.5, 0.6, 0.2)), 66);
  mt.update(frame(), 21000); // gone for 21 s
  mt.update(frame(person(0.5, 0.6, 0.2)), 21066); // someone in the same spot
  const k = mt.tracks.find((x) => x.seenAt === 21066);
  k.judge.next = { type: 'rep' };
  mt.update(frame(person(0.5, 0.6, 0.2)), 21132);
  assert.deepEqual(mt.athletes.map((a) => [a.label, a.judge.count, !!a.gone]), [[1, 1, true], [2, 1, false]]);
});

test('multi: a lost athlete\'s track does not cling to someone walking past', () => {
  const mt = tracker();
  for (let t = 0; t < 3000; t += 66) mt.update(frame(person(0.5, 0.6, 0.2)), t); // doing burpees on one spot
  const a = mt.tracks[0];
  a.judge.next = { type: 'rep' };
  mt.update(frame(person(0.5, 0.6, 0.2)), 3066);
  // The athlete is missed; a walker comes in beside them and keeps going.
  let x = 0.56;
  for (let t = 3132; t < 4500; t += 66, x += 0.015) mt.update(frame(person(x, 0.6, 0.2)), t);
  // It may follow them a little (a burpee moves the hips), but no further than its home spot allows.
  assert.ok(Math.abs(a.box.cx - 0.5) <= 0.7 * 0.2 + 0.02, `athlete track wandered to ${a.box.cx}`);
  // The athlete is seen again on their spot and picked back up.
  mt.update(frame(person(0.5, 0.6, 0.2), person(x, 0.6, 0.2)), 4566);
  assert.equal(a.seenAt, 4566);
  assert.ok(Math.abs(a.box.cx - 0.5) < 0.01);
});

// ---- someone crossing in front of an athlete: the athlete's track is held, not handed to them
const crossing = () => {
  const mt = tracker({ holdWalkers: true });
  for (let t = 0; t < 2000; t += 66) mt.update(frame(person(0.5, 0.6, 0.2)), t); // burpees on one spot
  const a = mt.tracks[0];
  a.judge.next = { type: 'rep' };
  mt.update(frame(person(0.5, 0.6, 0.2)), 2066);
  return { mt, a };
};

test('multi: someone walking across in front of an athlete keeps their own track, and the athlete keeps theirs', () => {
  const { mt, a } = crossing();
  // a walker comes in from the left, about a body height a second; while they're in front, only they are found
  let x = 0.1, t = 2132, walker = null, heldSince = null;
  for (; x < 0.9; t += 66, x += 0.015) {
    const inFront = Math.abs(x - 0.5) < 0.08;
    mt.update(inFront ? frame(person(x, 0.6, 0.2)) : frame(person(0.5, 0.6, 0.2), person(x, 0.6, 0.2)), t);
    if (x > 0.3 && !walker) walker = trackAt(mt, x);
    if (inFront && heldSince == null) heldSince = a.seenAt;
    if (inFront) assert.equal(a.seenAt, heldSince, `the walker was handed to the athlete at x ${x.toFixed(2)}`);
    assert.ok(Math.abs(a.box.cx - 0.5) < 0.03, `the athlete's track was dragged to ${a.box.cx.toFixed(2)}`);
  }
  assert.ok(walker && Math.abs(walker.box.x - (x - 0.015)) < 0.02, 'the walker kept their own track all the way across');
  a.judge.next = { type: 'rep' };
  mt.update(frame(person(0.5, 0.6, 0.2), person(x, 0.6, 0.2)), t);
  assert.deepEqual(mt.athletes.map((k) => [k.label, k.judge.count]), [[1, 2]]);
});

test('multi: an official who stops in front of an athlete for a while doesn\'t take their track or their count', () => {
  const { mt, a } = crossing();
  // the official walks in, stops just in front (only they are found for 3 s), then walks off
  let x = 0.2, t = 2132, official = null;
  for (; x < 0.52; t += 66, x += 0.015) {
    mt.update(frame(person(0.5, 0.6, 0.2), person(x, 0.6, 0.2)), t);
    if (x > 0.35 && !official) official = trackAt(mt, x);
  }
  for (const end = t + 3000; t < end; t += 66) mt.update(frame(person(0.52, 0.6, 0.2)), t);
  assert.ok(Math.abs(official.box.x - 0.52) < 0.01 && official.seenAt === t - 66, 'the official kept their own track while standing there');
  for (; x < 0.9; t += 66, x += 0.015) mt.update(frame(person(0.5, 0.6, 0.2), person(x, 0.6, 0.2)), t);
  a.judge.next = { type: 'rep' };
  mt.update(frame(person(0.5, 0.6, 0.2), person(x, 0.6, 0.2)), t);
  assert.equal(mt.athletes.length, 1);
  assert.equal(mt.athletes[0].label, 1);
  assert.equal(mt.athletes[0].judge.count, 2);
  assert.ok(Math.abs(mt.athletes[0].box.cx - 0.5) < 0.01);
});

test('multi: an athlete\'s hips going back and forth through a burpee isn\'t taken for someone walking', () => {
  const mt = tracker({ holdWalkers: true });
  // two athletes side by side, each kicking back and coming in again every 3 s (hips move a third of their height)
  const at = (x0, t) => x0 + (Math.floor(t / 600) % 5 === 2 ? 0.065 : 0);
  for (let t = 0; t < 1000; t += 66) mt.update(frame(person(at(0.35, t), 0.6, 0.2), person(at(0.65, t), 0.6, 0.2)), t);
  trackAt(mt, 0.35).judge.next = { type: 'rep' }; trackAt(mt, 0.65).judge.next = { type: 'rep' };
  mt.update(frame(person(0.35, 0.6, 0.2), person(0.65, 0.6, 0.2)), 1066);
  for (let t = 1132; t < 9000; t += 66) {
    mt.update(frame(person(at(0.35, t), 0.6, 0.2), person(at(0.65, t), 0.6, 0.2)), t);
    for (const k of mt.athletes) assert.ok(!mt._moving(k, t), `athlete ${k.label} taken for a walker at ${t} ms`);
  }
  assert.equal(mt.athletes.length, 2);
  assert.deepEqual(mt.athletes.map((k) => Math.abs(k.home.cx - 0.35) < 0.05 || Math.abs(k.home.cx - 0.65) < 0.05), [true, true]);
});
