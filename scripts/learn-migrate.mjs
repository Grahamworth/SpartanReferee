// Applies the learning database's migrations (api/src/learn/migrations) with the admin login, before a deploy: the site itself
// connects as learn_app, which can't create tables. Run by scripts/deploy-site.sh; safe to run again.
//   source scripts/learn-env.sh && node scripts/learn-migrate.mjs
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { dbFromEnv } = require('../api/src/learn/db.js');
const db = dbFromEnv(process.env, process.env.LEARN_SCHEMA || 'learn');
if (!db) { console.log('LEARN_SQL_* not set: source scripts/learn-env.sh first'); process.exit(2); }
const applied = await db.migrate();
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'The learning database is up to date');
await db.close();
