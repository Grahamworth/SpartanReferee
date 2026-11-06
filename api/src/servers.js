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
   POST /api/servers/mine/start {cameras, hours}  -> { server }
   POST /api/servers/mine/extend {hours}          -> { server }
   POST /api/servers/mine/stop                    -> { server }
   POST /api/servers/mine/open {n}                -> { url } a short-lived sign-in link to that server's own page
   POST /api/servers/report                       (a server, with its key) -> { stop, until } */
const crypto = require('node:crypto');
const { recordingsPartition } = require('./recordings');

const CAMERAS_PER_SERVER = 2, MAX_HOURS = 24, MAX_EXTEND_HOURS = 12, MAX_AHEAD_HOURS = 72, LOGIN_MINUTES = 5;
const HOUR = 3600e3;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const random = (n) => crypto.randomBytes(n).toString('base64url');
const signFor = (secret, payload) => { const p = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${p}.${crypto.createHmac('sha256', secret).update(p).digest('base64url')}`; };
const monthOf = (t) => new Date(t).toISOString().slice(0, 7);
const slotId = (company, n) => (n === 1 ? company : `${company}~${n}`);
const serversFor = (cameras) => Math.ceil(cameras / CAMERAS_PER_SERVER);
const pounds = (v) => Math.round(v * 100) / 100;

function createServers({ store, now, reply, session, maxRunning = 1, hourPrice = 0.66, region = 'italynorth' }) {
  async function companyOf(h) {
    const me = session(h); if (!me) return { error: reply(401, { error: 'Sign in first' }) };
    const of = await store.get('companyof', me.uid), c = of && await store.get('company', of.id);
    if (!c) return { error: reply(404, { error: 'This account has no company yet' }) };
    return { me, c };
  }
  const active = (plan) => !!plan && plan.until > now();
  // the whole booking and each server in it, in one view
  async function view(c) {
    const plan = await store.get('serverplan', c.id), count = plan?.servers || 1, slots = [];
    const month = monthOf(now()); let minutes = 0;
    for (let n = 1; n <= count; n++) {
      const id = slotId(c.id, n), want = await store.get('serverwant', id), st = await store.get('serverstate', id);
      minutes += st?.minutes?.[month] || 0;
      slots.push({ n, state: st?.state || 'off', wanted: want?.desired === 'on' && active(plan) ? 'on' : 'off', error: st?.error || '', cameras: want?.cameras || 0, judges: want?.judges || 0 });
    }
    const wanted = slots.some((s) => s.wanted === 'on') ? 'on' : 'off';
    const state = slots.some((s) => s.state === 'stopping') ? 'stopping' : slots.some((s) => s.state === 'starting') ? 'starting' : slots.every((s) => s.state === 'on') ? 'on' : slots.some((s) => s.state === 'on') ? 'starting' : 'off';
    return {
      state, wanted, servers: slots, error: slots.map((s) => s.error).find(Boolean) || '',
      cameras: plan?.cameras || 0, serverCount: count, until: wanted === 'on' ? plan.until : 0, bookedHours: plan?.hours || 0,
      bookedCost: plan ? pounds(plan.hours * plan.servers * hourPrice) : 0,
      hoursThisMonth: Math.round(minutes / 6) / 10, canStart: c.status === 'approved',
      price: { hour: hourPrice, camerasPerServer: CAMERAS_PER_SERVER, maxHours: MAX_HOURS, maxExtendHours: MAX_EXTEND_HOURS, maxCameras: maxRunning * CAMERAS_PER_SERVER },
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
  const ofCompany = (slot, company) => slot === company || slot.startsWith(`${company}~`);
  // how many are on or on their way, not counting this company's own (limited by the subscription's graphics-card allowance)
  async function othersRunning(company) {
    const busy = new Set();
    for (const w of await store.list('serverwant')) if (!ofCompany(w.id, company) && w.desired === 'on' && !(w.until && w.until <= now())) busy.add(w.id);
    for (const st of await store.list('serverstate')) if (!ofCompany(st.id, company) && st.state && st.state !== 'off') busy.add(st.id);
    return busy.size;
  }
  async function forEachWant(company, count, change) {
    for (let n = 1; n <= count; n++) {
      const id = slotId(company, n);
      await store.put('serverwant', id, { id, company, ...(await store.get('serverwant', id)), ...change });
    }
  }

  return async function servers(method, a, b, body, h) {
    if (a === 'report' && method === 'POST') {
      const k = await store.get('serverkey', sha(h['x-server-key'] || ''));
      if (!k) return reply(401, { error: 'That key isn\'t recognised' });
      const want = (await store.get('serverwant', k.id)) || { id: k.id, desired: 'off' };
      want.lastReport = now();
      want.cameras = Math.max(0, Math.min(99, +body?.cams || 0)); want.judges = Math.max(0, Math.min(99, +body?.judges || 0));
      // finished: nothing left to send, so it may now be turned off
      if (body?.what === 'finished') { want.finished = true; want.desired = 'off'; }
      await store.put('serverwant', k.id, want);
      return reply(200, { stop: want.desired === 'off' || (!!want.until && want.until <= now()), until: want.until || 0 });
    }
    if (a !== 'mine') return null;
    const { me, c, error } = await companyOf(h); if (error) return error;
    if (!b && method === 'GET') return reply(200, { server: await view(c) });
    if (method !== 'POST') return null;
    if (b === 'start') {
      if (c.status !== 'approved') return reply(403, { error: c.status === 'pending' ? 'We\'re still checking your application' : 'This company can\'t start a server at the moment' });
      const cameras = Number(body?.cameras), hours = Number(body?.hours);
      if (!Number.isInteger(cameras) || cameras < 1 || cameras > 40) return reply(400, { error: 'How many cameras do you need?' });
      if (!Number.isInteger(hours) || hours < 1 || hours > MAX_HOURS) return reply(400, { error: `Book between 1 and ${MAX_HOURS} hours: you can extend it later` });
      const plan = await store.get('serverplan', c.id);
      if (active(plan) && (await view(c)).wanted === 'on') return reply(409, { error: 'Your servers are already booked: extend them instead' });
      const needed = serversFor(cameras);
      if (await othersRunning(c.id) + needed > maxRunning) return reply(409, { error: needed > maxRunning ? `We can run ${maxRunning} server${maxRunning === 1 ? '' : 's'} at once at the moment, which is ${maxRunning * CAMERAS_PER_SERVER} cameras` : 'All our servers are in use right now: try again a little later' });
      for (let n = 1; n <= needed; n++) await ensureServer(c, n);
      const until = now() + hours * HOUR;
      await store.put('serverplan', c.id, { id: c.id, cameras, servers: needed, hours, until, requestedAt: now(), requestedBy: me.email || '' });
      await forEachWant(c.id, needed, { desired: 'on', requestedAt: now(), requestedBy: me.email || '', finished: false, stopRequestedAt: 0, until, lastReport: 0 });
      return reply(200, { server: await view(c) });
    }
    if (b === 'extend') {
      const hours = Number(body?.hours), plan = await store.get('serverplan', c.id);
      if (!active(plan) || (await view(c)).wanted !== 'on') return reply(409, { error: 'Your servers aren\'t running: start them instead' });
      if (!Number.isInteger(hours) || hours < 1 || hours > MAX_EXTEND_HOURS) return reply(400, { error: `Add between 1 and ${MAX_EXTEND_HOURS} hours at a time` });
      const until = plan.until + hours * HOUR;
      if (until > now() + MAX_AHEAD_HOURS * HOUR) return reply(400, { error: `That's more than ${MAX_AHEAD_HOURS} hours ahead: extend it nearer the time` });
      await store.put('serverplan', c.id, { ...plan, hours: plan.hours + hours, until });
      await forEachWant(c.id, plan.servers, { until });
      return reply(200, { server: await view(c) });
    }
    if (b === 'stop') {
      const plan = await store.get('serverplan', c.id);
      await forEachWant(c.id, plan?.servers || 1, { desired: 'off', stopRequestedAt: now() });
      return reply(200, { server: await view(c) });
    }
    if (b === 'open') {
      const n = Math.max(1, Math.floor(Number(body?.n) || 1)), id = slotId(c.id, n);
      const st = await store.get('serverstate', id), s = await store.get('server', id);
      if (!s || st?.state !== 'on') return reply(409, { error: 'That server isn\'t on yet' });
      const t = signFor(s.secret, { kind: 'login', who: me.email || me.uid, exp: now() + LOGIN_MINUTES * 60e3 });
      return reply(200, { url: `https://${s.host}/login?t=${encodeURIComponent(t)}` });
    }
    return null;
  };
}

module.exports = { createServers, signFor, serversFor };
