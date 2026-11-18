'use strict';
// The learning platform's people, roles and audit, against the real Azure SQL database in a schema of its own (learn_test),
// made fresh for this run and dropped after. Needs the LEARN_SQL_* settings: source scripts/learn-env.sh, then npm run test:sql.
const test = require('node:test');
const assert = require('node:assert');
const { createApi } = require('../../src/core');
const { memoryStore } = require('../../src/store');
const { dbFromEnv } = require('../../src/learn/db');

const db = dbFromEnv(process.env, 'learn_test');
const skip = !db && 'LEARN_SQL_* not set (source scripts/learn-env.sh)';

let api;
const login = async (who) => ({ 'x-session': (await api.handle({ method: 'POST', path: 'auth/google', body: { idToken: who } })).body.token });
const call = (method, path, headers, body) => api.handle({ method, path, headers, body });

test.before(async () => {
  if (skip) return;
  await db.dropSchema();
  api = createApi({ store: memoryStore(), secret: 'test-secret-test-secret-test-secret', googleClientId: 'x', adminEmails: ['boss@example.com'],
    verifyGoogle: async (t) => ({ sub: t, email: `${t}@example.com`, name: t }), learnDb: db });
  // the regions the demo uses (the seed script makes these live)
  await db.migrate();
  await db.query("INSERT INTO {S}.region (region_id, name, countries) VALUES ('europe', 'Europe', 'GB,FR,ES'), ('mea', 'Middle East and Asia', 'AE,TH')");
});
test.after(async () => { if (!skip) { await db.dropSchema(); await db.close(); } });

test('only admins get in; an admin\'s first visit makes their person record, a global admin', { skip }, async () => {
  assert.strictEqual((await call('GET', 'learn/me', await login('stranger'))).status, 403);
  const r = await call('GET', 'learn/me', await login('boss'));
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.person.publicId, /^SR-\d{6}$/);
  assert.strictEqual(r.body.person.synthetic, false);
  assert.deepStrictEqual(r.body.grants.map((g) => g.role), ['global_admin']);
  assert.strictEqual((await call('GET', 'learn/me', await login('boss'))).body.person.id, r.body.person.id, 'the same person next time');
});

test('an admin creates demo people, gives roles, and views as them; a coordinator sees only their region (AT-01, AT-09)', { skip }, async () => {
  const boss = await login('boss');
  const mk = async (b) => { const r = await call('POST', 'learn/people', boss, b); assert.strictEqual(r.status, 200, JSON.stringify(r.body)); return r.body.person; };
  const coord = await mk({ legalName: 'Elena Coordinator', email: 'elena@demo.test', country: 'ES', regionId: 'europe' });
  const anna = await mk({ legalName: 'Anna Referee', email: 'anna@demo.test', country: 'GB', regionId: 'europe' });
  const omar = await mk({ legalName: 'Omar Referee', email: 'omar@demo.test', country: 'AE', regionId: 'mea' });
  assert.strictEqual((await call('POST', 'learn/roles', boss, { personId: coord.id, role: 'regional_coordinator', regionId: 'europe' })).status, 200);
  // viewing as the coordinator: Europe's people only, and only Europe can be edited or added to
  const asCoord = { ...boss, 'x-learn-as': coord.id };
  const me = await call('GET', 'learn/me', asCoord);
  assert.strictEqual(me.body.person.id, coord.id); assert.strictEqual(me.body.actingAs, coord.id);
  const seen = (await call('GET', 'learn/people', asCoord)).body.people.map((p) => p.legalName).sort();
  assert.deepStrictEqual(seen, ['Anna Referee', 'Elena Coordinator']);
  assert.strictEqual((await call('GET', `learn/people/${omar.id}`, asCoord)).status, 404);
  assert.strictEqual((await call('PUT', `learn/people/${omar.id}`, asCoord, { legalName: 'X' })).status, 404);
  assert.strictEqual((await call('PUT', `learn/people/${anna.id}`, asCoord, { country: 'FR' })).status, 200);
  assert.strictEqual((await call('PUT', `learn/people/${anna.id}`, asCoord, { regionId: 'mea' })).status, 403, 'not out of their region');
  assert.strictEqual((await call('POST', 'learn/people', asCoord, { legalName: 'New Person', email: 'new@demo.test', regionId: 'mea' })).status, 403);
  assert.strictEqual((await call('POST', 'learn/roles', asCoord, { personId: anna.id, role: 'global_admin' })).status, 403);
  assert.strictEqual((await call('GET', 'learn/audit', asCoord)).status, 403);
  // viewing as a learner: only their own profile, and only their own preferences
  const asAnna = { ...boss, 'x-learn-as': anna.id };
  assert.strictEqual((await call('GET', 'learn/people', asAnna)).status, 403);
  const mine = await call('GET', `learn/people/${anna.id}`, asAnna);
  assert.deepStrictEqual(mine.body.editable, ['preferred_name', 'locale']);
  assert.strictEqual((await call('PUT', `learn/people/${anna.id}`, asAnna, { preferredName: 'Annie', locale: 'fr' })).status, 200);
  assert.strictEqual((await call('PUT', `learn/people/${anna.id}`, asAnna, { email: 'x@y.z' })).status, 403);
  // only demo people can be viewed as; someone who isn't an admin can't view as anyone
  assert.strictEqual((await call('GET', 'learn/me', { ...boss, 'x-learn-as': '00000000-0000-0000-0000-000000000000' })).status, 404);
});

test('a possible duplicate is flagged for review, never merged; the audit log says who did what, as whom', { skip }, async () => {
  const boss = await login('boss');
  const r = await call('POST', 'learn/people', boss, { legalName: 'Anna Referee', email: 'anna2@demo.test', regionId: 'europe' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.duplicates.map((d) => d.legalName), ['Anna Referee'], 'same name, same region');
  const flags = (await call('GET', 'learn/duplicates', boss)).body.flags;
  assert.strictEqual(flags.length, 1); assert.strictEqual(flags[0].reason, 'same name and region');
  assert.strictEqual((await call('POST', `learn/duplicates/${flags[0].id}`, boss, { decision: 'not_duplicate' })).status, 200);
  assert.strictEqual((await call('GET', 'learn/duplicates', boss)).body.flags.length, 0);
  const events = (await call('GET', 'learn/audit', boss)).body.events;
  const actions = events.map((e) => e.action);
  for (const a of ['person.first-sign-in', 'person.create', 'role.grant', 'person.edit', 'duplicate.decide']) assert.ok(actions.includes(a), a);
  const asLearner = events.find((e) => e.action === 'person.edit' && e.summary.after.locale === 'fr');
  assert.ok(asLearner, 'the learner\'s own edit');
  assert.strictEqual(asLearner.actingAs, 'Anna Referee'); assert.strictEqual(asLearner.actor, 'boss@example.com', 'the admin who was viewing as them');
});
