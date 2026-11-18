// The learning platform's demo data: regions and ten invented people with their roles (the design doc's "Demo data").
// Safe to run again: what's already there is left as it is. Nobody real is added (NFR-04).
//   source scripts/learn-env.sh && node scripts/learn-seed.mjs
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

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
console.log(`Seeded: ${summary.regions} regions, ${summary.people} people, ${summary.roles} roles added (the rest were already there).`);
await db.close();
