'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createApi } = require('../src/core');
const { memoryStore } = require('../src/store');

const DEV_A = { 'X-Device': 'device-aaaaaaaaaaaaaaaa' }, DEV_B = { 'X-Device': 'device-bbbbbbbbbbbbbbbb' }, DEV_C = { 'X-Device': 'device-cccccccccccccccc' }, DEV_D = { 'X-Device': 'device-dddddddddddddddd' };
function setup(opts = {}) {
  let t = 1_000_000;
  const api = createApi({ store: memoryStore(), now: () => t, ...opts });
  return { api, tick: (ms) => { t += ms; } };
}
const post = (api, room, text, headers = DEV_A, name = 'Sam') => api.handle({ method: 'POST', path: `board/${room}`, headers, body: { name, text } });

test('rooms are listed and an unknown room is refused', async () => {
  const { api } = setup();
  const r = await api.handle({ method: 'GET', path: 'board' });
  assert.ok(r.body.rooms.some((x) => x.id === 'general'));
  assert.strictEqual((await api.handle({ method: 'GET', path: 'board/nope' })).status, 404);
});

test('a message is posted and read back, marked as mine for its sender only', async () => {
  const { api } = setup();
  assert.strictEqual((await post(api, 'general', 'See you in Morzine!')).status, 200);
  const mine = await api.handle({ method: 'GET', path: 'board/general', headers: DEV_A });
  assert.strictEqual(mine.body.posts.length, 1);
  assert.strictEqual(mine.body.posts[0].text, 'See you in Morzine!');
  assert.strictEqual(mine.body.posts[0].mine, true);
  const theirs = await api.handle({ method: 'GET', path: 'board/general', headers: DEV_B });
  assert.strictEqual(theirs.body.posts[0].mine, false);
  assert.ok(!('author' in theirs.body.posts[0]));
});

test('rude words, links, phone numbers and a missing name are refused', async () => {
  const { api } = setup();
  assert.strictEqual((await post(api, 'general', 'what the fuck')).status, 400);
  assert.strictEqual((await post(api, 'general', 'join at www.example.com')).status, 400);
  assert.strictEqual((await post(api, 'general', 'call me 07700 900123')).status, 400);
  assert.strictEqual((await post(api, 'general', 'hello', DEV_A, '')).status, 400);
  assert.strictEqual((await post(api, 'general', 'hello', DEV_A, 'bellend')).status, 400);
  assert.strictEqual((await post(api, 'general', 'hello', {})).status, 400); // no device id
});

test('one message every 10 seconds, and never the same twice running', async () => {
  const { api, tick } = setup();
  assert.strictEqual((await post(api, 'general', 'first')).status, 200);
  assert.strictEqual((await post(api, 'general', 'second')).status, 429);
  tick(11000);
  assert.strictEqual((await post(api, 'general', 'FIRST')).status, 409);
  assert.strictEqual((await post(api, 'general', 'second')).status, 200);
});

test('you can delete your own message but not someone else’s', async () => {
  const { api } = setup();
  const id = (await post(api, 'kit', 'Size 9 shoes for sale')).body.post.id;
  assert.strictEqual((await api.handle({ method: 'DELETE', path: `board/kit/${id}`, headers: DEV_B })).status, 403);
  assert.strictEqual((await api.handle({ method: 'DELETE', path: `board/kit/${id}`, headers: DEV_A })).status, 200);
  assert.strictEqual((await api.handle({ method: 'GET', path: 'board/kit' })).body.posts.length, 0);
});

test('reports from 3 different people ban the writer from that chat, and hide what was reported', async () => {
  const { api, tick } = setup();
  const p1 = (await post(api, 'general', 'first annoying message')).body.post.id; tick(11000);
  const p2 = (await post(api, 'general', 'second annoying message')).body.post.id;
  const rep = (h, id) => api.handle({ method: 'POST', path: `board/general/${id}/report`, headers: h });
  assert.strictEqual((await rep(DEV_A, p1)).status, 400); // your own
  await rep(DEV_B, p1); await rep(DEV_B, p2); // the same person twice still counts once
  assert.strictEqual((await rep(DEV_C, p2)).body.banned, false);
  assert.strictEqual((await rep(DEV_D, p1)).body.banned, true);
  const view = await api.handle({ method: 'GET', path: 'board/general', headers: DEV_A });
  assert.strictEqual(view.body.posts.length, 0);
  assert.strictEqual(view.body.banned, true);
  tick(11000);
  assert.strictEqual((await post(api, 'general', 'back again')).status, 403);
  assert.strictEqual((await post(api, 'training', 'other rooms are fine')).status, 200); // banned from that chat only
  // the admin list, and unbanning
  const bans = (await api.handle({ method: 'GET', path: 'admin/bans' })).body.bans;
  assert.strictEqual(bans.length, 1);
  assert.strictEqual(bans[0].name, 'Sam'); assert.strictEqual(bans[0].room, 'general'); assert.strictEqual(bans[0].messages.length, 2);
  await api.handle({ method: 'POST', path: `admin/bans/general/${bans[0].who}/lift` });
  assert.strictEqual((await api.handle({ method: 'GET', path: 'admin/bans' })).body.bans.length, 0);
  tick(11000);
  assert.strictEqual((await post(api, 'general', 'behaving now')).status, 200);
});

test('the public rooms refuse insults and threats; private groups allow links', async () => {
  const { api, tick } = setup();
  assert.strictEqual((await post(api, 'general', 'you are an idiot')).status, 400);
  assert.strictEqual((await post(api, 'general', 'kys')).status, 400);
  const g = (await api.handle({ method: 'POST', path: 'groups', headers: DEV_A, body: { name: 'Team Red', me: 'Sam' } })).body.group;
  assert.strictEqual((await post(api, g.room, 'route here www.example.com')).status, 200);
  tick(11000);
  assert.strictEqual((await post(api, g.room, 'what the fuck')).status, 400); // rude words still blocked
});

test('private groups: make one, join with its code, members only, invite from a message, leave', async () => {
  const { api, tick } = setup();
  const A = (path, body, h = DEV_A, method = 'POST') => api.handle({ method, path, headers: h, body });
  assert.strictEqual((await A('groups', { name: 'Team Red' })).status, 400); // no name for me
  const g = (await A('groups', { name: 'Team Red', me: 'Sam' })).body.group;
  assert.ok(/^[A-Z2-9]{6}$/.test(g.code)); assert.strictEqual(g.owner, true);
  // not a member: can't read it
  assert.strictEqual((await api.handle({ method: 'GET', path: `board/${g.room}`, headers: DEV_B })).status, 404);
  // join with the code
  assert.strictEqual((await A('groups/join', { code: 'nope', me: 'Jo' }, DEV_B)).status, 404);
  const j = await A('groups/join', { code: g.code.toLowerCase(), me: 'Jo' }, DEV_B);
  assert.strictEqual(j.body.group.members.length, 2);
  assert.strictEqual((await post(api, g.room, 'hello team', DEV_B, 'Jo')).status, 200);
  // invite someone by picking their message in a public room
  const msg = (await post(api, 'general', 'anyone training Saturday?', DEV_C, 'Kim')).body.post.id;
  assert.strictEqual((await A(`groups/${g.id}/invite`, { room: 'general', post: msg })).body.invited, 'Kim');
  const mine = (await api.handle({ method: 'GET', path: 'groups', headers: DEV_C })).body;
  assert.strictEqual(mine.invites.length, 1); assert.strictEqual(mine.invites[0].groupName, 'Team Red'); assert.strictEqual(mine.invites[0].from, 'Sam');
  const acc = await A(`groups/invites/${mine.invites[0].id}/accept`, { me: 'Kim' }, DEV_C);
  assert.strictEqual(acc.body.group.members.length, 3);
  assert.strictEqual((await api.handle({ method: 'GET', path: 'groups', headers: DEV_C })).body.invites.length, 0);
  // inviting someone already in it
  assert.strictEqual((await A(`groups/${g.id}/invite`, { room: 'general', post: msg })).status, 409);
  // a new code (owner only); the old one stops working
  assert.strictEqual((await A(`groups/${g.id}/code`, {}, DEV_B)).status, 403);
  const g2 = (await A(`groups/${g.id}/code`, {})).body.group;
  assert.notStrictEqual(g2.code, g.code);
  assert.strictEqual((await A('groups/join', { code: g.code, me: 'Lee' }, DEV_D)).status, 404);
  // leaving: the owner hands over; the group stays for the others
  await A(`groups/${g.id}/leave`, {});
  const left = (await api.handle({ method: 'GET', path: 'groups', headers: DEV_B })).body.groups[0];
  assert.strictEqual(left.members.length, 2); assert.strictEqual(left.owner, true);
  assert.strictEqual((await api.handle({ method: 'GET', path: 'groups', headers: DEV_A })).body.groups.length, 0);
  tick(1);
});

test('home page content: defaults, then saved race, news and winners (cleaned)', async () => {
  const { api } = setup();
  const r0 = await api.handle({ method: 'GET', path: 'content' });
  assert.strictEqual(r0.body.race.name, 'Morzine 2026');
  assert.deepStrictEqual(r0.body.news, []);
  assert.ok(r0.body.events.length >= 1 && r0.body.events.every((e) => e.url.startsWith('https://')));
  assert.strictEqual(r0.body.canEdit, true); // prototype: no admin key
  await api.handle({ method: 'PUT', path: 'content/news', body: { value: [{ title: 'Course published', text: '<b>Hi</b>', date: '2026-11-02' }, { title: '' }] } });
  await api.handle({ method: 'PUT', path: 'content/winners', body: { value: [{ race: 'Morzine', year: '2025', course: 'Beast', women: 'A', men: 'B' }] } });
  await api.handle({ method: 'PUT', path: 'content/race', body: { value: { name: 'Morzine 2026', date: '2026-07-04', extra: 'dropped' } } });
  const r1 = await api.handle({ method: 'GET', path: 'content' });
  assert.deepStrictEqual(r1.body.news, [{ title: 'Course published', text: 'bHi/b', date: '2026-11-02' }]);
  assert.strictEqual(r1.body.winners.length, 1);
  assert.strictEqual(r1.body.race.date, '2026-07-04');
  assert.ok(!('extra' in r1.body.race));
});

test('events: saved cleaned, and only https ticket links are kept', async () => {
  const { api } = setup();
  await api.handle({ method: 'PUT', path: 'content/events', body: { value: [{ name: 'Test race', date: '2027-01-01', place: 'X', races: 'Sprint', url: 'https://example.com/t' }, { name: 'Bad link', url: 'javascript:alert(1)' }] } });
  const r = await api.handle({ method: 'GET', path: 'content' });
  assert.strictEqual(r.body.events.length, 2);
  assert.strictEqual(r.body.events[0].url, 'https://example.com/t');
  assert.strictEqual(r.body.events[1].url, '');
});

test('with an admin key set, only admins can edit the home page', async () => {
  const { api } = setup({ adminKey: 'secret-key' });
  assert.strictEqual((await api.handle({ method: 'GET', path: 'content' })).body.canEdit, false);
  assert.strictEqual((await api.handle({ method: 'PUT', path: 'content/news', body: { value: [] } })).status, 403);
  assert.strictEqual((await api.handle({ method: 'PUT', path: 'content/news', headers: { 'X-Admin-Key': 'secret-key' }, body: { value: [] } })).status, 200);
  assert.strictEqual((await api.handle({ method: 'GET', path: 'admin/bans' })).status, 403);
  assert.strictEqual((await api.handle({ method: 'GET', path: 'admin/bans', headers: { 'X-Admin-Key': 'secret-key' } })).status, 200);
});

// ---------------------------------------------------------------- accounts, judges, news
function authed(opts = {}) {
  let t = 1_000_000;
  const api = createApi({
    store: memoryStore(), now: () => t, secret: 'test-secret-test-secret-test-secret', googleClientId: 'cid', adminEmails: ['boss@example.com'],
    verifyGoogle: async (tok) => { const m = /^ok:(.+)$/.exec(tok); if (!m) throw new Error('bad'); return { sub: 's-' + m[1], email: m[1], name: m[1].split('@')[0] }; },
    fetchText: async () => '<feed><entry><title>Race recap &amp; more</title><published>2026-10-01T10:00:00Z</published><link rel="alternate" href="https://shop.spartan.com/blogs/x/recap"/><content type="html">&lt;p&gt;&lt;img src="https://cdn.example.com/a.jpg"&gt;Great day out&lt;/p&gt;</content></entry></feed>',
    ...opts,
  });
  return { api, tick: (ms) => { t += ms; } };
}
const bearer = (token, dev = DEV_A) => ({ ...dev, Authorization: 'Bearer ' + token });

test('Google sign-in: a session token, admins by email, the phone’s groups come along', async () => {
  const { api } = authed();
  assert.strictEqual((await api.handle({ method: 'GET', path: 'config' })).body.signIn, true);
  // before signing in this phone made a group
  const g = (await api.handle({ method: 'POST', path: 'groups', headers: DEV_A, body: { name: 'Crew', me: 'Sam' } })).body.group;
  assert.strictEqual((await api.handle({ method: 'POST', path: 'auth/google', headers: DEV_A, body: { idToken: 'nope' } })).status, 401);
  const r = await api.handle({ method: 'POST', path: 'auth/google', headers: DEV_A, body: { idToken: 'ok:sam@example.com' } });
  assert.ok(r.body.token); assert.strictEqual(r.body.user.email, 'sam@example.com');
  const mine = (await api.handle({ method: 'GET', path: 'groups', headers: bearer(r.body.token, DEV_B) })).body.groups; // a different phone, same account
  assert.strictEqual(mine.length, 1); assert.strictEqual(mine[0].id, g.id); assert.strictEqual(mine[0].owner, true);
  const meA = (await api.handle({ method: 'GET', path: 'me', headers: bearer(r.body.token) })).body;
  assert.strictEqual(meA.admin, false); assert.strictEqual(meA.judge, false);
  const boss = (await api.handle({ method: 'POST', path: 'auth/google', headers: DEV_C, body: { idToken: 'ok:boss@example.com' } })).body.token;
  assert.strictEqual((await api.handle({ method: 'GET', path: 'me', headers: bearer(boss, DEV_C) })).body.admin, true);
  assert.strictEqual((await api.handle({ method: 'GET', path: 'admin/people', headers: bearer(r.body.token) })).status, 403);
  assert.strictEqual((await api.handle({ method: 'GET', path: 'admin/people' })).status, 403); // not signed in
  // a forged token is ignored
  const forged = r.body.token.split('.')[0] + '.AAAA';
  assert.strictEqual((await api.handle({ method: 'GET', path: 'me', headers: bearer(forged, DEV_D) })).body.user, null);
});

test('Burpee judges: an admin switches someone on, or hands out the judge code', async () => {
  const { api } = authed();
  const boss = (await api.handle({ method: 'POST', path: 'auth/google', headers: DEV_C, body: { idToken: 'ok:boss@example.com' } })).body.token;
  await api.handle({ method: 'PUT', path: 'profile', headers: DEV_A, body: { name: 'Sam', spartanUrl: 'https://account.spartan.com/results/123' } });
  assert.strictEqual((await api.handle({ method: 'PUT', path: 'profile', headers: DEV_A, body: { spartanUrl: 'https://evil.example.com' } })).status, 400);
  const people = (await api.handle({ method: 'GET', path: 'admin/people', headers: bearer(boss, DEV_C) })).body.people;
  const sam = people.find((p) => p.name === 'Sam'); assert.ok(sam); assert.strictEqual(sam.judge, false);
  await api.handle({ method: 'POST', path: `admin/people/${sam.who}/judge`, headers: bearer(boss, DEV_C), body: { on: true } });
  assert.strictEqual((await api.handle({ method: 'GET', path: 'me', headers: DEV_A })).body.judge, true);
  // the code
  const code = (await api.handle({ method: 'GET', path: 'admin/judgecode', headers: bearer(boss, DEV_C) })).body.code;
  assert.strictEqual((await api.handle({ method: 'POST', path: 'profile/judge', headers: DEV_B, body: { code: 'WRONG1' } })).status, 400);
  assert.strictEqual((await api.handle({ method: 'POST', path: 'profile/judge', headers: DEV_B, body: { code: code.toLowerCase() } })).body.profile.judge, true);
  assert.strictEqual((await api.handle({ method: 'GET', path: 'me', headers: DEV_B })).body.judge, true);
});

test('news: Spartan’s blog feeds, parsed and cached', async () => {
  let calls = 0;
  const { api, tick } = authed({ fetchText: async () => { calls++; return '<feed><entry><title>Race recap &amp; more</title><published>2026-10-01T10:00:00Z</published><link rel="alternate" href="https://shop.spartan.com/blogs/x/recap"/><content type="html">&lt;p&gt;&lt;img src="https://cdn.example.com/a.jpg"&gt;Great day out&lt;/p&gt;</content></entry></feed>'; } });
  const a = (await api.handle({ method: 'GET', path: 'news' })).body.articles;
  assert.strictEqual(a[0].title, 'Race recap & more'); assert.strictEqual(a[0].image, 'https://cdn.example.com/a.jpg'); assert.strictEqual(a[0].summary, 'Great day out');
  const n = calls; await api.handle({ method: 'GET', path: 'news' }); assert.strictEqual(calls, n); // cached
  tick(3600 * 1000 + 1); await api.handle({ method: 'GET', path: 'news' }); assert.ok(calls > n);
});

test('the app’s plain-text envelope carries the method, device and body (no CORS pre-check needed)', async () => {
  const { api } = setup();
  const env = (m, b, d = 'device-aaaaaaaaaaaaaaaa') => api.handle({ method: 'POST', path: 'board/general', headers: {}, body: { _env: 1, m, d, b } });
  assert.strictEqual((await env('POST', { name: 'Sam', text: 'From the app' })).status, 200);
  const r = await env('GET');
  assert.ok(r.body.posts.some((x) => x.text === 'From the app' && x.mine));
  assert.ok((await env('GET', undefined, 'device-bbbbbbbbbbbbbbbb')).body.posts.every((x) => !x.mine));
  assert.strictEqual((await env('PATCH')).status, 405);
});

test('a challenge score is saved, ranked by each person\'s best, and shown as yours', async () => {
  const { api, tick } = setup();
  await api.handle({ method: 'PUT', path: 'profile', headers: DEV_A, body: { name: 'Ana' } });
  await api.handle({ method: 'PUT', path: 'profile', headers: DEV_B, body: { name: 'Ben' } });
  let r = await api.handle({ method: 'POST', path: 'scores/1min', headers: DEV_A, body: { reps: 30, noReps: 2 } });
  assert.equal(r.status, 200); assert.equal(r.body.personalBest, true);
  r = await api.handle({ method: 'POST', path: 'scores/1min', headers: DEV_A, body: { reps: 35 } });
  assert.equal(r.status, 429, 'too soon after the last one');
  tick(60_000);
  r = await api.handle({ method: 'POST', path: 'scores/1min', headers: DEV_A, body: { reps: 28 } });
  assert.equal(r.body.personalBest, false); assert.equal(r.body.best, 30);
  await api.handle({ method: 'POST', path: 'scores/1min', headers: DEV_B, body: { reps: 33 } });
  r = await api.handle({ method: 'GET', path: 'scores/1min?period=today', headers: DEV_A });
  assert.deepEqual(r.body.top.map((x) => [x.name, x.reps, x.mine]), [['Ben', 33, false], ['Ana', 30, true]]);
  r = await api.handle({ method: 'GET', path: 'scores/1min?period=all', headers: DEV_B });
  assert.equal(r.body.top[0].mine, true);
  r = await api.handle({ method: 'GET', path: 'scores/me', headers: DEV_A });
  assert.equal(r.body['1min'].best.reps, 30); assert.equal(r.body['1min'].recent.length, 2); assert.equal(r.body['5min'].best, null);
});

test('impossible challenge scores and unknown challenges are refused', async () => {
  const { api } = setup();
  assert.equal((await api.handle({ method: 'POST', path: 'scores/1min', headers: DEV_A, body: { reps: 500 } })).status, 400);
  assert.equal((await api.handle({ method: 'POST', path: 'scores/1min', headers: DEV_A, body: { reps: -1 } })).status, 400);
  assert.equal((await api.handle({ method: 'POST', path: 'scores/2min', headers: DEV_A, body: { reps: 10 } })).status, 404);
});

test('every burpee attempt is kept in its owner\'s history and bests come back with it', async () => {
  const { api, tick } = setup();
  const send = (body, headers = DEV_A) => api.handle({ method: 'POST', path: 'scores/attempts', headers, body });
  const a = { id: 'abc-123', mode: 'free', reps: 12, noReps: 1, durationMs: 40000, status: 'full', camera: 'back', at: 900000 };
  assert.strictEqual((await send(a)).status, 200);
  assert.strictEqual((await send({ ...a, id: 'abc-124', mode: '1min', reps: 22, status: 'stopped', at: 950000 })).status, 200);
  assert.strictEqual((await send({ ...a, id: 'abc-125', mode: '1min', reps: 71 })).status, 400);
  assert.strictEqual((await send({ ...a, id: 'x', reps: 1 })).status, 400);
  await send({ ...a, submitted: true }); // sent again: the same attempt, updated
  await api.handle({ method: 'POST', path: 'scores/1min', headers: DEV_A, body: { reps: 30 } });
  tick(1);
  const mine = await api.handle({ method: 'GET', path: 'scores/attempts', headers: DEV_A });
  assert.deepStrictEqual(mine.body.attempts.map((x) => x.id), ['abc-124', 'abc-123']);
  assert.strictEqual(mine.body.attempts[1].submitted, true);
  assert.strictEqual(mine.body.bests['1min'].reps, 30);
  const theirs = await api.handle({ method: 'GET', path: 'scores/attempts', headers: DEV_B });
  assert.deepStrictEqual(theirs.body.attempts, []);
});

test('signing in carries a phone’s burpee scores, bests and attempts to the account, one best per person', async () => {
  const { api, tick } = authed();
  const score = (reps, headers) => api.handle({ method: 'POST', path: 'scores/1min', headers, body: { reps } });
  const signIn = async (headers) => (await api.handle({ method: 'POST', path: 'auth/google', headers, body: { idToken: 'ok:sam@example.com' } })).body.token;
  const board = async (period, headers) => (await api.handle({ method: 'GET', path: 'scores/1min', headers, query: { period } })).body;
  const attempt = (id, headers) => api.handle({ method: 'POST', path: 'scores/attempts', headers, body: { id, mode: 'free', reps: 5, status: 'full', at: 900000 } });
  // the account already has a best of 30, from another phone
  const token = await signIn(DEV_B);
  await score(30, bearer(token, DEV_B));
  // this phone, not signed in, beats it and keeps an attempt
  tick(60000); await score(40, DEV_A); await attempt('phone-a-1', DEV_A);
  await signIn(DEV_A);
  const after = bearer(token, DEV_B);
  for (const period of ['today', 'all']) {
    const b = await board(period, after);
    assert.strictEqual(b.top.length, 1, period);
    assert.strictEqual(b.top[0].reps, 40);
    assert.strictEqual(b.top[0].mine, true);
  }
  assert.deepStrictEqual((await api.handle({ method: 'GET', path: 'scores/attempts', headers: after })).body.attempts.map((x) => x.id), ['phone-a-1']);
  assert.deepStrictEqual((await api.handle({ method: 'GET', path: 'scores/attempts', headers: DEV_A })).body.attempts, []);
  // a lower score on a phone doesn't replace the best
  tick(60000); await score(10, DEV_C); await signIn(DEV_C);
  assert.strictEqual((await board('all', after)).top[0].reps, 40);
  // already signed in, with scores still under the phone: they move when the menu opens
  tick(60000); await score(50, DEV_D);
  assert.strictEqual((await board('all', after)).top.length, 2);
  await api.handle({ method: 'GET', path: 'scores/attempts', headers: bearer(token, DEV_D) });
  const last = await board('all', after);
  assert.strictEqual(last.top.length, 1);
  assert.strictEqual(last.top[0].reps, 50);
});
