// Removes the invented demo people (synthetic = 1) from the learning database, with everything that's theirs: logins, roles, enrolments,
// lesson completions and progress, practice, attempts, demo credentials, badges and duplicate flags. Content, rules and review items they
// were recorded as writing or approving stay, with that reference cleared; the audit log is left as it was.
// At the user's request (19 November 2026: "all the users that are not graham.hollingsworth should be removed").
// Dry run by default (shows what it would remove); --write removes.
//   source scripts/learn-env.sh && node scripts/learn-remove-invented.mjs [--write]
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { dbFromEnv } = require('../api/src/learn/db.js');
const db = dbFromEnv(process.env, process.env.LEARN_SCHEMA || 'learn');
if (!db) { console.log('LEARN_SQL_* not set: source scripts/learn-env.sh first'); process.exit(2); }
const write = process.argv.includes('--write');

const people = await db.query('SELECT person_id, legal_name FROM {S}.person WHERE synthetic = 1');
console.log(`${people.length} invented people: ${people.map((p) => p.legal_name).join(', ') || 'none'}`);
if (!people.length) { await db.close(); process.exit(0); }
const IN = `(SELECT person_id FROM {S}.person WHERE synthetic = 1)`;
// theirs, removed (children first)
const remove = [
  ['completion', `person_id IN ${IN}`], ['lesson_progress', `person_id IN ${IN}`], ['attempt', `person_id IN ${IN}`],
  ['credential', `person_id IN ${IN}`], ['check_state', `person_id IN ${IN}`], ['learning_day', `person_id IN ${IN}`], ['badge', `person_id IN ${IN}`],
  ['enrolment', `person_id IN ${IN}`], ['programme_role', `person_id IN ${IN}`], ['role_grant', `person_id IN ${IN}`], ['person_login', `person_id IN ${IN}`],
  ['duplicate_flag', `person_a IN ${IN} OR person_b IN ${IN}`],
];
// references to them in what stays: cleared
const clear = [
  ['programme', 'owner_id'], ['programme', 'created_by'], ['programme_version', 'created_by'], ['programme_version', 'submitted_by'],
  ['content_version', 'author_id'], ['content_version', 'submitted_by'], ['content_version', 'approved_by'], ['assessment', 'created_by'],
  ['rule_ref', 'created_by'], ['rule_ref', 'approved_by'], ['review_item', 'created_by'], ['media_config', 'updated_by'],
  ['attempt', 'assessor_id'], ['credential', 'issued_by'], ['enrolment', 'enrolled_by'], ['role_grant', 'granted_by'], ['invite', 'invited_by'], ['duplicate_flag', 'decided_by'],
];
for (const [t, where] of remove) console.log(`  remove from ${t}: ${(await db.query(`SELECT COUNT(*) AS n FROM {S}.${t} WHERE ${where}`))[0].n}`);
for (const [t, c] of clear) { const n = (await db.query(`SELECT COUNT(*) AS n FROM {S}.${t} WHERE ${c} IN ${IN}`))[0].n; if (n) console.log(`  clear ${t}.${c}: ${n}`); }
if (!write) { console.log('Dry run: nothing changed. Add --write to remove them.'); await db.close(); process.exit(0); }
await db.tx(async (q) => {
  for (const [t, c] of clear) await q(`UPDATE {S}.${t} SET ${c} = NULL WHERE ${c} IN ${IN}`);
  for (const [t, where] of remove) await q(`DELETE FROM {S}.${t} WHERE ${where}`);
  await q('DELETE FROM {S}.person WHERE synthetic = 1');
  await q("INSERT INTO {S}.audit_event (action, entity_type, entity_id, summary) VALUES ('person.remove-invented', 'person', 'all', @s)", { s: JSON.stringify({ count: people.length }) });
});
console.log(`Removed ${people.length} invented people.`);
await db.close();
