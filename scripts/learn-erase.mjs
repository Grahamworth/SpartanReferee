// After erasing someone on the learning platform (their profile page, Erase), removes their email address from older audit entries,
// which the site's own login can't change. Run with the admin login; it changes only the summaries that contain that exact address.
//   source scripts/learn-env.sh && node scripts/learn-erase.mjs someone@example.com
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { dbFromEnv } = require('../api/src/learn/db.js');
const email = String(process.argv[2] || '').trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.log('Usage: node scripts/learn-erase.mjs someone@example.com'); process.exit(2); }
const db = dbFromEnv(process.env, process.env.LEARN_SCHEMA || 'learn');
if (!db) { console.log('LEARN_SQL_* not set: source scripts/learn-env.sh first'); process.exit(2); }
const rows = await db.query("SELECT audit_id, summary FROM {S}.audit_event WHERE LOWER(summary) LIKE @like", { like: `%${email.replace(/[%_[]/g, '')}%` });
for (const r of rows) {
  const scrubbed = r.summary.replace(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'erased@erased.invalid');
  await db.query('UPDATE {S}.audit_event SET summary = @s WHERE audit_id = @id', { s: scrubbed, id: r.audit_id });
}
console.log(`Removed the address from ${rows.length} audit ${rows.length === 1 ? 'entry' : 'entries'}.`);
await db.close();
