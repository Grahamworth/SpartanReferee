'use strict';
// Programmes (step 2), against the real database in its own schema (learn_test), made fresh and dropped after.
//   source scripts/learn-env.sh && cd api && npm run test:sql
const test = require('node:test');
const assert = require('node:assert');
const { createApi } = require('../../src/core');
const { memoryStore } = require('../../src/store');
const { dbFromEnv } = require('../../src/learn/db');

const db = dbFromEnv(process.env, 'learn_test');
const skip = !db && 'LEARN_SQL_* not set (source scripts/learn-env.sh)';
let api, boss;
const login = async (who) => ({ 'x-session': (await api.handle({ method: 'POST', path: 'auth/google', body: { idToken: who } })).body.token });
const call = async (method, path, headers, body) => api.handle({ method, path, headers, body });
const ok = async (method, path, headers, body) => { const r = await call(method, path, headers, body); assert.strictEqual(r.status, 200, `${method} ${path}: ${JSON.stringify(r.body)}`); return r.body; };
const as = (person) => ({ ...boss, 'x-learn-as': person.id });

test.before(async () => {
  if (skip) return;
  await db.dropSchema();
  api = createApi({ store: memoryStore(), secret: 'test-secret-test-secret-test-secret', googleClientId: 'x', adminEmails: ['boss@example.com'],
    verifyGoogle: async (t) => ({ sub: t, email: `${t}@example.com`, name: t }), learnDb: db });
  await db.migrate();
  await db.query("INSERT INTO {S}.region (region_id, name, countries) VALUES ('europe', 'Europe', 'GB,FR'), ('mea', 'Middle East and Asia', 'AE,TH')");
  boss = await login('boss');
  await ok('GET', 'learn/me', boss);
});
test.after(async () => { if (!skip) { await db.dropSchema(); await db.close(); } });

// a demo person, with roles
async function person(name, region, roles = []) {
  const p = (await ok('POST', 'learn/people', boss, { legalName: name, email: `${name.split(' ')[0].toLowerCase()}@demo.test`, regionId: region })).person;
  for (const r of roles) await ok('POST', 'learn/roles', boss, { personId: p.id, ...r });
  return p;
}
// a programme with one module and lesson, published
async function publishedProgramme(id, title, edition = '2027') {
  const made = await ok('POST', 'learn/programmes', boss, { id, title, category: 'referee', edition, learnerRole: `${title} learner` });
  const m = (await ok('POST', `learn/versions/${made.versionId}/modules`, boss, { title: 'Basics' })).modules[0];
  await ok('POST', `learn/modules/${m.id}/lessons`, boss, { title: 'First lesson', minutes: 8 });
  await ok('POST', `learn/versions/${made.versionId}/state`, boss, { to: 'review' });
  await ok('POST', `learn/versions/${made.versionId}/state`, boss, { to: 'published' });
  return made.versionId;
}

test('one person enrolled on two programmes has two independent records under one identity (AT-02, PRG-04, PER-03, PER-04)', { skip }, async () => {
  await publishedProgramme('ocr-referee', 'OCR Referee');
  await publishedProgramme('deka-judge', 'DEKA Judge');
  const anna = await person('Anna Kowalska', 'europe');
  for (const programmeId of ['ocr-referee', 'deka-judge']) await ok('POST', 'learn/enrolments', as(anna), { programmeId });
  assert.strictEqual((await call('POST', 'learn/enrolments', as(anna), { programmeId: 'ocr-referee' })).status, 409, 'not twice');
  const rec = await ok('GET', `learn/people/${anna.id}/record`, as(anna));
  assert.deepStrictEqual(rec.enrolments.map((e) => [e.programmeId, e.role, e.state]).sort(), [['deka-judge', 'DEKA Judge learner', 'active'], ['ocr-referee', 'OCR Referee learner', 'active']]);
  assert.notStrictEqual(rec.enrolments[0].versionId, rec.enrolments[1].versionId);
  assert.strictEqual(rec.person.publicId, anna.publicId, 'one identity');
  // the catalogue shows each as enrolled
  const cat = await ok('GET', 'learn/programmes', as(anna));
  assert.ok(cat.programmes.every((p) => p.enrolment && p.enrolment.state === 'active'));
  assert.strictEqual(cat.canCreate, false);
});

test('an admin makes a third programme from the screens alone: no code change (AT-03, PRG-01, PRG-02)', { skip }, async () => {
  const made = await ok('POST', 'learn/programmes', boss, { id: 'kids-marshal', title: 'Spartan Kids Course Marshal', category: 'other', locales: 'en,es,xx', learnerRole: 'Course Marshal', qualification: 'Kids Course Marshal 2027' });
  assert.deepStrictEqual(made.programme.locales, ['en', 'es'], 'only the site\'s languages');
  await ok('POST', `learn/versions/${made.versionId}/modules`, boss, { title: 'Safety first', summary: 'Keeping young athletes safe' });
  // and a draft assessment, with a question, from the same screens
  const assessment = (await ok('POST', `learn/versions/${made.versionId}/assessments`, boss, { title: 'Marshal check' })).assessment;
  const bank = await ok('POST', `learn/assessments/${assessment.id}/questions`, boss, { type: 'single', prompt: 'Who may enter the course?', options: [{ text: 'Only athletes and officials', correct: true }, { text: 'Anyone' }] });
  assert.strictEqual(bank.questions.length, 1); assert.strictEqual(bank.assessment.versionState, 'draft');
  const p = await ok('GET', 'learn/programmes/kids-marshal', boss);
  assert.strictEqual(p.version.state, 'draft'); assert.strictEqual(p.modules.length, 1); assert.strictEqual(p.version.qualification, 'Kids Course Marshal 2027');
  // a learner doesn't see a programme with nothing published
  const ben = await person('Ben Taylor', 'europe');
  assert.ok(!(await ok('GET', 'learn/programmes', as(ben))).programmes.some((x) => x.id === 'kids-marshal'));
  assert.strictEqual((await call('GET', 'learn/programmes/kids-marshal', as(ben))).status, 404);
  assert.strictEqual((await call('POST', 'learn/programmes', as(ben), { id: 'mine', title: 'Mine' })).status, 403);
  assert.strictEqual((await call('POST', 'learn/programmes', boss, { id: 'Bad Id', title: 'X' })).status, 400);
  const audit = await ok('GET', 'learn/audit?entityType=programme&entityId=kids-marshal', boss);
  assert.strictEqual(audit.events[0].action, 'programme.create');
});

test('a published version never changes; a new draft copies it, and publishing it supersedes the old one (PRG-05)', { skip }, async () => {
  const p = await ok('GET', 'learn/programmes/ocr-referee', boss);
  const v = p.version, m = p.modules[0];
  assert.strictEqual(v.state, 'published');
  assert.strictEqual((await call('POST', `learn/versions/${v.id}/modules`, boss, { title: 'Sneaky' })).status, 409);
  assert.strictEqual((await call('PUT', `learn/modules/${m.id}`, boss, { title: 'Changed' })).status, 409);
  assert.strictEqual((await call('PUT', `learn/versions/${v.id}`, boss, { passMark: 50 })).status, 409);
  const next = (await ok('POST', 'learn/programmes/ocr-referee/versions', boss, { edition: '2028' })).version;
  assert.strictEqual(next.state, 'draft'); assert.strictEqual(next.qualification, 'OCR Referee 2028');
  const copy = await ok('GET', `learn/programmes/ocr-referee?version=${next.id}`, boss);
  assert.strictEqual(copy.modules[0].lineageId, m.lineageId, 'the same module, carried over');
  assert.notStrictEqual(copy.modules[0].id, m.id);
  await ok('PUT', `learn/versions/${next.id}`, boss, { passMark: 85, maxAttempts: 3, retakeWaitHours: 24, validityMonths: 12 });
  await ok('POST', `learn/versions/${next.id}/state`, boss, { to: 'review' });
  await ok('POST', `learn/versions/${next.id}/state`, boss, { to: 'published' });
  const after = await ok('GET', 'learn/programmes/ocr-referee', boss);
  assert.deepStrictEqual(after.versions.map((x) => [x.edition, x.state]), [['2027', 'superseded'], ['2028', 'published']]);
});

test('editors draft but never approve their own work; owners approve; learners and coordinators can\'t touch content', { skip }, async () => {
  const editor = await person('Claire Martin', 'europe', [{ role: 'content_editor', programmeId: 'deka-judge' }]);
  const owner = await person('Paul Owner', 'europe', [{ role: 'programme_owner', programmeId: 'deka-judge' }]);
  const coord = await person('Elena Ruiz', 'europe', [{ role: 'regional_coordinator', regionId: 'europe' }]);
  const v = (await ok('POST', 'learn/programmes/deka-judge/versions', as(owner), { edition: '2028' })).version;
  await ok('POST', `learn/versions/${v.id}/modules`, as(editor), { title: 'Judging standards' });
  assert.strictEqual((await call('POST', `learn/versions/${v.id}/modules`, as(coord), { title: 'No' })).status, 403);
  assert.strictEqual((await call('PUT', `learn/versions/${v.id}`, as(editor), { passMark: 10 })).status, 403, 'the policy is the owner\'s');
  await ok('POST', `learn/versions/${v.id}/state`, as(owner), { to: 'review' });
  assert.strictEqual((await call('POST', `learn/versions/${v.id}/state`, as(editor), { to: 'published' })).status, 403, 'an editor never approves');
  assert.strictEqual((await call('POST', `learn/versions/${v.id}/state`, as(owner), { to: 'published' })).status, 403, 'not what you sent yourself');
  await ok('POST', `learn/versions/${v.id}/state`, as(owner), { to: 'draft' });
  await ok('POST', `learn/versions/${v.id}/state`, as(editor), { to: 'review' });
  await ok('POST', `learn/versions/${v.id}/state`, as(owner), { to: 'published' });
});

test('coordinators enrol people in their own region only; learners only themselves (NFR-01)', { skip }, async () => {
  const coord = (await ok('GET', 'learn/people?q=elena', boss)).people[0];
  const karim = await person('Karim Haddad', 'mea');
  const chai = await person('Chaiwat Srisuk', 'mea');
  const daniel = await person('Daniel Moreau', 'europe');
  assert.strictEqual((await call('POST', 'learn/enrolments', as(coord), { programmeId: 'ocr-referee', personId: karim.id })).status, 403);
  await ok('POST', 'learn/enrolments', as(coord), { programmeId: 'ocr-referee', personId: daniel.id });
  assert.strictEqual((await call('POST', 'learn/enrolments', as(chai), { programmeId: 'ocr-referee', personId: karim.id })).status, 403);
  assert.strictEqual((await call('GET', `learn/people/${karim.id}/record`, as(coord))).status, 404, 'not another region\'s record');
  const e = (await ok('GET', `learn/people/${daniel.id}/record`, as(coord))).enrolments[0];
  await ok('DELETE', `learn/enrolments/${e.id}`, as(coord));
  assert.strictEqual((await ok('GET', `learn/people/${daniel.id}/record`, as(daniel))).enrolments[0].state, 'withdrawn');
});
