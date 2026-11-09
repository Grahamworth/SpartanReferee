'use strict';
const crypto = require('node:crypto');
// Every minute: make each company's server what the site says is wanted, and turn off anything that shouldn't be costing money. This
// is the safety net, so it holds however badly a server is behaving: one that's stopped reporting, has been on too long, or has been
// told to stop and hasn't finished is turned off regardless. A server runs for the time booked, whether or not anyone's using it, then stops.
// A turned-off server is deleted, with its disk and address, as soon as it has said everything's safe in cloud storage, so it costs
// nothing between bookings. If it never could say so, it's kept for a week in case anything's needed from its disk, then deleted too.
// The next booking makes a new one, on a new address, as a certificate authority limits how often one address can be issued for.
const REPORT_LIMIT_MS = 15 * 60e3;     // silent this long while on: something's wrong
const START_LIMIT_MS = 25 * 60e3;      // not answering this long after starting: give up
const STOP_GRACE_MS = 15 * 60e3;       // told to stop: this long to finish sending its recordings
const NO_BOOKING_LIMIT_MS = 18 * 3600e3; // on with no booked end (which shouldn't happen): this long at most
const UNSAVED_KEEP_MS = 7 * 24 * 3600e3;  // off, with no word that everything's safe: this long at most
const START_LEAD_MS = 10 * 60e3;         // a booking made ahead: its servers go on this long before it starts (api/src/servers.js has it too)

const expired = (want, t) => !!want?.until && t >= want.until;
// a booking made ahead that hasn't started: its servers stay off until START_LEAD before, and nothing is charged until it starts
const tooEarly = (want, t) => !!want?.from && t < want.from - START_LEAD_MS;
const started = (want, t) => !want?.from || t >= want.from;
// the same name with a new ending, for the next machine
function newAddress(server) {
  const label = `${server.label.replace(/-[0-9a-f]{6}$/, '')}-${crypto.randomBytes(3).toString('hex')}`, region = server.host.split('.').slice(1).join('.');
  return { ...server, vm: label, label, host: `${label}.${region}` };
}
const monthOf = (t) => new Date(t).toISOString().slice(0, 7);

/**
 * want: what the site asked for; st: what we last did; power: 'none' | 'running' | 'deallocated' | 'starting' | 'stopping' | 'other'; healthy: does it answer?
 * -> { action: null | 'create' | 'start' | 'deallocate', state, error, offWhy }
 */
function decide({ want, st, power, healthy, now }) {
  const expired = !!want?.until && now >= want.until;
  const desired = want?.desired === 'on' && !expired && !tooEarly(want, now) ? 'on' : 'off';
  const on = power === 'running' || power === 'starting';
  const startedAt = st?.startedAt || 0;
  if (on) {
    // limits that apply whatever is wanted
    if (!want?.until && startedAt && now - startedAt > NO_BOOKING_LIMIT_MS) return { action: 'deallocate', state: 'stopping', offWhy: 'hard-limit', wantOff: true };
    if (st?.state === 'on' && want?.lastReport && now - want.lastReport > REPORT_LIMIT_MS) return { action: 'deallocate', state: 'stopping', offWhy: 'silent', wantOff: true };
    if (st?.state === 'on' && !want?.lastReport && startedAt && now - startedAt > REPORT_LIMIT_MS) return { action: 'deallocate', state: 'stopping', offWhy: 'silent', wantOff: true };
    if (st?.state !== 'on' && desired === 'on' && startedAt && now - startedAt > START_LIMIT_MS && !healthy) return { action: 'deallocate', state: 'stopping', offWhy: 'no-start', error: 'Your server didn\'t start properly. Please try again, and tell us if it happens twice.', wantOff: true };
    if (desired === 'off') {
      const askedAt = want?.stopRequestedAt || (expired ? want.until : 0);
      if (want?.finished || !healthy || !st?.state || (askedAt && now - askedAt > STOP_GRACE_MS) || (!askedAt && now - (want?.lastReport || 0) > STOP_GRACE_MS)) return { action: 'deallocate', state: 'stopping', offWhy: want?.finished ? 'finished' : 'grace' };
      return { action: null, state: 'stopping' }; // it's finishing: the next time it reports it's told to stop
    }
    return { action: null, state: healthy ? 'on' : (st?.state === 'on' ? 'on' : 'starting') };
  }
  if (power === 'stopping') return { action: null, state: 'stopping' };
  if (desired === 'on') {
    if (st?.error && st?.errorAt && want?.requestedAt && want.requestedAt <= st.errorAt) return { action: null, state: 'off', error: st.error }; // waiting for them to try again
    return power === 'none' ? { action: 'create', state: 'starting' } : power === 'deallocated' ? { action: 'start', state: 'starting' } : { action: null, state: 'starting' };
  }
  return { action: null, state: 'off' };
}

const FRIENDLY = (e) => {
  const m = String(e?.message || e);
  if (/quota|QuotaExceeded|OperationNotAllowed/i.test(m)) return 'We\'ve reached our limit of servers: please try again later.';
  if (/SkuNotAvailable|AllocationFailed|ZonalAllocationFailed|OverconstrainedAllocationRequest/i.test(m)) return 'Azure has no graphics-card servers free in that region right now: please try again in a few minutes.';
  return 'Your server couldn\'t start. Please try again, and tell us if it happens twice.';
};

/** one pass over every company with a server */
async function reconcile({ store, arm, health, seedFor, now = Date.now, log = () => {} }) {
  const t = now(), out = [];
  const wants = await store.list('serverwant');
  // a machine nobody knows about (a failed clean-up, say) is turned off too: it would otherwise go unnoticed on the bill
  if (arm.listRunning) {
    try {
      const known = new Set();
      for (const w of wants) { const sv = await store.get('server', w.id); if (sv) known.add(sv.vm); }
      for (const vm of await arm.listRunning()) if (!known.has(vm)) { log(`${vm}: running, but no company wants it: turning off`); await arm.deallocate(vm); out.push({ id: vm, action: 'deallocate', offWhy: 'unknown' }); }
    } catch (e) { log(`checking for unknown servers: ${e.message}`); }
  }
  for (const want of wants) {
    const server = await store.get('server', want.id);
    if (!server) continue;
    const st = (await store.get('serverstate', want.id)) || { id: want.id, state: 'off', minutes: {} };
    try {
      const power = await arm.power(server.vm);
      // being deleted: once the machine has gone, what's left goes too, and the next one gets a new address
      if (st.removing) {
        if (power === 'none') {
          await arm.deleteLeftovers(server.vm, st.removing.disk);
          log(`${want.id}: deleted`);
          await store.put('server', want.id, newAddress(server));
          await store.put('serverstate', want.id, { ...st, removing: null, state: 'off', power: 'none', host: '', startedAt: 0, checkedAt: t, offSince: 0 });
          out.push({ id: want.id, action: 'removed' });
        } else await store.put('serverstate', want.id, { ...st, checkedAt: t });
        continue;
      }
      const running = power === 'running' || power === 'starting';
      const healthy = running ? await health(server.host) : false;
      const d = decide({ want, st, power, healthy, now: t });
      const next = { ...st, id: want.id, host: server.host, state: d.state, power, checkedAt: t, minutes: { ...(st.minutes || {}) } };
      // hours used, counted by the minute the machine is actually on
      if (running && st.checkedAt) {
        const k = monthOf(t), mins = Math.min(10, (t - st.checkedAt) / 60e3);
        const add = (name, v) => { next[name] = { ...(st[name] || {}) }; next[name][k] = (next[name][k] || 0) + v; };
        next.minutes[k] = (next.minutes[k] || 0) + mins;
        // charged at the price its booking started at, for the cameras booked on this server
        // Customers pay until they press Stop or their booked time ends. The minutes after that, saving the recordings, are our cost.
        if (want.desired === 'on' && !expired(want, t) && started(want, t)) {
          add('cameraMinutes', mins * (want.bookedCameras || 0));
          add('charge', (mins / 60) * (want.bookedCameras || 0) * (want.cameraHour || 0));
        }
        add('azure', (mins / 60) * (want.azureHour || 0));
      }
      if (d.error) { next.error = d.error; next.errorAt = next.errorAt && st.error === d.error ? next.errorAt : t; } else if (d.action === 'create' || d.action === 'start' || d.state === 'on') { next.error = ''; next.errorAt = 0; next.errorDetail = ''; }
      if (d.action === 'create' || d.action === 'start') {
        next.startedAt = t;
        try { if (d.action === 'create') await arm.create(server, await seedFor(server, want)); else await arm.start(server.vm); }
        // errorDetail is Azure's own words, kept for working out what went wrong: the site only ever shows `error`
        catch (e) { log(`${want.id}: ${d.action} failed: ${e.message}`); next.state = 'off'; next.error = FRIENDLY(e); next.errorAt = t; next.errorDetail = String(e?.message || e).slice(0, 1000); }
      }
      if (d.action === 'deallocate') {
        log(`${want.id}: turning off (${d.offWhy})`);
        await arm.deallocate(server.vm);
        if (d.wantOff) await store.put('serverwant', want.id, { ...want, desired: 'off', finished: false });
        next.lastOff = { at: t, why: d.offWhy };
      }
      if (d.state === 'off' && !d.action) next.startedAt = 0;
      if (d.state === 'off' || power === 'deallocated') { if (!want.desired || want.desired === 'off') next.startedAt = 0; }
      // off, and not wanted: delete it once everything's safe, or after a week regardless
      next.offSince = power === 'deallocated' ? (st.offSince || st.lastOff?.at || t) : 0;
      if (power === 'deallocated' && !d.action && d.state === 'off' && (want.saved || t - next.offSince > UNSAVED_KEEP_MS)) {
        const disk = await arm.diskOf(server.vm);
        await arm.deleteMachine(server.vm);
        next.removing = { disk, at: t };
        log(`${want.id}: deleting (${want.saved ? 'everything is saved' : 'off for a week'})`);
        d.action = 'delete';
      }
      await store.put('serverstate', want.id, next);
      out.push({ id: want.id, power, ...d });
    } catch (e) { log(`${want.id}: ${e.message}`); out.push({ id: want.id, failed: e.message }); }
  }
  return out;
}

module.exports = { decide, reconcile, START_LEAD_MS, UNSAVED_KEEP_MS, REPORT_LIMIT_MS, START_LIMIT_MS, STOP_GRACE_MS, NO_BOOKING_LIMIT_MS };
