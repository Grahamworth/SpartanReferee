'use strict';
// A slide's picture, video, YouTube video or animation (lessons.js, slidemedia.js), against the real database in its own schema
// (learn_test); storage is stood in for.   source scripts/learn-env.sh && cd api && npm run test:sql
const test = require('node:test');
const assert = require('node:assert');
const { createApi } = require('../../src/core');
const { memoryStore } = require('../../src/store');
const { dbFromEnv } = require('../../src/learn/db');

const db = dbFromEnv(process.env, 'learn_test');
const skip = !db && 'LEARN_SQL_* not set (source scripts/learn-env.sh)';
let api, boss, editor, referee, lesson;
const puts = []; // what was sent to "storage"
const signer = ({ blob, perm }) => `https://store.test/learn-media/${blob}?sig=${perm}`;
const login = async (who) => ({ 'x-session': (await api.handle({ method: 'POST', path: 'auth/google', body: { idToken: who } })).body.token });
const call = (method, path, headers, body) => api.handle({ method, path, headers, body, query: {} });
const ok = async (method, path, headers, body) => { const r = await call(method, path, headers, body); assert.strictEqual(r.status, 200, `${method} ${path}: ${JSON.stringify(r.body)}`); return r.body; };
const slide = (heading, extra = {}) => ({ heading, points: ['A point'], narration: 'Words', figure: 'wall', ...extra });

test.before(async () => {
  if (skip) return;
  await db.dropSchema();
  api = createApi({ store: memoryStore(), secret: 'test-secret-test-secret-test-secret', googleClientId: 'x', adminEmails: ['boss@example.com'],
    verifyGoogle: async (t) => ({ sub: t, email: `${t}@example.com`, name: t }), learnDb: db, learnMedia: signer });
  await db.migrate();
  boss = await login('boss');
  await ok('GET', 'learn/me', boss);
  const made = await ok('POST', 'learn/programmes', boss, { id: 'ocr-referee', title: 'OCR Referee', category: 'referee', locales: 'en,de', edition: '2027' });
  const m = (await ok('POST', `learn/versions/${made.versionId}/modules`, boss, { title: 'Obstacles' })).modules[0];
  lesson = (await ok('POST', `learn/modules/${m.id}/lessons`, boss, { title: 'Walls' })).modules[0].lessons[0].id;
  await ok('POST', `learn/versions/${made.versionId}/state`, boss, { to: 'review' });
  await ok('POST', `learn/versions/${made.versionId}/state`, boss, { to: 'published' });
  await db.query("INSERT INTO {S}.region (region_id, name, countries) VALUES ('europe', 'Europe', 'GB')");
  const person = async (name, roles = []) => { const p = (await ok('POST', 'learn/people', boss, { legalName: name, email: `${name.split(' ')[0].toLowerCase()}@demo.test`, regionId: 'europe' })).person; for (const r of roles) await ok('POST', 'learn/roles', boss, { personId: p.id, ...r }); return { ...boss, 'x-learn-as': p.id }; };
  editor = await person('Ed Editor', [{ role: 'content_editor', programmeId: 'ocr-referee' }]);
  referee = await person('Rita Referee');
  global.fetch = async (url, opts = {}) => { puts.push({ url, ...opts }); return { ok: true, status: 201 }; };
});
test.after(async () => { if (!skip) { await db.dropSchema(); await db.close(); } });

test('a slide keeps an animation, a YouTube video or an uploaded file, and drops anything else', { skip }, async () => {
  const file = '0b6f3c2e-1d2a-4c55-9a3e-2f4b5c6d7e8f.jpg';
  await ok('PUT', `learn/authoring/lessons/${lesson}/en`, editor, { slides: [slide('One', { media: { type: 'anim', src: 'walls' } }), slide('Two', { media: { type: 'youtube', src: 'LvV76-1eYIc' } }),
    slide('Three', { media: { type: 'image', src: file } }), slide('Four', { media: { type: 'image', src: '../../etc/passwd' } }), slide('Five', { media: { type: 'script', src: 'x' } })] });
  await ok('POST', 'learn/authoring/ocr-referee/publish', boss);
  const l = await ok('GET', `learn/lessons/${lesson}`, boss);
  assert.deepStrictEqual(l.content.slides.map((s) => s.media || null), [{ type: 'anim', src: 'walls' }, { type: 'youtube', src: 'LvV76-1eYIc' }, { type: 'image', src: file }, null, null]);
});

test('a translation shows the English slides\' pictures and animations', { skip }, async () => {
  await ok('PUT', `learn/authoring/lessons/${lesson}/de`, editor, { slides: [slide('Eins'), slide('Zwei'), slide('Drei'), slide('Vier'), slide('Fünf')] });
  await ok('POST', 'learn/authoring/ocr-referee/publish', boss);
  const l = await ok('GET', `learn/lessons/${lesson}?locale=de`, boss);
  assert.strictEqual(l.content.locale, 'de');
  assert.strictEqual(l.content.slides[0].heading, 'Eins');
  assert.deepStrictEqual(l.content.slides[0].media, { type: 'anim', src: 'walls' });
  assert.deepStrictEqual(l.content.slides[1].media, { type: 'youtube', src: 'LvV76-1eYIc' });
});

test('an editor uploads a video in pieces; anyone with its link is sent to a short-lived storage link; a referee can\'t upload', { skip }, async () => {
  assert.strictEqual((await call('POST', 'learn/slide-media', referee, { name: 'clip.mp4', size: 1000 })).status, 403);
  assert.strictEqual((await call('POST', 'learn/slide-media', editor, { name: 'notes.exe', size: 1000, programmeId: 'ocr-referee' })).status, 400);
  assert.strictEqual((await call('POST', 'learn/slide-media', editor, { name: 'huge.png', size: 20e6, programmeId: 'ocr-referee' })).status, 413);
  const s = await ok('POST', 'learn/slide-media', editor, { name: 'Clip.MP4', size: 3000, programmeId: 'ocr-referee' });
  assert.match(s.file, /^[0-9a-f-]{36}\.mp4$/); assert.strictEqual(s.kind, 'video');
  puts.length = 0;
  for (const n of [0, 1]) await ok('PUT', `learn/slide-media/${s.file}/${n}`, editor, { data: Buffer.from(`piece ${n}`).toString('base64') });
  const done = await ok('POST', `learn/slide-media/${s.file}/done`, editor, { pieces: 2 });
  assert.deepStrictEqual(done, { file: s.file, type: 'video' });
  assert.strictEqual(puts.length, 3);
  assert.match(puts[0].url, new RegExp(`learn-media/slides/${s.file}\\?sig=cw&comp=block&blockid=`));
  assert.match(puts[2].url, /comp=blocklist$/); assert.match(puts[2].body, /<BlockList><Latest>.+<\/Latest><Latest>.+<\/Latest><\/BlockList>/);
  assert.strictEqual(puts[2].headers['x-ms-blob-content-type'], 'video/mp4');
  const r = await call('GET', `learn/slide-media/${s.file}`, {}); // no sign-in: a <video> can't send one
  assert.strictEqual(r.status, 302); assert.strictEqual(r.headers.Location, `https://store.test/learn-media/slides/${s.file}?sig=r`);
  assert.strictEqual((await call('GET', 'learn/slide-media/..%2Fsecret.mp4', {})).status, 404);
});
