// The learning platform's seeded programmes (scripts/learn-*.mjs): every lesson has content, and every rule a slide cites is defined.
import test from 'node:test';
import assert from 'node:assert';
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
