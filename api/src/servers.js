'use strict';
/* Each approved company's Receiver servers, as the site sees them. A company books a number of cameras for a number of hours; each server
   takes two cameras, so that decides how many servers and what it costs. They run until the booked time, then shut down, unless it's extended.
   The site never touches Azure: it says what's wanted, and the control app (control/), which alone has rights over the servers, makes it
   so within a minute and says how it went. A company's second server is <id>~2, and so on.
     serverplan:<company>  the booking: cameras, servers, until (written here)
     server:<slot>         who it is and its secrets; made once, never sent to a browser
     serverwant:<slot>     what's wanted, and what the server last reported (written here)
     serverstate:<slot>    what it's actually doing, and hours used (written by the control app)

   GET  /api/servers/mine                         -> { server } the booking and each server, for the company's owner
   GET  /api/servers/mine/history                 -> { bookings } newest first, the latest 50
   POST /api/servers/mine/payment                 -> { url } Stripe's page for saving a card
   POST /api/servers/mine/payment-done {session}  -> { server } asks Stripe whether that card was saved
   POST /api/servers/mine/checkout {cameras, hours | from, until}  -> { checkout } what it comes to, for the payment page (customers)
   POST /api/servers/mine/pay {checkout}          -> { server } the pretend payment: makes the booking it was for
   POST /api/servers/mine/start {cameras, hours | from, until}  -> { server } admins book straight away; customers pay first
   POST /api/servers/mine/extend {hours}          -> { server }
   POST /api/servers/mine/stop                    -> { server }
   POST /api/servers/mine/open {n, tab}           -> { url } a short-lived sign-in link to that server's own page, on that tab
   POST /api/servers/report                       (a server, with its key) -> { stop, until }

   Admins:
   GET  /api/admin/pricing                        -> what Azure charges, the percentage on top, and what customers pay
   PUT  /api/admin/pricing {markupPercent}        the default
   PUT  /api/admin/customers/<id>/price {cameraHour}   one customer's own price (empty: back to the default)
   GET  /api/admin/customers                      -> every company, its booking, and this month's use, cost and charge
   POST /api/admin/customers/<id>/stop            stop a company's servers

   Customers pay per camera, per hour the servers actually run: Azure's price for a server, shared between its 2 cameras, plus the percentage,
   or a price set for that customer. Once card payments are on, their first booking asks for a card, saved on Stripe's page (payments.js);
   admins don't need one. Every customer booking goes through the payment page first: for now a pretend one, where nothing is charged.
   Until card payments are on, though, only admins can start servers at all.
   A booking starts now or at a time chosen ahead (from): its servers are turned on START_LEAD before, so the cameras are ready on time,
   and those minutes aren't charged.
   A booking keeps the price it started at. The control app adds up the time, cost and charge, by the minute.

   SpartanReferee (with events): the organisation has many bookings at once, each with its own servers, as a "unit" standing in for
   the company above: one per Spartan event ("e<event id>"), one per referee for training ("t…") and one per admin for testing ("x…").
   Every /api/servers/mine call says which with ?unit= (GET) or {unit} (POST); without one it's the most relevant running booking.
     event     07:00 to 18:00 local time on the event's days (events.js), extended up to 18:00; an admin can book any time ({anyTime}).
               The burpee camera station is the event's head referee's to book, extend and stop (assignments.js), and admins';
               every referee can open its Live, Cameras and Results (from 19 November 2026).
     training  30 minutes, any time, everyone; no extending. Booked only from Learning's camera guide (from 19 November 2026):
               POST /api/learn/practice-camera (core.js) books it with fromLearn; /api/servers/mine/start refuses it. The console
               lists your training only while it's booked, so you can watch it there.
     testing   admins only, any time, as bookings always were
   Servers still belong to the organisation (server.company), for its brand and "Our settings"; their slots are the unit's.
   GET  /api/servers/units  -> { units, current } the events (with their bookings), your training, and (admins) your testing
     unit:<id>  { id, kind, name, eventId, owner, at }  every unit that's been booked, for the admin area */
const crypto = require('node:crypto');
const eventTimes = require('./events');
const { recordingsPartition, KEEP_DAYS } = require('./recordings');
const { createMembership, ourSettings } = require('./companies');
const { canBookRow } = require('./assignments');
const cameraSplit = require('./cameras');

const { CAMERAS_PER_SERVER } = cameraSplit;
const MAX_HOURS = 24, MAX_EXTEND_HOURS = 12, MAX_AHEAD_HOURS = 72, LOGIN_MINUTES = 5, MAX_DAYS_AHEAD = 90, CHECKOUT_MINUTES = 30;
// Until card payments are properly set up (STRIPE_SECRET_KEY), only admins can start servers: customers can't book or extend at all.
const BOOKINGS_CLOSED = 'Bookings open once card payments are set up. Get in touch with us if you need cameras before then.';
const OPEN_TABS = ['live', 'results', 'cameras']; // the video review's tabs the console can open it on
const START_LEAD_MS = 10 * 60e3; // the control app turns servers on this long before a booking starts (control/src/reconcile.js has it too)
const HOUR = 3600e3;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const random = (n) => crypto.randomBytes(n).toString('base64url');
const signFor = (secret, payload) => { const p = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${p}.${crypto.createHmac('sha256', secret).update(p).digest('base64url')}`; };
const monthOf = (t) => new Date(t).toISOString().slice(0, 7);
const slotId = (company, n) => (n === 1 ? company : `${company}~${n}`);
const serversFor = (cameras) => Math.ceil(cameras / CAMERAS_PER_SERVER);
const pounds = (v) => Math.round(v * 100) / 100;

const pence = (v) => Math.ceil(Math.round(v * 1e6) / 1e4) / 100;
const MAX_MARKUP = 1000, MAX_CAMERA_HOUR = 100, BOOKINGS_SHOWN = 50, MAX_SETTINGS = 30000;

// Keeping what a camera records. A camera at the recommended 720p sends about 3.6 Mbps with its sound, so 1.63 GB an hour. Hot
// storage in UK South is £0.0144 per GB per month (Azure's price list, November 2026), and is the cheapest tier for 7 days, as
// Cool and Cold charge for at least 30 and 90. Uploading is free. Downloading isn't counted here: the first 100 GB a month is free.
const GB_PER_CAMERA_HOUR = 1.63, STORAGE_GB_MONTH = 0.0144;
const storageCameraHour = GB_PER_CAMERA_HOUR * STORAGE_GB_MONTH * (KEEP_DAYS / 30);

const cardView = (p) => (p ? { brand: p.brand, last4: p.last4, expMonth: p.expMonth, expYear: p.expYear } : null);

const TRAINING_HOURS = 0.5, MAX_EVENT_DAYS_AHEAD = 400;
function createServers({ store, now, reply, session, isAdmin = () => false, membership = null, payments = null, freeBooking = false, events = null, maxRunning = 1, hourPrice = 0.66, region = 'italynorth' }) {
  // freeBooking (SpartanReferee): nobody pays, so everyone books and starts servers as admins do, with no card or payment page
  const payFree = (h) => freeBooking || isAdmin(h);
  // The default is Azure's cost plus a percentage. A customer can instead have a price of their own, set in the admin area.
  async function pricing(c) {
    const markupPercent = (await store.get('settings', 'pricing'))?.markupPercent || 0;
    const azureCameraHour = hourPrice / CAMERAS_PER_SERVER + storageCameraHour; // the server, shared, and keeping the recording
    const standard = pence(azureCameraHour * (1 + markupPercent / 100)), custom = Number.isFinite(c?.cameraHour);
    return { markupPercent, azureServerHour: hourPrice, storageCameraHour, keepDays: KEEP_DAYS, azureCameraHour, camerasPerServer: CAMERAS_PER_SERVER, standardCameraHour: standard, cameraHour: custom ? c.cameraHour : standard, customPrice: custom };
  }
  /** what a company has run up this month, across all its servers */
  async function usage(company) {
    const k = monthOf(now()), out = { serverHours: 0, cameraHours: 0, charge: 0, azure: 0 };
    for (const st of await store.list('serverstate')) {
      if (!ofCompany(st.id, company)) continue;
      out.serverHours += (st.minutes?.[k] || 0) / 60; out.cameraHours += (st.cameraMinutes?.[k] || 0) / 60;
      out.charge += st.charge?.[k] || 0; out.azure += st.azure?.[k] || 0;
    }
    return { serverHours: Math.round(out.serverHours * 10) / 10, cameraHours: Math.round(out.cameraHours * 10) / 10, charge: pounds(out.charge), azure: pounds(out.azure), profit: pounds(out.charge - out.azure) };
  }
  const { companyFor, provenEmail } = membership || createMembership(store); // owner, or one of its people
  /** may this person book a practice server? Admins, and anyone who may book an event's cameras */
  async function rehearses(me, h) {
    if (isAdmin(h)) return true;
    const email = me && provenEmail ? await provenEmail(me) : '';
    return !!email && (await store.list('assignment')).some((a) => a.email === email && canBookRow(a));
  }
  /** may this person book, extend and stop this unit? An event's: whoever its organisers ticked for it (assignments.js), or an admin. Your own training: you. Testing: admins */
  async function manages(me, h, u) {
    if (isAdmin(h)) return true;
    if (u.kind !== 'event') return u.kind === 'training';
    const email = me && provenEmail ? await provenEmail(me) : '', eventId = u.event?.id || String(u.id).slice(1);
    const a = email && await store.get('assignment', `${eventId}|${email}`);
    return !!a && canBookRow(a);
  }
  async function companyOf(h) {
    const me = session(h); if (!me) return { error: reply(401, { error: 'Sign in first' }) };
    const m = await companyFor(me);
    if (!m) return { error: reply(404, { error: 'This account has no company yet' }) };
    return { me, c: m.c, role: m.role };
  }
  const active = (plan) => !!plan && plan.until > now();
  // the whole booking and each server in it, in one view
  async function view(c, h) {
    const plan = await store.get('serverplan', c.id), count = plan?.servers || 1, slots = [];
    for (let n = 1; n <= count; n++) {
      const id = slotId(c.id, n), want = await store.get('serverwant', id), st = await store.get('serverstate', id);
      slots.push({ n, state: st?.state || 'off', wanted: want?.desired === 'on' && active(plan) ? 'on' : 'off', error: st?.error || '', cameras: want?.cameras || 0, judges: want?.judges || 0 });
    }
    const wanted = slots.some((s) => s.wanted === 'on') ? 'on' : 'off';
    const price = await pricing(c), u = await usage(c.id);
    const scheduled = wanted === 'on' && !!plan?.from && now() < plan.from - START_LEAD_MS;
    const state = slots.some((s) => s.state === 'stopping') ? 'stopping' : slots.some((s) => s.state === 'starting') ? 'starting' : slots.every((s) => s.state === 'on') ? 'on' : slots.some((s) => s.state === 'on') ? 'starting' : 'off';
    // which unit this is (SpartanReferee): its kind, its event and that event's days, and what the booking was made as
    const canManage = c.kind && h ? await manages(session(h), h, c) : !c.kind; // (the admin area asks with no one in particular)
    const unit = c.kind ? { id: c.id, kind: c.kind, name: c.name, canManage, event: c.event ? { id: c.event.id, name: c.event.name, city: c.event.city, country: c.event.country, tz: c.event.tz, startDate: c.event.startDate, endDate: c.event.endDate, windows: eventTimes.windows(c.event) } : null,
      canAnyTime: !!h && isAdmin(h), canExtend: c.kind !== 'training', bookedAnyTime: !!plan?.anyTime, bookedBy: wanted === 'on' ? plan?.by || plan?.requestedBy || '' : '' } : undefined;
    return {
      unit, state, wanted, servers: slots, error: slots.map((s) => s.error).find(Boolean) || '',
      cameras: plan?.cameras || 0, serverCount: count, until: wanted === 'on' ? plan.until : 0, from: wanted === 'on' ? plan.from || 0 : 0, scheduled, bookedHours: plan?.hours || 0,
      bookedCost: plan ? pounds(plan.hours * plan.cameras * plan.cameraHour) : 0, bookedCameraHour: plan?.cameraHour || 0,
      used: { cameraHours: u.cameraHours, charge: u.charge }, canStart: c.status === 'approved',
      // once card payments are on, the first booking asks for a card; admins don't need one. Customers pay for each booking first.
      card: cardView(c.payment), cardsOn: !!payments, adminNoCard: !freeBooking && !c.payment && !!h && isAdmin(h), needsCard: !!payments && !c.payment && !(h && payFree(h)),
      paysFirst: !(h && payFree(h)),
      // until card payments are properly set up, only admins can start servers
      bookingsOpen: !!payments || !!(h && payFree(h)),
      price: { cameraHour: price.cameraHour, keepDays: KEEP_DAYS, camerasPerServer: CAMERAS_PER_SERVER, maxHours: MAX_HOURS, maxExtendHours: MAX_EXTEND_HOURS, maxCameras: maxRunning * CAMERAS_PER_SERVER, maxDaysAhead: MAX_DAYS_AHEAD, startLeadMinutes: START_LEAD_MS / 60e3 },
    };
  }
  async function ensureServer(c, n) {
    const id = slotId(c.id, n);
    let s = await store.get('server', id);
    if (s) return s;
    // the name its address is built on; the hash keeps it unguessable from the company's name
    const label = `sr-${c.id.slice(0, 18).replace(/-+$/, '')}${n > 1 ? `-${n}` : ''}-${sha(id + random(8)).slice(0, 6)}`;
    // a unit's servers belong to its organisation (its brand, "Our settings")
    s = { id, company: c.org || c.id, n, vm: label, label, host: `${label}.${region}.cloudapp.azure.com`, secret: random(32), password: random(9).replace(/[-_]/g, 'x'), serverKey: `sk_${random(32)}`, receiverKey: `rk_${random(24)}` };
    await store.put('server', id, s);
    await store.put('serverkey', sha(s.serverKey), { id });
    // its finished recordings go to the company owner's cloud recordings
    await store.put('reckey', sha(s.receiverKey), { id: `srv-${id.replace('~', '-')}`, name: n > 1 ? `Cloud Receiver ${n}` : 'Cloud Receiver', partition: recordingsPartition(c.owner) });
    return s;
  }
  // A company's past bookings. What a booking comes to is worked out from its times, as an estimate: what's charged is counted by the minute.
  async function changeBooking(company, plan, change) {
    if (!plan?.bookingKey) return;
    const row = await store.get(`booking:${company}`, plan.bookingKey);
    if (row) await store.put(`booking:${company}`, plan.bookingKey, { ...row, ...change });
  }
  async function history(company) {
    const rows = (await store.list(`booking:${company}`)).sort((a, b) => b.at - a.at).slice(0, BOOKINGS_SHOWN);
    return rows.map((b) => {
      const from = b.from || b.at, ended = b.endedAt || Math.min(b.until, now()), hoursRun = Math.max(0, Math.min(b.hours, (ended - from) / HOUR));
      const state = !b.endedAt && from > now() ? 'booked' : !b.endedAt && b.until > now() ? 'running' : b.endedAt && b.endedAt <= from ? 'cancelled' : b.endedAt && b.endedAt < b.until ? 'stopped' : 'finished';
      return { at: b.at, from, cameras: b.cameras, hours: b.hours, until: b.until, endedAt: b.endedAt || 0, state, hoursRun: Math.round(hoursRun * 100) / 100, cameraHour: b.cameraHour, cost: pounds((state === 'booked' ? b.hours : hoursRun) * b.cameras * b.cameraHour), paid: b.paid || null, kind: b.kind || '', name: b.name || '', by: b.by || '' }; // booked ahead: what it will come to
    });
  }
  const ofCompany = (slot, company) => slot === company || slot.startsWith(`${company}~`);
  // how many other companies' servers are booked over these times, or (for a booking starting soon) are still on (limited by the
  // subscription's graphics-card allowance)
  async function othersRunning(company, from = now(), until = now() + HOUR) {
    const busy = new Set();
    for (const w of await store.list('serverwant')) if (!ofCompany(w.id, company) && w.desired === 'on' && !(w.until && w.until <= from) && (w.from || 0) - START_LEAD_MS < until) busy.add(w.id);
    if (from - START_LEAD_MS < now() + HOUR) for (const st of await store.list('serverstate')) if (!ofCompany(st.id, company) && st.state && st.state !== 'off') busy.add(st.id);
    return busy.size;
  }
  // what a booking asks for, checked: now for some hours, or from a start time to an end time
  function asked(body) {
    const cameras = Number(body?.cameras);
    if (!Number.isInteger(cameras) || cameras < 1 || cameras > 40) return { error: 'How many cameras do you need?' };
    if (body?.from === undefined && body?.until === undefined) {
      const hours = Number(body?.hours);
      if (!Number.isInteger(hours) || hours < 1 || hours > MAX_HOURS) return { error: `Book between 1 and ${MAX_HOURS} hours: you can extend it later` };
      return { cameras, hours, startNow: true };
    }
    const from = Number(body?.from), until = Number(body?.until);
    if (!Number.isFinite(from) || !Number.isFinite(until)) return { error: 'Choose a start and an end time' };
    if (from < now() - 5 * 60e3) return { error: 'That start time has passed: choose a later one, or start now' };
    if (from > now() + MAX_DAYS_AHEAD * 24 * HOUR) return { error: `You can book up to ${MAX_DAYS_AHEAD} days ahead` };
    const hours = Math.round(((until - from) / HOUR) * 100) / 100;
    if (!(hours >= 1 && hours <= MAX_HOURS)) return { error: `A booking runs between 1 and ${MAX_HOURS} hours: you can extend it later` };
    return { cameras, hours, from, until };
  }
  // what a unit's booking asks for, by its kind (training, testing, an event: see the top)
  function askedFor(u, body, h) {
    if (!u.kind) return asked(body);
    const cameras = Number(body?.cameras);
    if (!Number.isInteger(cameras) || cameras < 1 || cameras > 40) return { error: 'How many cameras do you need?' };
    const startNow = body?.from === undefined && body?.until === undefined, from = Number(body?.from);
    if (!startNow && !Number.isFinite(from)) return { error: 'Choose a start time' };
    if (!startNow && from < now() - 5 * 60e3) return { error: 'That start time has passed: choose a later one, or start now' };
    if (u.kind === 'training') {
      if (!startNow && from > now() + MAX_DAYS_AHEAD * 24 * HOUR) return { error: `You can book up to ${MAX_DAYS_AHEAD} days ahead` };
      return startNow ? { cameras, hours: TRAINING_HOURS, startNow: true, kind: 'training' } : { cameras, hours: TRAINING_HOURS, from, until: from + TRAINING_HOURS * HOUR, kind: 'training' };
    }
    if (u.kind === 'testing') return { ...asked(body), kind: 'testing' };
    // an event: its days, 07:00 to 18:00 local, unless an admin says any time
    const meta = { kind: 'event', eventId: u.event?.id || u.id.slice(1), eventName: u.name };
    if (body?.anyTime === true) {
      if (!isAdmin(h)) return { error: 'Only admins can book an event at any time' };
      const a = asked(startNow ? body : { ...body, from: Math.min(from, now() + MAX_DAYS_AHEAD * 24 * HOUR) });
      return a.error ? a : { ...a, ...(startNow ? {} : { from, until: Number(body.until) }), ...meta, anyTime: true };
    }
    if (!u.event) return { error: 'That event isn\'t on Spartan\'s list any more' };
    if (startNow) {
      const hours = Number(body?.hours), w = eventTimes.windowAt(u.event, now());
      if (!Number.isInteger(hours) || hours < 1 || hours > MAX_HOURS) return { error: `Book between 1 and ${MAX_HOURS} hours` };
      if (!w) return { error: 'Cameras for an event run from 07:00 to 18:00 local time on its days: book ahead for then' }; // EVENT_DAY in events.js
      const until = Math.min(now() + hours * HOUR, w.until);
      if (until - now() < 15 * 60e3) return { error: "Today\'s cameras for this event stop in under 15 minutes" };
      return { cameras, hours: Math.round(((until - now()) / HOUR) * 100) / 100, startNow: true, until, ...meta };
    }
    const until = Number(body?.until);
    if (!Number.isFinite(until) || until <= from) return { error: 'Choose a start and an end time' };
    if (from > now() + MAX_EVENT_DAYS_AHEAD * 24 * HOUR) return { error: `You can book up to ${MAX_EVENT_DAYS_AHEAD} days ahead` };
    if (!eventTimes.windowFor(u.event, from, until)) return { error: "Choose times from 07:00 to 18:00 local time on one of the event's days" };
    const hours = Math.round(((until - from) / HOUR) * 100) / 100;
    if (hours < 0.5) return { error: 'Book at least 30 minutes' };
    return { cameras, hours, from, until, ...meta };
  }
  // its times, as of now: a booking to start now starts when it's made (and an event's stops at the end of its day)
  const timesOf = (a) => (a.startNow ? { from: now(), until: a.until || now() + a.hours * HOUR } : { from: Math.max(a.from, now()), until: a.until });
  // why this booking can't be made now, if it can't
  async function cantBook(c, h, a) {
    if (c.status !== 'approved') return reply(403, { error: c.status === 'pending' ? 'We\'re still checking your application' : 'This company has been blocked from starting servers' });
    if (!payments && !payFree(h)) return reply(503, { error: BOOKINGS_CLOSED });
    if (payments && !c.payment && !payFree(h)) return reply(402, { error: 'Add your payment details first' });
    const plan = await store.get('serverplan', c.id);
    if (active(plan) && (await view(c, h)).wanted === 'on') return reply(409, { error: plan.from && plan.from > now() ? 'You already have a booking: cancel it first, or extend it' : 'Your servers are already booked: extend them instead' });
    const needed = serversFor(a.cameras), { from, until } = timesOf(a);
    if (await othersRunning(c.id, from, until) + needed > maxRunning) return reply(409, { error: needed > maxRunning ? `We can run ${maxRunning} server${maxRunning === 1 ? '' : 's'} at once at the moment, which is ${maxRunning * CAMERAS_PER_SERVER} cameras` : from > now() + HOUR ? 'All our servers are booked at that time: try other times' : 'All our servers are in use right now: try again a little later' });
    return null;
  }
  // makes the booking: its servers are turned on when it starts, by the control app
  async function book(c, me, h, a, { cameraHour, paid = null } = {}) {
    const no = await cantBook(c, h, a); if (no) return no;
    const { cameras, hours } = a, { from, until } = timesOf(a), needed = serversFor(cameras);
    for (let n = 1; n <= needed; n++) await ensureServer(c, n);
    const price = await pricing(c), { azureServerHour } = price;
    cameraHour = cameraHour ?? price.cameraHour;
    const bookedAt = now(), bookingKey = String(bookedAt).padStart(15, '0');
    // what it's for (a unit's kind, its event), so the page and the admin area can say
    const what = a.kind ? { kind: a.kind, eventId: a.eventId || '', name: c.name || '', anyTime: !!a.anyTime, by: me.email || '' } : {};
    await store.put('serverplan', c.id, { id: c.id, cameras, servers: needed, hours, from, until, cameraHour, requestedAt: bookedAt, requestedBy: me.email || '', bookingKey, paid, ...what });
    await store.put(`booking:${c.id}`, bookingKey, { key: bookingKey, at: bookedAt, from, cameras, hours, until, cameraHour, paid, ...what });
    if (a.kind) await store.put('unit', c.id, { id: c.id, kind: a.kind, name: c.name || '', eventId: a.eventId || '', owner: a.kind === 'event' ? '' : me.uid, at: bookedAt });
    await forEachWant(c.id, needed, { desired: 'on', requestedAt: now(), requestedBy: me.email || '', finished: false, saved: false, stopRequestedAt: 0, from, until, lastReport: 0, cameraHour, azureHour: azureServerHour });
    // each server's own share of the cameras, as that's what its time is charged at
    // and what its time costs us: the server, and keeping what its cameras record
    for (let n = 1, left = cameras; n <= needed; n++, left -= CAMERAS_PER_SERVER) { const on = Math.min(left, CAMERAS_PER_SERVER); await forEachWant(c.id, n, { azureHour: azureServerHour + on * storageCameraHour }, n, on); }
    return reply(200, { server: await view(c, h) });
  }
  const checkoutView = (co) => ({ id: co.id, cameras: co.cameras, hours: co.hours, startNow: !!co.startNow, from: co.from || 0, until: co.until || 0, cameraHour: co.cameraHour, cost: co.cost, servers: serversFor(co.cameras), expires: co.exp, pretend: true });
  async function forEachWant(company, count, change, only = 0, bookedCameras = undefined) {
    for (let n = only || 1; n <= (only || count); n++) {
      const id = slotId(company, n), was = await store.get('serverwant', id);
      await store.put('serverwant', id, { id, company, ...was, ...change, ...(bookedCameras === undefined ? {} : { bookedCameras }) });
    }
  }
  // how many of the booking's cameras this server has, and the number its first one goes by, so a booking's cameras are numbered 1, 2, 3…
  // across its servers
  async function bookedOn(slot) {
    const [server, want] = await Promise.all([store.get('server', slot), store.get('serverwant', slot)]);
    return cameraSplit.bookedOn(server?.n, want?.bookedCameras);
  }
  // ---------------------------------------------------------------- units (SpartanReferee): which booking a request is about
  const trainingId = (uid) => `t${sha(String(uid)).slice(0, 10)}`, testingId = (uid) => `x${sha(String(uid)).slice(0, 10)}`;
  /** the unit standing in for the company: { u } or { error } (an empty id: the most relevant booking that's on, else your training) */
  async function unitOf(me, c, h, id) {
    id = String(id || '');
    if (!id) id = await currentUnit(me, h);
    const base = { ...c, org: c.id };
    if (/^e\d{1,12}$/.test(id)) {
      const ev = events && await events.get(id.slice(1)), plan = !ev && await store.get('serverplan', id);
      if (!ev && !plan) return { error: reply(404, { error: 'That event isn\'t on Spartan\'s list' }) };
      return { u: { ...base, id, kind: 'event', name: ev?.name || plan?.name || 'Event', event: ev } };
    }
    if (id === trainingId(me.uid)) return { u: { ...base, id, kind: 'training', name: 'Training' } };
    if (id === testingId(me.uid)) {
      if (!isAdmin(h)) return { error: reply(403, { error: 'Testing is for admins' }) };
      return { u: { ...base, id, kind: 'testing', name: 'Testing' } };
    }
    return { error: reply(403, { error: "That booking isn\'t one you can use" }) };
  }
  // what's mine to see: every event's, and my own training and testing
  const mineToSee = (row, me) => row.kind === 'event' || row.owner === me.uid;
  async function currentUnit(me, h) {
    const plans = new Map((await store.list('serverplan')).map((p) => [p.id, p]));
    const rows = (await store.list('unit')).filter((r) => mineToSee(r, me) && active(plans.get(r.id)) && (r.kind !== 'testing' || isAdmin(h)));
    rows.sort((x, y) => (plans.get(x.id).from || 0) - (plans.get(y.id).from || 0));
    return rows[0]?.id || trainingId(me.uid);
  }
  /** GET /api/servers/units: the events (each with whether it's booked), your training and (admins) your testing */
  async function unitsList(me, h) {
    const plans = new Map((await store.list('serverplan')).map((p) => [p.id, p]));
    const booking = (id) => { const p = plans.get(id); return active(p) ? { from: p.from || 0, until: p.until, cameras: p.cameras, by: p.by || p.requestedBy || '' } : null; };
    if (events) await events.fresh(); // synced from Spartan when the copy here is old
    const evs = events ? await events.upcoming() : [];
    const heads = new Set();
    if (!isAdmin(h)) { const email = provenEmail ? await provenEmail(me) : ''; for (const a of await store.list('assignment')) if (a.email === email && canBookRow(a)) heads.add(a.eventId); }
    const units = evs.map((e) => ({ id: `e${e.id}`, kind: 'event', canManage: isAdmin(h) || heads.has(e.id), name: e.name, city: e.city, country: e.country, tz: e.tz, startDate: e.startDate, endDate: e.endDate, windows: e.windows, booking: booking(`e${e.id}`) }));
    if (booking(trainingId(me.uid))) units.push({ id: trainingId(me.uid), kind: 'training', name: 'Training', booking: booking(trainingId(me.uid)) });
    if (isAdmin(h)) units.push({ id: testingId(me.uid), kind: 'testing', name: 'Testing', booking: booking(testingId(me.uid)) });
    const current = await currentUnit(me, h);
    return { units, current: units.some((u) => u.id === current) ? current : (units[0]?.id || current) };
  }
  /** an event's (or any unit's) booking as the event page shows it, or null: { state: booked|starting|on|stopping, from, until, cameras, by } */
  async function bookingStatus(id) {
    const p = await store.get('serverplan', id); if (!active(p)) return null;
    const [want, st] = await Promise.all([store.get('serverwant', slotId(id, 1)), store.get('serverstate', slotId(id, 1))]);
    const state = want?.desired !== 'on' ? 'stopping' : (p.from || 0) - START_LEAD_MS > now() ? 'booked' : st?.state === 'on' ? 'on' : 'starting';
    return { state, from: p.from || 0, until: p.until, cameras: p.cameras, by: p.by || p.requestedBy || '' };
  }
  async function stopCompany(id) {
    // the organisation blocked: every one of its units stops
    if (events && !/^[etx][\w]+$/.test(id) && !id.includes('~')) { for (const u of await store.list('unit')) await stopCompany(u.id); }
    const plan = await store.get('serverplan', id);
    if (plan) await forEachWant(id, plan.servers, { desired: 'off', stopRequestedAt: now() });
    if (active(plan)) await changeBooking(id, plan, { endedAt: now() });
  }

  async function adminPricing(method, body) {
    if (method === 'PUT') {
      const raw = body?.markupPercent, m = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
      if (!Number.isFinite(m) || m < 0 || m > MAX_MARKUP) return reply(400, { error: `The percentage needs to be between 0 and ${MAX_MARKUP}` });
      await store.put('settings', 'pricing', { markupPercent: Math.round(m * 100) / 100, at: now() });
    } else if (method !== 'GET') return null;
    return reply(200, await pricing());
  }
  async function adminCustomers(method, id, action, body) {
    if (!id && method === 'GET') {
      const out = [], totals = { charge: 0, azure: 0, profit: 0, cameraHours: 0 };
      // SpartanReferee: each unit (event, training, testing) that's been booked, as the organisation
      const org = events ? (await store.list('company'))[0] : null;
      const list = events ? (org ? (await store.list('unit')).map((x) => ({ ...org, org: org.id, id: x.id, kind: x.kind, name: x.name, eventId: x.eventId })) : []) : await store.list('company');
      for (const c of list.sort((x, y) => (y.at || 0) - (x.at || 0))) {
        const v = await view(c), u = await usage(c.id);
        out.push({ id: c.id, name: c.name, status: c.status, note: c.note || '', contact: c.contact, email: c.email, website: c.website, about: c.about, logo: c.logo || '', theme: c.theme, at: c.at, card: cardView(c.payment), price: await pricing(c),
          kind: c.kind || '', eventId: c.eventId || '', bookedBy: v.unit?.bookedBy || '',
          server: { state: v.state, wanted: v.wanted, scheduled: v.scheduled, from: v.from, until: v.until, cameras: v.cameras, serverCount: v.serverCount, camerasLive: v.servers.reduce((n, s) => n + s.cameras, 0), bookedCameraHour: v.bookedCameraHour, error: v.error }, usage: u });
        for (const k of Object.keys(totals)) totals[k] += u[k];
      }
      for (const k of Object.keys(totals)) totals[k] = Math.round(totals[k] * 100) / 100;
      return reply(200, { customers: out, totals, month: monthOf(now()), running: out.filter((c) => c.server.wanted === 'on' && !c.server.scheduled).reduce((n, c) => n + (events ? c.server.serverCount : 1), 0), maxRunning, pricing: await pricing() });
    }
    if (id && action === 'price' && method === 'PUT') {
      const c = await store.get('company', id); if (!c) return reply(404, { error: 'No such company' });
      const raw = body?.cameraHour;
      if (raw === null || raw === undefined || raw === '') delete c.cameraHour; // back to the default
      else {
        const v = Number(raw);
        if (!Number.isFinite(v) || v < 0 || v > MAX_CAMERA_HOUR) return reply(400, { error: `The price needs to be between £0 and £${MAX_CAMERA_HOUR} per camera hour` });
        c.cameraHour = Math.round(v * 100) / 100;
      }
      await store.put('company', id, c);
      return reply(200, await pricing(c));
    }
    if (id && action === 'stop' && method === 'POST') {
      if (!(await store.get('company', id)) && !(await store.get('unit', id))) return reply(404, { error: 'No such booking' });
      await stopCompany(id);
      return reply(200, { stopped: true });
    }
    return null;
  }

  async function servers(method, a, b, body, h, query = {}, { fromLearn = false } = {}) {
    // a server's settings, kept here as the server itself is deleted when it's shut down
    if (a === 'settings' && (method === 'GET' || method === 'POST')) {
      const k = await store.get('serverkey', sha(h['x-server-key'] || ''));
      if (!k) return reply(401, { error: "That key isn\'t recognised" });
      if (method === 'GET') return reply(200, { settings: (await store.get('servercfg', k.id))?.settings || null, booked: await bookedOn(k.id) });
      const settings = body?.settings;
      if (!settings || typeof settings !== 'object' || JSON.stringify(settings).length > MAX_SETTINGS) return reply(400, { error: "Those settings won\'t fit" });
      await store.put('servercfg', k.id, { id: k.id, settings, at: now() });
      return reply(200, { ok: true });
    }
    // the company's own settings ("Our settings"), from the judge on one of its servers
    if (a === 'our-settings' && (method === 'GET' || method === 'PUT')) {
      const k = await store.get('serverkey', sha(h['x-server-key'] || ''));
      const s = k && await store.get('server', k.id);
      if (!s) return reply(401, { error: "That key isn't recognised" });
      return ourSettings({ store, now, reply }, s.company, method, body, 'a camera on your server');
    }
    if (a === 'report' && method === 'POST') {
      const k = await store.get('serverkey', sha(h['x-server-key'] || ''));
      if (!k) return reply(401, { error: "That key isn\'t recognised" });
      const want = (await store.get('serverwant', k.id)) || { id: k.id, desired: 'off' };
      want.lastReport = now();
      want.cameras = Math.max(0, Math.min(99, +body?.cams || 0)); want.judges = Math.max(0, Math.min(99, +body?.judges || 0));
      // finished: nothing left to send, so it may now be turned off
      if (body?.what === 'finished') { want.finished = true; want.desired = 'off'; want.saved = body.saved === true; } // saved: all of it is in cloud storage
      await store.put('serverwant', k.id, want);
      return reply(200, { stop: want.desired === 'off' || (!!want.until && want.until <= now()), until: want.until || 0 });
    }
    if (a === 'units' && !b && method === 'GET') {
      const { me, error } = await companyOf(h); if (error) return error;
      return reply(200, await unitsList(me, h));
    }
    if (a !== 'mine') return null;
    const { me, c: org, role, error } = await companyOf(h); if (error) return error;
    // SpartanReferee: the unit (event, training, testing) stands in for the company from here on
    let c = org;
    if (events) { const U = await unitOf(me, org, h, method === 'GET' ? query.unit : body?.unit ?? query.unit); if (U.error) return U.error; c = U.u; }
    // the company's people see its servers and open them; only its owner books, pays and stops them
    if (!b && method === 'GET') {
      const v = await view(c, h);
      if (role !== 'owner') { delete v.card; v.needsCard = false; }
      return reply(200, { server: { ...v, role } });
    }
    if (b === 'history' && method === 'GET') return reply(200, { bookings: await history(c.id) });
    if (method !== 'POST') return null;
    if (role !== 'owner' && b !== 'open') return reply(403, { error: `Only ${c.name}'s owner can book or pay` });
    // Saving a card, on Stripe's own page. Coming back proves nothing by itself, so payment-done asks Stripe what happened.
    if (b === 'payment') {
      if (!payments) return reply(503, { error: "Card payments aren\'t switched on yet" });
      try {
        const email = me.email || (await store.get('user', me.uid))?.email || c.email || '';
        const { url, customerId } = await payments.startSetup({ companyId: c.id, companyName: c.name, email, customerId: c.stripeCustomer });
        if (customerId !== c.stripeCustomer) await store.put('company', c.id, { ...c, stripeCustomer: customerId });
        return reply(200, { url });
      } catch { return reply(502, { error: "We couldn\'t reach our card provider: please try again" }); }
    }
    if (b === 'payment-done') {
      if (!payments) return reply(503, { error: "Card payments aren\'t switched on yet" });
      const id = String(body?.session || '');
      if (!/^cs_[\w-]{1,200}$/.test(id)) return reply(400, { error: "That card wasn\'t saved: please try again" });
      let saved; try { saved = await payments.finishSetup(id, c.id); } catch { return reply(400, { error: "That card wasn\'t saved: please try again" }); }
      const { customerId, ...card } = saved, next = { ...c, stripeCustomer: customerId, payment: { ...card, at: now() } };
      await store.put('company', c.id, next);
      return reply(200, { server: await view(next, h) });
    }
    // Customers go through the payment page: checkout says what the booking comes to and holds it for a while, and paying for it makes it.
    // For now the payment is pretend: nothing is charged, and it's marked so on the booking.
    if (['checkout', 'pay', 'start', 'extend', 'stop'].includes(b) && c.kind === 'event' && !(await manages(me, h, c))) return reply(403, { error: 'The event\'s head referee books and runs its burpee cameras: you can watch them once they\'re on' });
    // SpartanReferee has no payment step: the pay-first route would skip an event's hours, so it's closed (everyone books with start)
    if (events && (b === 'checkout' || b === 'pay')) return reply(410, { error: 'There is no payment step: book with Start' });
    if ((b === 'checkout' || b === 'start') && c.kind === 'training' && !fromLearn) return reply(403, { error: 'Practice cameras are booked from the cameras guide in Learning' });
    // a practice server is for head referees (and admins), who rehearse the real station; everyone else uses the free camera, with no server
    if (b === 'start' && c.kind === 'training' && !(await rehearses(me, h))) return reply(403, { error: 'Practice servers are for head referees: try the free camera instead, which needs no server' });
    if (b === 'checkout') {
      const a = asked(body); if (a.error) return reply(400, { error: a.error });
      const no = await cantBook(c, h, a); if (no) return no;
      const { cameraHour } = await pricing(c);
      const co = { id: random(12), company: c.id, ...a, cameraHour, cost: pounds(a.cameras * a.hours * cameraHour), exp: now() + CHECKOUT_MINUTES * 60e3, by: me.uid };
      await store.put('checkout', c.id, co);
      return reply(200, { checkout: checkoutView(co) });
    }
    if (b === 'pay') {
      const co = await store.get('checkout', c.id);
      if (!co || co.id !== String(body?.checkout || '') || co.by !== me.uid) return reply(404, { error: "That payment isn\'t open any more: please book again" });
      if (co.exp < now()) { await store.remove('checkout', c.id); return reply(410, { error: `That payment ran out after ${CHECKOUT_MINUTES} minutes: please book again` }); }
      if (!co.startNow && co.until - Math.max(co.from, now()) < HOUR) return reply(410, { error: "That booking\'s start time has passed: please book again" });
      const r = await book(c, me, h, co, { cameraHour: co.cameraHour, paid: { pretend: true, amount: co.cost, at: now() } });
      if (r.status === 200) await store.remove('checkout', c.id);
      return r;
    }
    if (b === 'start') {
      if (!payFree(h)) return reply(402, { error: 'Pay for your booking first' });
      const a = askedFor(c, body, h); if (a.error) return reply(400, { error: a.error });
      return book(c, me, h, a);
    }
    if (b === 'extend') {
      if (!payments && !payFree(h)) return reply(503, { error: BOOKINGS_CLOSED });
      const hours = Number(body?.hours), plan = await store.get('serverplan', c.id);
      if (!active(plan) || (await view(c, h)).wanted !== 'on') return reply(409, { error: "Your servers aren\'t running: start them instead" });
      if (plan.kind === 'training') return reply(409, { error: "Training bookings can't be extended: book another" });
      if (!Number.isInteger(hours) || hours < 1 || hours > MAX_EXTEND_HOURS) return reply(400, { error: `Add between 1 and ${MAX_EXTEND_HOURS} hours at a time` });
      let until = plan.until + hours * HOUR;
      // an event's booking runs to the end of that day's cameras at most (07:00 to 18:00 local), unless an admin booked it for any time
      if (plan.kind === 'event' && !plan.anyTime && c.event) {
        const w = eventTimes.windowAt(c.event, plan.until - 1);
        if (!w || w.until <= plan.until) return reply(409, { error: 'Cameras for an event stop at 18:00 local time: book again for its next day' });
        until = Math.min(until, w.until);
      }
      if (until > Math.max(now(), plan.from || 0) + MAX_AHEAD_HOURS * HOUR) return reply(400, { error: `That's more than ${MAX_AHEAD_HOURS} hours ahead: extend it nearer the time` });
      const added = Math.round(((until - plan.until) / HOUR) * 100) / 100;
      await store.put('serverplan', c.id, { ...plan, hours: plan.hours + added, until });
      await changeBooking(c.id, plan, { hours: plan.hours + added, until });
      await forEachWant(c.id, plan.servers, { until });
      return reply(200, { server: await view(c, h) });
    }
    if (b === 'stop') {
      const plan = await store.get('serverplan', c.id);
      await forEachWant(c.id, plan?.servers || 1, { desired: 'off', stopRequestedAt: now() });
      if (active(plan)) await changeBooking(c.id, plan, { endedAt: now() });
      return reply(200, { server: await view(c, h) });
    }
    if (b === 'open') {
      const n = Math.max(1, Math.floor(Number(body?.n) || 1)), id = slotId(c.id, n);
      const st = await store.get('serverstate', id), s = await store.get('server', id);
      if (!s || st?.state !== 'on') return reply(409, { error: "That server isn\'t on yet" });
      const t = signFor(s.secret, { kind: 'login', who: me.email || me.uid, exp: now() + LOGIN_MINUTES * 60e3 });
      // which of the review's tabs to open on, and how many servers the booking has, so the review can switch to the others
      const tab = OPEN_TABS.includes(body?.tab) ? body.tab : 'live', of = (await store.get('serverplan', c.id))?.servers || 1;
      return reply(200, { url: `https://${s.host}/login?t=${encodeURIComponent(t)}&tab=${tab}&n=${n}&of=${of}` });
    }
    return null;
  }
  return { servers, adminPricing, adminCustomers, stopCompany, bookingStatus, trainingUnit: trainingId, rehearses };
}

module.exports = { createServers, signFor, serversFor };
