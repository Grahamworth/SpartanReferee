'use strict';
/* The Learning & Competence platform's API, under /api/learn (the design doc: "Referee Learning Platform: proposed design").
   Who's asking: the site's own sign-in (a Microsoft account), tied to a person by person_login. Anyone in the organisation gets in
   (from 19 November 2026; admins only before): their first visit makes their own person record, holding just their name and address,
   with global_admin for an admin and no role (a learner) for a referee. Everyone else in it is invented (NFR-04).
   An admin can view the platform as any demo person (header X-Learn-As: <person id>): every check then uses that person's
   roles, and the audit log records both.

   GET  /api/learn/me                      -> { person, grants, actingAs, viewAs: [demo people] }
   GET  /api/learn/regions                 -> { regions }
   GET  /api/learn/people?q=&region=       -> { people }            admins, and coordinators for their regions
   POST /api/learn/people {legalName, email, ...}  -> { person, duplicates }   a demo person (admins, coordinators)
   GET  /api/learn/people/<id>             -> { person, editable, grants }
   PUT  /api/learn/people/<id> {fields}    -> { person }            only the fields this person may change
   POST /api/learn/roles {personId, role, programmeId?, regionId?}      admins; DELETE /api/learn/roles/<grant id>
   GET  /api/learn/duplicates              -> { flags }             POST /api/learn/duplicates/<id> {decision: not_duplicate}
   GET  /api/learn/audit?entityType=&entityId=  -> { events }       admins */
const crypto = require('node:crypto');
const P = require('./permissions');
const { createProgrammes } = require('./programmes');

const EMAIL = /^[^\s@/#?\\]+@[^\s@/#?\\]+\.[^\s@/#?\\]+$/;
const LOCALES = ['en', 'fr', 'de', 'nl', 'es', 'it', 'el', 'hr', 'cs', 'pl', 'fi', 'sv', 'da', 'ar', 'th'];
const text = (s, max) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const uuid = () => crypto.randomUUID();
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));

const personView = (p) => p && ({
  id: p.person_id, publicId: p.public_id, legalName: p.legal_name, preferredName: p.preferred_name || '', email: p.email,
  country: p.country || '', regionId: p.region_id || '', locale: p.locale, status: p.status, synthetic: !!p.synthetic,
  createdAt: p.created_at, updatedAt: p.updated_at,
});
const grantView = (g) => ({ id: g.grant_id, role: g.role, programmeId: g.programme_id || '', regionId: g.region_id || '', grantedAt: g.granted_at });

/**
 * member(session) -> { admin, email, name } for someone in the organisation (an admin, or a referee an admin added), else null.
 * Without it (the SQL tests), only admins come in, by their session's address.
 */
function createLearn({ db, session, isAdminEmail = () => false, member = null, reply }) {
  const memberOf = member || (async (me) => { const email = String(me.email || '').toLowerCase(); return email && isAdminEmail(email) ? { admin: true, email, name: String(me.name || '') } : null; });
  // ------------------------------------------------------------------ who's asking
  const loginOf = (me) => ({ provider: String(me.uid).startsWith('m_') ? 'microsoft' : 'dev', subject: String(me.uid) });
  async function grantsOf(personId) { return db.query('SELECT * FROM {S}.role_grant WHERE person_id = @id', { id: personId }); }
  async function personById(id) { return isUuid(id) ? (await db.query('SELECT * FROM {S}.person WHERE person_id = @id', { id }))[0] || null : null; }
  async function newPublicId(q) { const n = (await q('SELECT NEXT VALUE FOR {S}.person_seq AS n'))[0].n; return `SR-${String(n).padStart(6, '0')}`; }
  async function audit(q, who, action, entityType, entityId, summary, more = {}) {
    await q(`INSERT INTO {S}.audit_event (actor_id, acting_as, action, entity_type, entity_id, summary, programme_id, region_id, correlation_id)
             VALUES (@actor, @as, @action, @et, @eid, @summary, @prog, @region, @corr)`,
    { actor: who?.realId || null, as: who?.actingAs || null, action, et: entityType, eid: String(entityId), summary: JSON.stringify(summary), prog: more.programmeId || null, region: more.regionId || null, corr: who?.correlation || null });
  }
  /** the person behind this request: { person, grants, realId, actingAs } or a reply to send */
  async function who(h) {
    const me = session(h);
    if (!me) return { error: reply(401, { error: 'Sign in first' }) };
    const { provider, subject } = loginOf(me);
    let real = (await db.query('SELECT p.* FROM {S}.person_login l JOIN {S}.person p ON p.person_id = l.person_id WHERE l.provider = @provider AND l.subject = @subject', { provider, subject }))[0];
    // only the organisation's people, asked every time, so a referee taken off the list loses this too
    const m = await memberOf(me);
    if (!m) return { error: reply(403, { error: 'The learning platform is for Spartan\'s referees: ask an admin to add the address you sign in with' }) };
    const email = m.email;
    if (!real) {
      // their own record is made the first time they come: an admin as a global admin, a referee as a learner
      const id = uuid();
      real = await db.tx(async (q) => {
        await q(`INSERT INTO {S}.person (person_id, public_id, legal_name, email, locale, synthetic) VALUES (@id, @pub, @name, @email, 'en', 0)`,
          { id, pub: await newPublicId(q), name: text(m.name, 120) || email, email });
        await q('INSERT INTO {S}.person_login (provider, subject, person_id) VALUES (@provider, @subject, @id)', { provider, subject, id });
        if (m.admin) await q(`INSERT INTO {S}.role_grant (grant_id, person_id, role) VALUES (@g, @id, 'global_admin')`, { g: uuid(), id });
        await audit(q, { realId: id }, 'person.first-sign-in', 'person', id, { email, role: m.admin ? 'global_admin' : 'learner' });
        return (await q('SELECT * FROM {S}.person WHERE person_id = @id', { id }))[0];
      });
    }
    const realGrants = await grantsOf(real.person_id);
    const asId = h['x-learn-as'];
    if (asId && asId !== real.person_id) {
      if (!P.can(realGrants, 'view-as')) return { error: reply(403, { error: 'Only admins can view as someone else' }) };
      const as = await personById(asId);
      if (!as || !as.synthetic) return { error: reply(404, { error: 'No such demo person' }) };
      return { person: as, grants: await grantsOf(as.person_id), realId: real.person_id, actingAs: as.person_id, real };
    }
    return { person: real, grants: realGrants, realId: real.person_id, actingAs: null, real };
  }

  // ------------------------------------------------------------------ people
  async function listPeople(w, query) {
    if (!P.can(w.grants, 'person.list')) return reply(403, { error: 'You can only see your own profile' });
    const regions = P.regionsVisible(w.grants), q = text(query.q, 80).toLowerCase(), region = text(query.region, 32);
    if (regions !== 'all' && region && !regions.includes(region)) return reply(403, { error: 'That region isn\'t yours' });
    const where = ['p.status <> \'merged\''], params = {};
    if (regions !== 'all') { where.push(`p.region_id IN (${regions.map((r, i) => `@r${i}`).join(', ') || 'NULL'})`); regions.forEach((r, i) => { params[`r${i}`] = r; }); }
    if (region) { where.push('p.region_id = @region'); params.region = region; }
    if (q) { where.push('(LOWER(p.legal_name) LIKE @q OR LOWER(p.email) LIKE @q OR LOWER(p.public_id) LIKE @q)'); params.q = `%${q.replace(/[%_[]/g, '')}%`; }
    const rows = await db.query(`SELECT TOP 200 p.* FROM {S}.person p WHERE ${where.join(' AND ')} ORDER BY p.legal_name`, params);
    return reply(200, { people: rows.map(personView) });
  }
  function readPersonInput(b, fields) {
    const out = {};
    for (const f of fields) {
      const key = { legal_name: 'legalName', preferred_name: 'preferredName', email: 'email', country: 'country', region_id: 'regionId', locale: 'locale', status: 'status' }[f];
      if (b?.[key] === undefined) continue;
      const v = b[key];
      if (f === 'legal_name') { const s = text(v, 120); if (s.length < 2) return { error: 'What\'s their name?' }; out[f] = s; }
      if (f === 'preferred_name') out[f] = text(v, 80) || null;
      if (f === 'email') { const s = String(v).trim().toLowerCase(); if (s.length > 254 || !EMAIL.test(s)) return { error: 'That doesn\'t look like an email address' }; out[f] = s; }
      if (f === 'country') { const s = String(v).trim().toUpperCase(); if (s && !/^[A-Z]{2}$/.test(s)) return { error: 'A country is a two-letter code, like GB' }; out[f] = s || null; }
      if (f === 'region_id') out[f] = text(v, 32) || null;
      if (f === 'locale') { if (!LOCALES.includes(v)) return { error: 'That language isn\'t one of the site\'s' }; out[f] = v; }
      if (f === 'status') { if (!['active', 'suspended'].includes(v)) return { error: 'A person is active or suspended' }; out[f] = v; }
    }
    return { values: out };
  }
  async function regionExists(q, id) { return !id || (await q('SELECT 1 AS ok FROM {S}.region WHERE region_id = @id', { id })).length > 0; }
  async function createPerson(w, b) {
    const regionId = text(b?.regionId, 32) || null;
    if (!P.can(w.grants, 'person.create', { regionId: regionId || undefined })) return reply(403, { error: regionId ? 'You can\'t add people in that region' : 'Choose a region' });
    const input = readPersonInput(b, P.ADMIN_FIELDS);
    if (input.error) return reply(400, { error: input.error });
    const v = input.values;
    if (!v.legal_name || !v.email) return reply(400, { error: 'A name and an email address are needed' });
    const id = uuid();
    const out = await db.tx(async (q) => {
      if (!(await regionExists(q, v.region_id))) return { error: 'No such region' };
      await q(`INSERT INTO {S}.person (person_id, public_id, legal_name, preferred_name, email, country, region_id, locale, synthetic)
               VALUES (@id, @pub, @legal_name, @preferred_name, @email, @country, @region_id, @locale, 1)`,
      { id, pub: await newPublicId(q), legal_name: v.legal_name, preferred_name: v.preferred_name || null, email: v.email, country: v.country || null, region_id: v.region_id || null, locale: v.locale || 'en' });
      // possible duplicates: the same email, or the same name in the same region; flagged for a person who may merge (PER-05)
      const dups = await q(`SELECT person_id, public_id, legal_name, email FROM {S}.person WHERE person_id <> @id AND status <> 'merged'
                            AND (LOWER(email) = @email OR (LOWER(legal_name) = LOWER(@name) AND ISNULL(region_id, '') = ISNULL(@region, '')))`,
      { id, email: v.email, name: v.legal_name, region: v.region_id || null });
      for (const d of dups) await q('INSERT INTO {S}.duplicate_flag (flag_id, person_a, person_b, reason) VALUES (@f, @a, @b, @why)', { f: uuid(), a: d.person_id, b: id, why: d.email.toLowerCase() === v.email ? 'same email' : 'same name and region' });
      await audit(q, w, 'person.create', 'person', id, { values: v, duplicates: dups.map((d) => d.public_id) }, { regionId: v.region_id });
      return { person: (await q('SELECT * FROM {S}.person WHERE person_id = @id', { id }))[0], duplicates: dups };
    });
    if (out.error) return reply(400, { error: out.error });
    return reply(200, { person: personView(out.person), duplicates: out.duplicates.map((d) => ({ id: d.person_id, publicId: d.public_id, legalName: d.legal_name })) });
  }
  async function getPerson(w, id) {
    const p = await personById(id);
    if (!p || !P.can(w.grants, 'person.read', { regionId: p.region_id || undefined, personId: p.person_id, selfId: w.person.person_id })) return reply(404, { error: 'No such person, or not one you can see' });
    const editable = P.editableFields(w.grants, { regionId: p.region_id || undefined, personId: p.person_id, selfId: w.person.person_id });
    return reply(200, { person: personView(p), editable, grants: (await grantsOf(p.person_id)).map(grantView) });
  }
  async function editPerson(w, id, b) {
    const p = await personById(id);
    if (!p || !P.can(w.grants, 'person.read', { regionId: p.region_id || undefined, personId: p.person_id, selfId: w.person.person_id })) return reply(404, { error: 'No such person, or not one you can see' });
    const fields = P.editableFields(w.grants, { regionId: p.region_id || undefined, personId: p.person_id, selfId: w.person.person_id });
    const asked = Object.keys(b || {}), refused = asked.filter((k) => !fields.map((f) => ({ legal_name: 'legalName', preferred_name: 'preferredName', region_id: 'regionId' }[f] || f)).includes(k));
    if (refused.length) return reply(403, { error: `You can't change: ${refused.join(', ')}` });
    const input = readPersonInput(b, fields);
    if (input.error) return reply(400, { error: input.error });
    const v = input.values, keys = Object.keys(v);
    if (!keys.length) return reply(200, { person: personView(p) });
    // a coordinator can't move someone out of their own regions
    if ('region_id' in v && v.region_id && !P.can(w.grants, 'person.create', { regionId: v.region_id })) return reply(403, { error: 'You can\'t move people to that region' });
    const out = await db.tx(async (q) => {
      if ('region_id' in v && !(await regionExists(q, v.region_id))) return { error: 'No such region' };
      await q(`UPDATE {S}.person SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = SYSUTCDATETIME() WHERE person_id = @id`, { ...v, id: p.person_id });
      const before = Object.fromEntries(keys.map((k) => [k, p[k]]));
      await audit(q, w, 'person.edit', 'person', p.person_id, { before, after: v }, { regionId: v.region_id || p.region_id });
      return { person: (await q('SELECT * FROM {S}.person WHERE person_id = @id', { id: p.person_id }))[0] };
    });
    if (out.error) return reply(400, { error: out.error });
    return reply(200, { person: personView(out.person) });
  }

  // ------------------------------------------------------------------ roles, duplicates, audit
  async function grantRole(w, b) {
    if (!P.can(w.grants, 'role.grant')) return reply(403, { error: 'Only admins give roles' });
    const role = String(b?.role || ''), p = await personById(b?.personId);
    if (!P.ROLES.includes(role)) return reply(400, { error: 'No such role' });
    if (!p) return reply(404, { error: 'No such person' });
    const programmeId = text(b?.programmeId, 32) || null, regionId = text(b?.regionId, 32) || null;
    if (role === 'regional_coordinator' && !regionId) return reply(400, { error: 'A regional coordinator needs a region' });
    const id = uuid();
    await db.tx(async (q) => {
      await q('INSERT INTO {S}.role_grant (grant_id, person_id, role, programme_id, region_id, granted_by) VALUES (@id, @p, @role, @prog, @region, @by)', { id, p: p.person_id, role, prog: programmeId, region: regionId, by: w.person.person_id });
      await audit(q, w, 'role.grant', 'person', p.person_id, { role, programmeId, regionId }, { programmeId, regionId });
    });
    return reply(200, { grants: (await grantsOf(p.person_id)).map(grantView) });
  }
  async function removeRole(w, grantId) {
    if (!P.can(w.grants, 'role.grant')) return reply(403, { error: 'Only admins change roles' });
    const g = isUuid(grantId) && (await db.query('SELECT * FROM {S}.role_grant WHERE grant_id = @id', { id: grantId }))[0];
    if (!g) return reply(404, { error: 'No such role' });
    if (g.person_id === w.realId && g.role === 'global_admin') return reply(400, { error: 'You can\'t remove your own admin role' });
    await db.tx(async (q) => {
      await q('DELETE FROM {S}.role_grant WHERE grant_id = @id', { id: grantId });
      await audit(q, w, 'role.remove', 'person', g.person_id, { role: g.role, programmeId: g.programme_id, regionId: g.region_id }, { programmeId: g.programme_id, regionId: g.region_id });
    });
    return reply(200, { grants: (await grantsOf(g.person_id)).map(grantView) });
  }
  async function duplicates(w, method, id, b) {
    if (!P.can(w.grants, 'person.merge')) return reply(403, { error: 'Only admins review possible duplicates' });
    if (method === 'GET' && !id) {
      const rows = await db.query(`SELECT f.*, a.public_id AS a_pub, a.legal_name AS a_name, a.email AS a_email, b.public_id AS b_pub, b.legal_name AS b_name, b.email AS b_email
        FROM {S}.duplicate_flag f JOIN {S}.person a ON a.person_id = f.person_a JOIN {S}.person b ON b.person_id = f.person_b WHERE f.state = 'open' ORDER BY f.created_at DESC`);
      return reply(200, { flags: rows.map((r) => ({ id: r.flag_id, reason: r.reason, a: { id: r.person_a, publicId: r.a_pub, legalName: r.a_name, email: r.a_email }, b: { id: r.person_b, publicId: r.b_pub, legalName: r.b_name, email: r.b_email }, createdAt: r.created_at })) });
    }
    if (method === 'POST' && isUuid(id)) {
      if (b?.decision !== 'not_duplicate') return reply(400, { error: 'For now a flag can only be marked as not a duplicate; merging comes later' });
      await db.tx(async (q) => {
        await q('UPDATE {S}.duplicate_flag SET state = @s, decided_by = @by, decided_at = SYSUTCDATETIME() WHERE flag_id = @id', { s: 'not_duplicate', by: w.person.person_id, id });
        await audit(q, w, 'duplicate.decide', 'duplicate_flag', id, { decision: 'not_duplicate' });
      });
      return reply(200, { ok: true });
    }
    return null;
  }
  async function auditLog(w, query) {
    if (!P.can(w.grants, 'audit.read')) return reply(403, { error: 'Only admins read the audit log' });
    const where = [], params = {};
    if (query.entityType) { where.push('entity_type = @et'); params.et = text(query.entityType, 32); }
    if (query.entityId) { where.push('entity_id = @eid'); params.eid = text(query.entityId, 64); }
    const rows = await db.query(`SELECT TOP 200 e.*, a.public_id AS actor_pub, a.legal_name AS actor_name, s.legal_name AS as_name FROM {S}.audit_event e
      LEFT JOIN {S}.person a ON a.person_id = e.actor_id LEFT JOIN {S}.person s ON s.person_id = e.acting_as
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.audit_id DESC`, params);
    return reply(200, { events: rows.map((r) => ({ id: Number(r.audit_id), at: r.at, action: r.action, entityType: r.entity_type, entityId: r.entity_id, summary: JSON.parse(r.summary || '{}'), actor: r.actor_name || '', actingAs: r.as_name || '', programmeId: r.programme_id || '', regionId: r.region_id || '' })) });
  }

  // ------------------------------------------------------------------ the rest of the platform, one module each, sharing this context
  // (each can add hooks to it that the others call: programmes asks for a version's extras, progress and so on)
  const ctx = { db, reply, P, audit, uuid, text, isUuid, personById, personView, LOCALES };
  const areas = [createProgrammes(ctx)];

  // ------------------------------------------------------------------ routing
  async function handle(method, parts, body, h, query = {}) {
    const [, a, b, c] = parts; // parts[0] === 'learn'
    const w = await who(h); if (w.error) return w.error;
    w.correlation = crypto.randomBytes(8).toString('hex');
    if (a === 'me' && method === 'GET') {
      const viewAs = P.can(await grantsOf(w.realId), 'view-as')
        ? (await db.query('SELECT p.*, (SELECT STRING_AGG(role, \',\') FROM {S}.role_grant g WHERE g.person_id = p.person_id) AS roles FROM {S}.person p WHERE p.synthetic = 1 AND p.status <> \'merged\' ORDER BY p.legal_name'))
          .map((p) => ({ ...personView(p), roles: (p.roles || '').split(',').filter(Boolean) }))
        : [];
      return reply(200, { person: personView(w.person), grants: w.grants.map(grantView), actingAs: w.actingAs, real: personView(w.real), viewAs });
    }
    if (a === 'regions' && method === 'GET') return reply(200, { regions: (await db.query('SELECT * FROM {S}.region ORDER BY name')).map((r) => ({ id: r.region_id, name: r.name, countries: r.countries ? r.countries.split(',') : [] })) });
    if (a === 'people' && !b && method === 'GET') return listPeople(w, query);
    if (a === 'people' && !b && method === 'POST') return createPerson(w, body);
    if (a === 'people' && b && !c && method === 'GET') return getPerson(w, b);
    if (a === 'people' && b && !c && method === 'PUT') return editPerson(w, b, body);
    if (a === 'roles' && !b && method === 'POST') return grantRole(w, body);
    if (a === 'roles' && b && method === 'DELETE') return removeRole(w, b);
    if (a === 'duplicates') return duplicates(w, method, b, body);
    if (a === 'audit' && method === 'GET') return auditLog(w, query);
    for (const area of areas) { const r = await area.route(w, method, parts, body, query); if (r) return r; }
    return null;
  }
  return { handle, who };
}

module.exports = { createLearn, LOCALES };
