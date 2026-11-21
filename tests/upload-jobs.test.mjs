// Uploaded videos are analysed on the server, one at a time, in the background.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const { createUploadJobs } = createRequire(import.meta.url)('../server/upload-jobs.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (ok) => { for (let i = 0; i < 400; i++) { if (ok()) return true; await sleep(5); } return false; };
// a pretend Chrome: each video's analysis is whatever the test says, and every browser started or stopped is noted
function setup(over = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hj-jobs-')), s = { analysis: {}, urls: [], procs: [], paused: [], stops: 0, busy: false, seeded: '' };
  const spawnFn = () => { const p = new EventEmitter(); p.kill = () => { p.killed = true; }; s.procs.push(p); return p; };
  const connectFn = async () => ({ ws: { close() {} }, send: async (method, params = {}) => {
    if (method === 'Page.addScriptToEvaluateOnNewDocument') s.seeded = params.source;
    if (method === 'Page.navigate') s.urls.push(params.url);
    if (method !== 'Runtime.evaluate') return {};
    const e = params.expression;
    if (/a\.paused = true/.test(e)) s.paused.push(s.urls.at(-1));
    if (/if \(true\) a\.stop = true/.test(e)) { s.stops++; if (s.analysis.now) s.analysis.now.done = true; }
    return { result: { result: { value: s.analysis.now ? { ...s.analysis.now } : null } } };
  } });
  const jobs = createUploadJobs({ chrome: 'chrome', dataDir, pageUrl: (v) => `page:${v}`, settings: () => ({ 'burpeeJudge.settings.upload': '{"exercise":"squats"}' }), busy: () => s.busy, pollMs: 2, settleMs: 1, spawnFn, connectFn, pageFn: async () => ({ webSocketDebuggerUrl: 'x' }), ...over(dataDir, s) });
  return { jobs, s, dataDir };
}
const make = (over = () => ({})) => setup(over);
const state = (jobs, v) => jobs.list().find((j) => j.video === v)?.state;

test('a video is analysed in the background, with the upload settings, and closes its browser when done', async () => {
  const { jobs, s } = make();
  s.analysis.now = { pct: 10, done: false };
  jobs.add('a.mp4', 'a');
  assert.ok(await until(() => state(jobs, 'a.mp4') === 'running'));
  assert.equal(s.urls[0], 'page:a.mp4');
  assert.match(s.seeded, /burpeeJudge\.settings\.upload/);
  assert.ok(await until(() => jobs.list()[0].pct === 10), 'its progress is shown');
  s.analysis.now = { pct: 100, done: true };
  assert.ok(await until(() => state(jobs, 'a.mp4') === 'done'));
  assert.equal(s.procs[0].killed, true);
  assert.equal(jobs.active(), false);
});
test('one at a time, in the order they came', async () => {
  const { jobs, s } = make();
  s.analysis.now = { pct: 1, done: false };
  jobs.add('a.mp4', 'a'); jobs.add('b.mp4', 'b');
  assert.ok(await until(() => state(jobs, 'a.mp4') === 'running'));
  assert.equal(state(jobs, 'b.mp4'), 'queued');
  assert.equal(s.procs.length, 1);
  s.analysis.now = { pct: 100, done: true };
  assert.ok(await until(() => state(jobs, 'a.mp4') === 'done'));
  assert.ok(await until(() => s.urls.length === 2));
  assert.equal(s.urls[1], 'page:b.mp4');
});
test('the same video twice is one job', async () => {
  const { jobs, s } = make();
  s.analysis.now = { pct: 1, done: false };
  assert.equal(jobs.add('a.mp4', 'a').id, jobs.add('a.mp4', 'a').id);
  s.analysis.now = { pct: 100, done: true };
  assert.ok(await until(() => !jobs.active()));
});
test('live judges come first: it waits while they need the graphics card, then carries on', async () => {
  const { jobs, s } = make();
  s.analysis.now = { pct: 5, done: false }; s.busy = true;
  jobs.add('a.mp4', 'a');
  assert.ok(await until(() => state(jobs, 'a.mp4') === 'waiting'));
  assert.ok(s.paused.length > 0);
  s.busy = false;
  assert.ok(await until(() => state(jobs, 'a.mp4') === 'running'));
  s.analysis.now = { pct: 100, done: true };
  assert.ok(await until(() => state(jobs, 'a.mp4') === 'done'));
});
test('stopping keeps what it found, and a queued one just leaves the queue', async () => {
  const { jobs, s } = make();
  s.analysis.now = { pct: 40, done: false };
  jobs.add('a.mp4', 'a'); jobs.add('b.mp4', 'b');
  assert.ok(await until(() => state(jobs, 'a.mp4') === 'running'));
  assert.equal(jobs.stop('b.mp4'), true);
  assert.equal(state(jobs, 'b.mp4'), 'stopped');
  assert.equal(jobs.stop('a.mp4'), true);
  assert.ok(await until(() => state(jobs, 'a.mp4') === 'stopped'));
  assert.ok(s.stops > 0);
  assert.equal(s.procs.length, 1, 'b never ran');
  assert.equal(jobs.stop('a.mp4'), false, 'nothing left to stop');
});
test('a browser that dies, or a video that stops moving, ends as failed and the next one runs', async () => {
  const { jobs, s } = make();
  s.analysis.now = { pct: 1, done: false };
  jobs.add('a.mp4', 'a'); jobs.add('b.mp4', 'b');
  assert.ok(await until(() => state(jobs, 'a.mp4') === 'running'));
  s.procs[0].emit('exit', 1);
  assert.ok(await until(() => state(jobs, 'a.mp4') === 'failed'));
  assert.match(jobs.list().find((j) => j.video === 'a.mp4').why, /browser stopped/);
  assert.ok(await until(() => s.urls.at(-1) === 'page:b.mp4'));
  s.analysis.now = { pct: 100, done: true };
  assert.ok(await until(() => !jobs.active()));

  let clock = 0;
  const stuck = make(() => ({ now: () => { clock += 1000; return clock; }, stallMs: 5000 }));
  stuck.s.analysis.now = { pct: 7, done: false };
  stuck.jobs.add('c.mp4', 'c');
  assert.ok(await until(() => state(stuck.jobs, 'c.mp4') === 'failed'));
  assert.match(stuck.jobs.list()[0].why, /progress/);
});
test('after a restart, what was running says so, and finished jobs are remembered', async () => {
  const { jobs, s, dataDir } = make();
  s.analysis.now = { pct: 100, done: true };
  jobs.add('a.mp4', 'a');
  assert.ok(await until(() => state(jobs, 'a.mp4') === 'done'));
  const list = JSON.parse(fs.readFileSync(path.join(dataDir, 'upload-jobs.json'), 'utf8'));
  list.push({ id: 9, video: 'b.mp4', name: 'b', state: 'running', pct: 50, at: 1 });
  fs.writeFileSync(path.join(dataDir, 'upload-jobs.json'), JSON.stringify(list));
  const again = createUploadJobs({ chrome: 'c', dataDir, pageUrl: () => '', settings: () => ({}) });
  assert.equal(state(again, 'a.mp4'), 'done');
  assert.equal(state(again, 'b.mp4'), 'stopped');
  assert.match(again.list().find((j) => j.video === 'b.mp4').why, /server stopped/);
});
test('the review page has no judge of its own for uploads: nothing is analysed in the browser', () => {
  const js = fs.readFileSync(new URL('../server/review/review.js', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /judge\.html\?video=/);
  assert.match(js, /'\/api\/upload-jobs'/);
});

test("a deep analysis is told apart, so the server can make it give way more readily than someone's uploaded video", async () => {
  // this server holds deep analyses back while somebody is in view, and nothing else
  const { jobs, s } = make((dir, st) => ({ busy: (job) => !!job.deep && st.inView }));
  s.inView = true;
  s.analysis.now = { pct: 5, done: false };
  jobs.add('upload.mp4', 'upload');
  assert.ok(await until(() => state(jobs, 'upload.mp4') === 'running'), 'an uploaded video carries on');
  s.analysis.now = { pct: 100, done: true };
  assert.ok(await until(() => state(jobs, 'upload.mp4') === 'done'));
  s.analysis.now = { pct: 5, done: false };
  jobs.add('crowd_deep.mp4', 'Camera 1 22:00 deep analysis', { deep: true });
  assert.ok(await until(() => state(jobs, 'crowd_deep.mp4') === 'waiting'), 'the deep analysis waits');
  assert.deepEqual(jobs.list().map((j) => [j.video, j.deep]), [['crowd_deep.mp4', true], ['upload.mp4', false]]);
  s.inView = false;
  assert.ok(await until(() => state(jobs, 'crowd_deep.mp4') === 'running'), 'and carries on when the cameras are quiet');
  s.analysis.now = { pct: 100, done: true };
  assert.ok(await until(() => state(jobs, 'crowd_deep.mp4') === 'done'));
});
