'use strict';
/* The Spartans app's small backend, framework-free so it can be tested without Azure.

   Home page content (the next race, news, past winners):
   GET  /api/content                      -> { race, news: [...], winners: [...], events: [...] }
   PUT  /api/content/<race|news|winners|events>  -> save one part (admins; while ADMIN_KEY isn't set, the prototype lets anyone)

   The chat (a notice board per room, like SkiTour's):
   GET    /api/board                      -> the rooms
   GET    /api/board/<room>               -> the latest 80 messages, oldest first
   POST   /api/board/<room> {name, text}  -> post a message
   DELETE /api/board/<room>/<id>          -> delete your own message (or any, for an admin)
   POST   /api/board/<room>/<id>/report   -> report a message; once 3 different people have reported someone in a chat,
                                             they're banned from it (and their reported messages hidden)

   Private groups (their chat is the room g-<groupId>, members only):
   GET    /api/groups                     -> my groups and the invites waiting for me
   POST   /api/groups {name, me}          -> make a group (I'm its owner); it gets a join code
   POST   /api/groups/join {code, me}     -> join with a code
   POST   /api/groups/<id>/invite {room, post}  -> invite whoever wrote that message
   POST   /api/groups/invites/<id>/<accept|decline> {me}
   POST   /api/groups/<id>/leave
   POST   /api/groups/<id>/code           -> a new join code (owner)

   Accounts (Google sign-in, as in SkiTour) and profiles:
   GET    /api/config                     -> { googleClientId }
   POST   /api/auth/google {idToken}      -> { token, user }   (a 30-day session token; this phone's groups, profile and burpee scores move to the account)
   POST   /api/auth/email {code, verifier} -> { token, user }  (the Broadcaster's email accounts; see email-signin.js)
   GET    /api/me                         -> { user, profile, admin, judge }
   PUT    /api/profile {name, spartanUrl, racerNo, country, ageGroup}
   POST   /api/profile/judge {code}       -> become a Burpee judge with the judge code an admin handed out

   News (Spartan's own blogs, cached for an hour) and past competitions:
   GET    /api/news                       -> { articles: [{title, date, url, image, summary, blog}] }

   Admin (admins: emails in ADMIN_EMAILS, or the ADMIN_KEY; while neither is set, the prototype lets anyone):
   GET    /api/admin/people               -> everyone with a profile, and whether they're a Burpee judge
   POST   /api/admin/people/<who>/judge {on}
   GET    /api/admin/judgecode            -> the code that makes someone a judge;  POST -> a new code
   GET    /api/admin/bans                 -> who's banned, from which chat, when, and the messages they were reported for
   POST   /api/admin/bans/<room>/<who>/lift

   Who's who: there are no accounts yet. Each phone sends a random device id (X-Device), which is stored only as a hash, and
   picks a display name. Keeping it civil: rude words (namecheck.js), no links / emails / phone numbers, one message every
   10 seconds and 60 a day per device, never the same text twice running. */
const crypto = require('node:crypto');
const { createRecordings } = require('./recordings');
const { createCompanies } = require('./companies');
const { createServers } = require('./servers');
const { rudeName, rudeText } = require('./namecheck');

const ROOMS = [
  { id: 'general', name: 'Spartans chat', about: 'Anything Spartan' },
  { id: 'morzine-2026', name: 'Morzine 2026', about: 'Race weekend: travel, meet-ups, course talk' },
  { id: 'training', name: 'Training', about: 'Plans, sessions, burpee counts' },
  { id: 'kit', name: 'Kit', about: 'Shoes, gloves, swaps and sales' },
  { id: 'lifts', name: 'Lift shares', about: 'Getting there together' },
];
const DEFAULT_CONTENT = {
  race: { name: 'Morzine 2026', place: 'Morzine, Portes du Soleil, France', date: '', courses: 'Ultra 52 km · Beast 22 km · Super 12 km · Sprint 5.8 km · Kids 1–3 km', note: '' },
  news: [],
  winners: [],
  // past competitions: winners per course; `course` is the Course Run pack when the course map has been added (then it can be played)
  competitions: [
    { name: 'Morzine Ultra World Championship 2026', date: '', place: 'Morzine, Portes du Soleil, France', course: 'morzine-26', note: 'The course map is in Course Run: play any of its courses.', winners: [] },
  ],
  // upcoming Spartan races in Europe, from Spartan's race finder (uk.spartan.com, checked 2 November 2026); admins keep it up to date
  events: [
    { name: 'Pomáz Trifecta Weekend 2026', date: '2026-11-07', end: '2026-11-08', place: 'Pomáz, Hungary', races: 'Sprint · Super · Beast · Kids · Hurricane Heat 4hr', url: 'https://uk.spartan.com/en/race/detail/10841/overview' },
    { name: 'Interlaken Spartan Weekend 2027', date: '2027-03-13', end: '', place: 'Interlaken, Switzerland', races: 'Sprint · Super', url: 'https://uk.spartan.com/en/race/detail/11775/overview' },
    { name: 'Esztergom Trifecta Weekend 2027', date: '2027-04-10', end: '2027-04-11', place: 'Esztergom, Hungary', races: 'Sprint · Super · Beast · Kids', url: 'https://uk.spartan.com/en/race/detail/11535/overview' },
    { name: 'Komárno Super / Sprint / Kids 2027', date: '2027-07-03', end: '', place: 'Komárno, Slovakia', races: 'Sprint · Super · Kids · Charity', url: 'https://uk.spartan.com/en/race/detail/11510/overview' },
    { name: 'Ireland Spartan Slane Event Weekend 2027', date: '2027-07-31', end: '2027-08-01', place: 'Slane, Ireland', races: 'Sprint · Super', url: 'https://uk.spartan.com/en/race/detail/11368/overview' },
    { name: 'Malino Brdo Trifecta Weekend 2027', date: '2027-08-28', end: '2027-08-29', place: 'Ružomberok, Slovakia', races: 'Sprint · Super · Beast · Ultra · Kids', url: 'https://uk.spartan.com/en/race/detail/11690/overview' },
  ],
};
// Insults, abuse and threats: refused in the public rooms on top of namecheck.js's swearing and slurs
const ABUSE = /\b(kys|kill (your|ur) ?self|go die|hope you die|neck yourself|idiot|idiots|moron|morons|imbecile|dumbass|dumb ass|loser|losers|scumbag|piece of (shit|crap)|shut up|stfu|gtfo|fat (cow|pig)|ugly (cow|pig|bitch)|retarded|cripple|freak|worthless|pathetic|i('| wi)ll (kill|hurt|find) you|slag|whore|tramp|nonce|paedo|pedo)\b/i;
const MAX_LEN = 500, SHOW = 80, KEEP = 400, GAP_MS = 10 * 1000, PER_DAY = 60, REPORTERS_TO_BAN = 3, GROUP_MAX = 60;
const LINKY = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|uk|de|fr|it|ch|at|ru|xyz|info|biz|link|ly|me|app)\b|@[a-z0-9-]+\.[a-z]{2,}|(\+?\d[\s-]?){9,})/i;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Device, X-Admin-Key, X-Server-Key', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' };
const clean = (s, max) => String(s || '').replace(/[\u0000-\u0009\u000b-\u001f<>]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

const NEWS_FEEDS = [
  ['Race stories', 'https://shop.spartan.com/blogs/unbreakable-race-stories.atom'],
  ['Training', 'https://shop.spartan.com/blogs/unbreakable-training.atom'],
  ['Community', 'https://shop.spartan.com/blogs/unbreakable-community.atom'],
  ['Newsroom', 'https://shop.spartan.com/blogs/newsroom.atom'],
];

/**
 * verifyGoogle(idToken) -> {sub, email, name, picture} (throws when invalid); secret signs our own session tokens.
 * adminEmails: Google accounts that are admins. While neither adminEmails nor adminKey is set, everyone is (the prototype).
 */
function createApi({ store, now = Date.now, adminKey = '', adminEmails = [], verifyGoogle = null, emailSignIn = null, secret = '', googleClientId = '', fetchText = null, blobSigner = null, putBrand = null, maxRunningServers = 1, serverHourPrice = 0.66 }) {
  const reply = (status, body) => ({ status, body, headers: { 'Content-Type': 'application/json', ...CORS } });
  const admins = adminEmails.map((e) => String(e).trim().toLowerCase()).filter(Boolean);
  // session tokens: base64url(payload).HMAC
  const sign = (payload) => { const p = Buffer.from(JSON.stringify(payload)).toString('base64url'); return p + '.' + crypto.createHmac('sha256', secret).update(p).digest('base64url'); };
  const session = (h) => {
    const m = /^Bearer (.+)\.(.+)$/.exec(String(h.authorization || '')); if (!m || !secret) return null;
    const good = crypto.createHmac('sha256', secret).update(m[1]).digest('base64url');
    if (good.length !== m[2].length || !crypto.timingSafeEqual(Buffer.from(good), Buffer.from(m[2]))) return null;
    try { const p = JSON.parse(Buffer.from(m[1], 'base64url').toString()); return p.exp > now() ? p : null; } catch { return null; }
  };
  const deviceOf = (h) => { const d = String(h['x-device'] || ''); return /^[\w-]{16,64}$/.test(d) ? crypto.createHash('sha256').update(d).digest('base64url').slice(0, 22) : null; };
  // who's asking: the signed-in account, or (not signed in) this phone
  const who = (h) => { const s = session(h); return s ? s.uid : deviceOf(h); };
  const isAdmin = (h) => {
    if (adminKey && h['x-admin-key'] === adminKey) return true;
    const s = session(h); if (s && admins.includes(String(s.email || '').toLowerCase())) return true;
    return !adminKey && !admins.length; // prototype: nothing set = everyone is an admin
  };

  async function content(method, part, body, h) {
    if (method === 'GET' && !part) {
      const out = {};
      for (const k of Object.keys(DEFAULT_CONTENT)) out[k] = (await store.get('content', k)) ?? DEFAULT_CONTENT[k];
      return reply(200, { ...out, canEdit: isAdmin(h) });
    }
    if (method === 'PUT' && part in DEFAULT_CONTENT) {
      if (!isAdmin(h)) return reply(403, { error: 'Only admins can change the home page' });
      const v = body && body.value;
      if (part === 'race') {
        if (!v || typeof v !== 'object') return reply(400, { error: 'race details missing' });
        const race = {}; for (const k of Object.keys(DEFAULT_CONTENT.race)) race[k] = clean(v[k], 300);
        await store.put('content', 'race', race); return reply(200, { race });
      }
      if (!Array.isArray(v) || v.length > 50) return reply(400, { error: 'a list of up to 50 items' });
      if (part === 'competitions') {
        const list = v.map((c) => ({ name: clean(c.name, 120), date: clean(c.date, 10), place: clean(c.place, 120), course: /^[a-z0-9-]{2,40}$/.test(c.course || '') ? c.course : '', note: clean(c.note, 600),
          winners: (Array.isArray(c.winners) ? c.winners : []).slice(0, 30).map((w) => ({ course: clean(w.course, 40), women: clean(w.women, 120), men: clean(w.men, 120), time: clean(w.time, 30) })).filter((w) => w.course) })).filter((c) => c.name);
        await store.put('content', part, list); return reply(200, { [part]: list });
      }
      const httpsUrl = (u) => (/^https:\/\/[\w.-]+\//.test(String(u || '')) ? clean(u, 300) : '');
      const list = part === 'news'
        ? v.map((n) => ({ title: clean(n.title, 120), text: clean(n.text, 1500), date: clean(n.date, 30) })).filter((n) => n.title)
        : part === 'events'
          ? v.map((e) => ({ name: clean(e.name, 120), date: clean(e.date, 10), end: clean(e.end, 10), place: clean(e.place, 120), races: clean(e.races, 160), url: httpsUrl(e.url) })).filter((e) => e.name)
          : v.map((w) => ({ race: clean(w.race, 120), year: clean(w.year, 10), course: clean(w.course, 40), women: clean(w.women, 120), men: clean(w.men, 120) })).filter((w) => w.race);
      await store.put('content', part, list); return reply(200, { [part]: list });
    }
    return null;
  }

  async function board(method, room, id, action, body, h) {
    if (!room && method === 'GET') return reply(200, { rooms: ROOMS });
    const me = who(h);
    // a public room, or a private group's room (members only)
    let info = ROOMS.find((r) => r.id === room), group = null;
    if (!info && /^g-[\w-]{6,30}$/.test(room)) {
      group = await store.get('group', room.slice(2));
      if (!group || !me || !group.members.some((m) => m.id === me)) return reply(404, { error: 'no such group' });
      info = { id: room, name: group.name, about: `Private group · ${group.members.length} member${group.members.length === 1 ? '' : 's'}`, group: true };
    }
    if (!info) return reply(404, { error: 'no such room' });
    const banned = me ? await store.get('ban:' + room, me) : null;
    const view = (p) => ({ id: p.id, name: p.name, text: p.text, at: p.at, mine: !!me && p.author === me });
    if (!id && method === 'GET') {
      const posts = (await store.list('room:' + room)).filter((p) => !p.hidden).sort((a, b) => a.at - b.at).slice(-SHOW);
      return reply(200, { room: info, posts: posts.map(view), banned: !!banned, serverTime: now() });
    }
    if (!id && method === 'POST') {
      if (!me) return reply(400, { error: 'This device has no id yet – reload the app' });
      if (banned) return reply(403, { error: 'You’ve been banned from this chat after reports from other Spartans' });
      const name = clean(body && body.name, 30), text = clean(body && body.text, MAX_LEN + 1);
      if (!name) return reply(400, { error: 'Pick a name first' });
      if (rudeName(name)) return reply(400, { error: 'Pick a different name' });
      if (!text) return reply(400, { error: 'Write a message first' });
      if (text.length > MAX_LEN) return reply(400, { error: `Keep it under ${MAX_LEN} characters` });
      if (rudeText(text)) return reply(400, { error: 'That message has words that aren’t allowed here' });
      if (!group && ABUSE.test(text)) return reply(400, { error: 'Keep it friendly – insults and abuse aren’t allowed in the public chat' });
      if (!group && LINKY.test(text)) return reply(400, { error: 'No links, email addresses or phone numbers in the public chat' });
      const log = (await store.get('postlog', me)) || { times: [], last: '' };
      log.times = log.times.filter((t) => now() - t < 24 * 3600 * 1000);
      if (log.times.length && now() - log.times[log.times.length - 1] < GAP_MS) return reply(429, { error: 'Slow down – one message every 10 seconds' });
      if (log.times.length >= PER_DAY) return reply(429, { error: 'That’s 60 messages today – back tomorrow' });
      if (log.last === text.toLowerCase()) return reply(409, { error: 'You’ve just sent that' });
      const p = { id: now().toString(36) + crypto.randomBytes(5).toString('base64url'), name, text, at: now(), author: me, reports: [], hidden: false };
      await store.put('room:' + room, p.id, p);
      log.times.push(now()); log.last = text.toLowerCase(); await store.put('postlog', me, log);
      await touchProfile(me, (await store.get('profile', me) || {}).name ? {} : { name });
      const all = (await store.list('room:' + room)).sort((a, b) => b.at - a.at);
      for (const old of all.slice(KEEP)) await store.remove('room:' + room, old.id); // each room keeps its latest 400
      return reply(200, { post: view(p) });
    }
    const p = id && await store.get('room:' + room, id);
    if (!p) return reply(404, { error: 'message not found' });
    if (!action && method === 'DELETE') {
      if (p.author !== me && !(adminKey && isAdmin(h))) return reply(403, { error: 'You can only delete your own messages' });
      await store.remove('room:' + room, id); return reply(200, { deleted: true });
    }
    if (action === 'report' && method === 'POST') {
      if (!me) return reply(400, { error: 'This device has no id yet' });
      if (p.author === me) return reply(400, { error: 'That’s your own message' });
      p.reports = [...new Set([...(p.reports || []), me])];
      await store.put('room:' + room, id, p);
      // the self-moderation: 3 different people reporting someone (any of their messages here) bans them from this chat
      const rec = (await store.get('reports:' + room, p.author)) || { reporters: [], items: [] };
      rec.reporters = [...new Set([...rec.reporters, me])];
      if (!rec.items.some((x) => x.id === p.id)) rec.items.push({ id: p.id, text: p.text, at: p.at });
      rec.items.forEach((x) => { if (x.id === p.id) x.by = p.reports.length; });
      await store.put('reports:' + room, p.author, rec);
      let nowBanned = false;
      if (rec.reporters.length >= REPORTERS_TO_BAN && !(await store.get('ban:' + room, p.author))) {
        const ban = { room, roomName: info.name, author: p.author, name: p.name, at: now(), reporters: rec.reporters.length, messages: rec.items.slice(-10) };
        await store.put('ban:' + room, p.author, ban);
        await store.put('bans', room + '|' + p.author, ban);
        for (const it of rec.items) { const q = await store.get('room:' + room, it.id); if (q) { q.hidden = true; await store.put('room:' + room, it.id, q); } }
        nowBanned = true;
      }
      return reply(200, { reported: true, banned: nowBanned });
    }
    return null;
  }


  // ---------------------------------------------------------------- private groups
  const newCode = () => Array.from(crypto.randomBytes(6), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  async function codeFor(groupId) {
    for (let i = 0; i < 5; i++) { const c = newCode(); if (!(await store.get('groupcode', c))) { await store.put('groupcode', c, groupId); return c; } }
    throw new Error('no code');
  }
  const gview = (g, me) => ({ id: g.id, room: 'g-' + g.id, name: g.name, code: g.code, owner: g.owner === me, members: g.members.map((m) => ({ name: m.name, me: m.id === me })) });
  async function addMember(g, me, name) {
    if (g.members.some((m) => m.id === me)) return;
    if (g.members.length >= GROUP_MAX) throw Object.assign(new Error('full'), { status: 409, msg: `That group is full (${GROUP_MAX} people)` });
    g.members.push({ id: me, name }); await store.put('group', g.id, g); await store.put('mygroups:' + me, g.id, { id: g.id });
  }
  async function groups(method, a, b, c, body, h) {
    const me = who(h); if (!me) return reply(400, { error: 'This device has no id yet – reload the app' });
    const name = clean(body && body.me, 30);
    const needName = () => (!name ? 'Pick a name first' : rudeName(name) ? 'Pick a different name' : null);
    if (!a && method === 'GET') {
      const mine = []; for (const x of await store.list('mygroups:' + me)) { const g = await store.get('group', x.id); if (g && g.members.some((m) => m.id === me)) mine.push(gview(g, me)); }
      const invites = (await store.list('invites:' + me)).sort((x, y) => y.at - x.at);
      return reply(200, { groups: mine.sort((x, y) => x.name.localeCompare(y.name)), invites });
    }
    if (!a && method === 'POST') {
      const why = needName(); if (why) return reply(400, { error: why });
      const gname = clean(body && body.name, 40);
      if (!gname) return reply(400, { error: 'Give the group a name' });
      if (rudeName(gname)) return reply(400, { error: 'Pick a different group name' });
      if ((await store.list('mygroups:' + me)).length >= 20) return reply(429, { error: 'That’s 20 groups – leave one first' });
      const g = { id: crypto.randomBytes(8).toString('base64url'), name: gname, owner: me, members: [], at: now() };
      g.code = await codeFor(g.id); await addMember(g, me, name);
      return reply(200, { group: gview(g, me) });
    }
    if (a === 'join' && method === 'POST') {
      const why = needName(); if (why) return reply(400, { error: why });
      const id = await store.get('groupcode', String((body && body.code) || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
      const g = id && await store.get('group', id);
      if (!g) return reply(404, { error: 'No group has that code' });
      try { await addMember(g, me, name); } catch (e) { return reply(e.status || 500, { error: e.msg || 'Couldn’t join' }); }
      return reply(200, { group: gview(g, me) });
    }
    if (a === 'invites' && b && (c === 'accept' || c === 'decline') && method === 'POST') {
      const inv = await store.get('invites:' + me, b); if (!inv) return reply(404, { error: 'That invite has gone' });
      await store.remove('invites:' + me, b);
      if (c === 'decline') return reply(200, { declined: true });
      const why = needName(); if (why) return reply(400, { error: why });
      const g = await store.get('group', inv.group); if (!g) return reply(404, { error: 'That group no longer exists' });
      try { await addMember(g, me, name); } catch (e) { return reply(e.status || 500, { error: e.msg || 'Couldn’t join' }); }
      return reply(200, { group: gview(g, me) });
    }
    const g = a && await store.get('group', a);
    if (!g || !g.members.some((m) => m.id === me)) return reply(404, { error: 'no such group' });
    if (b === 'invite' && method === 'POST') {
      // invite whoever wrote a message (they're picked from the chat, so we never see who they are)
      const room = String((body && body.room) || ''), post = room && (body.post ? await store.get('room:' + room, String(body.post)) : null);
      if (!post) return reply(404, { error: 'Couldn’t find that person’s message' });
      if (g.members.some((m) => m.id === post.author)) return reply(409, { error: `${post.name} is already in ${g.name}` });
      const fromName = (g.members.find((m) => m.id === me) || {}).name || 'Someone';
      const existing = (await store.list('invites:' + post.author)).find((x) => x.group === g.id);
      if (!existing) {
        const inv = { id: crypto.randomBytes(6).toString('base64url'), group: g.id, groupName: g.name, from: fromName, at: now() };
        await store.put('invites:' + post.author, inv.id, inv);
      }
      return reply(200, { invited: post.name });
    }
    if (b === 'leave' && method === 'POST') {
      g.members = g.members.filter((m) => m.id !== me); await store.remove('mygroups:' + me, g.id);
      if (!g.members.length) { await store.remove('group', g.id); await store.remove('groupcode', g.code); return reply(200, { left: true, deleted: true }); }
      if (g.owner === me) g.owner = g.members[0].id; // the next member looks after it
      await store.put('group', g.id, g); return reply(200, { left: true });
    }
    if (b === 'code' && method === 'POST') {
      if (g.owner !== me) return reply(403, { error: 'Only the group’s owner can change the code' });
      await store.remove('groupcode', g.code); g.code = await codeFor(g.id); await store.put('group', g.id, g);
      return reply(200, { group: gview(g, me) });
    }
    return null;
  }


  // ---------------------------------------------------------------- accounts and profiles
  const PROFILE_FIELDS = { name: 30, spartanUrl: 300, racerNo: 20, country: 40, ageGroup: 20 };
  async function touchProfile(id, patch = {}) {
    const p = (await store.get('profile', id)) || { id, at: now() };
    Object.assign(p, patch, { seen: now() }); await store.put('profile', id, p); return p;
  }
  async function authGoogle(body, h) {
    if (!verifyGoogle || !secret) return reply(503, { error: 'Google sign-in isn’t set up on the server yet' });
    let g; try { g = await verifyGoogle(String((body && body.idToken) || '')); } catch { return reply(401, { error: 'Google sign-in didn’t work – try again' }); }
    const uid = 'g_' + crypto.createHash('sha256').update(String(g.sub)).digest('base64url').slice(0, 22);
    const user = { id: uid, email: g.email || '', name: g.name || '', picture: g.picture || '' };
    await store.put('user', uid, user);
    // bring this phone's groups and profile across to the account
    const dev = deviceOf(h);
    if (dev && dev !== uid) {
      for (const x of await store.list('mygroups:' + dev)) {
        const gr = await store.get('group', x.id); if (!gr) continue;
        const already = gr.members.some((m) => m.id === uid);
        gr.members = already ? gr.members.filter((m) => m.id !== dev) : gr.members.map((m) => (m.id === dev ? { ...m, id: uid } : m));
        if (gr.owner === dev) gr.owner = uid;
        await store.put('group', gr.id, gr); await store.put('mygroups:' + uid, gr.id, { id: gr.id }); await store.remove('mygroups:' + dev, gr.id);
      }
      const old = await store.get('profile', dev);
      if (old) { const cur = (await store.get('profile', uid)) || {}; await store.put('profile', uid, { ...old, ...cur, id: uid, judge: !!(old.judge || cur.judge) }); await store.remove('profile', dev); }
    }
    await carryScores(dev, uid);
    await touchProfile(uid, { email: user.email, google: true, ...(user.name && !(await store.get('profile', uid) || {}).name ? { name: user.name.slice(0, 30) } : {}) });
    return reply(200, { token: sign({ uid, email: user.email, exp: now() + 30 * 24 * 3600 * 1000 }), user });
  }
  // The Broadcaster's email accounts (email-signin.js). The session deliberately has no email in it, so one of these
  // can never count as an admin through ADMIN_EMAILS: admins sign in with Google on the site.
  async function authEmail(body) {
    if (!emailSignIn || !secret) return reply(503, { error: 'Email sign-in isn’t set up on the server yet' });
    const code = (body && body.code) || '', verifier = (body && body.verifier) || '';
    if (typeof code !== 'string' || !code || code.length > 8192 || typeof verifier !== 'string' || !/^[\w.~-]{43,128}$/.test(verifier)) return reply(400, { error: 'That sign-in link isn’t right – try again' });
    let c; try { c = await emailSignIn.redeem(code, verifier); } catch { return reply(401, { error: 'Sign-in didn’t work – try again' }); }
    const uid = 'e_' + crypto.createHash('sha256').update(String(c.sub)).digest('base64url').slice(0, 22);
    const user = { id: uid, email: c.email, name: c.name, picture: '' };
    await store.put('user', uid, user);
    await touchProfile(uid, { email: user.email, ...(user.name && !(await store.get('profile', uid) || {}).name ? { name: user.name.slice(0, 30) } : {}) });
    return reply(200, { token: sign({ uid, exp: now() + 30 * 24 * 3600 * 1000 }), user });
  }
  async function me(h) {
    const id = who(h); if (!id) return reply(400, { error: 'This device has no id yet – reload the app' });
    const s = session(h), profile = await touchProfile(id);
    const user = s ? await store.get('user', s.uid) : null;
    return reply(200, { user, profile: { ...profile, id: undefined }, admin: isAdmin(h), judge: !!profile.judge || isAdmin(h) });
  }
  async function profile(method, a, body, h) {
    const id = who(h); if (!id) return reply(400, { error: 'This device has no id yet – reload the app' });
    if (!a && method === 'PUT') {
      const patch = {};
      for (const [k, max] of Object.entries(PROFILE_FIELDS)) if (body && k in body) patch[k] = clean(body[k], max);
      if (patch.name && rudeName(patch.name)) return reply(400, { error: 'Pick a different name' });
      if (patch.spartanUrl && !/^https:\/\/([\w-]+\.)*spartan\.com\//i.test(patch.spartanUrl)) return reply(400, { error: 'That should be a link to your profile or results on spartan.com' });
      const p = await touchProfile(id, patch); return reply(200, { profile: { ...p, id: undefined } });
    }
    if (a === 'judge' && method === 'POST') {
      const code = await store.get('settings', 'judgecode');
      if (!code || String((body && body.code) || '').toUpperCase().replace(/[^A-Z0-9]/g, '') !== code) return reply(400, { error: 'That judge code isn’t right – ask an admin' });
      const p = await touchProfile(id, { judge: true, judgeSince: now() }); return reply(200, { profile: { ...p, id: undefined } });
    }
    return null;
  }

  // ---------------------------------------------------------------- burpee challenges: 1 and 5 minutes, and the scoreboard
  // A phone counts the reps (the Burpee practice page, Spartan standard) and sends the score here, under the
  // signed-in account or the phone. Each person's best counts on a board; today and this week from the last 8 days
  // of attempts, all time from each person's best. A score has to be possible and can't arrive more often than the
  // challenge lasts.
  // The most that's possible, per exercise. Burpees keep their plain names (1min, 5min); the others are squats.1min and so on.
  // 'practice' is the hand test, for admins only.
  const EXERCISE_MAX = { burpees: [70, 260], squats: [120, 500], pushups: [100, 400], jacks: [200, 900], situps: [100, 400], practice: [300, 1200] };
  const CHALLENGES = {};
  for (const [ex, [one, five]] of Object.entries(EXERCISE_MAX)) {
    const name = (m) => (ex === 'burpees' ? m : ex + '.' + m);
    CHALLENGES[name('1min')] = { secs: 60, max: one, exercise: ex };
    CHALLENGES[name('5min')] = { secs: 300, max: five, exercise: ex };
  }
  const DAY = 24 * 3600 * 1000;
  const nameOf = async (id) => clean((await store.get('profile', id) || {}).name, 30) || 'Spartan';
  // A phone's scores, bests and attempts, moved to the account it's signed in to, so nobody is on a board twice.
  // Safe to repeat: the second time there's nothing left to move.
  async function carryScores(dev, uid) {
    if (!dev || dev === uid) return;
    for (const m of Object.keys(CHALLENGES)) {
      for (const x of (await store.list('score:' + m)).filter((x) => x.who === dev)) await store.put('score:' + m, x.id, { ...x, who: uid });
      const best = await store.get('best:' + m, dev);
      if (best) {
        const cur = await store.get('best:' + m, uid);
        if (!cur || best.reps > cur.reps) await store.put('best:' + m, uid, { ...best, who: uid });
        await store.remove('best:' + m, dev);
      }
      const last = await store.get('lastscore:' + m, dev);
      if (last) {
        const cur = await store.get('lastscore:' + m, uid);
        if (!cur || last.at > cur.at) await store.put('lastscore:' + m, uid, last);
        await store.remove('lastscore:' + m, dev);
      }
    }
    for (const x of await store.list('attempt:' + dev)) { await store.put('attempt:' + uid, x.id, x); await store.remove('attempt:' + dev, x.id); }
  }
  // Every attempt each person makes, kept for good: their own history, whether or not it went on a scoreboard.
  async function attempts(method, body, me, h) {
    if (!me) return reply(400, { error: 'This device has no id yet – reload the app' });
    if (method === 'GET') {
      const bests = {};
      for (const m of Object.keys(CHALLENGES)) { const b = await store.get('best:' + m, me); if (b) bests[m] = { reps: b.reps, at: b.at }; }
      return reply(200, { attempts: (await store.list('attempt:' + me)).sort((x, y) => y.at - x.at), bests });
    }
    if (method !== 'POST') return null;
    const b = body || {}, exercise = b.exercise === undefined ? 'burpees' : b.exercise, reps = Math.round(Number(b.reps));
    if (exercise === 'practice' && !isAdmin(h)) return reply(403, { error: 'Admins only' });
    const timed = CHALLENGES[exercise === 'burpees' ? b.mode : exercise + '.' + b.mode];
    const max = b.mode === 'free' && EXERCISE_MAX[exercise] ? 5000 : timed && timed.max;
    if (!max || !/^[a-z0-9-]{6,40}$/i.test(String(b.id)) || !Number.isFinite(reps) || reps < 0 || reps > max) return reply(400, { error: 'That attempt isn’t possible' });
    const at = Number(b.at);
    await store.put('attempt:' + me, b.id, {
      id: b.id, exercise, mode: b.mode, reps, noReps: Math.max(0, Math.round(Number(b.noReps) || 0)),
      durationMs: Math.max(0, Math.round(Number(b.durationMs) || 0)), status: b.status === 'full' ? 'full' : 'stopped',
      camera: b.camera === 'back' ? 'back' : 'front', submitted: !!b.submitted, at: at > 0 && at <= now() + DAY ? at : now(),
    });
    return reply(200, { saved: true });
  }
  async function scores(method, a, body, h, query = {}) {
    const me = who(h);
    // Already signed in when this came in: anything still under the phone moves over when they open the menu.
    if (a === 'attempts' && method === 'GET' && session(h)) await carryScores(deviceOf(h), me);
    if (a === 'attempts') return attempts(method, body, me, h);
    if (a === 'me' && method === 'GET') {
      if (!me) return reply(400, { error: 'This device has no id yet – reload the app' });
      const out = {};
      for (const m of ['1min', '5min']) { // the burpee bests on the home and profile pages
        const best = await store.get('best:' + m, me);
        const recent = (await store.list('score:' + m)).filter((x) => x.who === me).sort((x, y) => y.at - x.at).slice(0, 10).map((x) => ({ reps: x.reps, noReps: x.noReps, at: x.at }));
        out[m] = { best: best ? { reps: best.reps, at: best.at } : null, recent };
      }
      return reply(200, out);
    }
    const c = CHALLENGES[a]; if (!c) return null;
    if (c.exercise === 'practice' && !isAdmin(h)) return reply(403, { error: 'Admins only' });
    if (method === 'POST') {
      if (!me) return reply(400, { error: 'This device has no id yet – reload the app' });
      const reps = Math.round(Number(body && body.reps)), noReps = Math.max(0, Math.round(Number(body && body.noReps) || 0));
      if (!Number.isFinite(reps) || reps < 0 || reps > c.max) return reply(400, { error: 'That score isn’t possible' });
      const last = await store.get('lastscore:' + a, me);
      if (last && now() - last.at < c.secs * 1000 * 0.9) return reply(429, { error: 'One score per challenge – that one was too soon' });
      const at = now(), id = at.toString(36) + crypto.randomBytes(3).toString('base64url');
      await store.put('score:' + a, id, { id, who: me, reps, noReps, at });
      await store.put('lastscore:' + a, me, { at });
      const best = await store.get('best:' + a, me);
      const pb = !best || reps > best.reps;
      if (pb) await store.put('best:' + a, me, { who: me, reps, at });
      for (const old of (await store.list('score:' + a)).filter((x) => at - x.at > 8 * DAY)) await store.remove('score:' + a, old.id);
      return reply(200, { saved: true, reps, best: pb ? reps : best.reps, personalBest: pb });
    }
    if (method === 'GET') {
      const period = ['today', 'week', 'all'].includes(query.period) ? query.period : 'today';
      let rows;
      if (period === 'all') rows = await store.list('best:' + a);
      else {
        const since = period === 'today' ? now() - (now() % DAY) : now() - 7 * DAY;
        const by = new Map();
        for (const x of await store.list('score:' + a)) if (x.at >= since && (!by.has(x.who) || x.reps > by.get(x.who).reps)) by.set(x.who, x);
        rows = [...by.values()];
      }
      rows.sort((x, y) => y.reps - x.reps || x.at - y.at);
      const view = async (x, i) => ({ rank: i + 1, name: await nameOf(x.who), reps: x.reps, at: x.at, mine: !!me && x.who === me });
      const top = await Promise.all(rows.slice(0, 20).map(view));
      const myIndex = me ? rows.findIndex((x) => x.who === me) : -1;
      return reply(200, { challenge: a, period, top, me: myIndex >= 20 ? await view(rows[myIndex], myIndex) : null, count: rows.length });
    }
    return null;
  }

  // ---------------------------------------------------------------- news from Spartan's blogs (cached for an hour)
  const unescape = (t) => String(t || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));
  function parseAtom(xml, blog) {
    return [...String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => {
      const tag = (t) => { const m = new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`).exec(e); return m ? unescape(m[1]) : ''; };
      const html = tag('content') || tag('summary');
      const img = /<img[^>]*src="([^"]+)"/.exec(html);
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const link = /<link[^>]*href="([^"]+)"/.exec(e);
      return { title: tag('title'), date: (tag('published') || tag('updated')).slice(0, 10), url: link ? unescape(link[1]) : '', image: img && /^https:/.test(img[1]) ? img[1] : '', summary: text.slice(0, 220) + (text.length > 220 ? '…' : ''), blog };
    }).filter((a) => a.title && /^https:\/\//.test(a.url));
  }
  async function news() {
    const cached = await store.get('cache', 'news');
    if (cached && now() - cached.at < 3600 * 1000) return reply(200, { articles: cached.articles });
    let articles = [];
    if (fetchText) {
      const got = await Promise.all(NEWS_FEEDS.map(async ([blog, url]) => { try { return parseAtom(await fetchText(url), blog); } catch { return []; } }));
      articles = got.flat().sort((x, y) => y.date.localeCompare(x.date)).slice(0, 40);
    }
    if (articles.length) await store.put('cache', 'news', { at: now(), articles });
    return reply(200, { articles: articles.length ? articles : (cached ? cached.articles : []) });
  }

  // ---------------------------------------------------------------- admin: Burpee judges
  async function adminPeople(method, b, c, body) {
    if (!b && method === 'GET') {
      const people = (await store.list('profile')).sort((x, y) => (y.seen || 0) - (x.seen || 0)).slice(0, 500)
        .map((p) => ({ who: p.id, name: p.name || '', email: p.email || '', google: !!p.google, judge: !!p.judge, seen: p.seen || 0, spartanUrl: p.spartanUrl || '' }));
      return reply(200, { people });
    }
    if (b && c === 'judge' && method === 'POST') {
      const p = await store.get('profile', b); if (!p) return reply(404, { error: 'no such person' });
      p.judge = !!(body && body.on); if (p.judge) p.judgeSince = now(); await store.put('profile', b, p);
      return reply(200, { judge: p.judge });
    }
    return null;
  }
  async function judgeCode(method) {
    let code = await store.get('settings', 'judgecode');
    if (method === 'POST' || !code) { code = newCode(); await store.put('settings', 'judgecode', code); }
    return reply(200, { code });
  }

  // ---------------------------------------------------------------- admin: bans
  async function admin(method, a, b, c, h, body) {
    if (!isAdmin(h)) return reply(403, { error: 'Admins only' });
    if (a === 'companies') return adminCompanies(method, b, c, body);
    if (a === 'pricing' && !b) return adminPricing(method, body);
    if (a === 'customers') return adminCustomers(method, b, c);
    if (a === 'people') return adminPeople(method, b, c, body);
    if (a === 'judgecode' && !b) return judgeCode(method);
    if (a === 'bans' && !b && method === 'GET') {
      const bans = (await store.list('bans')).sort((x, y) => y.at - x.at).map((x) => ({ room: x.room, roomName: x.roomName, who: x.author, name: x.name, at: x.at, reporters: x.reporters, messages: x.messages }));
      return reply(200, { bans });
    }
    if (a === 'bans' && b && c && method === 'POST') {
      const [room, author] = [b, c.replace(/\/lift$/, '')];
      await store.remove('ban:' + room, author); await store.remove('bans', room + '|' + author); await store.remove('reports:' + room, author);
      return reply(200, { lifted: true });
    }
    return null;
  }

  const recordings = createRecordings({ store, signer: blobSigner, now, reply, session, isAdmin });
  const { servers, adminPricing, adminCustomers, stopCompany } = createServers({ store, now, reply, session, maxRunning: maxRunningServers, hourPrice: serverHourPrice });
  const { companies, adminCompanies } = createCompanies({ store, now, reply, session, isAdmin, putBrand, onBlocked: stopCompany });

  async function handle({ method, path, headers = {}, body, query: extraQuery = {} }) {
    const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    if (method === 'OPTIONS') return { status: 204, body: null, headers: CORS };
    // The app (another origin) sends everything as a plain-text POST: browsers then skip the CORS pre-check, which
    // Static Web Apps answers without CORS headers. The real method, who's asking and the body are inside.
    if (method === 'POST' && body && body._env === 1) {
      const m = String(body.m || 'GET').toUpperCase();
      if (!['GET', 'POST', 'PUT', 'DELETE'].includes(m)) return { status: 405, body: { error: 'Not allowed' }, headers: CORS };
      method = m;
      h['x-device'] = String(body.d || '');
      if (body.t) h.authorization = 'Bearer ' + body.t; else delete h.authorization;
      if (body.k) h['x-admin-key'] = String(body.k); else delete h['x-admin-key'];
      body = body.b === undefined ? null : body.b;
    }
    const [pathOnly, qs = ''] = String(path || '').split('?');
    const query = Object.fromEntries(new URLSearchParams(qs));
    const parts = pathOnly.replace(/^\/+|\/+$/g, '').split('/');
    try {
      let r = null;
      if (parts[0] === 'content' && parts.length <= 2) r = await content(method, parts[1], body, h);
      if (parts[0] === 'board' && parts.length <= 4) r = await board(method, parts[1], parts[2], parts[3], body, h);
      if (parts[0] === 'groups' && parts.length <= 4) r = await groups(method, parts[1], parts[2], parts[3], body, h);
      if (parts[0] === 'admin' && parts.length <= 5 && (parts.length < 5 || parts[4] === 'lift')) r = await admin(method, parts[1], parts[2], parts[3], h, body);
      if (parts[0] === 'config' && method === 'GET') r = reply(200, { googleClientId, signIn: !!(verifyGoogle && secret && googleClientId), emailSignIn: emailSignIn && secret ? emailSignIn.config : null });
      if (parts[0] === 'auth' && parts[1] === 'google' && method === 'POST') r = await authGoogle(body, h);
      if (parts[0] === 'auth' && parts[1] === 'email' && method === 'POST') r = await authEmail(body);
      if (parts[0] === 'me' && method === 'GET') r = await me(h);
      if (parts[0] === 'profile' && parts.length <= 2) r = await profile(method, parts[1], body, h);
      if (parts[0] === 'news' && method === 'GET') r = await news();
      if (parts[0] === 'recordings' && parts.length <= 3) r = await recordings(method, parts[1], parts[2], body, h);
      if (parts[0] === 'servers' && parts.length <= 3) r = await servers(method, parts[1], parts[2], body, h);
      if (parts[0] === 'companies' && parts.length <= 3) r = await companies(method, parts[1], parts[2], body, h);
      if (parts[0] === 'scores' && parts.length === 2) r = await scores(method, parts[1], body, h, { ...query, ...extraQuery });
      return r || reply(404, { error: 'not found' });
    } catch (e) {
      return reply(500, { error: 'Something went wrong – try again' });
    }
  }
  return { handle };
}

module.exports = { createApi, ROOMS, CORS };
