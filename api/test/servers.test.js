'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { createApi } = require('../src/core');
const { memoryStore } = require('../src/store');

const HOUR = 3600e3;
async function setup(opts = {}) {
  const store = memoryStore(); let clock = 1_800_000_000_000;
  const api = createApi({ store, now: () => clock, payments: { startSetup: async () => ({}), finishSetup: async () => ({}) }, secret: 'test-secret-test-secret-test-secret', googleClientId: 'x', adminEmails: ['boss@example.com'], maxRunningServers: opts.max ?? 1, serverHourPrice: 0.66, verifyGoogle: async (t) => ({ sub: t, email: `${t}@example.com`, name: t }) });
  const login = async (who) => ({ Authorization: `Bearer ${(await api.handle({ method: 'POST', path: 'auth/google', body: { idToken: who } })).body.token}` });
  const call = (method, path, headers, body) => api.handle({ method, path, headers, body });
  const company = async (who, id, { card = true } = {}) => {
    const h = await login(who);
    await call('POST', 'companies', h, { name: `${id} Co`, id, contact: 'Sam', theme: {} });
    if (card) await store.put('company', id, { ...(await store.get('company', id)), payment: { brand: 'visa', last4: '4242', expMonth: 1, expYear: 2030 } });
    return h;
  };
  return { api, store, login, call, company, pass: (ms) => { clock += ms; }, now: () => clock };
}
// a customer's booking: checkout, then the (pretend) payment, which makes it
const start = async (call, h, cameras = 2, hours = 4) => { const co = await call('POST', 'servers/mine/checkout', h, { cameras, hours }); return co.status === 200 ? call('POST', 'servers/mine/pay', h, { checkout: co.body.checkout.id }) : co; };

test('you must be signed in and have a company', async () => {
  const { call, login } = await setup();
  assert.strictEqual((await call('GET', 'servers/mine', {})).status, 401);
  assert.strictEqual((await start(call, await login('nobody'))).status, 404);
});

test('a company is approved as soon as it registers, and blocking it stops it starting a server', async () => {
  const { call, company, login } = await setup();
  const h = await company('sam', 'peak');
  assert.strictEqual((await call('GET', 'servers/mine', h)).body.server.canStart, true);
  const boss = await login('boss');
  await call('POST', 'admin/companies/peak/suspend', boss, { note: 'no' });
  assert.strictEqual((await call('GET', 'servers/mine', h)).body.server.canStart, false);
  assert.strictEqual((await start(call, h)).status, 403);
  await call('POST', 'admin/companies/peak/approve', boss, {});
  assert.strictEqual((await start(call, h)).status, 200);
  await call('POST', 'servers/mine/stop', h, {});
  await call('POST', 'admin/companies/peak/suspend', boss, {});
  assert.strictEqual((await start(call, h)).status, 403);
});

test('the page gets what it needs to work out a price before anything starts', async () => {
  const { call, company } = await setup({ max: 4 });
  const h = await company('sam', 'peak');
  const { price } = (await call('GET', 'servers/mine', h)).body.server;
  assert.deepStrictEqual(price, { cameraHour: 0.34, keepDays: 7, camerasPerServer: 2, maxHours: 24, maxExtendHours: 12, maxCameras: 8, maxDaysAhead: 90, startLeadMinutes: 10 });
});

test('two cameras per server: cameras and hours decide how many servers, what it costs and when they stop', async () => {
  const { call, company, store, now } = await setup({ max: 4 });
  const h = await company('sam', 'peak');
  const r = await start(call, h, 3, 4);
  const s = r.body.server;
  assert.strictEqual(s.serverCount, 2);
  assert.strictEqual(s.bookedCost, 4.08, '3 cameras x 4 hours x 0.34');
  assert.strictEqual(s.until, now() + 4 * HOUR);
  assert.strictEqual(s.wanted, 'on');
  assert.strictEqual(s.servers.length, 2);
  assert.strictEqual((await store.get('serverwant', 'peak')).until, now() + 4 * HOUR);
  assert.strictEqual((await store.get('serverwant', 'peak~2')).until, now() + 4 * HOUR);
  assert.notStrictEqual((await store.get('server', 'peak')).host, (await store.get('server', 'peak~2')).host);
  assert.strictEqual((await store.get('server', 'peak~2')).company, 'peak');
});

test('a booking has to make sense', async () => {
  const { call, company } = await setup();
  const h = await company('sam', 'peak');
  for (const [c, hrs] of [[0, 4], [2, 0], [2, 25], [2.5, 4], ['x', 4], [2, 1.5], [null, null]]) assert.strictEqual((await start(call, h, c, hrs)).status, 400, `${c} ${hrs}`);
});

test('extending moves the stop time on every server, and adds to the cost', async () => {
  const { call, company, store, now, pass } = await setup({ max: 2 });
  const h = await company('sam', 'peak');
  await start(call, h, 4, 2);
  const until = now() + 2 * HOUR;
  pass(HOUR);
  const r = await call('POST', 'servers/mine/extend', h, { hours: 3 });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.server.until, until + 3 * HOUR);
  assert.strictEqual(r.body.server.bookedHours, 5);
  assert.strictEqual(r.body.server.bookedCost, 6.8);
  assert.strictEqual((await store.get('serverwant', 'peak~2')).until, until + 3 * HOUR);
});

test('extending has limits, and only applies to servers that are booked', async () => {
  const { call, company, pass } = await setup();
  const h = await company('sam', 'peak');
  assert.strictEqual((await call('POST', 'servers/mine/extend', h, { hours: 1 })).status, 409);
  await start(call, h, 2, 24);
  for (const hours of [0, 13, 'x']) assert.strictEqual((await call('POST', 'servers/mine/extend', h, { hours })).status, 400, String(hours));
  for (let i = 0; i < 4; i++) assert.strictEqual((await call('POST', 'servers/mine/extend', h, { hours: 12 })).status, 200);
  assert.strictEqual((await call('POST', 'servers/mine/extend', h, { hours: 1 })).status, 400, 'over 72 hours ahead');
  pass(73 * HOUR);
  assert.strictEqual((await call('POST', 'servers/mine/extend', h, { hours: 1 })).status, 409, 'its time has passed');
  assert.strictEqual((await call('GET', 'servers/mine', h)).body.server.wanted, 'off');
});

test('past the booked time, a server is told to stop when it next reports', async () => {
  const { call, company, store, pass } = await setup();
  const h = await company('sam', 'peak');
  await start(call, h, 2, 1);
  const key = { 'X-Server-Key': (await store.get('server', 'peak')).serverKey };
  const before = await call('POST', 'servers/report', key, { what: 'alive' });
  assert.strictEqual(before.body.stop, false); assert.ok(before.body.until > 0);
  pass(HOUR + 1000);
  assert.strictEqual((await call('POST', 'servers/report', key, { what: 'alive' })).body.stop, true);
});

test('only as many servers as the graphics-card allowance runs at once', async () => {
  const { call, company, store, pass } = await setup({ max: 1 });
  const a = await company('a', 'alpha'), b = await company('b', 'bravo');
  const big = await start(call, a, 3, 2);
  assert.strictEqual(big.status, 409); assert.match(big.body.error, /1 server at once/);
  assert.strictEqual((await start(call, a, 2, 2)).status, 200);
  const r = await start(call, b, 2, 2);
  assert.strictEqual(r.status, 409); assert.match(r.body.error, /in use/);
  assert.strictEqual((await start(call, a, 2, 2)).status, 409, 'already booked');
  await call('POST', 'servers/mine/stop', a, {});
  await store.put('serverstate', 'alpha', { id: 'alpha', state: 'stopping' });
  assert.strictEqual((await start(call, b, 2, 2)).status, 409, 'still shutting down');
  await store.put('serverstate', 'alpha', { id: 'alpha', state: 'off' });
  assert.strictEqual((await start(call, b, 2, 2)).status, 200);
  await store.put('serverstate', 'bravo', { id: 'bravo', state: 'off' });
  pass(3 * HOUR);
  assert.strictEqual((await start(call, a, 2, 2)).status, 200, 'bravo\'s booking has run out');
});

test('start makes its secrets once; none of them ever reach a browser', async () => {
  const { call, company, store } = await setup();
  const h = await company('sam', 'peak');
  const r = await start(call, h);
  const s = await store.get('server', 'peak');
  assert.ok(s.secret && s.password && s.serverKey && s.receiverKey);
  assert.match(s.host, /^hj-peak-[0-9a-f]{6}\.italynorth\.cloudapp\.azure\.com$/);
  for (const secret of [s.secret, s.password, s.serverKey, s.receiverKey]) assert.ok(!JSON.stringify(r.body).includes(secret));
  await call('POST', 'servers/mine/stop', h, {});
  await start(call, h);
  assert.strictEqual((await store.get('server', 'peak')).secret, s.secret, 'the same secrets next time');
});

test('the link to a server only works once it\'s on, and is signed with that server\'s secret for a few minutes', async () => {
  const { call, company, store, now } = await setup({ max: 2 });
  const h = await company('sam', 'peak');
  await start(call, h, 4, 2);
  assert.strictEqual((await call('POST', 'servers/mine/open', h, { n: 2 })).status, 409);
  const s = await store.get('server', 'peak~2');
  await store.put('serverstate', 'peak~2', { id: 'peak~2', state: 'on' });
  const r = await call('POST', 'servers/mine/open', h, { n: 2 });
  const u = new URL(r.body.url);
  assert.strictEqual(u.host, s.host);
  const [p, m] = u.searchParams.get('t').split('.');
  assert.strictEqual(m, crypto.createHmac('sha256', s.secret).update(p).digest('base64url'));
  const v = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.strictEqual(v.kind, 'login'); assert.strictEqual(v.who, 'sam@example.com');
  assert.ok(v.exp - now() <= 5 * 60e3);
  // it opens on Live, and says it's server 2 of 2, so the review can offer the other
  assert.deepStrictEqual([u.searchParams.get('tab'), u.searchParams.get('n'), u.searchParams.get('of')], ['live', '2', '2']);
  const on = async (tab) => new URL((await call('POST', 'servers/mine/open', h, { n: 2, tab })).body.url).searchParams.get('tab');
  assert.strictEqual(await on('results'), 'results'); assert.strictEqual(await on('cameras'), 'cameras');
  assert.strictEqual(await on('../../evil'), 'live', 'anything else opens on Live');
});

test('the overall state: on only once every server is', async () => {
  const { call, company, store } = await setup({ max: 2 });
  const h = await company('sam', 'peak');
  await start(call, h, 4, 2);
  const state = async () => (await call('GET', 'servers/mine', h)).body.server.state;
  assert.strictEqual(await state(), 'off');
  await store.put('serverstate', 'peak', { id: 'peak', state: 'on' });
  assert.strictEqual(await state(), 'starting');
  await store.put('serverstate', 'peak~2', { id: 'peak~2', state: 'on' });
  assert.strictEqual(await state(), 'on');
  await store.put('serverstate', 'peak~2', { id: 'peak~2', state: 'stopping' });
  assert.strictEqual(await state(), 'stopping');
});

test('another company can\'t reach this one\'s server', async () => {
  const { call, company, store } = await setup({ max: 5 });
  const a = await company('a', 'alpha'), b = await company('b', 'bravo');
  await start(call, a);
  await store.put('serverstate', 'alpha', { id: 'alpha', state: 'on' });
  assert.strictEqual((await call('GET', 'servers/mine', b)).body.server.state, 'off');
  await call('POST', 'servers/mine/stop', b, {});
  assert.strictEqual((await store.get('serverwant', 'alpha')).desired, 'on');
  assert.strictEqual((await call('POST', 'servers/mine/open', b, { n: 1 })).status, 409);
});

test('a server reports with its key: Stop reaches it, and finishing marks it ready to turn off', async () => {
  const { call, company, store } = await setup();
  const h = await company('sam', 'peak');
  await start(call, h);
  const key = { 'X-Server-Key': (await store.get('server', 'peak')).serverKey };
  assert.strictEqual((await call('POST', 'servers/report', { 'X-Server-Key': 'wrong' }, {})).status, 401);
  assert.strictEqual((await call('POST', 'servers/report', {}, {})).status, 401);
  assert.strictEqual((await call('POST', 'servers/report', key, { what: 'alive', cams: 2, judges: 1 })).body.stop, false);
  assert.strictEqual((await call('GET', 'servers/mine', h)).body.server.servers[0].cameras, 2);
  await call('POST', 'servers/mine/stop', h, {});
  assert.strictEqual((await call('POST', 'servers/report', key, { what: 'alive' })).body.stop, true);
  await call('POST', 'servers/report', key, { what: 'finished' });
  assert.strictEqual((await store.get('serverwant', 'peak')).finished, true);
});

test('its recordings go to the owner\'s cloud recordings with the key it was given', async () => {
  const { call, company, store } = await setup();
  const h = await company('sam', 'peak');
  await start(call, h);
  const { receiverKey } = await store.get('server', 'peak');
  const link = await store.get('reckey', crypto.createHash('sha256').update(receiverKey).digest('hex'));
  const uid = JSON.parse(Buffer.from(h.Authorization.split(' ')[1].split('.')[0], 'base64url').toString()).uid;
  assert.strictEqual(link.partition, `rec:${crypto.createHash('sha256').update(uid).digest('hex').slice(0, 32)}`);
});
