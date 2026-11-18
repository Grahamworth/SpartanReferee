'use strict';
// Lessons (step 3), against the real database in its own schema (learn_test), made fresh and dropped after.
//   source scripts/learn-env.sh && cd api && npm run test:sql
const test = require('node:test');
const assert = require('node:assert');
const { createApi } = require('../../src/core');
const { memoryStore } = require('../../src/store');
const { dbFromEnv } = require('../../src/learn/db');

const db = dbFromEnv(process.env, 'learn_test');
const skip = !db && 'LEARN_SQL_* not set (source scripts/learn-env.sh)';
let api, boss, lessonId, learner, editor, owner;
const login = async (who) => ({ 'x-session': (await api.handle({ method: 'POST', path: 'auth/google', body: { idToken: who } })).body.token });
const call = async (method, path, headers, body) => api.handle({ method, path, headers, body });
const ok = async (method, path, headers, body) => { const r = await call(method, path, headers, body); assert.strictEqual(r.status, 200, `${method} ${path}: ${JSON.stringify(r.body)}`); return r.body; };
const as = (p) => ({ ...boss, 'x-learn-as': p.id });
const SLIDES = [{ heading: 'One throw', points: ['A miss is a fail'], narration: 'Each athlete gets one throw.', rules: ['OCR-2026-4.2.13'] }, { heading: 'The penalty', points: ['30 burpees'], narration: 'Thirty burpees.' }];

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
  editor = await person('Claire Martin', [{ role: 'content_editor', programmeId: 'ocr-referee' }]);
  owner = await person('Paul Owner', [{ role: 'programme_owner', programmeId: 'ocr-referee' }]);
  learner = await person('Ben Taylor');
  const made = await ok('POST', 'learn/programmes', boss, { id: 'ocr-referee', title: 'OCR Referee', category: 'referee', locales: 'en,es', edition: '2027' });
  const m = (await ok('POST', `learn/versions/${made.versionId}/modules`, boss, { title: 'Obstacle Types' })).modules[0];
  lessonId = (await ok('POST', `learn/modules/${m.id}/lessons`, boss, { title: 'Spear Throw' })).lessonId;
  await ok('POST', `learn/modules/${m.id}/lessons`, boss, { title: 'Still being written' });
  await ok('POST', `learn/versions/${made.versionId}/state`, boss, { to: 'review' });
  await ok('POST', `learn/versions/${made.versionId}/state`, boss, { to: 'published' });
  await ok('POST', 'learn/enrolments', as(learner), { programmeId: 'ocr-referee' });
});
test.after(async () => { if (!skip) { await db.dropSchema(); await db.close(); } });

test('content is written by an editor, approved by someone else, and never changes once published (CNT-01, PRG-05)', { skip }, async () => {
  const c = (await ok('POST', `learn/lessons/${lessonId}/content`, as(editor), { locale: 'en', slides: SLIDES, sources: 'Rules of Competition 2026, 4.2.13' })).content;
  assert.strictEqual(c.state, 'draft'); assert.strictEqual(c.versionNo, 1); assert.match(c.sourceHash, /^[0-9a-f]{64}$/);
  assert.strictEqual((await call('GET', `learn/lessons/${lessonId}`, as(learner))).body.content, null, 'learners don\'t see a draft');
  assert.strictEqual((await call('POST', `learn/lessons/${lessonId}/content`, as(learner), { locale: 'en', slides: SLIDES })).status, 403);
  await ok('POST', `learn/content/${c.id}/state`, as(editor), { to: 'review' });
  assert.strictEqual((await call('POST', `learn/content/${c.id}/state`, as(editor), { to: 'published' })).status, 403, 'an editor never approves');
  await ok('POST', `learn/content/${c.id}/state`, as(owner), { to: 'published' });
  assert.strictEqual((await call('PUT', `learn/content/${c.id}`, as(editor), { slides: SLIDES })).status, 409, 'published content never changes');
  const seen = await ok('GET', `learn/lessons/${lessonId}`, as(learner));
  assert.strictEqual(seen.content.id, c.id); assert.strictEqual(seen.content.slides.length, 2); assert.strictEqual(seen.media.kind, 'browser', 'no Azure narration in tests: the device reads it');
});

test('a Spanish translation in review is shown as a preview; switching language keeps the same lesson and rules (AT-05, NFR-06)', { skip }, async () => {
  const es = (await ok('POST', `learn/lessons/${lessonId}/content`, as(editor), { locale: 'es', slides: SLIDES.map((s) => ({ ...s, heading: `ES ${s.heading}` })), translatedBy: 'Claude (machine translation), not reviewed' })).content;
  assert.ok(es.translationOf, 'it records the English it translates');
  assert.strictEqual((await call('POST', `learn/lessons/${lessonId}/content`, as(editor), { locale: 'fr', slides: SLIDES })).status, 400, 'not one of the programme\'s languages');
  await ok('POST', `learn/content/${es.id}/state`, as(editor), { to: 'review' });
  const en = await ok('GET', `learn/lessons/${lessonId}?locale=en`, as(learner));
  const sp = await ok('GET', `learn/lessons/${lessonId}?locale=es`, as(learner));
  assert.deepStrictEqual(en.locales.map((l) => [l.locale, l.state, l.preview]), [['en', 'published', false], ['es', 'review', true]]);
  assert.strictEqual(sp.content.locale, 'es'); assert.strictEqual(sp.content.preview, true); assert.strictEqual(sp.content.translatedBy, 'Claude (machine translation), not reviewed');
  assert.deepStrictEqual(sp.content.slides[0].rules, en.content.slides[0].rules, 'the same rule references underneath');
  assert.strictEqual(sp.lesson.id, en.lesson.id);
});

test('completing records the exact lesson, programme version, content version and language; a preview doesn\'t count (AT-04, LRN-07, NFR-05)', { skip }, async () => {
  const sp = await ok('GET', `learn/lessons/${lessonId}?locale=es`, as(learner));
  const r1 = await ok('POST', `learn/lessons/${lessonId}/complete`, as(learner), { contentId: sp.content.id });
  assert.strictEqual(r1.preview, true);
  const row = (await db.query('SELECT * FROM {S}.completion WHERE lesson_id = @l', { l: lessonId }))[0];
  assert.strictEqual(row.locale, 'es'); assert.strictEqual(row.preview, true); assert.strictEqual(row.content_version, 1);
  assert.strictEqual(row.content_id.toLowerCase(), sp.content.id.toLowerCase()); assert.strictEqual(row.source_hash, sp.content.sourceHash);
  assert.strictEqual(row.version_id.toLowerCase(), sp.version.id.toLowerCase());
  const en = await ok('GET', `learn/lessons/${lessonId}?locale=en`, as(learner));
  await ok('POST', `learn/lessons/${lessonId}/complete`, as(learner), { contentId: en.content.id });
  const counting = await db.query('SELECT * FROM {S}.completion WHERE lesson_id = @l AND preview = 0', { l: lessonId });
  assert.strictEqual(counting.length, 1); assert.strictEqual(counting[0].locale, 'en');
  // progress counts lessons with content only: the one still being written doesn't count
  const prog = await ok('GET', 'learn/programmes/ocr-referee', as(learner));
  assert.deepStrictEqual(prog.progress, { done: 1, total: 1 });
  assert.ok(Object.values(prog.lessonNotes).includes('being written'));
  // nobody else's, and only when enrolled
  assert.strictEqual((await call('POST', `learn/lessons/${lessonId}/complete`, as(editor), { contentId: en.content.id })).status, 403);
  const audit = await ok('GET', 'learn/audit?entityType=completion', boss);
  assert.ok(audit.events.length >= 2);
});

test('the bookmark keeps your place in a lesson (LRN-05)', { skip }, async () => {
  const en = await ok('GET', `learn/lessons/${lessonId}?locale=en`, as(learner));
  await ok('PUT', `learn/lessons/${lessonId}/progress`, as(learner), { contentId: en.content.id, slide: 1 });
  assert.deepStrictEqual((await ok('GET', `learn/lessons/${lessonId}`, as(learner))).progress, { contentId: en.content.id, slide: 1, locale: 'en' });
});

test('swapping the media provider is configuration only: completions are untouched (AT-11, LRN-04)', { skip }, async () => {
  const before = await db.query('SELECT * FROM {S}.completion ORDER BY completed_at');
  const cols = Object.keys(before[0]).sort();
  assert.strictEqual((await call('PUT', 'learn/media/ocr-referee', as(learner), { provider: 'text-only' })).status, 403);
  await ok('PUT', 'learn/media/ocr-referee', boss, { provider: 'text-only' });
  assert.strictEqual((await ok('GET', `learn/lessons/${lessonId}`, as(learner))).media.kind, 'text');
  await ok('PUT', 'learn/media/ocr-referee', boss, { provider: 'browser-voice', voices: { en: 'en-GB-SoniaNeural', es: 'nonsense' } });
  const m = (await ok('GET', `learn/lessons/${lessonId}`, as(learner))).media;
  assert.strictEqual(m.kind, 'browser'); assert.strictEqual(m.voice, 'en-GB-SoniaNeural');
  const after = await db.query('SELECT * FROM {S}.completion ORDER BY completed_at');
  assert.deepStrictEqual(Object.keys(after[0]).sort(), cols, 'the same columns');
  assert.deepStrictEqual(after.map((r) => [r.completion_id, r.content_id, r.locale]), before.map((r) => [r.completion_id, r.content_id, r.locale]), 'the same completions');
  assert.ok((await ok('GET', 'learn/audit?entityType=media_config', boss)).events.length >= 2, 'audited');
});
