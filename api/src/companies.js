'use strict';
/* SpartanReferee is one organisation, Spartan's referees, with no registration (from 18 November 2026). It's kept as a single
   built-in company, "spartan" (made the first time it's needed), so servers, bookings and results work as they did for companies.
   Who's in it: the admins, and the referees an admin adds by email address (people:spartan). Everyone in it books, starts and
   uses the servers; only admins add or remove referees. Nobody pays: there's no card.

   The routes below are what's left of the companies, kept so the pages and servers need no other change:

   GET    /api/companies/check/<id>        -> { free }           is that web address free?
   GET    /api/companies/mine              -> { company }        (null when this account has none)
   POST   /api/companies                   -> 410                there's no registration
   PUT    /api/companies/mine              -> { company }        admins: the organisation's name, logo or colours
   GET    /api/admin/referees              -> { people }         admins: who may sign in (also /api/companies/mine/people)
   POST   /api/admin/referees {email}                        add a referee; {email, remove: true} takes them off again
   GET    /api/companies/<id>              -> { name, id, logo, theme }  approved companies only
   GET    /api/admin/companies             -> { companies }      newest first
   POST   /api/admin/companies/<id>/<approve|decline|suspend> {note}
   Referees: whoever signs in with Microsoft using an address on the list (Microsoft has to vouch for it) is in.
     people:spartan    one row per address: { email, role: 'member', addedBy, at, seen }
   A logo arrives as a data: link holding a PNG, JPEG or WebP; the page turns anything else (SVG) into a PNG first. */
const crypto = require('node:crypto');

const MAX_LOGO = 400e3;
const ID = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
const COLOUR = /^#[0-9a-f]{6}$/;
const DEFAULT_THEME = { primary: '#e2231a', accent: '#3ddc97', mode: 'dark' };
// addresses the site or its servers use, or that would mislead
const RESERVED = new Set(['admin', 'administrator', 'api', 'app', 'apps', 'auth', 'billing', 'console', 'dashboard', 'dexys', 'download', 'downloads', 'headjudge', 'head-judge', 'help', 'home', 'login', 'mail', 'people', 'register', 'root', 'server', 'servers', 'signin', 'signup', 'status', 'support', 'test', 'www']);
const EMAIL = /^[^\s@/#?\\]+@[^\s@/#?\\]+\.[^\s@/#?\\]+$/;
const MAX_PEOPLE = 500;
const ORG_ID = 'spartan', ORG_OWNER = 'org:spartan'; // the one organisation; its "owner" is no account, so its results don't depend on one
/** the organisation's record, made the first time it's needed */
async function ensureOrg(store) {
  const c = await store.get('company', ORG_ID);
  if (c) return c;
  const org = { id: ORG_ID, name: 'Spartan', website: '', about: '', contact: '', email: '', owner: ORG_OWNER, logo: '', theme: { ...DEFAULT_THEME }, status: 'approved', at: Date.now() };
  await store.put('company', ORG_ID, org);
  return org;
}
const MAX_OUR_SETTINGS = 20000;
// "Our settings": a company's judge settings, saved once and used on any camera, any booking, with one tap. Kept as
// the judge sends them (a camera's own name and which way it faces aren't in them).
async function ourSettings({ store, now, reply }, companyId, method, body, by) {
  if (method === 'GET') { const row = await store.get('companycfg', companyId); return reply(200, { settings: row?.settings || null, at: row?.at || 0, by: row?.by || '' }); }
  if (method !== 'PUT') return reply(405, { error: 'Not allowed' });
  const settings = body?.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return reply(400, { error: "Those aren't settings" });
  if (JSON.stringify(settings).length > MAX_OUR_SETTINGS) return reply(400, { error: "Those settings won't fit" });
  const row = { id: companyId, settings, at: now(), by: String(by || '').slice(0, 200) };
  await store.put('companycfg', companyId, row);
  return reply(200, { settings, at: row.at, by: row.by });
}
const text = (s, max) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** The image inside a data: link, or a reason it won't do. What's in the bytes decides the type, not what the link claims. */
function readLogo(data) {
  const m = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ''));
  if (!m) return { error: 'The logo needs to be a PNG, JPEG, WebP or SVG image' };
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > MAX_LOGO) return { error: 'That logo is too large: keep it under 400 KB' };
  const type = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'png'
    : buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff ? 'jpeg'
      : buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP' ? 'webp' : '';
  if (!type) return { error: 'The logo needs to be a PNG, JPEG, WebP or SVG image' };
  return { buf, type };
}
function readTheme(t, was = DEFAULT_THEME) {
  const out = { ...was };
  for (const k of ['primary', 'accent']) {
    if (t?.[k] === undefined) continue;
    const c = String(t[k]).toLowerCase();
    if (!COLOUR.test(c)) return { error: 'Colours need to look like #ff6600' };
    out[k] = c;
  }
  if (t?.mode !== undefined) { if (t.mode !== 'dark' && t.mode !== 'light') return { error: 'The background is either dark or light' }; out.mode = t.mode; }
  return { theme: out };
}
function readWebsite(w) {
  const s = text(w, 200);
  if (!s) return { website: '' };
  try { const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); if (!u.hostname.includes('.')) throw new Error(); return { website: u.href }; }
  catch { return { error: "That website address doesn\'t look right" }; }
}
const brandView = (c) => ({ id: c.id, name: c.name, logo: c.logo || '', theme: c.theme });
const ownerView = (c) => ({ ...brandView(c), website: c.website, about: c.about, contact: c.contact, email: c.email, status: c.status, note: c.note || '', at: c.at });

/** Whether an account is in the organisation: an admin, or a referee an admin added. isAdminEmail(email) says who's an admin. */
function createMembership(store, { isAdminEmail = () => false } = {}) {
  // the address an account has proved it owns, or '': Google's (unless Google says it isn't verified), Microsoft's only when it
  // vouches for it (the session has none otherwise), and an email account's (proved with a code when it was made)
  async function provenEmail(me) {
    if (!me?.uid) return '';
    const kind = String(me.uid).slice(0, 2);
    if (kind === 'g_') return me.email && (await store.get('user', me.uid))?.emailVerified !== false ? String(me.email).toLowerCase() : '';
    if (kind === 'm_') return String(me.email || '').toLowerCase();
    if (kind === 'e_') return String((await store.get('user', me.uid))?.email || '').toLowerCase();
    // a code emailed to the address (core.js, from 19 November 2026): proved when the code was typed
    if (kind === 'c_') return String((await store.get('user', me.uid))?.email || '').toLowerCase();
    return '';
  }
  /** { c, role: 'owner', email, row, admin } or null. Everyone in has the role the owner had: they book and start servers. */
  async function companyFor(me) {
    if (!me?.uid) return null;
    const email = await provenEmail(me); if (!email) return null;
    const admin = !!isAdminEmail(email), row = await store.get(`people:${ORG_ID}`, email);
    if (!admin && !row) return null;
    return { c: await ensureOrg(store), role: 'owner', email, row: row || null, admin };
  }
  return { provenEmail, companyFor };
}

function createCompanies({ store, now, reply, session, isAdmin, putBrand, membership = createMembership(store), onBlocked = async () => {} }) {
  const { provenEmail, companyFor } = membership;
  // a logo's address changes with its content, so a new one shows straight away despite caching
  async function saveLogo(id, data) {
    const logo = readLogo(data); if (logo.error) return logo;
    if (!putBrand) return { error: "Logos aren't set up on the server" };
    const name = `${id}/${crypto.createHash('sha256').update(logo.buf).digest('hex').slice(0, 16)}.${logo.type === 'jpeg' ? 'jpg' : logo.type}`;
    return { url: await putBrand(name, logo.buf, `image/${logo.type}`) };
  }
  // admins only: the organisation's name, logo and colours
  async function change(b) {
    const c = await ensureOrg(store);
    if (b?.name !== undefined) { const v = text(b.name, 60); if (v.length < 2) return reply(400, { error: "What's the organisation called?" }); c.name = v; }
    if (b?.theme !== undefined) { const t = readTheme(b.theme, c.theme); if (t.error) return reply(400, { error: t.error }); c.theme = t.theme; }
    if (b?.logo) { const l = await saveLogo(c.id, b.logo); if (l.error) return reply(400, { error: l.error }); c.logo = l.url; }
    if (b?.logo === null) c.logo = '';
    await store.put('company', c.id, c);
    return reply(200, { company: { ...ownerView(c), role: 'owner' } });
  }
  const personView = (p) => ({ email: p.email, role: 'member', at: p.at, addedBy: p.addedBy || '', seen: p.seen || 0 });
  const refereesList = async () => (await store.list(`people:${ORG_ID}`)).map(personView).sort((x, y) => x.email.localeCompare(y.email));
  /** admins: who may sign in. GET lists them, POST {email} adds one, POST {email, remove: true} takes them off. */
  async function referees(method, body, h) {
    if (!isAdmin(h)) return reply(403, { error: 'Only admins can see and change who can sign in' });
    if (method === 'GET') return reply(200, { people: await refereesList() });
    if (method !== 'POST') return reply(405, { error: 'Not allowed' });
    const email = String(body?.email || '').trim().toLowerCase();
    if (email.length > 200 || !EMAIL.test(email)) return reply(400, { error: "That doesn't look like an email address" });
    const key = `people:${ORG_ID}`, row = await store.get(key, email);
    if (body?.remove === true) {
      if (!row) return reply(404, { error: "That address isn't on the list" });
      await store.remove(key, email);
      return reply(200, { people: await refereesList() });
    }
    if (row) return reply(409, { error: 'That address is already on the list' });
    if ((await store.list(key)).length >= MAX_PEOPLE) return reply(400, { error: `The list can hold up to ${MAX_PEOPLE} referees` });
    const me = session(h);
    await store.put(key, email, { email, role: 'member', addedBy: (me && await provenEmail(me)) || String(me?.email || ''), at: now() });
    return reply(200, { people: await refereesList() });
  }
  // what the console shows: the organisation, for anyone in it
  async function mine(me) {
    const m = await companyFor(me);
    if (!m) return reply(200, { company: null });
    if (m.row && !(m.row.seen > now() - 3600e3)) await store.put(`people:${ORG_ID}`, m.email, { ...m.row, seen: now() });
    return reply(200, { company: { ...ownerView(m.c), role: 'owner', admin: m.admin } });
  }

  async function companies(method, a, b, body, h) {
    if (!a && method === 'POST') return reply(410, { error: "SpartanReferee has no registration: an admin adds each referee's address" });
    if (a === 'mine') {
      const me = session(h); if (!me) return reply(401, { error: 'Sign in first' });
      if (b === 'people') return referees(method, body, h);
      if (b === 'settings') {
        const m = await companyFor(me); if (!m) return reply(404, { error: "This account isn't on the list of referees" });
        return ourSettings({ store, now, reply }, m.c.id, method, body, m.email || await provenEmail(me));
      }
      if (b) return null;
      if (method === 'PUT') return isAdmin(h) ? change(body) : reply(403, { error: "Only admins can change the organisation's details" });
      if (method === 'GET') return mine(me);
      return reply(405, { error: 'Not allowed' });
    }
    if (a && !b && method === 'GET') {
      const c = await store.get('company', String(a).toLowerCase());
      return c && c.status === 'approved' ? reply(200, brandView(c)) : reply(404, { error: 'No such company' });
    }
    return null;
  }
  async function adminCompanies(method, id, action, body) {
    if (!id && method === 'GET') return reply(200, { companies: (await store.list('company')).sort((x, y) => y.at - x.at).map(ownerView) });
    const status = { approve: 'approved', decline: 'declined', suspend: 'suspended' }[action];
    if (id && status && method === 'POST') {
      const c = await store.get('company', id); if (!c) return reply(404, { error: 'No such company' });
      c.status = status; c.note = text(body?.note, 300); c.decidedAt = now();
      await store.put('company', id, c);
      // no longer allowed: anything it has running stops too
      if (status !== 'approved') await onBlocked(id);
      return reply(200, { company: ownerView(c) });
    }
    return null;
  }
  return { companies, adminCompanies, referees };
}

module.exports = { createCompanies, createMembership, ensureOrg, readLogo, ourSettings, DEFAULT_THEME, ORG_ID, ORG_OWNER };
