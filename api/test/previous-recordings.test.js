'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { createApi } = require('../src/core');
const { memoryStore } = require('../src/store');
const { recordingsPartition } = require('../src/recordings');

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const NOW = 1_800_000_000_000;
async function setup() {
  const store = memoryStore();
  const api = createApi({ store, now: () => NOW, secret: 'test-secret-test-secret-test-secret', adminEmails: ['boss@example.com'], blobSigner: ({ blob, perm }) => `https://blob.example/${blob}?perm=${perm}` });
  const link = async (key, uid, id) => store.put('reckey', sha(key), { id, name: 'Cloud Receiver', partition: recordingsPartition(uid) });
  await link('rk_a', 'owner-a', 'srv-a'); await link('rk_b', 'owner-b', 'srv-b');
  const call = (method, path, key, body) => api.handle({ method, path, headers: key ? { 'x-receiver-key': key } : {}, body });
  const send = async (key, cam, file, name) => {
    const u = await call('POST', 'recordings/upload', key, { cam, file, size: 1000 });
    assert.strictEqual(u.status, 200, u.body.error);
    const d = await call('POST', 'recordings/done', key, { blob: u.body.blob, size: 1000, name, startedAt: new Date(NOW - 3600e3).toISOString() });
    assert.strictEqual(d.status, 200, d.body.error);
    return u.body.blob;
  };
  return { store, call, send };
}

test('an uploaded video goes to cloud storage as camera 0, in any of the usual kinds, with its name', async () => {
  const { call, send } = await setup();
  await send('rk_a', 0, '2026-11-07T17-00-00-000Z_Finals.mov', 'Finals.mov');
  const list = (await call('GET', 'recordings/by-key', 'rk_a')).body.recordings;
  assert.strictEqual(list[0].cam, 0); assert.strictEqual(list[0].name, 'Finals.mov');
});
test('only a video may be camera 0, and a camera\'s recording must still be mp4', async () => {
  const { call } = await setup();
  assert.strictEqual((await call('POST', 'recordings/upload', 'rk_a', { cam: 0, file: 'run.exe', size: 1 })).status, 400);
  assert.strictEqual((await call('POST', 'recordings/upload', 'rk_a', { cam: 1, file: 'clip.mov', size: 1 })).status, 400);
});
test('a server can list its company\'s recordings and get a link to one, but not another company\'s', async () => {
  const { call, send } = await setup();
  await send('rk_a', 1, '2026-11-07_16-00-00-000Z.mp4');
  await send('rk_b', 1, '2026-11-07_16-30-00-000Z.mp4');
  const mine = (await call('GET', 'recordings/by-key', 'rk_a')).body.recordings;
  assert.strictEqual(mine.length, 1);
  assert.strictEqual(mine[0].url, undefined, 'the list has no links');
  const one = await call('GET', `recordings/by-key/${mine[0].id}`, 'rk_a');
  assert.match(one.body.url, /perm=r$/);
  const theirs = (await call('GET', 'recordings/by-key', 'rk_b')).body.recordings[0];
  assert.strictEqual((await call('GET', `recordings/by-key/${theirs.id}`, 'rk_a')).status, 404);
  assert.strictEqual((await call('GET', 'recordings/by-key', 'rk_nope')).status, 401);
  assert.strictEqual((await call('GET', 'recordings/by-key')).status, 401);
});
