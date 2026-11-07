'use strict';
// Uploaded videos are analysed here on the server, on its graphics card, so nothing runs in anyone's browser and the page can be
// closed. One at a time, in a Chrome of its own, with its results reported like a live judge's. Live cameras come first: while
// every live judge this server can run is busy, the analysis waits, as sharing the card would make them miss reps.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { FLAGS, connect } = require('./engines');

const PORT = 9390;
const KEEP = 30;                // finished jobs remembered, for the page
const STALL_MS = 10 * 60e3;     // no progress for this long: something's wrong
const SETTLE_MS = 4000;         // what it just found is on its way to the server
const ACTIVE = new Set(['queued', 'running', 'waiting']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function firstPage(port, alive) {
  for (let i = 0; i < 60 && alive(); i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) })).json()).find((x) => x.type === 'page');
      if (page) return page;
    } catch { /* still starting */ }
    await sleep(500);
  }
  throw new Error('its browser didn\'t start');
}

/** pageUrl(video, name): the judge's address for that video; settings(): every saved judge setting; busy(): live judges need the card */
function createUploadJobs({ chrome, dataDir, pageUrl, settings, busy = () => false, extraFlags = [], env = {}, log = () => {}, now = Date.now, pollMs = 2000, settleMs = SETTLE_MS, stallMs = STALL_MS, spawnFn = spawn, connectFn = connect, pageFn = firstPage }) {
  const file = path.join(dataDir, 'upload-jobs.json');
  let jobs = [];
  try { jobs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none yet */ }
  // a job the server was running when it stopped can't carry on: its video is still there to judge again
  for (const j of jobs) if (ACTIVE.has(j.state)) { j.state = 'stopped'; j.why = 'The server stopped before it finished.'; }
  const save = () => { try { fs.writeFileSync(file, JSON.stringify(jobs)); } catch (e) { log(`Saving upload jobs: ${e.message}`); } };
  let current = null, nextId = jobs.reduce((n, j) => Math.max(n, j.id || 0), 0) + 1;

  const end = (job, state, why = '') => { job.state = state; job.why = why; job.endedAt = now(); save(); };
  async function run(job) {
    const dir = path.join(dataDir, 'engines', 'upload');
    fs.mkdirSync(dir, { recursive: true });
    const proc = spawnFn(chrome, [...FLAGS, ...extraFlags, `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, 'about:blank'], { env: { ...process.env, ...env }, stdio: 'ignore' });
    let gone = false, cdp = null;
    proc.on('error', () => { gone = true; });
    proc.on('exit', () => { gone = true; });
    try {
      const page = await pageFn(PORT, () => !gone);
      cdp = await connectFn(page.webSocketDebuggerUrl);
      await cdp.send('Page.enable');
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { for (const [k, v] of Object.entries(${JSON.stringify(settings())})) localStorage.setItem(k, v); } catch {}` });
      await cdp.send('Page.navigate', { url: pageUrl(job.video, job.name) });
      job.state = 'running'; job.startedAt = now(); save();
      log(`Analysing ${job.name}`);
      let movedAt = now();
      for (;;) {
        await sleep(pollMs);
        if (gone) throw new Error('its browser stopped');
        const wait = !job.stopAsked && busy();
        const r = await cdp.send('Runtime.evaluate', { returnByValue: true, expression: `(() => { const a = window.__analysis; if (!a) return null; a.paused = ${wait}; if (${!!job.stopAsked}) a.stop = true; return { pct: a.pct, done: a.done }; })()` });
        const a = r?.result?.result?.value;
        job.state = wait ? 'waiting' : 'running';
        if (a) { if (a.pct !== job.pct) { job.pct = a.pct; movedAt = now(); } if (a.done) break; }
        if (wait) movedAt = now();
        if (job.stopAsked && !a) break; // stopped before it had begun
        if (now() - movedAt > stallMs) throw new Error('it stopped making progress');
      }
      await sleep(settleMs);
      if (job.stopAsked) end(job, 'stopped', job.stopWhy || ''); else { job.pct = 100; end(job, 'done'); }
      log(`Finished analysing ${job.name}`);
    } catch (e) {
      log(`Analysing ${job.name}: ${e.message}`);
      end(job, 'failed', `The analysis couldn't finish: ${e.message}.`);
    } finally {
      try { cdp?.ws?.close(); } catch { /* gone */ }
      try { proc.kill('SIGKILL'); } catch { /* gone */ }
    }
  }
  async function pump() {
    if (current) return;
    const job = jobs.find((j) => j.state === 'queued');
    if (!job) return;
    current = job;
    try { await run(job); } finally { current = null; pump(); }
  }
  return {
    /** Adds a video to the queue. Already queued or running: that job. */
    add(video, name) {
      const had = jobs.find((j) => j.video === video && ACTIVE.has(j.state));
      if (had) return had;
      const job = { id: nextId++, video, name, state: 'queued', pct: 0, at: now() };
      jobs.push(job);
      const done = jobs.filter((j) => !ACTIVE.has(j.state));
      if (done.length > KEEP) { const old = new Set(done.slice(0, done.length - KEEP)); jobs = jobs.filter((j) => !old.has(j)); }
      save(); pump();
      return job;
    },
    /** Stops a video's analysis. What it found so far is kept. */
    stop(video, why = '') {
      const job = jobs.find((j) => j.video === video && ACTIVE.has(j.state));
      if (!job) return false;
      if (job === current) { job.stopAsked = true; job.stopWhy = why; } else end(job, 'stopped', why);
      return true;
    },
    /** newest first; only what the page needs */
    list: () => [...jobs].reverse().map(({ id, video, name, state, pct, at, startedAt, endedAt, why }) => ({ id, video, name, state, pct, at, startedAt, endedAt, why })),
    active: () => jobs.some((j) => ACTIVE.has(j.state)),
    /** the server's stopping: everything's stopped, and what was found has gone up */
    async stopAll(why = 'The server stopped before it finished.') {
      for (const j of [...jobs]) if (ACTIVE.has(j.state)) this.stop(j.video, why);
      for (let i = 0; i < 60 && current; i++) await sleep(250);
    },
  };
}

module.exports = { createUploadJobs, ACTIVE };
