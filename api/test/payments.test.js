'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createApi } = require('../src/core');
const { memoryStore } = require('../src/store');
const { createPayments } = require('../src/payments');

const KEY = 'sk_test_x', SITE = 'https://site.example';
const answers = (list, sent = []) => async (url, init) => {
  sent.push({ url, method: init.method, auth: init.headers.Authorization, form: init.body ? Object.fromEntries(init.body) : null });
  const [status, body] = list.shift();
  return { ok: status < 400, status, json: async () => body };
};
const saved = (over = {}) => ({ status: 'complete', customer: 'cus_1', metadata: { company: 'peak' }, setup_intent: { status: 'succeeded', payment_method: { id: 'pm_1', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 } } }, ...over });

test('with no key, cards are off', () => {
  assert.strictEqual(createPayments({ secretKey: '', siteUrl: SITE }), null);
});
test('a card is saved on Stripe\'s own page, in setup mode, so nothing is charged', async () => {
  const sent = [], p = createPayments({ secretKey: KEY, siteUrl: SITE, fetchFn: answers([[200, { id: 'cus_1' }], [200, { url: 'https://checkout.stripe.com/x' }]], sent) });
  const r = await p.startSetup({ companyId: 'peak', companyName: 'Peak', email: 'sam@example.com' });
  assert.deepStrictEqual(r, { url: 'https://checkout.stripe.com/x', customerId: 'cus_1' });
  assert.strictEqual(sent[0].auth, 'Bearer ' + KEY);
  assert.strictEqual(sent[0].form.email, 'sam@example.com');
  assert.strictEqual(sent[1].form.mode, 'setup');
  assert.strictEqual(sent[1].form.customer, 'cus_1');
  assert.strictEqual(sent[1].form['metadata[company]'], 'peak');
  assert.strictEqual(sent[1].form.success_url, SITE + '/console.html?payment={CHECKOUT_SESSION_ID}');
});
test('someone who already has a Stripe customer keeps it', async () => {
  const sent = [], p = createPayments({ secretKey: KEY, siteUrl: SITE, fetchFn: answers([[200, { url: 'u' }]], sent) });
  await p.startSetup({ companyId: 'peak', companyName: 'Peak', customerId: 'cus_9' });
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].form.customer, 'cus_9');
});
test('only a finished setup for this company counts, as Stripe itself says', async () => {
  const with_ = (body) => createPayments({ secretKey: KEY, siteUrl: SITE, fetchFn: answers([[200, body]]) });
  assert.deepStrictEqual(await with_(saved()).finishSetup('cs_1', 'peak'), { customerId: 'cus_1', paymentMethodId: 'pm_1', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 });
  await assert.rejects(with_(saved()).finishSetup('cs_1', 'other'), /another company/);
  await assert.rejects(with_(saved({ status: 'open' })).finishSetup('cs_1', 'peak'), /saved/);
  await assert.rejects(with_(saved({ setup_intent: { status: 'requires_action' } })).finishSetup('cs_1', 'peak'), /saved/);
  await assert.rejects(createPayments({ secretKey: KEY, siteUrl: SITE, fetchFn: answers([[404, { error: { message: 'none' } }]]) }).finishSetup('cs_1', 'peak'), /404/);
});

async function setup(payments) {
  const store = memoryStore(); let clock = 1_800_000_000_000;
  const api = createApi({ store, now: () => clock, secret: 'test-secret-test-secret-test-secret', googleClientId: 'x', adminEmails: ['boss@example.com'], payments, maxRunningServers: 3, serverHourPrice: 0.66, verifyGoogle: async (t) => ({ sub: t, email: t + '@example.com', name: t }) });
  const login = async (who) => ({ 'X-Session': (await api.handle({ method: 'POST', path: 'auth/google', body: { idToken: who } })).body.token });
  const call = (method, path, headers, body) => api.handle({ method, path, headers, body });
  const company = async (who, id) => { const h = await login(who); await call('POST', 'companies', h, { name: id + ' Co', id, contact: 'Sam', theme: {} }); return h; };
  return { store, login, call, company, pass: (ms) => { clock += ms; }, now: () => clock };
}
const pretend = () => ({ startSetup: async ({ companyId }) => ({ url: 'https://stripe.example/' + companyId, customerId: 'cus_' + companyId }), finishSetup: async (id, company) => { if (id !== 'cs_' + company) throw new Error('no'); return { customerId: 'cus_' + company, paymentMethodId: 'pm', brand: 'visa', last4: '4242', expMonth: 1, expYear: 2030 }; } });
const BOOK = { cameras: 2, hours: 2 };

test('the first booking needs a card, and it\'s the server that insists', async () => {
  const { call, company } = await setup(pretend());
  const h = await company('sam', 'peak');
  const s = (await call('GET', 'servers/mine', h)).body.server;
  assert.strictEqual(s.needsCard, true); assert.strictEqual(s.card, null); assert.strictEqual(s.cardsOn, true);
  assert.strictEqual((await call('POST', 'servers/mine/start', h, BOOK)).status, 402);
  assert.strictEqual((await call('POST', 'servers/mine/payment', h, {})).body.url, 'https://stripe.example/peak');
  const done = await call('POST', 'servers/mine/payment-done', h, { session: 'cs_peak' });
  assert.strictEqual(done.status, 200);
  assert.deepStrictEqual(done.body.server.card, { brand: 'visa', last4: '4242', expMonth: 1, expYear: 2030 });
  assert.strictEqual(done.body.server.needsCard, false);
  assert.strictEqual((await call('POST', 'servers/mine/start', h, BOOK)).status, 200);
});
test('coming back with someone else\'s or a made-up session saves nothing', async () => {
  const { call, company, store } = await setup(pretend());
  const h = await company('sam', 'peak');
  await company('jo', 'other');
  for (const session of ['cs_other', 'cs_nope', 'nonsense', '', 'cs_../../x']) assert.strictEqual((await call('POST', 'servers/mine/payment-done', h, { session })).status, 400, session);
  assert.strictEqual((await store.get('company', 'peak')).payment, undefined);
  assert.strictEqual((await call('POST', 'servers/mine/start', h, BOOK)).status, 402);
});
test('a customer can\'t give themselves a card or their own price through their details', async () => {
  const { call, company, store } = await setup(pretend());
  const h = await company('sam', 'peak');
  await call('PUT', 'companies/mine', h, { payment: { last4: '0000' }, cameraHour: 0.01, status: 'approved' });
  const c = await store.get('company', 'peak');
  assert.strictEqual(c.payment, undefined); assert.strictEqual(c.cameraHour, undefined);
});
test('an admin books with no card', async () => {
  const { call, company } = await setup(pretend());
  const h = await company('boss', 'mine');
  const s = (await call('GET', 'servers/mine', h)).body.server;
  assert.strictEqual(s.needsCard, false); assert.strictEqual(s.adminNoCard, true);
  assert.strictEqual((await call('POST', 'servers/mine/start', h, BOOK)).status, 200);
});
test('with cards off, a customer can\'t book, and is told so', async () => {
  const { call, company } = await setup(null);
  const h = await company('sam', 'peak');
  assert.strictEqual((await call('GET', 'servers/mine', h)).body.server.cardsOn, false);
  assert.strictEqual((await call('POST', 'servers/mine/payment', h, {})).status, 503);
  assert.strictEqual((await call('POST', 'servers/mine/start', h, BOOK)).status, 402);
});

test('admins by email: added ones count at once, and removed ones stop counting', async () => {
  const { call, login, pass } = await setup(pretend());
  const boss = await login('boss'), sam = await login('sam');
  assert.strictEqual((await call('GET', 'admin/admins', sam)).status, 403);
  assert.strictEqual((await call('POST', 'admin/admins', sam, { email: 'sam@example.com' })).status, 403);
  assert.strictEqual((await call('GET', 'me', sam)).body.admin, false);
  const added = await call('POST', 'admin/admins', boss, { email: ' Sam@Example.com ' });
  assert.deepStrictEqual(added.body.added.map((a) => a.email), ['sam@example.com']);
  assert.strictEqual(added.body.added[0].addedBy, 'boss@example.com');
  assert.deepStrictEqual(added.body.permanent, ['boss@example.com']);
  assert.strictEqual((await call('GET', 'me', sam)).body.admin, true);
  assert.strictEqual((await call('GET', 'admin/customers', sam)).status, 200);
  pass(60e3);
  assert.strictEqual((await call('GET', 'me', sam)).body.admin, true, 'it lasts');
  await call('POST', 'admin/admins/remove', boss, { email: 'sam@example.com' });
  assert.strictEqual((await call('GET', 'me', sam)).body.admin, false);
  assert.strictEqual((await call('GET', 'admin/customers', sam)).status, 403);
});
test('nobody can lock everyone out, or remove themselves', async () => {
  const { call, login } = await setup(pretend());
  const boss = await login('boss'), sam = await login('sam');
  await call('POST', 'admin/admins', boss, { email: 'sam@example.com' });
  assert.strictEqual((await call('POST', 'admin/admins/remove', sam, { email: 'boss@example.com' })).status, 400);
  assert.strictEqual((await call('POST', 'admin/admins/remove', boss, { email: 'boss@example.com' })).status, 400);
  assert.strictEqual((await call('POST', 'admin/admins/remove', sam, { email: 'sam@example.com' })).status, 400);
});
test('a bad or repeated address is refused', async () => {
  const { call, login } = await setup(pretend());
  const boss = await login('boss');
  for (const email of ['', 'nope', 'a@b', 'a b@c.com', 'a/b@c.com']) assert.strictEqual((await call('POST', 'admin/admins', boss, { email })).status, 400, email);
  assert.strictEqual((await call('POST', 'admin/admins', boss, { email: 'boss@example.com' })).status, 409);
  await call('POST', 'admin/admins', boss, { email: 'x@example.com' });
  assert.strictEqual((await call('POST', 'admin/admins', boss, { email: 'X@example.com' })).status, 409);
});

test('prices: everyone pays the default, unless a customer has their own', async () => {
  const { call, login, company, store } = await setup(pretend());
  const boss = await login('boss'), h = await company('sam', 'peak');
  await call('PUT', 'admin/pricing', boss, { markupPercent: 100 });
  const price = async () => (await call('GET', 'servers/mine', h)).body.server.price.cameraHour;
  assert.strictEqual(await price(), 0.68);
  assert.strictEqual((await call('PUT', 'admin/customers/peak/price', h, { cameraHour: 0.01 })).status, 403);
  const own = await call('PUT', 'admin/customers/peak/price', boss, { cameraHour: 0.5 });
  assert.strictEqual(own.body.customPrice, true); assert.strictEqual(own.body.standardCameraHour, 0.68);
  assert.strictEqual(await price(), 0.5);
  await call('PUT', 'admin/pricing', boss, { markupPercent: 500 });
  assert.strictEqual(await price(), 0.5, 'changing the default leaves their price alone');
  const list = (await call('GET', 'admin/customers', boss)).body.customers.find((c) => c.id === 'peak');
  assert.strictEqual(list.price.cameraHour, 0.5); assert.strictEqual(list.price.customPrice, true);
  for (const cameraHour of [-1, 1000, 'lots']) assert.strictEqual((await call('PUT', 'admin/customers/peak/price', boss, { cameraHour })).status, 400);
  assert.strictEqual((await call('PUT', 'admin/customers/peak/price', boss, { cameraHour: null })).body.customPrice, false);
  assert.strictEqual(await price(), 2.02);
  assert.strictEqual((await store.get('company', 'peak')).cameraHour, undefined);
  assert.strictEqual((await call('PUT', 'admin/customers/peak/price', boss, { cameraHour: 0 })).body.cameraHour, 0, 'free is allowed');
});
test('a booking uses the customer\'s own price, and keeps it', async () => {
  const { call, login, company } = await setup(pretend());
  const boss = await login('boss'), h = await company('sam', 'peak');
  await call('POST', 'servers/mine/payment-done', h, { session: 'cs_peak' });
  await call('PUT', 'admin/customers/peak/price', boss, { cameraHour: 0.5 });
  assert.strictEqual((await call('POST', 'servers/mine/start', h, BOOK)).body.server.bookedCost, 2);
  await call('PUT', 'admin/customers/peak/price', boss, { cameraHour: 0.9 });
  assert.strictEqual((await call('GET', 'servers/mine', h)).body.server.bookedCameraHour, 0.5);
});

test('past bookings: newest first, with what happened to each, and only your own', async () => {
  const { call, company, pass } = await setup(pretend());
  const h = await company('sam', 'peak'), other = await company('jo', 'other');
  await call('POST', 'servers/mine/payment-done', h, { session: 'cs_peak' });
  assert.deepStrictEqual((await call('GET', 'servers/mine/history', h)).body.bookings, []);
  await call('POST', 'servers/mine/start', h, BOOK);
  let b = (await call('GET', 'servers/mine/history', h)).body.bookings;
  assert.strictEqual(b[0].state, 'running'); assert.strictEqual(b[0].cameras, 2); assert.strictEqual(b[0].hours, 2);
  await call('POST', 'servers/mine/extend', h, { hours: 1 });
  assert.strictEqual((await call('GET', 'servers/mine/history', h)).body.bookings[0].hours, 3);
  pass(3600e3);
  await call('POST', 'servers/mine/stop', h, {});
  b = (await call('GET', 'servers/mine/history', h)).body.bookings;
  assert.strictEqual(b[0].state, 'stopped'); assert.strictEqual(b[0].hoursRun, 1); assert.strictEqual(b[0].cost, 0.68, '2 cameras for an hour at 34p');
  pass(3600e3);
  await call('POST', 'servers/mine/start', h, { cameras: 1, hours: 1 });
  pass(2 * 3600e3);
  b = (await call('GET', 'servers/mine/history', h)).body.bookings;
  assert.strictEqual(b.length, 2);
  assert.strictEqual(b[0].cameras, 1); assert.strictEqual(b[0].state, 'finished'); assert.strictEqual(b[0].hoursRun, 1);
  assert.deepStrictEqual((await call('GET', 'servers/mine/history', other)).body.bookings, []);
  assert.strictEqual((await call('GET', 'servers/mine/history', {})).status, 401);
});

test('a server\'s settings stay with the site, and only that server can reach them', async () => {
  const { call, company, store } = await setup(pretend());
  const h = await company('sam', 'peak');
  await call('POST', 'servers/mine/payment-done', h, { session: 'cs_peak' });
  await call('POST', 'servers/mine/start', h, BOOK);
  const key = { 'x-server-key': (await store.get('server', 'peak')).serverKey };
  assert.strictEqual((await call('GET', 'servers/settings', key)).body.settings, null);
  const settings = { judge: { 'burpeeJudge.settings.cam1': '{"exercise":"squats"}' }, stations: 3, youtube: {} };
  assert.strictEqual((await call('POST', 'servers/settings', key, { settings })).status, 200);
  assert.deepStrictEqual((await call('GET', 'servers/settings', key)).body.settings, settings);
  assert.strictEqual((await call('GET', 'servers/settings', { 'x-server-key': 'nope' })).status, 401);
  assert.strictEqual((await call('GET', 'servers/settings', h)).status, 401);
  assert.strictEqual((await call('POST', 'servers/settings', key, { settings: { judge: { x: 'y'.repeat(40000) } } })).status, 400);
});
test('a server may only be deleted once it says everything is saved, and a new booking starts over', async () => {
  const { call, company, store } = await setup(pretend());
  const h = await company('sam', 'peak');
  await call('POST', 'servers/mine/payment-done', h, { session: 'cs_peak' });
  await call('POST', 'servers/mine/start', h, BOOK);
  const key = { 'x-server-key': (await store.get('server', 'peak')).serverKey };
  await call('POST', 'servers/report', key, { what: 'finished', saved: false });
  assert.strictEqual((await store.get('serverwant', 'peak')).saved, false);
  await call('POST', 'servers/report', key, { what: 'finished', saved: 'yes' });
  assert.strictEqual((await store.get('serverwant', 'peak')).saved, false, 'only a plain yes');
  await call('POST', 'servers/report', key, { what: 'finished', saved: true });
  assert.strictEqual((await store.get('serverwant', 'peak')).saved, true);
  await call('POST', 'servers/mine/start', h, BOOK);
  assert.strictEqual((await store.get('serverwant', 'peak')).saved, false);
});
