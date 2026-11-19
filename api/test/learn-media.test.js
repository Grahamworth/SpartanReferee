'use strict';
// The narration file for the app's offline copy (media.narrationFile): made once by Azure AI Speech, then handed over as base64.
const test = require('node:test');
const assert = require('node:assert');
const { createMedia } = require('../src/learn/media');

const content = { content_id: 'C1', body: JSON.stringify({ slides: [{ narration: 'One throw.' }, { narration: '' }] }) };
function setup({ stored = 'ok' } = {}) {
  const asked = [];
  const db = { query: async (sql) => (/SUM\(chars\)/.test(sql) ? [{ n: 0 }] : []) };
  const doFetch = async (url, opts = {}) => {
    asked.push(`${opts.method || 'GET'} ${String(url).split('?')[0]}`);
    if (String(url).includes('tts.speech')) return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    if (opts.method === 'PUT') return { ok: true };
    return stored === 'ok' ? { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } : { ok: false, status: 403 };
  };
  const signer = ({ blob, perm }) => `https://store.example/learn-media/${blob}?sp=${perm}`;
  return { asked, media: createMedia({ db, speech: { key: 'k', region: 'uksouth' }, signer, doFetch }) };
}

test('a slide\'s narration comes back as the file itself, made by Azure and kept in storage first', async () => {
  const { media, asked } = setup();
  const b64 = await media.narrationFile(content, 0, 'en-GB-RyanNeural');
  assert.strictEqual(Buffer.from(b64, 'base64').toString('hex'), '010203');
  assert.ok(asked.some((a) => a.startsWith('POST https://uksouth.tts.speech')), 'made by Azure');
  assert.ok(asked.some((a) => a.startsWith('PUT https://store.example/learn-media/narration/c1/en-GB-RyanNeural/0-')), 'kept in storage');
  assert.ok(asked.at(-1).startsWith('GET https://store.example/learn-media/narration/'), 'and read back from there');
});
test('a slide with no narration, or storage refusing, is an error with a status (so the app reads that slide aloud itself)', async () => {
  await assert.rejects(setup().media.narrationFile(content, 1, 'en-GB-RyanNeural'), (e) => e.status === 404);
  await assert.rejects(setup({ stored: 'no' }).media.narrationFile(content, 0, 'en-GB-RyanNeural'), (e) => e.status === 502);
});
