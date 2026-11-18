'use strict';
/* Which referees are assigned to which of Spartan's events, and each referee's home page (home.html), from 19 November 2026.
   Admins assign referees on the admin page; a referee sees their upcoming events on their home page, with the way to book cameras
   for one. Being assigned doesn't change who can book: any referee can book any event, as before.

   GET  /api/home                          -> { name, email, admin, events, learn }   anyone in the organisation
   GET  /api/admin/assignments             -> { assignments }                        admins: every assignment to an upcoming event
   POST /api/admin/assignments {eventId, email}                                      admins: assign; {…, remove: true} takes it off
     assignment  one row per event and referee ("<eventId>|<email>"): { eventId, email, by, at } */
const EMAIL = /^[^\s@/#?\\|]+@[^\s@/#?\\|]+\.[^\s@/#?\\|]+$/;
const MAX_PER_EVENT = 100;
const T = 'assignment';

function createAssignments({ store, now, reply, session, isAdmin, isAdminEmail, membership, events, learnOn = false }) {
  const all = async () => store.list(T);
  /** upcoming events (soonest first) with the people assigned to each */
  async function upcomingWith(filter = () => true) {
    const rows = (await all()).filter(filter), by = new Map();
    for (const r of rows) { if (!by.has(r.eventId)) by.set(r.eventId, []); by.get(r.eventId).push(r); }
    return { rows, upcoming: (await events.upcoming()).filter((e) => by.has(e.id)), by };
  }
  const eventView = (e) => ({ id: e.id, unit: `e${e.id}`, name: e.name, city: e.city, country: e.country, tz: e.tz, startDate: e.startDate, endDate: e.endDate, url: e.url, from: e.windows[0]?.from || 0, until: e.windows[e.windows.length - 1]?.until || 0 });

  async function home(method, h) {
    if (method !== 'GET') return reply(405, { error: 'Not allowed' });
    const me = session(h); if (!me) return reply(401, { error: 'Sign in first' });
    const m = await membership.companyFor(me);
    if (!m) return reply(403, { error: "This account isn't on the list of referees. Ask an admin to add the address you sign in with." });
    const user = await store.get('user', me.uid);
    const { upcoming } = await upcomingWith((r) => r.email === m.email);
    return reply(200, { name: String(user?.name || '').slice(0, 80), email: m.email, admin: m.admin, events: upcoming.map(eventView), learn: !!learnOn });
  }

  async function admin(method, body, h) {
    if (!isAdmin(h)) return reply(403, { error: 'Admins only' });
    if (method === 'GET') {
      const { rows, upcoming } = await upcomingWith();
      const ids = new Set(upcoming.map((e) => e.id));
      return reply(200, { assignments: rows.filter((r) => ids.has(r.eventId)).map(({ eventId, email, by, at }) => ({ eventId, email, by, at })).sort((a, b) => a.email.localeCompare(b.email)) });
    }
    if (method !== 'POST') return reply(405, { error: 'Not allowed' });
    const eventId = String(body?.eventId || '').replace(/^e/, ''), email = String(body?.email || '').trim().toLowerCase();
    if (!/^\d{1,12}$/.test(eventId)) return reply(400, { error: 'Choose an event' });
    if (email.length > 200 || !EMAIL.test(email)) return reply(400, { error: "That doesn't look like an email address" });
    const key = `${eventId}|${email}`;
    if (body?.remove === true) {
      if (!(await store.get(T, key))) return reply(404, { error: "That referee isn't assigned to that event" });
      await store.remove(T, key);
      return reply(200, { ok: true });
    }
    if (!(await events.get(eventId))) return reply(404, { error: "That event isn't on Spartan's list" });
    // only someone who can sign in: a referee on the list, or an admin
    const onList = await store.get('people:spartan', email);
    if (!onList && !isAdminEmail(email)) return reply(400, { error: `${email} isn't on the list of referees: add them first` });
    if (await store.get(T, key)) return reply(409, { error: 'That referee is already assigned to that event' });
    if ((await all()).filter((r) => r.eventId === eventId).length >= MAX_PER_EVENT) return reply(400, { error: `An event can have up to ${MAX_PER_EVENT} referees` });
    const by = String(session(h)?.email || '').toLowerCase();
    await store.put(T, key, { id: key, eventId, email, by, at: now() });
    return reply(200, { ok: true });
  }
  return { home, admin };
}

module.exports = { createAssignments };
