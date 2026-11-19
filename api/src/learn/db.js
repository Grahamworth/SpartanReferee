'use strict';
/* The learning platform's database: Azure SQL (LEARN_SQL_SERVER, LEARN_SQL_DATABASE, LEARN_SQL_USER, LEARN_SQL_PASSWORD).
   Every query is parameterised: values go in @names, never into the SQL text. {S} in the SQL is the schema, so the same
   statements run live ("learn") and in the integration tests ("learn_test"). migrate() applies migrations/NNN-*.sql once each,
   in order, inside a transaction. */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS = path.join(__dirname, 'migrations');
const SCHEMA = /^[a-z_]{1,32}$/;

/** Azure's "the database isn't available yet" (40613), as it says while a paused database wakes */
const asleep = (e) => /\b40613\b|not currently available/i.test(`${e && e.number} ${e && e.message} ${e && e.originalError && e.originalError.message}`);

function createDb({ server, database, user, password, schema = 'learn', sql = require('mssql'), wakeTries = 8, wakeEveryMs = 3000, wakeBudgetMs = 38000, now = Date.now }) {
  if (!SCHEMA.test(schema)) throw new Error('bad schema name');
  const S = `[${schema}]`;
  let pool = null;
  const open = (timeout) => new sql.ConnectionPool({
    server, database, user, password,
    options: { encrypt: true, trustServerCertificate: false },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: timeout, requestTimeout: 30000,
  }).connect();
  // The free database pauses after an hour unused. The first connection wakes it, and until it's up (usually under a minute) Azure
  // either refuses at once (40613) or the connection just waits. Keep trying within a budget that fits a web request (45 s in all),
  // then say it's waking, and the page asks again.
  const stillWaking = (e) => asleep(e) || e?.code === 'ETIMEOUT' || /Failed to connect/i.test(String(e?.message));
  async function wake() {
    const until = now() + wakeBudgetMs;
    for (let i = 0; ; i++) {
      const left = until - now();
      try { return await open(Math.max(5000, Math.min(20000, left))); } catch (e) {
        if (!stillWaking(e)) throw e;
        if (i >= wakeTries || until - now() < wakeEveryMs + 5000) throw Object.assign(new Error('The learning platform is waking up'), { waking: true });
        await new Promise((r) => setTimeout(r, wakeEveryMs));
      }
    }
  }
  const connect = () => (pool = pool || wake().catch((e) => { pool = null; throw e; }));
  const text = (q) => q.replace(/\{S\}/g, S);
  const bind = (req, params = {}) => { for (const [k, v] of Object.entries(params)) req.input(k, v === undefined ? null : v); return req; };
  /** rows of a query: query('SELECT * FROM {S}.person WHERE person_id = @id', { id }) */
  // it can pause again later, while this process keeps its connections: then a query is refused, and it's woken again, once
  async function again(run) {
    try { return await run(await connect()); } catch (e) {
      if (!asleep(e)) throw e;
      const old = pool; pool = null; try { (await old)?.close(); } catch { /* gone anyway */ }
      return run(await connect());
    }
  }
  async function query(q, params) {
    return again(async (p) => (await bind(p.request(), params).query(text(q))).recordset || []);
  }
  /** several statements that succeed or fail together: tx(async (q) => { await q(...); await q(...); }) */
  async function tx(fn) {
    const p = await again(async (x) => { await x.request().query('SELECT 1'); return x; }), t = new sql.Transaction(p); // awake first
    await t.begin();
    try {
      const out = await fn(async (q, params) => (await bind(new sql.Request(t), params).query(text(q))).recordset || []);
      await t.commit();
      return out;
    } catch (e) { try { await t.rollback(); } catch { /* already gone */ } throw e; }
  }
  async function migrate() {
    await query(`IF SCHEMA_ID('${schema}') IS NULL EXEC('CREATE SCHEMA ${S}')`);
    await query(`IF OBJECT_ID('${schema}.migration') IS NULL CREATE TABLE {S}.migration (name NVARCHAR(64) NOT NULL PRIMARY KEY, applied_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME())`);
    const done = new Set((await query('SELECT name FROM {S}.migration')).map((r) => r.name));
    const applied = [];
    for (const f of fs.readdirSync(MIGRATIONS).filter((x) => /^\d{3}-[\w-]+\.sql$/.test(x)).sort()) {
      if (done.has(f)) continue;
      const body = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
      await tx(async (q) => {
        // statements separated by blank-line-free semicolons at line ends; comments stay with them
        for (const stmt of body.split(/;\s*$/m).map((s) => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean)) await q(stmt);
        await q('INSERT INTO {S}.migration (name) VALUES (@f)', { f });
      });
      applied.push(f);
    }
    return applied;
  }
  /** drops the whole schema (tests only) */
  async function dropSchema() {
    if (schema === 'learn') throw new Error('Not the live schema');
    const tables = await query(`SELECT t.name FROM sys.tables t WHERE t.schema_id = SCHEMA_ID('${schema}')`);
    // foreign keys first, then tables
    const fks = await query(`SELECT f.name, OBJECT_NAME(f.parent_object_id) AS t FROM sys.foreign_keys f WHERE f.schema_id = SCHEMA_ID('${schema}')`);
    for (const fk of fks) await query(`ALTER TABLE {S}.[${fk.t}] DROP CONSTRAINT [${fk.name}]`);
    for (const t of tables) await query(`DROP TABLE {S}.[${t.name}]`);
    for (const s of await query(`SELECT name FROM sys.sequences WHERE schema_id = SCHEMA_ID('${schema}')`)) await query(`DROP SEQUENCE {S}.[${s.name}]`);
    await query(`IF SCHEMA_ID('${schema}') IS NOT NULL EXEC('DROP SCHEMA ${S}')`);
  }
  const close = async () => { if (pool) { const p = await pool; pool = null; await p.close(); } };
  return { query, tx, migrate, dropSchema, close, schema };
}

/** the live database from the site's settings, or null when they aren't set */
function dbFromEnv(env = process.env, schema = 'learn') {
  if (!env.LEARN_SQL_SERVER || !env.LEARN_SQL_PASSWORD) return null;
  return createDb({ server: env.LEARN_SQL_SERVER, database: env.LEARN_SQL_DATABASE || 'learn', user: env.LEARN_SQL_USER, password: env.LEARN_SQL_PASSWORD, schema });
}

module.exports = { createDb, dbFromEnv };
