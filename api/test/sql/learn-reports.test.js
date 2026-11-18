'use strict';
// Reports and the read API (step 6), against the real database in its own schema (learn_test), made fresh and dropped after.
//   source scripts/learn-env.sh && cd api && npm run test:sql
const test = require('node:test');
const assert = require('node:assert');
const { createApi } = require('../../src/core');
const { memoryStore } = require('../../src/store');
const { dbFromEnv } = require('../../src/learn/db');

const db = dbFromEnv(process.env, 'learn_test');
const skip = !db && 'LEARN_SQL_* not set (source scripts/learn-env.sh)';
let api, boss, anna, karim, elena, paul;
const login = async (who) => ({ 'x-session': (await api.handle({ method: 'POST', path: 'auth/google', body: { idToken: who } })).body.token });
const call = async (method, path, headers, body) => api.handle({ method, path, headers, body });
const ok = async (method, path, headers, body) => { const r = await call(method, path, headers, body); assert.strictEqual(r.status, 200, `${method} ${path}: ${JSON.stringify(r.body)}`); return r.body; };
const as = (p) => ({ ...boss, 'x-learn-as': p.id });

// a published programme whose one-question assessment is all it takes
async function programme(id, months) {
  const v = (await ok('POST', 'learn/programmes', boss, { id, title: id, category: 'referee', edition: '2027' })).versionId;
  await ok('PUT', `learn/versions/${v}`, boss, { completionRule: 'assessment', passMark: 50, validityMonths: months });
  await ok('POST', `learn/versions/${v}/modules`, boss, { title: 'Basics' });
  const a = (await ok('POST', `learn/versions/${v}/assessments`, boss, { title: 'Check' })).assessment;
  await ok('POST', `learn/assessments/${a.id}/questions`, boss, { type: 'single', prompt: 'One plus one?', options: [{ text: 'Two', correct: true }, { text: 'Three' }] });
  await ok('POST', `learn/versions/${v}/state`, boss, { to: 'review' });
  await ok('POST', `learn/versions/${v}/state`, boss, { to: 'published' });
  return a.id;
}
async function pass(person, programmeId, assessmentId) {
  await ok('POST', 'learn/enrolments', as(person), { programmeId });
  const t = (await ok('POST', `learn/assessments/${assessmentId}/attempts`, as(person))).attempt;
  return ok('POST', `learn/attempts/${t.id}/submit`, as(person), { answers: { [t.questions[0].id]: { chosen: [t.questions[0].options[0].id] } } });
}

test.before(async () => {
  if (skip) return;
  await db.dropSchema();
  api = createApi({ store: memoryStore(), secret: 'test-secret-test-secret-test-secret', googleClientId: 'x', adminEmails: ['boss@example.com'],
    verifyGoogle: async (t) => ({ sub: t, email: `${t}@example.com`, name: t }), learnDb: db });
  await db.migrate();
  await db.query("INSERT INTO {S}.region (region_id, name, countries) VALUES ('europe', 'Europe', 'GB'), ('mea', 'Middle East and Asia', 'AE')");
  boss = await login('boss');
  await ok('GET', 'learn/me', boss);
  const person = async (name, region, roles = []) => { const p = (await ok('POST', 'learn/people', boss, { legalName: name, email: `${name.split(' ')[0].toLowerCase()}@demo.test`, regionId: region })).person; for (const r of roles) await ok('POST', 'learn/roles', boss, { personId: p.id, ...r }); return p; };
  anna = await person('Anna Kowalska', 'europe'); karim = await person('Karim Haddad', 'mea');
  elena = await person('Elena Ruiz', 'europe', [{ role: 'regional_coordinator', regionId: 'europe' }]);
  paul = await person('Paul Owner', 'europe', [{ role: 'programme_owner', programmeId: 'deka-judge' }]);
  const ocr = await programme('ocr-referee', 12), deka = await programme('deka-judge', 24);
  await pass(anna, 'ocr-referee', ocr); await pass(anna, 'deka-judge', deka); await pass(karim, 'ocr-referee', ocr);
});
test.after(async () => { if (!skip) { await db.dropSchema(); await db.close(); } });

test('an admin sees each programme\'s and region\'s figures, and who issued or changed each credential (AT-10, ADM-01)', { skip }, async () => {
  const r = await ok('GET', 'learn/reports', boss);
  assert.strictEqual(r.scope.all, true);
  const ocr = r.programmes.find((p) => p.id === 'ocr-referee');
  assert.strictEqual(ocr.enrolled, 2); assert.strictEqual(ocr.completed, 2); assert.strictEqual(ocr.passed, 2); assert.strictEqual(ocr.credentials.active, 2);
  assert.deepStrictEqual(r.regions.map((x) => [x.name, x.enrolled]).sort(), [['Europe', 2], ['Middle East and Asia', 1]]);
  // one credential due: it shows in the list
  await db.query("UPDATE {S}.credential SET expires_at = DATEADD(day, 10, SYSUTCDATETIME()) WHERE person_id = @p AND programme_id = 'deka-judge'", { p: anna.id });
  assert.deepStrictEqual((await ok('GET', 'learn/reports', boss)).expiring.map((c) => [c.person, c.status]), [['Anna Kowalska', 'due']]);
  const c = (await ok('GET', `learn/people/${anna.id}/record`, boss)).credentials.find((x) => x.programmeId === 'ocr-referee');
  await ok('POST', `learn/credentials/${c.id}/status`, boss, { status: 'suspended', reason: 'Demo audit' });
  const audit = (await ok('GET', 'learn/audit?entityType=credential', boss)).events;
  assert.deepStrictEqual(audit.filter((e) => e.entityId.toLowerCase() === c.id.toLowerCase()).map((e) => e.action).sort(), ['credential.issue', 'credential.status']);
  assert.strictEqual((await ok('GET', 'learn/reports?programme=ocr-referee', boss)).programmes[0].credentials.suspended, 1);
});

test('a coordinator\'s reports and export hold only their region\'s people; an owner\'s only their programme (ADM-02, NFR-01, AT-09)', { skip }, async () => {
  const mine = await ok('GET', 'learn/reports', as(elena));
  assert.deepStrictEqual(mine.regions.map((r) => r.name), ['Europe']);
  assert.strictEqual(mine.programmes.find((p) => p.id === 'ocr-referee').enrolled, 1, 'Karim, in another region, isn\'t counted');
  const csv = (await ok('GET', 'learn/reports/export', as(elena))).csv;
  assert.match(csv, /Anna Kowalska/); assert.doesNotMatch(csv, /Karim/);
  const owner = await ok('GET', 'learn/reports', as(paul));
  assert.deepStrictEqual(owner.programmes.map((p) => p.id), ['deka-judge']);
  assert.doesNotMatch((await ok('GET', 'learn/reports/export', as(paul))).csv, /ocr-referee/);
  assert.strictEqual((await call('GET', 'learn/reports', as(anna))).status, 403, 'not for learners');
  assert.ok((await ok('GET', 'learn/audit', boss)).events.some((e) => e.action === 'report.export'));
});

test('the read API: versioned, the same scopes, stable fields (INT-01)', { skip }, async () => {
  const me = await ok('GET', `learn/v1/people/${anna.publicId}`, as(anna));
  assert.strictEqual(me.apiVersion, 'v1'); assert.strictEqual(me.person.publicId, anna.publicId);
  assert.deepStrictEqual(me.person.programmeRoles.map((r) => r.programmeId).sort(), ['deka-judge', 'ocr-referee']);
  const en = await ok('GET', `learn/v1/people/${anna.id}/enrolments`, as(anna));
  assert.deepStrictEqual(en.enrolments.map((e) => [e.programmeId, e.state]).sort(), [['deka-judge', 'completed'], ['ocr-referee', 'completed']]);
  const cr = await ok('GET', `learn/v1/people/${anna.id}/credentials`, as(anna));
  const deka = cr.credentials.find((c) => c.programmeId === 'deka-judge');
  assert.strictEqual(deka.valid, true); assert.strictEqual(deka.demonstration, true);
  const one = await ok('GET', `learn/v1/credentials/${deka.publicId}`, as(elena));
  assert.strictEqual(one.credential.personPublicId, anna.publicId);
  assert.strictEqual((await call('GET', `learn/v1/people/${karim.id}`, as(elena))).status, 404, 'not another region\'s person');
  assert.strictEqual((await call('GET', `learn/v1/credentials/${deka.publicId}`, as(karim))).status, 404, 'nor someone else\'s credential');
  assert.strictEqual((await call('GET', 'learn/v1/everything', boss)).status, 404);
});
