// The learning platform's demo data: regions and ten invented people with their roles (the design doc's "Demo data"), and the
// programmes with their curriculum and enrolments (scripts/learn-content.mjs).
// Safe to run again: what's already there is left as it is. Nobody real is added (NFR-04).
//   source scripts/learn-env.sh && node scripts/learn-seed.mjs
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { PROGRAMMES, ENROLMENTS } from './learn-content.mjs';
import { LESSONS } from './learn-lessons.mjs';
import { ASSESSMENTS, OUTCOMES } from './learn-questions.mjs';
import { DOCUMENTS, RULES, DISPUTES } from './learn-rules.mjs';

const require = createRequire(import.meta.url);
const { dbFromEnv } = require('../api/src/learn/db.js');
const db = dbFromEnv(process.env, process.env.LEARN_SCHEMA || 'learn');
if (!db) { console.log('LEARN_SQL_* not set: source scripts/learn-env.sh first'); process.exit(2); }

export const REGIONS = [
  { id: 'europe', name: 'Europe', countries: 'GB,IE,FR,DE,NL,BE,ES,PT,IT,GR,HR,CZ,SK,PL,HU,AT,CH,SI,RO,FI,SE,DK,AD' },
  { id: 'mea', name: 'Middle East and Asia', countries: 'AE,TH,PH,JP,HK,TW,MY,SG' },
  { id: 'americas', name: 'Americas', countries: 'US,CA,MX,PA,AR,BR,CR' },
];
const D = 'demo.spartanreferee.test'; // a .test domain: these addresses can never reach anyone
export const PEOPLE = [
  { name: 'Grace Admin', email: `grace.admin@${D}`, country: 'GB', region: 'europe', roles: [{ role: 'global_admin' }], note: 'demo global admin' },
  { name: 'Paul Owner', email: `paul.owner@${D}`, country: 'US', region: 'americas', roles: [{ role: 'programme_owner', programme: 'ocr-referee' }], note: 'OCR programme owner and rules approver' },
  { name: 'Elena Ruiz', email: `elena.ruiz@${D}`, country: 'ES', region: 'europe', roles: [{ role: 'regional_coordinator', region: 'europe' }], note: 'Europe coordinator' },
  { name: 'Karim Haddad', email: `karim.haddad@${D}`, country: 'AE', region: 'mea', roles: [{ role: 'regional_coordinator', region: 'mea' }], note: 'Middle East and Asia coordinator' },
  { name: 'Claire Martin', email: `claire.martin@${D}`, country: 'FR', region: 'europe', locale: 'fr', roles: [{ role: 'content_editor', programme: 'ocr-referee' }], note: 'content editor and translator' },
  { name: 'Tomas Novak', email: `tomas.novak@${D}`, country: 'CZ', region: 'europe', roles: [{ role: 'assessor', programme: 'ocr-referee' }], note: 'assessor' },
  { name: 'Sam Okafor', email: `sam.okafor@${D}`, country: 'GB', region: 'europe', roles: [{ role: 'technical_admin' }], note: 'technical administrator: diagnostics only' },
  { name: 'Anna Kowalska', email: `anna.kowalska@${D}`, country: 'PL', region: 'europe', roles: [], note: 'referee: OCR and DEKA' },
  { name: 'Ben Taylor', email: `ben.taylor@${D}`, country: 'GB', region: 'europe', roles: [], note: 'referee: OCR, passed' },
  { name: 'Chaiwat Srisuk', email: `chaiwat.srisuk@${D}`, country: 'TH', region: 'mea', locale: 'th', roles: [], note: 'referee: OCR, due for renewal' },
  { name: 'Daniyal Khan', email: `daniyal.khan@${D}`, country: 'AE', region: 'mea', roles: [], note: 'judge: DEKA, expired' },
];

const summary = { regions: 0, people: 0, roles: 0 };
await db.migrate();
for (const r of REGIONS) {
  const had = (await db.query('SELECT 1 AS x FROM {S}.region WHERE region_id = @id', { id: r.id })).length;
  if (!had) { await db.query('INSERT INTO {S}.region (region_id, name, countries) VALUES (@id, @name, @countries)', r); summary.regions++; }
}
for (const p of PEOPLE) {
  let row = (await db.query('SELECT person_id FROM {S}.person WHERE email = @email AND synthetic = 1', { email: p.email }))[0];
  if (!row) {
    const id = crypto.randomUUID();
    await db.tx(async (q) => {
      const n = (await q('SELECT NEXT VALUE FOR {S}.person_seq AS n'))[0].n;
      await q(`INSERT INTO {S}.person (person_id, public_id, legal_name, email, country, region_id, locale, synthetic) VALUES (@id, @pub, @name, @email, @country, @region, @locale, 1)`,
        { id, pub: `SR-${String(n).padStart(6, '0')}`, name: p.name, email: p.email, country: p.country, region: p.region, locale: p.locale || 'en' });
      await q(`INSERT INTO {S}.audit_event (action, entity_type, entity_id, summary, region_id) VALUES ('person.seed', 'person', @id, @s, @region)`, { id, s: JSON.stringify({ name: p.name, note: p.note }), region: p.region });
    });
    row = { person_id: id }; summary.people++;
  }
  for (const g of p.roles) {
    const had = (await db.query('SELECT 1 AS x FROM {S}.role_grant WHERE person_id = @p AND role = @role AND ISNULL(programme_id, \'\') = @prog AND ISNULL(region_id, \'\') = @region',
      { p: row.person_id, role: g.role, prog: g.programme || '', region: g.region || '' })).length;
    if (!had) { await db.query('INSERT INTO {S}.role_grant (grant_id, person_id, role, programme_id, region_id) VALUES (@id, @p, @role, @prog, @region)', { id: crypto.randomUUID(), p: row.person_id, role: g.role, prog: g.programme || null, region: g.region || null }); summary.roles++; }
  }
}
// ---------------------------------------------------------------- programmes (step 2): published straight away by the seed
summary.programmes = 0; summary.enrolments = 0;
const personByEmail = async (local) => (await db.query('SELECT * FROM {S}.person WHERE email = @e AND synthetic = 1', { e: `${local}@${D}` }))[0];
const owner = await personByEmail('paul.owner');
for (const prog of PROGRAMMES) {
  if ((await db.query('SELECT 1 AS x FROM {S}.programme WHERE programme_id = @id', { id: prog.id })).length) continue;
  const v = prog.version, vid = crypto.randomUUID();
  await db.tx(async (q) => {
    await q(`INSERT INTO {S}.programme (programme_id, title, category, description, owner_id, locales, learner_role) VALUES (@id, @title, @cat, @desc, @owner, @loc, @role)`,
      { id: prog.id, title: prog.title, cat: prog.category, desc: prog.description, owner: prog.id === 'ocr-referee' ? owner?.person_id || null : null, loc: prog.locales, role: prog.learnerRole });
    await q(`INSERT INTO {S}.programme_version (version_id, programme_id, edition, state, effective_date, completion_rule, pass_mark, max_attempts, retake_wait_hours, validity_months, renewal_due_days, qualification, policy_note, published_at)
             VALUES (@vid, @id, @ed, 'published', '2027-01-01', @rule, @pass, @max, @wait, @valid, @due, @qual, @note, SYSUTCDATETIME())`,
      { vid, id: prog.id, ed: v.edition, rule: v.completionRule, pass: v.passMark, max: v.maxAttempts, wait: v.retakeWaitHours, valid: v.validityMonths, due: v.renewalDueDays, qual: v.qualification, note: v.policyNote });
    let mseq = 0;
    for (const m of prog.modules) {
      const mid = crypto.randomUUID(); mseq++;
      await q('INSERT INTO {S}.module (module_id, lineage_id, version_id, code, seq, title, summary, source_section) VALUES (@id, @id, @v, @code, @seq, @t, @s, @src)',
        { id: mid, v: vid, code: `${prog.code || (prog.id === 'ocr-referee' ? 'ocr' : 'deka')}-${mseq}`, seq: mseq, t: m.title, s: m.summary, src: m.source });
      let lseq = 0;
      for (const l of m.lessons) {
        const lid = crypto.randomUUID(); lseq++;
        await q('INSERT INTO {S}.lesson (lesson_id, lineage_id, code, module_id, version_id, seq, title, summary, minutes) VALUES (@id, @id, @code, @m, @v, @seq, @t, @s, @min)',
          { id: lid, code: l.key, m: mid, v: vid, seq: lseq, t: l.title, s: l.summary, min: l.minutes });
      }
    }
    await q(`INSERT INTO {S}.audit_event (action, entity_type, entity_id, summary, programme_id) VALUES ('programme.seed', 'programme', @id, @s, @id)`, { id: prog.id, s: JSON.stringify({ title: prog.title, edition: v.edition }) });
  });
  summary.programmes++;
}
for (const en of ENROLMENTS) {
  const p = await personByEmail(en.email); if (!p) continue;
  for (const pid of en.programmes) {
    const v = (await db.query("SELECT TOP 1 * FROM {S}.programme_version WHERE programme_id = @id AND state = 'published' ORDER BY published_at DESC", { id: pid }))[0];
    if (!v || (await db.query('SELECT 1 AS x FROM {S}.enrolment WHERE person_id = @p AND version_id = @v', { p: p.person_id, v: v.version_id })).length) continue;
    const role = (await db.query('SELECT learner_role FROM {S}.programme WHERE programme_id = @id', { id: pid }))[0].learner_role;
    await db.tx(async (q) => {
      await q('INSERT INTO {S}.enrolment (enrolment_id, person_id, programme_id, version_id, enrolled_at) VALUES (@id, @p, @prog, @v, DATEADD(day, -60, SYSUTCDATETIME()))', { id: crypto.randomUUID(), p: p.person_id, prog: pid, v: v.version_id });
      if (!(await q('SELECT 1 AS x FROM {S}.programme_role WHERE person_id = @p AND programme_id = @prog', { p: p.person_id, prog: pid })).length) {
        await q("INSERT INTO {S}.programme_role (person_id, programme_id, role, grade) VALUES (@p, @prog, @role, 'Trainee')", { p: p.person_id, prog: pid, role });
      }
    });
    summary.enrolments++;
  }
}
// ---------------------------------------------------------------- lesson content (step 3): English published, Spanish in review
summary.lessons = 0;
const hash = (t) => crypto.createHash('sha256').update(t).digest('hex');
const lessonByCode = async (code) => (await db.query(`SELECT TOP 1 l.* FROM {S}.lesson l JOIN {S}.programme_version v ON v.version_id = l.version_id
  WHERE l.code = @code AND v.state = 'published' ORDER BY v.published_at DESC`, { code }))[0];
for (const [code, content] of Object.entries(LESSONS)) {
  const l = await lessonByCode(code); if (!l) continue;
  if ((await db.query('SELECT 1 AS x FROM {S}.content_version WHERE lesson_id = @l', { l: l.lesson_id })).length) continue;
  const en = crypto.randomUUID(), enBody = JSON.stringify({ slides: content.en });
  await db.tx(async (q) => {
    await q(`INSERT INTO {S}.content_version (content_id, lesson_id, locale, version_no, state, body, source_hash, sources, author_id, approved_by, approved_at)
             VALUES (@id, @l, 'en', 1, 'published', @body, @hash, @src, @a, @a, SYSUTCDATETIME())`, { id: en, l: l.lesson_id, body: enBody, hash: hash(enBody), src: content.sources, a: owner?.person_id || null });
    if (content.es) {
      const esBody = JSON.stringify({ slides: content.es });
      await q(`INSERT INTO {S}.content_version (content_id, lesson_id, locale, version_no, state, translation_of, body, source_hash, sources, translated_by, submitted_at)
               VALUES (@id, @l, 'es', 1, 'review', @en, @body, @hash, @src, @by, SYSUTCDATETIME())`, { id: crypto.randomUUID(), l: l.lesson_id, en, body: esBody, hash: hash(esBody), src: content.sources, by: content.esBy });
    }
    await q(`INSERT INTO {S}.audit_event (action, entity_type, entity_id, summary) VALUES ('content.seed', 'content_version', @id, @s)`, { id: en, s: JSON.stringify({ lesson: code, locales: content.es ? ['en', 'es (review)'] : ['en'] }) });
  });
  summary.lessons++;
}
// narration: Azure AI Speech by default, with a British English and a Castilian Spanish voice
if (!(await db.query("SELECT 1 AS x FROM {S}.media_config WHERE scope = 'default'")).length) {
  await db.query("INSERT INTO {S}.media_config (scope, provider, voices) VALUES ('default', 'azure-speech', @v)", { v: JSON.stringify({ en: 'en-GB-RyanNeural', es: 'es-ES-ElviraNeural' }) });
}
// ---------------------------------------------------------------- assessments (step 4), and the demo people's results
summary.assessments = 0; summary.credentials = 0;
const currentVersion = async (pid) => (await db.query("SELECT TOP 1 * FROM {S}.programme_version WHERE programme_id = @id AND state = 'published' ORDER BY published_at DESC", { id: pid }))[0];
for (const [pid, a] of Object.entries(ASSESSMENTS)) {
  const v = await currentVersion(pid); if (!v) continue;
  if ((await db.query('SELECT 1 AS x FROM {S}.assessment WHERE version_id = @v', { v: v.version_id })).length) continue;
  const aid = crypto.randomUUID();
  await db.tx(async (q) => {
    await q('INSERT INTO {S}.assessment (assessment_id, lineage_id, version_id, title, description) VALUES (@id, @id, @v, @t, @d)', { id: aid, v: v.version_id, t: a.title, d: a.description });
    let seq = 0;
    for (const qu of a.questions) {
      seq++;
      const options = qu.options.map((o, i) => ({ id: String.fromCharCode(97 + i), text: o.text, correct: !!o.correct }));
      await q(`INSERT INTO {S}.question (question_id, lineage_id, assessment_id, seq, type, prompt, options, feedback, clip, rules, review_note, needs_assessor)
               VALUES (@id, @id, @a, @seq, @type, @prompt, @opt, @fb, @clip, @rules, @rn, @na)`,
        { id: crypto.randomUUID(), a: aid, seq, type: qu.type, prompt: qu.prompt, opt: JSON.stringify(options), fb: qu.feedback, clip: qu.clip ? JSON.stringify(qu.clip) : null, rules: qu.rules.join(','), rn: qu.review || '', na: qu.needsAssessor ? 1 : 0 });
    }
  });
  summary.assessments++;
}
for (const o of OUTCOMES) {
  const p = await personByEmail(o.email); const v = await currentVersion(o.programme); if (!p || !v) continue;
  if ((await db.query('SELECT 1 AS x FROM {S}.credential WHERE person_id = @p AND programme_id = @prog', { p: p.person_id, prog: o.programme })).length) continue;
  const e = (await db.query('SELECT * FROM {S}.enrolment WHERE person_id = @p AND version_id = @v', { p: p.person_id, v: v.version_id }))[0]; if (!e) continue;
  const a = (await db.query('SELECT * FROM {S}.assessment WHERE version_id = @v', { v: v.version_id }))[0]; if (!a) continue;
  const qs = await db.query('SELECT * FROM {S}.question WHERE assessment_id = @a ORDER BY seq', { a: a.assessment_id });
  const days = o.issuedDaysAgo;
  await db.tx(async (q) => {
    // every lesson with content, done in English
    for (const c of await q("SELECT c.* FROM {S}.content_version c JOIN {S}.lesson l ON l.lesson_id = c.lesson_id WHERE l.version_id = @v AND c.locale = 'en' AND c.state = 'published'", { v: v.version_id })) {
      if ((await q('SELECT 1 AS x FROM {S}.completion WHERE person_id = @p AND lesson_id = @l AND locale = @loc', { p: p.person_id, l: c.lesson_id, loc: 'en' })).length) continue;
      await q(`INSERT INTO {S}.completion (completion_id, person_id, enrolment_id, programme_id, version_id, lesson_id, content_id, content_version, source_hash, locale, completed_at)
               VALUES (@id, @p, @e, @prog, @v, @l, @c, @cv, @h, 'en', DATEADD(day, -@d - 1, SYSUTCDATETIME()))`, { id: crypto.randomUUID(), p: p.person_id, e: e.enrolment_id, prog: o.programme, v: v.version_id, l: c.lesson_id, c: c.content_id, cv: c.version_no, h: c.source_hash, d: days });
    }
    // a passing attempt: every answer right
    const answers = qs.map((qu) => ({ questionId: qu.question_id, lineageId: qu.lineage_id, versionNo: qu.version_no, rules: qu.rules.split(',').filter(Boolean), type: qu.type,
      chosen: JSON.parse(qu.options).filter((x) => x.correct).map((x) => x.id), reason: qu.needs_assessor ? 'No jump with the hands above the ears.' : '', correct: true, decided: !!qu.needs_assessor }));
    const tid = crypto.randomUUID();
    await q(`INSERT INTO {S}.attempt (attempt_id, person_id, enrolment_id, assessment_id, version_id, programme_id, started_at, submitted_at, answers, score, max_score, pass_mark, result, decided_at)
             VALUES (@id, @p, @e, @a, @v, @prog, DATEADD(day, -@d, SYSUTCDATETIME()), DATEADD(day, -@d, SYSUTCDATETIME()), @ans, @n, @n, @pass, 'pass', DATEADD(day, -@d, SYSUTCDATETIME()))`,
      { id: tid, p: p.person_id, e: e.enrolment_id, a: a.assessment_id, v: v.version_id, prog: o.programme, d: days, ans: JSON.stringify(answers), n: qs.length, pass: v.pass_mark });
    await q("UPDATE {S}.enrolment SET state = 'completed', completed_at = DATEADD(day, -@d, SYSUTCDATETIME()) WHERE enrolment_id = @e", { e: e.enrolment_id, d: days });
    const n = (await q('SELECT NEXT VALUE FOR {S}.credential_seq AS n'))[0].n, cid = crypto.randomUUID();
    const pub = `DEMO-${o.programme.split('-')[0].toUpperCase().slice(0, 6)}-${String(n).padStart(6, '0')}`;
    await q(`INSERT INTO {S}.credential (credential_id, public_id, person_id, programme_id, version_id, enrolment_id, attempt_id, qualification, issued_at, expires_at)
             VALUES (@id, @pub, @p, @prog, @v, @e, @t, @qual, DATEADD(day, -@d, SYSUTCDATETIME()), ${v.validity_months ? 'DATEADD(month, @m, DATEADD(day, -@d, SYSUTCDATETIME()))' : 'NULL'})`,
      { id: cid, pub, p: p.person_id, prog: o.programme, v: v.version_id, e: e.enrolment_id, t: tid, qual: v.qualification, d: days, m: v.validity_months });
    await q(`INSERT INTO {S}.audit_event (action, entity_type, entity_id, summary, programme_id, region_id) VALUES ('credential.seed', 'credential', @id, @s, @prog, @region)`,
      { id: cid, s: JSON.stringify({ publicId: pub, note: o.note, demonstration: true }), prog: o.programme, region: p.region_id });
  });
  summary.credentials++;
}
// ---------------------------------------------------------------- rule references and open review items (step 5)
summary.rules = 0; summary.reviews = 0;
for (const d of DOCUMENTS) {
  if ((await db.query('SELECT 1 AS x FROM {S}.rule_document WHERE doc_id = @id', { id: d.id })).length) continue;
  await db.query('INSERT INTO {S}.rule_document (doc_id, programme_id, title, edition, approval, note, effective_date) VALUES (@id, @p, @t, @e, @a, @n, @eff)', { id: d.id, p: d.programme, t: d.title, e: d.edition, a: d.approval, n: d.note, eff: d.effective });
}
for (const r of RULES) {
  if ((await db.query('SELECT 1 AS x FROM {S}.rule_ref WHERE rule_id = @id', { id: r.id })).length) continue;
  const doc = DOCUMENTS.find((d) => d.id === r.doc);
  await db.query(`INSERT INTO {S}.rule_ref (rule_key, rule_id, version_no, programme_id, doc_id, section, title, excerpt, citation, effective_date, state, approved_at)
                  VALUES (@k, @id, 1, @p, @d, @s, @t, @e, @c, @eff, 'approved', SYSUTCDATETIME())`,
    { k: crypto.randomUUID(), id: r.id, p: doc.programme, d: r.doc, s: r.section, t: r.title, e: r.excerpt, c: `${doc.title} ${doc.edition}, ${r.section}`, eff: doc.effective });
  summary.rules++;
}
// what each disputed rule affects: the lessons and questions that cite it, in published versions
async function affectedFor(ruleId) {
  const out = [];
  for (const c of await db.query("SELECT c.content_id, c.locale, c.version_no, c.state, c.body, l.lesson_id, l.title, v.version_id, v.edition, v.state AS vstate FROM {S}.content_version c JOIN {S}.lesson l ON l.lesson_id = c.lesson_id JOIN {S}.programme_version v ON v.version_id = l.version_id WHERE c.state IN ('published', 'review')")) {
    if ((JSON.parse(c.body).slides || []).some((sl) => (sl.rules || []).includes(ruleId))) out.push({ type: 'lesson', id: c.lesson_id, contentId: c.content_id, title: `${c.title} (${c.locale} v${c.version_no}, ${c.state})`, edition: c.edition, programmeVersion: c.version_id, versionState: c.vstate });
  }
  for (const q of await db.query('SELECT q.question_id, q.prompt, q.rules, a.assessment_id, a.title, v.version_id, v.edition, v.state AS vstate FROM {S}.question q JOIN {S}.assessment a ON a.assessment_id = q.assessment_id JOIN {S}.programme_version v ON v.version_id = a.version_id')) {
    if (q.rules.split(',').includes(ruleId)) out.push({ type: 'question', id: q.question_id, assessmentId: q.assessment_id, title: `${q.title}: ${q.prompt.slice(0, 90)}`, edition: q.edition, programmeVersion: q.version_id, versionState: q.vstate });
  }
  return out;
}
for (const d of DISPUTES) {
  if ((await db.query("SELECT 1 AS x FROM {S}.review_item WHERE kind = 'dispute' AND title = @t", { t: d.title })).length) continue;
  await db.query(`INSERT INTO {S}.review_item (review_id, programme_id, kind, rule_id, title, detail, affected) VALUES (@id, 'ocr-referee', 'dispute', @r, @t, @d, @a)`,
    { id: crypto.randomUUID(), r: d.rule, t: d.title, d: d.detail, a: JSON.stringify(await affectedFor(d.rule)) });
  summary.reviews++;
}
console.log(`Seeded: ${Object.entries(summary).map(([k, n]) => `${n} ${k}`).join(', ')} added (the rest were already there).`);
await db.close();
