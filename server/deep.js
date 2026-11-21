'use strict';
// Deep analysis of a crowd.
//
// A live judge has to keep up with its camera, so with a lot of people in view it follows only a few of them (measured on a real
// server, 20 November 2026: 9% of the real reps counted with 8–12 athletes in the picture). It can tell a crowd is there, though:
// its person finder sees them (app.js crowdTick), and it says so here. Every recording filmed while a crowd was in view is then
// analysed again in full once it's finished, in the background, as an uploaded video is (upload-jobs.js): every person looked for
// in every frame, which takes several times as long as the recording. Live judges come first, and more so than for a video someone
// uploaded and is waiting for: a deep analysis waits whenever anyone is in view of a camera being judged (sharing the graphics
// card halved a live judge's looks a second, measured), and carries on when the cameras are quiet.
//
// What the deep analysis finds is listed under the camera's recording, like a previous recording analysed later. When it's done,
// what the live judge counted in that stretch gives way to it (onDone decides, and says how many entries went).
const fs = require('fs');
const path = require('path');
const { fileStartMs } = require('./segments');

const JOIN_MS = 60e3;           // crowd reports this close together are one stretch
const ACTIVE = new Set(['preparing', 'queued', 'running', 'waiting']);

/**
 * What a camera's live judge counted in a stretch that has now been analysed again in full: the server's athletes (athletes) that
 * give way to the deep analysis of camera cam's recording from..to (ms), whose own athletes are the ones of `video`. A live entry
 * belongs to the recording it began in. If the deep analysis counted fewer reps than the live judge did there, something went
 * wrong with it and the live ones stay: { live: [], kept: 'fewer' }.
 */
function givesWay(athletes, cam, from, to, video) {
  const live = athletes.filter((a) => a.src === 'live' && a.cam === cam && !a.replaced && Date.parse(a.firstAt) >= from - 2000 && Date.parse(a.firstAt) <= to);
  const reps = (list) => list.reduce((n, a) => n + (a.reps || 0), 0);
  const deep = athletes.filter((a) => a.src === 'upload' && a.video === video);
  if (live.length && reps(deep) < reps(live)) return { live: [], kept: 'fewer' };
  return { live, kept: '' };
}

/**
 * dir: the recordings; uploadsDir: where videos to analyse go; jobs: upload-jobs; prepare(src, dst): makes the copy to analyse;
 * lateness(rel): how late a recording's clock runs (ms); onQueued(entry): the copy is ready; onDone(entry): the analysis finished,
 * returns { replaced, kept } (how many live entries gave way, or why they were kept); onStopped(entry): it ended without finishing
 * (what it had found so far is only part of the recording, and isn't to be listed beside the live counts).
 *
 * A recording from an earlier server of the same company whose deep analysis never finished there is carried on here (adopt):
 * fetched like any previous recording, and followed in the same list (earlier: true; its cam is the booking's camera number).
 */
function createDeep({ dir, uploadsDir, stateFile, jobs, quietMs, prepare, lateness = () => 0, camName = (n) => n, onQueued = () => {}, onDone = () => ({}), onStopped = () => {}, now = Date.now, log = () => {} }) {
  let state = { crowds: {}, files: {} };
  try { const s = JSON.parse(fs.readFileSync(stateFile, 'utf8')); state = { crowds: s.crowds || {}, files: s.files || {} }; } catch { /* none yet */ }
  // the server stopped while these were going: they can't carry on
  for (const f of Object.values(state.files)) if (ACTIVE.has(f.state)) { f.state = 'stopped'; f.why = 'The server stopped before it finished.'; }
  const save = () => { try { fs.writeFileSync(stateFile, JSON.stringify(state)); } catch (e) { log(`Saving the deep analysis list: ${e.message}`); } };
  let busy = false;

  /** A camera's judge sees a crowd now. */
  function note(cam, at = now()) {
    const list = state.crowds[cam] ||= [], last = list.at(-1);
    if (last && at - last[1] <= JOIN_MS) last[1] = Math.max(last[1], at); else list.push([at, at]);
    save();
  }
  const crowded = (cam, from, to) => (state.crowds[cam] || []).some(([a, b]) => a <= to && b >= from);

  function recordings() {
    const out = [];
    const walk = (d) => {
      let list = []; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of list) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!e.name.endsWith('.mp4')) continue;
        const rel = path.relative(dir, p).replace(/\\/g, '/'), cam = /station(\d+)/.exec(rel), named = fileStartMs(e.name);
        if (!cam || Number.isNaN(named)) continue;
        let st; try { st = fs.statSync(p); } catch { continue; }
        out.push({ p, rel, cam: +cam[1], file: e.name, start: Math.round(named - (lateness(rel) || 0)), end: Math.round(st.mtimeMs), size: st.size });
      }
    };
    walk(dir);
    return out.sort((a, b) => a.start - b.start);
  }
  const entry = (r) => {
    const at = new Date(r.start).toISOString().slice(0, 16).replace(/[:T]/g, '-'), cam = camName(r.cam);
    return { rel: r.rel, cam: r.cam, file: r.file, video: `${new Date(now()).toISOString().replace(/[:.]/g, '-')}_Camera_${cam}_${at}_deep.mp4`,
      name: `Camera ${cam} ${at.slice(11).replace('-', ':')} deep analysis`, start: r.start, end: r.end, state: 'preparing', pct: 0, at: now() };
  };

  /** Queues the finished recordings a crowd was in, and follows the ones being analysed. */
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      for (const r of recordings()) {
        if (state.files[r.rel] || !r.size || now() - r.end < quietMs || !crowded(r.cam, r.start, r.end)) continue;
        const f = state.files[r.rel] = entry(r);
        save();
        try {
          fs.mkdirSync(uploadsDir, { recursive: true });
          await prepare(r.p, path.join(uploadsDir, f.video));
          onQueued(f);
          jobs.add(f.video, f.name, { deep: true });
          f.state = 'queued';
          log(`Deep analysis queued: ${f.name}`);
        } catch (e) { f.state = 'failed'; f.why = `It couldn't be started: ${e.message}.`; log(`Deep analysis of ${f.name}: ${e.message}`); }
        save();
      }
      const list = jobs.list();
      let changed = false;
      for (const f of Object.values(state.files)) {
        if (!ACTIVE.has(f.state) || f.state === 'preparing') continue;
        const j = list.find((x) => x.video === f.video);
        if (!j) { f.state = 'stopped'; f.why = 'The server stopped before it finished.'; changed = true; continue; }
        if (j.state === 'done') {
          f.state = 'done'; f.pct = 100; f.doneAt = now();
          try { if (!f.earlier) Object.assign(f, onDone(f) || {}); } catch (e) { log(`Deep analysis of ${f.name}: ${e.message}`); }
          log(`Deep analysis finished: ${f.name}${f.replaced ? ` (${f.replaced} live entr${f.replaced === 1 ? 'y' : 'ies'} gave way to it)` : ''}`);
          changed = true;
        } else if (j.state === 'failed' || j.state === 'stopped') { f.state = j.state; f.why = j.why || ''; changed = true; try { onStopped(f); } catch { /* it stays listed */ } }
        else if (j.state !== f.state || j.pct !== f.pct) { f.state = j.state; f.pct = j.pct || 0; changed = true; }
      }
      if (changed) save();
    } finally { busy = false; }
  }

  /** The server's stopping: a recording a crowd was in that never got its turn is listed as not done, so the page can say so. */
  function close(why = 'The booking ended before it could be analysed in full.') {
    for (const r of recordings()) {
      // (one still being written runs up to now; a finished one that never had a crowd in it isn't listed)
      if (state.files[r.rel] || !r.size || !crowded(r.cam, r.start, now() - r.end < quietMs ? now() : r.end)) continue;
      state.files[r.rel] = { ...entry(r), video: '', state: 'stopped', why };
    }
    for (const f of Object.values(state.files)) if (ACTIVE.has(f.state)) { f.state = 'stopped'; f.why = f.why || why; }
    save();
  }

  /** A recording an earlier server filmed and never finished analysing, fetched here as `video`: it's queued and followed like the rest. */
  function adopt({ file, cam, startedAt, video }) {
    const key = `earlier:${file}`, start = Date.parse(startedAt);
    if (state.files[key] || !file || !video || Number.isNaN(start)) return false;
    const at = new Date(start).toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const f = state.files[key] = { rel: key, cam, file, video, name: `Camera ${cam} ${at.slice(0, 10)} ${at.slice(11).replace('-', ':')} deep analysis`, start, end: start, state: 'queued', pct: 0, at: now(), earlier: true };
    jobs.add(video, f.name, { deep: true });
    save();
    log(`Deep analysis carried on from an earlier server: ${f.name}`);
    return true;
  }

  return {
    note, tick, close, adopt,
    /** already being dealt with here (this server's own recording, or one carried on) */
    has: (file) => Object.values(state.files).some((f) => f.file === file),
    /** a crowd seen by this camera's judge in the last half minute */
    crowdNow: (cam) => { const last = (state.crowds[cam] || []).at(-1); return !!last && now() - last[1] < 30e3; },
    /** for the pages and the saved results: newest first */
    list: () => Object.values(state.files).sort((a, b) => b.start - a.start)
      .map(({ cam, file, video, name, start, end, state: s, pct, why, replaced, kept, earlier }) => ({ cam, file, video, name, startedAt: new Date(start).toISOString(), endedAt: new Date(end).toISOString(), state: s, pct: pct || 0, why: why || '', replaced: replaced || 0, kept: kept || '', ...(earlier ? { earlier: true } : {}) })),
    active: () => Object.values(state.files).some((f) => ACTIVE.has(f.state)),
  };
}

module.exports = { createDeep, givesWay, ACTIVE };
