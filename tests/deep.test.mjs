// A crowd in front of a camera: its recording is analysed again in full afterwards (server/deep.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createDeep } = require('../server/deep.js');

const QUIET = 90e3, T0 = Date.parse('2026-11-20T22:10:00Z');
// a server's folders, a pretend list of analyses, and a clock the test moves
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hj-deep-')), dir = path.join(root, 'recordings'), uploadsDir = path.join(root, 'training');
  const s = { now: T0, jobs: [], prepared: [], queued: [], done: [], answer: () => ({ replaced: 2 }) };
  const jobs = { add: (video, name) => { const j = { video, name, state: 'queued', pct: 0 }; s.jobs.push(j); return j; }, list: () => s.jobs };
  // a camera's recording, named as the streaming server names them, last written to at `end`
  const record = (cam, startIso, minutes) => {
    const d = path.join(dir, 'live', `station${cam}`); fs.mkdirSync(d, { recursive: true });
    const name = `${startIso.replace(/:/g, '-').replace('T', '_').replace('Z', '')}-000000Z.mp4`, file = path.join(d, name);
    fs.writeFileSync(file, 'video');
    const end = new Date(Date.parse(startIso) + minutes * 60e3); fs.utimesSync(file, end, end);
    return name;
  };
  const make = () => createDeep({ dir, uploadsDir, stateFile: path.join(root, 'deep.json'), jobs, quietMs: QUIET, now: () => s.now,
    prepare: async (src, dst) => { s.prepared.push(path.basename(src)); fs.copyFileSync(src, dst); },
    onQueued: (f) => s.queued.push(f.video), onDone: (f) => { s.done.push(f.video); return s.answer(f); } });
  return { s, record, make, deep: make(), uploadsDir };
}

test('a finished recording a crowd was in is queued for analysis; one with no crowd, or still being made, is left', async () => {
  const { s, record, deep, uploadsDir } = setup();
  const crowded = record(1, '2026-11-20T22:00:00Z', 10), quiet = record(2, '2026-11-20T22:00:03Z', 10), going = record(1, '2026-11-20T22:10:00Z', 4);
  deep.note(1, Date.parse('2026-11-20T22:04:00Z'));           // camera 1's judge saw a crowd four minutes in...
  deep.note(1, Date.parse('2026-11-20T22:12:00Z'));           // ...and again in the next recording, which is still being written
  s.now = Date.parse('2026-11-20T22:14:10Z');
  await deep.tick();
  assert.deepEqual(s.prepared, [crowded]);
  assert.equal(s.jobs.length, 1);
  assert.match(s.jobs[0].name, /^Camera 1 22:00 deep analysis$/);
  assert.ok(fs.existsSync(path.join(uploadsDir, s.jobs[0].video)), 'the copy to analyse is in the uploads folder');
  assert.deepEqual(s.queued, [s.jobs[0].video], 'the copy is tied to its recording before it is analysed');
  const [e] = deep.list();
  assert.deepEqual([e.cam, e.file, e.state, e.startedAt], [1, crowded, 'queued', '2026-11-20T22:00:00.000Z']);
  // asked again, nothing is queued twice
  await deep.tick();
  assert.equal(s.jobs.length, 1);
  // the second recording finishes: it's queued in its turn; camera 2's never is
  s.now = Date.parse('2026-11-20T22:20:00Z') + QUIET;
  await deep.tick();
  assert.deepEqual(s.prepared, [crowded, going]);
  assert.ok(!s.prepared.includes(quiet));
});

test('the analysis is followed; when it is done the live counts give way, and it says how many', async () => {
  const { s, record, deep } = setup();
  record(1, '2026-11-20T22:00:00Z', 10);
  deep.note(1, Date.parse('2026-11-20T22:05:00Z'));
  s.now = Date.parse('2026-11-20T22:12:00Z');
  await deep.tick();
  assert.equal(deep.active(), true);
  Object.assign(s.jobs[0], { state: 'waiting', pct: 0 }); await deep.tick();
  assert.equal(deep.list()[0].state, 'waiting');
  Object.assign(s.jobs[0], { state: 'running', pct: 40 }); await deep.tick();
  assert.deepEqual([deep.list()[0].state, deep.list()[0].pct], ['running', 40]);
  assert.deepEqual(s.done, []);
  Object.assign(s.jobs[0], { state: 'done', pct: 100 }); await deep.tick();
  assert.deepEqual(s.done, [s.jobs[0].video]);
  assert.deepEqual([deep.list()[0].state, deep.list()[0].pct, deep.list()[0].replaced], ['done', 100, 2]);
  assert.equal(deep.active(), false);
  await deep.tick();
  assert.equal(s.done.length, 1, 'only once');
});

test('a deep analysis that counted fewer reps than the live judge leaves the live counts, and says so', async () => {
  const { s, record, deep } = setup();
  record(1, '2026-11-20T22:00:00Z', 10);
  deep.note(1, Date.parse('2026-11-20T22:05:00Z'));
  s.now = Date.parse('2026-11-20T22:12:00Z');
  s.answer = () => ({ replaced: 0, kept: 'fewer' });
  await deep.tick();
  s.jobs[0].state = 'done'; await deep.tick();
  assert.deepEqual([deep.list()[0].state, deep.list()[0].replaced, deep.list()[0].kept], ['done', 0, 'fewer']);
});

test('the server stopping: what was being analysed, and a crowded recording that never got its turn, are listed as not finished', async () => {
  const { s, record, make, deep } = setup();
  const first = record(1, '2026-11-20T22:00:00Z', 10), last = record(1, '2026-11-20T22:10:00Z', 3);
  deep.note(1, Date.parse('2026-11-20T22:05:00Z'));
  deep.note(1, Date.parse('2026-11-20T22:12:30Z'));
  s.now = Date.parse('2026-11-20T22:13:00Z');
  await deep.tick();                                          // the first is being analysed; the last is still being recorded
  s.jobs[0].state = 'running';
  await deep.tick();
  Object.assign(s.jobs[0], { state: 'stopped', why: 'The booking ended before it finished.' });
  await deep.tick();
  deep.close();
  const list = deep.list();
  assert.deepEqual(list.map((e) => [e.file, e.state]), [[last, 'stopped'], [first, 'stopped']]);
  assert.match(list[0].why, /booking ended/);
  assert.equal(list[0].video, '', 'nothing was copied for it');
  // it's remembered if the server's program starts again
  assert.deepEqual(make().list().map((e) => e.state), ['stopped', 'stopped']);
});

test('a crowd is one stretch while the judge keeps saying so, and only the recordings it lasted through are analysed', async () => {
  const { s, record, deep } = setup();
  const before = record(1, '2026-11-20T21:40:00Z', 10), during = record(1, '2026-11-20T21:50:00Z', 10), after = record(1, '2026-11-20T22:00:00Z', 10);
  for (let t = Date.parse('2026-11-20T21:52:00Z'); t <= Date.parse('2026-11-20T21:58:00Z'); t += 10e3) deep.note(1, t);
  s.now = Date.parse('2026-11-20T22:30:00Z');
  await deep.tick();
  assert.deepEqual(s.prepared, [during]);
  assert.ok(!s.prepared.includes(before) && !s.prepared.includes(after));
  assert.equal(deep.crowdNow(1), false, 'half an hour ago');
  deep.note(2); assert.equal(deep.crowdNow(2), true);
});

test('a recording that cannot be copied is listed as failed, and the rest carry on', async () => {
  const { s, record, uploadsDir } = setup(), root = path.dirname(uploadsDir);
  const bad = record(1, '2026-11-20T22:00:00Z', 5), good = record(2, '2026-11-20T22:00:03Z', 5);
  const jobs = { add: (video) => { s.jobs.push({ video, state: 'queued', pct: 0 }); }, list: () => s.jobs };
  const deep = createDeep({ dir: path.join(root, 'recordings'), uploadsDir, stateFile: path.join(root, 'deep.json'), jobs, quietMs: QUIET, now: () => s.now,
    prepare: async (src, dst) => { if (src.includes('station1')) throw new Error('disk full'); fs.copyFileSync(src, dst); } });
  deep.note(1, Date.parse('2026-11-20T22:02:00Z')); deep.note(2, Date.parse('2026-11-20T22:02:00Z'));
  s.now = Date.parse('2026-11-20T22:10:00Z');
  await deep.tick();
  const by = Object.fromEntries(deep.list().map((e) => [e.file, e]));
  assert.equal(by[bad].state, 'failed'); assert.match(by[bad].why, /disk full/);
  assert.equal(by[good].state, 'queued');
  assert.equal(s.jobs.length, 1);
});

// ---- what the live judge counted there gives way to it
const { givesWay } = require('../server/deep.js');
const liveA = (n, cam, firstAt, reps) => ({ n, src: 'live', cam, video: '', firstAt, lastAt: firstAt, reps, noReps: 0 });
const deepA = (n, video, reps) => ({ n, src: 'upload', cam: 0, video, firstAt: '2026-11-20T22:30:00.000Z', lastAt: '2026-11-20T22:30:00.000Z', reps, noReps: 0 });
const FROM = Date.parse('2026-11-20T22:00:00Z'), TO = Date.parse('2026-11-20T22:10:00Z');

test('the live entries that began in the recording, on that camera, give way to its deep analysis', () => {
  const list = [
    liveA(1, 1, '2026-11-20T22:01:00.000Z', 2), liveA(2, 1, '2026-11-20T22:09:59.000Z', 1),   // in it
    liveA(3, 1, '2026-11-20T21:59:00.000Z', 5), liveA(4, 1, '2026-11-20T22:10:30.000Z', 5),   // before and after it
    liveA(5, 2, '2026-11-20T22:05:00.000Z', 5),                                               // another camera
    { ...liveA(6, 1, '2026-11-20T22:02:00.000Z', 9), replaced: '2026-11-20T22:20:00.000Z' },  // already given way to an earlier one
    deepA(7, 'cam1_deep.mp4', 6), deepA(8, 'cam1_deep.mp4', 5), deepA(9, 'other.mp4', 40),
  ];
  const got = givesWay(list, 1, FROM, TO, 'cam1_deep.mp4');
  assert.deepEqual(got.live.map((a) => a.n), [1, 2]);
  assert.equal(got.kept, '');
});

test('a deep analysis that counted fewer reps than the live judge did there replaces nothing', () => {
  const list = [liveA(1, 1, '2026-11-20T22:01:00.000Z', 6), liveA(2, 1, '2026-11-20T22:03:00.000Z', 6), deepA(7, 'cam1_deep.mp4', 11)];
  assert.deepEqual(givesWay(list, 1, FROM, TO, 'cam1_deep.mp4'), { live: [], kept: 'fewer' });
  // as many, or nobody counted live at all: it stands
  list.push(deepA(8, 'cam1_deep.mp4', 1));
  assert.equal(givesWay(list, 1, FROM, TO, 'cam1_deep.mp4').live.length, 2);
  assert.deepEqual(givesWay([deepA(7, 'cam1_deep.mp4', 0)], 1, FROM, TO, 'cam1_deep.mp4'), { live: [], kept: '' });
});
