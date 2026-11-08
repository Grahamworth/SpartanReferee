import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCloud, QUIET_MS } from '../server/cloud.js';

const FILE = '2026-11-06_09-00-00-123456+0100.mp4';
function setup({ on = true, key = 'rk_x', since = 0, failPut = false, status = 200, camName } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-'));
  const dir = path.join(root, 'rec'), cam = path.join(dir, 'live', 'station2');
  fs.mkdirSync(cam, { recursive: true });
  const calls = [];
  const s = { cloudOn: on, cloudKey: key, cloudSince: since };
  const opt = { fail: failPut, status };
  const doFetch = async (url, o) => {
    calls.push({ url, ...o });
    if (url.startsWith('https://store')) { if (o.body?.getReader) { const r = o.body.getReader(); while (!(await r.read()).done); } return { ok: !opt.fail, status: opt.fail ? 500 : 201 }; }
    const body = JSON.parse(o.body);
    if (opt.status !== 200) return { ok: false, status: opt.status, json: async () => ({ error: 'nope' }) };
    return { ok: true, status: 200, json: async () => (url.endsWith('/upload') ? { url: 'https://store/b', blob: `o/l/cam${body.cam}/${body.file}` } : { ok: true }) };
  };
  const cloud = createCloud({ dir, stateFile: path.join(root, 'sent.json'), api: () => 'https://site/api', settings: () => s, doFetch, ...(camName ? { camName } : {}) });
  const add = (name = FILE, ageMs = QUIET_MS + 5000) => { const p = path.join(cam, name); fs.writeFileSync(p, 'video'); const t = (Date.now() - ageMs) / 1000; fs.utimesSync(p, t, t); return p; };
  return { cloud, calls, add, s, opt, root, stateFile: path.join(root, 'sent.json'), dir, doFetch };
}
const sends = (c) => c.calls.filter((x) => x.method === 'PUT').length;

test('off: nothing is read or sent', async () => {
  const t = setup({ on: false }); t.add();
  await t.cloud.tick();
  assert.equal(t.calls.length, 0); assert.equal(t.cloud.status.state, 'off');
});

test('on, but with no key: nothing is sent', async () => {
  const t = setup({ key: '' }); t.add();
  await t.cloud.tick();
  assert.equal(t.calls.length, 0);
});

test('a finished recording goes up, tells the site, and goes only once', async () => {
  const t = setup(); t.add();
  await t.cloud.tick();
  const [up, put, done] = t.calls;
  assert.ok(up.url.endsWith('/recordings/upload')); assert.equal(up.headers['X-Receiver-Key'], 'rk_x');
  assert.deepEqual(JSON.parse(up.body), { cam: 2, file: FILE, size: 5 });
  assert.equal(put.method, 'PUT'); assert.equal(put.headers['x-ms-blob-type'], 'BlockBlob'); assert.equal(put.headers['Content-Length'], '5');
  const d = JSON.parse(done.body);
  assert.equal(d.blob, `o/l/cam2/${FILE}`); assert.equal(d.startedAt, '2026-11-06T08:00:00.000Z');
  assert.equal(t.cloud.status.sentCount, 1); assert.equal(t.cloud.status.state, 'idle');
  await t.cloud.tick();
  assert.equal(sends(t), 1);
});

test('on a booking\'s second server, its camera 2 goes up as camera 4', async () => {
  const t = setup({ camName: (n) => n + 2 }); t.add();
  await t.cloud.tick();
  assert.deepEqual(JSON.parse(t.calls[0].body), { cam: 4, file: FILE, size: 5 });
});

test('the start time is read from the name at UTC too', async () => {
  const t = setup(); t.add('2026-11-06_01-45-06-389951Z.mp4');
  await t.cloud.tick();
  assert.equal(JSON.parse(t.calls.at(-1).body).startedAt, '2026-11-06T01:45:06.000Z');
});

test('it remembers what it sent after a restart', async () => {
  const t = setup(); t.add();
  await t.cloud.tick();
  const again = createCloud({ dir: t.dir, stateFile: t.stateFile, api: () => 'https://site/api', settings: () => t.s, doFetch: t.doFetch });
  assert.equal(again.status.sentCount, 1);
  await again.tick();
  assert.equal(sends(t), 1);
});

test('a recording still being written waits', async () => {
  const t = setup(); t.add(FILE, 10_000);
  await t.cloud.tick();
  assert.equal(t.calls.length, 0);
});

test('recordings from before it was switched on stay on the laptop', async () => {
  const t = setup({ since: Date.now() - 60_000 }); t.add(FILE, QUIET_MS + 5000);
  await t.cloud.tick();
  assert.equal(t.calls.length, 0);
});

test('other files are left alone', async () => {
  const t = setup(); t.add('notes.txt');
  fs.mkdirSync(path.join(t.dir, 'other')); fs.writeFileSync(path.join(t.dir, 'other', 'x.mp4'), 'video');
  await t.cloud.tick();
  assert.equal(t.calls.length, 0);
});

test('if the internet fails, the file stays and goes later', async () => {
  const t = setup({ failPut: true }); const p = t.add();
  await t.cloud.tick();
  assert.equal(t.cloud.status.state, 'error'); assert.equal(t.cloud.status.sentCount, 0);
  assert.ok(fs.existsSync(p));
  const before = t.calls.length;
  await t.cloud.tick();
  assert.equal(t.calls.length, before, 'it waits before trying again');
  t.opt.fail = false;
  const later = createCloud({ dir: t.dir, stateFile: t.stateFile, api: () => 'https://site/api', settings: () => t.s, doFetch: t.doFetch });
  await later.tick();
  assert.equal(later.status.sentCount, 1);
});

test('a key the site refuses says so', async () => {
  const t = setup({ status: 401 }); t.add();
  await t.cloud.tick();
  assert.match(t.cloud.status.error, /key/); assert.equal(sends(t), 0);
});

test('the recording on the laptop is never touched', async () => {
  const t = setup(); const p = t.add();
  await t.cloud.tick();
  assert.equal(fs.readFileSync(p, 'utf8'), 'video');
});
