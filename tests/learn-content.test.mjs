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
test("every lesson is in each of its programme's languages, slide for slide and point for point with its English", () => {
  assert.deepStrictEqual(Object.keys(TRANSLATIONS).sort(), ['ar', 'cs', 'da', 'de', 'el', 'es', 'fi', 'fr', 'hr', 'it', 'nl', 'pl', 'sv', 'th']);
  const localesOf = Object.fromEntries(PROGRAMMES.flatMap((p) => p.modules.flatMap((m) => m.lessons.map((l) => [l.key, p.locales.split(',')]))));
  for (const [loc, lessons] of Object.entries(TRANSLATIONS)) for (const [k, l] of Object.entries(LESSONS)) {
    if (!(localesOf[k] || []).includes(loc) && !k.startsWith('deka')) continue;
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

// the obstacle animations (learn/obstacle-scenes.js): every obstacle but the event's own has one, with a good run and at least one fail,
// and every caption is one of that obstacle's own lines (so it's translated with them); every frame poses the figure without gaps
test('every obstacle has an animation whose captions are its own lines, with a good run and a fail', async () => {
  globalThis.location ??= { protocol: 'file:', hostname: '', port: '', hash: '' };
  const { OBSTACLES } = await import('../learn/obstacles.js');
  const { SCENES, MOVEMENTS } = await import('../learn/obstacle-scenes.js');
  const { sample, solve } = await import('../learn/obstacle-anim.js');
  assert.deepStrictEqual(OBSTACLES.filter((o) => !SCENES[o.id]).map((o) => o.id), ['iconic']);
  for (const [id, make] of Object.entries(SCENES)) {
    if (MOVEMENTS.includes(id)) continue;
    const o = OBSTACLES.find((x) => x.id === id), s = make(), lines = [...o.how, ...o.good, ...o.bad, o.note].filter(Boolean);
    assert.ok(o, id);
    assert.ok(s.good.marks.some((m) => !m.kind), `${id}: the good run shows what counts`);
    assert.ok(s.fails.length && s.fails.every((f) => f.marks.some((m) => m.kind === 'bad')), `${id}: each fail shows what goes wrong`);
    for (const tl of [s.good, ...s.fails]) {
      for (const m of tl.marks) assert.ok(lines.includes(m.text), `${id}: "${m.text}" is one of its lines`);
      for (let t = 0; t <= tl.end; t += 0.25) { const st = sample(tl, t); assert.ok(!JSON.stringify(solve(st)).includes('null'), `${id} at ${t}`); assert.strictEqual(typeof s.back(st, new Set(), solve(st), 0), 'string'); }
    }
  }
});

// the demonstration videos and the calls to make (from the 2026 penalty obstacles videos): nine videos, each a YouTube id, on its own obstacle;
// each call has three answers and one right one; the videos play from youtube-nocookie.com with captions in the site's language
test('the obstacle videos and calls to make', async () => {
  globalThis.location ??= { protocol: 'file:', hostname: '', port: '', hash: '' };
  const { OBSTACLES } = await import('../learn/obstacles.js');
  const vids = OBSTACLES.filter((o) => o.video);
  assert.deepStrictEqual(vids.map((o) => o.id).sort(), ['helix', 'mitm', 'multirig', 'olympus', 'stairway', 'tireflip', 'twister', 'tyrolean', 'zwall']);
  for (const o of vids) assert.match(o.video, /^[\w-]{11}$/, o.id);
  for (const o of OBSTACLES.filter((x) => x.call)) { assert.strictEqual(o.call.options.length, 3, o.id); assert.ok(o.call.answer >= 0 && o.call.answer < 3 && o.call.why, o.id); }
  const v = fs.readFileSync(new URL('../learn/video.js', import.meta.url), 'utf8');
  assert.match(v, /youtube-nocookie\.com/); assert.match(v, /cc_load_policy: 1, cc_lang_pref: l, hl: l/); assert.match(v, /translationLanguage/);
});

// animations on lesson slides (scripts/learn-visuals.mjs and the lessons' own media): each names a slide that exists and a scene that exists;
// the burpee (a movement, not an obstacle) has a good rep and a fail for each part of the standard; every scene is in the editor's list
test('slide animations point at real slides and real scenes', async () => {
  globalThis.location ??= { protocol: 'file:', hostname: '', port: '', hash: '' };
  const { VISUALS } = await import('../scripts/learn-visuals.mjs');
  const { SCENES } = await import('../learn/obstacle-scenes.js');
  const { ANIMS } = await import('../learn/slide-visual.js');
  for (const [k, bySlide] of Object.entries(VISUALS)) for (const [h, a] of Object.entries(bySlide)) {
    assert.ok(LESSONS[k].en.some((s) => s.heading === h), `${k}: "${h}"`); assert.ok(SCENES[a], a);
  }
  for (const [k, l] of Object.entries(LESSONS)) for (const s of l.en) if (s.media) { assert.strictEqual(s.media.type, 'anim', k); assert.ok(SCENES[s.media.src], `${k}: ${s.media.src}`); }
  assert.deepStrictEqual(ANIMS.map(([k]) => k).sort(), Object.keys(SCENES).sort(), 'the editor offers every animation');
  const b = SCENES.burpee();
  assert.strictEqual(b.good.marks.length, 3); assert.strictEqual(b.fails.length, 3);
});
test('Referee Essentials: five modules from the mobile prototype, in all 15 languages, each lesson with its quick check', async () => {
  const { ESSENTIALS, ESSENTIALS_LESSONS } = await import('../scripts/learn-essentials.mjs');
  assert.ok(PROGRAMMES.includes(ESSENTIALS));
  assert.strictEqual(ESSENTIALS.locales.split(',').length, 15);
  assert.strictEqual(ESSENTIALS.modules.length, 5);
  for (const k of Object.keys(ESSENTIALS_LESSONS)) { assert.ok(LESSONS[k]); assert.ok(TRANSLATIONS.de[k], k); }
});

// every animation is something a person can do (scripts/check-motion.mjs, frame by frame): no knee or elbow bent backwards, no hip past
// what it bends, nothing below the ground or faster than a sprinter; hands and feet reach what they hold (within 6 px, about 12 cm, in a
// good run; within 10 px in a fail, where the athlete is often stretching for something)
test('every animation moves as a person can', async () => {
  const { checkScene } = await import('../scripts/check-motion.mjs');
  const { SCENES } = await import('../learn/obstacle-scenes.js');
  const bad = [];
  for (const [id, make] of Object.entries(SCENES)) {
    for (const r of checkScene(id, make())) {
      const limit = r.timeline === 'good' ? 6 : 10;
      if (r.kind !== 'reach' || r.worst >= limit) bad.push(`${id} ${r.timeline} ${r.kind} ${r.side} ${r.from.toFixed(2)}s ${r.worst}`);
    }
  }
  assert.deepStrictEqual(bad, []);
});
