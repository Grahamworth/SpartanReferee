'use strict';
/* Which referees are assigned to which of Spartan's events, as head referee or referee, each referee's home page (home.html) and
   each event's page (event.html), from 19 November 2026. Admins assign referees on the admin page; a referee sees their upcoming
   events on their home page, and an event's page shows its days and times, who's refereeing it and its cameras, with the way to
   book them. An event's burpee cameras are booked and run by its head referee (and admins); every referee can watch and review them.

   GET  /api/home                          -> { name, email, admin, events, learn }   anyone in the organisation
   GET  /api/event/<id>                    -> { event, you, referees, booking }      anyone in the organisation
   GET  /api/admin/assignments             -> { assignments }                        admins: every assignment to an upcoming event
   POST /api/admin/assignments {eventId, email, role}                                admins: assign (role 'head' or 'referee', the
                                                                                     default), or change the role of someone assigned;
                                                                                     {eventId, email, remove: true} takes it off
     assignment  one row per event and person ("<eventId>|<email>"): { eventId, email, role, by, at }
     name        the name each person signed in with, by address, kept when they open their home page: { id: email, name } */
const EMAIL = /^[^\s@/#?\\|]+@[^\s@/#?\\|]+\.[^\s@/#?\\|]+$/;
const MAX_PER_EVENT = 100;
const ROLES = ['head', 'referee'];
const T = 'assignment';

function createAssignments({ store, now, reply, session, isAdmin, isAdminEmail, membership, events, bookingStatus = async () => null, learnOn = false }) {
  const all = async () => store.list(T);
  const roleOf = (r) => (r.role === 'head' ? 'head' : 'referee');
  // head referees first, then by address
  const byRole = (a, b) => (roleOf(a) === roleOf(b) ? a.email.localeCompare(b.email) : roleOf(a) === 'head' ? -1 : 1);
  const eventView = (e) => ({ id: e.id, unit: `e${e.id}`, name: e.name, city: e.city, country: e.country, tz: e.tz, startDate: e.startDate, endDate: e.endDate, url: e.url,
    from: e.windows[0]?.from || 0, until: e.windows[e.windows.length - 1]?.until || 0 });
  async function member(h) {
    const me = session(h); if (!me) return { error: reply(401, { error: 'Sign in first' }) };
    const m = await membership.companyFor(me);
    if (!m) return { error: reply(403, { error: "This account isn't on the list of referees. Ask an admin to add the address you sign in with." }) };
    return { me, m };
  }

  async function home(method, h) {
    if (method !== 'GET') return reply(405, { error: 'Not allowed' });
    const { me, m, error } = await member(h); if (error) return error;
    const user = await store.get('user', me.uid), name = String(user?.name || '').slice(0, 80);
    // so others see this name on an event's page
    if (name && (await store.get('name', m.email))?.name !== name) await store.put('name', m.email, { id: m.email, name });
    const mine = new Map((await all()).filter((r) => r.email === m.email).map((r) => [r.eventId, roleOf(r)]));
    const upcoming = (await events.upcoming()).filter((e) => mine.has(e.id));
    return reply(200, { name, email: m.email, admin: m.admin, events: upcoming.map((e) => ({ ...eventView(e), role: mine.get(e.id) })), learn: !!learnOn });
  }

  async function eventPage(method, id, h) {
    if (method !== 'GET') return reply(405, { error: 'Not allowed' });
    const { m, error } = await member(h); if (error) return error;
    id = String(id || '').replace(/^e/, '');
    const raw = /^\d{1,12}$/.test(id) && await events.get(id);
    if (!raw) return reply(404, { error: "That event isn't on Spartan's list" });
    const ev = (await events.upcoming()).find((e) => e.id === id) || null;
    const rows = (await all()).filter((r) => r.eventId === id).sort(byRole);
    const names = new Map(await Promise.all(rows.map(async (r) => [r.email, (await store.get('name', r.email))?.name || ''])));
    const you = rows.find((r) => r.email === m.email);
    return reply(200, {
      event: { ...(ev ? eventView(ev) : eventView({ ...raw, windows: [] })), windows: ev?.windows || [], over: !ev },
      you: you ? { role: roleOf(you) } : null,
      referees: rows.map((r) => ({ email: r.email, name: names.get(r.email), role: roleOf(r), you: r.email === m.email })),
      booking: await bookingStatus(`e${id}`),
      // its burpee cameras are booked and run by its head referee (and admins); every referee watches them
      canBook: m.admin || (you && roleOf(you) === 'head') || false,
    });
  }

  async function admin(method, body, h) {
    if (!isAdmin(h)) return reply(403, { error: 'Admins only' });
    if (method === 'GET') {
      const ids = new Set((await events.upcoming()).map((e) => e.id));
      return reply(200, { assignments: (await all()).filter((r) => ids.has(r.eventId)).sort(byRole).map((r) => ({ eventId: r.eventId, email: r.email, role: roleOf(r), by: r.by, at: r.at })) });
    }
    if (method !== 'POST') return reply(405, { error: 'Not allowed' });
    const eventId = String(body?.eventId || '').replace(/^e/, ''), email = String(body?.email || '').trim().toLowerCase();
    if (!/^\d{1,12}$/.test(eventId)) return reply(400, { error: 'Choose an event' });
    if (email.length > 200 || !EMAIL.test(email)) return reply(400, { error: "That doesn't look like an email address" });
    if (body?.role !== undefined && !ROLES.includes(body.role)) return reply(400, { error: 'Choose head referee or referee' });
    const key = `${eventId}|${email}`, was = await store.get(T, key);
    if (body?.remove === true) {
      if (!was) return reply(404, { error: "That referee isn't assigned to that event" });
      await store.remove(T, key);
      return reply(200, { ok: true });
    }
    const role = body?.role || 'referee', by = String(session(h)?.email || '').toLowerCase();
    if (was) {
      // already assigned: a different role changes it
      if (roleOf(was) === role) return reply(409, { error: `That referee is already assigned to that event as ${role === 'head' ? 'head referee' : 'referee'}` });
      await store.put(T, key, { ...was, role, by, at: now() });
      return reply(200, { ok: true });
    }
    if (!(await events.get(eventId))) return reply(404, { error: "That event isn't on Spartan's list" });
    // only someone who can sign in: a referee on the list, or an admin
    const onList = await store.get('people:spartan', email);
    if (!onList && !isAdminEmail(email)) return reply(400, { error: `${email} isn't on the list of referees: add them first` });
    if ((await all()).filter((r) => r.eventId === eventId).length >= MAX_PER_EVENT) return reply(400, { error: `An event can have up to ${MAX_PER_EVENT} referees` });
    await store.put(T, key, { id: key, eventId, email, role, by, at: now() });
    return reply(200, { ok: true });
  }
  return { home, eventPage, admin };
}

module.exports = { createAssignments };
