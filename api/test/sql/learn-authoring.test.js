'use strict';
// Programs (authoring.js): editing a programme in place as drafts, and a programme owner publishing them, against the real database
// in its own schema (learn_test).   source scripts/learn-env.sh && cd api && npm run test:sql
const test = require('node:test');
const assert = require('node:assert');
const { createApi } = require('../../src/core');
const { memoryStore } = require('../../src/store');
const { dbFromEnv } = require('../../src/learn/db');

const db = dbFromEnv(process.env, 'learn_test');
const skip = !db && 'LEARN_SQL_* not set (source scripts/learn-env.sh)';
let api, boss, editor, owner, referee, lessons;
const login = async (who) => ({ 'x-session': (await api.handle({ method: 'POST', path: 'auth/google', body: { idToken: who } })).body.token });
const call = async (method, path, headers, body) => api.handle({ method, path, headers, body });
const ok = async (method, path, headers, body) => { const r = await call(method, path, headers, body); assert.strictEqual(r.status, 200, `${method} ${path}: ${JSON.stringify(r.body)}`); return r.body; };
const slides = (heading) => [{ heading, points: ['First point', 'Second point'], narration: 'Spoken words', figure: 'camera' }];
const checks = [{ prompt: 'Which is right?', options: ['This one', 'That one'], answer: 1, feedback: 'Because.' }];

test.before(async () => {
  if (skip) return;
  await db.dropSchema();
  api = createApi({ store: memoryStore(), secret: 'test-secret-test-secret-test-secret', googleClientId: 'x', adminEmails: ['boss@example.com'],
    verifyGoogle: async (t) => ({ sub: t, email: `${t}@example.com`, name: t }), learnDb: db });
  await db.migrate();
  boss = await login('boss');
  await ok('GET', 'learn/me', boss);
  const made = await ok('POST', 'learn/programmes', boss, { id: 'ocr-referee', title: 'OCR Referee', category: 'referee', locales: 'en,fr', edition: '2027' });
  const m = (await ok('POST', `learn/versions/${made.versionId}/modules`, boss, { title: 'Obstacles' })).modules[0];
  await ok('POST', `learn/modules/${m.id}/lessons`, boss, { title: 'Spear Throw' });
  const after = await ok('POST', `learn/modules/${m.id}/lessons`, boss, { title: 'Rope Climb' });
  lessons = after.modules[0].lessons.map((l) => l.id);
  await ok('POST', `learn/versions/${made.versionId}/state`, boss, { to: 'review' });
  await ok('POST', `learn/versions/${made.versionId}/state`, boss, { to: 'published' });
  // a content editor, a programme owner and a referee (invented people the admin acts as)
  await db.query("INSERT INTO {S}.region (region_id, name, countries) VALUES ('europe', 'Europe', 'GB,FR')");
  const person = async (name, roles = []) => { const p = (await ok('POST', 'learn/people', boss, { legalName: name, email: `${name.split(' ')[0].toLowerCase()}@demo.test`, regionId: 'europe' })).person; for (const r of roles) await ok('POST', 'learn/roles', boss, { personId: p.id, ...r }); return { ...boss, 'x-learn-as': p.id }; };
  editor = await person('Ed Editor', [{ role: 'content_editor', programmeId: 'ocr-referee' }]);
  owner = await person('Olive Owner', [{ role: 'programme_owner', programmeId: 'ocr-referee' }]);
  referee = await person('Rita Referee');
});
test.after(async () => { if (!skip) { await db.dropSchema(); await db.close(); } });

test('an editor\'s changes are a draft: learners see nothing until a programme owner publishes, and only owners and admins can', { skip }, async () => {
  const list = await ok('GET', 'learn/authoring', editor);
  assert.deepStrictEqual(list.programmes.map((p) => p.id), ['ocr-referee']);
  assert.strictEqual((await call('GET', 'learn/authoring', referee)).body.programmes.length, 0, 'a referee changes nothing');
  await ok('PUT', `learn/authoring/lessons/${lessons[0]}/en`, editor, { slides: slides('Spear throw basics'), checks });
  // saving again updates the same draft
  await ok('PUT', `learn/authoring/lessons/${lessons[0]}/en`, editor, { slides: slides('Spear throw: the basics'), checks });
  assert.strictEqual((await db.query("SELECT COUNT(*) AS n FROM {S}.content_version WHERE lesson_id = @l AND state = 'draft'", { l: lessons[0] }))[0].n, 1);
  const p = await ok('GET', 'learn/authoring/ocr-referee', editor);
  assert.strictEqual(p.drafts, 1); assert.strictEqual(p.can.publish, false);
  assert.strictEqual((await db.query("SELECT COUNT(*) AS n FROM {S}.content_version WHERE lesson_id = @l AND state = 'published'", { l: lessons[0] }))[0].n, 0, 'nothing published yet');
  assert.strictEqual((await call('POST', 'learn/authoring/ocr-referee/publish', editor)).status, 403, 'an editor can\'t publish');
  const r = await ok('POST', 'learn/authoring/ocr-referee/publish', owner);
  assert.strictEqual(r.published, 1);
  const pub = (await db.query("SELECT body FROM {S}.content_version WHERE lesson_id = @l AND state = 'published'", { l: lessons[0] }))[0];
  assert.strictEqual(JSON.parse(pub.body).slides[0].heading, 'Spear throw: the basics');
  assert.strictEqual(JSON.parse(pub.body).slides[0].figure, 'camera');
  const k = await db.query('SELECT * FROM {S}.lesson_check WHERE lesson_id = @l', { l: lessons[0] });
  assert.strictEqual(k.length, 1); assert.strictEqual(JSON.parse(k[0].body).answer, 1, 'the quick check is the published one');
  assert.strictEqual((await ok('GET', 'learn/authoring/ocr-referee', editor)).drafts, 0);
});

test('a translation gives the same slides and questions in its words; empty lines keep the English; the right answer stays the English one', { skip }, async () => {
  const key = (await db.query('SELECT check_key FROM {S}.lesson_check WHERE lesson_id = @l', { l: lessons[0] }))[0].check_key;
  const view = await ok('GET', `learn/authoring/lessons/${lessons[0]}?locale=fr`, editor);
  assert.strictEqual(view.locale, 'fr'); assert.strictEqual(view.english.slides[0].heading, 'Spear throw: the basics'); assert.strictEqual(view.draft, null);
  await ok('PUT', `learn/authoring/lessons/${lessons[0]}/fr`, editor, { slides: slides('Le lancer de javelot'), checks: [{ key, prompt: 'Laquelle est juste ?', options: ['Celle-ci', ''], answer: 0 }, { key: '', prompt: '' }] });
  await ok('POST', 'learn/authoring/ocr-referee/publish', boss);
  const fr = (await db.query("SELECT * FROM {S}.content_version WHERE lesson_id = @l AND locale = 'fr' AND state = 'published'", { l: lessons[0] }))[0];
  assert.ok(fr.translation_of, 'it points at the English it translates');
  const body = JSON.parse((await db.query('SELECT body FROM {S}.lesson_check WHERE lesson_id = @l', { l: lessons[0] }))[0].body);
  assert.strictEqual(body.tr.fr.prompt, 'Laquelle est juste ?'); assert.strictEqual(body.answer, 1, 'the English answer stands');
  assert.deepStrictEqual(body.tr.fr.options, ['Celle-ci', '']);
  assert.strictEqual(body.prompt, 'Which is right?');
});

test('the lesson order waits as a draft too, and only a real reordering of the same lessons is accepted', { skip }, async () => {
  const p = await ok('GET', 'learn/authoring/ocr-referee', editor), m = p.modules[0];
  assert.deepStrictEqual(m.lessons.map((l) => l.id), lessons);
  assert.strictEqual((await call('PUT', 'learn/authoring/ocr-referee/order', editor, { modules: [{ id: m.id, lessons: [lessons[0]] }] })).status, 400, 'every lesson, once');
  const r = await ok('PUT', 'learn/authoring/ocr-referee/order', editor, { modules: [{ id: m.id, lessons: [lessons[1], lessons[0]] }] });
  assert.ok(r.order);
  const live = await ok('GET', 'learn/programmes/ocr-referee', boss);
  assert.deepStrictEqual(live.modules[0].lessons.map((l) => l.id), lessons, 'learners still have the old order');
  await ok('POST', 'learn/authoring/ocr-referee/publish', owner);
  const now = await ok('GET', 'learn/programmes/ocr-referee', boss);
  assert.deepStrictEqual(now.modules[0].lessons.map((l) => l.id), [lessons[1], lessons[0]]);
});

test('drafts can be thrown away; bad questions are refused with a reason', { skip }, async () => {
  const bad = await call('PUT', `learn/authoring/lessons/${lessons[1]}/en`, editor, { slides: slides('Rope'), checks: [{ prompt: 'Only one answer?', options: ['Yes'], answer: 0 }] });
  assert.strictEqual(bad.status, 400); assert.match(bad.body.error, /at least 2 answers/);
  await ok('PUT', `learn/authoring/lessons/${lessons[1]}/en`, editor, { slides: slides('Rope climb') });
  assert.strictEqual((await ok('DELETE', `learn/authoring/lessons/${lessons[1]}/en`, editor)).discarded, 1);
  assert.strictEqual((await ok('GET', 'learn/authoring/ocr-referee', editor)).drafts, 0);
  await ok('PUT', `learn/authoring/lessons/${lessons[1]}/en`, editor, { slides: slides('Rope climb') });
  assert.strictEqual((await ok('POST', 'learn/authoring/ocr-referee/discard', editor)).discarded, 1);
  assert.strictEqual((await call('POST', 'learn/authoring/ocr-referee/publish', owner)).status, 400, 'nothing to publish');
});
