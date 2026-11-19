'use strict';
/* The nightly backup of the site's table data (from the review of 19 November 2026): the referee list, admins, assignments, bookings,
   accounts, recordings' index and the rest, as one gzipped JSON file in the storage account's private "backups" container, kept 30
   days. Left out: the servers' secrets (server, serverkey: a server is made afresh for each booking) and Spartan's events (synced
   again from Spartan). Restoring is in docs/runbook.md.
     backups/tables/YYYY-MM-DD.json.gz   [{ partitionKey, rowKey, data }]  */
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const SKIP = new Set(['server', 'serverkey', 'event']);
const KEEP_DAYS = 30, SAS_VERSION = '2022-11-02';

/** a short-lived link to one blob in the backups container, from the storage connection string */
function blobLink(connection, blob, perm, now = Date.now) {
  const part = (k) => (new RegExp(`(?:^|;)${k}=([^;]+)`).exec(connection) || [])[1] || '';
  const account = part('AccountName'), key = part('AccountKey');
  if (!account || !key) throw new Error('No storage account in the connection string');
  const stamp = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
  const start = stamp(now() - 5 * 60e3), end = stamp(now() + 15 * 60e3);
  const toSign = [perm, start, end, `/blob/${account}/backups/${blob}`, '', '', 'https', SAS_VERSION, 'b', '', '', '', '', '', '', ''].join('\n');
  const sig = crypto.createHmac('sha256', Buffer.from(key, 'base64')).update(toSign, 'utf8').digest('base64');
  return `https://${account}.blob.core.windows.net/backups/${blob}?${new URLSearchParams({ sv: SAS_VERSION, spr: 'https', st: start, se: end, sr: 'b', sp: perm, sig })}`;
}

/** backs the table up; returns { name, rows, bytes, removed } */
async function backup({ connection, listEntities, doFetch = fetch, now = Date.now }) {
  const rows = [];
  for await (const e of listEntities()) {
    const kind = String(e.partitionKey).split(':')[0];
    if (SKIP.has(e.partitionKey) || SKIP.has(kind)) continue;
    rows.push({ partitionKey: e.partitionKey, rowKey: e.rowKey, data: e.data });
  }
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const name = `tables/${day(now())}.json.gz`, body = zlib.gzipSync(JSON.stringify(rows));
  const put = await doFetch(blobLink(connection, name, 'cw', now), { method: 'PUT', body, headers: { 'x-ms-blob-type': 'BlockBlob', 'x-ms-blob-content-type': 'application/gzip' } });
  if (!put.ok) throw new Error(`Storage said ${put.status} saving the backup`);
  // the one from 31 days ago goes (a day missed leaves one behind: harmless)
  const old = `tables/${day(now() - (KEEP_DAYS + 1) * 864e5)}.json.gz`;
  const del = await doFetch(blobLink(connection, old, 'd', now), { method: 'DELETE' });
  return { name, rows: rows.length, bytes: body.length, removed: del.ok ? old : '' };
}

module.exports = { backup, blobLink, SKIP };
