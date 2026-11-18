'use strict';
/* The learning platform's database: Azure SQL (LEARN_SQL_SERVER, LEARN_SQL_DATABASE, LEARN_SQL_USER, LEARN_SQL_PASSWORD).
   Every query is parameterised: values go in @names, never into the SQL text. {S} in the SQL is the schema, so the same
   statements run live ("learn") and in the integration tests ("learn_test"). migrate() applies migrations/NNN-*.sql once each,
   in order, inside a transaction. */
const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS = path.join(__dirname, 'migrations');
const SCHEMA = /^[a-z_]{1,32}$/;

function createDb({ server, database, user, password, schema = 'learn', sql = require('mssql') }) {
  if (!SCHEMA.test(schema)) throw new Error('bad schema name');
  const S = `[${schema}]`;
  let pool = null;
  const connect = () => (pool = pool || new sql.ConnectionPool({
    server, database, user, password,
    options: { encrypt: true, trustServerCertificate: false },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 60000, requestTimeout: 30000, // the free database pauses when idle: the first connection wakes it
  }).connect().catch((e) => { pool = null; throw e; }));
  const text = (q) => q.replace(/\{S\}/g, S);
  const bind = (req, params = {}) => { for (const [k, v] of Object.entries(params)) req.input(k, v === undefined ? null : v); return req; };
  /** rows of a query: query('SELECT * FROM {S}.person WHERE person_id = @id', { id }) */
  async function query(q, params) {
    const p = await connect();
    return (await bind(p.request(), params).query(text(q))).recordset || [];
  }
  /** several statements that succeed or fail together: tx(async (q) => { await q(...); await q(...); }) */
  async function tx(fn) {
    const p = await connect(), t = new sql.Transaction(p);
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
