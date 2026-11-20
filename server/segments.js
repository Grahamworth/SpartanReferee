'use strict';
// How late each recording's own clock runs.
//
// The streaming server names a recording by when its first frame arrived, and a moment in it is that plus how far in. But when a phone
// connects, the couple of seconds it filmed while connecting arrive all at once, so from then on the recording's clock is that much
// ahead of when its frames really arrived (about 2 s, measured). The judge times what it sees by when frames arrive, so a skeleton
// drawn over the recording at "the same time" ran about 2 s ahead of the body. Recordings that carry on from an earlier one (every
// 10 minutes) are named by the streaming server's steadied clock, and are right.
//
// So each recording's lateness is measured while it's being written: the streaming server adds a part about once a second, at the
// moment the frame after it arrives. The file's time of last change is then that arrival, and the end of what's in the file says
// where the recording's clock thinks it is: the difference is the lateness. A frame held up on its way only ever makes it look
// smaller, so the largest of the last half minute is taken. It's kept on disk, as a finished recording can't be measured again.
const fs = require('fs');
const path = require('path');

/** A recording's start from its name (%Y-%m-%d_%H-%M-%S-%f%z: this machine's time with its offset, or Z), in ms with the fraction. */
function fileStartMs(file) {
  const m = /^(\d{4}-\d\d-\d\d)_(\d\d)-(\d\d)-(\d\d)-(\d{1,9})(Z|[+-]\d{2})(\d{2})?/.exec(path.basename(file));
  if (!m) return NaN;
  const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}${m[6] === 'Z' ? 'Z' : `${m[6]}:${m[7] || '00'}`}`);
  return t + Number(`0.${m[5]}`) * 1000;
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'mvex', 'moof', 'traf']);
/** The boxes in buf[from, to): [{ type, start, body, end }], going into the ones that only hold other boxes. */
function boxes(buf, from = 0, to = buf.length, out = [], depth = 0) {
  let p = from;
  while (p + 8 <= to) {
    let size = buf.readUInt32BE(p), head = 8;
    const type = buf.toString('latin1', p + 4, p + 8);
    if (size === 1) { if (p + 16 > to) break; size = Number(buf.readBigUInt64BE(p + 8)); head = 16; } else if (size === 0) size = to - p;
    if (size < head || p + size > to) break;
    out.push({ type, start: p, body: p + head, end: p + size, depth });
    if (CONTAINERS.has(type)) boxes(buf, p + head, p + size, out, depth + 1);
    p += size;
  }
  return out;
}

/** From a recording's moov: its video track (or its only track), that track's clock, and the lengths frames have unless a part says. */
function readMoov(buf) {
  const list = boxes(buf), tracks = [];
  let cur = null;
  for (const b of list) {
    if (b.type === 'trak') { cur = { id: 0, timescale: 0, video: false, defDur: 0 }; tracks.push(cur); }
    else if (b.type === 'tkhd' && cur) cur.id = buf.readUInt32BE(b.body + (buf[b.body] === 1 ? 20 : 12));
    else if (b.type === 'mdhd' && cur) cur.timescale = buf.readUInt32BE(b.body + (buf[b.body] === 1 ? 20 : 12));
    else if (b.type === 'hdlr' && cur) cur.video = buf.toString('latin1', b.body + 8, b.body + 12) === 'vide';
    else if (b.type === 'trex') { const t = tracks.find((x) => x.id === buf.readUInt32BE(b.body + 4)); if (t) t.defDur = buf.readUInt32BE(b.body + 12); }
  }
  return tracks.find((t) => t.video && t.timescale) || tracks.find((t) => t.timescale) || null;
}

/** Where a part (a moof) leaves the track: the end of its last frame, in the track's clock. null: nothing of that track in it. */
function partEnd(buf, track) {
  let end = null, mine = false, base = 0, defDur = track.defDur;
  for (const b of boxes(buf)) {
    if (b.type === 'tfhd') {
      const flags = buf.readUInt32BE(b.body) & 0xffffff;
      mine = buf.readUInt32BE(b.body + 4) === track.id; defDur = track.defDur;
      let p = b.body + 8; if (flags & 1) p += 8; if (flags & 2) p += 4;
      if (mine && (flags & 8)) defDur = buf.readUInt32BE(p);
    } else if (b.type === 'tfdt' && mine) {
      base = buf[b.body] === 1 ? Number(buf.readBigUInt64BE(b.body + 4)) : buf.readUInt32BE(b.body + 4);
      end = Math.max(end ?? 0, base);
    } else if (b.type === 'trun' && mine) {
      const flags = buf.readUInt32BE(b.body) & 0xffffff, n = buf.readUInt32BE(b.body + 4);
      let p = b.body + 8; if (flags & 1) p += 4; if (flags & 4) p += 4;
      const each = (flags & 0x100 ? 4 : 0) + (flags & 0x200 ? 4 : 0) + (flags & 0x400 ? 4 : 0) + (flags & 0x800 ? 4 : 0);
      if (flags & 0x100) { for (let i = 0; i < n && p + 4 <= b.end; i++, p += each) base += buf.readUInt32BE(p); } else base += n * defDur;
      end = Math.max(end ?? 0, base);
    }
  }
  return end;
}

const WINDOW = 30;            // parts looked back over (about half a minute)
const WRITING_MS = 5000;      // a file changed this recently is still being written
const JOIN_MS = 5000;         // a recording starting within this of the last one's end carries on from it...
const FULL_MS = 590e3;        // ...when that one ran its full 10 minutes (a shorter one ended because the phone dropped off)

/** dir: the recordings folder (…/live/stationN/*.mp4). stateFile: where the measurements are kept. */
function createSegments({ dir, stateFile, now = Date.now, log = () => {} }) {
  let known = {}; try { known = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* none yet */ }
  const open = new Map();     // rel → { pos, track, endMs, obs: [], size }
  const lengths = new Map();  // rel → how long a finished recording is, ms (read once)
  let saveT = null, lists = new Map(), listedAt = 0;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => fs.writeFile(stateFile, JSON.stringify(known), () => {}), 1000); saveT.unref?.(); };

  /** Each camera's recordings, oldest first: [{ rel, p, startMs }]. Listed again at most twice a second. */
  function files(cam) {
    if (now() - listedAt > 500 || !lists.size) {
      lists = new Map(); listedAt = now();
      let cams = []; try { cams = fs.readdirSync(path.join(dir, 'live'), { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { /* nothing recorded yet */ }
      for (const c of cams) {
        const n = +(/^station(\d+)$/.exec(c.name) || [])[1]; if (!n) continue;
        let names = []; try { names = fs.readdirSync(path.join(dir, 'live', c.name)); } catch { /* gone */ }
        lists.set(n, names.filter((f) => f.endsWith('.mp4')).map((f) => ({ rel: `live/${c.name}/${f}`, p: path.join(dir, 'live', c.name, f), startMs: fileStartMs(f) }))
          .filter((f) => Number.isFinite(f.startMs)).sort((a, b) => a.startMs - b.startMs));
      }
    }
    return lists.get(cam) || [];
  }

  // What's been added to a recording since last time: every whole part read, the track's end kept.
  function readOn(f, st, size) {
    const fd = fs.openSync(f.p, 'r');
    try {
      const head = Buffer.alloc(16);
      while (st.pos + 8 <= size) {
        if (fs.readSync(fd, head, 0, 16, st.pos) < 8) break;
        let len = head.readUInt32BE(0); const type = head.toString('latin1', 4, 8);
        if (len === 1) len = Number(head.readBigUInt64BE(8));
        if (len < 8 || st.pos + len > size) break; // not all written yet
        if (type === 'moov' || type === 'moof') {
          if (len > 8e6) throw new Error('not a recording');
          const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, st.pos);
          if (type === 'moov') st.track = readMoov(buf);
          else if (st.track) {
            // a part counts once its pictures are written too (the mdat after it)
            const next = st.pos + len;
            if (next + 8 > size || fs.readSync(fd, head, 0, 16, next) < 8) break;
            let mlen = head.readUInt32BE(0); if (mlen === 1) mlen = Number(head.readBigUInt64BE(8));
            if (head.toString('latin1', 4, 8) === 'mdat' && next + mlen > size) break;
            const end = partEnd(buf, st.track);
            if (end != null) st.endMs = (end / st.track.timescale) * 1000;
          }
        }
        st.pos += len;
      }
    } finally { fs.closeSync(fd); }
  }

  /** How long a recording is, ms (its last frame's end), reading through it once. */
  function lengthOf(f) {
    if (lengths.has(f.rel)) return lengths.get(f.rel);
    const st = { pos: 0, track: null, endMs: 0 };
    try { readOn(f, st, fs.statSync(f.p).size); } catch { /* unreadable: unknown */ }
    lengths.set(f.rel, st.endMs);
    return st.endMs;
  }

  /** Looks at what's being recorded. Call a few times a second. */
  function tick() {
    listedAt = 0;
    let cams = []; try { cams = fs.readdirSync(path.join(dir, 'live')).map((d) => +(/^station(\d+)$/.exec(d) || [])[1]).filter(Boolean); } catch { return; }
    for (const cam of cams) {
      const list = files(cam), f = list[list.length - 1]; if (!f) continue;
      let s; try { s = fs.statSync(f.p); } catch { continue; }
      if (now() - s.mtimeMs > WRITING_MS) { open.delete(f.rel); continue; }
      let st = open.get(f.rel);
      if (!st) { st = { pos: 0, track: null, endMs: 0, obs: [], size: 0 }; open.set(f.rel, st); for (const k of open.keys()) if (k !== f.rel && k.startsWith(`live/station${cam}/`)) open.delete(k); }
      if (s.size === st.size) continue;
      const before = st.endMs;
      try { readOn(f, st, s.size); } catch (e) { log(`Timing ${f.rel}: ${e.message}`); continue; }
      st.size = s.size;
      if (st.endMs === before) continue;
      // unchanged while it was read: the time it last changed is when that part was written
      let again; try { again = fs.statSync(f.p); } catch { continue; }
      if (again.size !== s.size || again.mtimeMs !== s.mtimeMs) continue;
      st.obs.push(f.startMs + st.endMs - s.mtimeMs);
      if (st.obs.length > WINDOW) st.obs.shift();
      const late = Math.round(Math.max(...st.obs));
      if (Math.abs(late - (known[f.rel] ?? 1e9)) >= 5) { known[f.rel] = late; save(); }
    }
    // forget recordings that have gone (kept a week)
    const have = new Set([...lists.values()].flat().map((x) => x.rel));
    for (const k of Object.keys(known)) if (!have.has(k)) { delete known[k]; lengths.delete(k); save(); }
  }

  /** How late a recording's clock runs, ms. One never measured (made before this, or while the server restarted): from the recording
   *  that carried on from it, whose name says when the first one really ended; failing that, 0. */
  function lateness(f, list) {
    if (known[f.rel] != null) return known[f.rel];
    const next = list[list.indexOf(f) + 1];
    if (!next || open.has(f.rel)) return 0;
    const len = lengthOf(f), gap = f.startMs + len - next.startMs;
    const late = len > FULL_MS && Math.abs(gap) < JOIN_MS ? Math.round(gap) : 0;
    known[f.rel] = late; save();
    return late;
  }

  return {
    tick,
    /** by its path within the recordings folder (live/stationN/name.mp4) */
    latenessOf(rel) { const cam = +(/station(\d+)/.exec(rel) || [])[1], list = files(cam), f = list.find((x) => x.rel === rel); return f ? lateness(f, list) : 0; },
    /** the recording a moment (when it really happened, ms) is in, and how late that recording runs: add it to ask the streaming server */
    latenessAt(cam, at) {
      const list = files(cam); let late = 0;
      for (const f of list) { const l = lateness(f, list); if (f.startMs - l <= at) late = l; else break; }
      return late;
    },
    /** for a recording the streaming server lists by its start (ms) */
    latenessFrom(cam, startMs) { const list = files(cam), f = list.find((x) => Math.abs(x.startMs - startMs) < 2); return f ? lateness(f, list) : 0; },
  };
}

module.exports = { createSegments, fileStartMs, boxes, readMoov, partEnd };
