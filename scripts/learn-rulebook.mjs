// Puts Spartan's full 2026 Rules of Competition and Officiating SOP into Rules (21 November 2026): every numbered section becomes a
// rule reference with its full text (rule_ref.body), approved as the 2026 baseline. A section that lessons already cite (an
// existing OCR-2026-… reference) keeps its excerpt and version and gains the full text. The text comes from material/ on this PC
// (scripts/learn-rulebook-parse.mjs): it lives only in the database, never in git. Safe to run again: it updates in place.
//   source scripts/learn-env.sh && node scripts/learn-rulebook.mjs [schema]      (default learn_dev; learn for the live site)
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { rulebookSections, sopSections } from './learn-rulebook-parse.mjs';

const require = createRequire(import.meta.url);
const { dbFromEnv } = require('../api/src/learn/db.js');
const schema = process.argv[2] || 'learn_dev';
const db = dbFromEnv(process.env, schema);
if (!db) { console.log('LEARN_SQL_* not set: source scripts/learn-env.sh first'); process.exit(2); }
await db.migrate();

const PROGRAMME = 'ocr-referee';
const DOCS = {
  'ocr-rules-2026': { prefix: 'OCR-2026-', cite: 'Spartan OCR Rules of Competition 2026', sections: rulebookSections() },
  'ocr-sop-2026': { prefix: 'SOP-2026-', cite: 'Spartan Officiating SOP 2026', sections: sopSections() },
};
const short = (s, n = 300) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length <= n ? t : `${t.slice(0, n).replace(/\s+\S*$/, '')}…`; };

let added = 0, filled = 0;
for (const [docId, d] of Object.entries(DOCS)) {
  if (!(await db.query('SELECT 1 AS x FROM {S}.rule_document WHERE doc_id = @d', { d: docId })).length) throw new Error(`${docId} isn't in ${schema}: run the seed first`);
  for (const s of d.sections) {
    const section = s.section.replace(/\//g, '-'); // an SOP heading with no number of its own: "4.2-1"
    const ruleId = `${d.prefix}${section}`, chapter = s.chapterTitle || '', body = s.text || '';
    const title = short(s.title || chapter || section, 190);
    const have = await db.query('SELECT rule_key, state FROM {S}.rule_ref WHERE rule_id = @r ORDER BY version_no DESC', { r: ruleId });
    if (have.length) {
      // the newest approved or draft version gets the section's full text; its excerpt, version and approval stay as they are
      await db.query("UPDATE {S}.rule_ref SET body = @b, chapter = @c WHERE rule_id = @r AND state IN ('approved', 'draft')", { b: body, c: chapter, r: ruleId });
      filled++;
    } else {
      await db.query(`INSERT INTO {S}.rule_ref (rule_key, rule_id, version_no, programme_id, doc_id, section, title, excerpt, body, chapter, citation, effective_date, state, approved_at)
        VALUES (@k, @r, 1, @p, @d, @s, @t, @e, @b, @c, @cite, '2026-01-01', 'approved', SYSUTCDATETIME())`,
      { k: crypto.randomUUID(), r: ruleId, p: PROGRAMME, d: docId, s: section.slice(0, 20), t: title, e: short(body || title), b: body, c: chapter, cite: `${d.cite}, ${section}` });
      added++;
    }
  }
}
console.log(`${schema}: ${added} sections added, ${filled} existing references given their full text`);
await db.close();
