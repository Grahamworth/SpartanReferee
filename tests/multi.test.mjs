// Run with: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MultiTracker, MULTI_DEFAULTS, personBox, fromCrop, clothesColour, unclaimedBoxes, peopleWanted, arrivalClock, blendSnaps, finderTiles, mergeBoxes, crowdSeen } from '../multi.js';
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

// ---- who becomes an athlete: only by a first rep the judge can stand behind
const rep = (downAt, endAt) => ({ type: 'rep', detail: { downAt, endAt } });

test('multi: a first "rep" that took over 10 s (a bystander who bent down once, a camera being moved) doesn\'t make an athlete', () => {
  const mt = tracker();
  mt.update(frame(person(0.5, 0.6, 0.2)), 0);
  mt.tracks[0].judge.next = { type: 'norep', reasons: ['x'] };
  mt.update(frame(person(0.5, 0.6, 0.2)), 66);
  mt.tracks[0].judge.next = rep(1000, 38000);
  const none = mt.update(frame(person(0.5, 0.6, 0.2)), 132);
  assert.deepEqual(none, []); assert.equal(mt.athletes.length, 0);
  assert.equal(mt.tracks[0].judge.count, 0, 'they start again from nothing');
  // their next one, done in one go, is rep 1: nothing is carried over
  mt.tracks[0].judge.next = rep(40000, 42700);
  const [e] = mt.update(frame(person(0.5, 0.6, 0.2)), 198);
  assert.equal(mt.athletes.length, 1); assert.equal(e.ev.count, 1); assert.equal(mt.tracks[0].judge.noReps, 0);
});

test('multi: once someone is an athlete, a slow rep still counts', () => {
  const mt = tracker();
  mt.update(frame(person(0.5, 0.6, 0.2)), 0);
  mt.tracks[0].judge.next = rep(0, 2500);
  mt.update(frame(person(0.5, 0.6, 0.2)), 66);
  mt.tracks[0].judge.next = rep(3000, 45000); // a long rest on the ground
  const [e] = mt.update(frame(person(0.5, 0.6, 0.2)), 132);
  assert.equal(e.ev.count, 2);
});

test('multi: someone at the very side of the picture (half out of it, or a reflection in a mirror there) doesn\'t become an athlete', () => {
  for (const x of [0.03, 0.97]) {
    const mt = tracker();
    mt.update(frame(person(x, 0.6, 0.2)), 0);
    mt.tracks[0].judge.next = rep(0, 2000);
    assert.deepEqual(mt.update(frame(person(x, 0.6, 0.2)), 66), []);
    assert.equal(mt.athletes.length, 0, `at ${x}`);
  }
  const mt = tracker();
  mt.update(frame(person(0.1, 0.6, 0.2)), 0);
  mt.tracks[0].judge.next = rep(0, 2000);
  mt.update(frame(person(0.1, 0.6, 0.2)), 66);
  assert.equal(mt.athletes.length, 1, 'a little way in is fine');
});

test('multi: an athlete lost for a while and found again is carried on even by a slow rep', () => {
  const mt = tracker();
  mt.update(frame(person(0.2, 0.6, 0.2)), 0);
  mt.tracks[0].judge.next = rep(0, 2000);
  mt.update(frame(person(0.2, 0.6, 0.2)), 66);
  mt.update(frame(person(0.22, 0.6, 0.2)), 5000);
  trackAt(mt, 0.22).judge.next = rep(5000, 17000);
  const [e] = mt.update(frame(person(0.22, 0.6, 0.2)), 5066);
  assert.equal(mt.athletes.length, 1); assert.equal(e.ev.count, 2);
});

// ---- how many people the pose model is asked for
const boxOf = (h) => ({ x0: 0.1, x1: 0.15, y0: 0.2, y1: 0.2 + h });
const crowd = (n, h = 0.3) => Array.from({ length: n }, () => boxOf(h));

test('multi: five people are followed at once; ten while more than five keep being seen, then five again once they\'ve gone', () => {
  const st = {};
  assert.equal(peopleWanted(st, crowd(3), 0), 5);
  assert.equal(peopleWanted(st, crowd(8), 500), 5, 'seen once: not yet');
  assert.equal(peopleWanted(st, crowd(8), 1000), 5);
  assert.equal(peopleWanted(st, crowd(8), 2000), 10, 'still there a second and a half later');
  assert.equal(peopleWanted(st, crowd(4), 2500), 10);
  assert.equal(peopleWanted(st, crowd(7), 12000), 10, 'they came back: the wait starts again');
  assert.equal(peopleWanted(st, crowd(4), 13000), 10);
  assert.equal(peopleWanted(st, crowd(4), 32000), 10);
  assert.equal(peopleWanted(st, crowd(5), 33000), 5, 'five or fewer for 20 s');
  assert.equal(MULTI_DEFAULTS.maxPeopleBusy, 10);
});

test('multi: people far in the background don\'t count towards asking for more, and one crowded look doesn\'t either', () => {
  const st = {};
  for (let t = 0; t <= 5000; t += 500) assert.equal(peopleWanted(st, [...crowd(4), ...crowd(6, 0.05)], t), 5);
  const flicker = {};
  for (let t = 0; t <= 6000; t += 500) assert.equal(peopleWanted(flicker, crowd(t % 1000 ? 4 : 7), t), 5);
});

// ---- saved skeletons are timed by when their frame arrived, on a steady line through the arrivals
test('multi: frames arriving in bunches are timed evenly, as they were filmed', () => {
  const stamp = arrivalClock(), t0 = 1_800_000_000_000;
  let rtp = 4_000_000_000; // near the top of its range: it wraps round on the way
  const out = [];
  for (let i = 0; i < 60; i++) {
    const filmed = i * 100 / 3, late = i % 6 === 5 ? 0 : (5 - (i % 6)) * 12; // every sixth frame arrives on time, the ones before it late
    out.push(stamp(t0 + filmed + late, (rtp + i * 3000) >>> 0, filmed + late));
  }
  for (let i = 12; i < 60; i++) assert.ok(Math.abs(out[i] - (t0 + i * 100 / 3)) <= 2, `frame ${i}: ${out[i] - t0} against ${i * 100 / 3}`);
});

test('multi: the line follows a phone whose clock runs slow, and starts again on a new connection', () => {
  const stamp = arrivalClock(), t0 = 1_800_000_000_000;
  let last = 0;
  // the phone's second is 1.0005 of ours: after 10 minutes its frames arrive 300 ms later than its timestamps say
  for (let i = 0; i <= 18000; i++) { const got = t0 + i * (100 / 3) * 1.0005; last = stamp(got, i * 3000, got - t0) - got; }
  assert.ok(Math.abs(last) <= 3, `off by ${last} ms after 10 minutes`);
  // a new connection: its timestamps start somewhere else
  const got = t0 + 700000;
  assert.equal(stamp(got, 123456789, 700000), got);
  assert.equal(stamp(got + 33, 123456789 + 3000, 700033), got + 33);
  assert.equal(arrivalClock()(t0 + 5, null, 5), t0 + 5, 'a browser that gives no timestamp: when it arrived');
});

// ---- the live outline between two of the judge's snapshots
test('multi: between two snapshots everyone is drawn part of the way from one to the next', () => {
  const lm = (x) => [{ x, y: 0.5, visibility: 0.9 }, { x: x + 0.1, y: 0.6, visibility: 0.2 }];
  const a = { at: 1000, snap: { t: 0, tracks: [{ id: 1, label: 1, count: 3, lm: lm(0.2), box: { x: 0.2, top: 0.4, tilt: null } }, { id: 2, label: null, lm: lm(0.7), box: { x: 0.7, top: 0.4 } }] } };
  const b = { at: 1200, snap: { t: 0, tracks: [{ id: 1, label: 1, count: 4, lm: lm(0.3), box: { x: 0.3, top: 0.5, tilt: null } }, { id: 3, label: null, lm: lm(0.9), box: { x: 0.9, top: 0.4 } }] } };
  const mid = blendSnaps(a, b, 1100);
  assert.ok(Math.abs(mid.tracks[0].lm[0].x - 0.25) < 1e-9); assert.ok(Math.abs(mid.tracks[0].box.top - 0.45) < 1e-9);
  assert.equal(mid.tracks[0].count, 3, 'the count is the shown snapshot\'s'); assert.equal(mid.tracks[0].lm[1].visibility, 0.2);
  assert.equal(mid.tracks[1].lm[0].x, 0.7, 'someone not in the next one stays put'); assert.equal(mid.tracks.length, 2);
  assert.equal(blendSnaps(a, b, 1000), a.snap); assert.equal(blendSnaps(a, undefined, 1100), a.snap);
  assert.ok(Math.abs(blendSnaps(a, b, 5000).tracks[0].lm[0].x - 0.3) < 1e-9, 'never past the next one');
  assert.equal(blendSnaps(a, { at: 1600, snap: b.snap }, 1300), a.snap, 'too far apart to be one movement');
  const one = blendSnaps({ at: 0, snap: { t: 0, lm: lm(0.2), reps: 1 } }, { at: 100, snap: { t: 0, lm: lm(0.4), reps: 2 } }, 50);
  assert.ok(Math.abs(one.lm[0].x - 0.3) < 1e-9); assert.equal(one.reps, 1);
});

// ---- the first rep's jump has to be read from a foot the pose model is sure of
const jumped = (jumpSure, jumpBy = 'toes') => ({ type: 'rep', detail: { downAt: 0, endAt: 2500, jumpBy, jumpSure } });

test('multi: a first "rep" whose jump was read from a hidden foot (someone bending over a chair) doesn\'t make an athlete', () => {
  for (const sure of [0, 0.32, 0.6]) {
    const mt = tracker();
    mt.update(frame(person(0.5, 0.6, 0.2)), 0);
    mt.tracks[0].judge.next = jumped(sure);
    assert.deepEqual(mt.update(frame(person(0.5, 0.6, 0.2)), 66), [], `foot ${sure} sure`);
    assert.equal(mt.athletes.length, 0);
    assert.equal(mt.tracks[0].judge.count, 0, 'they start again from nothing');
  }
});

test('multi: a first rep with the feet clearly seen, read from the whole body, or from a caller that doesn\'t say, makes an athlete', () => {
  for (const ev of [jumped(0.8), jumped(0.99), jumped(null, 'body'), jumped(null), { type: 'rep' }]) {
    const mt = tracker();
    mt.update(frame(person(0.5, 0.6, 0.2)), 0);
    mt.tracks[0].judge.next = ev;
    mt.update(frame(person(0.5, 0.6, 0.2)), 66);
    assert.equal(mt.athletes.length, 1, JSON.stringify(ev));
  }
  assert.equal(MULTI_DEFAULTS.firstRepFoot, 0.7);
});

test('multi: once someone is an athlete, a rep with a foot hidden for a moment still counts', () => {
  const mt = tracker();
  mt.update(frame(person(0.5, 0.6, 0.2)), 0);
  mt.tracks[0].judge.next = jumped(0.95);
  mt.update(frame(person(0.5, 0.6, 0.2)), 66);
  mt.tracks[0].judge.next = jumped(0.3);
  const [e] = mt.update(frame(person(0.5, 0.6, 0.2)), 132);
  assert.equal(e.ev.count, 2);
});

// ---- a top that reads differently standing and bent over (a spotlight on the front, the back in shade)
// blue from behind when the torso is tilted over, near grey from the front when upright; the picture's colour is given per call
const leaning = (x, tiltDeg, h = 0.3) => { const lm = person(x, 0.6, h), a = (tiltDeg * Math.PI) / 180; for (const i of [11, 12]) lm[i] = { ...lm[i], x: x + Math.sin(a) * h * 0.3, y: 0.6 - Math.cos(a) * h * 0.3 }; return lm; };
const GREY = () => [150, 130, 140], BLUE = () => [25, 60, 190];

test('multi: an athlete whose top reads differently standing and bent over keeps one track through a burpee', () => {
  const mt = tracker();
  let t = 0;
  const look = (tilt, colour) => mt.update(frame(leaning(0.5, tilt)), (t += 66), 1, colour);
  for (let i = 0; i < 12; i++) look(5, GREY);          // standing: grey from the front
  for (const tilt of [50, 60, 70, 80, 85, 85, 85, 85, 85, 85]) look(tilt, BLUE);   // going down and lying: blue
  for (const tilt of [75, 65, 55, 50]) look(tilt, GREY);   // getting up: already grey, still counted as lying
  for (let i = 0; i < 6; i++) look(5, GREY);
  for (const tilt of [50, 60, 70, 80]) look(tilt, BLUE);   // and down again
  assert.equal(mt.tracks.length, 1, 'never taken for someone else');
});

test('multi: someone unlike both of an athlete\'s looks still doesn\'t take their track', () => {
  const mt = tracker();
  let t = 0;
  for (let i = 0; i < 8; i++) mt.update(frame(leaning(0.5, 5)), (t += 66), 1, GREY);
  for (let i = 0; i < 8; i++) mt.update(frame(leaning(0.5, 85)), (t += 66), 1, BLUE);
  mt.update(frame(leaning(0.51, 80)), (t += 66), 1, () => [220, 120, 150]); // on their spot, in pink
  assert.equal(mt.tracks.length, 2);
});

// ---- a crowd: the person finder looks at the picture in parts, and says when there are more people than a live judge follows
test("multi: the finder's parts of a wide picture are squares as tall as it, half over the next, covering it all", () => {
  const parts = finderTiles(16 / 9);
  assert.equal(parts.length, 3);
  for (const p of parts) { assert.equal(p.y, 0); assert.equal(p.h, 1); assert.ok(Math.abs(p.w - 9 / 16) < 1e-9, 'square in pixels'); }
  assert.equal(parts[0].x, 0); assert.ok(Math.abs(parts.at(-1).x + parts.at(-1).w - 1) < 1e-9, 'reaches the far side');
  for (let i = 1; i < parts.length; i++) assert.ok(parts[i].x < parts[i - 1].x + parts[i - 1].w / 2 + 1e-9, 'at least half over the one before');
  // a tall picture (a phone held upright): the same, down it
  assert.deepEqual(finderTiles(9 / 16).map((p) => [p.x, p.w, +p.h.toFixed(4)]), [[0, 1, 0.5625], [0, 1, 0.5625], [0, 1, 0.5625]]);
  // nearly square: the whole picture is already close to full detail
  assert.deepEqual(finderTiles(1.1), []);
});

test('multi: the smaller parts, for a video analysed afterwards, are half that size and cover the picture too', () => {
  const coarse = finderTiles(16 / 9), all = finderTiles(16 / 9, { fine: true }), fine = all.slice(coarse.length);
  assert.deepEqual(all.slice(0, coarse.length), coarse);
  assert.ok(fine.length >= 12 && fine.length <= 30, `${fine.length} smaller parts`);
  for (const p of fine) { assert.ok(Math.abs(p.h - 0.5) < 1e-9); assert.ok(Math.abs(p.w - 9 / 32) < 1e-9); assert.ok(p.x >= 0 && p.x + p.w <= 1 + 1e-9 && p.y >= 0 && p.y + p.h <= 1 + 1e-9); }
  // every point of the picture is inside one of them, well away from its edge sideways
  for (let x = 0.02; x < 1; x += 0.02) for (let y = 0.02; y < 1; y += 0.04) assert.ok(fine.some((p) => x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h), `(${x.toFixed(2)}, ${y.toFixed(2)}) is covered`);
  assert.equal(finderTiles(1, { fine: true }).length, 9, 'a square picture: three by three');
});

test('multi: someone the finder saw in two parts is one person, and a box cut off by the edge of its part gives way to the whole one', () => {
  const left = { x: 0, y: 0, w: 0.5625, h: 1 }, mid = { x: 0.21875, y: 0, w: 0.5625, h: 1 };
  const got = mergeBoxes([
    { x0: 0.30, y0: 0.4, x1: 0.40, y1: 0.7, score: 0.8, part: left }, { x0: 0.31, y0: 0.41, x1: 0.40, y1: 0.7, score: 0.6, part: mid }, // the same person twice
    { x0: 0.50, y0: 0.4, x1: 0.5625, y1: 0.7, score: 0.9, part: left },  // half of someone, at the left part's right-hand edge
    { x0: 0.50, y0: 0.4, x1: 0.62, y1: 0.7, score: 0.5, part: mid },     // all of them, in the middle part
    { x0: 0.02, y0: 0.5, x1: 0.10, y1: 0.8, score: 0.4 },                // seen in the whole picture only
  ]);
  assert.deepEqual(got.map((b) => [b.x0, b.x1, b.score]), [[0.30, 0.40, 0.8], [0.50, 0.62, 0.5], [0.02, 0.10, 0.4]]);
  assert.ok(got.every((b) => !('part' in b) && !('cut' in b)), 'only the boxes come back');
  // at the edge of the picture itself nobody is cut off by a part
  assert.equal(mergeBoxes([{ x0: 0, y0: 0.4, x1: 0.08, y1: 0.7, score: 0.5, part: left }, { x0: 0.0, y0: 0.38, x1: 0.2, y1: 0.72, score: 0.4 }]).length, 2);
});

test("multi: five or more people in view for three seconds is a crowd; people far in the background do not count", () => {
  const body = (x, h = 0.3) => ({ x0: x, x1: x + 0.05, y0: 0.5, y1: 0.5 + h, score: 0.9 });
  const five = [body(0.1), body(0.3), body(0.5), body(0.7), body(0.9)], s = {};
  assert.equal(crowdSeen(s, five, 0, 16 / 9), false, 'only just seen');
  assert.equal(crowdSeen(s, five, 2900, 16 / 9), false);
  assert.equal(crowdSeen(s, five, 3000, 16 / 9), true);
  assert.equal(crowdSeen(s, five.slice(0, 4), 3500, 16 / 9), false, 'an athlete and three officials are not a crowd');
  assert.equal(crowdSeen(s, five, 4000, 16 / 9), false, 'it starts again');
  assert.equal(crowdSeen(s, five, 7000, 16 / 9), true);
  const far = {};
  for (const t of [0, 3000, 6000]) assert.equal(crowdSeen(far, [body(0.1), body(0.3), body(0.4), body(0.5, 0.05), body(0.7, 0.05), body(0.9, 0.05)], t, 16 / 9), false, 'three athletes and three spectators far off');
  assert.equal(MULTI_DEFAULTS.crowdPeople, 5);
});
