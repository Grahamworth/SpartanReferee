'use strict';
// Servers cost money by the hour, so one nobody is using asks to be turned off. It goes quiet when no camera is live, no browser has
// asked for anything and nobody's watching; a hard limit stops one that's been left streaming to nothing for good. The site is told it
// can turn the server off only once the recordings have gone, and the site has a timer of its own in case this machine can't say so.
function createSleep({ idleMinutes, hardHours, busy, flush, tell, log = () => {}, now = Date.now, everyMs = 60000 }) {
  const startedAt = now();
  let lastSeen = now(), leaving = false, timer = null;
  const status = () => ({ idleMinutes, hardHours, quietMinutes: Math.floor((now() - lastSeen) / 60000), leaving, offAt: new Date(startedAt + hardHours * 3600e3).toISOString() });
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
    if (now() - startedAt >= hardHours * 3600e3) return leave(`it has been on for ${hardHours} hours`);
    if (now() - lastSeen >= idleMinutes * 60000) return leave(`nothing has happened for ${idleMinutes} minutes`);
    const r = await tell('alive');
    // the customer pressed Stop on the site
    if (r && r.stop) return leave('asked to stop');
    return undefined;
  }
  return {
    start() { timer = setInterval(() => tick().catch(() => {}), everyMs); if (timer.unref) timer.unref(); },
    stop() { clearInterval(timer); },
    seen() { lastSeen = now(); },
    status, tick, leave,
  };
}
module.exports = { createSleep };
