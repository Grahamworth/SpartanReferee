'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { createApi } = require('../src/core');
const { memoryStore } = require('../src/store');
const { blobSigner, MAX_OWNER } = require('../src/recordings');

const SECRET = 'test-secret-test-secret-test-secret';
function setup({ admins = ['owner@x.com', 'other@x.com'] } = {}) {
  let t = Date.parse('2026-11-06T10:00:00Z');
  const signed = [];
  const signer = (o) => { signed.push(o); return `https://store/${o.blob}?sp=${o.perm}`; };
  const api = createApi({ store: memoryStore(), now: () => t, secret: SECRET, adminEmails: admins, googleClientId: 'dev', blobSigner: signer,
    verifyGoogle: async (x) => ({ sub: x, email: x, name: x }) });
  const signIn = async (email) => ({ Authorization: `Bearer ${(await api.handle({ method: 'POST', path: 'auth/google', body: { idToken: email } })).body.token}` });
  return { api, signIn, signed, tick: (ms) => { t += ms; } };
}
const call = (api, method, path, headers, body) => api.handle({ method, path, headers, body });
const FILE = '2026-11-06_09-00-00-123456+0000.mp4';

async function linked(s, email = 'owner@x.com') {
  const h = await s.signIn(email);
  const made = await call(s.api, 'POST', 'recordings/links', h, { name: 'Laptop' });
  assert.strictEqual(made.status, 200);
  return { h, id: made.body.id, rk: { 'X-Receiver-Key': made.body.key } };
}
async function upload(s, rk, { cam = 1, file = FILE, size = 1000 } = {}) {
  const u = await call(s.api, 'POST', 'recordings/upload', rk, { cam, file, size });
  if (u.status !== 200) return u;
  const d = await call(s.api, 'POST', 'recordings/done', rk, { blob: u.body.blob, size, startedAt: '2026-11-06T09:00:00Z' });
  assert.strictEqual(d.status, 200);
  return u;
}

test('a Receiver with a key gets a link for one file, with write access only', async () => {
  const s = setup();
  const { rk, id } = await linked(s);
  const u = await call(s.api, 'POST', 'recordings/upload', rk, { cam: 2, file: FILE, size: 1000 });
  assert.strictEqual(u.status, 200);
  assert.ok(u.body.blob.includes(`/${id}/cam2/${FILE}`));
  const asked = s.signed.at(-1);
  assert.strictEqual(asked.perm, 'cw'); assert.strictEqual(asked.blob, u.body.blob);
  assert.ok(asked.minutes <= 120);
});

test('no key, or a wrong one, is refused', async () => {
  const s = setup();
  assert.strictEqual((await call(s.api, 'POST', 'recordings/upload', {}, { cam: 1, file: FILE, size: 1 })).status, 401);
  assert.strictEqual((await call(s.api, 'POST', 'recordings/upload', { 'X-Receiver-Key': 'rk_nope' }, { cam: 1, file: FILE, size: 1 })).status, 401);
  assert.strictEqual(s.signed.length, 0);
});

test('names that could reach another path are refused', async () => {
  const s = setup();
  const { rk } = await linked(s);
  for (const file of ['../x.mp4', 'a/b.mp4', 'x.exe', '.mp4', '']) assert.strictEqual((await call(s.api, 'POST', 'recordings/upload', rk, { cam: 1, file, size: 1 })).status, 400, file);
  for (const cam of [-1, 100, 'x', 1.5]) assert.strictEqual((await call(s.api, 'POST', 'recordings/upload', rk, { cam, file: FILE, size: 1 })).status, 400);
  for (const size of [0, -1, 6e9, 'x']) assert.strictEqual((await call(s.api, 'POST', 'recordings/upload', rk, { cam: 1, file: FILE, size })).status, 400);
});

test('only the account that linked the Receiver sees its recordings, with read-only links', async () => {
  const s = setup();
  const { h, rk } = await linked(s);
  await upload(s, rk);
  const mine = await call(s.api, 'GET', 'recordings', h);
  assert.strictEqual(mine.body.recordings.length, 1);
  assert.strictEqual(mine.body.recordings[0].receiver, 'Laptop');
  assert.ok(s.signed.slice(-2).every((x) => x.perm === 'r' && x.minutes <= 240));
  assert.strictEqual(mine.body.used, 1000);
  const other = await s.signIn('other@x.com');
  assert.strictEqual((await call(s.api, 'GET', 'recordings', other)).body.recordings.length, 0);
  assert.strictEqual((await call(s.api, 'GET', 'recordings', {})).status, 401);
});

test('a Receiver can\'t record into another Receiver\'s place', async () => {
  const s = setup();
  const a = await linked(s), b = await linked(s, 'other@x.com');
  const u = await call(s.api, 'POST', 'recordings/upload', a.rk, { cam: 1, file: FILE, size: 1 });
  assert.strictEqual((await call(s.api, 'POST', 'recordings/done', b.rk, { blob: u.body.blob, size: 1 })).status, 400);
  assert.strictEqual((await call(s.api, 'GET', 'recordings', b.h)).body.recordings.length, 0);
});

test('only admins can link a Receiver for now', async () => {
  const s = setup({ admins: ['owner@x.com'] });
  const h = await s.signIn('someone@x.com');
  assert.strictEqual((await call(s.api, 'POST', 'recordings/links', h, { name: 'x' })).status, 403);
  assert.strictEqual((await call(s.api, 'POST', 'recordings/links', {}, { name: 'x' })).status, 401);
});

test('the key is shown once, isn\'t kept in the clear, and removing the link stops it working', async () => {
  const s = setup();
  const { h, id, rk } = await linked(s);
  const list = await call(s.api, 'GET', 'recordings/links', h);
  assert.deepStrictEqual(Object.keys(list.body.links[0]).sort(), ['at', 'id', 'name']);
  assert.ok(!JSON.stringify(list.body).includes(rk['X-Receiver-Key']));
  assert.strictEqual((await call(s.api, 'DELETE', `recordings/links/${id}`, h)).status, 200);
  assert.strictEqual((await call(s.api, 'POST', 'recordings/upload', rk, { cam: 1, file: FILE, size: 1 })).status, 401);
});

test('another account can\'t remove your link', async () => {
  const s = setup();
  const { id, rk } = await linked(s);
  const other = await s.signIn('other@x.com');
  assert.strictEqual((await call(s.api, 'DELETE', `recordings/links/${id}`, other)).status, 404);
  assert.strictEqual((await upload(s, rk)).status, 200);
});

test('the storage limit stops new uploads, and old recordings drop off the list', async () => {
  const s = setup();
  const { h, rk } = await linked(s);
  for (let i = 0; i < 41; i++) assert.strictEqual((await upload(s, rk, { file: `f${i}.mp4`, size: 5e9 })).status, 200 - (i === 40 ? -307 : 0), `file ${i}`);
  const r = await call(s.api, 'GET', 'recordings', h);
  assert.strictEqual(r.body.used, MAX_OWNER);
  s.tick(31 * 864e5);
  const later = await s.signIn('owner@x.com'); // sessions run out too
  assert.strictEqual((await call(s.api, 'GET', 'recordings', later)).body.recordings.length, 0);
  assert.strictEqual((await upload(s, rk, { size: 5e9 })).status, 200);
});

test('without storage set up it says so', async () => {
  const api = createApi({ store: memoryStore() });
  assert.strictEqual((await call(api, 'POST', 'recordings/upload', {}, {})).status, 503);
});

test('the links are signed the way storage checks them, for that one file', () => {
  const key = Buffer.from('k'.repeat(32)).toString('base64');
  const now = () => Date.parse('2026-11-06T10:00:00Z');
  const sign = blobSigner(`DefaultEndpointsProtocol=https;AccountName=acc;AccountKey=${key};EndpointSuffix=core.windows.net`, 'recordings', now);
  const u = new URL(sign({ blob: 'a b/cam1/x.mp4', perm: 'r', minutes: 60 }));
  assert.strictEqual(u.pathname, '/recordings/a%20b/cam1/x.mp4');
  assert.strictEqual(u.searchParams.get('sp'), 'r'); assert.strictEqual(u.searchParams.get('sr'), 'b'); assert.strictEqual(u.searchParams.get('spr'), 'https');
  assert.strictEqual(u.searchParams.get('se'), '2026-11-06T11:00:00Z');
  const toSign = ['r', '2026-11-06T09:55:00Z', '2026-11-06T11:00:00Z', '/blob/acc/recordings/a b/cam1/x.mp4', '', '', 'https', '2022-11-02', 'b', '', '', '', '', '', '', ''].join('\n');
  assert.strictEqual(u.searchParams.get('sig'), crypto.createHmac('sha256', Buffer.from(key, 'base64')).update(toSign).digest('base64'));
  assert.ok(new URL(sign({ blob: 'x.mp4', perm: 'r', minutes: 1, download: 'x.mp4' })).searchParams.get('rscd').includes('attachment'));
  assert.strictEqual(blobSigner('UseDevelopmentStorage=true'), null);
});
