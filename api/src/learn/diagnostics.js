'use strict';
/* Diagnostics for the technical administrator (the brief's section 4: "operate platform, integrations and diagnostics without default
   access to personal profiles or assessment answers"), and for global admins. Everything here is a count, a setting's on/off or a
   time: no names, addresses, answers or audit details. Recent errors have ids and addresses masked before they're kept.

   GET /api/learn/diagnostics -> { checkedAt, instance, database, migrations, tables, activity, narration, errors } */
const fs = require('node:fs');
const path = require('node:path');
const { DAILY_CHARS } = require('./media');

const MIGRATIONS = path.join(__dirname, 'migrations');
const TABLES = ['person', 'person_login', 'role_grant', 'region', 'programme', 'programme_version', 'module', 'lesson', 'enrolment', 'lesson_progress',
  'completion', 'content_version', 'question', 'assessment', 'attempt', 'credential', 'rule_ref', 'rule_link', 'review_item', 'media_asset', 'audit_event'];
const KEEP_ERRORS = 20;

/** an error's first line and the request, with anything that could name someone taken out */
function mask(s) {
  return String(s || '')
    .replace(/[^\s@'"(),]+@[^\s@'"(),]+/g, '<address>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\b(SR|DEMO)-\d+\b/g, '<number>')
    .replace(/\((?:[^()]{0,200})\)\.?$/, '(<value>)') // SQL's "The duplicate key value is (…)."
    .slice(0, 300);
}

function createDiagnostics(ctx, { speech = null, mediaSigner = null } = {}) {
  const { db, reply, P } = ctx;
  const startedAt = new Date().toISOString();
  const errors = [];
  let waking = 0;
  // core.js tells us about each failed or waking request
  ctx.noteError = (e, method, url) => {
    errors.unshift({ at: new Date().toISOString(), request: `${method} ${mask(url)}`, error: mask(String((e && e.message) || e).split('\n')[0]) });
    errors.length = Math.min(errors.length, KEEP_ERRORS);
  };
  ctx.noteWaking = () => { waking++; };

  async function diagnostics(w) {
    if (!P.can(w.grants, 'diagnostics.read')) return reply(403, { error: 'Diagnostics are for technical administrators and global admins' });
    const t0 = Date.now();
    const info = (await db.query(`SELECT CURRENT_USER AS login, DB_NAME() AS name, CAST(DATABASEPROPERTYEX(DB_NAME(), 'Edition') AS NVARCHAR(60)) AS edition,
      CAST(DATABASEPROPERTYEX(DB_NAME(), 'ServiceObjective') AS NVARCHAR(60)) AS tier, SYSUTCDATETIME() AS now`))[0];
    const roundTripMs = Date.now() - t0;
    const applied = await db.query('SELECT name, applied_at FROM {S}.migration ORDER BY name');
    const files = fs.readdirSync(MIGRATIONS).filter((x) => /^\d{3}-[\w-]+\.sql$/.test(x)).sort();
    const done = new Set(applied.map((r) => r.name));
    const counts = (await db.query(TABLES.map((t) => `SELECT '${t}' AS t, COUNT_BIG(*) AS n FROM {S}.${t}`).join(' UNION ALL ')))
      .reduce((o, r) => ({ ...o, [r.t]: Number(r.n) }), {});
    const people = await db.query("SELECT status, synthetic, COUNT(*) AS n FROM {S}.person GROUP BY status, synthetic");
    const actions = await db.query('SELECT action, COUNT(*) AS n, MAX(at) AS last FROM {S}.audit_event WHERE at > DATEADD(day, -7, SYSUTCDATETIME()) GROUP BY action ORDER BY COUNT(*) DESC');
    const signIns = (await db.query("SELECT COUNT(DISTINCT actor_id) AS n FROM {S}.audit_event WHERE at > DATEADD(day, -7, SYSUTCDATETIME()) AND actor_id IS NOT NULL"))[0].n;
    const media = (await db.query("SELECT ISNULL(SUM(CASE WHEN created_at > DATEADD(day, -1, SYSUTCDATETIME()) THEN chars END), 0) AS today, COUNT(*) AS clips, ISNULL(SUM(chars), 0) AS total FROM {S}.media_asset"))[0];
    const providers = await db.query('SELECT scope, provider FROM {S}.media_config ORDER BY scope');
    return reply(200, {
      checkedAt: new Date().toISOString(),
      instance: { startedAt, node: process.version, wakingAnswers: waking },
      database: { ok: true, roundTripMs, name: info.name, schema: db.schema, login: info.login, edition: info.edition, tier: info.tier, serverTime: info.now },
      migrations: { applied: applied.map((r) => ({ name: r.name, at: r.applied_at })), pending: files.filter((f) => !done.has(f)) },
      tables: counts,
      people: people.map((r) => ({ status: r.status, invented: !!r.synthetic, n: r.n })),
      activity: { days: 7, activePeople: signIns, actions: actions.map((r) => ({ action: r.action, n: r.n, last: r.last })) },
      narration: { azureSpeech: !!(speech && speech.key && speech.region), storage: !!mediaSigner, region: speech?.region || '', last24hChars: Number(media.today), dailyLimit: DAILY_CHARS, clips: media.clips, totalChars: Number(media.total), providers: providers.map((r) => ({ scope: r.scope, provider: r.provider })) },
      errors,
    });
  }

  return {
    async route(w, method, parts) {
      if (parts[1] === 'diagnostics' && parts.length === 2 && method === 'GET') return diagnostics(w);
      return null;
    },
  };
}

module.exports = { createDiagnostics, mask };
