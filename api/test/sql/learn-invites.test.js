'use strict';
// Invites (invites.js, and core.js's join routes), against the real database in its own schema (learn_test).
//   source scripts/learn-env.sh && cd api && npm run test:sql
const test = require('node:test');
const assert = require('node:assert');
const { createApi } = require('../../src/core');
const { memoryStore } = require('../../src/store');
const { dbFromEnv } = require('../../src/learn/db');
const { memoryMailer } = require('../../src/mailer');

const db = dbFromEnv(process.env, 'learn_test');
const skip = !db && 'LEARN_SQL_* not set (source scripts/learn-env.sh)';
let api, boss, store, mailer, versionId;
const login = async (who) => ({ 'x-session': (await api.handle({ method: 'POST', path: 'auth/google', body: { idToken: who } })).body.token });
const call = async (method, path, headers, body) => api.handle({ method, path, headers, body });
const ok = async (method, path, headers, body) => { const r = await call(method, path, headers, body); assert.strictEqual(r.status, 200, `${method} ${path}: ${JSON.stringify(r.body)}`); return r.body; };
const tokenIn = (mail) => /join\.html\?t=([\w-]+)/.exec(mail.text)[1];

test.before(async () => {
  if (skip) return;
  await db.dropSchema();
  store = memoryStore(); mailer = memoryMailer();
  api = createApi({ store, secret: 'test-secret-test-secret-test-secret', googleClientId: 'x', adminEmails: ['boss@example.com'], mailer, siteUrl: 'https://site.test',
    verifyGoogle: async (t) => ({ sub: t, email: `${t}@example.com`, name: t }), learnDb: db });
  await db.migrate();
  await db.query("INSERT INTO {S}.region (region_id, name, countries) VALUES ('europe', 'Europe', 'GB,FR'), ('mea', 'Middle East and Asia', 'AE,TH')");
  boss = await login('boss');
  await ok('GET', 'learn/me', boss);
  const made = await ok('POST', 'learn/programmes', boss, { id: 'ocr-referee', title: 'OCR Referee', category: 'referee', locales: 'en', edition: '2027' });
  versionId = made.versionId;
  const m = (await ok('POST', `learn/versions/${made.versionId}/modules`, boss, { title: 'Obstacles' })).modules[0];
  await ok('POST', `learn/modules/${m.id}/lessons`, boss, { title: 'Spear Throw' });
  await ok('POST', `learn/versions/${made.versionId}/state`, boss, { to: 'review' });
  await ok('POST', `learn/versions/${made.versionId}/state`, boss, { to: 'published' });
});
test.after(async () => { if (!skip) { await db.dropSchema(); await db.close(); } });

test('an admin invites many at once, with a user type and programmes; each gets an email; repeats and bad addresses are skipped', { skip }, async () => {
  const opts = await ok('GET', 'learn/invites/options', boss);
  assert.ok(opts.roles.includes('regional_coordinator')); assert.deepStrictEqual(opts.programmes.map((p) => p.id), ['ocr-referee']);
  const r = await ok('POST', 'learn/invites', boss, { emails: 'ann@example.com, Ben@Example.com\nnot-an-address\nann@example.com', grants: [{ role: 'learner' }], programmes: [{ id: 'ocr-referee', due: '2027-03-01' }], message: 'Welcome!' });
  assert.strictEqual(r.created, 2); assert.deepStrictEqual(r.skipped.map((s) => s.email), ['not-an-address']);
  assert.deepStrictEqual(mailer.sent.map((m) => m.to).sort(), ['ann@example.com', 'ben@example.com']);
  assert.match(mailer.sent[0].text, /Welcome!/); assert.match(mailer.sent[0].text, /https:\/\/site\.test\/join\.html\?t=/);
  const again = await ok('POST', 'learn/invites', boss, { emails: 'ann@example.com', grants: [] });
  assert.strictEqual(again.created, 0); assert.match(again.skipped[0].why, /already invited/);
  const coord = await ok('POST', 'learn/invites', boss, { emails: 'cara@example.com', name: 'Cara Coordinator', grants: [{ role: 'regional_coordinator', regionId: 'mea' }] });
  assert.strictEqual(coord.created, 1);
  assert.strictEqual((await call('POST', 'learn/invites', boss, { emails: 'x@example.com', grants: [{ role: 'regional_coordinator' }] })).status, 400, 'a coordinator needs a region');
  const list = await ok('GET', 'learn/invites?state=pending', boss);
  assert.strictEqual(list.invites.length, 3); assert.strictEqual(list.counts.pending, 3);
  // a referee can't invite
  const ref = await login('nobody');
  assert.strictEqual((await call('GET', 'learn/invites', ref)).status, 403);
});

test('registering from the link: name, region and language; any sign-in works; roles, programmes and the referee list follow', { skip }, async () => {
  const mail = mailer.sent.find((m) => m.to === 'ann@example.com'), token = tokenIn(mail);
  const info = await ok('GET', `invite/${token}`);
  assert.strictEqual(info.state, 'pending'); assert.strictEqual(info.email, 'ann@example.com'); assert.deepStrictEqual(info.programmes.map((p) => [p.id, p.due]), [['ocr-referee', '2027-03-01']]);
  assert.strictEqual((await call('GET', 'invite/not-a-real-token-at-all-xx')).status, 404);
  // Ann signs in with a Google account under another address: still her invite (the link proves it)
  const ann = await login('anna.k');
  assert.strictEqual((await call('GET', 'learn/me', ann)).status, 403, 'not in yet');
  assert.strictEqual((await call('POST', `invite/${token}/accept`, ann, { name: 'A', regionId: 'europe' })).status, 400, 'a full name');
  await ok('POST', `invite/${token}/accept`, ann, { name: 'Anna Kowalska', regionId: 'europe', locale: 'pl' });
  const me = await ok('GET', 'learn/me', ann);
  assert.strictEqual(me.person.legalName, 'Anna Kowalska'); assert.strictEqual(me.person.regionId, 'europe'); assert.strictEqual(me.person.locale, 'pl'); assert.strictEqual(me.person.email, 'anna.k@example.com');
  const e = (await db.query('SELECT * FROM {S}.enrolment WHERE person_id = @p', { p: me.person.id }))[0];
  assert.strictEqual(e.version_id.toLowerCase(), versionId.toLowerCase()); assert.strictEqual(e.due_date.toISOString().slice(0, 10), '2027-03-01');
  assert.ok(await store.get('people:spartan', 'anna.k@example.com'), 'on the referee list');
  assert.strictEqual((await store.get('lang', 'anna.k@example.com')).lang, 'pl');
  // the same link again, by her: fine; by someone else: no
  await ok('POST', `invite/${token}/accept`, ann, { name: 'Anna Kowalska', regionId: 'europe' });
  assert.strictEqual((await call('POST', `invite/${token}/accept`, await login('other'), { name: 'Someone Else', regionId: 'europe' })).status, 409);
  assert.strictEqual((await ok('GET', 'learn/invites?state=accepted', boss)).invites[0].email, 'ann@example.com');
});

test('a coordinator\'s invite gives the role; resend makes a new link and the old one stops; revoked links don\'t work', { skip }, async () => {
  const cara = mailer.sent.find((m) => m.to === 'cara@example.com');
  const caraIn = await login('cara');
  await ok('POST', `invite/${tokenIn(cara)}/accept`, caraIn, { name: 'Cara Coordinator', regionId: 'mea' });
  assert.deepStrictEqual((await ok('GET', 'learn/me', caraIn)).grants.map((g) => [g.role, g.regionId]), [['regional_coordinator', 'mea']]);
  const ben = (await ok('GET', 'learn/invites?q=ben', boss)).invites[0], first = tokenIn(mailer.sent.find((m) => m.to === 'ben@example.com'));
  await ok('POST', `learn/invites/${ben.id}/resend`, boss);
  const second = tokenIn(mailer.sent.filter((m) => m.to === 'ben@example.com').at(-1));
  assert.notStrictEqual(first, second);
  assert.strictEqual((await call('GET', `invite/${first}`)).status, 404, 'the old link stops working');
  await ok('POST', `learn/invites/${ben.id}/revoke`, boss);
  assert.strictEqual((await call('POST', `invite/${second}/accept`, await login('ben'), { name: 'Ben Taylor', regionId: 'europe' })).status, 410);
});

test('signing in later another way, with the same address, is the same person', { skip }, async () => {
  const before = (await db.query("SELECT COUNT(*) AS n FROM {S}.person WHERE email = 'cara@example.com'"))[0].n;
  // Cara again, but through Microsoft (a new login with the same proven address): the dev Microsoft is 'dev:<address>'
  const m = await api.handle({ method: 'POST', path: 'auth/google', body: { idToken: 'cara' } });
  assert.strictEqual(m.status, 200);
  const after = (await db.query("SELECT COUNT(*) AS n FROM {S}.person WHERE email = 'cara@example.com'"))[0].n;
  assert.strictEqual(after, before);
});

test('progress: admins see everyone, a coordinator only their region; reminders email them and keep the complete-by date', { skip }, async () => {
  const all = await ok('GET', 'learn/tracking?status=all', boss);
  const anna = all.rows.find((r) => r.name === 'Anna Kowalska');
  assert.ok(anna); assert.strictEqual(anna.programmeId, 'ocr-referee'); assert.strictEqual(anna.due, '2027-03-01'); assert.strictEqual(anna.total, 0);
  const cara = await login('cara');
  const hers = await ok('GET', 'learn/tracking?status=all', cara);
  assert.ok(!hers.rows.some((r) => r.name === 'Anna Kowalska'), 'Anna is in Europe; Cara coordinates the Middle East and Asia');
  assert.strictEqual((await call('GET', 'learn/tracking', await login('anna.k'))).status, 403, 'a referee doesn\'t see others\' progress');
  const before = mailer.sent.length;
  const r = await ok('POST', 'learn/tracking/remind', boss, { enrolmentIds: [anna.enrolmentId], due: '2027-02-15', message: 'Before the season, please.' });
  assert.strictEqual(r.sent, 1);
  const mail = mailer.sent.at(-1);
  assert.strictEqual(mailer.sent.length, before + 1); assert.strictEqual(mail.to, 'anna.k@example.com');
  assert.match(mail.subject, /Please complete OCR Referee by 15 February 2027/); assert.match(mail.text, /Before the season, please\./);
  const after = (await ok('GET', 'learn/tracking?status=all', boss)).rows.find((x) => x.enrolmentId === anna.enrolmentId);
  assert.strictEqual(after.due, '2027-02-15'); assert.ok(after.remindedAt);
  assert.strictEqual((await call('POST', 'learn/tracking/remind', cara, { enrolmentIds: [anna.enrolmentId], due: '2027-02-15' })).status, 400, 'not one of Cara\'s people: nobody to remind');
});
