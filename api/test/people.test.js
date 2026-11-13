'use strict';
// A company's people: the owner adds addresses, and whoever signs in with one of them, by Google, Microsoft or email, is part of the
// company (its servers and results) but can't book, pay, change its details or see who else is in it.
const test = require('node:test');
const assert = require('node:assert');
const { createApi } = require('../src/core');
const { memoryStore } = require('../src/store');

const VERIFIER = 'v'.repeat(43);
function setup() {
  const store = memoryStore(); const clock = 1_800_000_000_000;
  const api = createApi({
    store, now: () => clock, secret: 'test-secret-test-secret-test-secret', googleClientId: 'x', adminEmails: ['boss@example.com'],
    blobSigner: (o) => `https://store/${o.blob}?sp=${o.perm}`,
    // idToken "sam" is sam@example.com; "unverified:x@y.com" is a Google account whose address Google hasn't verified
    verifyGoogle: async (t) => (t.startsWith('unverified:') ? { sub: t, email: t.slice(11), email_verified: false } : { sub: t, email: t.includes('@') ? t : `${t}@example.com`, name: t }),
    // code "vouched:x@y.com" or "shown:x@y.com" (an address Microsoft doesn't vouch for)
    microsoftSignIn: { redeem: async (code) => { const [how, email] = code.split(':'); return { sub: `ms-${code}`, email: how === 'vouched' ? email : '', shownEmail: email, name: '' }; } },
    emailSignIn: { redeem: async (code) => ({ sub: `em-${code}`, email: code, name: '' }) },
  });
  const call = (method, path, headers, body) => api.handle({ method, path, headers, body });
  const head = (r) => ({ Authorization: `Bearer ${r.body.token}` });
  const google = async (who) => head(await call('POST', 'auth/google', {}, { idToken: who }));
  const microsoft = async (code) => head(await call('POST', 'auth/microsoft', {}, { code, verifier: VERIFIER }));
  const email = async (address) => head(await call('POST', 'auth/email', {}, { code: address, verifier: VERIFIER }));
  const register = async (h, id = 'spartan', name = 'Spartan') => call('POST', 'companies', h, { name, id, contact: 'Sam Lee', theme: {} });
  const mine = async (h) => (await call('GET', 'companies/mine', h)).body.company;
  const invite = (h, address) => call('POST', 'companies/mine/people', h, { email: address });
  const remove = (h, address) => call('POST', 'companies/mine/people', h, { email: address, remove: true });
  return { store, call, google, microsoft, email, register, mine, invite, remove };
}

test('someone invited gets in with that address, by Google, vouched Microsoft or email', async () => {
  const s = setup();
  const owner = await s.google('sam');
  assert.strictEqual((await s.register(owner)).status, 200);
  assert.strictEqual((await s.invite(owner, '  Jo@Spartan.com ')).status, 200);
  for (const h of [await s.google('jo@spartan.com'), await s.microsoft('vouched:jo@spartan.com'), await s.email('jo@spartan.com')]) {
    const c = await s.mine(h);
    assert.strictEqual(c?.id, 'spartan'); assert.strictEqual(c.role, 'member');
    assert.strictEqual(c.contact, undefined, 'the owner\'s contact details stay with the owner');
  }
  const people = (await s.call('GET', 'companies/mine/people', owner)).body.people;
  assert.deepStrictEqual(people.map((p) => [p.email, p.role]), [['sam@example.com', 'owner'], ['jo@spartan.com', 'member']]);
  assert.ok(people[1].seen > 0, 'it shows they\'ve signed in');
});

test('an address the sign-in doesn\'t prove doesn\'t count', async () => {
  const s = setup();
  const owner = await s.google('sam'); await s.register(owner);
  await s.invite(owner, 'jo@spartan.com');
  assert.strictEqual(await s.mine(await s.microsoft('shown:jo@spartan.com')), null, 'Microsoft didn\'t vouch for it');
  assert.strictEqual(await s.mine(await s.google('unverified:jo@spartan.com')), null, 'Google hasn\'t verified it');
  assert.strictEqual(await s.mine(await s.google('someone-else')), null);
});

test('taken off the list, they lose access straight away; the owner\'s address can\'t be taken off', async () => {
  const s = setup();
  const owner = await s.google('sam'); await s.register(owner);
  await s.invite(owner, 'jo@spartan.com');
  const jo = await s.google('jo@spartan.com');
  assert.ok(await s.mine(jo));
  assert.strictEqual((await s.remove(owner, 'jo@spartan.com')).status, 200);
  assert.strictEqual(await s.mine(jo), null);
  assert.strictEqual((await s.call('GET', 'servers/mine', jo)).status, 404);
  assert.strictEqual((await s.remove(owner, 'sam@example.com')).status, 400);
  assert.strictEqual((await s.remove(owner, 'nobody@x.com')).status, 404);
});

test('people see the servers and results, but can\'t book, pay, change details or see who\'s in it', async () => {
  const s = setup();
  const owner = await s.google('sam'); await s.register(owner);
  await s.store.put('company', 'spartan', { ...(await s.store.get('company', 'spartan')), payment: { brand: 'visa', last4: '4242', expMonth: 1, expYear: 2030 } });
  await s.invite(owner, 'jo@spartan.com');
  const jo = await s.google('jo@spartan.com');
  const server = (await s.call('GET', 'servers/mine', jo)).body.server;
  assert.strictEqual(server.role, 'member'); assert.strictEqual(server.card, undefined);
  assert.strictEqual((await s.call('GET', 'servers/mine', owner)).body.server.card.last4, '4242');
  assert.strictEqual((await s.call('GET', 'servers/mine/history', jo)).status, 200);
  for (const b of ['checkout', 'pay', 'start', 'extend', 'stop', 'payment']) assert.strictEqual((await s.call('POST', `servers/mine/${b}`, jo, { cameras: 2, hours: 2 })).status, 403, b);
  assert.strictEqual((await s.call('POST', 'servers/mine/open', jo, { n: 1 })).status, 409, 'opening is allowed (it just isn\'t on)');
  assert.strictEqual((await s.call('PUT', 'companies/mine', jo, { name: 'Hacked' })).status, 403);
  assert.strictEqual((await s.mine(owner)).name, 'Spartan');
  assert.strictEqual((await s.call('GET', 'companies/mine/people', jo)).status, 403);
  assert.strictEqual((await s.invite(jo, 'friend@x.com')).status, 403);
  // the company's recordings are the owner's, listed for everyone in it
  const ownerRecs = (await s.call('GET', 'recordings', owner)).body;
  const { recordingsPartition } = require('../src/recordings');
  const ownerUid = (await s.store.get('company', 'spartan')).owner;
  await s.store.put(recordingsPartition(ownerUid), 'r1', { id: 'r1', blob: 'x/r1/cam1/a.mp4', cam: 1, file: 'a.mp4', size: 10, startedAt: new Date(1_800_000_000_000).toISOString(), at: 1_800_000_000_000 });
  assert.strictEqual(ownerRecs.recordings.length, 0);
  assert.deepStrictEqual((await s.call('GET', 'recordings', jo)).body.recordings.map((r) => r.id), ['r1']);
  assert.strictEqual((await s.call('GET', 'recordings', await s.google('stranger'))).body.recordings.length, 0);
});

test('the owner is the owner whichever way they sign in with their address', async () => {
  const s = setup();
  const owner = await s.google('sam'); await s.register(owner);
  const again = await s.microsoft('vouched:sam@example.com');
  const c = await s.mine(again);
  assert.strictEqual(c.role, 'owner'); assert.strictEqual(c.contact, 'Sam Lee');
  assert.strictEqual((await s.call('GET', 'companies/mine/people', again)).status, 200);
  assert.strictEqual((await s.invite(again, 'jo@spartan.com')).status, 200);
});

test('companies registered before people: the owner\'s address goes on the list when they come back', async () => {
  const s = setup();
  const owner = await s.google('sam'); await s.register(owner);
  await s.store.remove('people:spartan', 'sam@example.com'); await s.store.remove('personof', 'sam@example.com');
  assert.strictEqual(await s.mine(await s.email('sam@example.com')), null);
  await s.mine(owner);
  assert.strictEqual((await s.mine(await s.email('sam@example.com'))).role, 'owner');
});

test('an address belongs to one company, and someone in one can\'t register another', async () => {
  const s = setup();
  const a = await s.google('sam'); await s.register(a);
  const b = await s.google('kim'); await s.register(b, 'tough', 'Tough');
  await s.invite(a, 'jo@spartan.com');
  assert.strictEqual((await s.invite(a, 'jo@spartan.com')).status, 409);
  assert.strictEqual((await s.invite(b, 'jo@spartan.com')).status, 409);
  assert.strictEqual((await s.invite(b, 'sam@example.com')).status, 409, 'another company\'s owner');
  assert.strictEqual((await s.invite(a, 'not an address')).status, 400);
  const r = await s.register(await s.microsoft('vouched:jo@spartan.com'), 'joco', 'Jo Co');
  assert.strictEqual(r.status, 409); assert.match(r.body.error, /already part of Spartan/);
});

test('up to 50 people', async () => {
  const s = setup();
  const owner = await s.google('sam'); await s.register(owner);
  for (let i = 1; i < 50; i++) assert.strictEqual((await s.invite(owner, `p${i}@x.com`)).status, 200);
  assert.strictEqual((await s.invite(owner, 'one-too-many@x.com')).status, 400);
});

test('"our settings": saved by anyone in the company, used by everyone in it, nobody else', async () => {
  const s = setup();
  const owner = await s.google('sam'); await s.register(owner);
  await s.invite(owner, 'jo@spartan.com');
  const jo = await s.email('jo@spartan.com');
  assert.deepStrictEqual((await s.call('GET', 'companies/mine/settings', owner)).body.settings, null, 'none saved yet');
  const saved = await s.call('PUT', 'companies/mine/settings', jo, { settings: { exercise: 'burpees', strictness: 20, cones: true } });
  assert.strictEqual(saved.status, 200);
  const got = (await s.call('GET', 'companies/mine/settings', owner)).body;
  assert.deepStrictEqual(got.settings, { exercise: 'burpees', strictness: 20, cones: true });
  assert.strictEqual(got.by, 'jo@spartan.com');
  // someone outside the company, or signed out, gets nothing
  assert.strictEqual((await s.call('GET', 'companies/mine/settings', await s.google('someone-else'))).status, 404);
  assert.strictEqual((await s.call('GET', 'companies/mine/settings', {})).status, 401);
  // not settings, or far too big: refused
  assert.strictEqual((await s.call('PUT', 'companies/mine/settings', owner, { settings: [1, 2] })).status, 400);
  assert.strictEqual((await s.call('PUT', 'companies/mine/settings', owner, { settings: { x: 'y'.repeat(30000) } })).status, 400);
});
