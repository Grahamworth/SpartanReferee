'use strict';
// Cloud backup: finished recordings go to the Spartans site's storage in the background, one at a time, and are tried
// again later if the internet drops. Off until a Receiver key is entered, and only recordings made after it was switched
// on go up. The copy on this laptop stays as it was.
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const QUIET_MS = 90e3;        // a file unchanged this long is finished (the server closes one every 10 minutes)
const RETRY_MS = 5 * 60e3;

function createCloud({ dir, stateFile, api, settings, doFetch = fetch, now = Date.now }) {
  let sent = {}; try { sent = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* none yet */ }
  const status = { state: 'off', waiting: 0, sentCount: Object.keys(sent).length, current: '', lastAt: 0, error: '' };
  let busy = false, waitUntil = 0;

  function finished() {
    const since = settings().cloudSince || 0, out = [];
    const walk = (d) => {
      let list = []; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of list) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!e.name.endsWith('.mp4')) continue;
        const rel = path.relative(dir, p).replace(/\\/g, '/'), cam = /station(\d+)/.exec(rel);
        if (!cam || sent[rel]) continue;
        let st; try { st = fs.statSync(p); } catch { continue; }
        if (st.size > 0 && st.mtimeMs >= since && now() - st.mtimeMs >= QUIET_MS) out.push({ p, rel, cam: +cam[1], file: e.name, size: st.size, mtime: st.mtimeMs });
      }
    };
    walk(dir);
    return out.sort((a, b) => a.mtime - b.mtime);
  }
  // recordPath: %Y-%m-%d_%H-%M-%S-%f%z: laptop time with its offset, or Z at UTC
  function startedAt(file, fallback) {
    const m = /^(\d{4}-\d\d-\d\d)_(\d\d)-(\d\d)-(\d\d)-\d+(Z|[+-]\d{2})(\d{2})?/.exec(file);
    const t = m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}${m[5] === 'Z' ? 'Z' : `${m[5]}:${m[6] || '00'}`}`) : NaN;
    return new Date(Number.isNaN(t) ? fallback : t).toISOString();
  }
  async function post(where, key, body) {
    const r = await doFetch(`${api()}/recordings/${where}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Receiver-Key': key }, body: JSON.stringify(body), signal: AbortSignal.timeout(30e3) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || `The site said ${r.status}`); e.status = r.status; throw e; }
    return j;
  }
  async function send(f, key) {
    const u = await post('upload', key, { cam: f.cam, file: f.file, size: f.size });
    const put = await doFetch(u.url, { method: 'PUT', duplex: 'half', body: Readable.toWeb(fs.createReadStream(f.p)), headers: { 'x-ms-blob-type': 'BlockBlob', 'x-ms-blob-content-type': 'video/mp4', 'Content-Length': String(f.size) } });
    if (!put.ok) throw new Error(`Storage said ${put.status}`);
    await post('done', key, { blob: u.blob, size: f.size, startedAt: startedAt(f.file, f.mtime) });
    sent[f.rel] = now();
    fs.writeFileSync(stateFile, JSON.stringify(sent));
  }
  async function tick() {
    const { cloudOn, cloudKey } = settings();
    if (!cloudOn || !cloudKey) { status.state = 'off'; status.waiting = 0; status.current = ''; return; }
    if (busy) return;
    const todo = finished(); status.waiting = todo.length;
    if (!todo.length) { if (!status.error) status.state = 'idle'; return; }
    if (now() < waitUntil) return;
    busy = true; status.error = '';
    try {
      for (const f of todo) {
        const s = settings(); if (!s.cloudOn || !s.cloudKey) break;
        status.state = 'sending'; status.current = f.rel;
        await send(f, s.cloudKey);
        status.sentCount = Object.keys(sent).length; status.lastAt = now(); status.waiting--;
      }
      status.state = 'idle';
    } catch (e) {
      status.state = 'error'; status.error = e.status === 401 ? 'That Receiver key isn\'t recognised' : e.message || 'It didn\'t send';
      waitUntil = now() + RETRY_MS; // the recording's still here: it goes when the internet's back
    } finally { busy = false; status.current = ''; }
  }
  return { tick, status };
}

module.exports = { createCloud, QUIET_MS };
