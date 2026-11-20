'use strict';
// Keeping sharp: quick checks, refreshers, the streak and badges (checks.js), against the real database in its own schema (learn_test).
//   source scripts/learn-env.sh && cd api && npm run test:sql
const test = require('node:test');
const assert = require('node:assert');
const { createApi } = require('../../src/core');
const { memoryStore } = require('../../src/store');
const { dbFromEnv } = require('../../src/learn/db');

const db = dbFromEnv(process.env, 'learn_test');
const skip = !db && 'LEARN_SQL_* not set (source scripts/learn-env.sh)';
let api, boss, lessonId, contentId, learner;
const login = async (who) => ({ 'x-session': (await api.handle({ method: 'POST', path: 'auth/google', body: { idToken: who } })).body.token });
const call = async (method, path, headers, body) => api.handle({ method, path, headers, body });
const ok = async (method, path, headers, body) => { const r = await call(method, path, headers, body); assert.strictEqual(r.status, 200, `${method} ${path}: ${JSON.stringify(r.body)}`); return r.body; };
const as = (p) => ({ ...boss, 'x-learn-as': p.id });
const RULE = 'OCR-2026-4.2.13';
const CHECKS = [
  { prompt: 'How many throws does an athlete get?', options: ['One', 'Two', 'Three'], answer: 0, feedback: 'One throw: a miss is a fail.', rules: [RULE] },
  { prompt: 'What is the penalty?', options: ['10 burpees', '30 burpees'], answer: 1, feedback: 'Thirty burpees.', rules: [] },
];

test.before(async () => {
  if (skip) return;
  await db.dropSchema();
  api = createApi({ store: memoryStore(), secret: 'test-secret-test-secret-test-secret', googleClientId: 'x', adminEmails: ['boss@example.com'],
    verifyGoogle: async (t) => ({ sub: t, email: `${t}@example.com`, name: t }), learnDb: db });
  await db.migrate();
  await db.query("INSERT INTO {S}.region (region_id, name, countries) VALUES ('europe', 'Europe', 'GB,FR')");
  boss = await login('boss');
  await ok('GET', 'learn/me', boss);
  const person = async (name, roles = []) => { const p = (await ok('POST', 'learn/people', boss, { legalName: name, email: `${name.split(' ')[0].toLowerCase()}@demo.test`, regionId: 'europe' })).person; for (const r of roles) await ok('POST', 'learn/roles', boss, { personId: p.id, ...r }); return p; };
  const editor = await person('Claire Martin', [{ role: 'content_editor', programmeId: 'ocr-referee' }]);
  const owner = await person('Paul Owner', [{ role: 'programme_owner', programmeId: 'ocr-referee' }]);
  learner = await person('Ben Taylor');
  const made = await ok('POST', 'learn/programmes', boss, { id: 'ocr-referee', title: 'OCR Referee', category: 'referee', locales: 'en', edition: '2027' });
  const m = (await ok('POST', `learn/versions/${made.versionId}/modules`, boss, { title: 'Obstacles' })).modules[0];
  lessonId = (await ok('POST', `learn/modules/${m.id}/lessons`, boss, { title: 'Spear Throw' })).lessonId;
  const c = (await ok('POST', `learn/lessons/${lessonId}/content`, as(editor), { locale: 'en', slides: [{ heading: 'One throw', points: ['A miss is a fail'], narration: 'One throw.', rules: [RULE] }] })).content;
  await ok('POST', `learn/content/${c.id}/state`, as(editor), { to: 'review' });
  await ok('POST', `learn/content/${c.id}/state`, as(owner), { to: 'published' });
  contentId = c.id;
  for (const [i, k] of CHECKS.entries()) await db.query('INSERT INTO {S}.lesson_check (check_id, lesson_id, check_key, seq, body) VALUES (NEWID(), @l, @k, @s, @b)', { l: lessonId, k: `ocr-1-1.${i + 1}`, s: i + 1, b: JSON.stringify(k) });
  await ok('POST', `learn/versions/${made.versionId}/state`, boss, { to: 'review' });
  await ok('POST', `learn/versions/${made.versionId}/state`, boss, { to: 'published' });
  await ok('POST', 'learn/enrolments', as(learner), { programmeId: 'ocr-referee' });
  // these tests take the lesson's test without passing it: the last test turns the pass back on
  await ok('PUT', 'learn/programmes/ocr-referee', boss, { lessonsNeedPass: false });
});
test.after(async () => { if (!skip) { await db.dropSchema(); await db.close(); } });

test('a lesson brings its quick check, and is completed only once the check is answered (right or wrong)', { skip }, async () => {
  const L = await ok('GET', `learn/lessons/${lessonId}`, as(learner));
  assert.deepStrictEqual(L.extra.checks.map((k) => [k.key, k.answer]), [['ocr-1-1.1', 0], ['ocr-1-1.2', 1]]);
  assert.deepStrictEqual(L.extra.checkState, {});
  const early = await call('POST', `learn/lessons/${lessonId}/complete`, as(learner), { contentId });
  assert.strictEqual(early.status, 409); assert.match(early.body.error, /test first/);
  const r = await ok('POST', `learn/lessons/${lessonId}/checks`, as(learner), { answers: [{ key: 'ocr-1-1.1', choice: 0 }, { key: 'ocr-1-1.2', choice: 0 }] });
  assert.deepStrictEqual(r.results, [{ key: 'ocr-1-1.1', right: true }, { key: 'ocr-1-1.2', right: false }]);
  const done = await ok('POST', `learn/lessons/${lessonId}/complete`, as(learner), { contentId });
  assert.deepStrictEqual(done.badges.map((b) => b.kind).sort(), ['halfway', 'lessons', 'qualified', 'started'], 'its first lesson, halfway and all of them at once (it has one); with no assessment, finishing it qualifies');
  const again = await ok('GET', `learn/lessons/${lessonId}`, as(learner));
  assert.deepStrictEqual(again.extra.checkState, { 'ocr-1-1.1': { right: true, answered: 1 }, 'ocr-1-1.2': { right: false, answered: 1 } });
});

test('a refresher brings back what\'s due: a changed rule first, then what was missed; right answers wait longer each time', { skip }, async () => {
  let r = await ok('GET', 'learn/refresher?programme=ocr-referee', as(learner));
  assert.strictEqual(r.due, 0, 'nothing due yet: the missed one comes back tomorrow'); assert.strictEqual(r.practised, 2); assert.ok(r.nextDue);
  assert.deepStrictEqual((await ok('GET', 'learn/refresher?programme=ocr-referee&more=1', as(learner))).questions.map((q) => q.why), ['extra', 'extra'], 'but you can practise anyway');
  await db.query("UPDATE {S}.check_state SET due_at = DATEADD(day, -1, SYSUTCDATETIME()), last_at = DATEADD(day, -2, SYSUTCDATETIME())");
  await db.query("INSERT INTO {S}.rule_document (doc_id, programme_id, title, edition, approval) VALUES ('roc', 'ocr-referee', 'Rules', '2027', 'approved')");
  await db.query("INSERT INTO {S}.rule_ref (rule_key, rule_id, version_no, programme_id, doc_id, section, title, excerpt, state, approved_at) VALUES (NEWID(), @r, 2, 'ocr-referee', 'roc', '4.2.13', 'Spear Throw', 'Changed', 'approved', SYSUTCDATETIME())", { r: RULE });
  r = await ok('GET', 'learn/refresher', as(learner));
  assert.deepStrictEqual(r.questions.map((q) => [q.key, q.why]), [['ocr-1-1.1', 'rule'], ['ocr-1-1.2', 'missed']]);
  assert.strictEqual(r.questions[0].lessonTitle, 'Spear Throw');
  const after = await ok('POST', 'learn/refresher', as(learner), { answers: [{ key: 'ocr-1-1.1', choice: 0 }, { key: 'ocr-1-1.2', choice: 1 }, { key: 'not-mine', choice: 0 }] });
  assert.strictEqual(after.right, 2); assert.strictEqual(after.of, 2, 'a question they never practised is ignored'); assert.strictEqual(after.due, 0);
  assert.deepStrictEqual(after.badges.map((b) => b.kind), ['sharp'], 'every check right now');
  assert.strictEqual(after.streak.weeks, 1); assert.strictEqual(after.streak.thisWeek, true);
  const boxes = await db.query('SELECT check_key, box, DATEDIFF(hour, SYSUTCDATETIME(), due_at) AS h FROM {S}.check_state ORDER BY check_key');
  assert.deepStrictEqual(boxes.map((b) => b.box), [2, 1], 'right twice: box 2 (7 days); missed then right: box 1 (3 days)');
  assert.ok(boxes[0].h > 6 * 24 && boxes[1].h > 2 * 24 && boxes[1].h <= 3 * 24);
});

test('progress: the streak, every badge earned or not, and what each programme has due', { skip }, async () => {
  const p = await ok('GET', 'learn/progress', as(learner));
  assert.strictEqual(p.streak.weeks, 1); assert.strictEqual(p.streak.recent.length, 8); assert.strictEqual(p.streak.recent[7], true);
  const earned = p.badges.filter((b) => b.earned).map((b) => b.id).sort();
  assert.deepStrictEqual(earned, ['ocr-referee:halfway', 'ocr-referee:lessons', 'ocr-referee:qualified', 'ocr-referee:sharp', 'ocr-referee:started']);
  assert.ok(p.badges.some((b) => b.id === 'streak-4' && !b.earned));
  assert.deepStrictEqual(p.refresher.map((x) => [x.programmeId, x.due, x.practised]), [['ocr-referee', 0, 2]]);
  // their practice is in their data export, and goes when they're erased
  const out = await ok('GET', `learn/people/${learner.id}/export`, boss);
  assert.strictEqual(out.practice.length, 2); assert.strictEqual(out.badges.length, 5); assert.strictEqual(out.learningDays.length, 1);
});

test('a lesson opens once the one before is completed, which needs its quick check answered; editors open any', { skip }, async () => {
  const one = (await db.query('SELECT * FROM {S}.lesson WHERE lesson_id = @l', { l: lessonId }))[0];
  const two = (await db.query("INSERT INTO {S}.lesson (lesson_id, lineage_id, code, module_id, version_id, seq, title) OUTPUT inserted.lesson_id VALUES (NEWID(), NEWID(), 'ocr-1-2', @m, @v, 2, 'Bucket Carry')", { m: one.module_id, v: one.version_id }))[0].lesson_id;
  const body = JSON.stringify({ slides: [{ heading: 'Carry', points: [], narration: '' }] });
  const c2 = (await db.query("INSERT INTO {S}.content_version (content_id, lesson_id, locale, version_no, state, body, source_hash) OUTPUT inserted.content_id VALUES (NEWID(), @l, 'en', 1, 'published', @b, REPLICATE('0', 64))", { l: two, b: body }))[0].content_id;
  const cara = (await ok('POST', 'learn/people', boss, { legalName: 'Cara New', email: 'cara@demo.test', regionId: 'europe' })).person;
  await ok('POST', 'learn/enrolments', as(cara), { programmeId: 'ocr-referee' });
  const L2 = await ok('GET', `learn/lessons/${two}`, as(cara));
  assert.strictEqual(L2.lock.title, 'Spear Throw', 'the lesson before comes first');
  assert.strictEqual((await call('POST', `learn/lessons/${two}/complete`, as(cara), { contentId: c2 })).status, 409);
  const page = await ok('GET', 'learn/programmes/ocr-referee', as(cara));
  assert.deepStrictEqual(page.locked.map((x) => [x.id.toLowerCase(), x.after.toLowerCase()]), [[two.toLowerCase(), lessonId.toLowerCase()]]);
  assert.strictEqual((await ok('GET', `learn/lessons/${two}`, boss)).lock, null, 'an admin opens any lesson');
  // the quick check (right or wrong), then completing lesson one, opens lesson two
  await ok('POST', `learn/lessons/${lessonId}/checks`, as(cara), { answers: [{ key: 'ocr-1-1.1', choice: 2 }, { key: 'ocr-1-1.2', choice: 0 }] });
  await ok('POST', `learn/lessons/${lessonId}/complete`, as(cara), { contentId });
  assert.strictEqual((await ok('GET', `learn/lessons/${two}`, as(cara))).lock, null);
  await ok('POST', `learn/lessons/${two}/complete`, as(cara), { contentId: c2 });
  assert.deepStrictEqual((await ok('GET', 'learn/programmes/ocr-referee', as(cara))).locked, []);
});

test('a lesson\'s test can be taken again until every answer is right; every try is kept, and assessors see each person\'s record', { skip }, async () => {
  // the first try (one wrong) was in the test before: this is the second, all right
  const r = await ok('POST', `learn/lessons/${lessonId}/checks`, as(learner), { answers: [{ key: 'ocr-1-1.1', choice: 0 }, { key: 'ocr-1-1.2', choice: 1 }] });
  assert.strictEqual(r.attemptNo, 2); assert.strictEqual(r.passed, true);
  assert.deepStrictEqual((await ok('GET', `learn/lessons/${lessonId}`, as(learner))).extra.tests, { attempts: 2, passed: true });
  const d = await ok('GET', 'learn/assessing/lesson-tests', boss);
  const me = d.people.find((p) => p.id === learner.id);
  assert.ok(me, 'the learner is in the assessors\' overview');
  assert.deepStrictEqual(me.lessons[0].tries.map((x) => [x.no, x.right, x.of, x.passed]), [[1, 1, 2, false], [2, 2, 2, true]]);
  assert.strictEqual(me.lessons[0].firstTime, false); assert.strictEqual(me.lessons[0].triesToPass, 2);
  const s = me.summary;
  assert.deepStrictEqual({ lessons: s.lessons, passed: s.passed, firstTime: s.firstTime, tries: s.tries, answersRight: s.answersRight }, { lessons: 1, passed: 1, firstTime: 0, tries: 2, answersRight: 75 });
  // a learner can't see everyone's
  assert.strictEqual((await call('GET', 'learn/assessing/lesson-tests', as(learner))).status, 403);
  // by default a lesson counts as done only once a try has every answer right
  const p = (await ok('PUT', 'learn/programmes/ocr-referee', boss, { lessonsNeedPass: true })).programme;
  assert.strictEqual(p.lessonsNeedPass, true);
  const dana = (await ok('POST', 'learn/people', boss, { legalName: 'Dana Novak', email: 'dana@demo.test', regionId: 'europe' })).person;
  await ok('POST', 'learn/enrolments', as(dana), { programmeId: 'ocr-referee' });
  assert.strictEqual((await ok('GET', `learn/lessons/${lessonId}`, as(dana))).extra.passRequired, true);
  await ok('POST', `learn/lessons/${lessonId}/checks`, as(dana), { answers: [{ key: 'ocr-1-1.1', choice: 0 }, { key: 'ocr-1-1.2', choice: 0 }] });
  const notYet = await call('POST', `learn/lessons/${lessonId}/complete`, as(dana), { contentId });
  assert.strictEqual(notYet.status, 409); assert.match(notYet.body.error, /every answer/);
  await ok('POST', `learn/lessons/${lessonId}/checks`, as(dana), { answers: [{ key: 'ocr-1-1.1', choice: 0 }, { key: 'ocr-1-1.2', choice: 1 }] });
  await ok('POST', `learn/lessons/${lessonId}/complete`, as(dana), { contentId });
});
