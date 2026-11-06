'use strict';
/* Companies that run events on HeadJudge (Spartan, say). Someone signed in applies once with their company's details, logo
   and colours; an admin approves it before it can use anything that costs money. Anyone may read an approved company's
   name, logo and colours (its pages show them); contact details only reach its owner and admins.

   GET    /api/companies/check/<id>        -> { free }           is that web address free?
   GET    /api/companies/mine              -> { company }        (null when this account has none)
   POST   /api/companies                   -> { company }        apply: {name, id, website, about, contact, theme, logo}
   PUT    /api/companies/mine              -> { company }        change details, logo or colours
   GET    /api/companies/<id>              -> { name, id, logo, theme }  approved companies only
   GET    /api/admin/companies             -> { companies }      newest first
   POST   /api/admin/companies/<id>/<approve|decline|suspend> {note}
   A logo arrives as a data: link holding a PNG, JPEG or WebP; the page turns anything else (SVG) into a PNG first. */
const crypto = require('node:crypto');

const MAX_LOGO = 400e3;
const ID = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
const COLOUR = /^#[0-9a-f]{6}$/;
const DEFAULT_THEME = { primary: '#ffc400', accent: '#3ddc97', mode: 'dark' };
// addresses the site or its servers use, or that would mislead
const RESERVED = new Set(['admin', 'administrator', 'api', 'app', 'apps', 'auth', 'billing', 'console', 'dashboard', 'dexys', 'download', 'downloads', 'headjudge', 'head-judge', 'help', 'home', 'login', 'mail', 'register', 'root', 'server', 'servers', 'signin', 'signup', 'status', 'support', 'test', 'www']);
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
  catch { return { error: 'That website address doesn\'t look right' }; }
}
const brandView = (c) => ({ id: c.id, name: c.name, logo: c.logo || '', theme: c.theme });
const ownerView = (c) => ({ ...brandView(c), website: c.website, about: c.about, contact: c.contact, email: c.email, status: c.status, note: c.note || '', at: c.at });

function createCompanies({ store, now, reply, session, isAdmin, putBrand }) {
  const idFree = async (id) => ID.test(id) && !RESERVED.has(id) && !(await store.get('company', id));
  // a logo's address changes with its content, so a new one shows straight away despite caching
  async function saveLogo(id, data) {
    const logo = readLogo(data); if (logo.error) return logo;
    if (!putBrand) return { error: 'Logos aren\'t set up on the server' };
    const name = `${id}/${crypto.createHash('sha256').update(logo.buf).digest('hex').slice(0, 16)}.${logo.type === 'jpeg' ? 'jpg' : logo.type}`;
    return { url: await putBrand(name, logo.buf, `image/${logo.type}`) };
  }
  async function apply(me, b) {
    if (await store.get('companyof', me.uid)) return reply(409, { error: 'This account already has a company' });
    const name = text(b?.name, 60), id = String(b?.id || '').toLowerCase(), contact = text(b?.contact, 60), about = text(b?.about, 600);
    if (name.length < 2) return reply(400, { error: 'What\'s the company called?' });
    if (!ID.test(id)) return reply(400, { error: 'The web address can use a to z, 0 to 9 and hyphens, 3 to 32 characters' });
    if (!(await idFree(id))) return reply(409, { error: 'That web address is taken: try another' });
    if (contact.length < 2) return reply(400, { error: 'Who should we talk to?' });
    const site = readWebsite(b?.website); if (site.error) return reply(400, { error: site.error });
    const theme = readTheme(b?.theme); if (theme.error) return reply(400, { error: theme.error });
    let logo = '';
    if (b?.logo) { const l = await saveLogo(id, b.logo); if (l.error) return reply(400, { error: l.error }); logo = l.url; }
    const c = { id, name, website: site.website, about, contact, email: me.email || '', owner: me.uid, logo, theme: theme.theme, status: 'pending', at: now() };
    await store.put('company', id, c); await store.put('companyof', me.uid, { id });
    return reply(200, { company: ownerView(c) });
  }
  async function change(me, b) {
    const of = await store.get('companyof', me.uid), c = of && await store.get('company', of.id);
    if (!c) return reply(404, { error: 'This account has no company yet' });
    if (b?.name !== undefined) { const v = text(b.name, 60); if (v.length < 2) return reply(400, { error: 'What\'s the company called?' }); c.name = v; }
    if (b?.contact !== undefined) { const v = text(b.contact, 60); if (v.length < 2) return reply(400, { error: 'Who should we talk to?' }); c.contact = v; }
    if (b?.about !== undefined) c.about = text(b.about, 600);
    if (b?.website !== undefined) { const site = readWebsite(b.website); if (site.error) return reply(400, { error: site.error }); c.website = site.website; }
    if (b?.theme !== undefined) { const t = readTheme(b.theme, c.theme); if (t.error) return reply(400, { error: t.error }); c.theme = t.theme; }
    if (b?.logo) { const l = await saveLogo(c.id, b.logo); if (l.error) return reply(400, { error: l.error }); c.logo = l.url; }
    if (b?.logo === null) c.logo = '';
    await store.put('company', c.id, c);
    return reply(200, { company: ownerView(c) });
  }

  async function companies(method, a, b, body, h) {
    if (a === 'check' && b && method === 'GET') return reply(200, { free: await idFree(String(b).toLowerCase()) });
    if (a === 'mine' || (!a && method === 'POST')) {
      const me = session(h); if (!me) return reply(401, { error: 'Sign in first' });
      if (!a) return apply(me, body);
      if (method === 'PUT') return change(me, body);
      if (method === 'GET') {
        const of = await store.get('companyof', me.uid), c = of && await store.get('company', of.id);
        return reply(200, { company: c ? ownerView(c) : null });
      }
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
      return reply(200, { company: ownerView(c) });
    }
    return null;
  }
  return { companies, adminCompanies };
}

module.exports = { createCompanies, readLogo, DEFAULT_THEME };
