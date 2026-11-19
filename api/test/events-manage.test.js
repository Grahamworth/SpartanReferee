'use strict';
// Events management (assignments.js): organisers add referees (many at once), tick who may book the cameras, and leave notes; each
// referee sees their own events and an event's page; only those ticked (and admins) book its cameras.
const test = require('node:test');
const assert = require('node:assert');
const { createApi } = require('../src/core');
const { memoryStore } = require('../src/store');
const { LIST, TIMES } = require('../src/events');

const race = (id, name, start, end, city, country) => ({ id, name, start_date: start, end_date: end, brand: 'Obstacle Course Races', venue: { city, country, longitude: '0', latitude: '0' } });
const RACES = [race(40001, 'Athens Sprint', '2027-04-10', '2027-04-10', 'Athens', 'GR'), race(40002, 'Phuket Super', '2026-12-05', '2026-12-06', 'Phuket', 'TH')];
async function ready() {
  const store = memoryStore();
  const eventFetcher = async (url) => {
    if (url.startsWith(LIST)) return { ok: true, status: 200, json: async () => ({ resources: new URL(url).searchParams.get('page') ? [] : RACES, pagination: { table: { total: 2, page: 1, per_page: 10, total_pages: 1 } } }) };
    if (url.startsWith(TIMES)) return { ok: true, status: 200, json: async () => ({ upcoming_events: [] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const api = createApi({ store, now: () => Date.parse('2026-11-19T12:00:00Z'), secret: 'test-secret-test-secret-test-secret', googleClientId: 'x', adminEmails: ['boss@example.com'],
    verifyGoogle: async (t) => ({ sub: t, email: `${t}@example.com`, name: '' }), eventFetcher });
  const login = async (who) => ({ 'x-session': (await api.handle({ method: 'POST', path: 'auth/google', body: { idToken: who } })).body.token });
  const call = (method, path, headers, body) => api.handle({ method, path, headers, body });
  const boss = await login('boss');
  await call('POST', 'admin/events/sync', boss, {});
  for (const who of ['ana', 'ben', 'cal']) { await call('POST', 'admin/referees', boss, { email: `${who}@example.com` }); await store.put('name', `${who}@example.com`, { id: `${who}@example.com`, name: who.toUpperCase() }); }
  return { store, call, boss, ana: await login('ana'), ben: await login('ben') };
}

test('an organiser adds referees by pasting addresses; the unregistered are skipped; head referee and the camera tick are per person', async () => {
  const { call, boss, ana } = await ready();
  const r = await call('POST', 'event/40002/referees', boss, { emails: 'ana@example.com, ben@example.com\ncal@example.com stranger@example.com', role: 'referee' });
  assert.deepStrictEqual(r.body.added, ['ana@example.com', 'ben@example.com', 'cal@example.com']);
  assert.deepStrictEqual(r.body.skipped.map((s) => [s.email, s.why]), [['stranger@example.com', 'not registered: invite them first']]);
  assert.strictEqual((await call('POST', 'event/40002/referees', ana, { email: 'ana@example.com', role: 'head' })).status, 403, 'a referee doesn\'t manage');
  // Ana head referee, but not ticked for the cameras; Ben ticked
  await call('POST', 'event/40002/referees', boss, { email: 'ana@example.com', role: 'head', canBook: false });
  await call('POST', 'event/40002/referees', boss, { email: 'ben@example.com', canBook: true });
  const page = (await call('GET', 'event/40002', boss)).body;
  assert.strictEqual(page.canManage, true);
  assert.deepStrictEqual(page.referees.map((x) => [x.email, x.role, x.canBook]), [['ana@example.com', 'head', false], ['ben@example.com', 'referee', true], ['cal@example.com', 'referee', false]]);
  assert.strictEqual((await call('GET', 'event/40002', ana)).body.canBook, false, 'the head referee isn\'t ticked: no booking');
  const list = (await call('GET', 'manage/events', boss)).body.events.find((e) => e.id === '40002');
  assert.deepStrictEqual([list.referees, list.heads, list.canBook], [3, 1, 1]);
  assert.strictEqual((await call('GET', 'manage/events', ana)).status, 403);
  await call('POST', 'event/40002/referees', boss, { email: 'cal@example.com', remove: true });
  assert.strictEqual((await call('GET', 'event/40002', boss)).body.referees.length, 2);
});

test('the camera tick decides who books: not the head referee unticked, yes the referee ticked', async () => {
  const { call, boss, ana, ben } = await ready();
  await call('POST', 'event/40002/referees', boss, { email: 'ana@example.com', role: 'head', canBook: false });
  await call('POST', 'event/40002/referees', boss, { email: 'ben@example.com', canBook: true });
  const book = (who) => call('POST', 'servers/mine/start', who, { cameras: 2, from: Date.parse('2026-12-05T08:00:00Z'), until: Date.parse('2026-12-05T10:00:00Z'), unit: 'e40002' });
  const servers = (who) => call('GET', 'servers/mine', who, null);
  assert.strictEqual((await book(ana)).status, 403);
  const units = (await servers(ben)).body;
  const unit = (units.units || units.company?.units || []).find?.((u) => u.id === 'e40002');
  if (unit) assert.strictEqual(unit.canManage, true, 'Ben may manage the event\'s cameras');
});

test('notes for the referees, and each referee\'s own events', async () => {
  const { call, boss, ana } = await ready();
  await call('POST', 'event/40001/referees', boss, { email: 'ana@example.com' });
  await call('POST', 'event/40002/referees', boss, { email: 'ana@example.com', role: 'head' });
  assert.strictEqual((await call('PUT', 'event/40002/notes', ana, { text: 'x' })).status, 403);
  await call('PUT', 'event/40002/notes', boss, { text: 'Meet at the start tent at 06:30.' });
  const p = (await call('GET', 'event/40002', ana)).body;
  assert.strictEqual(p.notes.text, 'Meet at the start tent at 06:30.');
  assert.ok(p.referees.every((x) => !('email' in x)), 'a referee sees names, not addresses');
  assert.strictEqual(p.canManage, false);
  const mine = (await call('GET', 'my/events', ana)).body;
  assert.deepStrictEqual(mine.upcoming.map((e) => [e.id, e.role]), [['40002', 'head'], ['40001', 'referee']], 'soonest first');
  assert.strictEqual(mine.upcoming[0].countryCode, 'TH');
  await call('PUT', 'event/40002/notes', boss, { text: '' });
  assert.strictEqual((await call('GET', 'event/40002', ana)).body.notes, null, 'an empty note clears it');
});
