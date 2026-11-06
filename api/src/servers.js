'use strict';
/* Each approved company's Receiver server, as the site sees it. The site never touches Azure: it says what's wanted, and the control
   app (control/), which alone has rights over the servers, makes it so within a minute and says how it went.
     server:<id>       who it is and its secrets; made once, never sent to a browser
     serverwant:<id>   what's wanted, and what the server last reported (written here)
     serverstate:<id>  what it's actually doing, and hours used (written by the control app)

   GET  /api/servers/mine           -> { server } what it's doing, for the company's owner
   POST /api/servers/mine/start     -> { server }
   POST /api/servers/mine/stop      -> { server }
   POST /api/servers/mine/open      -> { url } a short-lived sign-in link to the server's own page
   POST /api/servers/report         (the server itself, with its key) -> { stop } */
const crypto = require('node:crypto');
const { recordingsPartition } = require('./recordings');

const LOGIN_MINUTES = 5;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const random = (n) => crypto.randomBytes(n).toString('base64url');
const signFor = (secret, payload) => { const p = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${p}.${crypto.createHmac('sha256', secret).update(p).digest('base64url')}`; };
const monthOf = (t) => new Date(t).toISOString().slice(0, 7);

function createServers({ store, now, reply, session, maxRunning = 1, region = 'italynorth' }) {
  async function companyOf(h) {
    const me = session(h); if (!me) return { error: reply(401, { error: 'Sign in first' }) };
    const of = await store.get('companyof', me.uid), c = of && await store.get('company', of.id);
    if (!c) return { error: reply(404, { error: 'This account has no company yet' }) };
    return { me, c };
  }
  const view = (c, want, st) => ({
    state: st?.state || 'off', wanted: want?.desired || 'off', host: st?.state === 'on' ? st.host : '', error: st?.error || '',
    startedAt: st?.startedAt || 0, cameras: want?.cameras || 0, judges: want?.judges || 0, hoursThisMonth: Math.round((st?.minutes?.[monthOf(now())] || 0) / 6) / 10,
    canStart: c.status === 'approved',
  });
  async function ensureServer(c) {
    let s = await store.get('server', c.id);
    if (s) return s;
    // the name its address is built on; the hash keeps it unguessable from the company's name
    const label = `hj-${c.id.slice(0, 20).replace(/-+$/, '')}-${sha(c.id + random(8)).slice(0, 6)}`;
    s = { id: c.id, vm: label, label, host: `${label}.${region}.cloudapp.azure.com`, secret: random(32), password: random(9).replace(/[-_]/g, 'x'), serverKey: `sk_${random(32)}`, receiverKey: `rk_${random(24)}` };
    await store.put('server', c.id, s);
    await store.put('serverkey', sha(s.serverKey), { id: c.id });
    // its finished recordings go to the company owner's cloud recordings
    await store.put('reckey', sha(s.receiverKey), { id: `srv-${c.id}`, name: 'Cloud Receiver', partition: recordingsPartition(c.owner) });
    return s;
  }
  // how many are on or on their way, not counting this company's own (limited by the subscription's graphics-card allowance)
  async function othersRunning(id) {
    let n = 0;
    for (const w of await store.list('serverwant')) if (w.id !== id && w.desired === 'on') n++;
    for (const st of await store.list('serverstate')) if (st.id !== id && st.state !== 'off' && !(await store.get('serverwant', st.id))?.desired?.startsWith('on')) n++;
    return n;
  }

  return async function servers(method, a, b, body, h) {
    if (a === 'report' && method === 'POST') {
      const k = await store.get('serverkey', sha(h['x-server-key'] || ''));
      if (!k) return reply(401, { error: 'That key isn\'t recognised' });
      const want = (await store.get('serverwant', k.id)) || { id: k.id, desired: 'off' };
      want.lastReport = now();
      want.cameras = Math.max(0, Math.min(99, +body?.cams || 0)); want.judges = Math.max(0, Math.min(99, +body?.judges || 0));
      // finished: nothing left to send, or it stopped itself because nobody's using it. Either way it may now be turned off.
      if (body?.what === 'finished') { want.finished = true; want.desired = 'off'; }
      await store.put('serverwant', k.id, want);
      return reply(200, { stop: want.desired === 'off' });
    }
    if (a !== 'mine') return null;
    const { me, c, error } = await companyOf(h); if (error) return error;
    if (!b && method === 'GET') return reply(200, { server: view(c, await store.get('serverwant', c.id), await store.get('serverstate', c.id)) });
    if (method !== 'POST') return null;
    if (b === 'start') {
      if (c.status !== 'approved') return reply(403, { error: c.status === 'pending' ? 'We\'re still checking your application' : 'This company can\'t start a server at the moment' });
      if (await othersRunning(c.id) >= maxRunning) return reply(409, { error: 'All our servers are in use right now: try again a little later' });
      await ensureServer(c);
      const was = await store.get('serverwant', c.id);
      const want = { id: c.id, ...was, desired: 'on', requestedAt: now(), requestedBy: me.email || '', finished: false };
      await store.put('serverwant', c.id, want);
      return reply(200, { server: view(c, want, await store.get('serverstate', c.id)) });
    }
    if (b === 'stop') {
      const want = { id: c.id, ...(await store.get('serverwant', c.id)), desired: 'off', stopRequestedAt: now() };
      await store.put('serverwant', c.id, want);
      return reply(200, { server: view(c, want, await store.get('serverstate', c.id)) });
    }
    if (b === 'open') {
      const st = await store.get('serverstate', c.id), s = await store.get('server', c.id);
      if (!s || st?.state !== 'on') return reply(409, { error: 'Your server isn\'t on yet' });
      const t = signFor(s.secret, { kind: 'login', who: me.email || me.uid, exp: now() + LOGIN_MINUTES * 60e3 });
      return reply(200, { url: `https://${s.host}/login?t=${encodeURIComponent(t)}` });
    }
    return null;
  };
}

module.exports = { createServers, signFor };
