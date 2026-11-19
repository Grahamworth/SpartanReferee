'use strict';
// The nightly backup (backup.js): everything but the servers' secrets and Spartan's events, gzipped, and the one from 31 days ago removed.
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { backup } = require('../src/backup');

test('the backup keeps the site\'s data, leaves out server secrets and events, and removes the one from 31 days ago', async () => {
  const rows = [
    { partitionKey: 'people:spartan', rowKey: 'ana@example.com', data: '{"email":"ana@example.com"}' },
    { partitionKey: 'assignment', rowKey: '10664|ana@example.com', data: '{}' },
    { partitionKey: 'server', rowKey: 'e10664', data: '{"secret":"x"}' },
    { partitionKey: 'serverkey', rowKey: 'abc', data: '{}' },
    { partitionKey: 'event', rowKey: '10664', data: '{}' },
  ];
  const calls = [];
  const doFetch = async (url, opt) => { calls.push({ url, method: opt.method, body: opt.body }); return { ok: true, status: 201 }; };
  const r = await backup({ connection: 'DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=' + Buffer.from('k').toString('base64'), listEntities: async function* () { yield* rows; }, doFetch, now: () => Date.parse('2026-11-19T03:30:00Z') });
  assert.strictEqual(r.name, 'tables/2026-11-19.json.gz'); assert.strictEqual(r.rows, 2);
  const saved = JSON.parse(zlib.gunzipSync(calls[0].body));
  assert.deepStrictEqual(saved.map((x) => x.partitionKey), ['people:spartan', 'assignment']);
  assert.match(calls[0].url, /^https:\/\/acct\.blob\.core\.windows\.net\/backups\/tables\/2026-11-19\.json\.gz\?.*sp=cw/);
  assert.strictEqual(calls[1].method, 'DELETE'); assert.match(calls[1].url, /tables\/2026-10-19\.json\.gz/);
});
