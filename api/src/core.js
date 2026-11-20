'use strict';
/* SpartanReferee's backend, framework-free so it can be tested without Azure: sign-in (Google, and email through email-signin.js), who's an
   admin, and the companies (companies.js), their servers and bookings (servers.js, payments.js) and recordings (recordings.js).
   The Spartans app had its parts here too (chat, groups, profiles, news, scores) until 8 November 2026: it has its own backend now.

   GET  /api/config                      -> { googleClientId, signIn, emailSignIn }
   POST /api/auth/google {idToken}       -> { token, user }
   POST /api/auth/email {code, verifier} -> { token, user }
   POST /api/auth/microsoft {code, verifier, redirectUri} -> { token, user }
   GET  /api/me                          -> { user, profile, admin, judge }
   GET  /api/home                        -> a referee's home page: their name and assigned events (assignments.js)
   GET  /api/event/<id>                  -> an event's page: its times, referees and cameras (assignments.js)
   GET|POST /api/learn/practice-camera {cameras} -> a 30-minute practice camera, booked from Learning only
   /api/admin/admins|companies|pricing|customers (admins), /api/companies, /api/servers, /api/recordings: see their files */
const crypto = require('node:crypto');
const { createRecordings } = require('./recordings');
const { createCompanies, createMembership } = require('./companies');
const { createServers } = require('./servers');
const { createEvents } = require('./events');
const { createLearn } = require('./learn');
const { createAssignments } = require('./assignments');
const { layout } = require('./mailer');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Session, X-Device, X-Admin-Key, X-Server-Key', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' };

/**
 * verifyGoogle(idToken) -> {sub, email, name, picture} (throws when invalid); secret signs our own session tokens.
 * adminEmails: Google accounts that are admins. While neither adminEmails nor adminKey is set, everyone is (the prototype).
 */
function createApi({ store, now = Date.now, adminKey = '', adminEmails = [], verifyGoogle = null, emailSignIn = null, microsoftSignIn = null, payments = null, secret = '', googleClientId = '', blobSigner = null, putBrand = null, maxRunningServers = 1, serverHourPrice = 0.66, eventFetcher = null, bookingUnits = true, learnDb = null, learnSpeech = null, learnMedia = null, mailer = null, siteUrl = '' }) {
  const reply = (status, body) => ({ status, body, headers: { 'Content-Type': 'application/json', ...CORS } });
  const admins = adminEmails.map((e) => String(e).trim().toLowerCase()).filter(Boolean);
  // session tokens: base64url(payload).HMAC
  const sign = (payload) => { const p = Buffer.from(JSON.stringify(payload)).toString('base64url'); return p + '.' + crypto.createHmac('sha256', secret).update(p).digest('base64url'); };
  const session = (h) => {
    // X-Session is what the site sends, as Azure Static Web Apps replaces any Authorization header on its way here
    const m = /^(?:Bearer )?(.+)\.(.+)$/.exec(String(h['x-session'] || h.authorization || '')); if (!m || !secret) return null;
    const good = crypto.createHmac('sha256', secret).update(m[1]).digest('base64url');
    if (good.length !== m[2].length || !crypto.timingSafeEqual(Buffer.from(good), Buffer.from(m[2]))) return null;
    try { const p = JSON.parse(Buffer.from(m[1], 'base64url').toString()); return p.exp > now() ? p : null; } catch { return null; }
  };
  const deviceOf = (h) => { const d = String(h['x-device'] || ''); return /^[\w-]{16,64}$/.test(d) ? crypto.createHash('sha256').update(d).digest('base64url').slice(0, 22) : null; };
  // who's asking: the signed-in account, or (not signed in) this phone
  const who = (h) => { const s = session(h); return s ? s.uid : deviceOf(h); };
  // Admins added in the admin area, on top of ADMIN_EMAILS (which can't be removed there, so nobody can lock everyone out).
  // Kept for 30 seconds, as nearly every request asks, so someone removed loses access within that. Only Google sessions, and
  // Microsoft ones whose address Microsoft vouches for, carry an address: email accounts can't be admins.
  let addedAdmins = new Set(), addedAt = -Infinity;
  const loadAdmins = async (force) => {
    if (!force && now() - addedAt < 30e3) return;
    try { addedAdmins = new Set((await store.list('admin')).map((a) => a.email)); addedAt = now(); } catch { /* keep the last list until the store answers */ }
  };
  const isAdmin = (h) => {
    if (adminKey && h['x-admin-key'] === adminKey) return true;
    const s = session(h), email = String(s?.email || '').toLowerCase();
    if (email && (admins.includes(email) || addedAdmins.has(email))) return true;
    return !adminKey && !admins.length; // prototype: nothing set = everyone is an admin
  };

  // ---------------------------------------------------------------- accounts and profiles
  async function touchProfile(id, patch = {}) {
    const p = (await store.get('profile', id)) || { id, at: now() };
    Object.assign(p, patch, { seen: now() }); await store.put('profile', id, p); return p;
  }
  async function authGoogle(body, h) {
    if (!verifyGoogle || !secret) return reply(503, { error: 'Google sign-in isn’t set up on the server yet' });
    let g; try { g = await verifyGoogle(String((body && body.idToken) || '')); } catch { return reply(401, { error: 'Google sign-in didn’t work – try again' }); }
    const uid = 'g_' + crypto.createHash('sha256').update(String(g.sub)).digest('base64url').slice(0, 22);
    const user = { id: uid, email: g.email || '', name: g.name || '', picture: g.picture || '', emailVerified: g.email_verified !== false };
    await store.put('user', uid, user);
    await touchProfile(uid, { email: user.email, google: true, ...(user.name && !(await store.get('profile', uid) || {}).name ? { name: user.name.slice(0, 30) } : {}) });
    // the address counts (for the referee list and admins) only when Google has verified it, as with Microsoft's
    return reply(200, { token: sign({ uid, ...(user.email && user.emailVerified ? { email: user.email } : {}), exp: now() + 30 * 24 * 3600 * 1000 }), user });
  }
  // The Broadcaster's email accounts (email-signin.js). The session deliberately has no email in it, so one of these
  // can never count as an admin through ADMIN_EMAILS: admins sign in with Google on the site.
  async function authEmail(body) {
    if (!emailSignIn || !secret) return reply(503, { error: 'Email sign-in isn’t set up on the server yet' });
    const code = (body && body.code) || '', verifier = (body && body.verifier) || '';
    if (typeof code !== 'string' || !code || code.length > 8192 || typeof verifier !== 'string' || !/^[\w.~-]{43,128}$/.test(verifier)) return reply(400, { error: 'That sign-in link isn’t right – try again' });
    const redirectUri = body && typeof body.redirectUri === 'string' ? body.redirectUri : undefined; // the website's; the app sends none
    let c; try { c = await emailSignIn.redeem(code, verifier, redirectUri); } catch { return reply(401, { error: 'Sign-in didn’t work – try again' }); }
    const uid = 'e_' + crypto.createHash('sha256').update(String(c.sub)).digest('base64url').slice(0, 22);
    const user = { id: uid, email: c.email, name: c.name, picture: '' };
    await store.put('user', uid, user);
    await touchProfile(uid, { email: user.email, ...(user.name && !(await store.get('profile', uid) || {}).name ? { name: user.name.slice(0, 30) } : {}) });
    return reply(200, { token: sign({ uid, exp: now() + 30 * 24 * 3600 * 1000 }), user });
  }
  // "Sign in with Microsoft" (microsoft-signin.js). The session carries the address only when Microsoft vouches for it, so only
  // then can it count as an admin; the account's record keeps the address it showed either way.
  async function authMicrosoft(body) {
    if (!microsoftSignIn || !secret) return reply(503, { error: 'Microsoft sign-in isn’t set up on the server yet' });
    const code = (body && body.code) || '', verifier = (body && body.verifier) || '';
    if (typeof code !== 'string' || !code || code.length > 8192 || typeof verifier !== 'string' || !/^[\w.~-]{43,128}$/.test(verifier)) return reply(400, { error: 'That sign-in link isn’t right – try again' });
    let m; try { m = await microsoftSignIn.redeem(code, verifier, body.redirectUri); } catch { return reply(401, { error: 'Microsoft sign-in didn’t work – try again' }); }
    const uid = 'm_' + crypto.createHash('sha256').update(String(m.sub)).digest('base64url').slice(0, 22);
    const user = { id: uid, email: m.shownEmail, name: m.name, picture: '' };
    await store.put('user', uid, user);
    await touchProfile(uid, { email: user.email, microsoft: true, ...(user.name && !(await store.get('profile', uid) || {}).name ? { name: user.name.slice(0, 30) } : {}) });
    return reply(200, { token: sign({ uid, ...(m.email ? { email: m.email } : {}), exp: now() + 30 * 24 * 3600 * 1000 }), user });
  }
  async function me(h) {
    const id = who(h); if (!id) return reply(400, { error: 'This device has no id yet – reload the app' });
    const s = session(h), profile = await touchProfile(id);
    const user = s ? await store.get('user', s.uid) : null;
    return reply(200, { user, profile: { ...profile, id: undefined }, admin: isAdmin(h), judge: !!profile.judge || isAdmin(h) });
  }
  // ---------------------------------------------------------------- admin: who's an admin
  async function adminList(method, action, body, h) {
    const you = String(session(h)?.email || '').toLowerCase();
    const list = async () => reply(200, { permanent: admins, added: (await store.list('admin')).sort((x, y) => x.email.localeCompare(y.email)), you });
    if (!action && method === 'GET') return list();
    if (method !== 'POST') return null;
    const email = String(body?.email || '').trim().toLowerCase();
    if (email.length > 200 || !/^[^\s@/#?\\]+@[^\s@/#?\\]+\.[^\s@/#?\\]+$/.test(email)) return reply(400, { error: 'That doesn\'t look like an email address' });
    if (!action) {
      if (admins.includes(email) || await store.get('admin', email)) return reply(409, { error: 'That address is already an admin' });
      await store.put('admin', email, { email, addedBy: you, at: now() });
    } else if (action === 'remove') {
      if (admins.includes(email)) return reply(400, { error: 'That admin is permanent, so nobody can lock everyone out' });
      if (email === you) return reply(400, { error: 'You can\'t remove yourself: ask another admin' });
      await store.remove('admin', email);
    } else return null;
    await loadAdmins(true);
    return list();
  }

  // ---------------------------------------------------------------- admin
  async function admin(method, a, b, c, h, body) {
    if (!isAdmin(h)) return reply(403, { error: 'Admins only' });
    if (a === 'admins') return adminList(method, b, body, h);
    if (a === 'companies') return adminCompanies(method, b, c, body);
    if (a === 'pricing' && !b) return adminPricing(method, body);
    if (a === 'customers') return adminCustomers(method, b, c, body);
    if (a === 'referees' && !b) return referees(method, body, h);
    if (a === 'events' && b === 'sync') return eventList.adminSync(method);
    if (a === 'assignments' && !b) return assignments.admin(method, body, h);
    return null;
  }

  // who's in the organisation: an admin (as isAdmin decides, by address), or a referee an admin added
  const isAdminEmail = (email) => admins.includes(email) || addedAdmins.has(email) || (!adminKey && !admins.length);
  // the Learning & Competence platform (/api/learn), in its own database; its tables are made or updated on its first request
  const membership = createMembership(store, { isAdminEmail });
  // who may use it: anyone in the organisation (admins as global admins, referees as learners), with the name they signed in with
  const learnMember = async (me) => {
    const m = await membership.companyFor(me); if (!m) return null;
    return { admin: m.admin, email: m.email, name: String((await store.get('user', me.uid))?.name || ''), language: (await store.get('lang', m.email))?.lang || '' };
  };
  const learn = learnDb ? createLearn({ db: learnDb, session, isAdminEmail, member: learnMember, reply, speech: learnSpeech, mediaSigner: learnMedia, mailer, siteUrl }) : null;
  const learnUp = async () => { learnReady = learnReady || learnDb.migrate().catch((e) => { learnReady = null; throw e; }); await learnReady; };

  // ---------------------------------------------------------------- signing in with a code emailed to the address (19 November 2026)
  // For people with no Google or Microsoft account: POST /api/auth/code {email} emails a 6-digit code (only to an address that can sign
  // in: on the referee list, an admin, or with an open invite; the answer is the same either way, so it says nothing about who's in);
  // POST /api/auth/code/verify {email, code} gives a session. A code works for 10 minutes and 5 tries; one a minute at most.
  const codeHash = (email, code) => crypto.createHmac('sha256', secret).update(`${email}|${code}`).digest('hex');
  async function codeCanGo(email) {
    if (isAdminEmail(email) || await store.get(`people:spartan`, email)) return true;
    if (!learn) return false;
    await learnUp();
    return learn.invites.pending(email);
  }
  async function authCode(body) {
    if (!mailer || !secret) return reply(503, { error: 'Email sign-in isn’t set up on the server yet' });
    const email = String(body?.email || '').trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@/#?\\|]+@[^\s@/#?\\|]+\.[^\s@/#?\\|]+$/.test(email)) return reply(400, { error: 'That doesn\'t look like an email address' });
    const was = await store.get('logincode', email);
    if (was && now() - was.sentAt < 60e3) return reply(200, { sent: true }); // one a minute: the last one is still on its way
    if (await codeCanGo(email)) {
      const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
      await store.put('logincode', email, { id: email, hash: codeHash(email, code), exp: now() + 10 * 60e3, tries: 0, sentAt: now() });
      const mail = layout({ title: `Your SpartanReferee sign-in code: ${code}`, lines: [`Type this code on the sign-in page: ${code}`, 'It works for 10 minutes.'], foot: 'If you didn\'t ask to sign in, you can ignore this email.' });
      try { await mailer.send({ to: email, subject: `Your SpartanReferee sign-in code: ${code}`, ...mail }); }
      catch (e) { console.error(`sign-in code to an address: ${e.message}`); return reply(502, { error: 'The code couldn\'t be emailed just now: try again in a minute' }); }
    }
    return reply(200, { sent: true });
  }
  async function authCodeVerify(body) {
    if (!secret) return reply(503, { error: 'Email sign-in isn’t set up on the server yet' });
    const email = String(body?.email || '').trim().toLowerCase(), code = String(body?.code || '').replace(/\D/g, '');
    const row = email && await store.get('logincode', email);
    const wrong = reply(401, { error: 'That code isn\'t right, or it has expired: ask for a new one' });
    if (!row || row.exp < now() || row.tries >= 5 || code.length !== 6) return wrong;
    if (!crypto.timingSafeEqual(Buffer.from(codeHash(email, code)), Buffer.from(row.hash))) { await store.put('logincode', email, { ...row, tries: row.tries + 1 }); return wrong; }
    await store.remove('logincode', email);
    const uid = 'c_' + crypto.createHash('sha256').update(email).digest('base64url').slice(0, 22);
    const user = { ...(await store.get('user', uid) || {}), id: uid, email, emailVerified: true };
    await store.put('user', uid, user);
    await touchProfile(uid, { email });
    return reply(200, { token: sign({ uid, email, exp: now() + 30 * 24 * 3600 * 1000 }), user });
  }

  // ---------------------------------------------------------------- joining from an invite (learn/invites.js; join.html)
  // GET /api/invite/<token> -> what the join page shows; POST /api/invite/<token>/accept {name, regionId, locale}, signed in: registers
  // them (their learning record, roles and programmes), puts the address they signed in with on the referee list, an admin's on the
  // admins, and keeps their language.
  async function invite(method, token, action, body, h) {
    if (!learn) return reply(503, { error: 'Invites aren\'t set up on the server' });
    await learnUp();
    if (method === 'GET' && !action) { const r = await learn.invites.info(token); return r.error ? reply(404, { error: 'This invite link isn\'t right' }) : reply(200, r); }
    if (method !== 'POST' || action !== 'accept') return null;
    const me = session(h); if (!me) return reply(401, { error: 'Sign in first' });
    const email = await membership.provenEmail(me);
    if (!email) return reply(400, { error: 'That account didn\'t give a verified email address: try another way to sign in' });
    const r = await learn.invites.accept(token, { ...learn.loginOf(me), email }, body || {});
    if (r.error) return reply(r.error[0], { error: r.error[1] });
    if (!(await store.get('people:spartan', email))) await store.put('people:spartan', email, { email, role: 'member', addedBy: r.invitedByEmail, at: now(), invited: true });
    if (r.grants.some((g) => g.role === 'global_admin') && !isAdminEmail(email)) { await store.put('admin', email, { email, addedBy: r.invitedByEmail, at: now() }); await loadAdmins(true); }
    await store.put('lang', email, { id: email, lang: r.locale });
    const name = String(body?.name || '').trim().slice(0, 120);
    if (name) await store.put('name', email, { id: email, name });
    return reply(200, { ok: true });
  }
  let learnReady = null;
  const recordings = createRecordings({ store, signer: blobSigner, now, reply, session, isAdmin, membership });
  // Spartan's events (events.js), synced from Spartan's race list; referees book cameras for one
  // bookingUnits false: one booking for the whole organisation, as before events (older tests)
  const eventList = createEvents({ store, now, reply, ...(eventFetcher ? { fetcher: eventFetcher } : {}) });
  const { servers, adminPricing, adminCustomers, stopCompany, bookingStatus, bookedUnits, trainingUnit, rehearses } = createServers({ store, now, reply, session, isAdmin, membership, payments, freeBooking: true, events: bookingUnits ? eventList : null, maxRunning: maxRunningServers, hourPrice: serverHourPrice });
  // which referees are assigned to which events, and each referee's home page
  const assignments = createAssignments({ store, now, reply, session, isAdmin, isAdminEmail, membership, events: eventList, bookingStatus, bookedUnits, learnOn: !!learnDb,
    onLanguage: learn ? async (email, language) => { await (learnReady || learnDb.migrate()); await learn.setLocale(email, language); } : null,
    // a regional coordinator manages the events in their regions' countries (their roles are in the learning database)
    scopeOf: learn ? async (email, preview) => { await learnUp(); return learn.scopeOf(email, preview); } : async () => ({ countries: [] }) });
  const { companies, adminCompanies, referees } = createCompanies({ store, now, reply, session, isAdmin, putBrand, membership, onBlocked: stopCompany });

  async function handle({ method, path, headers = {}, body, query: extraQuery = {} }) {
    const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    if (method === 'OPTIONS') return { status: 204, body: null, headers: CORS };
    await loadAdmins();
    // The app (another origin) sends everything as a plain-text POST: browsers then skip the CORS pre-check, which
    // Static Web Apps answers without CORS headers. The real method, who's asking and the body are inside.
    if (method === 'POST' && body && body._env === 1) {
      const m = String(body.m || 'GET').toUpperCase();
      if (!['GET', 'POST', 'PUT', 'DELETE'].includes(m)) return { status: 405, body: { error: 'Not allowed' }, headers: CORS };
      method = m;
      h['x-device'] = String(body.d || '');
      delete h['x-session'];
      if (body.t) h.authorization = 'Bearer ' + body.t; else delete h.authorization;
      if (body.k) h['x-admin-key'] = String(body.k); else delete h['x-admin-key'];
      body = body.b === undefined ? null : body.b;
    }
    const [pathOnly, qs = ''] = String(path || '').split('?');
    const query = { ...extraQuery, ...Object.fromEntries(new URLSearchParams(qs)) }; // ?unit= arrives either way
    const parts = pathOnly.replace(/^\/+|\/+$/g, '').split('/');
    try {
      let r = null;
      if (parts[0] === 'admin' && parts.length <= 5 && (parts.length < 5 || parts[4] === 'lift')) r = await admin(method, parts[1], parts[2], parts[3], h, body);
      if (parts[0] === 'config' && method === 'GET') r = reply(200, { googleClientId, signIn: !!(verifyGoogle && secret && googleClientId), emailSignIn: emailSignIn && secret ? emailSignIn.config : null, microsoftSignIn: microsoftSignIn && secret ? microsoftSignIn.config : null, codeSignIn: !!(mailer && secret) });
      if (parts[0] === 'auth' && parts[1] === 'google' && method === 'POST') r = await authGoogle(body, h);
      if (parts[0] === 'auth' && parts[1] === 'email' && method === 'POST') r = await authEmail(body);
      if (parts[0] === 'auth' && parts[1] === 'microsoft' && method === 'POST') r = await authMicrosoft(body);
      if (parts[0] === 'auth' && parts[1] === 'code' && !parts[2] && method === 'POST') r = await authCode(body);
      if (parts[0] === 'auth' && parts[1] === 'code' && parts[2] === 'verify' && method === 'POST') r = await authCodeVerify(body);
      if (parts[0] === 'invite' && parts[1] && parts.length <= 3) r = await invite(method, parts[1], parts[2], body, h);
      if (parts[0] === 'me' && method === 'GET') r = await me(h);
      if (parts[0] === 'home' && parts.length === 1) r = await assignments.home(method, h, body);
      if (parts[0] === 'event' && parts.length >= 2 && parts.length <= 3) r = await assignments.eventPage(method, parts[1], parts[2], h, body);
      if (parts[0] === 'my' && parts[1] === 'events' && parts.length === 2 && method === 'GET') r = await assignments.myEvents(h);
      if (parts[0] === 'manage' && parts[1] === 'events' && parts.length === 2 && method === 'GET') r = await assignments.manageList(h, query);
      // a 30-minute practice camera, booked only here, from Learning's camera guide (servers.js refuses it anywhere else)
      if (parts[0] === 'learn' && parts[1] === 'practice-camera' && parts.length === 2) {
        const me = session(h);
        if (!me) r = reply(401, { error: 'Sign in first' });
        else {
          const unit = trainingUnit(me.uid);
          r = method === 'GET' ? await servers('GET', 'mine', undefined, null, h, { unit })
            : method === 'POST' ? await servers('POST', 'mine', 'start', { cameras: Number(body?.cameras), unit }, h, {}, { fromLearn: true }) : reply(405, { error: 'Not allowed' });
          if (r && r.status === 200) r.body = { ...r.body, unit, canPractise: await rehearses(me, h) };
        }
      }
      if (parts[0] === 'recordings' && parts.length <= 3) r = await recordings(method, parts[1], parts[2], body, h);
      if (parts[0] === 'servers' && parts.length <= 3) r = await servers(method, parts[1], parts[2], body, h, query);
      // Spartan's events: for anyone in the organisation
      if (parts[0] === 'events' && parts.length === 1) { const me = session(h); r = !me ? reply(401, { error: 'Sign in first' }) : !(await membership.companyFor(me)) ? reply(403, { error: 'Only referees and admins see the events' }) : await eventList.events(method); }
      if (parts[0] === 'learn' && parts[1] !== 'practice-camera') {
        if (!learn) r = reply(503, { error: 'The learning platform isn’t set up yet' });
        else {
          try { learnReady = learnReady || learnDb.migrate().catch((e) => { learnReady = null; throw e; }); await learnReady; r = await learn.handle(method, parts, body, h, query); }
          catch (e) { if (!e.waking) { learn.noteError(e, method, pathOnly); throw e; } learn.noteWaking(); r = reply(503, { error: 'The learning platform is waking up after a quiet spell: try again in a minute' }); }
        }
      }
      if (parts[0] === 'companies' && parts.length <= 3) r = await companies(method, parts[1], parts[2], body, h);
      return r || reply(404, { error: 'not found' });
    } catch (e) {
      console.error(`${method} /api/${pathOnly}: ${(e && e.stack) || e}`); // into the Functions log, never to the page
      return reply(500, { error: 'Something went wrong – try again' });
    }
  }
  return { handle };
}

module.exports = { createApi, CORS };
