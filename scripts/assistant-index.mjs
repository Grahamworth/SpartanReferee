// Builds the Assistant's knowledge (21 November 2026): every section of the 2026 Rules of Competition and Officiating SOP (from Rules,
// rule_ref.body), every obstacle (learn/obstacles.js) and every slide of every published English lesson, each with the place in the app
// it comes from, turned into vectors by the "embed" model ahead of time, so a question only has to find the closest passages.
// Assessment questions are left out on purpose, so the Assistant can't hand out the answers to a test.
// Each passage also lists the pictures, videos and animations that go with it (media: an obstacle's animation and demonstration video,
// the burpee animation for the burpee rules, a lesson slide's picture, video or drawing), so the Assistant can show them in the chat.
// The index holds Spartan's rule text, so it goes into the storage account's private "assistant" container (never git, never the
// public site), as assistant/<schema>/index.json; the API reads it from there. Run it again after the rules or lessons change.
//   source scripts/learn-env.sh && node scripts/assistant-index.mjs [schema]      (default learn_dev; learn for the live site)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { dbFromEnv } = require('../api/src/learn/db.js');
const { createAi, costOf } = require('../api/src/assistant-ai.js');
const { blobSigner } = require('../api/src/recordings.js');

const schema = process.argv[2] || 'learn_dev';
const db = dbFromEnv(process.env, schema);
const ai = createAi({ endpoint: process.env.ASSISTANT_ENDPOINT, key: process.env.ASSISTANT_KEY, model: process.env.ASSISTANT_MODEL, embedModel: process.env.ASSISTANT_EMBED });
const sign = blobSigner(process.env.STORAGE_CONNECTION || '', 'assistant');
if (!db || !ai || !sign) { console.log('Settings missing: source scripts/learn-env.sh first'); process.exit(2); }

const chunks = [];
const add = (c) => { if (c.text && c.text.trim()) chunks.push({ ...c, text: c.text.replace(/[ \t]+/g, ' ').trim() }); };
// a long section is cut into overlapping parts, so each part's vector is about one thing
const parts = (text, size = 2400) => {
  if (text.length <= size) return [text];
  const out = []; let at = 0;
  while (at < text.length) { let end = Math.min(text.length, at + size); if (end < text.length) { const cut = text.lastIndexOf('. ', end); if (cut > at + size / 2) end = cut + 1; } out.push(text.slice(at, end)); if (end >= text.length) break; at = Math.max(end - 300, at + 1); }
  return out;
};

// ---- the rulebook and SOP, section by section (Rules)
const rules = await db.query(`SELECT r.rule_id, r.section, r.title, r.excerpt, r.body, r.chapter, r.citation, d.title AS doc_title FROM {S}.rule_ref r
  JOIN {S}.rule_document d ON d.doc_id = r.doc_id WHERE r.state = 'approved'`);
for (const r of rules) {
  const text = r.body || r.excerpt;
  for (const [i, p] of parts(text).entries()) {
    add({ id: `rule:${r.rule_id}:${i}`, kind: 'rule', ref: r.rule_id, title: `${r.doc_title} ${r.section}: ${r.title}`, link: `#/rules/${encodeURIComponent(r.rule_id)}`,
      text: `${r.doc_title}, section ${r.section}${r.chapter ? ` (${r.chapter})` : ''}: ${r.title}\n${p}` });
  }
}
// open review items: where the 2026 sources disagree, so the Assistant says so instead of picking one
const disputes = await db.query("SELECT title, detail, rule_id FROM {S}.review_item WHERE state = 'open' AND kind = 'dispute'").catch(() => []);
for (const [i, d] of disputes.entries()) add({ id: `dispute:${i}`, kind: 'dispute', ref: d.rule_id, title: `Under review: ${d.title}`, link: d.rule_id ? `#/rules/${encodeURIComponent(d.rule_id)}` : '#/reviews', text: `Open review item (the 2026 sources disagree, the officiating lead hasn't ruled yet): ${d.title}. ${d.detail || ''}` });

// ---- the obstacles (learn/obstacles.js): read as data, without its page code
const src = fs.readFileSync(path.join(ROOT, 'learn/obstacles.js'), 'utf8');
const literal = (name) => { const at = src.indexOf(`export const ${name} = [`); const end = src.indexOf('\n];', at); return new Function(`return ${src.slice(src.indexOf('[', at), end + 2)}`)(); };
const typeText = { multi: 'Pass/fail, multiple attempts: the athlete may try as often as they like; giving up means the penalty.', single: 'Pass/fail, one attempt: a fail means the penalty straight away.', must: 'Mandatory: it has to be completed; failing it means disqualification, or a time penalty if the race director decides.' };
const obstacles = literal('OBSTACLES'), general = literal('GENERAL');
// the animations there are (learn/slide-visual.js ANIMS: every obstacle's, and the burpee) and the lesson drawings worth showing
const vsrc = fs.readFileSync(path.join(ROOT, 'learn/slide-visual.js'), 'utf8'), va = vsrc.indexOf('export const ANIMS = [');
const ANIMS = new Map(new Function(`return ${vsrc.slice(vsrc.indexOf('[', va), vsrc.indexOf(']];', va) + 2)}`)());
const FIGURES = new Set(['lane', 'barrier', 'release', 'target', 'distance', 'burpee', 'wall', 'loop']);
const anim = (id, title) => (ANIMS.has(id) ? { id: `anim:${id}`, type: 'anim', src: id, title } : null);
const obstacleMedia = (o) => [anim(o.id, `${o.title}: the good run and the fails, animated`), o.video ? { id: `youtube:${o.video}`, type: 'youtube', src: o.video, title: `${o.title}: demonstration video` } : null].filter(Boolean);
const BURPEE = anim('burpee', 'The burpee standard, animated');
const bySection = new Map(obstacles.filter((o) => o.section).map((o) => [o.section, o]));
for (const o of obstacles) {
  add({ id: `obstacle:${o.id}`, kind: 'obstacle', ref: o.id, title: `Obstacle: ${o.title}`, link: `#/obstacles/${o.id}`, media: obstacleMedia(o),
    text: [`Obstacle: ${o.title}${o.section ? ` (rule ${o.section})` : ''}. ${typeText[o.type] || ''}`, `How it's done: ${(o.how || []).join(' ')}`,
      `Pass (it counts): ${(o.good || []).join(' ')}`, `Fail: ${(o.bad || []).join(' ')}`, o.note ? `Note: ${o.note}` : ''].filter(Boolean).join('\n') });
}
add({ id: 'obstacle:general', kind: 'obstacle', ref: 'general', title: 'Rules at every obstacle', link: '#/obstacles', text: `At every obstacle: ${general.map(([t, id]) => `${t} (${id})`).join(' ')}` });

// ---- the published English lessons, slide by slide
const lessons = await db.query(`SELECT l.lesson_id, l.title, m.title AS module, p.title AS programme, c.body FROM {S}.content_version c
  JOIN {S}.lesson l ON l.lesson_id = c.lesson_id JOIN {S}.module m ON m.module_id = l.module_id JOIN {S}.programme_version v ON v.version_id = l.version_id
  JOIN {S}.programme p ON p.programme_id = v.programme_id WHERE c.locale = 'en' AND c.state = 'published' AND v.state = 'published'`);
for (const l of lessons) {
  let slides = []; try { slides = JSON.parse(l.body).slides || []; } catch { /* not a slide lesson */ }
  slides.forEach((s, i) => {
    const text = [s.heading, ...(s.points || []), s.narration, s.text].filter((x) => typeof x === 'string' && x.trim()).join('\n');
    const name = `${l.title}${s.heading ? `: ${s.heading}` : ''}`, m = s.media;
    const media = m && ['image', 'video', 'youtube', 'anim'].includes(m.type) && m.src ? [m.type === 'anim' ? anim(m.src, `${ANIMS.get(m.src) || name}, animated`) : { id: `${m.type}:${m.src}`, type: m.type, src: m.src, title: `${name} (${m.type === 'image' ? 'picture' : 'video'})` }].filter(Boolean)
      : FIGURES.has(s.figure) ? [{ id: `figure:${s.figure}`, type: 'figure', src: s.figure, title: `${name} (drawing)` }] : [];
    add({ id: `lesson:${l.lesson_id}:${i}`, kind: 'lesson', ref: l.lesson_id, title: `Lesson: ${l.title} (${l.programme} › ${l.module}), slide ${i + 1}${s.heading ? `: ${s.heading}` : ''}`,
      link: `#/lesson/${l.lesson_id}`, ...(media.length ? { media } : {}), text: `${l.programme} › ${l.module} › lesson "${l.title}", slide ${i + 1}\n${text}` });
  });
}
await db.close();

// a rule's media: the obstacle it's about (its section number), or the burpee for the burpee rules
for (const c of chunks) {
  if (c.kind !== 'rule' && c.kind !== 'dispute') continue;
  const o = bySection.get(String(c.ref || '').replace(/^OCR-\d{4}-/, ''));
  const m = [...(o ? obstacleMedia(o) : []), /burpee/i.test(c.title) && BURPEE ? BURPEE : null].filter(Boolean);
  if (m.length) c.media = m;
}

// ---- vectors, ahead of time
const { vectors, tokens } = await ai.embed(chunks.map((c) => `${c.title}\n${c.text}`.slice(0, 8000)));
const index = { builtAt: new Date().toISOString(), schema, model: process.env.ASSISTANT_EMBED || 'embed', dims: vectors[0].length,
  chunks: chunks.map((c, i) => ({ ...c, v: Buffer.from(vectors[i].buffer).toString('base64') })) };
const json = JSON.stringify(index);
const url = sign({ blob: `${schema}/index.json`, perm: 'cw', minutes: 30 });
const put = await fetch(url, { method: 'PUT', headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'application/json' }, body: json });
if (!put.ok) throw new Error(`Saving the index failed: ${put.status} ${await put.text()}`);
const kinds = chunks.reduce((m, c) => ({ ...m, [c.kind]: (m[c.kind] || 0) + 1 }), {});
console.log(`with media: ${chunks.filter((c) => c.media?.length).length} passages, ${new Set(chunks.flatMap((c) => (c.media || []).map((m) => m.id))).size} different pictures, videos and animations`);
console.log(`${schema}: ${chunks.length} passages (${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')}), ${(json.length / 1e6).toFixed(1)} MB, embedding cost £${costOf({ prompt_tokens: tokens }, 'text-embedding-3-small').toFixed(4)}`);
