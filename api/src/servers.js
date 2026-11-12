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
   A booking keeps the price it started at. The control app adds up the time, cost and charge, by the minute. */
const crypto = require('node:crypto');
const { recordingsPartition, KEEP_DAYS } = require('./recordings');
const { createMembership } = require('./companies');
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

function createServers({ store, now, reply, session, isAdmin = () => false, membership = null, payments = null, maxRunning = 1, hourPrice = 0.66, region = 'italynorth' }) {
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
  const { companyFor } = membership || createMembership(store); // owner, or one of its people
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
    return {
      state, wanted, servers: slots, error: slots.map((s) => s.error).find(Boolean) || '',
      cameras: plan?.cameras || 0, serverCount: count, until: wanted === 'on' ? plan.until : 0, from: wanted === 'on' ? plan.from || 0 : 0, scheduled, bookedHours: plan?.hours || 0,
      bookedCost: plan ? pounds(plan.hours * plan.cameras * plan.cameraHour) : 0, bookedCameraHour: plan?.cameraHour || 0,
      used: { cameraHours: u.cameraHours, charge: u.charge }, canStart: c.status === 'approved',
      // once card payments are on, the first booking asks for a card; admins don't need one. Customers pay for each booking first.
      card: cardView(c.payment), cardsOn: !!payments, adminNoCard: !c.payment && !!h && isAdmin(h), needsCard: !!payments && !c.payment && !(h && isAdmin(h)),
      paysFirst: !(h && isAdmin(h)),
      // until card payments are properly set up, only admins can start servers
      bookingsOpen: !!payments || !!(h && isAdmin(h)),
      price: { cameraHour: price.cameraHour, keepDays: KEEP_DAYS, camerasPerServer: CAMERAS_PER_SERVER, maxHours: MAX_HOURS, maxExtendHours: MAX_EXTEND_HOURS, maxCameras: maxRunning * CAMERAS_PER_SERVER, maxDaysAhead: MAX_DAYS_AHEAD, startLeadMinutes: START_LEAD_MS / 60e3 },
    };
  }
  async function ensureServer(c, n) {
    const id = slotId(c.id, n);
    let s = await store.get('server', id);
    if (s) return s;
    // the name its address is built on; the hash keeps it unguessable from the company's name
    const label = `hj-${c.id.slice(0, 18).replace(/-+$/, '')}${n > 1 ? `-${n}` : ''}-${sha(id + random(8)).slice(0, 6)}`;
    s = { id, company: c.id, n, vm: label, label, host: `${label}.${region}.cloudapp.azure.com`, secret: random(32), password: random(9).replace(/[-_]/g, 'x'), serverKey: `sk_${random(32)}`, receiverKey: `rk_${random(24)}` };
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
      return { at: b.at, from, cameras: b.cameras, hours: b.hours, until: b.until, endedAt: b.endedAt || 0, state, hoursRun: Math.round(hoursRun * 100) / 100, cameraHour: b.cameraHour, cost: pounds((state === 'booked' ? b.hours : hoursRun) * b.cameras * b.cameraHour), paid: b.paid || null }; // booked ahead: what it will come to
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
  // its times, as of now: a booking to start now starts when it's made
  const timesOf = (a) => (a.startNow ? { from: now(), until: now() + a.hours * HOUR } : { from: Math.max(a.from, now()), until: a.until });
  // why this booking can't be made now, if it can't
  async function cantBook(c, h, a) {
    if (c.status !== 'approved') return reply(403, { error: c.status === 'pending' ? 'We\'re still checking your application' : 'This company has been blocked from starting servers' });
    if (!payments && !isAdmin(h)) return reply(503, { error: BOOKINGS_CLOSED });
    if (payments && !c.payment && !isAdmin(h)) return reply(402, { error: 'Add your payment details first' });
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
    await store.put('serverplan', c.id, { id: c.id, cameras, servers: needed, hours, from, until, cameraHour, requestedAt: bookedAt, requestedBy: me.email || '', bookingKey, paid });
    await store.put(`booking:${c.id}`, bookingKey, { key: bookingKey, at: bookedAt, from, cameras, hours, until, cameraHour, paid });
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
  async function stopCompany(id) {
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
      for (const c of (await store.list('company')).sort((x, y) => y.at - x.at)) {
        const v = await view(c), u = await usage(c.id);
        out.push({ id: c.id, name: c.name, status: c.status, note: c.note || '', contact: c.contact, email: c.email, website: c.website, about: c.about, logo: c.logo || '', theme: c.theme, at: c.at, card: cardView(c.payment), price: await pricing(c),
          server: { state: v.state, wanted: v.wanted, scheduled: v.scheduled, from: v.from, until: v.until, cameras: v.cameras, serverCount: v.serverCount, camerasLive: v.servers.reduce((n, s) => n + s.cameras, 0), bookedCameraHour: v.bookedCameraHour, error: v.error }, usage: u });
        for (const k of Object.keys(totals)) totals[k] += u[k];
      }
      for (const k of Object.keys(totals)) totals[k] = Math.round(totals[k] * 100) / 100;
      return reply(200, { customers: out, totals, month: monthOf(now()), running: out.filter((c) => c.server.wanted === 'on' && !c.server.scheduled).length, maxRunning, pricing: await pricing() });
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
      if (!(await store.get('company', id))) return reply(404, { error: 'No such company' });
      await stopCompany(id);
      return reply(200, { stopped: true });
    }
    return null;
  }

  async function servers(method, a, b, body, h) {
    // a server's settings, kept here as the server itself is deleted when it's shut down
    if (a === 'settings' && (method === 'GET' || method === 'POST')) {
      const k = await store.get('serverkey', sha(h['x-server-key'] || ''));
      if (!k) return reply(401, { error: 'That key isn\'t recognised' });
      if (method === 'GET') return reply(200, { settings: (await store.get('servercfg', k.id))?.settings || null, booked: await bookedOn(k.id) });
      const settings = body?.settings;
      if (!settings || typeof settings !== 'object' || JSON.stringify(settings).length > MAX_SETTINGS) return reply(400, { error: 'Those settings won\'t fit' });
      await store.put('servercfg', k.id, { id: k.id, settings, at: now() });
      return reply(200, { ok: true });
    }
    if (a === 'report' && method === 'POST') {
      const k = await store.get('serverkey', sha(h['x-server-key'] || ''));
      if (!k) return reply(401, { error: 'That key isn\'t recognised' });
      const want = (await store.get('serverwant', k.id)) || { id: k.id, desired: 'off' };
      want.lastReport = now();
      want.cameras = Math.max(0, Math.min(99, +body?.cams || 0)); want.judges = Math.max(0, Math.min(99, +body?.judges || 0));
      // finished: nothing left to send, so it may now be turned off
      if (body?.what === 'finished') { want.finished = true; want.desired = 'off'; want.saved = body.saved === true; } // saved: all of it is in cloud storage
      await store.put('serverwant', k.id, want);
      return reply(200, { stop: want.desired === 'off' || (!!want.until && want.until <= now()), until: want.until || 0 });
    }
    if (a !== 'mine') return null;
    const { me, c, role, error } = await companyOf(h); if (error) return error;
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
      if (!payments) return reply(503, { error: 'Card payments aren\'t switched on yet' });
      try {
        const email = me.email || (await store.get('user', me.uid))?.email || c.email || '';
        const { url, customerId } = await payments.startSetup({ companyId: c.id, companyName: c.name, email, customerId: c.stripeCustomer });
        if (customerId !== c.stripeCustomer) await store.put('company', c.id, { ...c, stripeCustomer: customerId });
        return reply(200, { url });
      } catch { return reply(502, { error: 'We couldn\'t reach our card provider: please try again' }); }
    }
    if (b === 'payment-done') {
      if (!payments) return reply(503, { error: 'Card payments aren\'t switched on yet' });
      const id = String(body?.session || '');
      if (!/^cs_[\w-]{1,200}$/.test(id)) return reply(400, { error: 'That card wasn\'t saved: please try again' });
      let saved; try { saved = await payments.finishSetup(id, c.id); } catch { return reply(400, { error: 'That card wasn\'t saved: please try again' }); }
      const { customerId, ...card } = saved, next = { ...c, stripeCustomer: customerId, payment: { ...card, at: now() } };
      await store.put('company', c.id, next);
      return reply(200, { server: await view(next, h) });
    }
    // Customers go through the payment page: checkout says what the booking comes to and holds it for a while, and paying for it makes it.
    // For now the payment is pretend: nothing is charged, and it's marked so on the booking.
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
      if (!co || co.id !== String(body?.checkout || '') || co.by !== me.uid) return reply(404, { error: 'That payment isn\'t open any more: please book again' });
      if (co.exp < now()) { await store.remove('checkout', c.id); return reply(410, { error: `That payment ran out after ${CHECKOUT_MINUTES} minutes: please book again` }); }
      if (!co.startNow && co.until - Math.max(co.from, now()) < HOUR) return reply(410, { error: 'That booking\'s start time has passed: please book again' });
      const r = await book(c, me, h, co, { cameraHour: co.cameraHour, paid: { pretend: true, amount: co.cost, at: now() } });
      if (r.status === 200) await store.remove('checkout', c.id);
      return r;
    }
    if (b === 'start') {
      if (!isAdmin(h)) return reply(402, { error: 'Pay for your booking first' });
      const a = asked(body); if (a.error) return reply(400, { error: a.error });
      return book(c, me, h, a);
    }
    if (b === 'extend') {
      if (!payments && !isAdmin(h)) return reply(503, { error: BOOKINGS_CLOSED });
      const hours = Number(body?.hours), plan = await store.get('serverplan', c.id);
      if (!active(plan) || (await view(c, h)).wanted !== 'on') return reply(409, { error: 'Your servers aren\'t running: start them instead' });
      if (!Number.isInteger(hours) || hours < 1 || hours > MAX_EXTEND_HOURS) return reply(400, { error: `Add between 1 and ${MAX_EXTEND_HOURS} hours at a time` });
      const until = plan.until + hours * HOUR;
      if (until > Math.max(now(), plan.from || 0) + MAX_AHEAD_HOURS * HOUR) return reply(400, { error: `That's more than ${MAX_AHEAD_HOURS} hours ahead: extend it nearer the time` });
      await store.put('serverplan', c.id, { ...plan, hours: plan.hours + hours, until });
      await changeBooking(c.id, plan, { hours: plan.hours + hours, until });
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
      if (!s || st?.state !== 'on') return reply(409, { error: 'That server isn\'t on yet' });
      const t = signFor(s.secret, { kind: 'login', who: me.email || me.uid, exp: now() + LOGIN_MINUTES * 60e3 });
      // which of the review's tabs to open on, and how many servers the booking has, so the review can switch to the others
      const tab = OPEN_TABS.includes(body?.tab) ? body.tab : 'live', of = (await store.get('serverplan', c.id))?.servers || 1;
      return reply(200, { url: `https://${s.host}/login?t=${encodeURIComponent(t)}&tab=${tab}&n=${n}&of=${of}` });
    }
    return null;
  }
  return { servers, adminPricing, adminCustomers, stopCompany };
}

module.exports = { createServers, signFor, serversFor };
