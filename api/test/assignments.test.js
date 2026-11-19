'use strict';
// Which referees are assigned to which events (assignments.js), and each referee's home page (/api/home).
const test = require('node:test');
const assert = require('node:assert');
const { createApi } = require('../src/core');
const { memoryStore } = require('../src/store');
const { LIST, TIMES } = require('../src/events');

const race = (id, name, start, end, city, country) => ({ id, name, start_date: start, end_date: end, brand: 'Obstacle Course Races', venue: { city, country, longitude: '0', latitude: '0' } });
const RACES = [race(30001, 'Athens Sprint', '2027-04-10', '2027-04-10', 'Athens', 'GR'), race(30002, 'Phuket Super', '2026-12-05', '2026-12-06', 'Phuket', 'TH'),
  race(30003, 'Over already', '2026-11-01', '2026-11-01', 'Paris', 'FR')];
function setup() {
  const store = memoryStore(); let clock = Date.parse('2026-11-19T12:00:00Z');
  const eventFetcher = async (url) => {
    if (url.startsWith(LIST)) return { ok: true, status: 200, json: async () => ({ resources: new URL(url).searchParams.get('page') ? [] : RACES, pagination: { table: { total: 3, page: 1, per_page: 10, total_pages: 1 } } }) };
    if (url.startsWith(TIMES)) return { ok: true, status: 200, json: async () => ({ upcoming_events: [] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const api = createApi({ store, now: () => clock, secret: 'test-secret-test-secret-test-secret', googleClientId: 'x', adminEmails: ['boss@example.com'],
    verifyGoogle: async (t) => ({ sub: t, email: `${t}@example.com`, name: t === 'ana' ? 'Ana Popescu' : '' }), eventFetcher });
  const login = async (who) => ({ Authorization: `Bearer ${(await api.handle({ method: 'POST', path: 'auth/google', body: { idToken: who } })).body.token}` });
  const call = (method, path, headers, body) => api.handle({ method, path, headers, body });
  return { store, login, call, pass: (ms) => { clock += ms; } };
}
async function ready() {
  const s = setup(), boss = await s.login('boss');
  await s.call('POST', 'admin/events/sync', boss, {});
  for (const who of ['ana', 'ben']) await s.call('POST', 'admin/referees', boss, { email: `${who}@example.com` });
  return { ...s, boss, ana: await s.login('ana'), ben: await s.login('ben') };
}

test('an admin assigns referees to an event; each sees their own upcoming events on their home page, soonest first', async () => {
  const { call, boss, ana, ben } = await ready();
  for (const [eventId, email] of [['30001', 'ana@example.com'], ['30002', 'ana@example.com'], ['e30002', 'ben@example.com']]) {
    assert.strictEqual((await call('POST', 'admin/assignments', boss, { eventId, email })).status, 200, `${eventId} ${email}`);
  }
  const home = (await call('GET', 'home', ana)).body;
  assert.strictEqual(home.name, 'Ana Popescu');
  assert.strictEqual(home.email, 'ana@example.com');
  assert.strictEqual(home.admin, false);
  assert.deepStrictEqual(home.events.map((e) => [e.name, e.unit, e.city]), [['Phuket Super', 'e30002', 'Phuket'], ['Athens Sprint', 'e30001', 'Athens']]);
  assert.ok(home.events[0].from < home.events[0].until);
  assert.deepStrictEqual((await call('GET', 'home', ben)).body.events.map((e) => e.name), ['Phuket Super']);
  const all = (await call('GET', 'admin/assignments', boss)).body.assignments;
  assert.strictEqual(all.length, 3);
  assert.deepStrictEqual(Object.keys(all[0]).sort(), ['at', 'by', 'canBook', 'email', 'eventId', 'role']);
  assert.strictEqual(all[0].by, 'boss@example.com');
});

test('taking someone off an event; and the same assignment twice, or nobody there to take off, say so', async () => {
  const { call, boss, ana } = await ready();
  await call('POST', 'admin/assignments', boss, { eventId: '30001', email: 'ana@example.com' });
  assert.strictEqual((await call('POST', 'admin/assignments', boss, { eventId: '30001', email: 'ANA@example.com' })).status, 409);
  assert.strictEqual((await call('POST', 'admin/assignments', boss, { eventId: '30001', email: 'ana@example.com', remove: true })).status, 200);
  assert.deepStrictEqual((await call('GET', 'home', ana)).body.events, []);
  assert.strictEqual((await call('POST', 'admin/assignments', boss, { eventId: '30001', email: 'ana@example.com', remove: true })).status, 404);
});

test('only someone who can sign in, to an event on Spartan\'s list; and only admins assign', async () => {
  const { call, boss, ana } = await ready();
  const r = await call('POST', 'admin/assignments', boss, { eventId: '30001', email: 'stranger@example.com' });
  assert.strictEqual(r.status, 400); assert.match(r.body.error, /isn't on the list of referees/);
  assert.strictEqual((await call('POST', 'admin/assignments', boss, { eventId: '30001', email: 'boss@example.com' })).status, 200, 'an admin can referee too');
  assert.strictEqual((await call('POST', 'admin/assignments', boss, { eventId: '99999', email: 'ana@example.com' })).status, 404);
  assert.strictEqual((await call('POST', 'admin/assignments', boss, { eventId: 'abc', email: 'ana@example.com' })).status, 400);
  assert.strictEqual((await call('POST', 'admin/assignments', ana, { eventId: '30001', email: 'ana@example.com' })).status, 403);
  assert.strictEqual((await call('GET', 'admin/assignments', ana)).status, 403);
});

test('the home page: an admin is told so; someone not on the list, or not signed in, is refused; finished events drop off', async () => {
  const { call, boss, ana, login, pass } = await ready();
  const h = (await call('GET', 'home', boss)).body;
  assert.strictEqual(h.admin, true); assert.strictEqual(h.name, ''); assert.strictEqual(h.learn, false, 'no learning database in these tests');
  const out = await call('GET', 'home', await login('stranger'));
  assert.strictEqual(out.status, 403); assert.match(out.body.error, /isn't on the list of referees/);
  assert.strictEqual((await call('GET', 'home', {})).status, 401);
  await call('POST', 'admin/assignments', boss, { eventId: '30002', email: 'ana@example.com' });
  pass(20 * 24 * 3600e3); // past Phuket (6 December), and within a session's 30 days
  assert.deepStrictEqual((await call('GET', 'home', ana)).body.events, []);
  assert.deepStrictEqual((await call('GET', 'admin/assignments', boss)).body.assignments, []);
});

test('head referees: assigned as one, changed either way, listed first; the home page says which each referee is', async () => {
  const { call, boss, ana, ben } = await ready();
  assert.strictEqual((await call('POST', 'admin/assignments', boss, { eventId: '30001', email: 'ben@example.com' })).status, 200);
  assert.strictEqual((await call('POST', 'admin/assignments', boss, { eventId: '30001', email: 'ana@example.com', role: 'head' })).status, 200);
  assert.strictEqual((await call('POST', 'admin/assignments', boss, { eventId: '30001', email: 'ana@example.com', role: 'head' })).status, 409);
  assert.strictEqual((await call('POST', 'admin/assignments', boss, { eventId: '30001', email: 'ana@example.com', role: 'boss' })).status, 400);
  assert.deepStrictEqual((await call('GET', 'admin/assignments', boss)).body.assignments.map((a) => [a.email, a.role]), [['ana@example.com', 'head'], ['ben@example.com', 'referee']]);
  assert.strictEqual((await call('GET', 'home', ana)).body.events[0].role, 'head');
  assert.strictEqual((await call('GET', 'home', ben)).body.events[0].role, 'referee');
  // ben becomes head referee too, ana goes back to referee
  assert.strictEqual((await call('POST', 'admin/assignments', boss, { eventId: '30001', email: 'ben@example.com', role: 'head' })).status, 200);
  assert.strictEqual((await call('POST', 'admin/assignments', boss, { eventId: '30001', email: 'ana@example.com', role: 'referee' })).status, 200);
  assert.deepStrictEqual((await call('GET', 'admin/assignments', boss)).body.assignments.map((a) => [a.email, a.role]), [['ben@example.com', 'head'], ['ana@example.com', 'referee']]);
});

test('an event\'s page: its days and times, who\'s refereeing it (with the names they signed in with), and its cameras', async () => {
  const { call, boss, ana, ben, login } = await ready();
  await call('POST', 'admin/assignments', boss, { eventId: '30002', email: 'ana@example.com', role: 'head' });
  await call('GET', 'home', ana); // Ana's name is kept as she opens her home page
  const p = (await call('GET', 'event/30002', ben)).body;
  assert.strictEqual(p.event.name, 'Phuket Super'); assert.strictEqual(p.event.unit, 'e30002'); assert.strictEqual(p.event.over, false);
  assert.strictEqual(p.event.windows.length, 2, 'two days');
  assert.match(p.event.url, /spartan\.com/);
  assert.strictEqual(p.you, null, 'ben isn\'t assigned, but any referee can see it');
  assert.deepStrictEqual(p.referees, [{ name: 'Ana Popescu', role: 'head', canBook: true, you: false }], 'names, not addresses, for a referee');
  assert.strictEqual(p.booking, null);
  assert.strictEqual(p.canBook, false, 'only those ticked for it (a head referee made on the admin page is) and admins book its burpee cameras');
  assert.strictEqual((await call('GET', 'event/30002', ana)).body.canBook, true, 'Ana is its head referee');
  assert.strictEqual((await call('GET', 'event/30002', boss)).body.canBook, true, 'an admin');
  assert.deepStrictEqual((await call('GET', 'event/e30002', ana)).body.you, { role: 'head', canBook: true });
  // booked (by its head referee): the page says so
  await call('POST', 'admin/assignments', boss, { eventId: '30002', email: 'ben@example.com', role: 'head' });
  assert.strictEqual((await call('POST', 'servers/mine/start', ben, { unit: 'e30002', cameras: 2, from: Date.parse('2026-12-05T01:00:00Z'), until: Date.parse('2026-12-05T05:00:00Z') })).status, 200);
  const b = (await call('GET', 'event/30002', ana)).body.booking;
  assert.strictEqual(b.state, 'booked'); assert.strictEqual(b.cameras, 2); assert.strictEqual(b.by, 'ben@example.com');
  assert.strictEqual((await call('GET', 'event/99999', ana)).status, 404);
  assert.strictEqual((await call('GET', 'event/30002', await login('stranger'))).status, 403);
  assert.strictEqual((await call('GET', 'event/30002', {})).status, 401);
});

test('the language: none until the referee picks one, then it stays with them; only the site\'s languages; signing in again keeps it', async () => {
  const s = await ready();
  assert.strictEqual((await s.call('GET', 'home', s.ana)).body.language, '');
  assert.strictEqual((await s.call('POST', 'home', s.ana, { language: 'xx' })).status, 400);
  assert.strictEqual((await s.call('POST', 'home', s.ana, { language: 'fr' })).body.language, 'fr');
  assert.strictEqual((await s.call('GET', 'home', s.ana)).body.language, 'fr');
  assert.strictEqual((await s.call('GET', 'home', await s.login('ana'))).body.language, 'fr', 'kept across sign-ins');
  assert.strictEqual((await s.call('GET', 'home', s.ben)).body.language, '', 'each their own');
  assert.strictEqual((await s.call('PUT', 'home', s.ana, { language: 'de' })).status, 405);
});
