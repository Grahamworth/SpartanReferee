'use strict';
/* Cloud backup of the Receivers' recordings. A Receiver holds a key, never the storage password: for each finished
   recording it asks here for a short-lived link allowing that one file to be written, sends it straight to storage, then
   says it's done. Only the account that made the key sees the list, through links that run out after a few hours.
   Storage deletes recordings after KEEP_DAYS (a lifecycle rule on the storage account); the list here forgets them too. */
const crypto = require('node:crypto');

const KEEP_DAYS = 30;
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

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function createRecordings({ store, signer, now, reply, session, isAdmin }) {
  const owned = (uid) => `rec:${sha(uid).slice(0, 32)}`;
  async function byKey(h) {
    const key = String(h['x-receiver-key'] || '');
    return key ? store.get('reckey', sha(key)) : null;
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
      if (!Number.isInteger(cam) || cam < 1 || cam > 99) return reply(400, { error: 'Which camera?' });
      if (!/^[\w.+-]{1,100}\.mp4$/.test(file)) return reply(400, { error: 'That isn\'t a recording' });
      if (!(size > 0 && size <= MAX_FILE)) return reply(400, { error: 'That recording is too big' });
      const used = (await entries(link.partition)).reduce((n, r) => n + r.size, 0);
      if (used + size > MAX_OWNER) return reply(507, { error: 'Your cloud storage is full' });
      const blob = `${link.partition.slice(4)}/${link.id}/cam${cam}/${file}`;
      return reply(200, { blob, url: signer({ blob, perm: 'cw', minutes: WRITE_MINUTES }) });
    }
    if (a === 'done' && method === 'POST') {
      const link = await byKey(h); if (!link) return reply(401, { error: 'That Receiver key isn\'t recognised' });
      const blob = String(body?.blob || ''), m = /\/cam(\d{1,2})\/([\w.+-]{1,100}\.mp4)$/.exec(blob), size = Number(body?.size);
      if (!m || !blob.startsWith(`${link.partition.slice(4)}/${link.id}/`) || !(size > 0 && size <= MAX_FILE)) return reply(400, { error: 'That isn\'t your recording' });
      const when = Date.parse(body?.startedAt);
      const id = sha(blob).slice(0, 32);
      await store.put(link.partition, id, { id, blob, cam: +m[1], file: m[2], size, startedAt: new Date(Number.isNaN(when) ? now() : when).toISOString(), receiver: link.name, at: now() });
      return reply(200, { ok: true });
    }
    // ---- what the account holder does, signed in
    const me = session(h); if (!me) return reply(401, { error: 'Sign in to see cloud recordings' });
    if (a === 'links') {
      if (!isAdmin(h)) return reply(403, { error: 'Only admins can link a Receiver for now' });
      if (!b && method === 'GET') return reply(200, { links: (await store.list(owned(me.uid) + ':links')).map(({ id, name, at }) => ({ id, name, at })) });
      if (!b && method === 'POST') {
        const name = String(body?.name || '').trim().slice(0, 40) || 'Receiver';
        const id = crypto.randomBytes(5).toString('hex'), key = `rk_${crypto.randomBytes(24).toString('base64url')}`, hash = sha(key);
        await store.put('reckey', hash, { id, name, partition: owned(me.uid) });
        await store.put(owned(me.uid) + ':links', id, { id, name, at: now(), hash });
        return reply(200, { id, name, key }); // the only time the key is shown
      }
      if (b && method === 'DELETE') {
        const link = await store.get(owned(me.uid) + ':links', b); if (!link) return reply(404, { error: 'not found' });
        await store.remove('reckey', link.hash); await store.remove(owned(me.uid) + ':links', b);
        return reply(200, { ok: true });
      }
      return reply(405, { error: 'Not allowed' });
    }
    if (!a && method === 'GET') {
      const list = (await entries(owned(me.uid))).sort((x, y) => y.startedAt.localeCompare(x.startedAt));
      return reply(200, {
        keepDays: KEEP_DAYS, used: list.reduce((n, r) => n + r.size, 0), limit: MAX_OWNER,
        recordings: list.slice(0, 2000).map((r) => ({ id: r.id, cam: r.cam, receiver: r.receiver, size: r.size, startedAt: r.startedAt, file: r.file,
          url: signer({ blob: r.blob, perm: 'r', minutes: READ_MINUTES }), download: signer({ blob: r.blob, perm: 'r', minutes: READ_MINUTES, download: r.file }) })),
      });
    }
    return reply(405, { error: 'Not allowed' });
  };
}

module.exports = { blobSigner, createRecordings, KEEP_DAYS, MAX_OWNER };
