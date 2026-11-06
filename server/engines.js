'use strict';
// One judge per camera, each in its own Chrome: one Chrome funnels every camera through a single queue on the graphics card, and
XXA judge that dies is started
// again. Settings reach it before its page runs, and a round in progress is finished before it's stopped.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE_PORT = 9300;
const FLAGS = ['--no-first-run', '--no-default-browser-check', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-unsafe-webgpu', '--enable-features=Vulkan',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=BackgroundVideoTrackOptimization',
  '--disable-background-media-suspend', '--autoplay-policy=no-user-gesture-required', '--window-size=960,540', '--mute-audio', '--disable-sync', '--disable-extensions'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((ok, no) => { ws.addEventListener('open', ok, { once: true }); ws.addEventListener('error', no, { once: true }); });
  let id = 0; const waiting = new Map();
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } });
  ws.addEventListener('close', () => { for (const r of waiting.values()) r({}); waiting.clear(); });
  return { ws, send: (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); }) };
}

/** chrome: the program; pageUrl(n): the judge's address; settings(): every saved judge setting; max: how many this server can run well */
function createEngines({ chrome, dataDir, pageUrl, settings, max = 2, extraFlags = [], env = {}, log = () => {} }) {
  const running = new Map();   // n → { proc, cdp, startedAt, stopping }
  const want = new Set();

  async function start(n) {
    if (running.has(n)) return;
    const dir = path.join(dataDir, 'engines', `cam${n}`);
    fs.mkdirSync(dir, { recursive: true });
    const port = BASE_PORT + n;
    const proc = spawn(chrome, [...FLAGS, ...extraFlags, `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, 'about:blank'], { env: { ...process.env, ...env }, stdio: 'ignore' });
    const e = { proc, cdp: null, startedAt: Date.now(), stopping: false };
    running.set(n, e);
    proc.on('error', (err) => { log(`Camera ${n}'s judge couldn't start: ${err.message}`); running.delete(n); });
    proc.on('exit', (code) => {
      if (running.get(n) === e) running.delete(n);
      if (!e.stopping) log(`Camera ${n}'s judge stopped (${code})`);
    });
    try {
      let page;
      for (let i = 0; i < 60 && !page && !proc.killed && running.get(n) === e; i++) {
        try { page = (await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1000) })).json()).find((x) => x.type === 'page'); } catch { /* still starting */ }
        if (!page) await sleep(500);
      }
      if (!page) throw new Error('no page');
      e.cdp = await connect(page.webSocketDebuggerUrl);
      await e.cdp.send('Page.enable');
      const seed = settings();
      await e.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { for (const [k, v] of Object.entries(${JSON.stringify(seed)})) localStorage.setItem(k, v); } catch {}` });
      await e.cdp.send('Page.navigate', { url: pageUrl(n) });
      log(`Camera ${n}'s judge started`);
    } catch (err) { log(`Camera ${n}'s judge: ${err.message}`); kill(n, e); }
  }
  function kill(n, e) { e.stopping = true; try { e.cdp?.ws.close(); } catch { /* gone */ } try { e.proc.kill('SIGKILL'); } catch { /* gone */ } if (running.get(n) === e) running.delete(n); }
  // the round in progress is saved first (its athletes' records are completed)
  async function finish(n) {
    const e = running.get(n);
    if (!e) return;
    e.stopping = true;
    try { await Promise.race([e.cdp?.send('Runtime.evaluate', { expression: 'window.__finishRound?.()', awaitPromise: true }), sleep(6000)]); } catch { /* not ready */ }
    await sleep(800); // what it just sent is on its way
    kill(n, e);
  }
  return {
    /** on: whether this camera should be judged. Returns an error to show, or null. */
    set(n, on) {
      if (on && !want.has(n) && want.size >= max) return `This server judges up to ${max} cameras at once. Stop another camera's AI judge first.`;
      if (on) want.add(n); else want.delete(n);
      if (!on) finish(n);
      return null;
    },
    wanted: (n) => want.has(n),
    restore(list) { for (const n of list) if (want.size < max) want.add(+n); },
    /** starts the judges wanted on cameras that are live; a judge that died comes back here too */
    tick(cams) { for (const c of cams) if (c.live && want.has(c.n) && !running.has(c.n)) start(c.n); },
    async restart(n) { if (running.has(n)) await finish(n); },
    running: (n) => running.has(n),
    async stopAll() { await Promise.all([...running.keys()].map(finish)); },
    max,
  };
}

module.exports = { createEngines };
