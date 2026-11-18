'use strict';
/* Reports and the read API (step 6): programme and region dashboards with export, and documented, versioned read interfaces for other
   systems (ADM-01, ADM-02, INT-01, AT-10). Everything is scoped on the server: an admin sees everything, a programme owner their
   programme, a regional coordinator people in their regions only (NFR-01).

   GET /api/learn/reports?programme=&region=      -> { scope, programmes: [...counts], regions: [...counts], expiring: [...] }
   GET /api/learn/reports/export?programme=&region= -> { filename, csv }  one row per person and programme, in the same scope
   Read API, version 1 (docs/learning/api.md): the same sign-in and scopes, stable field names, apiVersion on every answer.
   GET /api/learn/v1/people/<id or SR-number>             -> { apiVersion, person }
   GET /api/learn/v1/people/<id or SR-number>/enrolments  -> { apiVersion, enrolments }
   GET /api/learn/v1/people/<id or SR-number>/credentials -> { apiVersion, credentials }
   GET /api/learn/v1/credentials/<id or DEMO-number>      -> { apiVersion, credential }   is this credential valid, now?
   GET /api/learn/v1/rules/<rule id>                      -> { apiVersion, rule }          the current version of a rule */
function createReports(ctx) {
  const { db, reply, P, text, isUuid } = ctx;
  const API_VERSION = 'v1';

  /** what this person may report on: { all } or { programmes: [...] } and/or { regions: [...] }; null when nothing */
  async function scopeOf(w) {
    if (P.can(w.grants, 'programme.create')) return { all: true };
    const programmes = w.grants.filter((g) => g.role === 'programme_owner' && g.programme_id).map((g) => g.programme_id);
    const regions = w.grants.filter((g) => g.role === 'regional_coordinator' && g.region_id).map((g) => g.region_id);
    return programmes.length || regions.length ? { programmes, regions } : null;
  }
  /** the SQL condition for rows of person p in programme e.programme_id, in that scope */
  function scopeWhere(scope, params, { prog = 'e.programme_id', region = 'p.region_id' } = {}) {
    if (scope.all) return '1 = 1';
    const parts = [];
    if (scope.programmes.length) { parts.push(`${prog} IN (${scope.programmes.map((x, i) => { params[`sp${i}`] = x; return `@sp${i}`; }).join(', ')})`); }
    if (scope.regions.length) { parts.push(`${region} IN (${scope.regions.map((x, i) => { params[`sr${i}`] = x; return `@sr${i}`; }).join(', ')})`); }
    return `(${parts.join(' OR ')})`;
  }
  const status = (c) => ctx.credView(c).status;

  async function report(w, query) {
    const scope = await scopeOf(w); if (!scope) return reply(403, { error: 'Reports are for admins, programme owners and regional coordinators' });
    const params = {}, where = [scopeWhere(scope, params)];
    const prog = text(query.programme, 32), region = text(query.region, 32);
    if (prog) { where.push('e.programme_id = @prog'); params.prog = prog; }
    if (region) { where.push('p.region_id = @region'); params.region = region; }
    const W = where.join(' AND ');
    const enrol = await db.query(`SELECT e.programme_id, ISNULL(p.region_id, '') AS region_id, e.state, COUNT(*) AS n FROM {S}.enrolment e JOIN {S}.person p ON p.person_id = e.person_id WHERE ${W} GROUP BY e.programme_id, p.region_id, e.state`, params);
    const done = await db.query(`SELECT c.programme_id AS programme_id, ISNULL(p.region_id, '') AS region_id, COUNT(*) AS n FROM {S}.completion c JOIN {S}.enrolment e ON e.enrolment_id = c.enrolment_id JOIN {S}.person p ON p.person_id = c.person_id WHERE ${W} AND c.preview = 0 GROUP BY c.programme_id, p.region_id`, params);
    const tries = await db.query(`SELECT t.programme_id AS programme_id, ISNULL(p.region_id, '') AS region_id, t.result, COUNT(*) AS n FROM {S}.attempt t JOIN {S}.enrolment e ON e.enrolment_id = t.enrolment_id JOIN {S}.person p ON p.person_id = t.person_id WHERE ${W} AND t.result <> 'open' GROUP BY t.programme_id, p.region_id, t.result`, params);
    // (the credential query calls the person r and the programme p)
    const cp = {}, cw = [scopeWhere(scope, cp, { prog: 'c.programme_id', region: 'r.region_id' })];
    if (prog) { cw.push('c.programme_id = @prog'); cp.prog = prog; }
    if (region) { cw.push('r.region_id = @region'); cp.region = region; }
    const creds = await db.query(`${ctx.credQuery} WHERE ${cw.join(' AND ')} AND c.status <> 'superseded'`, cp);
    const progs = await db.query('SELECT programme_id, title FROM {S}.programme ORDER BY title');
    const regions = await db.query('SELECT region_id, name FROM {S}.region ORDER BY name');
    const empty = () => ({ enrolled: 0, active: 0, completed: 0, withdrawn: 0, lessonsCompleted: 0, passed: 0, failed: 0, pending: 0, credentials: { active: 0, due: 0, expired: 0, suspended: 0, revoked: 0, superseded: 0 } });
    const add = (into, key) => (into[key] = into[key] || empty());
    const byProg = {}, byRegion = {};
    for (const r of enrol) for (const t of [add(byProg, r.programme_id), add(byRegion, r.region_id)]) { t.enrolled += r.n; t[r.state] = (t[r.state] || 0) + r.n; }
    for (const r of done) for (const t of [add(byProg, r.programme_id), add(byRegion, r.region_id)]) t.lessonsCompleted += r.n;
    for (const r of tries) for (const t of [add(byProg, r.programme_id), add(byRegion, r.region_id)]) t[{ pass: 'passed', fail: 'failed', pending: 'pending' }[r.result]] += r.n;
    for (const c of creds) { const s = status(c); for (const t of [add(byProg, c.programme_id), add(byRegion, c.region_id || '')]) t.credentials[s] = (t.credentials[s] || 0) + 1; }
    const expiring = creds.map((c) => ({ c, v: ctx.credView(c) })).filter(({ v }) => v.status === 'due' || v.status === 'expired')
      .sort((a, b) => new Date(a.v.expiresAt) - new Date(b.v.expiresAt))
      .map(({ c, v }) => ({ id: v.id, publicId: v.publicId, person: c.legal_name, personPublicId: c.person_public_id, region: regions.find((r) => r.region_id === c.region_id)?.name || '', programme: c.programme_title, status: v.status, expiresAt: v.expiresAt }));
    return reply(200, {
      scope: scope.all ? { all: true } : { programmes: scope.programmes, regions: scope.regions },
      filters: { programme: prog, region },
      programmes: progs.filter((p) => byProg[p.programme_id]).map((p) => ({ id: p.programme_id, title: p.title, ...byProg[p.programme_id] })),
      regions: Object.entries(byRegion).map(([id, t]) => ({ id, name: regions.find((r) => r.region_id === id)?.name || 'No region', ...t })).sort((a, b) => a.name.localeCompare(b.name)),
      expiring,
      options: { programmes: progs.filter((p) => scope.all || scope.programmes.includes(p.programme_id) || scope.regions.length).map((p) => ({ id: p.programme_id, title: p.title })),
        regions: regions.filter((r) => scope.all || scope.regions.includes(r.region_id) || scope.programmes.length).map((r) => ({ id: r.region_id, name: r.name })) },
    });
  }

  // one row per person and programme, in the same scope (ADM-02: exports never reach beyond it)
  async function exportCsv(w, query) {
    const scope = await scopeOf(w); if (!scope) return reply(403, { error: 'Reports are for admins, programme owners and regional coordinators' });
    const params = {}, where = [scopeWhere(scope, params)];
    if (query.programme) { where.push('e.programme_id = @prog'); params.prog = text(query.programme, 32); }
    if (query.region) { where.push('p.region_id = @region'); params.region = text(query.region, 32); }
    const rows = await db.query(`SELECT p.public_id, p.legal_name, p.email, ISNULL(p.region_id, '') AS region_id, p.synthetic, e.programme_id, v.edition, e.state, e.enrolled_at, e.completed_at,
        (SELECT COUNT(*) FROM {S}.completion c WHERE c.enrolment_id = e.enrolment_id AND c.preview = 0) AS lessons,
        (SELECT TOP 1 CASE WHEN t.max_score > 0 THEN 100 * t.score / t.max_score END FROM {S}.attempt t WHERE t.enrolment_id = e.enrolment_id AND t.result IN ('pass', 'fail') ORDER BY t.submitted_at DESC) AS last_score
      FROM {S}.enrolment e JOIN {S}.person p ON p.person_id = e.person_id JOIN {S}.programme_version v ON v.version_id = e.version_id WHERE ${where.join(' AND ')} ORDER BY e.programme_id, p.legal_name`, params);
    const creds = await db.query(`${ctx.credQuery} WHERE c.status <> 'superseded'`);
    const cell = (v) => { const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = ['person', 'name', 'email', 'region', 'invented', 'programme', 'edition', 'enrolment', 'enrolled', 'completed', 'lessons completed', 'last score %', 'credential', 'credential status', 'expires'];
    const lines = rows.map((r) => {
      const c = creds.filter((x) => x.public_id && x.person_public_id === r.public_id && x.programme_id === r.programme_id).sort((a, b) => new Date(b.issued_at) - new Date(a.issued_at))[0];
      const v = c ? ctx.credView(c) : null;
      return [r.public_id, r.legal_name, r.email, r.region_id, r.synthetic ? 'yes' : 'no', r.programme_id, r.edition, r.state, r.enrolled_at, r.completed_at, r.lessons, r.last_score, v?.publicId, v?.status, v?.expiresAt ? new Date(v.expiresAt) : ''].map(cell).join(',');
    });
    await ctx.audit(db.query, w, 'report.export', 'report', 'learning', { rows: rows.length, programme: query.programme || null, region: query.region || null });
    return reply(200, { filename: `learning-report-${new Date().toISOString().slice(0, 10)}.csv`, csv: [head.join(','), ...lines].join('\n'), rows: rows.length });
  }

  // ------------------------------------------------------------------ the read API (INT-01)
  async function personFor(w, key) {
    const p = isUuid(key) ? await ctx.personById(key) : /^SR-\d{6}$/.test(String(key)) ? (await db.query('SELECT * FROM {S}.person WHERE public_id = @k', { k: key }))[0] : null;
    if (!p || !P.can(w.grants, 'person.read', { regionId: p.region_id || undefined, personId: p.person_id, selfId: w.person.person_id })) return null;
    return p;
  }
  async function v1(w, parts) {
    const [, , a, b, c] = parts; // learn, v1, ...
    const out = (body) => reply(200, { apiVersion: API_VERSION, ...body });
    if (a === 'people' && b) {
      const p = await personFor(w, b); if (!p) return reply(404, { apiVersion: API_VERSION, error: 'No such person, or not one you can see' });
      if (!c) {
        const roles = await db.query('SELECT * FROM {S}.programme_role WHERE person_id = @p', { p: p.person_id });
        return out({ person: { id: p.person_id, publicId: p.public_id, name: p.preferred_name || p.legal_name, regionId: p.region_id || null, country: p.country || null, status: p.status, invented: !!p.synthetic,
          programmeRoles: roles.map((r) => ({ programmeId: r.programme_id, role: r.role, grade: r.grade || null, status: r.status })) } });
      }
      if (c === 'enrolments') {
        const rows = await db.query('SELECT e.*, v.edition FROM {S}.enrolment e JOIN {S}.programme_version v ON v.version_id = e.version_id WHERE e.person_id = @p ORDER BY e.enrolled_at', { p: p.person_id });
        return out({ enrolments: await Promise.all(rows.map(async (e) => ({ id: e.enrolment_id, programmeId: e.programme_id, edition: e.edition, versionId: e.version_id, state: e.state, enrolledAt: e.enrolled_at, completedAt: e.completed_at, progress: ctx.progressOf ? await ctx.progressOf(e).then((x) => ({ lessons: x.lessons, done: x.done })) : null }))) });
      }
      if (c === 'credentials') {
        const rows = await db.query(`${ctx.credQuery} WHERE c.person_id = @p ORDER BY c.issued_at DESC`, { p: p.person_id });
        return out({ credentials: rows.map((x) => { const v = ctx.credView(x); return { id: v.id, publicId: v.publicId, programmeId: v.programmeId, edition: v.edition, qualification: v.qualification, status: v.status, valid: v.status === 'active' || v.status === 'due', issuedAt: v.issuedAt, expiresAt: v.expiresAt, demonstration: v.demonstration }; }) });
      }
    }
    if (a === 'credentials' && b && !c) {
      const x = (await db.query(`${ctx.credQuery} WHERE ${isUuid(b) ? 'c.credential_id = @k' : 'c.public_id = @k'}`, { k: String(b) }))[0];
      if (!x || !(x.person_id === w.person.person_id || P.can(w.grants, 'person.read', { regionId: x.region_id || undefined }) || P.can(w.grants, 'credential.change', { programmeId: x.programme_id }))) return reply(404, { apiVersion: API_VERSION, error: 'No such credential' });
      const v = ctx.credView(x);
      return out({ credential: { id: v.id, publicId: v.publicId, personPublicId: x.person_public_id, programmeId: v.programmeId, edition: v.edition, qualification: v.qualification, status: v.status, valid: v.status === 'active' || v.status === 'due', issuedAt: v.issuedAt, expiresAt: v.expiresAt, demonstration: v.demonstration } });
    }
    if (a === 'rules' && b && !c) {
      const r = (await db.query("SELECT TOP 1 r.*, d.title AS doc_title, d.edition AS doc_edition, d.approval FROM {S}.rule_ref r JOIN {S}.rule_document d ON d.doc_id = r.doc_id WHERE r.rule_id = @r AND r.state = 'approved' ORDER BY r.version_no DESC", { r: String(b) }))[0];
      if (!r) return reply(404, { apiVersion: API_VERSION, error: 'No such rule reference' });
      return out({ rule: { id: r.rule_id, versionNo: r.version_no, section: r.section, title: r.title, excerpt: r.excerpt, document: `${r.doc_title} ${r.doc_edition}`, documentApproval: r.approval, effectiveDate: r.effective_date } });
    }
    return reply(404, { apiVersion: API_VERSION, error: 'Not part of the read API: see docs/learning/api.md' });
  }

  async function route(w, method, parts, body, query) {
    const [, a, b] = parts;
    if (a === 'reports' && !b && method === 'GET') return report(w, query);
    if (a === 'reports' && b === 'export' && method === 'GET') return exportCsv(w, query);
    if (a === 'v1' && method === 'GET') return v1(w, parts);
    return null;
  }
  return { route };
}

module.exports = { createReports };
