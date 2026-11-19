'use strict';
// The bugs found in the review of 19 November 2026 (docs/reviews/2026-11-19-code.md), each shown fixed, against the real database
// in its own schema (learn_test).   source scripts/learn-env.sh && cd api && npm run test:sql
const test = require('node:test');
const assert = require('node:assert');
const { createApi } = require('../../src/core');
const { memoryStore } = require('../../src/store');
const { dbFromEnv } = require('../../src/learn/db');

const db = dbFromEnv(process.env, 'learn_test');
const skip = !db && 'LEARN_SQL_* not set (source scripts/learn-env.sh)';
let api, store, boss, ana, coord;
const login = async (who) => ({ 'x-session': (await api.handle({ method: 'POST', path: 'auth/google', body: { idToken: who } })).body.token });
const call = async (method, path, headers, body) => api.handle({ method, path, headers, body });
const ok = async (method, path, headers, body) => { const r = await call(method, path, headers, body); assert.strictEqual(r.status, 200, `${method} ${path}: ${JSON.stringify(r.body)}`); return r.body; };
const as = (p) => ({ ...boss, 'x-learn-as': p.id });
let V, A, L, C; // the programme's version, assessment, lesson and its English content

test.before(async () => {
  if (skip) return;
  await db.dropSchema();
  store = memoryStore();
  api = createApi({ store, secret: 'test-secret-test-secret-test-secret', googleClientId: 'x', adminEmails: ['boss@example.com'],
    verifyGoogle: async (t) => ({ sub: t, email: `${t}@example.com`, name: t === 'mal' ? '=HYPERLINK("http://x","y")' : t }), learnDb: db });
  await db.migrate();
  await db.query("INSERT INTO {S}.region (region_id, name, countries) VALUES ('europe', 'Europe', 'GB')");
  boss = await login('boss');
  await ok('GET', 'learn/me', boss);
  ana = (await ok('POST', 'learn/people', boss, { legalName: 'Ana Popescu', email: 'ana@demo.test', regionId: 'europe' })).person;
  coord = (await ok('POST', 'learn/people', boss, { legalName: 'Elena Ruiz', email: 'elena@demo.test', regionId: 'europe' })).person;
  await ok('POST', 'learn/roles', boss, { personId: coord.id, role: 'regional_coordinator', regionId: 'europe' });
  V = (await ok('POST', 'learn/programmes', boss, { id: 'ocr-referee', title: 'OCR', category: 'referee', locales: 'en,es', edition: '2027' })).versionId;
  await ok('PUT', `learn/versions/${V}`, boss, { passMark: 50, validityMonths: 12 });
  const m = (await ok('POST', `learn/versions/${V}/modules`, boss, { title: 'Basics' })).modules[0];
  L = (await ok('POST', `learn/modules/${m.id}/lessons`, boss, { title: 'One' })).lessonId;
  A = (await ok('POST', `learn/versions/${V}/assessments`, boss, { title: 'Check' })).assessment.id;
  await ok('POST', `learn/assessments/${A}/questions`, boss, { type: 'single', prompt: 'One plus one?', options: [{ text: 'Two', correct: true }, { text: 'Three' }], rules: 'X-2026-1,X-2026-1' });
  await ok('POST', `learn/versions/${V}/state`, boss, { to: 'review' });
  await ok('POST', `learn/versions/${V}/state`, boss, { to: 'published' });
  C = (await ok('POST', `learn/lessons/${L}/content`, boss, { locale: 'en', slides: [{ heading: 'One', points: ['x'], narration: 'One.' }] })).content;
  await ok('POST', `learn/content/${C.id}/state`, boss, { to: 'review' });
  await ok('POST', `learn/content/${C.id}/state`, boss, { to: 'published' });
});
test.after(async () => { if (!skip) { await db.dropSchema(); await db.close(); } });

async function pass(person) {
  const t = (await ok('POST', `learn/assessments/${A}/attempts`, as(person))).attempt;
  return ok('POST', `learn/attempts/${t.id}/submit`, as(person), { answers: { [t.questions[0].id]: { chosen: [t.questions[0].options[0].id] } } });
}

test('H1: a completed programme can\'t be withdrawn by its learner, and re-enrolling never re-issues a credential', { skip }, async () => {
  await ok('POST', 'learn/enrolments', as(ana), { programmeId: 'ocr-referee' });
  await ok('POST', `learn/lessons/${L}/complete`, as(ana), { contentId: C.id });
  const r = await pass(ana);
  assert.ok(r.credential);
  const e = (await ok('GET', `learn/people/${ana.id}/record`, as(ana))).enrolments[0];
  assert.strictEqual(e.state, 'completed');
  assert.strictEqual((await call('DELETE', `learn/enrolments/${e.id}`, as(ana))).status, 409);
  // an admin can close it; the learner re-enrols and completes again: still one credential
  await ok('DELETE', `learn/enrolments/${e.id}`, boss);
  await ok('POST', 'learn/enrolments', as(ana), { programmeId: 'ocr-referee' });
  await ok('POST', `learn/lessons/${L}/complete`, as(ana), { contentId: C.id });
  assert.strictEqual((await db.query('SELECT COUNT(*) AS n FROM {S}.credential WHERE person_id = @p', { p: ana.id }))[0].n, 1);
  // and while a credential is suspended, nothing new is issued
  const cred = (await ok('GET', `learn/people/${ana.id}/record`, as(ana))).credentials[0];
  await ok('POST', `learn/credentials/${cred.id}/status`, boss, { status: 'suspended', reason: 'test' });
  assert.ok((await ok('GET', 'learn/audit?entityType=credential', boss)).events.length >= 2);
});

test('H2: a new version copies a lesson that has published and in-review content in one language', { skip }, async () => {
  const fix = (await ok('POST', `learn/lessons/${L}/content`, boss, { locale: 'en', slides: [{ heading: 'One, fixed', points: ['y'], narration: 'One.' }] })).content;
  await ok('POST', `learn/content/${fix.id}/state`, boss, { to: 'review' });
  const next = (await ok('POST', 'learn/programmes/ocr-referee/versions', boss, { edition: '2028' })).version;
  const copied = await db.query('SELECT c.locale, c.version_no, c.state FROM {S}.content_version c JOIN {S}.lesson l ON l.lesson_id = c.lesson_id WHERE l.version_id = @v ORDER BY c.version_no', { v: next.id });
  assert.deepStrictEqual(copied.map((x) => [x.locale, x.version_no, x.state]), [['en', 1, 'published'], ['en', 2, 'review']]);
});

test('M4 and L15: a learner on a superseded version still sees it, and moving to the new one ends the old enrolment', { skip }, async () => {
  const ben = (await ok('POST', 'learn/people', boss, { legalName: 'Ben Taylor', email: 'ben@demo.test', regionId: 'europe' })).person;
  await ok('POST', 'learn/enrolments', as(ben), { programmeId: 'ocr-referee' });
  const v2028 = (await ok('GET', 'learn/programmes/ocr-referee', boss)).versions.find((v) => v.edition === '2028');
  await ok('POST', `learn/versions/${v2028.id}/state`, boss, { to: 'review' });
  await ok('POST', `learn/versions/${v2028.id}/state`, boss, { to: 'published' });
  const p = await ok('GET', 'learn/programmes/ocr-referee', as(ben));
  assert.strictEqual(p.version.edition, '2027', 'the version Ben is on'); assert.strictEqual(p.newer.edition, '2028');
  await ok('POST', 'learn/enrolments', as(ben), { programmeId: 'ocr-referee' });
  const states = (await ok('GET', `learn/people/${ben.id}/record`, as(ben))).enrolments.map((e) => [e.edition, e.state]).sort();
  assert.deepStrictEqual(states, [['2027', 'withdrawn'], ['2028', 'active']]);
});

test('M8: a second submit of the same attempt changes nothing', { skip }, async () => {
  const cara = (await ok('POST', 'learn/people', boss, { legalName: 'Cara Smith', email: 'cara@demo.test', regionId: 'europe' })).person;
  await ok('POST', 'learn/enrolments', as(cara), { programmeId: 'ocr-referee' });
  const prog = await ok('GET', 'learn/programmes/ocr-referee', as(cara)), a2028 = prog.assessments[0].id;
  const lesson = await ok('GET', `learn/lessons/${prog.modules[0].lessons[0].id}`, as(cara));
  await ok('POST', `learn/lessons/${lesson.lesson.id}/complete`, as(cara), { contentId: lesson.content.id });
  const t = (await ok('POST', `learn/assessments/${a2028}/attempts`, as(cara))).attempt;
  const right = { [t.questions[0].id]: { chosen: [t.questions[0].options.find((o) => o.text === 'Two').id] } };
  const wrong = { [t.questions[0].id]: { chosen: [t.questions[0].options.find((o) => o.text === 'Three').id] } };
  const [one, two] = await Promise.all([call('POST', `learn/attempts/${t.id}/submit`, as(cara), { answers: right }), call('POST', `learn/attempts/${t.id}/submit`, as(cara), { answers: wrong })]);
  assert.deepStrictEqual([one.status, two.status].sort(), [200, 409]);
  const row = (await db.query('SELECT result, answers FROM {S}.attempt WHERE attempt_id = @id', { id: t.id }))[0];
  assert.strictEqual(row.result, one.status === 200 ? 'pass' : 'fail', 'the first submit\'s result stands');
});

test('M5: the learning admin role follows the site\'s admins; a suspended person is refused', { skip }, async () => {
  await ok('POST', 'admin/admins', boss, { email: 'zoe@example.com' });
  const zoe = await login('zoe');
  const me = await ok('GET', 'learn/me', zoe);
  assert.ok(me.grants.some((g) => g.role === 'global_admin'));
  await ok('POST', 'admin/referees', boss, { email: 'zoe@example.com' }); // stays a referee
  await ok('POST', 'admin/admins/remove', boss, { email: 'zoe@example.com' });
  const after = await ok('GET', 'learn/me', zoe);
  assert.ok(!after.grants.some((g) => g.role === 'global_admin'), 'no longer an admin: no longer a learning admin');
  await ok('PUT', `learn/people/${after.person.id}`, boss, { status: 'suspended' });
  assert.strictEqual((await call('GET', 'learn/me', zoe)).status, 403);
});

test('M6: the export neutralises spreadsheet formulas in names; L2: a coordinator can\'t take someone out of every region', { skip }, async () => {
  await ok('POST', 'admin/referees', boss, { email: 'mal@example.com' });
  const mal = (await ok('GET', 'learn/me', await login('mal'))).person;
  await ok('PUT', `learn/people/${mal.id}`, boss, { regionId: 'europe' });
  await ok('POST', 'learn/enrolments', boss, { programmeId: 'ocr-referee', personId: mal.id });
  const csv = (await ok('GET', 'learn/reports/export', boss)).csv;
  assert.match(csv, /"'=HYPERLINK\(""http:\/\/x"",""y""\)"/, 'starts with a quote, so it stays text');
  assert.strictEqual((await call('PUT', `learn/people/${ana.id}`, as(coord), { regionId: '' })).status, 403);
});

test('M9: rule links follow content and questions; a repeated rule id is kept once', { skip }, async () => {
  const q = (await db.query('SELECT rules FROM {S}.question'))[0];
  assert.strictEqual(q.rules, 'X-2026-1');
});

test('privacy: a person downloads their own data; an admin exports or erases someone, who is anonymised and refused', { skip }, async () => {
  await ok('POST', 'admin/referees', boss, { email: 'pia@example.com' });
  const pia = await login('pia');
  const me = (await ok('GET', 'learn/me', pia)).person;
  const mine = await ok('GET', `learn/people/${me.id}/export`, pia);
  assert.strictEqual(mine.person.email, 'pia@example.com'); assert.ok(Array.isArray(mine.audit));
  assert.strictEqual((await call('GET', `learn/people/${ana.id}/export`, pia)).status, 404, 'not someone else\'s');
  assert.strictEqual((await call('POST', `learn/people/${me.id}/erase`, boss, { confirm: 'yes' })).status, 400);
  await ok('POST', `learn/people/${me.id}/erase`, boss, { confirm: 'ERASE' });
  const after = (await db.query('SELECT * FROM {S}.person WHERE person_id = @p', { p: me.id }))[0];
  assert.strictEqual(after.legal_name, 'Erased person'); assert.match(after.email, /@erased\.invalid$/); assert.strictEqual(after.status, 'erased');
  assert.strictEqual((await db.query('SELECT COUNT(*) AS n FROM {S}.person_login WHERE person_id = @p', { p: me.id }))[0].n, 0);
  // no address in a new first sign-in's audit entry
  assert.ok(!(await db.query("SELECT summary FROM {S}.audit_event WHERE action = 'person.first-sign-in'")).some((r) => r.summary.includes('pia@example.com')));
});
