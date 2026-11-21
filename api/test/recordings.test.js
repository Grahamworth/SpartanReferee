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

test('everyone in the organisation sees a linked Receiver\'s recordings, with read-only links; nobody else does', async () => {
  const s = setup();
  const { h, rk } = await linked(s);
  await upload(s, rk);
  const mine = await call(s.api, 'GET', 'recordings', h);
  assert.strictEqual(mine.body.recordings.length, 1);
  assert.strictEqual(mine.body.recordings[0].receiver, 'Laptop');
  assert.ok(s.signed.slice(-2).every((x) => x.perm === 'r' && x.minutes <= 240));
  assert.strictEqual(mine.body.used, 1000);
  const other = await s.signIn('other@x.com'); // another admin
  assert.strictEqual((await call(s.api, 'GET', 'recordings', other)).body.recordings.length, 1);
  const stranger = await s.signIn('stranger@x.com');
  assert.strictEqual((await call(s.api, 'GET', 'recordings', stranger)).body.recordings.length, 0);
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

test('someone who isn\'t an admin can\'t remove a link', async () => {
  const s = setup();
  const { id, rk } = await linked(s);
  const stranger = await s.signIn('stranger@x.com');
  assert.strictEqual((await call(s.api, 'DELETE', `recordings/links/${id}`, stranger)).status, 403);
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

// ---- saved results: each run of a server keeps its own
function withStorage() {
  let t = Date.parse('2026-11-20T08:00:00Z');
  const blobs = new Map(), signer = (o) => `https://store/${o.blob}?sp=${o.perm}`;
  const fetchFn = async (url) => { const k = decodeURIComponent(String(url).slice('https://store/'.length).split('?')[0]); const v = blobs.get(k); return { ok: v != null, status: v != null ? 200 : 404, json: async () => JSON.parse(v), text: async () => String(v ?? '') }; };
  // (what's taken out of the list is noted: forgetting an old run shows nowhere else)
  const kept = memoryStore(), forgotten = [], store = { ...kept, remove: async (p, k) => { forgotten.push([p, k]); return kept.remove(p, k); } };
  const api = createApi({ store, now: () => t, secret: SECRET, adminEmails: ['owner@x.com'], googleClientId: 'dev', blobSigner: signer, fetchFn,
    verifyGoogle: async (x) => ({ sub: x, email: x, name: x }) });
  const signIn = async (email) => ({ Authorization: `Bearer ${(await api.handle({ method: 'POST', path: 'auth/google', body: { idToken: email } })).body.token}` });
  // a server saving what it found: the files go where the site says, then it says it's done
  const save = async (rk, run, files) => {
    const u = await call(api, 'POST', 'recordings/results-urls', rk, { names: Object.keys(files), ...(run === undefined ? {} : { run }) });
    assert.strictEqual(u.status, 200);
    for (const [n, body] of Object.entries(files)) blobs.set(u.body.urls[n].slice('https://store/'.length).split('?')[0], typeof body === 'string' ? body : JSON.stringify(body));
    assert.strictEqual((await call(api, 'POST', 'recordings/results-done', rk, run === undefined ? {} : { run })).status, 200);
  };
  return { api, signIn, save, blobs, forgotten, tick: (ms) => { t += ms; }, now: () => t };
}
const athlete = (n, firstAt, reps) => ({ n, src: 'live', cam: 1, firstAt, lastAt: firstAt, reps, noReps: 0 });

test('a new booking\'s athletes are added to the last booking\'s, not put in their place', async () => {
  const s = withStorage(), { h, rk } = await linked(s);
  await s.save(rk, 'r20261120T080000', { 'results.json': { athletes: [athlete(1, '2026-11-20T08:31:00Z', 7), athlete(2, '2026-11-20T08:40:00Z', 5)] }, 'tracks/1.jsonl': '{"f":[1000,[]]}\n{"e":{"t":1500,"type":"rep"}}\n' });
  s.tick(4 * 3600e3);
  // the afternoon's server is a new one: it starts again at athlete 1
  await s.save(rk, 'r20261120T115759', { 'results.json': { athletes: [athlete(1, '2026-11-20T12:07:00Z', 4)] }, 'tracks/1.jsonl': '{"f":[9000,[]]}\n' });
  const got = (await call(s.api, 'GET', 'recordings/results', h)).body;
  assert.deepStrictEqual(got.athletes.map((a) => [a.firstAt, a.reps]), [['2026-11-20T12:07:00Z', 4], ['2026-11-20T08:40:00Z', 5], ['2026-11-20T08:31:00Z', 7]]);
  const morning = got.athletes.find((a) => a.reps === 7), afternoon = got.athletes.find((a) => a.reps === 4);
  assert.notStrictEqual(morning.server, afternoon.server, 'two athletes numbered 1 are told apart');
  // and each one's tracking is its own
  const track = async (a) => (await call(s.api, 'GET', `recordings/track/${encodeURIComponent(`${a.server}~${a.n}`)}`, h)).body;
  assert.deepStrictEqual((await track(morning)).frames, [[1000, []]]); assert.strictEqual((await track(morning)).events.length, 1);
  assert.deepStrictEqual((await track(afternoon)).frames, [[9000, []]]);
});

test('a server saving again in the same run replaces only its own', async () => {
  const s = withStorage(), { h, rk } = await linked(s);
  await s.save(rk, 'r1', { 'results.json': { athletes: [athlete(1, '2026-11-20T08:31:00Z', 3)] } });
  await s.save(rk, 'r1', { 'results.json': { athletes: [athlete(1, '2026-11-20T08:31:00Z', 9)] } });
  assert.deepStrictEqual((await call(s.api, 'GET', 'recordings/results', h)).body.athletes.map((a) => a.reps), [9]);
});

test('a server on older software, which names no run, still saves and shows its results', async () => {
  const s = withStorage(), { h, rk, id } = await linked(s);
  await s.save(rk, undefined, { 'results.json': { athletes: [athlete(1, '2026-11-20T08:31:00Z', 6)] } });
  const got = (await call(s.api, 'GET', 'recordings/results', h)).body;
  assert.deepStrictEqual(got.athletes.map((a) => [a.reps, a.server]), [[6, id]]);
  assert.ok([...s.blobs.keys()].some((k) => k.endsWith(`/${id}/results/results.json`)));
});

test('a run\'s name can\'t reach outside its own folder', async () => {
  const s = withStorage(), { rk, id } = await linked(s);
  for (const run of ['../x', 'a/b', 'x'.repeat(25), { a: 1 }]) await s.save(rk, run, { 'results.json': { athletes: [] } });
  assert.deepStrictEqual([...s.blobs.keys()].map((k) => k.slice(k.indexOf(`/${id}/`))), [`/${id}/results/results.json`]);
});

test('runs older than the week are forgotten', async () => {
  const s = withStorage(), { h, rk } = await linked(s);
  await s.save(rk, 'r1', { 'results.json': { athletes: [athlete(1, '2026-11-20T08:31:00Z', 3)] } });
  s.tick(8 * 864e5);
  const today = new Date(s.now()).toISOString();
  await s.save(rk, 'r2', { 'results.json': { athletes: [athlete(1, today, 5)] } });
  assert.deepStrictEqual((await call(s.api, 'GET', 'recordings/results', h)).body.athletes.map((a) => a.reps), [5]);
  const gone = s.forgotten.filter(([p]) => p.endsWith(':results')).map(([, k]) => k);
  assert.strictEqual(gone.length, 1); assert.ok(gone[0].endsWith('-r1'));
});

test('the recordings a crowd was in come through with how far their deep analysis has got', async () => {
  const s = withStorage(), { h, rk } = await linked(s);
  const going = { cam: 2, file: '2026-11-20_08-30-00-000000Z.mp4', video: 'x_Camera_2_deep.mp4', name: 'Camera 2 08:30 deep analysis', startedAt: '2026-11-20T08:30:00.000Z', endedAt: '2026-11-20T08:40:00.000Z', state: 'running', pct: 40, why: '', replaced: 0, kept: '' };
  await s.save(rk, 'r1', { 'results.json': { athletes: [athlete(1, '2026-11-20T08:31:00Z', 3)], deep: [going, 'junk', null, { cam: 1, state: 'done' }] } });
  const got = (await call(s.api, 'GET', 'recordings/results', h)).body;
  assert.strictEqual(got.deep.length, 1, 'only entries that say when their recording began');
  const { server, ...d } = got.deep[0];
  assert.deepStrictEqual(d, { cam: 2, file: going.file, video: going.video, startedAt: going.startedAt, endedAt: going.endedAt, state: 'running', pct: 40, replaced: 0, kept: '' });
  assert.strictEqual(server, got.athletes[0].server, 'tied to the same server run as its athletes');
  // a server on software from before deep analysis sends none
  const old = withStorage(), o = await linked(old);
  await old.save(o.rk, 'r1', { 'results.json': { athletes: [athlete(1, '2026-11-20T08:31:00Z', 3)] } });
  assert.deepStrictEqual((await call(old.api, 'GET', 'recordings/results', o.h)).body.deep, []);
});

test('a recording whose deep analysis never finished, analysed on a later server, takes the place of what the live judge counted there', async () => {
  const s = withStorage(), { h, rk } = await linked(s);
  const file = '2026-11-20_08-30-00-000000Z.mp4';
  const unfinished = { cam: 1, file, video: '', startedAt: '2026-11-20T08:30:00.000Z', endedAt: '2026-11-20T08:40:00.000Z', state: 'stopped', pct: 0, why: 'The booking ended before it could be analysed in full.' };
  // the first booking: a crowd on camera 1 from 08:30, which its live judge counted 3 reps of; and an athlete at 08:20, before it
  await s.save(rk, 'r1', { 'results.json': { athletes: [athlete(1, '2026-11-20T08:20:00Z', 9), athlete(2, '2026-11-20T08:31:00Z', 2), athlete(3, '2026-11-20T08:35:00Z', 1), { ...athlete(4, '2026-11-20T08:36:00Z', 5), cam: 2 }], deep: [unfinished] } });
  let got = (await call(s.api, 'GET', 'recordings/results', h)).body;
  assert.deepStrictEqual(got.athletes.map((a) => a.reps).sort(), [1, 2, 5, 9]);
  assert.strictEqual(got.deep[0].state, 'stopped', 'said on the Results page until it is analysed');
  // a later booking: that recording chosen under A previous recording, and counted in full
  s.tick(3 * 3600e3);
  const found = (n, reps) => ({ n, src: 'upload', cam: 0, video: 'later_Camera_1.mp4', firstAt: '2026-11-20T11:05:00Z', lastAt: '2026-11-20T11:05:00Z', firstT: 60, lastT: 90, reps, noReps: 0 });
  await s.save(rk, 'r2', { 'results.json': { athletes: [found(1, 6), found(2, 5), found(3, 4)], sources: { 'later_Camera_1.mp4': file } } });
  got = (await call(s.api, 'GET', 'recordings/results', h)).body;
  assert.deepStrictEqual(got.athletes.map((a) => a.reps).sort(), [4, 5, 5, 6, 9], 'the two live entries of that stretch on camera 1 have given way; camera 2 and the earlier athlete stay');
  assert.deepStrictEqual([got.deep[0].state, got.deep[0].replaced, got.deep[0].kept], ['done', 2, '']);
});

test('a later analysis that counted fewer reps than the live judge did leaves the live counts, and both are listed', async () => {
  const s = withStorage(), { h, rk } = await linked(s);
  const file = '2026-11-20_08-30-00-000000Z.mp4';
  await s.save(rk, 'r1', { 'results.json': { athletes: [athlete(1, '2026-11-20T08:31:00Z', 8)], deep: [{ cam: 1, file, startedAt: '2026-11-20T08:30:00.000Z', endedAt: '2026-11-20T08:40:00.000Z', state: 'failed' }] } });
  s.tick(3600e3);
  await s.save(rk, 'r2', { 'results.json': { athletes: [{ n: 1, src: 'upload', cam: 0, video: 'v.mp4', firstAt: '2026-11-20T09:05:00Z', lastAt: '2026-11-20T09:05:00Z', reps: 3, noReps: 0 }], sources: { 'v.mp4': file } } });
  const got = (await call(s.api, 'GET', 'recordings/results', h)).body;
  assert.deepStrictEqual(got.athletes.map((a) => a.reps).sort(), [3, 8]);
  assert.deepStrictEqual([got.deep[0].state, got.deep[0].replaced, got.deep[0].kept], ['done', 0, 'fewer']);
});
