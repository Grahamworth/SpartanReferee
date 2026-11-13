// Run with: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCones, ConeTracker, coneReadBox } from '../cones.js';
import { MultiTracker } from '../multi.js';
import { TRACKING } from '../pose-filter.js';

// ---- pictures: a grey ground, with shapes painted on
function picture(W = 320, H = 180) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < d.length; i += 4) { d[i] = 110; d[i + 1] = 115; d[i + 2] = 105; d[i + 3] = 255; }
  return { W, H, d, paint(test, rgb) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (test(x, y)) { const i = (y * W + x) * 4; d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; } } };
}
const ORANGE = [240, 110, 20], WHITE = [245, 245, 245];
// a traffic cone standing at (cx, base), h tall, with a white band a third of the way down
function cone(p, cx, base, h, band = true) {
  const top = base - h;
  p.paint((x, y) => y >= top && y < base && Math.abs(x - cx) <= 1 + ((y - top) / h) * h * 0.4, ORANGE);
  if (band) p.paint((x, y) => y >= top + h * 0.35 && y < top + h * 0.45 && Math.abs(x - cx) <= 1 + ((y - top) / h) * h * 0.4, WHITE);
}

test('cones: a cone is found where it stands, white band and all', () => {
  const p = picture(); cone(p, 100, 150, 30);
  const c = findCones(p.d, p.W, p.H);
  assert.equal(c.length, 1);
  assert.ok(Math.abs(c[0].x - 100.5 / 320) < 0.01 && Math.abs(c[0].y - 150 / 180) < 0.01, JSON.stringify(c[0]));
  assert.ok(c[0].h > 28 / 180);
});

test('cones: several cones in a row, a small far one too', () => {
  const p = picture(); cone(p, 60, 160, 28); cone(p, 160, 160, 28); cone(p, 260, 100, 9, false);
  assert.equal(findCones(p.d, p.W, p.H).length, 3);
});

test('cones: an orange top (a box, as wide at the top), skin and a wall aren\'t cones', () => {
  const p = picture();
  p.paint((x, y) => x >= 40 && x < 70 && y >= 40 && y < 90, ORANGE);               // a top
  p.paint((x, y) => x >= 120 && x < 140 && y >= 40 && y < 80, [200, 150, 120]);     // skin: not strong enough
  p.paint((x, y) => x >= 180 && y < 120, ORANGE);                                     // a wall
  assert.deepEqual(findCones(p.d, p.W, p.H), []);
});

test('cones: the colour chosen is the one looked for', () => {
  const p = picture(); cone(p, 100, 150, 30);
  assert.equal(findCones(p.d, p.W, p.H, 'blue').length, 0);
  const q = picture(); q.paint((x, y) => y >= 120 && y < 150 && Math.abs(x - 100) <= 1 + (y - 120) * 0.4, [30, 80, 230]);
  assert.equal(findCones(q.d, q.W, q.H, 'blue').length, 1);
});

test('cones: only a cone that stays put is kept; one that moves (a top doing burpees) isn\'t', () => {
  const ct = new ConeTracker();
  const still = { x: 0.3, y: 0.8, x0: 0.28, x1: 0.32, y0: 0.7, y1: 0.8, w: 0.04, h: 0.1 };
  for (let i = 0; i < 4; i++) {
    const moving = { ...still, x: 0.6, y: 0.4 + (i % 2) * 0.15 };
    ct.update([still, moving], i * 500);
  }
  assert.equal(ct.sure.length, 1);
  assert.equal(ct.sure[0].x, 0.3);
  // something on a body is never counted
  const ct2 = new ConeTracker();
  for (let i = 0; i < 4; i++) ct2.update([still], i * 500, () => true);
  assert.equal(ct2.sure.length, 0);
  // hidden for a while (someone in front of it), it's still known; gone for good, forgotten
  ct.update([], 5000); assert.equal(ct.sure.length, 1);
  ct.update([], 40000); assert.equal(ct.sure.length, 0);
});

test('cones: a number read the same way twice is the cone\'s', () => {
  const ct = new ConeTracker(), c = { number: null, reads: [], tries: 0 };
  ct.read(c, '7'); ct.read(c, null); assert.equal(c.number, null);
  ct.read(c, '1'); ct.read(c, '7'); assert.equal(c.number, '7');
  const b = coneReadBox({ x0: 0.5, x1: 0.6, y0: 0.5, y1: 0.7, w: 0.1, h: 0.2 });
  assert.ok(b.y0 < 0.5 && b.x0 < 0.5 && b.x1 > 0.6, 'it reads above the cone and either side too');
});

// ---- the tracker, with cones
function person(x, y = 0.6, h = 0.4) {
  const lm = Array.from({ length: 33 }, (_, i) => ({ x, y: y - h / 2 + (h * i) / 32, z: 0, visibility: 0.9 }));
  lm[23] = { x: x - 0.02, y, z: 0, visibility: 0.9 };
  lm[24] = { x: x + 0.02, y, z: 0, visibility: 0.9 };
  return lm;
}
const frame = (...people) => ({ landmarks: people, worldLandmarks: people.map((lm) => lm.map(() => ({ x: 0, y: 0, z: 0 }))) });
class FakeJudge {
  constructor() { this.count = 0; this.noReps = 0; this.reasonCounts = {}; this.next = null; this.o = { targetReps: 30 }; this.done = false; }
  update() { const ev = this.next; this.next = null; if (ev?.type === 'rep') ev.count = ++this.count; return ev; }
  finish() { return null; }
}
const tracker = (opts = {}) => new MultiTracker({ make: () => new FakeJudge(), tracking: TRACKING.balanced, metricOpts: () => ({}), opts });
const at = (mt, x) => mt.tracks.find((k) => Math.abs(k.box.x - x) < 0.06);
const rep = (k) => { k.judge.next = { type: 'rep' }; };

test('cones: with cones out, someone doing reps away from any cone isn\'t counted; behind one, they are', () => {
  const mt = tracker();
  mt.setCones([{ id: 1, x: 0.2, y: 0.55 }]);   // top left of someone at 0.3
  mt.update(frame(person(0.3), person(0.8)), 0);
  rep(at(mt, 0.3)); rep(at(mt, 0.8));
  mt.update(frame(person(0.3), person(0.8)), 66);
  assert.equal(mt.athletes.length, 1);
  assert.equal(mt.athletes[0].cone, 1);
  assert.ok(Math.abs(mt.athletes[0].box.x - 0.3) < 0.01);
  assert.equal(at(mt, 0.8).judge.count, 0, 'the one away from the cones starts again from nothing');
});

test('cones: with no cones seen, everyone doing reps counts as before', () => {
  const mt = tracker();
  mt.update(frame(person(0.3), person(0.8)), 0);
  rep(at(mt, 0.3)); rep(at(mt, 0.8));
  mt.update(frame(person(0.3), person(0.8)), 66);
  assert.equal(mt.athletes.length, 2);
});

test('cones: two athletes side by side each get their own cone, the one on the usual side', () => {
  const mt = tracker();
  // cones top left of each: 0.27 for the athlete at 0.35, 0.57 for the one at 0.65
  mt.setCones([{ id: 1, x: 0.27, y: 0.5 }, { id: 2, x: 0.57, y: 0.5 }]);
  mt.update(frame(person(0.35), person(0.65)), 0);
  rep(at(mt, 0.35)); rep(at(mt, 0.65));
  mt.update(frame(person(0.35), person(0.65)), 66);
  assert.equal(at(mt, 0.35).cone, 1);
  assert.equal(at(mt, 0.65).cone, 2, 'not cone 1, though that\'s nearly as near: it\'s on the wrong side and taken');
});

test('cones: an athlete lost for a while is picked up behind their cone, even after the camera moved', () => {
  const mt = tracker();
  mt.setCones([{ id: 1, x: 0.2, y: 0.55 }]);
  mt.update(frame(person(0.3)), 0);
  rep(at(mt, 0.3));
  mt.update(frame(person(0.3)), 66);
  const a = mt.athletes[0];
  for (let t = 132; t < 3000; t += 66) mt.update(frame(person(0.3)), t);
  // gone for 3 s, while the camera turned: everything is 0.3 further right (too far for their old spot), the cone too
  mt.update(frame(), 3100);
  mt.setCones([{ id: 1, x: 0.5, y: 0.55 }]);
  mt.update(frame(), 6100);
  mt.update(frame(person(0.6)), 6166);
  rep(at(mt, 0.6));
  mt.update(frame(person(0.6)), 6232);
  assert.equal(mt.athletes.length, 1, 'still one athlete');
  assert.equal(mt.athletes[0].label, a.label);
  assert.equal(mt.athletes[0].judge.count, 2);
});

test('cones: an athlete counted before the cones were found gets theirs once they are', () => {
  const mt = tracker();
  mt.update(frame(person(0.3)), 0);
  rep(at(mt, 0.3));
  mt.update(frame(person(0.3)), 66);
  assert.equal(mt.athletes[0].cone, undefined);
  mt.setCones([{ id: 4, x: 0.22, y: 0.55, number: '12' }]);
  assert.equal(mt.athletes[0].cone, 4);
  assert.equal(mt.coneOf(mt.athletes[0]).number, '12');
});

test('cones: by number, cones of any colour are found, and only one whose number is read is used', () => {
  const p = picture(); cone(p, 60, 160, 28); p.paint((x, y) => y >= 132 && y < 160 && Math.abs(x - 160) <= 1 + (y - 132) * 0.4, [30, 80, 230]);
  p.paint((x, y) => y >= 132 && y < 160 && Math.abs(x - 260) <= 1 + (y - 132) * 0.4, [40, 200, 60]);
  assert.equal(findCones(p.d, p.W, p.H, 'any').length, 3, 'orange, blue and green');
  const ct = new ConeTracker({ needNumber: true });
  const a = { x: 0.3, y: 0.8, x0: 0.28, x1: 0.32, y0: 0.7, y1: 0.8, w: 0.04, h: 0.1 }, b = { ...a, x: 0.6, x0: 0.58, x1: 0.62 };
  for (let i = 0; i < 4; i++) ct.update([a, b], i * 500);
  assert.equal(ct.still.length, 2, 'both stayed put, so both are read');
  assert.equal(ct.sure.length, 0, 'neither is used before its number is read');
  const [c1] = ct.still; ct.read(c1, '21'); ct.read(c1, '21');
  assert.deepEqual(ct.sure.map((c) => c.number), ['21']);
});
