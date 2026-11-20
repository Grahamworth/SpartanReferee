'use strict';
// A recording made ready to play from the website.
//
// The streaming server writes each recording as it goes, a second at a time (fragmented MP4): nothing in it says how long it is or
// where each second starts, so a browser playing it from cloud storage reads the whole file before it shows a frame (540 MB for a
// 10-minute recording, measured). This writes the same pictures and sound, byte for byte, as an ordinary MP4 with its index at the
// front, so a browser reads the index and then only the part being watched, and any player opens a downloaded copy.
//
// Two passes, neither holding the recording in memory: the first reads only the headers of each part, the second writes the index
// and copies the pictures across.
const fs = require('fs');
const { once } = require('events');

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };
const box = (type, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'latin1'), body]); };
const full = (type, version, flags, ...parts) => box(type, u32(((version & 255) << 24) | (flags & 0xffffff)), ...parts);

/** The boxes directly inside buf[from, to): [{ type, start, body, end }]. */
function children(buf, from = 0, to = buf.length) {
  const out = []; let p = from;
  while (p + 8 <= to) {
    let size = buf.readUInt32BE(p), head = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(p + 8)); head = 16; } else if (size === 0) size = to - p;
    if (size < head || p + size > to) throw new Error('a box runs past its end');
    out.push({ type: buf.toString('latin1', p + 4, p + 8), start: p, body: p + head, end: p + size });
    p += size;
  }
  return out;
}
const find = (buf, list, type) => list.find((b) => b.type === type);
const raw = (buf, b) => buf.subarray(b.start, b.end);

// What the index needs from each part: every frame's size, length, whether a picture can start there, and where its bytes are.
function readPart(buf, moofAt, tracks) {
  for (const traf of children(buf, 8).filter((b) => b.type === 'traf')) {
    const inside = children(buf, traf.body, traf.end), tfhd = find(buf, inside, 'tfhd');
    if (!tfhd) throw new Error('a part without its header');
    const tf = buf.readUInt32BE(tfhd.body) & 0xffffff, t = tracks.get(buf.readUInt32BE(tfhd.body + 4));
    if (!t) continue;
    let p = tfhd.body + 8, base = moofAt;
    if (tf & 1) { base = Number(buf.readBigUInt64BE(p)); p += 8; }
    if (tf & 2) p += 4;
    let dur = t.defDur, size = t.defSize, flags = t.defFlags;
    if (tf & 8) { dur = buf.readUInt32BE(p); p += 4; }
    if (tf & 0x10) { size = buf.readUInt32BE(p); p += 4; }
    if (tf & 0x20) flags = buf.readUInt32BE(p);
    const tfdt = find(buf, inside, 'tfdt');
    if (tfdt && !t.samples) { t.firstAt = buf[tfdt.body] === 1 ? Number(buf.readBigUInt64BE(tfdt.body + 4)) : buf.readUInt32BE(tfdt.body + 4); }
    let next = null; // where the next run's bytes start when it doesn't say
    for (const trun of inside.filter((b) => b.type === 'trun')) {
      const version = buf[trun.body], f = buf.readUInt32BE(trun.body) & 0xffffff, n = buf.readUInt32BE(trun.body + 4);
      let q = trun.body + 8, at;
      if (f & 1) { at = base + buf.readInt32BE(q); q += 4; } else if (next != null) at = next; else throw new Error('a part that doesn\'t say where its pictures are');
      let first = null; if (f & 4) { first = buf.readUInt32BE(q); q += 4; }
      t.chunks.push({ at, n });
      for (let i = 0; i < n; i++) {
        const d = f & 0x100 ? buf.readUInt32BE(q) : dur; if (f & 0x100) q += 4;
        const s = f & 0x200 ? buf.readUInt32BE(q) : size; if (f & 0x200) q += 4;
        let fl = i === 0 && first != null ? first : flags; if (f & 0x400) { fl = buf.readUInt32BE(q); q += 4; }
        let off = 0; if (f & 0x800) { off = version === 0 ? buf.readUInt32BE(q) : buf.readInt32BE(q); q += 4; }
        t.durs.push(d); t.sizes.push(s); t.offs.push(off); if (off) t.anyOff = true;
        if (!(fl & 0x10000)) t.syncs.push(t.samples + 1); else t.anyNonSync = true;
        t.samples++; t.length += d; at += s;
      }
      next = at;
    }
  }
}

// the frame tables for one track; chunk offsets are filled in once the index's size is known
function tables(t, wide) {
  const runs = (list) => { const out = []; for (const v of list) { const last = out[out.length - 1]; if (last && last[1] === v) last[0]++; else out.push([1, v]); } return out; };
  const stts = runs(t.durs), ctts = t.anyOff ? runs(t.offs) : null;
  const neg = ctts && ctts.some((r) => r[1] < 0);
  const stsc = []; t.chunks.forEach((c, i) => { const last = stsc[stsc.length - 1]; if (!last || last[1] !== c.n) stsc.push([i + 1, c.n]); });
  const out = [
    full('stts', 0, 0, u32(stts.length), ...stts.flatMap(([n, d]) => [u32(n), u32(d)])),
    ...(ctts ? [full('ctts', neg ? 1 : 0, 0, u32(ctts.length), ...ctts.flatMap(([n, o]) => { const b = Buffer.alloc(8); b.writeUInt32BE(n); if (neg) b.writeInt32BE(o, 4); else b.writeUInt32BE(o, 4); return [b]; }))] : []),
    ...(t.video && t.anyNonSync ? [full('stss', 0, 0, u32(t.syncs.length), ...t.syncs.map(u32))] : []),
    full('stsc', 0, 0, u32(stsc.length), ...stsc.flatMap(([first, n]) => [u32(first), u32(n), u32(1)])),
    full('stsz', 0, 0, u32(0), u32(t.sizes.length), Buffer.concat(t.sizes.map(u32))),
  ];
  const co = full(wide ? 'co64' : 'stco', 0, 0, u32(t.chunks.length), Buffer.alloc(t.chunks.length * (wide ? 8 : 4)));
  t.coAt = out.reduce((n, b) => n + b.length, 0) + 16; // within the tables, past stco's own header and count
  return Buffer.concat([...out, co]);
}

// a header box with its length set (and the same otherwise): mvhd, tkhd or mdhd
function withLength(buf, b, type, length) {
  const out = Buffer.from(raw(buf, b)), v1 = out[8] === 1, head = 8;
  const at = type === 'tkhd' ? head + (v1 ? 28 : 20) : head + (v1 ? 24 : 16);
  if (v1) out.writeBigUInt64BE(BigInt(Math.round(length)), at); else out.writeUInt32BE(Math.min(0xffffffff, Math.round(length)), at);
  return out;
}

/** Writes src (a recording as the streaming server made it) to dst as an ordinary MP4, index first. Resolves with dst's size.
 *  Rejects, leaving nothing behind, on anything it doesn't understand: the caller sends the recording as it is. */
async function faststart(src, dst) {
  const fd = await fs.promises.open(src, 'r');
  let out = null;
  try {
    const size = (await fd.stat()).size, head = Buffer.alloc(16);
    let pos = 0, moov = null; const tracks = new Map(), data = []; // data: [start, end) of each part's pictures and sound, as they are in src
    while (pos + 8 <= size) {
      await fd.read(head, 0, 16, pos);
      let len = head.readUInt32BE(0), hl = 8; const type = head.toString('latin1', 4, 8);
      if (len === 1) { len = Number(head.readBigUInt64BE(8)); hl = 16; } else if (len === 0) len = size - pos;
      if (len < hl || pos + len > size) break; // cut short (the server stopped mid-write): what's whole is kept
      if (type === 'moov' || type === 'moof') {
        if (len > 64e6) throw new Error('an index too big to be one');
        const buf = Buffer.alloc(len); await fd.read(buf, 0, len, pos);
        if (type === 'moov') {
          moov = buf;
          const top = children(buf, 8), mvex = find(buf, top, 'mvex');
          for (const trak of top.filter((b) => b.type === 'trak')) {
            const inside = children(buf, trak.body, trak.end), tkhd = find(buf, inside, 'tkhd'), mdia = find(buf, inside, 'mdia');
            const mi = children(buf, mdia.body, mdia.end), mdhd = find(buf, mi, 'mdhd'), hdlr = find(buf, mi, 'hdlr');
            const id = buf.readUInt32BE(tkhd.body + (buf[tkhd.body] === 1 ? 20 : 12));
            tracks.set(id, { id, trak, timescale: buf.readUInt32BE(mdhd.body + (buf[mdhd.body] === 1 ? 20 : 12)), video: buf.toString('latin1', hdlr.body + 8, hdlr.body + 12) === 'vide',
              defDur: 0, defSize: 0, defFlags: 0, durs: [], sizes: [], offs: [], syncs: [], chunks: [], samples: 0, length: 0, firstAt: 0, anyOff: false, anyNonSync: false });
          }
          for (const trex of mvex ? children(buf, mvex.body, mvex.end).filter((b) => b.type === 'trex') : []) {
            const t = tracks.get(buf.readUInt32BE(trex.body + 4));
            if (t) { t.defDur = buf.readUInt32BE(trex.body + 12); t.defSize = buf.readUInt32BE(trex.body + 16); t.defFlags = buf.readUInt32BE(trex.body + 20); }
          }
        } else if (moov) {
          // a part whose pictures weren't all written (the server stopped mid-write) isn't in the index: the recording ends before it
          const after = pos + len, next = Buffer.alloc(16);
          if (after + 8 > size) break;
          await fd.read(next, 0, 16, after);
          let dl = next.readUInt32BE(0); if (dl === 1) dl = Number(next.readBigUInt64BE(8)); else if (dl === 0) dl = size - after;
          if (next.toString('latin1', 4, 8) !== 'mdat' || after + dl > size) break;
          readPart(buf, pos, tracks);
        }
      } else if (type === 'mdat') data.push([pos + hl, pos + len]);
      pos += len;
    }
    const used = [...tracks.values()].filter((t) => t.samples);
    // the last frame written when a camera stops has no length: it gets the one before's, or a player would drop it
    for (const t of used) { const n = t.durs.length; if (n > 1 && !t.durs[n - 1]) { t.durs[n - 1] = t.durs[n - 2]; t.length += t.durs[n - 2]; } }
    if (!moov || !used.length || !data.length) throw new Error('not a recording in parts');
    // every frame's bytes must be inside a part's data, which is copied whole and in order: where each lands in dst
    const total = data.reduce((n, [a, b]) => n + (b - a), 0);
    const landed = []; { let at = 0; for (const [a, b] of data) { landed.push(at); at += b - a; } }
    const place = (at) => { let lo = 0, hi = data.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (data[m][0] <= at) lo = m; else hi = m - 1; } if (at < data[lo][0] || at >= data[lo][1]) throw new Error('a frame outside its part'); return landed[lo] + at - data[lo][0]; };

    const top = children(moov, 8), mvhd = find(moov, top, 'mvhd');
    const movieScale = moov.readUInt32BE(mvhd.body + (moov[mvhd.body] === 1 ? 20 : 12));
    const toMovie = (t, n) => (n * movieScale) / t.timescale;
    const build = (wide) => {
      const traks = used.map((t) => {
        const inside = children(moov, t.trak.body, t.trak.end);
        const lead = toMovie(t, t.firstAt), long = toMovie(t, t.length);
        const kids = inside.filter((b) => b.type !== 'edts').map((b) => {
          if (b.type === 'tkhd') return withLength(moov, b, 'tkhd', lead + long);
          if (b.type !== 'mdia') return raw(moov, b);
          return box('mdia', ...children(moov, b.body, b.end).map((m) => {
            if (m.type === 'mdhd') return withLength(moov, m, 'mdhd', t.length);
            if (m.type !== 'minf') return raw(moov, m);
            return box('minf', ...children(moov, m.body, m.end).map((x) => {
              if (x.type !== 'stbl') return raw(moov, x);
              const stsd = find(moov, children(moov, x.body, x.end), 'stsd');
              const tb = tables(t, wide);
              t.coIn = tb; // (filled in below, in place)
              return box('stbl', raw(moov, stsd), tb);
            }));
          }));
        });
        // a track that starts after the recording does (sound a moment after the picture) keeps its place
        const edts = Math.round(lead) > 0 ? [box('edts', full('elst', 0, 0, u32(2), u32(Math.round(lead)), u32(0xffffffff), u32(0x00010000), u32(Math.round(long)), u32(0), u32(0x00010000)))] : [];
        const at = kids.findIndex((k) => k.toString('latin1', 4, 8) === 'tkhd');
        kids.splice(at + 1, 0, ...edts);
        return box('trak', ...kids);
      });
      const length = Math.max(...used.map((t) => toMovie(t, t.firstAt + t.length)));
      return box('moov', withLength(moov, mvhd, 'mvhd', length), ...traks, ...top.filter((b) => !['mvhd', 'trak', 'mvex'].includes(b.type)).map((b) => raw(moov, b)));
    };
    const ftyp = box('ftyp', Buffer.from('isom', 'latin1'), u32(0x200), Buffer.from('isomiso2mp41', 'latin1'));
    let wide = false, index = build(false);
    if (ftyp.length + index.length + 16 + total > 0xffffffff) { wide = true; index = build(true); }
    const bigData = total + 8 > 0xffffffff, dataAt = ftyp.length + index.length + (bigData ? 16 : 8);
    // the chunk offsets, now that everything before the pictures has a size: found again in the finished index, track by track
    let from = 0;
    for (const t of used) {
      const at = index.indexOf(t.coIn, from); if (at < 0) throw new Error('lost a track\'s tables');
      t.chunks.forEach((c, i) => { const v = dataAt + place(c.at), p = at + t.coAt + i * (wide ? 8 : 4); if (wide) index.writeBigUInt64BE(BigInt(v), p); else index.writeUInt32BE(v, p); });
      from = at + t.coIn.length;
    }
    out = fs.createWriteStream(dst);
    const failed = new Promise((_, no) => out.once('error', no));
    const write = async (b) => { if (!out.write(b)) await Promise.race([once(out, 'drain'), failed]); };
    await write(ftyp); await write(index);
    await write(bigData ? Buffer.concat([u32(1), Buffer.from('mdat', 'latin1'), u64(total + 16)]) : Buffer.concat([u32(total + 8), Buffer.from('mdat', 'latin1')]));
    for (const [a, b] of data) {
      for (let p = a; p < b;) {
        const buf = Buffer.allocUnsafe(Math.min(4 << 20, b - p)), { bytesRead } = await fd.read(buf, 0, buf.length, p);
        if (!bytesRead) throw new Error('the recording got shorter while it was read');
        await write(bytesRead === buf.length ? buf : buf.subarray(0, bytesRead)); p += bytesRead;
      }
    }
    await Promise.race([new Promise((ok) => out.end(ok)), failed]);
    return dataAt + total;
  } catch (e) {
    if (out) { out.destroy(); }
    await fs.promises.rm(dst, { force: true }).catch(() => {});
    throw e;
  } finally { await fd.close(); }
}

module.exports = { faststart };
