// A small driver for headless Chrome over the DevTools protocol (no packages): open a page, run script in it, take a picture.
// Used by promo/shoot.mjs (phone screenshots of the site) and promo/render.mjs (the promo video's frames).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9333, args = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-chrome-'));
  const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--disable-gpu-vsync', ...args, 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
  }
  if (!target) throw new Error('Chrome didn\'t start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const waiting = new Map(), listeners = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiting.has(d.id)) { const [res, rej] = waiting.get(d.id); waiting.delete(d.id); if (d.error) rej(new Error(d.error.message)); else res(d.result); }
    else if (d.method) for (const l of listeners) l(d);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const n = ++id; waiting.set(n, [res, rej]); ws.send(JSON.stringify({ id: n, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  const page = {
    send,
    /** the page's size, in CSS pixels, and how many device pixels to each */
    size: (width, height, scale = 1, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile }),
    async goto(url, settle = 1500) {
      const loaded = new Promise((r) => { const l = (d) => { if (d.method === 'Page.loadEventFired') { listeners.splice(listeners.indexOf(l), 1); r(); } }; listeners.push(l); });
      await send('Page.navigate', { url }); await Promise.race([loaded, sleep(15000)]); await sleep(settle);
    },
    /** run an expression in the page (awaiting it) and return its value */
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async shot(file, { format = 'png', quality = 90 } = {}) {
      const r = await send('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality } : {}), captureBeyondViewport: false });
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    },
    async close() { try { await send('Browser.close'); } catch { /* gone */ } ws.close(); setTimeout(() => { try { proc.kill(); } catch { /* gone */ } fs.rmSync(dir, { recursive: true, force: true }); }, 500); },
  };
  return page;
}
export { sleep };
