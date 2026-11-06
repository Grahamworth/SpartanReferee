'use strict';
// Winding down: a server runs for the time its company booked, and the site says when that's over (or when Stop was pressed). It's told
// it can turn the server off only once the recordings have gone, and the control app has a timer of its own in case this machine can't say so.
// Idle and hard limits are here for a server run by hand; a booked server has them at 0, meaning off.
function createSleep({ idleMinutes, hardHours, busy, flush, tell, log = () => {}, now = Date.now, everyMs = 60000 }) {
  const startedAt = now();
  let lastSeen = now(), leaving = false, timer = null, until = 0;
  const status = () => ({ idleMinutes, hardHours, quietMinutes: Math.floor((now() - lastSeen) / 60000), leaving, until });
  async function leave(why) {
    if (leaving) return;
    leaving = true;
    log(`Turning off: ${why}`);
    try { await flush(); } catch (e) { log(`Finishing up: ${e.message}`); }
    await tell('finished');
  }
  async function tick() {
    if (leaving) return;
    if (busy()) lastSeen = now();
    if (hardHours && now() - startedAt >= hardHours * 3600e3) return leave(`it has been on for ${hardHours} hours`);
    if (idleMinutes && now() - lastSeen >= idleMinutes * 60000) return leave(`nothing has happened for ${idleMinutes} minutes`);
    const r = await tell('alive');
    if (r?.until !== undefined) until = r.until;
    // the booked time is over, or the customer pressed Stop
    if (r && r.stop) return leave('asked to stop');
    return undefined;
  }
  return {
    start() { timer = setInterval(() => tick().catch(() => {}), everyMs); if (timer.unref) timer.unref(); },
    stop() { clearInterval(timer); },
    seen() { lastSeen = now(); },
    status, tick, leave, until: () => until,
  };
}
module.exports = { createSleep };
