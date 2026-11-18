'use strict';
// Governance (step 5), against the real database in its own schema (learn_test), made fresh and dropped after.
//   source scripts/learn-env.sh && cd api && npm run test:sql
const test = require('node:test');
const assert = require('node:assert');
const { createApi } = require('../../src/core');
const { memoryStore } = require('../../src/store');
const { dbFromEnv } = require('../../src/learn/db');

const db = dbFromEnv(process.env, 'learn_test');
const skip = !db && 'LEARN_SQL_* not set (source scripts/learn-env.sh)';
let api, boss, editor, owner, learner, lessonId, contentId, assessmentId;
const RULE = 'OCR-2026-4.2.13';
const login = async (who) => ({ 'x-session': (await api.handle({ method: 'POST', path: 'auth/google', body: { idToken: who } })).body.token });
const call = async (method, path, headers, body) => api.handle({ method, path, headers, body });
const ok = async (method, path, headers, body) => { const r = await call(method, path, headers, body); assert.strictEqual(r.status, 200, `${method} ${path}: ${JSON.stringify(r.body)}`); return r.body; };
const as = (p) => ({ ...boss, 'x-learn-as': p.id });

test.before(async () => {
  if (skip) return;
  await db.dropSchema();
  api = createApi({ store: memoryStore(), secret: 'test-secret-test-secret-test-secret', googleClientId: 'x', adminEmails: ['boss@example.com'],
    verifyGoogle: async (t) => ({ sub: t, email: `${t}@example.com`, name: t }), learnDb: db });
  await db.migrate();
  await db.query("INSERT INTO {S}.region (region_id, name, countries) VALUES ('europe', 'Europe', 'GB')");
  boss = await login('boss');
  await ok('GET', 'learn/me', boss);
  const person = async (name, roles = []) => { const p = (await ok('POST', 'learn/people', boss, { legalName: name, email: `${name.split(' ')[0].toLowerCase()}@demo.test`, regionId: 'europe' })).person; for (const r of roles) await ok('POST', 'learn/roles', boss, { personId: p.id, ...r }); return p; };
  editor = await person('Claire Martin', [{ role: 'content_editor', programmeId: 'ocr-referee' }]);
  owner = await person('Paul Owner', [{ role: 'programme_owner', programmeId: 'ocr-referee' }]);
  learner = await person('Ben Taylor');
  const made = await ok('POST', 'learn/programmes', boss, { id: 'ocr-referee', title: 'OCR Referee', category: 'referee', locales: 'en,es', edition: '2027' });
  const m = (await ok('POST', `learn/versions/${made.versionId}/modules`, boss, { title: 'Obstacle Types' })).modules[0];
  lessonId = (await ok('POST', `learn/modules/${m.id}/lessons`, boss, { title: 'Spear Throw' })).lessonId;
  assessmentId = (await ok('POST', `learn/versions/${made.versionId}/assessments`, boss, { title: 'Check' })).assessment.id;
  await ok('POST', `learn/assessments/${assessmentId}/questions`, boss, { type: 'single', prompt: 'When does the attempt start?', options: [{ text: 'On release', correct: true }, { text: 'On the draw back' }], rules: RULE });
  await ok('POST', `learn/versions/${made.versionId}/state`, boss, { to: 'review' });
  await ok('POST', `learn/versions/${made.versionId}/state`, boss, { to: 'published' });
  const c = (await ok('POST', `learn/lessons/${lessonId}/content`, as(editor), { locale: 'en', slides: [{ heading: 'One throw', points: ['Released forward: an attempt'], narration: 'One throw.', rules: [RULE] }], sources: 'Rules 2026' })).content;
  await ok('POST', `learn/content/${c.id}/state`, as(editor), { to: 'review' });
  await ok('POST', `learn/content/${c.id}/state`, as(owner), { to: 'published' });
  contentId = c.id;
  await db.query("INSERT INTO {S}.rule_document (doc_id, programme_id, title, edition, approval) VALUES ('ocr-rules-2026', 'ocr-referee', 'Rules of Competition', '2026', 'baseline')");
});
test.after(async () => { if (!skip) { await db.dropSchema(); await db.close(); } });

test('rule references: an editor adds one, it shows as the 2026 baseline, and lessons and questions cite it (RUL-01, RUL-02)', { skip }, async () => {
  assert.strictEqual((await call('POST', 'learn/rules', as(learner), { programmeId: 'ocr-referee', docId: 'ocr-rules-2026', ruleId: RULE })).status, 403);
  assert.strictEqual((await call('POST', 'learn/rules', as(editor), { programmeId: 'ocr-referee', docId: 'ocr-rules-2026', ruleId: 'bad id' })).status, 400);
  const r = await ok('POST', 'learn/rules', as(editor), { programmeId: 'ocr-referee', docId: 'ocr-rules-2026', ruleId: RULE, section: '4.2.13', title: 'Spear Throw', excerpt: 'An attempt once the spear is released in a forward motion.' });
  assert.strictEqual(r.rule.state, 'baseline'); assert.match(r.rule.stateText, /not approved for 2027/);
  assert.deepStrictEqual(r.links.map((l) => l.type).sort(), ['lesson', 'question'], 'what cites it, found from the content and the questions');
  const list = await ok('GET', 'learn/rules?programme=ocr-referee', as(learner));
  assert.strictEqual(list.rules[0].links, 2);
  const lesson = await ok('GET', `learn/lessons/${lessonId}`, as(learner));
  assert.strictEqual(lesson.rules[0].id, RULE);
  // a new reference is a draft until someone else approves it
  assert.strictEqual((await call('POST', `learn/rule-versions/${r.versions[0].key}/state`, as(editor), { to: 'approved' })).status, 403);
  const approved = await ok('POST', `learn/rule-versions/${r.versions[0].key}/state`, as(owner), { to: 'approved' });
  assert.strictEqual(approved.versions[0].ruleState, 'approved');
});

test('a draft rule change flags the lesson and question for review, and changes nothing published (AT-07, RUL-03)', { skip }, async () => {
  const before = await ok('GET', `learn/lessons/${lessonId}`, as(learner));
  assert.strictEqual((await call('POST', `learn/rules/${RULE}/versions`, as(editor), { excerpt: 'x' })).status, 400, 'say what changed');
  const r = await ok('POST', `learn/rules/${RULE}/versions`, as(editor), { excerpt: 'An attempt once the spear is drawn back to throw.', changeNote: '2027 ruling: commitment starts on the draw back' });
  assert.deepStrictEqual(r.versions.map((v) => [v.versionNo, v.ruleState]), [[2, 'draft'], [1, 'approved']]);
  const reviews = (await ok('GET', 'learn/reviews?programme=ocr-referee', as(editor))).reviews;
  assert.strictEqual(reviews.length, 1); assert.strictEqual(reviews[0].kind, 'rule_change');
  assert.deepStrictEqual(reviews[0].affected.map((a) => a.type).sort(), ['lesson', 'question']);
  // published content is exactly as it was, and says it's under review
  const after = await ok('GET', `learn/lessons/${lessonId}`, as(learner));
  assert.strictEqual(after.content.id, before.content.id); assert.strictEqual(after.content.sourceHash, before.content.sourceHash);
  assert.strictEqual(after.extra.reviews.length, 1); assert.strictEqual(after.rules[0].state, 'under_review');
  assert.strictEqual((await call('POST', `learn/rules/${RULE}/versions`, as(editor), { changeNote: 'again' })).status, 409, 'one draft at a time');
});

test('someone other than its author approves a change; review items are closed with a reason (RUL-03, ADM-03)', { skip }, async () => {
  const draft = (await ok('GET', `learn/rules/${RULE}`, as(editor))).versions.find((v) => v.ruleState === 'draft' && v.versionNo === 2);
  assert.strictEqual((await call('POST', `learn/rule-versions/${draft.key}/state`, as(editor), { to: 'approved' })).status, 403, 'editors don\'t approve');
  const r = await ok('POST', `learn/rule-versions/${draft.key}/state`, as(owner), { to: 'approved' });
  assert.strictEqual(r.rule.versionNo, 2); assert.strictEqual(r.rule.excerpt, 'An attempt once the spear is drawn back to throw.');
  const review = (await ok('GET', 'learn/reviews?programme=ocr-referee', as(owner))).reviews[0];
  assert.strictEqual((await call('POST', `learn/reviews/${review.id}`, as(owner), { state: 'resolved' })).status, 400, 'a reason is needed');
  assert.strictEqual((await call('POST', `learn/reviews/${review.id}`, as(editor), { state: 'resolved', resolution: 'x' })).status, 403);
  await ok('POST', `learn/reviews/${review.id}`, as(owner), { state: 'resolved', resolution: 'Lesson and question to be updated in the 2028 draft' });
  assert.strictEqual((await ok('GET', 'learn/reviews?programme=ocr-referee', as(owner))).reviews.length, 0);
  const audit = (await ok('GET', 'learn/audit', boss)).events.map((e) => e.action);
  for (const a of ['rule.create', 'rule.change', 'rule.approved', 'review.resolved']) assert.ok(audit.includes(a), a);
});

test('the handbook: the published programme stamped with edition, language, approval state and date (AT-06, LRN-06)', { skip }, async () => {
  const h = await ok('GET', 'learn/handbook/ocr-referee?locale=en', as(learner));
  assert.strictEqual(h.programme.title, 'OCR Referee'); assert.strictEqual(h.version.edition, '2027'); assert.strictEqual(h.version.state, 'published');
  assert.ok(h.version.effectiveDate && h.generatedAt);
  assert.strictEqual(h.locale, 'en'); assert.strictEqual(h.language.state, 'English master');
  assert.strictEqual(h.sections[0].lessons[0].slides[0].heading, 'One throw');
  assert.strictEqual(h.rules[0].id, RULE);
  const es = await ok('GET', 'learn/handbook/ocr-referee?locale=es', as(learner));
  assert.match(es.language.state, /Not yet translated/, 'no Spanish content: English shown, and it says so');
  assert.ok((await ok('GET', 'learn/audit?entityType=programme_version', boss)).events.some((e) => e.action === 'handbook.download'));
});
