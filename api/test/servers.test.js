'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { createApi } = require('../src/core');
const { memoryStore } = require('../src/store');

let clock = 1_800_000_000_000;
async function setup(opts = {}) {
  const store = memoryStore();
  const api = createApi({ store, now: () => clock, secret: 'test-secret-test-secret-test-secret', googleClientId: 'x', adminEmails: ['boss@example.com'], maxRunningServers: opts.max ?? 1, verifyGoogle: async (t) => ({ sub: t, email: `${t}@example.com`, name: t }) });
  const login = async (who) => ({ Authorization: `Bearer ${(await api.handle({ method: 'POST', path: 'auth/google', body: { idToken: who } })).body.token}` });
  const call = (method, path, headers, body) => api.handle({ method, path, headers, body });
  const company = async (who, id, approve = true) => {
    const h = await login(who);
    await call('POST', 'companies', h, { name: `${id} Co`, id, contact: 'Sam', theme: {} });
    if (approve) await call('POST', `admin/companies/${id}/approve`, await login('boss'), {});
    return h;
  };
  return { api, store, login, call, company };
}

test('you must be signed in and have a company', async () => {
  const { call, login } = await setup();
  assert.strictEqual((await call('GET', 'servers/mine', {})).status, 401);
  assert.strictEqual((await call('POST', 'servers/mine/start', await login('nobody'), {})).status, 404);
});

test('a company waiting for approval, or suspended, can\'t start a server, so can\'t run up a bill', async () => {
  const { call, company, login } = await setup();
  const h = await company('sam', 'peak', false);
  assert.strictEqual((await call('GET', 'servers/mine', h)).body.server.canStart, false);
  assert.strictEqual((await call('POST', 'servers/mine/start', h, {})).status, 403);
  const boss = await login('boss');
  await call('POST', 'admin/companies/peak/approve', boss, {});
  assert.strictEqual((await call('POST', 'servers/mine/start', h, {})).status, 200);
  await call('POST', 'admin/companies/peak/suspend', boss, {});
  assert.strictEqual((await call('POST', 'servers/mine/start', h, {})).status, 403);
});

test('start records the wish and makes its secrets once; none of them ever reach a browser', async () => {
  const { call, company, store } = await setup();
  const h = await company('sam', 'peak');
  const r = await call('POST', 'servers/mine/start', h, {});
  assert.strictEqual(r.body.server.wanted, 'on');
  assert.strictEqual(r.body.server.state, 'off');
  const s = await store.get('server', 'peak');
  assert.ok(s.secret && s.password && s.serverKey && s.receiverKey);
  assert.match(s.host, /^hj-peak-[0-9a-f]{6}\.italynorth\.cloudapp\.azure\.com$/);
  for (const secret of [s.secret, s.password, s.serverKey, s.receiverKey]) assert.ok(!JSON.stringify(r.body).includes(secret));
  await call('POST', 'servers/mine/stop', h, {});
  await call('POST', 'servers/mine/start', h, {});
  assert.strictEqual((await store.get('server', 'peak')).secret, s.secret, 'the same secrets next time');
});

test('only as many servers as the graphics-card allowance runs at once', async () => {
  const { call, company, store } = await setup({ max: 1 });
  const a = await company('a', 'alpha'), b = await company('b', 'bravo');
  assert.strictEqual((await call('POST', 'servers/mine/start', a, {})).status, 200);
  const r = await call('POST', 'servers/mine/start', b, {});
  assert.strictEqual(r.status, 409); assert.match(r.body.error, /in use/);
  assert.strictEqual((await call('POST', 'servers/mine/start', a, {})).status, 200, 'pressing it twice is fine');
  await call('POST', 'servers/mine/stop', a, {});
  await store.put('serverstate', 'alpha', { id: 'alpha', state: 'stopping' });
  assert.strictEqual((await call('POST', 'servers/mine/start', b, {})).status, 409, 'still shutting down');
  await store.put('serverstate', 'alpha', { id: 'alpha', state: 'off' });
  assert.strictEqual((await call('POST', 'servers/mine/start', b, {})).status, 200);
});

test('the link to the server only works once it\'s on, and is signed with that server\'s secret for a few minutes', async () => {
  const { call, company, store } = await setup();
  const h = await company('sam', 'peak');
  await call('POST', 'servers/mine/start', h, {});
  assert.strictEqual((await call('POST', 'servers/mine/open', h, {})).status, 409);
  const s = await store.get('server', 'peak');
  await store.put('serverstate', 'peak', { id: 'peak', state: 'on', host: s.host });
  const r = await call('POST', 'servers/mine/open', h, {});
  const u = new URL(r.body.url);
  assert.strictEqual(u.host, s.host);
  const [p, m] = u.searchParams.get('t').split('.');
  assert.strictEqual(m, crypto.createHmac('sha256', s.secret).update(p).digest('base64url'));
  const v = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.strictEqual(v.kind, 'login'); assert.strictEqual(v.who, 'sam@example.com');
  assert.ok(v.exp - clock <= 5 * 60e3);
  assert.strictEqual((await call('GET', 'servers/mine', h)).body.server.host, s.host);
});

test('another company can\'t reach this one\'s server', async () => {
  const { call, company, store } = await setup({ max: 5 });
  const a = await company('a', 'alpha'), b = await company('b', 'bravo');
  await call('POST', 'servers/mine/start', a, {});
  await store.put('serverstate', 'alpha', { id: 'alpha', state: 'on', host: 'x' });
  assert.strictEqual((await call('GET', 'servers/mine', b)).body.server.state, 'off');
  await call('POST', 'servers/mine/stop', b, {});
  assert.strictEqual((await store.get('serverwant', 'alpha')).desired, 'on');
});

test('a server reports with its key: Stop reaches it, and finishing marks it ready to turn off', async () => {
  const { call, company, store } = await setup();
  const h = await company('sam', 'peak');
  await call('POST', 'servers/mine/start', h, {});
  const key = { 'X-Server-Key': (await store.get('server', 'peak')).serverKey };
  assert.strictEqual((await call('POST', 'servers/report', { 'X-Server-Key': 'wrong' }, {})).status, 401);
  assert.strictEqual((await call('POST', 'servers/report', {}, {})).status, 401);
  const alive = await call('POST', 'servers/report', key, { what: 'alive', cams: 2, judges: 1 });
  assert.deepStrictEqual(alive.body, { stop: false });
  assert.strictEqual((await call('GET', 'servers/mine', h)).body.server.cameras, 2);
  await call('POST', 'servers/mine/stop', h, {});
  assert.deepStrictEqual((await call('POST', 'servers/report', key, { what: 'alive' })).body, { stop: true });
  await call('POST', 'servers/report', key, { what: 'finished' });
  const w = await store.get('serverwant', 'peak');
  assert.strictEqual(w.finished, true);
});

test('a server that stops itself for being idle is marked as not wanted', async () => {
  const { call, company, store } = await setup();
  const h = await company('sam', 'peak');
  await call('POST', 'servers/mine/start', h, {});
  await call('POST', 'servers/report', { 'X-Server-Key': (await store.get('server', 'peak')).serverKey }, { what: 'finished' });
  assert.strictEqual((await call('GET', 'servers/mine', h)).body.server.wanted, 'off');
});

test('its recordings go to the owner\'s cloud recordings with the key it was given', async () => {
  const { call, company, store, login } = await setup();
  const h = await company('sam', 'peak');
  await call('POST', 'servers/mine/start', h, {});
  const { receiverKey } = await store.get('server', 'peak');
  const link = await store.get('reckey', crypto.createHash('sha256').update(receiverKey).digest('hex'));
  const uid = JSON.parse(Buffer.from(h.Authorization.split(' ')[1].split('.')[0], 'base64url').toString()).uid;
  assert.strictEqual(link.partition, `rec:${crypto.createHash('sha256').update(uid).digest('hex').slice(0, 32)}`);
  void login;
});
