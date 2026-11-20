// The final assessments' question pools (20 November 2026): each programme ends with an assessment that draws 10 questions at random
// from a large pool (api/src/learn/assess.js), so the pool's questions are kept here, one file per programme (scripts/learn-pools/
// <programme id>.json: [{ topic: <module title>, prompt, options: [4], answer: <index>, feedback, rules: [rule ids] }]), written by
// Claude from each programme's own lessons and rule references, for an officiating lead to review.
// This adds a pool's questions to the programme's published version's assessment (making one for a programme that has none), once each
// (matched by the question's words), and leaves every other question alone. DEKA is still a placeholder, so its assessment is turned off.
//   source scripts/learn-env.sh && node scripts/learn-pools.mjs            (the live schema; LEARN_SCHEMA=learn_dev for the dev one)
import fs from 'fs';
import crypto from 'crypto';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { dbFromEnv } = require('../api/src/learn/db.js');
const db = dbFromEnv(process.env, process.env.LEARN_SCHEMA || 'learn');
if (!db) { console.error('LEARN_SQL_* not set: source scripts/learn-env.sh first'); process.exit(1); }
await db.migrate();
const DIR = new URL('./learn-pools/', import.meta.url);
const TITLES = { 'referee-essentials': ['Referee Essentials: final assessment', 'Questions from every part of the course, drawn at random each attempt.'] };
const summary = {};

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
  const pid = file.replace(/\.json$/, ''), pool = JSON.parse(fs.readFileSync(new URL(file, DIR), 'utf8'));
  const v = (await db.query("SELECT TOP 1 * FROM {S}.programme_version WHERE programme_id = @p AND state = 'published' ORDER BY published_at DESC", { p: pid }))[0];
  if (!v) { summary[pid] = 'no published version'; continue; }
  const known = new Set((await db.query("SELECT DISTINCT rule_id FROM {S}.rule_ref WHERE programme_id = @p", { p: pid })).map((r) => r.rule_id));
  let a = (await db.query('SELECT TOP 1 * FROM {S}.assessment WHERE version_id = @v ORDER BY created_at', { v: v.version_id }))[0];
  const have = a ? new Set((await db.query('SELECT prompt FROM {S}.question WHERE assessment_id = @a', { a: a.assessment_id })).map((r) => r.prompt.trim())) : new Set();
  let added = 0, dropped = 0;
  await db.tx(async (q) => {
    if (!a) {
      const id = crypto.randomUUID(), [title, description] = TITLES[pid] || [`${pid}: final assessment`, ''];
      await q('INSERT INTO {S}.assessment (assessment_id, lineage_id, version_id, title, description) VALUES (@id, @id, @v, @t, @d)', { id, v: v.version_id, t: title, d: description });
      await q("INSERT INTO {S}.audit_event (action, entity_type, entity_id, summary, programme_id) VALUES ('assessment.seed', 'assessment', @id, @s, @p)", { id, s: JSON.stringify({ title, note: 'the final assessment, for its question pool' }), p: pid });
      a = { assessment_id: id };
    }
    let seq = (await q('SELECT ISNULL(MAX(seq), 0) AS n FROM {S}.question WHERE assessment_id = @a', { a: a.assessment_id }))[0].n;
    for (const x of pool) {
      const ok = x && typeof x.prompt === 'string' && Array.isArray(x.options) && x.options.length >= 2 && Number.isInteger(x.answer) && x.answer >= 0 && x.answer < x.options.length;
      if (!ok) { dropped++; continue; }
      if (have.has(x.prompt.trim())) continue;
      const options = x.options.map((text, i) => ({ id: String.fromCharCode(97 + i), text, correct: i === x.answer }));
      const rules = (x.rules || []).filter((r) => known.has(r));
      const id = crypto.randomUUID();
      await q(`INSERT INTO {S}.question (question_id, lineage_id, assessment_id, seq, type, prompt, options, feedback, rules, topic)
               VALUES (@id, @id, @a, @seq, 'single', @prompt, @opt, @fb, @rules, @topic)`,
      { id, a: a.assessment_id, seq: ++seq, prompt: x.prompt.trim().slice(0, 1000), opt: JSON.stringify(options), fb: String(x.feedback || '').slice(0, 1000), rules: rules.join(','), topic: String(x.topic || '').slice(0, 160) || null });
      have.add(x.prompt.trim()); added++;
    }
    if (added) await q("INSERT INTO {S}.audit_event (action, entity_type, entity_id, summary, programme_id) VALUES ('question.seed', 'assessment', @id, @s, @p)", { id: a.assessment_id, s: JSON.stringify({ added, note: 'the final assessment\'s question pool' }), p: pid });
  });
  summary[pid] = { added, dropped, pool: (await db.query("SELECT COUNT(*) AS n FROM {S}.question WHERE assessment_id = @a ", { a: a.assessment_id }))[0].n };
}
// DEKA is a placeholder shell: no final assessment until it has content
const deka = await db.query("UPDATE {S}.programme SET assessment_on = 0 OUTPUT inserted.programme_id WHERE programme_id = 'deka-judge' AND assessment_on = 1");
if (deka.length) await db.query("INSERT INTO {S}.audit_event (action, entity_type, entity_id, summary, programme_id) VALUES ('programme.edit', 'programme', 'deka-judge', @s, 'deka-judge')", { s: JSON.stringify({ after: { assessment_on: 0 }, note: 'a placeholder: no final assessment yet' }) });
console.log(JSON.stringify(summary, null, 1));
await db.close();
