// The learning platform's seeded programmes (scripts/learn-*.mjs): every lesson has content, and every rule a slide cites is defined.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { PROGRAMMES } from '../scripts/learn-content.mjs';
import { LESSONS, TRANSLATIONS } from '../scripts/learn-lessons.mjs';
import { RULES, DISPUTES } from '../scripts/learn-rules.mjs';

test('the OCR programme is complete: all 22 lessons have English content, ending on a summary', () => {
  const ocr = PROGRAMMES.find((p) => p.id === 'ocr-referee');
  const keys = ocr.modules.flatMap((m) => m.lessons.map((l) => l.key));
  assert.strictEqual(keys.length, 22);
  assert.deepStrictEqual(keys.filter((k) => !LESSONS[k]?.en?.length), []);
  for (const k of keys) assert.ok(LESSONS[k].sources, `${k} names its sources`);
});
test('every rule a lesson cites is a defined rule reference, ids are unique, and disputes point at defined rules', () => {
  const ids = RULES.map((r) => r.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'no rule twice');
  for (const [k, l] of Object.entries(LESSONS)) for (const s of l.en) for (const r of s.rules || []) assert.ok(ids.includes(r), `${k} cites ${r}`);
  for (const d of DISPUTES) assert.ok(ids.includes(d.rule), `dispute ${d.title}`);
  assert.strictEqual(new Set(DISPUTES.map((d) => d.title)).size, DISPUTES.length, 'no dispute twice');
});
test('lesson text: no dashes, and a disagreement is flagged as under review rather than settled', () => {
  for (const [k, l] of Object.entries(LESSONS)) for (const s of l.en) {
    assert.doesNotMatch([s.heading, ...s.points, s.narration].join(' '), /[–—]/, `${k}: ${s.heading}`);
    if (s.review) assert.match(s.review, /^(Under review for 2027|En revisión para 2027): /, `${k}: ${s.heading}`);
  }
});
test('every lesson is in all 14 other languages, slide for slide and point for point with its English', () => {
  assert.deepStrictEqual(Object.keys(TRANSLATIONS).sort(), ['ar', 'cs', 'da', 'de', 'el', 'es', 'fi', 'fr', 'hr', 'it', 'nl', 'pl', 'sv', 'th']);
  for (const [loc, lessons] of Object.entries(TRANSLATIONS)) for (const [k, l] of Object.entries(LESSONS)) {
    const t = lessons[k]; assert.ok(t, `${loc} ${k}`);
    assert.strictEqual(t.length, l.en.length, `${loc} ${k} slides`);
    t.forEach((s, i) => { assert.strictEqual(s.points.length, l.en[i].points.length, `${loc} ${k} slide ${i + 1}`); assert.strictEqual(!!s.review, !!l.en[i].review, `${loc} ${k} slide ${i + 1} review`); assert.ok(s.heading && s.narration); });
  }
});
test('every lesson but the DEKA placeholder has a quick check: 2 or 3 questions, one right answer each, citing only rules its slides cite', async () => {
  const fs = await import('node:fs');
  const CHECKS = JSON.parse(fs.readFileSync(new URL('../scripts/learn-checks.json', import.meta.url), 'utf8'));
  assert.deepStrictEqual(Object.keys(CHECKS).sort(), Object.keys(LESSONS).filter((k) => !k.startsWith('deka')).sort());
  for (const [k, qs] of Object.entries(CHECKS)) {
    assert.ok(qs.length >= 2 && qs.length <= 3, k);
    const cited = new Set(LESSONS[k].en.flatMap((s) => s.rules || []));
    for (const q of qs) {
      assert.ok(q.options.length >= 3 && q.options.length <= 4 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length, `${k}: ${q.prompt}`);
      assert.strictEqual(new Set(q.options).size, q.options.length, `${k}: options differ`);
      for (const r of q.rules) assert.ok(cited.has(r), `${k} cites ${r}`);
      assert.doesNotMatch([q.prompt, q.feedback, ...q.options].join(' '), /[–—]/, `${k}: ${q.prompt}`);
    }
  }
});

// the Obstacles tab (learn/obstacles.js): every obstacle says how it's done, what's good and what's bad, and links only to rules that exist
test('every obstacle has how, good and bad; ids are unique; its rule references and the "at every obstacle" ones are defined rules', async () => {
  globalThis.location ??= { protocol: 'file:', hostname: '', port: '', hash: '' };
  const { OBSTACLES, LINKED } = await import('../learn/obstacles.js');
  const src = fs.readFileSync(new URL('../learn/obstacles.js', import.meta.url), 'utf8');
  assert.ok(OBSTACLES.length >= 36);
  assert.strictEqual(new Set(OBSTACLES.map((o) => o.id)).size, OBSTACLES.length, 'no obstacle twice');
  const ids = RULES.map((r) => r.id);
  for (const o of OBSTACLES) {
    assert.ok(o.how.length && o.good.length && o.bad.length, o.id);
    assert.ok(['multi', 'single', 'must'].includes(o.type), o.id);
    assert.ok(!o.programme || ['multi', 'single', 'must'].includes(o.programme), o.id);
    assert.ok(o.section ? /^4\.[123]\.\d+$/.test(o.section) : o.id === 'iconic', `${o.id} has its rulebook section`);
    if (o.section) assert.strictEqual(o.section[2], { multi: '1', single: '2', must: '3' }[o.type], `${o.id}: the section's part matches how many tries`);
  }
  for (const s of LINKED) assert.ok(ids.includes(`OCR-2026-${s}`), `rule ${s} is a rule reference`);
  for (const [, r] of src.matchAll(/'(OCR-2026-[\d.]+)'/g)) assert.ok(ids.includes(r), r);
  // the tab is for everyone, next to Rules
  assert.match(fs.readFileSync(new URL('../learn/index.html', import.meta.url), 'utf8'), /data-view="rules"[^\n]*\n\s*<a href="#\/obstacles" data-view="obstacles">Obstacles<\/a>/);
});
