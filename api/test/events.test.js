'use strict';
// Spartan's events (events.js) and booking cameras for one, for training or for testing (servers.js units).
const test = require('node:test');
const assert = require('node:assert');
const { createApi } = require('../src/core');
const { memoryStore } = require('../src/store');
const { windows, normalise, localTime, zoneOf, LIST, TIMES } = require('../src/events');

const HOUR = 3600e3;
// Spartan's race list (LIST), as it sends it: two pages of races with country codes and no timezones
const race = (id, name, start, end, venue) => ({ id, name, start_date: start, end_date: end, brand: 'Obstacle Course Races', venue });
const LIST_PAGES = [
  [race(10664, '2026 Abu Dhabi Spartan World Championship Weekend', '2026-11-19', '2026-11-22', { city: 'Abu Dhabi', country: 'AE', longitude: '54.74', latitude: '24.1' }),
    race(20001, 'Athens Sprint', '2027-04-10', '2027-04-10', { city: 'Athens', country: 'GR', longitude: '23.7', latitude: '37.9' })],
  [race(20002, 'Phuket Super', '2026-12-05', '2026-12-06', { city: 'Phuket', country: 'TH', longitude: '98.3', latitude: '7.9' }),
    race(20003, 'Somewhere unusual', '2026-12-12', '2026-12-12', { city: 'Somewhere', country: 'XX', longitude: '120', latitude: '0' })],
];
// the other service (TIMES): timezones, for the races it has (here Abu Dhabi only)
const TIMES_PAGES = [[{ id: '10664', start_date: '2026-11-19', end_date: '2026-11-22', subevents: [{ timezone: 'Asia/Dubai' }] }]];
function setup({ fail = false, start = Date.parse('2026-11-18T12:00:00Z') } = {}) {
  const store = memoryStore(); let clock = start, fetches = 0;
  const eventFetcher = async (url) => {
    fetches++;
    if (fail) return { ok: false, status: 503, json: async () => ({}) };
    const u = new URL(url), page = Number(u.searchParams.get('page') || 1);
    if (url.startsWith(LIST)) return { ok: true, status: 200, json: async () => ({ resources: LIST_PAGES[page - 1] || [], pagination: { table: { total: 4, page, per_page: 2, total_pages: 2 } } }) };
    if (url.startsWith(TIMES)) return { ok: true, status: 200, json: async () => ({ status: 'ok', upcoming_events: TIMES_PAGES[page - 1] || [], past_events: [], planned_events: [] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const api = createApi({ store, now: () => clock, secret: 'test-secret-test-secret-test-secret', googleClientId: 'x', adminEmails: ['boss@example.com'], maxRunningServers: 5, serverHourPrice: 0.66,
    verifyGoogle: async (t) => ({ sub: t, email: `${t}@example.com`, name: t }), eventFetcher });
  const login = async (who) => ({ Authorization: `Bearer ${(await api.handle({ method: 'POST', path: 'auth/google', body: { idToken: who } })).body.token}` });
  const call = (method, path, headers, body) => api.handle({ method, path, headers, body });
  const referee = async (who) => { await call('POST', 'admin/referees', await login('boss'), { email: `${who}@example.com` }); return login(who); };
  // an event's head referee: they book its burpee cameras (the events must be synced first)
  const head = async (who, eventId) => { const r = await call('POST', 'admin/assignments', await login('boss'), { eventId, email: `${who}@example.com`, role: 'head' }); if (r.status !== 200) throw new Error(JSON.stringify(r.body)); };
  return { store, login, call, referee, head, pass: (ms) => { clock += ms; }, at: (iso) => { clock = Date.parse(iso); }, fetches: () => fetches };
}

test('event times are 07:00 to 18:00 local on each day, through clock changes, and from the longitude when there\'s no timezone', () => {
  const w = windows({ startDate: '2026-11-19', endDate: '2026-11-20', tz: 'Asia/Dubai' });
  assert.deepStrictEqual(w.map((x) => [x.day, new Date(x.from).toISOString(), new Date(x.until).toISOString()]),
    [['2026-11-19', '2026-11-19T03:00:00.000Z', '2026-11-19T14:00:00.000Z'], ['2026-11-20', '2026-11-20T03:00:00.000Z', '2026-11-20T14:00:00.000Z']]);
  assert.strictEqual(new Date(localTime('2027-03-28', 7, 'Europe/London')).toISOString(), '2027-03-28T06:00:00.000Z', 'British Summer Time began that night');
  assert.strictEqual(new Date(localTime('2027-03-27', 7, 'Europe/London')).toISOString(), '2027-03-27T07:00:00.000Z');
  const guessed = normalise(race(1, 'X', '2026-12-12', '2026-12-12', { country: 'XX', longitude: '120' }), 0);
  assert.strictEqual(guessed.tz, ''); assert.strictEqual(guessed.offsetGuess, 8);
  assert.strictEqual(new Date(windows(guessed)[0].from).toISOString(), '2026-12-11T23:00:00.000Z');
});

test('with no timezone from Spartan, a race gets its country\'s, or (where there are several) the one at its longitude', () => {
  assert.strictEqual(zoneOf('GR', 23.7), 'Europe/Athens');
  assert.strictEqual(zoneOf('US', -97.3), 'America/Chicago', 'Fort Worth');
  assert.strictEqual(zoneOf('US', -118.2), 'America/Los_Angeles');
  assert.strictEqual(zoneOf('US', -74), 'America/New_York');
  assert.strictEqual(zoneOf('AU', 153, -27.5), 'Australia/Brisbane'); assert.strictEqual(zoneOf('AU', 151.2, -33.9), 'Australia/Sydney');
  assert.strictEqual(normalise(race(5, 'Phuket', '2026-12-05', '2026-12-05', { country: 'TH', longitude: '98.3' }), 0).tz, 'Asia/Bangkok');
  assert.strictEqual(normalise(race(6, 'Abu Dhabi', '2026-11-19', '2026-11-22', { country: 'AE' }), 0).country, 'United Arab Emirates');
  assert.strictEqual(normalise(race(7, 'Tenerife', '2026-11-28', undefined, { country: 'ES', longitude: '-16.5' }), 0).tz, 'Atlantic/Canary', 'not Madrid');
  assert.strictEqual(normalise(race(7, 'Tenerife', '2026-11-28', undefined, { country: 'ES', longitude: '-16.5' }), 0).endDate, '2026-11-28', 'a one-day race often has no end date');
});

test('the events sync from Spartan\'s list, every page, and only for people in the organisation', async () => {
  const { call, login, referee } = setup();
  assert.strictEqual((await call('GET', 'events', await login('stranger'))).status, 403);
  const r = await call('GET', 'events', await referee('sam'));
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.events.map((e) => e.id), ['10664', '20002', '20003', '20001'], 'soonest first, from both pages');
  assert.strictEqual(r.body.events[0].tz, 'Asia/Dubai'); assert.strictEqual(r.body.events[0].windows.length, 4);
  assert.ok(r.body.syncedAt > 0); assert.strictEqual(r.body.error, '');
});

test('the list is synced again only when it\'s 6 hours old; a failed sync keeps the last good copy and says so; admins can sync now', async () => {
  const s = setup();
  const h = await s.referee('sam');
  await s.call('GET', 'events', h); const first = s.fetches();
  await s.call('GET', 'events', h); assert.strictEqual(s.fetches(), first, 'fresh: not fetched again');
  s.pass(7 * HOUR); await s.call('GET', 'events', h); assert.ok(s.fetches() > first, 'stale: fetched again');
  assert.strictEqual((await s.call('POST', 'admin/events/sync', h, {})).status, 403);
  assert.strictEqual((await s.call('POST', 'admin/events/sync', await s.login('boss'), {})).status, 200);
  const broken = setup({ fail: true });
  const r = await broken.call('GET', 'events', await broken.referee('sam'));
  assert.deepStrictEqual(r.body.events, []); assert.match(r.body.error, /503/);
});

test('an event\'s cameras are booked between 07:00 and 18:00 local on its days, and stop at 18:00 however long was asked for', async () => {
  const { call, referee, head, at } = setup();
  const h = await referee('sam');
  await call('GET', 'events', h);
  const unit = 'e10664';
  await head('sam', '10664');
  // ahead, inside a day: fine; across 18:00 or into the night: no
  const ok = await call('POST', 'servers/mine/start', h, { unit, cameras: 2, from: Date.parse('2026-11-20T04:00:00Z'), until: Date.parse('2026-11-20T08:00:00Z') });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  assert.strictEqual(ok.body.server.unit.kind, 'event'); assert.strictEqual(ok.body.server.unit.event.windows.length, 4);
  await call('POST', 'servers/mine/stop', h, { unit });
  const late = await call('POST', 'servers/mine/start', h, { unit, cameras: 2, from: Date.parse('2026-11-20T12:00:00Z'), until: Date.parse('2026-11-20T15:00:00Z') });
  assert.strictEqual(late.status, 400); assert.match(late.body.error, /07:00 to 18:00/);
  // now, before the event: no; on its day, 4 hours asked at 16:00 local: until 18:00
  const early = await call('POST', 'servers/mine/start', h, { unit, cameras: 2, hours: 4 });
  assert.strictEqual(early.status, 400); assert.match(early.body.error, /07:00 to 18:00/);
  at('2026-11-21T12:00:00Z'); // 16:00 in Abu Dhabi
  const now = await call('POST', 'servers/mine/start', h, { unit, cameras: 2, hours: 4 });
  assert.strictEqual(now.status, 200, JSON.stringify(now.body));
  assert.strictEqual(now.body.server.until, Date.parse('2026-11-21T14:00:00Z'));
  assert.strictEqual(now.body.server.bookedHours, 2);
  // extending stops at 18:00 too
  const more = await call('POST', 'servers/mine/extend', h, { unit, hours: 1 });
  assert.strictEqual(more.status, 409); assert.match(more.body.error, /18:00/);
});

test('each event has its own booking, by its head referee: two events book at once, and every referee sees and opens both', async () => {
  const { call, referee, head, at } = setup();
  const sam = await referee('sam'), pat = await referee('pat'), kim = await referee('kim');
  at('2026-11-21T05:00:00Z');
  await call('GET', 'events', sam);
  await head('sam', '10664'); await head('pat', '20002'); await head('pat', '10664');
  // a referee who isn't the head referee can't book, and is told who does
  const notHead = await call('POST', 'servers/mine/start', kim, { unit: 'e10664', cameras: 2, hours: 2 });
  assert.strictEqual(notHead.status, 403); assert.match(notHead.body.error, /head referee/);
  assert.strictEqual((await call('GET', 'servers/units', kim)).body.units.find((u) => u.id === 'e10664').canManage, false);
  assert.strictEqual((await call('GET', 'servers/units', sam)).body.units.find((u) => u.id === 'e10664').canManage, true);
  assert.strictEqual((await call('POST', 'servers/mine/start', sam, { unit: 'e10664', cameras: 2, hours: 2 })).status, 200);
  const other = await call('POST', 'servers/mine/start', pat, { unit: 'e20002', cameras: 2, from: Date.parse('2026-12-05T01:00:00Z'), until: Date.parse('2026-12-05T05:00:00Z') });
  assert.strictEqual(other.status, 200, JSON.stringify(other.body));
  assert.strictEqual((await call('POST', 'servers/mine/start', pat, { unit: 'e10664', cameras: 2, hours: 2 })).status, 409, 'that event is already booked');
  const units = (await call('GET', 'servers/units', pat)).body;
  assert.deepStrictEqual(units.units.filter((u) => u.booking).map((u) => u.id), ['e10664', 'e20002']);
  assert.strictEqual(units.units.find((u) => u.id === 'e10664').booking.by, 'sam@example.com');
  assert.strictEqual(units.current, 'e10664', 'the one that\'s on comes up first');
  assert.ok(!units.units.some((u) => u.kind === 'testing'), 'testing is for admins');
  assert.strictEqual((await call('GET', 'servers/mine?unit=e10664', pat)).body.server.wanted, 'on');
  // every referee watches it; only the head referee (or an admin) extends or stops it
  const watching = await call('GET', 'servers/mine?unit=e10664', kim);
  assert.strictEqual(watching.status, 200); assert.strictEqual(watching.body.server.wanted, 'on'); assert.strictEqual(watching.body.server.unit.canManage, false);
  assert.strictEqual((await call('POST', 'servers/mine/stop', kim, { unit: 'e10664' })).status, 403);
  assert.strictEqual((await call('POST', 'servers/mine/extend', kim, { unit: 'e10664', hours: 1 })).status, 403);
  assert.notStrictEqual((await call('POST', 'servers/mine/open', kim, { unit: 'e10664', n: 1 })).status, 403, 'opening the review is for everyone');
});

test('training: head referees and admins, 30 minutes, started from Learning only, not extended, each their own; other referees use the free camera', async () => {
  const { call, referee, head, store } = setup();
  const sam = await referee('sam'), pat = await referee('pat'), kim = await referee('kim');
  await call('GET', 'events', sam);
  await head('sam', '10664'); await head('pat', '20002');
  const plain = await call('POST', 'learn/practice-camera', kim, { cameras: 1 });
  assert.strictEqual(plain.status, 403); assert.match(plain.body.error, /free camera/);
  assert.strictEqual((await call('GET', 'learn/practice-camera', kim)).body.canPractise, false);
  assert.strictEqual((await call('GET', 'learn/practice-camera', sam)).body.canPractise, true);
  const refused = await call('POST', 'servers/mine/start', sam, { cameras: 1 });
  assert.strictEqual(refused.status, 403); assert.match(refused.body.error, /cameras guide in Learning/);
  assert.ok(!(await call('GET', 'servers/units', sam)).body.units.some((u) => u.kind === 'training'), 'not offered on the console');
  const t = await call('POST', 'learn/practice-camera', sam, { cameras: 1 });
  assert.strictEqual(t.status, 200, JSON.stringify(t.body));
  assert.strictEqual(t.body.server.unit.kind, 'training'); assert.strictEqual(t.body.unit, t.body.server.unit.id);
  assert.strictEqual(t.body.server.until - t.body.server.from, 0.5 * HOUR);
  assert.ok((await call('GET', 'servers/units', sam)).body.units.some((u) => u.id === t.body.unit), 'on the console while it is booked, to watch');
  assert.strictEqual((await call('GET', 'learn/practice-camera', sam)).body.server.unit.id, t.body.unit);
  assert.strictEqual((await call('POST', 'servers/mine/extend', sam, { unit: t.body.unit, hours: 1 })).status, 409);
  assert.strictEqual((await call('GET', `servers/mine?unit=${t.body.unit}`, pat)).status, 403, "not someone else's");
  assert.strictEqual((await call('POST', 'learn/practice-camera', pat, { cameras: 1 })).status, 200, "pat's own training is separate");
  assert.strictEqual((await store.list('unit')).length, 2);
  assert.strictEqual((await call('POST', 'learn/practice-camera', {}, { cameras: 1 })).status, 401);
});

test('admins: a testing booking at any time, and an event booked at any time when they say so; referees can\'t', async () => {
  const { call, referee, login, head } = setup();
  const sam = await referee('sam'), boss = await login('boss');
  await call('GET', 'events', boss);
  await head('sam', '10664');
  const units = (await call('GET', 'servers/units', boss)).body.units;
  const testing = units.find((u) => u.kind === 'testing');
  assert.ok(testing);
  const night = Date.parse('2026-11-19T22:00:00Z');
  assert.strictEqual((await call('POST', 'servers/mine/start', boss, { unit: testing.id, cameras: 2, from: night, until: night + 3 * HOUR })).status, 200);
  assert.strictEqual((await call('POST', 'servers/mine/start', sam, { unit: testing.id, cameras: 2, hours: 2 })).status, 403);
  // an event at night: only with anyTime, and only for admins
  const body = { unit: 'e10664', cameras: 2, from: night, until: night + 3 * HOUR };
  assert.strictEqual((await call('POST', 'servers/mine/start', boss, body)).status, 400);
  assert.strictEqual((await call('POST', 'servers/mine/start', sam, { ...body, anyTime: true })).status, 400);
  const any = await call('POST', 'servers/mine/start', boss, { ...body, anyTime: true });
  assert.strictEqual(any.status, 200, JSON.stringify(any.body));
  assert.strictEqual(any.body.server.unit.bookedAnyTime, true);
  // the admin area lists each booking, with what it's for
  const admin = (await call('GET', 'admin/customers', boss)).body;
  assert.deepStrictEqual(admin.customers.map((c) => c.kind).sort(), ['event', 'testing']);
  assert.strictEqual(admin.running, 0, 'both booked ahead: nothing running yet');
  assert.strictEqual((await call('POST', 'admin/customers/e10664/stop', boss, {})).status, 200);
});

test('an admin opens any booking\'s video review while it\'s on, a referee\'s own training included; nobody else can', async () => {
  const { call, referee, head, store, login } = setup();
  const sam = await referee('sam'), pat = await referee('pat');
  await call('GET', 'events', sam);
  await head('sam', '10664');
  const boss = await login('boss');
  const started = await call('POST', 'learn/practice-camera', sam, { cameras: 1 });
  assert.strictEqual(started.status, 200, JSON.stringify(started.body));
  const unit = (await call('GET', 'admin/customers', boss)).body.customers.find((c) => c.kind === 'training');
  assert.ok(unit, 'sam\'s training is among the bookings an admin sees');
  // it's sam's alone otherwise: another referee can't name it
  assert.strictEqual((await call('GET', `servers/mine?unit=${unit.id}`, pat)).status, 403);
  assert.strictEqual((await call('POST', 'servers/mine/open', pat, { unit: unit.id, n: 1 })).status, 403);
  // not on yet
  assert.strictEqual((await call('POST', `admin/customers/${unit.id}/open`, boss, {})).status, 409);
  await store.put('serverstate', unit.id, { id: unit.id, state: 'on' });
  const r = await call('POST', `admin/customers/${unit.id}/open`, boss, { tab: 'results' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const url = new URL(r.body.url), server = await store.get('server', unit.id);
  assert.strictEqual(url.host, server.host); assert.strictEqual(url.searchParams.get('tab'), 'results');
  const token = JSON.parse(Buffer.from(url.searchParams.get('t').split('.')[0], 'base64url').toString());
  assert.deepStrictEqual([token.kind, token.who], ['login', 'boss@example.com'], 'the review knows it\'s the admin');
  // only admins, and only a booking there is
  assert.strictEqual((await call('POST', `admin/customers/${unit.id}/open`, sam, {})).status, 403);
  assert.strictEqual((await call('POST', `admin/customers/${unit.id}/open`, pat, {})).status, 403);
  assert.strictEqual((await call('POST', 'admin/customers/tffffffffff/open', boss, {})).status, 404);
});
