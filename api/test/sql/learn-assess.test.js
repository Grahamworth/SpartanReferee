'use strict';
// Assessment and credentials (step 4), against the real database in its own schema (learn_test), made fresh and dropped after.
//   source scripts/learn-env.sh && cd api && npm run test:sql
const test = require('node:test');
const assert = require('node:assert');
const { createApi } = require('../../src/core');
const { memoryStore } = require('../../src/store');
const { dbFromEnv } = require('../../src/learn/db');

const db = dbFromEnv(process.env, 'learn_test');
const skip = !db && 'LEARN_SQL_* not set (source scripts/learn-env.sh)';
let api, boss, anna, ben, tomas;
const P = {}; // programme id -> { versionId, lessonId, assessmentId, questions }
const login = async (who) => ({ 'x-session': (await api.handle({ method: 'POST', path: 'auth/google', body: { idToken: who } })).body.token });
const call = async (method, path, headers, body) => api.handle({ method, path, headers, body });
const ok = async (method, path, headers, body) => { const r = await call(method, path, headers, body); assert.strictEqual(r.status, 200, `${method} ${path}: ${JSON.stringify(r.body)}`); return r.body; };
const as = (p) => ({ ...boss, 'x-learn-as': p.id });

// a published programme: one lesson with content, an assessment of the given questions, and its policy
async function programme(id, policy, questions) {
  const made = await ok('POST', 'learn/programmes', boss, { id, title: id, category: 'referee', edition: '2027' });
  const v = made.versionId;
  await ok('PUT', `learn/versions/${v}`, boss, policy);
  await ok('PUT', `learn/programmes/${id}`, boss, { assessmentPassMark: policy.passMark || 80, assessmentAttempts: policy.maxAttempts || 10 });
  const m = (await ok('POST', `learn/versions/${v}/modules`, boss, { title: 'Basics' })).modules[0];
  const lessonId = (await ok('POST', `learn/modules/${m.id}/lessons`, boss, { title: 'The lesson' })).lessonId;
  const a = (await ok('POST', `learn/versions/${v}/assessments`, boss, { title: `${id} check` })).assessment;
  for (const q of questions) await ok('POST', `learn/assessments/${a.id}/questions`, boss, q);
  await ok('POST', `learn/versions/${v}/state`, boss, { to: 'review' });
  await ok('POST', `learn/versions/${v}/state`, boss, { to: 'published' });
  const c = (await ok('POST', `learn/lessons/${lessonId}/content`, boss, { locale: 'en', slides: [{ heading: 'One', points: ['x'], narration: 'One.' }] })).content;
  await ok('POST', `learn/content/${c.id}/state`, boss, { to: 'review' });
  await ok('POST', `learn/content/${c.id}/state`, boss, { to: 'published' });
  P[id] = { versionId: v, lessonId, assessmentId: a.id, contentId: c.id, questions: (await ok('GET', `learn/assessments/${a.id}`, boss)).questions };
}
const right = (id) => Object.fromEntries(P[id].questions.map((q) => [q.id, { chosen: q.options.filter((o) => o.correct).map((o) => o.id), reason: 'No jump with the hands above the ears' }]));
const wrong = (id) => Object.fromEntries(P[id].questions.map((q) => [q.id, { chosen: [q.options.find((o) => !o.correct).id] }]));
async function attempt(person, id, answers) {
  const t = (await ok('POST', `learn/assessments/${P[id].assessmentId}/attempts`, as(person))).attempt;
  return ok('POST', `learn/attempts/${t.id}/submit`, as(person), { answers });
}

test.before(async () => {
  if (skip) return;
  await db.dropSchema();
  api = createApi({ store: memoryStore(), secret: 'test-secret-test-secret-test-secret', googleClientId: 'x', adminEmails: ['boss@example.com'],
    verifyGoogle: async (t) => ({ sub: t, email: `${t}@example.com`, name: t }), learnDb: db });
  await db.migrate();
  await db.query("INSERT INTO {S}.region (region_id, name, countries) VALUES ('europe', 'Europe', 'GB,FR'), ('mea', 'Middle East and Asia', 'AE')");
  boss = await login('boss');
  await ok('GET', 'learn/me', boss);
  const person = async (name, region, roles = []) => { const p = (await ok('POST', 'learn/people', boss, { legalName: name, email: `${name.split(' ')[0].toLowerCase()}@demo.test`, regionId: region })).person; for (const r of roles) await ok('POST', 'learn/roles', boss, { personId: p.id, ...r }); return p; };
  anna = await person('Anna Kowalska', 'europe'); ben = await person('Ben Taylor', 'mea');
  tomas = await person('Tomas Novak', 'europe', [{ role: 'assessor', programmeId: 'ocr-referee' }]);
  await programme('ocr-referee', { passMark: 80, maxAttempts: 2, retakeWaitHours: 24, validityMonths: 12 }, [
    { type: 'single', prompt: 'When does a Spear Throw attempt start?', options: [{ text: 'On release', correct: true }, { text: 'On the draw back' }], rules: 'OCR-2026-4.2.13', feedback: 'Rule 4.2.13 c1.' },
    { type: 'multiple', prompt: 'Which are part of a burpee?', options: [{ text: 'Chest to the ground', correct: true }, { text: 'A jump, hands above the ears', correct: true }, { text: 'A clap' }], rules: 'OCR-2026-3.17.4' },
    { type: 'video', prompt: 'Does this burpee meet the standard?', options: [{ text: 'Yes' }, { text: 'No: no jump', correct: true }], rules: 'OCR-2026-3.17.4', clip: { variant: 'noJump' }, needsAssessor: true },
  ]);
  await programme('deka-judge', { passMark: 70, validityMonths: 24 }, [
    { type: 'single', prompt: 'Is this placeholder DEKA\'s rules?', options: [{ text: 'No', correct: true }, { text: 'Yes' }] },
  ]);
  for (const id of ['ocr-referee', 'deka-judge']) await ok('POST', 'learn/enrolments', as(anna), { programmeId: id });
  await ok('POST', 'learn/enrolments', as(ben), { programmeId: 'ocr-referee' });
});
test.after(async () => { if (!skip) { await db.dropSchema(); await db.close(); } });

test('the assessment opens once the lessons are done; answers are hidden until submitted; questions can\'t change once published', { skip }, async () => {
  const before = await ok('GET', `learn/assessments/${P['ocr-referee'].assessmentId}`, as(anna));
  assert.strictEqual(before.may.ok, false); assert.match(before.may.why, /lesson/);
  assert.strictEqual(before.questions.length, 0, 'learners don\'t see the bank');
  await ok('POST', `learn/lessons/${P['ocr-referee'].lessonId}/complete`, as(anna), { contentId: P['ocr-referee'].contentId });
  const t = (await ok('POST', `learn/assessments/${P['ocr-referee'].assessmentId}/attempts`, as(anna))).attempt;
  assert.strictEqual(t.questions.length, 3);
  assert.ok(t.questions.every((q) => q.options.every((o) => o.correct === undefined) && q.feedback === undefined), 'no answers while it\'s open');
  assert.strictEqual((await call('POST', `learn/assessments/${P['ocr-referee'].assessmentId}/questions`, boss, { type: 'single', prompt: 'Sneaky question?', options: [{ text: 'a', correct: true }, { text: 'b' }] })).status, 409);
});

test('a result links to the exact questions, their versions and rule references (AT-04, ASM-02); learners can\'t change it (AT-09)', { skip }, async () => {
  const open = (await ok('GET', `learn/assessments/${P['ocr-referee'].assessmentId}`, as(anna))).attempts.find((x) => x.result === 'open');
  const r = await ok('POST', `learn/attempts/${open.id}/submit`, as(anna), { answers: right('ocr-referee') });
  assert.strictEqual(r.attempt.result, 'pending', 'the video judgement waits for an assessor');
  const row = (await db.query('SELECT * FROM {S}.attempt WHERE attempt_id = @id', { id: open.id }))[0];
  const answers = JSON.parse(row.answers);
  assert.deepStrictEqual(answers.map((a) => [a.versionNo, a.rules.join(',')]), [[1, 'OCR-2026-4.2.13'], [1, 'OCR-2026-3.17.4'], [1, 'OCR-2026-3.17.4']]);
  assert.ok(answers.every((a) => a.lineageId && a.questionId));
  assert.strictEqual(row.version_id.toLowerCase(), P['ocr-referee'].versionId.toLowerCase());
  assert.strictEqual((await call('POST', `learn/attempts/${open.id}/submit`, as(anna), { answers: wrong('ocr-referee') })).status, 409, 'answers never change once submitted');
  assert.strictEqual((await call('POST', `learn/attempts/${open.id}/decide`, as(anna), { decisions: {} })).status, 403, 'a learner can\'t decide');
  assert.strictEqual((await call('GET', `learn/attempts/${open.id}`, as(ben))).status, 404, 'nor see someone else\'s');
  assert.strictEqual((await call('POST', `learn/attempts/${open.id}/submit`, as(ben), { answers: {} })).status, 404);
  // the assessor decides: passed, and the credential is issued
  assert.strictEqual((await ok('GET', 'learn/assessing', as(tomas))).attempts.length, 1);
  const video = P['ocr-referee'].questions.find((q) => q.type === 'video');
  const d = await ok('POST', `learn/attempts/${open.id}/decide`, as(tomas), { decisions: { [video.id]: true }, note: 'Right call' });
  assert.strictEqual(d.result, 'pass'); assert.strictEqual(d.enrolment.state, 'completed');
});

test('passing issues a demonstration credential per programme, each expiring by its own policy (AT-08, ASM-04, ASM-05)', { skip }, async () => {
  await ok('POST', `learn/lessons/${P['deka-judge'].lessonId}/complete`, as(anna), { contentId: P['deka-judge'].contentId });
  const r = await attempt(anna, 'deka-judge', right('deka-judge'));
  assert.strictEqual(r.attempt.result, 'pass'); assert.ok(r.credential, 'issued at once: no assessor needed');
  const rec = await ok('GET', `learn/people/${anna.id}/record`, as(anna));
  const byProg = Object.fromEntries(rec.credentials.map((c) => [c.programmeId, c]));
  assert.match(byProg['ocr-referee'].publicId, /^DEMO-OCR-\d{6}$/); assert.match(byProg['deka-judge'].publicId, /^DEMO-DEKA-\d{6}$/);
  assert.ok(byProg['ocr-referee'].demonstration && byProg['deka-judge'].demonstration);
  const months = (c) => Math.round((new Date(c.expiresAt) - new Date(c.issuedAt)) / (30.44 * 864e5));
  assert.strictEqual(months(byProg['ocr-referee']), 12); assert.strictEqual(months(byProg['deka-judge']), 24);
  assert.deepStrictEqual(rec.enrolments.map((e) => e.state).sort(), ['completed', 'completed']);
  // due and expired follow from the dates
  await db.query("UPDATE {S}.credential SET expires_at = DATEADD(day, 20, SYSUTCDATETIME()) WHERE public_id = @p", { p: byProg['ocr-referee'].publicId });
  await db.query("UPDATE {S}.credential SET expires_at = DATEADD(day, -1, SYSUTCDATETIME()) WHERE public_id = @p", { p: byProg['deka-judge'].publicId });
  const now = Object.fromEntries((await ok('GET', `learn/people/${anna.id}/record`, as(anna))).credentials.map((c) => [c.programmeId, c.status]));
  assert.deepStrictEqual(now, { 'ocr-referee': 'due', 'deka-judge': 'expired' });
});

test('the final assessment: its attempts are the programme\'s setting, and when none passes the programme starts again', { skip }, async () => {
  await ok('PUT', 'learn/programmes/ocr-referee', boss, { assessmentAttempts: 3, assessmentPassMark: 80 });
  await ok('POST', `learn/lessons/${P['ocr-referee'].lessonId}/complete`, as(ben), { contentId: P['ocr-referee'].contentId });
  for (let i = 0; i < 2; i++) assert.strictEqual((await attempt(ben, 'ocr-referee', wrong('ocr-referee'))).attempt.result, 'fail');
  assert.strictEqual((await ok('GET', `learn/assessments/${P['ocr-referee'].assessmentId}`, as(ben))).may.left, 1);
  const last = await attempt(ben, 'ocr-referee', wrong('ocr-referee'));
  assert.strictEqual(last.attempt.result, 'fail'); assert.strictEqual(last.restarted, true);
  assert.deepStrictEqual(last.attempt.after, { restarted: true, left: 0 });
  // the lessons are done again before the assessment opens; what was done before is kept, not counted
  const blocked = await call('POST', `learn/assessments/${P['ocr-referee'].assessmentId}/attempts`, as(ben));
  assert.strictEqual(blocked.status, 409); assert.match(blocked.body.error, /lesson/);
  const page = await ok('GET', 'learn/programmes/ocr-referee', as(ben));
  assert.strictEqual(page.progress.done, 0); assert.strictEqual(page.finalAssessment.restarts, 1);
  assert.strictEqual((await db.query('SELECT COUNT(*) AS n FROM {S}.completion_archive WHERE person_id = @p', { p: ben.id }))[0].n, 1);
  await ok('POST', `learn/lessons/${P['ocr-referee'].lessonId}/complete`, as(ben), { contentId: P['ocr-referee'].contentId });
  const again = await ok('GET', `learn/assessments/${P['ocr-referee'].assessmentId}`, as(ben));
  assert.strictEqual(again.may.ok, true); assert.strictEqual(again.may.left, 3); assert.strictEqual(again.policy.restarts, 1);
});

test('each attempt draws its questions from the pool, none repeated while unseen ones are left, across the programme\'s topics', { skip }, async () => {
  const qs = Array.from({ length: 25 }, (_, i) => ({ type: 'single', prompt: `Pool question ${i + 1}?`, options: [{ text: 'Right', correct: true }, { text: 'Wrong' }] }));
  await programme('pool-test', { passMark: 80 }, qs);
  await ok('PUT', 'learn/programmes/pool-test', boss, { assessmentQuestions: 10, assessmentAttempts: 3 });
  const cara = (await ok('POST', 'learn/people', boss, { legalName: 'Cara Pool', email: 'cara.pool@demo.test', regionId: 'europe' })).person;
  await ok('POST', 'learn/enrolments', as(cara), { programmeId: 'pool-test' });
  await ok('POST', `learn/lessons/${P['pool-test'].lessonId}/complete`, as(cara), { contentId: P['pool-test'].contentId });
  const a = await ok('GET', `learn/assessments/${P['pool-test'].assessmentId}`, as(cara));
  assert.deepStrictEqual({ per: a.policy.perAttempt, pool: a.policy.pool, pass: a.policy.passMark, tries: a.policy.maxAttempts }, { per: 10, pool: 25, pass: 80, tries: 3 });
  const seen = [];
  for (let i = 0; i < 2; i++) {
    const t = (await ok('POST', `learn/assessments/${P['pool-test'].assessmentId}/attempts`, as(cara))).attempt;
    assert.strictEqual(t.questions.length, 10);
    const ids = t.questions.map((q) => q.id);
    assert.strictEqual(ids.filter((id) => seen.includes(id)).length, 0, `attempt ${i + 1} repeats no question`);
    seen.push(...ids);
    await ok('POST', `learn/attempts/${t.id}/submit`, as(cara), { answers: Object.fromEntries(t.questions.map((q) => [q.id, { chosen: [q.options[1].id] }])) });
  }
  const third = (await ok('POST', `learn/assessments/${P['pool-test'].assessmentId}/attempts`, as(cara))).attempt;
  assert.strictEqual(third.questions.filter((q) => !seen.includes(q.id)).length, 5, 'the 5 never seen, then the least seen');
  // all right: 100%, a pass
  const r = await ok('POST', `learn/attempts/${third.id}/submit`, as(cara), { answers: Object.fromEntries(third.questions.map((q) => [q.id, { chosen: [q.options[0].id] }])) });
  assert.strictEqual(r.attempt.result, 'pass'); assert.strictEqual(r.enrolment.state, 'completed');
});

test('with the final assessment turned off, the lessons alone complete a programme', { skip }, async () => {
  await ok('PUT', 'learn/programmes/pool-test', boss, { assessmentOn: false });
  const dan = (await ok('POST', 'learn/people', boss, { legalName: 'Dan Off', email: 'dan.off@demo.test', regionId: 'europe' })).person;
  await ok('POST', 'learn/enrolments', as(dan), { programmeId: 'pool-test' });
  const done = await ok('POST', `learn/lessons/${P['pool-test'].lessonId}/complete`, as(dan), { contentId: P['pool-test'].contentId });
  assert.strictEqual(done.enrolment.state, 'completed');
  const no = await call('POST', `learn/assessments/${P['pool-test'].assessmentId}/attempts`, as(dan));
  assert.strictEqual(no.status, 409); assert.match(no.body.error, /no final assessment/);
  assert.deepStrictEqual((await ok('GET', 'learn/programmes/pool-test', as(dan))).assessments, []);
});

test('only the owner or an admin changes a credential, with a reason, and the audit says who (AT-09, AT-10, ADM-03)', { skip }, async () => {
  const c = (await ok('GET', `learn/people/${anna.id}/record`, as(anna))).credentials.find((x) => x.programmeId === 'ocr-referee');
  assert.strictEqual((await call('POST', `learn/credentials/${c.id}/status`, as(anna), { status: 'active', reason: 'mine' })).status, 403, 'not the learner');
  assert.strictEqual((await call('POST', `learn/credentials/${c.id}/status`, as(tomas), { status: 'suspended', reason: 'x' })).status, 403, 'not an assessor');
  assert.strictEqual((await call('POST', `learn/credentials/${c.id}/status`, boss, { status: 'suspended' })).status, 400, 'a reason is needed');
  const s = await ok('POST', `learn/credentials/${c.id}/status`, boss, { status: 'suspended', reason: 'Demo: video review pending' });
  assert.strictEqual(s.credential.status, 'suspended');
  assert.deepStrictEqual(s.history.map((h) => h.action), ['credential.issue', 'credential.status']);
  assert.match(s.history[0].by, /boss as Tomas Novak/, 'issued on the assessor\'s decision, made by the admin viewing as them');
  assert.deepStrictEqual(s.history[1].summary, { publicId: c.publicId, before: 'active', after: 'suspended', reason: 'Demo: video review pending' });
  assert.strictEqual((await call('GET', `learn/credentials/${c.id}`, as(ben))).status, 404, 'not someone else\'s');
});
