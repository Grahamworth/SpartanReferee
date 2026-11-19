'use strict';
/* Invites (19 November 2026): nobody joins SpartanReferee except by an admin's invite. The admin gives one address or many (pasted), what
   type of user they are (their roles), which programmes they must do (with a complete-by date), and optionally their name, region and a
   message. Each gets an email with a link to join.html; there they give their full name, region and language, and sign in with Google,
   Microsoft or a code emailed to the invited address. Accepting puts them on the referee list (core.js), makes their learning record with
   those roles, and enrols them. A link works for 30 days; resending makes a new one (the old one stops working).

   POST /api/learn/invites {emails, grants: [{role, programmeId?, regionId?}], programmes: [{id, due?}], name?, regionId?, message?}
                                                -> { created, skipped: [{email, why}], failed: [{email, error}] }      admins
   GET  /api/learn/invites?state=&q=            -> { invites }            admins: newest first (pending, expired, accepted, revoked)
   GET  /api/learn/invites/options              -> { roles, programmes, regions }   for the invite form
   POST /api/learn/invites/<id>/resend | /revoke
   and, for core.js (before the person is in): info(token), accept(token, login, form), pending(email) */
const crypto = require('node:crypto');
const { layout } = require('../mailer');

const DAYS = 30;
const MAX = 500;
const ROLES = ['learner', 'regional_coordinator', 'assessor', 'programme_owner', 'content_editor', 'technical_admin', 'global_admin'];
const NEEDS_PROGRAMME = new Set(['assessor', 'programme_owner', 'content_editor']);
const EMAIL = /^[^\s@/#?\\|]+@[^\s@/#?\\|]+\.[^\s@/#?\\|]+$/;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const day = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : null);

function createInvites(ctx) {
  const { db, reply, P, audit, uuid, text, isUuid, LOCALES } = ctx;
  const parseList = (raw) => [...new Set((Array.isArray(raw) ? raw.join('\n') : String(raw || '')).split(/[\s,;]+/).map((e) => e.trim().toLowerCase().replace(/^<|>$/g, '')).filter(Boolean))];
  const view = (i, names = new Map()) => ({
    id: i.invite_id, email: i.email, name: i.legal_name || '', regionId: i.region_id || '', grants: JSON.parse(i.grants), programmes: JSON.parse(i.programmes),
    message: i.message, state: i.state === 'pending' && new Date(i.expires_at) < new Date() ? 'expired' : i.state,
    createdAt: i.created_at, expiresAt: i.expires_at, sentCount: i.sent_count, lastSentAt: i.last_sent_at, sendError: i.send_error || '',
    acceptedAt: i.accepted_at, personId: i.person_id || '', invitedBy: names.get(String(i.invited_by || '').toLowerCase()) || '',
  });

  /** what the admin asked for, checked: { grants, programmes } or { error } */
  async function readAsk(b) {
    const regions = new Set((await db.query('SELECT region_id FROM {S}.region')).map((r) => r.region_id));
    const progs = new Map((await db.query("SELECT programme_id, title FROM {S}.programme WHERE status = 'active'")).map((p) => [p.programme_id, p.title]));
    const grants = [];
    for (const g of Array.isArray(b?.grants) ? b.grants.slice(0, 10) : []) {
      const role = String(g?.role || '');
      if (!ROLES.includes(role)) return { error: 'Choose a type of user' };
      if (role === 'learner') continue; // a referee: no role beyond the programmes
      const programmeId = NEEDS_PROGRAMME.has(role) ? String(g.programmeId || '') : null, regionId = role === 'regional_coordinator' ? String(g.regionId || '') : null;
      if (NEEDS_PROGRAMME.has(role) && !progs.has(programmeId)) return { error: 'Choose the programme for that role' };
      if (role === 'regional_coordinator' && !regions.has(regionId)) return { error: 'Choose the region they coordinate' };
      grants.push({ role, ...(programmeId ? { programmeId } : {}), ...(regionId ? { regionId } : {}) });
    }
    const programmes = [];
    for (const p of Array.isArray(b?.programmes) ? b.programmes.slice(0, 20) : []) {
      if (!progs.has(String(p?.id || ''))) return { error: 'One of the programmes doesn\'t exist' };
      programmes.push({ id: String(p.id), title: progs.get(String(p.id)), due: day(p.due) });
    }
    const regionId = b?.regionId ? String(b.regionId) : null;
    if (regionId && !regions.has(regionId)) return { error: 'No such region' };
    return { grants, programmes, regionId };
  }

  async function sendInvite(inv, token, inviter) {
    const link = `${ctx.siteUrl}/join.html?t=${token}`;
    const mail = layout({
      title: 'You\'re invited to SpartanReferee',
      lines: [
        `${inviter || 'An admin'} has invited you to SpartanReferee: Spartan's site for its referees, with your events, your training and the burpee cameras.`,
        ...(inv.message ? [inv.message] : []),
        `Register with this address (${inv.email}), or with your Google or Microsoft account. You'll give your full name, region and language.`,
      ],
      link, linkText: 'Register', foot: `This link works for ${DAYS} days. If you weren't expecting it, you can ignore this email.`,
    });
    try {
      await ctx.mailer.send({ to: inv.email, subject: 'You\'re invited to SpartanReferee', ...mail });
      await db.query('UPDATE {S}.invite SET sent_count = sent_count + 1, last_sent_at = SYSUTCDATETIME(), send_error = NULL WHERE invite_id = @id', { id: inv.invite_id });
      return null;
    } catch (e) {
      await db.query('UPDATE {S}.invite SET send_error = @err WHERE invite_id = @id', { id: inv.invite_id, err: String(e.message).slice(0, 300) });
      return e.message;
    }
  }
  /** a few at a time, so hundreds go out quickly */
  async function pool(items, n, each) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await each(items[i++]); })); }

  async function create(w, b) {
    if (!P.can(w.grants, 'person.invite')) return reply(403, { error: 'Only admins invite people' });
    if (!ctx.mailer) return reply(503, { error: 'Email isn\'t set up on the server, so invites can\'t be sent' });
    const emails = parseList(b?.emails);
    if (!emails.length) return reply(400, { error: 'Give at least one email address' });
    if (emails.length > MAX) return reply(400, { error: `Up to ${MAX} addresses at a time` });
    const ask = await readAsk(b); if (ask.error) return reply(400, { error: ask.error });
    const name = emails.length === 1 ? text(b?.name, 120) || null : null;
    const skipped = [], made = [];
    const people = new Set((await db.query("SELECT LOWER(email) AS e FROM {S}.person WHERE synthetic = 0 AND status = 'active'")).map((r) => r.e));
    const open = new Set((await db.query("SELECT LOWER(email) AS e FROM {S}.invite WHERE state = 'pending' AND expires_at > SYSUTCDATETIME()")).map((r) => r.e));
    for (const email of emails) {
      if (email.length > 254 || !EMAIL.test(email)) { skipped.push({ email, why: 'not an email address' }); continue; }
      if (people.has(email)) { skipped.push({ email, why: 'already registered' }); continue; }
      if (open.has(email)) { skipped.push({ email, why: 'already invited: resend it from the list' }); continue; }
      const token = crypto.randomBytes(24).toString('base64url'), id = uuid();
      await db.query(`INSERT INTO {S}.invite (invite_id, email, token_hash, legal_name, region_id, grants, programmes, message, invited_by, expires_at)
        VALUES (@id, @email, @hash, @name, @region, @grants, @progs, @msg, @by, DATEADD(day, ${DAYS}, SYSUTCDATETIME()))`,
      { id, email, hash: sha(token), name, region: ask.regionId, grants: JSON.stringify(ask.grants), progs: JSON.stringify(ask.programmes.map(({ id: pid, due }) => ({ id: pid, due }))), msg: text(b?.message, 1000), by: w.real.person_id });
      open.add(email);
      made.push({ invite_id: id, email, message: text(b?.message, 1000), token });
    }
    const inviter = w.real.preferred_name || w.real.legal_name;
    const failed = [];
    await pool(made, 8, async (inv) => { const err = await sendInvite(inv, inv.token, inviter); if (err) failed.push({ email: inv.email, error: err }); });
    if (made.length) await audit(db.query, w, 'invite.create', 'invite', made[0].invite_id, { count: made.length, roles: ask.grants.map((g) => g.role), programmes: ask.programmes.map((p) => p.id) });
    return reply(200, { created: made.length, skipped, failed });
  }

  async function list(w, query) {
    if (!P.can(w.grants, 'person.invite')) return reply(403, { error: 'Only admins see the invites' });
    const where = [], params = {};
    const q = text(query.q, 100).toLowerCase();
    if (q) { where.push('(LOWER(i.email) LIKE @q OR LOWER(ISNULL(i.legal_name, \'\')) LIKE @q)'); params.q = `%${q.replace(/[%_[]/g, '')}%`; }
    if (query.state === 'pending') where.push("i.state = 'pending' AND i.expires_at > SYSUTCDATETIME()");
    else if (query.state === 'expired') where.push("i.state = 'pending' AND i.expires_at <= SYSUTCDATETIME()");
    else if (['accepted', 'revoked'].includes(query.state)) { where.push('i.state = @st'); params.st = query.state; }
    const rows = await db.query(`SELECT TOP 1000 i.* FROM {S}.invite i${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY i.created_at DESC`, params);
    const names = new Map((await db.query('SELECT person_id, legal_name, preferred_name FROM {S}.person WHERE synthetic = 0')).map((p) => [String(p.person_id).toLowerCase(), p.preferred_name || p.legal_name]));
    const counts = (await db.query(`SELECT SUM(CASE WHEN state = 'pending' AND expires_at > SYSUTCDATETIME() THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN state = 'pending' AND expires_at <= SYSUTCDATETIME() THEN 1 ELSE 0 END) AS expired,
      SUM(CASE WHEN state = 'accepted' THEN 1 ELSE 0 END) AS accepted, SUM(CASE WHEN state = 'revoked' THEN 1 ELSE 0 END) AS revoked FROM {S}.invite`))[0];
    return reply(200, { invites: rows.map((i) => view(i, names)), counts });
  }

  async function act(w, id, action) {
    if (!P.can(w.grants, 'person.invite')) return reply(403, { error: 'Only admins change invites' });
    const inv = isUuid(id) && (await db.query('SELECT * FROM {S}.invite WHERE invite_id = @id', { id }))[0];
    if (!inv) return reply(404, { error: 'No such invite' });
    if (inv.state !== 'pending') return reply(409, { error: inv.state === 'accepted' ? 'They\'ve already registered' : 'That invite was cancelled' });
    if (action === 'revoke') {
      await db.query("UPDATE {S}.invite SET state = 'revoked' WHERE invite_id = @id", { id });
      await audit(db.query, w, 'invite.revoke', 'invite', id, { email: inv.email });
      return reply(200, { ok: true });
    }
    if (!ctx.mailer) return reply(503, { error: 'Email isn\'t set up on the server' });
    const token = crypto.randomBytes(24).toString('base64url');
    await db.query(`UPDATE {S}.invite SET token_hash = @hash, expires_at = DATEADD(day, ${DAYS}, SYSUTCDATETIME()) WHERE invite_id = @id`, { id, hash: sha(token) });
    const err = await sendInvite(inv, token, w.real.preferred_name || w.real.legal_name);
    await audit(db.query, w, 'invite.resend', 'invite', id, { email: inv.email });
    return err ? reply(502, { error: `The email couldn't be sent: ${err}` }) : reply(200, { ok: true });
  }

  async function options(w) {
    if (!P.can(w.grants, 'person.invite')) return reply(403, { error: 'Only admins invite people' });
    return reply(200, {
      roles: ROLES, needsProgramme: [...NEEDS_PROGRAMME],
      programmes: (await db.query("SELECT programme_id, title FROM {S}.programme WHERE status = 'active' ORDER BY title")).map((p) => ({ id: p.programme_id, title: p.title })),
      regions: (await db.query('SELECT region_id, name FROM {S}.region ORDER BY name')).map((r) => ({ id: r.region_id, name: r.name })),
    });
  }

  // ------------------------------------------------------------------ for core.js: the join page, before the person is in
  const byToken = async (token) => (/^[\w-]{20,64}$/.test(String(token || '')) ? (await db.query('SELECT * FROM {S}.invite WHERE token_hash = @h', { h: sha(token) }))[0] || null : null);
  const stateOf = (inv) => (inv.state === 'pending' && new Date(inv.expires_at) < new Date() ? 'expired' : inv.state);
  /** what the join page shows */
  async function info(token) {
    const inv = await byToken(token); if (!inv) return { error: 404 };
    const progs = JSON.parse(inv.programmes);
    const titles = new Map((await db.query('SELECT programme_id, title FROM {S}.programme')).map((p) => [p.programme_id, p.title]));
    const by = inv.invited_by && await ctx.personById(inv.invited_by);
    return {
      state: stateOf(inv), email: inv.email, name: inv.legal_name || '', regionId: inv.region_id || '',
      roles: JSON.parse(inv.grants).map((g) => g.role), programmes: progs.map((p) => ({ id: p.id, title: titles.get(p.id) || p.id, due: p.due })),
      invitedBy: by ? by.preferred_name || by.legal_name : '', expiresAt: inv.expires_at,
      regions: (await db.query('SELECT region_id, name FROM {S}.region ORDER BY name')).map((r) => ({ id: r.region_id, name: r.name })), languages: LOCALES,
    };
  }
  /** is there an open invite for this address? (a sign-in code may go to it) */
  const pending = async (email) => (await db.query("SELECT TOP 1 1 AS x FROM {S}.invite WHERE email = @e AND state = 'pending' AND expires_at > SYSUTCDATETIME()", { e: String(email).toLowerCase() })).length > 0;

  /** registering from an invite, signed in (login: { provider, subject, email }) with the form's name, region and language:
   *  -> { personId, grants, invitedByEmail, locale } or { error: [status, message] } */
  async function accept(token, login, form) {
    const inv = await byToken(token); if (!inv) return { error: [404, 'This invite link isn\'t right: check you used the whole link from the email'] };
    const st = stateOf(inv);
    if (st === 'revoked') return { error: [410, 'This invite was cancelled: ask an admin for a new one'] };
    if (st === 'expired') return { error: [410, 'This invite has expired: ask an admin to send it again'] };
    const had = (await db.query('SELECT person_id FROM {S}.person_login WHERE provider = @p AND subject = @s', { p: login.provider, s: login.subject }))[0];
    if (st === 'accepted') {
      // the same person again (say the referee list wasn't updated the first time): fine; anyone else: no
      if (had && String(had.person_id).toLowerCase() === String(inv.person_id).toLowerCase()) return done(inv, inv.person_id, form.locale);
      return { error: [409, 'This invite has already been used: sign in instead'] };
    }
    // registering is with the address the invite went to (Google, Microsoft or a code to it), so the account matches the invite
    if (String(login.email || '').toLowerCase() !== String(inv.email).toLowerCase()) return { error: [403, `Sign in with ${inv.email}, the address your invite was sent to. You signed in as ${login.email || 'another account'}.`] };
    const name = text(form?.name, 120);
    if (name.length < 2) return { error: [400, 'Give your full name'] };
    const regionId = String(form?.regionId || '');
    if (!(await db.query('SELECT 1 AS x FROM {S}.region WHERE region_id = @r', { r: regionId })).length) return { error: [400, 'Choose your region'] };
    const locale = LOCALES.includes(form?.locale) ? form.locale : 'en';
    const email = String(login.email || inv.email).toLowerCase();
    const personId = await db.tx(async (q) => {
      // someone already registered (another sign-in, or the same address) is the same person: no second record
      let pid = had?.person_id || (await q("SELECT TOP 1 person_id FROM {S}.person WHERE synthetic = 0 AND status = 'active' AND LOWER(email) IN (@a, @b) ORDER BY created_at", { a: email, b: inv.email }))[0]?.person_id;
      if (pid) await q('UPDATE {S}.person SET legal_name = @n, region_id = @r, locale = @l, updated_at = SYSUTCDATETIME() WHERE person_id = @id', { n: name, r: regionId, l: locale, id: pid });
      else {
        pid = uuid();
        await q('INSERT INTO {S}.person (person_id, public_id, legal_name, email, region_id, locale, synthetic) VALUES (@id, @pub, @n, @e, @r, @l, 0)',
          { id: pid, pub: await ctx.newPublicId(q), n: name, e: email, r: regionId, l: locale });
      }
      if (!had) await q('INSERT INTO {S}.person_login (provider, subject, person_id) VALUES (@p, @s, @id)', { p: login.provider, s: login.subject, id: pid });
      for (const g of JSON.parse(inv.grants)) {
        const dup = await q('SELECT 1 AS x FROM {S}.role_grant WHERE person_id = @id AND role = @role AND ISNULL(programme_id, \'\') = @pg AND ISNULL(region_id, \'\') = @rg', { id: pid, role: g.role, pg: g.programmeId || '', rg: g.regionId || '' });
        if (!dup.length) await q('INSERT INTO {S}.role_grant (grant_id, person_id, role, programme_id, region_id, granted_by) VALUES (@g, @id, @role, @pg, @rg, @by)', { g: uuid(), id: pid, role: g.role, pg: g.programmeId || null, rg: g.regionId || null, by: inv.invited_by });
      }
      for (const p of JSON.parse(inv.programmes)) await ctx.enrolPerson(q, { person_id: pid, region_id: regionId }, p.id, inv.invited_by, p.due);
      await q("UPDATE {S}.invite SET state = 'accepted', accepted_at = SYSUTCDATETIME(), person_id = @id WHERE invite_id = @inv", { id: pid, inv: inv.invite_id });
      await audit(q, { realId: pid }, 'invite.accept', 'invite', inv.invite_id, { email: inv.email, signedInAs: email !== inv.email ? email : undefined }, { regionId });
      return pid;
    });
    return done(inv, personId, locale);
  }
  async function done(inv, personId, locale) {
    const by = inv.invited_by && await ctx.personById(inv.invited_by);
    return { personId, grants: JSON.parse(inv.grants), invitedByEmail: by ? by.email : '', locale: locale || 'en' };
  }
  ctx.invites = { info, accept, pending };

  async function route(w, method, parts, body, query) {
    const [, a, b, c] = parts;
    if (a !== 'invites') return null;
    if (!b && method === 'POST') return create(w, body);
    if (!b && method === 'GET') return list(w, query);
    if (b === 'options' && method === 'GET') return options(w);
    if (b && ['resend', 'revoke'].includes(c) && method === 'POST') return act(w, b, c);
    return null;
  }
  return { route };
}

module.exports = { createInvites, ROLES };
