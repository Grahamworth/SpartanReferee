'use strict';
// SpartanReferee is one organisation: admins, and the referees an admin adds. No registration, no cards.
const test = require('node:test');
const assert = require('node:assert');
const { createApi } = require('../src/core');
const { memoryStore } = require('../src/store');

function setup() {
  const store = memoryStore(); const clock = 1_800_000_000_000;
  // payments are on here, to show that nobody is asked for a card anyway
  const api = createApi({ store, now: () => clock, payments: { startSetup: async () => ({}), finishSetup: async () => ({}) }, secret: 'test-secret-test-secret-test-secret',
    googleClientId: 'x', adminEmails: ['boss@example.com'], maxRunningServers: 2, serverHourPrice: 0.66,
    verifyGoogle: async (t) => ({ sub: t, email: `${t}@example.com`, name: t }) });
  const login = async (who) => ({ Authorization: `Bearer ${(await api.handle({ method: 'POST', path: 'auth/google', body: { idToken: who } })).body.token}` });
  const call = (method, path, headers, body) => api.handle({ method, path, headers, body });
  return { store, login, call };
}

test('there is no registration', async () => {
  const { call, login } = setup();
  const r = await call('POST', 'companies', await login('sam'), { name: 'Peak Co', id: 'peak', contact: 'Sam' });
  assert.strictEqual(r.status, 410);
});

test('someone not on the list isn\'t in: no organisation, no servers, no results', async () => {
  const { call, login } = setup();
  const h = await login('sam');
  assert.strictEqual((await call('GET', 'companies/mine', h)).body.company, null);
  assert.strictEqual((await call('GET', 'servers/mine', h)).status, 404);
  assert.strictEqual((await call('POST', 'servers/mine/start', h, { cameras: 2, hours: 2 })).status, 404);
});

test('an admin adds a referee, who is then in, and books and starts servers with no card', async () => {
  const { call, login } = setup();
  const boss = await login('boss');
  const added = await call('POST', 'admin/referees', boss, { email: ' Sam@Example.com ' });
  assert.strictEqual(added.status, 200);
  assert.deepStrictEqual(added.body.people.map((p) => p.email), ['sam@example.com']);
  assert.strictEqual(added.body.people[0].addedBy, 'boss@example.com');
  const h = await login('sam');
  const c = (await call('GET', 'companies/mine', h)).body.company;
  assert.strictEqual(c.id, 'spartan'); assert.strictEqual(c.role, 'owner'); assert.strictEqual(c.admin, false);
  const s = (await call('GET', 'servers/mine', h)).body.server;
  assert.strictEqual(s.needsCard, false); assert.strictEqual(s.paysFirst, false); assert.strictEqual(s.bookingsOpen, true);
  // with no booking chosen it's their own training, which is booked from Learning (30 minutes, not extended), not here
  assert.strictEqual((await call('POST', 'servers/mine/start', h, { cameras: 2, hours: 2 })).status, 403);
  const r = await call('POST', 'learn/practice-camera', h, { cameras: 2 });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.server.bookedHours, 0.5); assert.strictEqual(r.body.server.unit.kind, 'training');
  assert.strictEqual((await call('POST', 'servers/mine/extend', h, { hours: 1 })).status, 409);
});

test('admins are in without being on the list of referees', async () => {
  const { call, login } = setup();
  const c = (await call('GET', 'companies/mine', await login('boss'))).body.company;
  assert.strictEqual(c.id, 'spartan'); assert.strictEqual(c.admin, true);
});

test('only admins see and change who can sign in; a referee taken off loses access at once', async () => {
  const { call, login } = setup();
  const boss = await login('boss');
  await call('POST', 'admin/referees', boss, { email: 'sam@example.com' });
  const sam = await login('sam');
  assert.strictEqual((await call('GET', 'admin/referees', sam)).status, 403);
  assert.strictEqual((await call('POST', 'admin/referees', sam, { email: 'pal@example.com' })).status, 403);
  assert.strictEqual((await call('GET', 'companies/mine/people', sam)).status, 403);
  assert.strictEqual((await call('POST', 'admin/referees', boss, { email: 'sam@example.com' })).status, 409, 'already on the list');
  assert.strictEqual((await call('POST', 'admin/referees', boss, { email: 'not an address' })).status, 400);
  const off = await call('POST', 'admin/referees', boss, { email: 'sam@example.com', remove: true });
  assert.deepStrictEqual(off.body.people, []);
  assert.strictEqual((await call('GET', 'companies/mine', sam)).body.company, null);
  assert.strictEqual((await call('GET', 'servers/mine', sam)).status, 404);
});

test('a Microsoft account that doesn\'t vouch for its address isn\'t in, even with that address on the list', async () => {
  const { call, login, store } = setup();
  await call('POST', 'admin/referees', await login('boss'), { email: 'sam@example.com' });
  // a Google account whose address Google says isn't verified stands in for one with no proven address
  const h = await login('sam');
  const uid = JSON.parse(Buffer.from(h.Authorization.split(' ')[1].split('.')[0], 'base64url').toString()).uid;
  await store.put('user', uid, { ...(await store.get('user', uid)), emailVerified: false });
  assert.strictEqual((await call('GET', 'companies/mine', h)).body.company, null);
});

test('only admins change the organisation\'s name and colours', async () => {
  const { call, login } = setup();
  const boss = await login('boss');
  await call('POST', 'admin/referees', boss, { email: 'sam@example.com' });
  assert.strictEqual((await call('PUT', 'companies/mine', await login('sam'), { name: 'Mine now' })).status, 403);
  const r = await call('PUT', 'companies/mine', boss, { name: 'Spartan Race', theme: { primary: '#d71f19' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.company.name, 'Spartan Race'); assert.strictEqual(r.body.company.theme.primary, '#d71f19');
});
