'use strict';
/* Cloud backup of the Receivers' recordings. A Receiver holds a key, never the storage password: for each finished
   recording it asks here for a short-lived link allowing that one file to be written, sends it straight to storage, then
   says it's done. Only the account that made the key sees the list, through links that run out after a few hours.
   Storage deletes recordings after KEEP_DAYS (a lifecycle rule on the storage account); the list here forgets them too. */
const crypto = require('node:crypto');
const { createMembership } = require('./companies');

const KEEP_DAYS = 7;
const MAX_FILE = 5e9;           // a 10-minute recording is well under this
const MAX_OWNER = 200e9;        // about £3 a month of storage, per account
const WRITE_MINUTES = 120, READ_MINUTES = 240;
const SAS_VERSION = '2022-11-02';

/** blobSigner(connectionString)({ blob, perm, minutes, download }) -> a link allowing perm on one blob in the container. */
function blobSigner(connection, container = 'recordings', now = Date.now) {
  const part = (k) => (new RegExp(`(?:^|;)${k}=([^;]+)`).exec(connection) || [])[1] || '';
  const account = part('AccountName'), key = part('AccountKey');
  if (!account || !key) return null;
  const stamp = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
  return ({ blob, perm, minutes, download = '' }) => {
    const start = stamp(now() - 5 * 60e3), end = stamp(now() + minutes * 60e3);
    const disposition = download ? `attachment; filename="${download}"` : '';
    const toSign = [perm, start, end, `/blob/${account}/${container}/${blob}`, '', '', 'https', SAS_VERSION, 'b', '', '', '', disposition, '', '', ''].join('\n');
    const sig = crypto.createHmac('sha256', Buffer.from(key, 'base64')).update(toSign, 'utf8').digest('base64');
    const q = new URLSearchParams({ sv: SAS_VERSION, spr: 'https', st: start, se: end, sr: 'b', sp: perm, sig });
    if (disposition) q.set('rscd', disposition);
    return `https://${account}.blob.core.windows.net/${container}/${blob.split('/').map(encodeURIComponent).join('/')}?${q}`;
  };
}

/** brandWriter(connectionString)(name, bytes, type) -> the public address of a company's logo, in the one container anyone may read. */
function brandWriter(connection, doFetch = fetch) {
  const sign = blobSigner(connection, 'brand');
  if (!sign) return null;
  return async (name, buf, type) => {
    const url = sign({ blob: name, perm: 'cw', minutes: 5 });
    const r = await doFetch(url, { method: 'PUT', body: buf, headers: { 'x-ms-blob-type': 'BlockBlob', 'x-ms-blob-content-type': type, 'x-ms-blob-cache-control': 'public, max-age=31536000, immutable' } });
    if (!r.ok) throw new Error(`Storage said ${r.status}`);
    return url.split('?')[0];
  };
}

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
/** where an account's cloud recordings are listed */
const recordingsPartition = (uid) => `rec:${sha(uid).slice(0, 32)}`;

function createRecordings({ store, signer, now, reply, session, isAdmin, membership = null, fetchFn = (...a) => fetch(...a) }) {
  const owned = recordingsPartition;
  // a company's recordings and results are listed under its owner, for everyone in the company to see
  const { companyFor } = membership || createMembership(store);
  const ownerOf = async (me) => (await companyFor(me))?.c.owner || me.uid;
  async function byKey(h) {
    const key = String(h['x-receiver-key'] || '');
    return key ? store.get('reckey', sha(key)) : null;
  }
  // Each run of a server keeps its results apart (run: a name the server makes when it starts with nothing, see
  // server/index.js). A company's servers are made afresh for every booking and number their athletes from 1 each time, so with
  // one folder for them all a new booking's athlete 1 replaced the last booking's: a morning's seven athletes were gone from
  // Results by the afternoon (20 November 2026). A server that sends no run (older software) keeps the one folder.
  const runOf = (body) => (/^[A-Za-z0-9]{1,24}$/.test(String(body?.run ?? '')) ? String(body.run) : '');
  const resultsId = (link, run) => (run ? `${link.id}-${run}` : link.id);
  const resultsBase = (link, run) => `${link.partition.slice(4)}/${link.id}/results${run ? `-${run}` : ''}`;
  // Every run's saved results for a company's servers (the last KEEP_DAYS), oldest first: [{ r: the run's row, j: its results.json }]
  async function savedRuns(partition, from) {
    const rows = (await store.list(`${partition}:results`)).filter((r) => r.at >= from).sort((x, y) => x.at - y.at), out = [];
    for (const r of rows) {
      try { out.push({ r, j: await (await fetchFn(signer({ blob: `${r.base}/results.json`, perm: 'r', minutes: READ_MINUTES }))).json() }); } catch { /* gone, or not written yet */ }
    }
    return out;
  }
  // The recordings a crowd was in (the servers' deep.js), one entry each however many servers have had a go at it: where and when
  // it was filmed (server: the run that filmed it), how its deep analysis stands now, later: what a later, complete analysis of it
  // found (null if the first server finished it, or nobody has), and wanted: it still wants doing, so the next server carries it on.
  // A recording is tried three times at most, and a run that says it's going but hasn't saved anything for half a day has stopped.
  const DEEP_GOING = new Set(['preparing', 'queued', 'waiting', 'running']), DEEP_TRIES = 3, DEEP_STALE_MS = 12 * 3600e3;
  function deepStates(runs, from) {
    const files = new Map();
    for (const { r, j } of runs) for (const x of Array.isArray(j.deep) ? j.deep : []) {
      if (!x || !x.file || !(Date.parse(x.startedAt) >= from)) continue;
      const state = DEEP_GOING.has(String(x.state)) && now() - r.at > DEEP_STALE_MS ? 'stopped' : String(x.state || '');
      const e = { cam: +x.cam || 0, file: String(x.file), video: String(x.video || ''), startedAt: x.startedAt, endedAt: Date.parse(x.endedAt) >= from ? x.endedAt : x.startedAt, state, pct: +x.pct || 0, replaced: +x.replaced || 0, kept: String(x.kept || ''), earlier: !!x.earlier, server: r.id };
      if (!files.has(e.file)) files.set(e.file, []);
      files.get(e.file).push(e);
    }
    const out = [];
    for (const [file, tries] of files) {
      const first = tries.find((e) => !e.earlier) || tries[0], last = tries.at(-1), uploads = [];
      // analysed in full since: by a server that carried it on (its entry for it says done), or by hand as a previous recording (a run with no entry for it)
      for (const { r, j } of runs) {
        const mine = tries.find((e) => e.server === r.id);
        if (r.id === first.server || (mine && mine.state !== 'done')) continue;
        for (const a of j.athletes || []) if (a.src === 'upload' && (j.sources || {})[a.video] === file) uploads.push(a);
      }
      const since = uploads.length > 0, done = first.state === 'done' || since;
      out.push({ ...first, state: done ? 'done' : last.state, pct: done ? 100 : last.pct, later: first.state !== 'done' && since ? uploads : null,
        wanted: !done && !DEEP_GOING.has(last.state) && tries.length < DEEP_TRIES });
    }
    return out;
  }
  async function entries(partition) {
    const list = await store.list(partition);
    const before = new Date(now() - KEEP_DAYS * 864e5).toISOString();
    for (const r of list.filter((x) => x.startedAt < before)) await store.remove(partition, r.id);
    return list.filter((x) => x.startedAt >= before);
  }

  return async function recordings(method, a, b, body, h) {
    if (!signer) return reply(503, { error: 'Cloud recordings aren\'t set up on the server' });
    // ---- what a Receiver does, with its key
    if (a === 'upload' && method === 'POST') {
      const link = await byKey(h); if (!link) return reply(401, { error: 'That Receiver key isn\'t recognised' });
      const cam = Number(body?.cam), file = String(body?.file || ''), size = Number(body?.size);
      // camera 0 is a video someone uploaded, which can be any of the usual kinds
      if (!Number.isInteger(cam) || cam < 0 || cam > 99) return reply(400, { error: 'Which camera?' });
      if (!(cam === 0 ? /^[\w.+-]{1,160}\.(mp4|mov|m4v|webm|mkv)$/i : /^[\w.+-]{1,100}\.mp4$/).test(file)) return reply(400, { error: 'That isn\'t a recording' });
      if (!(size > 0 && size <= MAX_FILE)) return reply(400, { error: 'That recording is too big' });
      const used = (await entries(link.partition)).reduce((n, r) => n + r.size, 0);
      if (used + size > MAX_OWNER) return reply(507, { error: 'Your cloud storage is full' });
      const blob = `${link.partition.slice(4)}/${link.id}/cam${cam}/${file}`;
      return reply(200, { blob, url: signer({ blob, perm: 'cw', minutes: WRITE_MINUTES }) });
    }
    if (a === 'done' && method === 'POST') {
      const link = await byKey(h); if (!link) return reply(401, { error: 'That Receiver key isn\'t recognised' });
      const blob = String(body?.blob || ''), m = /\/cam(\d{1,2})\/([\w.+-]{1,160}\.(?:mp4|mov|m4v|webm|mkv))$/i.exec(blob), size = Number(body?.size);
      if (!m || !blob.startsWith(`${link.partition.slice(4)}/${link.id}/`) || !(size > 0 && size <= MAX_FILE)) return reply(400, { error: 'That isn\'t your recording' });
      const when = Date.parse(body?.startedAt);
      const id = sha(blob).slice(0, 32);
      await store.put(link.partition, id, { id, blob, cam: +m[1], file: m[2], size, name: String(body?.name || '').slice(0, 120), startedAt: new Date(Number.isNaN(when) ? now() : when).toISOString(), receiver: link.name, at: now() });
      return reply(200, { ok: true });
    }
    // a server saving its results (athletes, tracking, numbers), so they can be seen when it's off
    if (a === 'results-urls' && method === 'POST') {
      const link = await byKey(h); if (!link) return reply(401, { error: 'That Receiver key isn\'t recognised' });
      const names = Array.isArray(body?.names) ? body.names.slice(0, 100) : [];
      if (!names.every((n) => /^(results\.json|tracks\/\d{1,9}\.jsonl|pics\/\d{1,9}\.jpg)$/.test(String(n)))) return reply(400, { error: 'That isn\'t a result' });
      const base = resultsBase(link, runOf(body));
      return reply(200, { urls: Object.fromEntries(names.map((n) => [n, signer({ blob: `${base}/${n}`, perm: 'cw', minutes: WRITE_MINUTES })])) });
    }
    if (a === 'results-done' && method === 'POST') {
      const link = await byKey(h); if (!link) return reply(401, { error: 'That Receiver key isn\'t recognised' });
      const run = runOf(body), id = resultsId(link, run), part = `${link.partition}:results`;
      await store.put(part, id, { id, base: resultsBase(link, run), at: now() });
      // runs too old to show are forgotten (storage has deleted what they pointed at)
      for (const r of await store.list(part)) if (r.at < now() - KEEP_DAYS * 864e5) await store.remove(part, r.id);
      return reply(200, { ok: true });
    }
    // a server choosing one of its company's recordings to analyse
    if (a === 'by-key' && method === 'GET') {
      const link = await byKey(h); if (!link) return reply(401, { error: 'That Receiver key isn\'t recognised' });
      const list = await entries(link.partition);
      if (!b) {
        // (deepWanted: a crowd was in it and no server has finished counting it again in full: the server that asks carries it on)
        const from = now() - KEEP_DAYS * 864e5, wanted = new Set(deepStates(await savedRuns(link.partition, from), from).filter((d) => d.wanted).map((d) => d.file));
        return reply(200, { recordings: list.sort((x, y) => y.startedAt.localeCompare(x.startedAt)).slice(0, 500).map((r) => ({ id: r.id, cam: r.cam, size: r.size, startedAt: r.startedAt, file: r.file, name: r.name || '', ...(wanted.has(r.file) ? { deepWanted: true } : {}) })) });
      }
      const r = list.find((x) => x.id === b); if (!r) return reply(404, { error: 'That recording has gone' });
      return reply(200, { id: r.id, cam: r.cam, file: r.file, name: r.name || '', startedAt: r.startedAt, url: signer({ blob: r.blob, perm: 'r', minutes: READ_MINUTES }) });
    }
    // ---- what the account holder does, signed in
    const me = session(h); if (!me) return reply(401, { error: 'Sign in to see cloud recordings' });
    // what its servers found: the week's athletes and numbers, whether or not a server is on now
    if (a === 'results' && !b && method === 'GET') {
      const from = now() - KEEP_DAYS * 864e5, out = { keepDays: KEEP_DAYS, athletes: [], numbers: [], merged: [], sources: {}, deep: [] };
      const runs = await savedRuns(owned(await ownerOf(me)), from);
      for (const { r, j } of runs) {
        const recent = (iso) => Date.parse(iso) >= from;
        for (const x of j.athletes || []) if (recent(x.firstAt)) out.athletes.push({ ...x, server: r.id, pic: x.pic ? signer({ blob: `${r.base}/pics/${x.n}.jpg`, perm: 'r', minutes: READ_MINUTES }) : '' });
        for (const x of j.numbers || []) if (recent(x.firstAt)) out.numbers.push({ ...x, server: r.id });
        // an athlete filmed by two cameras on the same athletes, their reps put together (n: the server's athletes)
        for (const x of Array.isArray(j.merged) ? j.merged : []) if (recent(x.firstAt) && Array.isArray(x.ns)) out.merged.push({ ...x, server: r.id });
        Object.assign(out.sources, j.sources || {});
      }
      // The recordings a crowd was in, and how the deep analysis of each stands. One that never finished on the server that filmed
      // it (it stopped first) and has since been analysed in full on another (carried on there by itself, or chosen as a previous
      // recording): that analysis stands in its place, as it would have on the first server. What the live judge counted in that
      // stretch gives way to it, unless it counted fewer reps than the live judge did (then both stay listed).
      const reps = (list) => list.reduce((n, a) => n + (+a.reps || 0), 0);
      for (const d of deepStates(runs, from)) {
        const { later, wanted, earlier, ...entry } = d;
        if (later) {
          const a0 = Date.parse(d.startedAt) - 2000, a1 = Date.parse(d.endedAt);
          const live = out.athletes.filter((a) => a.src !== 'upload' && a.server === d.server && a.cam === d.cam && Date.parse(a.firstAt) >= a0 && Date.parse(a.firstAt) <= a1);
          if (reps(later) < reps(live)) entry.kept = 'fewer';
          else { entry.replaced = live.length; out.athletes = out.athletes.filter((a) => !live.includes(a)); }
        }
        out.deep.push(entry);
      }
      out.athletes.sort((x, y) => String(y.firstAt).localeCompare(String(x.firstAt)));
      out.numbers.sort((x, y) => String(y.firstAt).localeCompare(String(x.firstAt)));
      return reply(200, out);
    }
    if (a === 'track' && b && method === 'GET') {
      const m = /^([\w-]{1,80})~(\d{1,9})$/.exec(decodeURIComponent(String(b)));
      const row = m && await store.get(`${owned(await ownerOf(me))}:results`, m[1]);
      if (!row) return reply(404, { error: 'not found' });
      const out = { frames: [], events: [] };
      let text = '';
      try { const r = await fetchFn(signer({ blob: `${row.base}/tracks/${m[2]}.jsonl`, perm: 'r', minutes: READ_MINUTES })); if (r.ok) text = await r.text(); } catch { return reply(200, out); }
      for (const l of text.split('\n')) { if (!l) continue; try { const o = JSON.parse(l); if (o.f) out.frames.push(o.f); else if (o.e) out.events.push(o.e); } catch { /* cut short */ } }
      out.frames.sort((x, y) => x[0] - y[0]); out.events.sort((x, y) => x.t - y.t);
      return reply(200, out);
    }
    if (a === 'links') {
      if (!isAdmin(h)) return reply(403, { error: 'Only admins can link a Receiver for now' });
      // a Receiver an admin links saves into the organisation's recordings, which everyone in it sees
      if (!b && method === 'GET') return reply(200, { links: (await store.list(owned(await ownerOf(me)) + ':links')).map(({ id, name, at }) => ({ id, name, at })) });
      if (!b && method === 'POST') {
        const name = String(body?.name || '').trim().slice(0, 40) || 'Receiver';
        const id = crypto.randomBytes(5).toString('hex'), key = `rk_${crypto.randomBytes(24).toString('base64url')}`, hash = sha(key);
        await store.put('reckey', hash, { id, name, partition: owned(await ownerOf(me)) });
        await store.put(owned(await ownerOf(me)) + ':links', id, { id, name, at: now(), hash });
        return reply(200, { id, name, key }); // the only time the key is shown
      }
      if (b && method === 'DELETE') {
        const link = await store.get(owned(await ownerOf(me)) + ':links', b); if (!link) return reply(404, { error: 'not found' });
        await store.remove('reckey', link.hash); await store.remove(owned(await ownerOf(me)) + ':links', b);
        return reply(200, { ok: true });
      }
      return reply(405, { error: 'Not allowed' });
    }
    if (!a && method === 'GET') {
      const list = (await entries(owned(await ownerOf(me)))).sort((x, y) => y.startedAt.localeCompare(x.startedAt));
      return reply(200, {
        keepDays: KEEP_DAYS, used: list.reduce((n, r) => n + r.size, 0), limit: MAX_OWNER,
        recordings: list.slice(0, 2000).map((r) => ({ id: r.id, cam: r.cam, receiver: r.receiver, size: r.size, startedAt: r.startedAt, file: r.file,
          url: signer({ blob: r.blob, perm: 'r', minutes: READ_MINUTES }), download: signer({ blob: r.blob, perm: 'r', minutes: READ_MINUTES, download: r.file }) })),
      });
    }
    return reply(405, { error: 'Not allowed' });
  };
}

module.exports = { blobSigner, brandWriter, createRecordings, recordingsPartition, KEEP_DAYS, MAX_OWNER };
