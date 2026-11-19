'use strict';
/* Who referees which of Spartan's events, from 19 November 2026; reworked the same day into events management.
   - Every referee sees their own events (upcoming and past) and each event's page: its days, place, Spartan's page for it, notes
     from its organisers, who's refereeing it, and its burpee cameras (anyone assigned watches and reviews them).
   - Admins, and regional coordinators for the events in their region (by the event's country), manage an event: who referees it,
     who's its head referee, who may book its cameras (a tick per person: only they, and admins, can book), and notes for its referees.
     Hundreds of referees: add many at once by pasting their addresses.

   GET  /api/home                       -> { name, email, admin, language, events (upcoming, yours), learn }    anyone in the organisation
   POST /api/home {language}            -> your preferred language
   GET  /api/my/events                  -> { upcoming, past }                                                   your events
   GET  /api/event/<id>                 -> { event, you, referees, notes, booking, canBook, canManage }
   POST /api/event/<id>/referees {emails | email, role?, canBook?} | {email, remove: true}                     managers
   PUT  /api/event/<id>/notes {text}                                                                             managers
   GET  /api/manage/events?q=&when=upcoming|past                -> { events: [...with counts], regions }       managers: the events in their scope
   GET  /api/admin/assignments, POST /api/admin/assignments {eventId, email, role, remove?}   the admin page (as before)
     assignment  one row per event and person ("<eventId>|<email>"): { eventId, email, role, canBook, by, at }
     eventnote   one row per event: { id: eventId, text, by, at }
     name        the name each person registered or signed in with, by address: { id: email, name } */
const EMAIL = /^[^\s@/#?\\|]+@[^\s@/#?\\|]+\.[^\s@/#?\\|]+$/;
const MAX_PER_EVENT = 300;
const ROLES = ['head', 'referee'];
const T = 'assignment';

// the languages the site speaks (i18n.js), for each referee's preferred one
const LANGUAGES = ['en', 'fr', 'de', 'nl', 'es', 'it', 'el', 'hr', 'cs', 'pl', 'fi', 'sv', 'da', 'ar', 'th'];

/** may this assignment book the event's cameras? The tick an organiser set; before ticks existed, the head referee */
const canBookRow = (r) => (r.canBook === undefined ? r.role === 'head' : !!r.canBook);

function createAssignments({ store, now, reply, session, isAdmin, isAdminEmail, membership, events, bookingStatus = async () => null, learnOn = false, onLanguage = null, scopeOf = async () => ({ countries: [] }) }) {
  const all = async () => store.list(T);
  const roleOf = (r) => (r.role === 'head' ? 'head' : 'referee');
  // head referees first, then by name or address
  const byRole = (a, b) => (roleOf(a) === roleOf(b) ? a.email.localeCompare(b.email) : roleOf(a) === 'head' ? -1 : 1);
  const eventView = (e) => ({ id: e.id, unit: `e${e.id}`, name: e.name, city: e.city, country: e.country, countryCode: e.countryCode || '', tz: e.tz, startDate: e.startDate, endDate: e.endDate, url: e.url,
    from: e.windows?.[0]?.from || 0, until: e.windows?.[e.windows.length - 1]?.until || 0 });
  async function member(h) {
    const me = session(h); if (!me) return { error: reply(401, { error: 'Sign in first' }) };
    const m = await membership.companyFor(me);
    if (!m) return { error: reply(403, { error: "This account isn't on the list of referees. Ask an admin to add the address you sign in with." }) };
    return { me, m };
  }
  /** what this person manages: { admin, countries } (a coordinator's regions' countries) */
  async function scope(h, m) { return m.admin || isAdmin(h) ? { admin: true, countries: [] } : { admin: false, countries: (await scopeOf(m.email)).countries || [] }; }
  const manages = (sc, ev) => sc.admin || (!!ev.countryCode && sc.countries.includes(ev.countryCode));
  const nameOf = async (email) => (await store.get('name', email))?.name || '';

  async function home(method, h, body) {
    if (method !== 'GET' && method !== 'POST') return reply(405, { error: 'Not allowed' });
    const { me, m, error } = await member(h); if (error) return error;
    if (method === 'POST') {
      const language = String(body?.language || '');
      if (!LANGUAGES.includes(language)) return reply(400, { error: 'Choose one of the languages listed' });
      await store.put('lang', m.email, { id: m.email, lang: language });
      if (onLanguage) Promise.resolve().then(() => onLanguage(m.email, language)).catch((e) => console.error(`language for learning: ${e.message}`));
      return reply(200, { language });
    }
    // the name they registered with wins; otherwise the one their sign-in gives, kept so others see it on an event's page
    const signedName = String((await store.get('user', me.uid))?.name || '').slice(0, 80);
    let name = await nameOf(m.email);
    if (!name && signedName) { name = signedName; await store.put('name', m.email, { id: m.email, name }); }
    const mine = new Map((await all()).filter((r) => r.email === m.email).map((r) => [r.eventId, r]));
    const upcoming = (await events.upcoming()).filter((e) => mine.has(e.id));
    const language = (await store.get('lang', m.email))?.lang || '';
    const sc = await scope(h, m);
    return reply(200, { name, email: m.email, admin: m.admin, manager: sc.admin || sc.countries.length > 0, language, events: upcoming.map((e) => ({ ...eventView(e), role: roleOf(mine.get(e.id)), canBook: canBookRow(mine.get(e.id)) })), learn: !!learnOn });
  }

  async function myEvents(h) {
    const { m, error } = await member(h); if (error) return error;
    const mine = (await all()).filter((r) => r.email === m.email);
    const up = new Map((await events.upcoming()).map((e) => [e.id, e]));
    const upcoming = [], past = [];
    for (const r of mine) {
      const ev = up.get(r.eventId) || await events.get(r.eventId); if (!ev) continue;
      (up.has(r.eventId) ? upcoming : past).push({ ...eventView(ev), role: roleOf(r), canBook: canBookRow(r) });
    }
    upcoming.sort((a, b) => a.startDate.localeCompare(b.startDate)); past.sort((a, b) => b.startDate.localeCompare(a.startDate));
    return reply(200, { upcoming, past: past.slice(0, 50) });
  }

  async function findEvent(id) {
    id = String(id || '').replace(/^e/, '');
    const raw = /^\d{1,12}$/.test(id) && await events.get(id);
    if (!raw) return null;
    const ev = (await events.upcoming()).find((e) => e.id === id);
    return { id, ev: ev || null, view: { ...(ev ? eventView(ev) : eventView({ ...raw, windows: [] })), windows: ev?.windows || [], over: !ev } };
  }

  async function eventPage(method, id, action, h, body) {
    const { m, error } = await member(h); if (error) return error;
    const found = await findEvent(id); if (!found) return reply(404, { error: "That event isn't on Spartan's list" });
    const sc = await scope(h, m), canManage = manages(sc, found.view);
    if (action === 'referees') return method === 'POST' ? (canManage ? setReferees(found, body, h) : reply(403, { error: 'Only admins and the region\'s coordinators manage an event' })) : reply(405, { error: 'Not allowed' });
    if (action === 'notes') return method === 'PUT' ? (canManage ? setNotes(found, body, h) : reply(403, { error: 'Only admins and the region\'s coordinators manage an event' })) : reply(405, { error: 'Not allowed' });
    if (action || method !== 'GET') return reply(405, { error: 'Not allowed' });
    const rows = (await all()).filter((r) => r.eventId === found.id).sort(byRole);
    const names = new Map(await Promise.all(rows.map(async (r) => [r.email, await nameOf(r.email)])));
    const you = rows.find((r) => r.email === m.email);
    const note = await store.get('eventnote', found.id);
    return reply(200, {
      event: found.view,
      you: you ? { role: roleOf(you), canBook: canBookRow(you) } : null,
      // names for everyone; addresses only for those who manage it
      referees: rows.map((r) => ({ ...(canManage ? { email: r.email } : {}), name: names.get(r.email) || (canManage ? '' : r.email.split('@')[0]), role: roleOf(r), canBook: canBookRow(r), you: r.email === m.email })),
      notes: note ? { text: note.text, by: note.byName || '', at: note.at } : null,
      booking: await bookingStatus(`e${found.id}`),
      // its burpee cameras: booked by those ticked for it (and admins); everyone assigned watches and reviews them
      canBook: m.admin || (!!you && canBookRow(you)),
      canManage,
      hasHead: rows.some((r) => roleOf(r) === 'head'),
    });
  }

  /** add one or many (pasted addresses), change someone's role or camera tick, or take them off */
  async function setReferees(found, b, h) {
    const by = String(session(h)?.email || '').toLowerCase();
    if (b?.role !== undefined && !ROLES.includes(b.role)) return reply(400, { error: 'Choose head referee or referee' });
    const list = (b?.emails !== undefined ? String(Array.isArray(b.emails) ? b.emails.join('\n') : b.emails) : String(b?.email || '')).split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (!list.length) return reply(400, { error: 'Give at least one email address' });
    if (b?.remove === true) {
      for (const email of list) await store.remove(T, `${found.id}|${email}`);
      return reply(200, { ok: true });
    }
    const added = [], skipped = [];
    let count = (await all()).filter((r) => r.eventId === found.id).length;
    for (const email of [...new Set(list)]) {
      if (email.length > 200 || !EMAIL.test(email)) { skipped.push({ email, why: 'not an email address' }); continue; }
      const key = `${found.id}|${email}`, was = await store.get(T, key);
      if (was) {
        await store.put(T, key, { ...was, ...(b?.role ? { role: b.role } : {}), ...(b?.canBook !== undefined ? { canBook: !!b.canBook } : {}), by, at: now() });
        added.push(email); continue;
      }
      // only someone who can sign in: a referee on the list, or an admin
      if (!(await store.get('people:spartan', email)) && !isAdminEmail(email)) { skipped.push({ email, why: 'not registered: invite them first' }); continue; }
      if (count >= MAX_PER_EVENT) { skipped.push({ email, why: `an event can have up to ${MAX_PER_EVENT} referees` }); continue; }
      const role = b?.role || 'referee';
      await store.put(T, key, { id: key, eventId: found.id, email, role, canBook: b?.canBook !== undefined ? !!b.canBook : role === 'head', by, at: now() });
      added.push(email); count++;
    }
    return reply(200, { added, skipped });
  }
  async function setNotes(found, b, h) {
    const text = String(b?.text || '').replace(/\r/g, '').trim().slice(0, 4000);
    const by = String(session(h)?.email || '').toLowerCase();
    if (!text) await store.remove('eventnote', found.id);
    else await store.put('eventnote', found.id, { id: found.id, text, by, byName: await nameOf(by), at: now() });
    return reply(200, { ok: true });
  }

  /** the events someone manages, with how many referees each has: for the Events tab's organiser view */
  async function manageList(h, query) {
    const { m, error } = await member(h); if (error) return error;
    const sc = await scope(h, m);
    if (!sc.admin && !sc.countries.length) return reply(403, { error: 'Only admins and regional coordinators manage events' });
    const rows = await all();
    const per = new Map();
    for (const r of rows) { const c = per.get(r.eventId) || { referees: 0, heads: 0, canBook: 0 }; c.referees++; if (roleOf(r) === 'head') c.heads++; if (canBookRow(r)) c.canBook++; per.set(r.eventId, c); }
    const q = String(query.q || '').trim().toLowerCase();
    const list = (await events.upcoming()).map(eventView).filter((e) => manages(sc, e))
      .filter((e) => !q || `${e.name} ${e.city} ${e.country}`.toLowerCase().includes(q))
      .map((e) => ({ ...e, ...(per.get(e.id) || { referees: 0, heads: 0, canBook: 0 }) }));
    return reply(200, { events: list, admin: sc.admin, countries: sc.countries });
  }

  // the admin page's list (customers.html): as before
  async function admin(method, body, h) {
    if (!isAdmin(h)) return reply(403, { error: 'Admins only' });
    if (method === 'GET') {
      const ids = new Set((await events.upcoming()).map((e) => e.id));
      return reply(200, { assignments: (await all()).filter((r) => ids.has(r.eventId)).sort(byRole).map((r) => ({ eventId: r.eventId, email: r.email, role: roleOf(r), canBook: canBookRow(r), by: r.by, at: r.at })) });
    }
    if (method !== 'POST') return reply(405, { error: 'Not allowed' });
    const found = await findEvent(body?.eventId);
    if (!found) return reply(/^\d{1,12}$/.test(String(body?.eventId || '').replace(/^e/, '')) ? 404 : 400, { error: /^\d{1,12}$/.test(String(body?.eventId || '').replace(/^e/, '')) ? "That event isn't on Spartan's list" : 'Choose an event' });
    const email = String(body?.email || '').trim().toLowerCase();
    if (email.length > 200 || !EMAIL.test(email)) return reply(400, { error: "That doesn't look like an email address" });
    if (body?.role !== undefined && !ROLES.includes(body.role)) return reply(400, { error: 'Choose head referee or referee' });
    const was = await store.get(T, `${found.id}|${email}`);
    if (body?.remove === true) { if (!was) return reply(404, { error: "That referee isn't assigned to that event" }); await store.remove(T, `${found.id}|${email}`); return reply(200, { ok: true }); }
    if (was && roleOf(was) === (body?.role || 'referee')) return reply(409, { error: `That referee is already assigned to that event as ${roleOf(was) === 'head' ? 'head referee' : 'referee'}` });
    // the admin page has no camera tick: a head referee made there may book, as before
    const r = await setReferees(found, { email, role: body?.role || 'referee', canBook: (body?.role || 'referee') === 'head' }, h);
    if (r.body.skipped?.length) return reply(400, { error: r.body.skipped[0].why.startsWith('not registered') ? `${email} isn't on the list of referees: add them first` : r.body.skipped[0].why });
    return reply(200, { ok: true });
  }
  return { home, myEvents, eventPage, manageList, admin };
}

module.exports = { LANGUAGES, createAssignments, canBookRow };
