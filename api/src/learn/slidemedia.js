'use strict';
/* Pictures and videos for lesson slides (the lesson editor's picture box, 19 November 2026). Files go to the storage account's
   learn-media container under slides/, named by a random id, so a link to one can't be guessed. They come up in pieces through the
   API (the page can't write to storage itself), each piece a block of the blob, then the list of blocks makes the file: a long video
   is fine. A page shows them from GET learn/slide-media/<file>, which needs no sign-in (an <img> or <video> can't send one) and
   sends the browser on to a short-lived storage link.
     POST learn/slide-media             { name, size, programmeId }  ->  { file, chunk }   (editors)
     PUT  learn/slide-media/<file>/<n>  { data: base64 }             a piece, in order from 0
     POST learn/slide-media/<file>/done { pieces }                   the file is complete */
const crypto = require('node:crypto');

const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
const MAX = { image: 15e6, video: 500e6 }; // bytes
const CHUNK = 2500000; // a piece: under 4 MB as base64 in one request
const FILE = /^[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif|mp4|webm|mov)$/;
const blockId = (n) => Buffer.from(`piece-${String(n).padStart(6, '0')}`).toString('base64');
const EDITORS = ['global_admin', 'programme_owner', 'content_editor'];

function createSlideMedia(ctx, { signer = null, doFetch = (...a) => fetch(...a) } = {}) {
  const { reply, P } = ctx;
  const off = () => reply(503, { error: 'Uploads aren\'t set up here' });
  const kindOf = (ext) => (TYPES[ext] || '').split('/')[0];
  /** those who write content (for this programme, or any) may upload */
  const may = (w, pid) => (pid ? P.can(w.grants, 'content.draft', { programmeId: pid }) : false) || w.grants.some((g) => EDITORS.includes(g.role));
  async function start(w, b) {
    if (!signer) return off();
    if (!may(w, b?.programmeId)) return reply(403, { error: 'Only the programme\'s editors add pictures and videos' });
    const ext = String(b?.name || '').toLowerCase().split('.').pop(), kind = kindOf(ext), size = Number(b?.size) || 0;
    if (!kind) return reply(400, { error: 'That kind of file can\'t go on a slide: use a picture (JPG, PNG, WebP, GIF) or a video (MP4, WebM, MOV)' });
    if (size > MAX[kind]) return reply(413, { error: kind === 'image' ? 'Pictures can be up to 15 MB' : 'Videos can be up to 500 MB: for longer ones, use a YouTube link' });
    return reply(200, { file: `${crypto.randomUUID()}.${ext}`, kind, chunk: CHUNK });
  }
  async function piece(w, file, n, b) {
    if (!signer) return off();
    if (!may(w) || !FILE.test(file) || !/^\d{1,6}$/.test(n)) return reply(400, { error: 'Not a piece of an upload' });
    const data = Buffer.from(String(b?.data || ''), 'base64');
    if (!data.length || data.length > CHUNK) return reply(400, { error: 'That piece is empty or too big' });
    const r = await doFetch(`${signer({ blob: `slides/${file}`, perm: 'cw', minutes: 10 })}&comp=block&blockid=${encodeURIComponent(blockId(Number(n)))}`, { method: 'PUT', body: data });
    return r.ok ? reply(200, { ok: true }) : reply(502, { error: `Storage said ${r.status}` });
  }
  async function done(w, file, b) {
    if (!signer) return off();
    const pieces = Number(b?.pieces) || 0;
    if (!may(w) || !FILE.test(file) || pieces < 1 || pieces > 1000) return reply(400, { error: 'Not an upload' });
    const xml = `<?xml version="1.0" encoding="utf-8"?><BlockList>${Array.from({ length: pieces }, (_, i) => `<Latest>${blockId(i)}</Latest>`).join('')}</BlockList>`;
    const r = await doFetch(`${signer({ blob: `slides/${file}`, perm: 'cw', minutes: 10 })}&comp=blocklist`, { method: 'PUT', body: xml, headers: { 'x-ms-blob-content-type': TYPES[file.split('.').pop()] } });
    return r.ok ? reply(200, { file, type: kindOf(file.split('.').pop()) }) : reply(502, { error: `Storage said ${r.status}` });
  }
  /** a slide's file, for anyone with its link: sent on to a short-lived storage link */
  function serve(file) {
    if (!signer) return off();
    if (!FILE.test(file)) return reply(404, { error: 'No such file' });
    return { status: 302, body: null, headers: { Location: signer({ blob: `slides/${file}`, perm: 'r', minutes: 240 }), 'Cache-Control': 'private, max-age=3600' } };
  }
  async function route(w, method, parts, body) {
    const [, a, b, c] = parts;
    if (a !== 'slide-media') return null;
    if (!b && method === 'POST') return start(w, body);
    if (b && c === 'done' && method === 'POST') return done(w, b, body);
    if (b && c && method === 'PUT') return piece(w, b, c, body);
    return null;
  }
  return { route, serve };
}

module.exports = { createSlideMedia, FILE, TYPES, CHUNK };
