// The learning platform's demo data: regions and ten invented people with their roles (the design doc's "Demo data"), and the
// programmes with their curriculum and enrolments (scripts/learn-content.mjs).
// Safe to run again: what's already there is left as it is. Nobody real is added (NFR-04).
//   source scripts/learn-env.sh && node scripts/learn-seed.mjs
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { PROGRAMMES, ENROLMENTS } from './learn-content.mjs';
import { LESSONS } from './learn-lessons.mjs';

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
        { id: mid, v: vid, code: `${prog.id === 'ocr-referee' ? 'ocr' : 'deka'}-${mseq}`, seq: mseq, t: m.title, s: m.summary, src: m.source });
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
console.log(`Seeded: ${Object.entries(summary).map(([k, n]) => `${n} ${k}`).join(', ')} added (the rest were already there).`);
await db.close();
