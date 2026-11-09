'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createApi } = require('../src/core');
const { memoryStore } = require('../src/store');
// a customer's booking: checkout, then the (pretend) payment, which makes it
const book = async (call, h, body) => { const co = await call('POST', 'servers/mine/checkout', h, body); return co.status === 200 ? call('POST', 'servers/mine/pay', h, { checkout: co.body.checkout.id }) : co; };


async function setup() {
  const store = memoryStore(), clock = 1_800_000_000_000;
  const api = createApi({ store, now: () => clock, secret: 'test-secret-test-secret-test-secret', googleClientId: 'x', adminEmails: ['boss@example.com'], maxRunningServers: 4, serverHourPrice: 0.66, verifyGoogle: async (t) => ({ sub: t, email: `${t}@example.com`, name: t }) });
  const login = async (who) => ({ Authorization: `Bearer ${(await api.handle({ method: 'POST', path: 'auth/google', body: { idToken: who } })).body.token}` });
  const call = (method, path, headers, body) => api.handle({ method, path, headers, body });
  const boss = await login('boss');
  const company = async (who, id) => { const h = await login(who); await call('POST', 'companies', h, { name: `${id} Co`, id, contact: 'Sam', website: 'x.example', theme: {} }); await store.put('company', id, { ...(await store.get('company', id)), payment: { brand: 'visa', last4: '4242', expMonth: 1, expYear: 2030 } }); await call('POST', `admin/companies/${id}/approve`, boss, {}); return h; };
  return { store, call, login, boss, company, month: new Date(clock).toISOString().slice(0, 7) };
}

test('only admins see or change pricing and customers', async () => {
  const { call, login } = await setup();
  const h = await login('sam');
  for (const [m, p, b] of [['GET', 'admin/pricing'], ['PUT', 'admin/pricing', { markupPercent: 50 }], ['GET', 'admin/customers'], ['POST', 'admin/customers/x/stop', {}]]) {
    assert.strictEqual((await call(m, p, h, b)).status, 403, p);
    assert.strictEqual((await call(m, p, {}, b)).status, 403, `${p} signed out`);
  }
});

test('the price per camera hour is Azure\'s price for a server, shared by its 2 cameras, plus the percentage, rounded up to the penny', async () => {
  const { call, boss } = await setup();
  const r0 = await call('GET', 'admin/pricing', boss);
  const { storageCameraHour, azureCameraHour, ...rest } = r0.body;
  assert.deepStrictEqual(rest, { markupPercent: 0, azureServerHour: 0.66, keepDays: 7, camerasPerServer: 2, standardCameraHour: 0.34, cameraHour: 0.34, customPrice: false });
  assert.ok(Math.abs(storageCameraHour - 0.0055) < 0.0001, 'about 1.63 GB for 7 days at £0.0144 per GB per month');
  assert.ok(Math.abs(azureCameraHour - (0.33 + storageCameraHour)) < 1e-9);
  for (const [m, want] of [[30, 0.44], [50, 0.51], [100, 0.68], [0, 0.34]]) {
    const r = await call('PUT', 'admin/pricing', boss, { markupPercent: m });
    assert.strictEqual(r.body.cameraHour, want, `${m}%`);
  }
  for (const bad of [-1, 1001, 'x', null]) assert.strictEqual((await call('PUT', 'admin/pricing', boss, { markupPercent: bad })).status, 400, String(bad));
});

test('customers see the price but not Azure\'s cost or your percentage', async () => {
  const { call, boss, company } = await setup();
  await call('PUT', 'admin/pricing', boss, { markupPercent: 50 });
  const h = await company('sam', 'peak');
  const r = await call('GET', 'servers/mine', h);
  assert.strictEqual(r.body.server.price.cameraHour, 0.51);
  const text = JSON.stringify(r.body);
  for (const secret of ['markup', 'azure', '0.66', '0.33']) assert.ok(!text.includes(secret), secret);
});

test('the cost shown is per camera, including an odd number of them, and a booking keeps the price it started at', async () => {
  const { call, boss, company, store } = await setup();
  await call('PUT', 'admin/pricing', boss, { markupPercent: 50 });
  const h = await company('sam', 'peak');
  const r = await book(call, h, { cameras: 3, hours: 4 });
  assert.strictEqual(r.body.server.serverCount, 2);
  assert.strictEqual(r.body.server.bookedCost, 6.12, '3 cameras x 4 hours x 0.51');
  assert.strictEqual((await store.get('serverwant', 'peak')).bookedCameras, 2);
  assert.strictEqual((await store.get('serverwant', 'peak~2')).bookedCameras, 1);
  assert.strictEqual((await store.get('serverwant', 'peak')).cameraHour, 0.51);
  // its 2 cameras: the server, and keeping what they record for 7 days (about 0.55p per camera hour)
  assert.ok(Math.abs((await store.get('serverwant', 'peak')).azureHour - 0.671) < 0.0005);
  await call('PUT', 'admin/pricing', boss, { markupPercent: 200 });
  const e = await call('POST', 'servers/mine/extend', h, { hours: 2 });
  assert.strictEqual(e.body.server.bookedCost, 9.18, 'still 0.51, now 6 hours');
  assert.strictEqual(e.body.server.price.cameraHour, 1.01, 'new bookings pay the new price');
});

test('the customer list shows each one\'s booking and use, and totals them', async () => {
  const { call, boss, company, store, month } = await setup();
  await company('a', 'alpha'); await company('b', 'bravo');
  await store.put('serverstate', 'alpha', { id: 'alpha', state: 'off', minutes: { [month]: 120 }, cameraMinutes: { [month]: 240 }, charge: { [month]: 2 }, azure: { [month]: 1.32 } });
  await store.put('serverstate', 'alpha~2', { id: 'alpha~2', state: 'off', minutes: { [month]: 60 }, cameraMinutes: { [month]: 60 }, charge: { [month]: 0.5 }, azure: { [month]: 0.66 } });
  await store.put('serverstate', 'bravo', { id: 'bravo', state: 'off', minutes: { '2020-01': 600 }, charge: { '2020-01': 99 }, azure: { '2020-01': 99 } });
  const r = await call('GET', 'admin/customers', boss);
  const a = r.body.customers.find((c) => c.id === 'alpha'), b = r.body.customers.find((c) => c.id === 'bravo');
  assert.deepStrictEqual(a.usage, { serverHours: 3, cameraHours: 5, charge: 2.5, azure: 1.98, profit: 0.52 });
  assert.strictEqual(b.usage.charge, 0, 'last month\'s isn\'t this month\'s');
  assert.deepStrictEqual(r.body.totals, { charge: 2.5, azure: 1.98, profit: 0.52, cameraHours: 5 });
  assert.strictEqual(a.email, 'a@example.com');
  assert.ok(!JSON.stringify(r.body).includes('serverKey'));
});

test('a company\'s own usage page shows its use and charge, not another\'s', async () => {
  const { call, company, store, month } = await setup();
  const h = await company('a', 'alpha'); await company('b', 'alph');
  await store.put('serverstate', 'alph', { id: 'alph', state: 'off', charge: { [month]: 50 } });
  await store.put('serverstate', 'alpha', { id: 'alpha', state: 'off', cameraMinutes: { [month]: 90 }, charge: { [month]: 0.75 }, azure: { [month]: 0.5 } });
  const r = await call('GET', 'servers/mine', h);
  assert.deepStrictEqual(r.body.server.used, { cameraHours: 1.5, charge: 0.75 });
});

test('an admin can stop a company\'s servers, and suspending or declining stops them too', async () => {
  const { call, boss, company, store } = await setup();
  const a = await company('a', 'alpha'), b = await company('b', 'bravo');
  await book(call, a, { cameras: 3, hours: 4 });
  await book(call, b, { cameras: 1, hours: 4 });
  assert.strictEqual((await call('POST', 'admin/customers/nobody/stop', boss, {})).status, 404);
  assert.strictEqual((await call('POST', 'admin/customers/alpha/stop', boss, {})).status, 200);
  assert.strictEqual((await store.get('serverwant', 'alpha')).desired, 'off');
  assert.strictEqual((await store.get('serverwant', 'alpha~2')).desired, 'off');
  assert.strictEqual((await store.get('serverwant', 'bravo')).desired, 'on', 'others carry on');
  await call('POST', 'admin/companies/bravo/suspend', boss, { note: 'Unpaid' });
  assert.strictEqual((await store.get('serverwant', 'bravo')).desired, 'off');
  const list = (await call('GET', 'admin/customers', boss)).body.customers;
  assert.strictEqual(list.find((c) => c.id === 'bravo').status, 'suspended');
  assert.strictEqual(list.find((c) => c.id === 'bravo').note, 'Unpaid');
});
