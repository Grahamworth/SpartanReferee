// Gives the site its own least-privilege login to the learning database (from the review of 19 November 2026): a contained user,
// learn_app, that can only read and write the learn schema, and can't change or delete the audit log. The server admin login stays
// for migrations, the seed and the tests only (LEARN_SQL_ADMIN_* in the site's settings; scripts/learn-env.sh uses those).
// Safe to run again: a second run sets a new password. No secret is printed.
//   node scripts/learn-app-user.mjs          (needs az signed in; reads and writes the site's settings itself)
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const sql = require('../api/node_modules/mssql');
const SUB = '65c0ccca-69f7-43eb-9246-3bd6a6a06b24', RG = 'rg-spartanreferee-uksouth', SITE = 'spartanreferee', APP_USER = 'learn_app';
const az = (args) => execFileSync(process.platform === 'win32' ? 'az.cmd' : 'az', [...args, '--subscription', SUB, '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
const settings = JSON.parse(az(['staticwebapp', 'appsettings', 'list', '--name', SITE, '-g', RG, '--query', 'properties']));
// the admin login: from its own settings if this ran before, else the current ones (which were the admin)
const adminUser = settings.LEARN_SQL_ADMIN_USER || settings.LEARN_SQL_USER, adminPassword = settings.LEARN_SQL_ADMIN_PASSWORD || settings.LEARN_SQL_PASSWORD;
if (!adminUser || adminUser === APP_USER) throw new Error('No admin login in the site\'s settings');
const password = `${crypto.randomBytes(24).toString('base64url')}aA1!`; // letters, digits, - and _, then one of each kind SQL asks for

const pool = await new sql.ConnectionPool({ server: settings.LEARN_SQL_SERVER, database: settings.LEARN_SQL_DATABASE, user: adminUser, password: adminPassword,
  options: { encrypt: true }, connectionTimeout: 60000 }).connect();
const run = (q) => pool.request().query(q);
const exists = (await run(`SELECT 1 AS x FROM sys.database_principals WHERE name = '${APP_USER}'`)).recordset.length > 0;
await run(exists ? `ALTER USER [${APP_USER}] WITH PASSWORD = '${password}'` : `CREATE USER [${APP_USER}] WITH PASSWORD = '${password}', DEFAULT_SCHEMA = [learn]`);
await run(`GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON SCHEMA::[learn] TO [${APP_USER}]`);
await run(`DENY UPDATE, DELETE ON [learn].[audit_event] TO [${APP_USER}]`);
// it works, and it can't do what it shouldn't
const check = await new sql.ConnectionPool({ server: settings.LEARN_SQL_SERVER, database: settings.LEARN_SQL_DATABASE, user: APP_USER, password, options: { encrypt: true }, connectionTimeout: 60000 }).connect();
const people = (await check.request().query('SELECT COUNT(*) AS n FROM [learn].[person]')).recordset[0].n;
let blocked = false; try { await check.request().query('DELETE FROM [learn].[audit_event] WHERE 1 = 0'); } catch { blocked = true; }
let noDdl = false; try { await check.request().query('CREATE TABLE [learn].[x_probe] (a INT)'); await check.request().query('DROP TABLE [learn].[x_probe]'); } catch { noDdl = true; }
await check.close(); await pool.close();
if (!blocked || !noDdl) throw new Error(`The app user can do too much (audit delete blocked: ${blocked}, tables blocked: ${noDdl}): settings unchanged`);
// the site now uses it; the admin login moves to its own settings
az(['staticwebapp', 'appsettings', 'set', '--name', SITE, '-g', RG, '--setting-names',
  `LEARN_SQL_ADMIN_USER=${adminUser}`, `LEARN_SQL_ADMIN_PASSWORD=${adminPassword}`, `LEARN_SQL_USER=${APP_USER}`, `LEARN_SQL_PASSWORD=${password}`]);
console.log(`Done: the site connects as ${APP_USER} (reads ${people} people; can't delete the audit log; can't create tables). The admin login is in LEARN_SQL_ADMIN_*.`);
