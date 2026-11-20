// How late each recording's own clock runs (server/segments.js), and recordings made ready for the website (server/faststart.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createSegments, fileStartMs } = require('../server/segments.js');
const { faststart } = require('../server/faststart.js');

// ---- a recording as the streaming server writes it: an index with no frames, then a part (moof + mdat) about once a second
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };
const box = (type, ...parts) => { const body = Buffer.concat(parts); return Buffer.concat([u32(body.length + 8), Buffer.from(type, 'latin1'), body]); };
const full = (type, v, flags, ...parts) => box(type, u32((v << 24) | flags), ...parts);
const VIDEO = 1, AUDIO = 2, VSCALE = 90000, ASCALE = 44100;
const trak = (id, scale, kind) => box('trak',
  full('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(0), Buffer.alloc(60)),
  box('mdia', full('mdhd', 0, 0, u32(0), u32(0), u32(scale), u32(0), u32(0)), full('hdlr', 0, 0, u32(0), Buffer.from(kind, 'latin1'), Buffer.alloc(13)),
    box('minf', box('stbl', full('stsd', 0, 0, u32(1), box(kind === 'vide' ? 'avc1' : 'mp4a', Buffer.alloc(20)))))));
const init = () => Buffer.concat([
  box('ftyp', Buffer.from('iso5', 'latin1'), u32(0), Buffer.from('iso5iso6', 'latin1')),
  box('moov', full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(0), Buffer.alloc(80)), trak(VIDEO, VSCALE, 'vide'), trak(AUDIO, ASCALE, 'soun'),
    box('mvex', full('trex', 0, 0, u32(VIDEO), u32(1), u32(0), u32(0), u32(0)), full('trex', 0, 0, u32(AUDIO), u32(1), u32(0), u32(0), u32(0)))),
]);
// One part. tracks: [{ id, at (in the track's clock), frames: [{ dur, bytes, key }] }]. Every frame's bytes are its own, so where each ends up can be checked.
function part(seq, tracks) {
  const build = (offsets) => box('moof', full('mfhd', 0, 0, u32(seq)), ...tracks.map((t, i) => box('traf',
    full('tfhd', 0, 0x020000, u32(t.id)), full('tfdt', 1, 0, u64(t.at)),
    full('trun', 0, 0x701, u32(t.frames.length), u32(offsets[i]), ...t.frames.flatMap((f) => [u32(f.dur), u32(f.bytes.length), u32(f.key ? 0x02000000 : 0x01010000)])))));
  const size = build(tracks.map(() => 0)).length, offsets = []; let at = size + 8;
  for (const t of tracks) { offsets.push(at); at += t.frames.reduce((n, f) => n + f.bytes.length, 0); }
  return Buffer.concat([build(offsets), box('mdat', ...tracks.flatMap((t) => t.frames.map((f) => f.bytes)))]);
}
const frames = (tag, n, dur, keyEvery = 0) => Array.from({ length: n }, (_, i) => ({ dur, bytes: Buffer.from(`${tag}${i}|`.padEnd(12, '.')), key: !keyEvery || i % keyEvery === 0 }));
// second s of a recording: 30 pictures and a second of sound
const second = (s, { lastDur } = {}) => { const v = frames(`v${s}-`, 30, 3000, 30); if (lastDur != null) v.at(-1).dur = lastDur; return part(s + 1, [{ id: VIDEO, at: s * VSCALE, frames: v }, { id: AUDIO, at: s * ASCALE, frames: frames(`a${s}-`, 43, 1024) }]); };

const NAME = '2026-11-20_08-31-52-276975Z.mp4', START = Date.parse('2026-11-20T08:31:52.276Z') + 0.975;
function folder() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'timing-')), cam = path.join(root, 'rec', 'live', 'station2');
  fs.mkdirSync(cam, { recursive: true });
  return { root, dir: path.join(root, 'rec'), cam, stateFile: path.join(root, 'timing.json') };
}
const touch = (p, ms) => fs.utimesSync(p, ms / 1000, ms / 1000);

test('a recording\'s start is read from its name to the microsecond, in this machine\'s time or UTC', () => {
  assert.ok(Math.abs(fileStartMs(NAME) - START) < 0.01);
  assert.equal(Math.round(fileStartMs('2026-11-06_09-00-00-500000+0100.mp4')), Date.parse('2026-11-06T08:00:00.500Z'));
  assert.ok(Number.isNaN(fileStartMs('holiday.mp4')));
});

test('a recording\'s lateness is measured as it\'s written: where its own clock has got to, against when each part arrived', () => {
  const f = folder(), p = path.join(f.cam, NAME), rel = `live/station2/${NAME}`;
  let clock = START;
  const seg = createSegments({ dir: f.dir, stateFile: f.stateFile, now: () => clock });
  fs.writeFileSync(p, init());
  // the phone's first two seconds arrive at once; after that a second of picture arrives each second, 2.2 s behind the recording's clock.
  // Parts held up on the way (the 3rd and 6th) only make it look smaller.
  for (let s = 0; s < 8; s++) {
    fs.appendFileSync(p, second(s));
    const arrived = START + (s + 1) * 1000 - 2200 + (s === 2 ? 180 : s === 5 ? 90 : 0);
    touch(p, arrived); clock = arrived + 40;
    seg.tick();
  }
  assert.ok(Math.abs(seg.latenessOf(rel) - 2200) <= 2, `measured ${seg.latenessOf(rel)}`);
  // a moment that really happened at T is 2.2 s further into the recording
  assert.equal(seg.latenessAt(2, START + 5000), seg.latenessOf(rel));
  assert.equal(seg.latenessAt(2, START - 60000), 0, 'before anything was recorded');
  assert.equal(seg.latenessAt(1, START + 5000), 0, 'another camera');
  assert.equal(seg.latenessFrom(2, Date.parse('2026-11-20T08:31:52.276Z')), seg.latenessOf(rel), 'as the streaming server lists it');
});

test('a part that\'s only half written isn\'t counted until the rest arrives', () => {
  const f = folder(), p = path.join(f.cam, NAME), rel = `live/station2/${NAME}`;
  let clock = START;
  const seg = createSegments({ dir: f.dir, stateFile: f.stateFile, now: () => clock });
  const whole = second(0);
  fs.writeFileSync(p, Buffer.concat([init(), whole.subarray(0, whole.length - 200)]));
  touch(p, START + 500); clock = START + 520; seg.tick();
  assert.equal(seg.latenessOf(rel), 0);
  fs.appendFileSync(p, whole.subarray(whole.length - 200));
  touch(p, START + 700); clock = START + 720; seg.tick();
  assert.equal(seg.latenessOf(rel), 300);
});

test('the measurement is kept: a finished recording can\'t be measured again after a restart', async () => {
  const f = folder(), p = path.join(f.cam, NAME), rel = `live/station2/${NAME}`;
  let clock = START;
  const seg = createSegments({ dir: f.dir, stateFile: f.stateFile, now: () => clock });
  fs.writeFileSync(p, Buffer.concat([init(), second(0)]));
  touch(p, START - 800); clock = START - 780; seg.tick();
  assert.equal(seg.latenessOf(rel), 1800);
  await new Promise((r) => setTimeout(r, 1200));
  clock += 3600e3;
  const again = createSegments({ dir: f.dir, stateFile: f.stateFile, now: () => clock });
  again.tick();
  assert.equal(again.latenessOf(rel), 1800);
});

test('a recording never measured takes it from the one that carried on from it after a full 10 minutes; a short one that was cut off doesn\'t', () => {
  const f = folder();
  // 600.2 s long, and the next starts 598 s after it: its clock ran 2.2 s late
  const long = Buffer.concat([init(), part(1, [{ id: VIDEO, at: 0, frames: [{ dur: 600.2 * VSCALE, bytes: Buffer.from('x'), key: true }] }])]);
  const first = '2026-11-20_08-00-00-000000Z.mp4', next = '2026-11-20_08-09-58-000000Z.mp4';
  for (const n of [first, next]) { fs.writeFileSync(path.join(f.cam, n), long); touch(path.join(f.cam, n), Date.parse('2026-11-20T08:30:00Z')); }
  const seg = createSegments({ dir: f.dir, stateFile: f.stateFile, now: () => Date.parse('2026-11-20T09:00:00Z') });
  seg.tick();
  assert.equal(seg.latenessOf(`live/station2/${first}`), 2200);
  assert.equal(seg.latenessOf(`live/station2/${next}`), 0, 'nothing follows it');
  // a phone that dropped off after 20 s and came back 3 s later: nothing can be told from that
  const g = folder(), short = Buffer.concat([init(), part(1, [{ id: VIDEO, at: 0, frames: [{ dur: 20 * VSCALE, bytes: Buffer.from('x'), key: true }] }])]);
  for (const n of ['2026-11-20_08-00-00-000000Z.mp4', '2026-11-20_08-00-23-000000Z.mp4']) { fs.writeFileSync(path.join(g.cam, n), short); touch(path.join(g.cam, n), Date.parse('2026-11-20T08:30:00Z')); }
  const seg2 = createSegments({ dir: g.dir, stateFile: g.stateFile, now: () => Date.parse('2026-11-20T09:00:00Z') });
  seg2.tick();
  assert.equal(seg2.latenessOf('live/station2/2026-11-20_08-00-00-000000Z.mp4'), 0);
});

// ---- ready for the website: the same frames, with an index at the front
const boxesOf = (buf, from = 0, to = buf.length) => { const out = []; for (let p = from; p + 8 <= to;) { const n = buf.readUInt32BE(p); if (n < 8) break; out.push({ type: buf.toString('latin1', p + 4, p + 8), body: p + 8, end: p + n }); p += n; } return out; };
const dig = (buf, ...names) => { let b = null; for (const n of names) { b = (b ? boxesOf(buf, b.body, b.end) : boxesOf(buf)).find((x) => x.type === n); assert.ok(b, `no ${n}`); } return b; };
function track(buf, moov, nth) {
  const trakBox = boxesOf(buf, moov.body, moov.end).filter((b) => b.type === 'trak')[nth];
  const inside = (b, name) => boxesOf(buf, b.body, b.end).find((x) => x.type === name);
  const stbl = inside(inside(inside(trakBox, 'mdia'), 'minf'), 'stbl'), get = (name) => inside(stbl, name);
  const table = (name, width) => { const b = get(name); if (!b) return null; const n = buf.readUInt32BE(b.body + 4), out = []; for (let i = 0; i < n * width; i++) out.push(buf.readUInt32BE(b.body + 8 + i * 4)); return out; };
  const stsz = get('stsz'), sizes = []; for (let i = 0; i < buf.readUInt32BE(stsz.body + 8); i++) sizes.push(buf.readUInt32BE(stsz.body + 12 + i * 4));
  return { stts: table('stts', 2), stss: table('stss', 1), stsc: table('stsc', 3), stco: table('stco', 1), sizes, mdhdLength: buf.readUInt32BE(inside(inside(trakBox, 'mdia'), 'mdhd').body + 16), edts: inside(trakBox, 'edts') };
}

test('a recording goes to the website as an ordinary MP4: index first, every frame where the index says, nothing changed', async () => {
  const f = folder(), src = path.join(f.root, 'in.mp4'), dst = path.join(f.root, 'out.mp4');
  fs.writeFileSync(src, Buffer.concat([init(), second(0), second(1), second(2)]));
  const size = await faststart(src, dst), out = fs.readFileSync(dst);
  assert.equal(size, out.length);
  assert.deepEqual(boxesOf(out).map((b) => b.type), ['ftyp', 'moov', 'mdat'], 'the index comes before the pictures');
  const moov = dig(out, 'moov');
  assert.ok(!boxesOf(out, moov.body, moov.end).some((b) => b.type === 'mvex'), 'no longer marked as a recording in parts');
  const v = track(out, moov, 0), a = track(out, moov, 1);
  assert.deepEqual(v.stts, [90, 3000]); assert.equal(v.sizes.length, 90); assert.equal(v.mdhdLength, 270000);
  assert.deepEqual(v.stss, [1, 31, 61], 'a picture can start at each second');
  assert.equal(a.stss, null, 'sound can start anywhere'); assert.equal(a.sizes.length, 129);
  assert.deepEqual(v.stsc, [1, 30, 1]); assert.equal(v.stco.length, 3);
  // each run of frames is where the index says it is
  for (let s = 0; s < 3; s++) {
    assert.equal(out.toString('latin1', v.stco[s], v.stco[s] + 12), `v${s}-0|`.padEnd(12, '.'));
    assert.equal(out.toString('latin1', a.stco[s], a.stco[s] + 12), `a${s}-0|`.padEnd(12, '.'));
    assert.equal(out.toString('latin1', v.stco[s] + 29 * 12, v.stco[s] + 30 * 12), `v${s}-29|`.padEnd(12, '.'));
  }
  assert.equal(dig(out, 'moov', 'mvhd') && out.readUInt32BE(dig(out, 'moov', 'mvhd').body + 16), 3000, 'three seconds long');
  assert.equal(v.edts, undefined);
});

test('the last frame of a camera that stopped has no length: it gets the one before\'s, so a player shows it', async () => {
  const f = folder(), src = path.join(f.root, 'in.mp4'), dst = path.join(f.root, 'out.mp4');
  fs.writeFileSync(src, Buffer.concat([init(), second(0), second(1, { lastDur: 0 })]));
  await faststart(src, dst);
  const out = fs.readFileSync(dst), v = track(out, dig(out, 'moov'), 0);
  assert.deepEqual(v.stts, [60, 3000]); assert.equal(v.mdhdLength, 180000);
});

test('sound that starts a moment after the picture keeps its place', async () => {
  const f = folder(), src = path.join(f.root, 'in.mp4'), dst = path.join(f.root, 'out.mp4');
  const late = part(1, [{ id: VIDEO, at: 0, frames: frames('v', 30, 3000, 30) }, { id: AUDIO, at: 4410, frames: frames('a', 10, 1024) }]);
  fs.writeFileSync(src, Buffer.concat([init(), late]));
  await faststart(src, dst);
  const out = fs.readFileSync(dst), moov = dig(out, 'moov'), a = track(out, moov, 1), v = track(out, moov, 0);
  assert.equal(v.edts, undefined);
  const elst = boxesOf(out, a.edts.body, a.edts.end)[0];
  assert.equal(out.readUInt32BE(elst.body + 8), 100, 'a tenth of a second of nothing first'); assert.equal(out.readInt32BE(elst.body + 12), -1);
});

test('a recording cut short mid-part keeps every whole part; something that isn\'t a recording is refused and leaves nothing behind', async () => {
  const f = folder(), src = path.join(f.root, 'in.mp4'), dst = path.join(f.root, 'out.mp4');
  const third = second(2);
  fs.writeFileSync(src, Buffer.concat([init(), second(0), second(1), third.subarray(0, third.length - 50)]));
  await faststart(src, dst);
  assert.equal(track(fs.readFileSync(dst), dig(fs.readFileSync(dst), 'moov'), 0).sizes.length, 60);
  fs.writeFileSync(src, 'video');
  await assert.rejects(faststart(src, dst));
  assert.equal(fs.existsSync(dst), false);
});
