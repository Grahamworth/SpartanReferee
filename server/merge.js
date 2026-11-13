'use strict';
// Two (or more) cameras filming the same athletes from different angles: each camera's AI judge counts on its own, and
// this puts each athlete's counts together. Pure logic, so it can be tested on its own.
//
// Which cameras film the same athletes is a setting (groups, e.g. [[1, 2]]). Within a group, an athlete on one camera
// is the same person as one on another when the same number was read on both, or, without a number, when their reps
// happen at the same moments (at least MIN_REPS each, most of them within a second of each other). The cameras' feeds
// can be a little apart in time (each has its own delay), so the gap between two cameras is found first: it's the
// same for everyone they film, so it's where most reps line up (from athletes matched by number, when there are any).
//
// The combined count: every rep either camera counted, a rep seen on both within WINDOW_MS counting once. So when one
// camera's view is blocked (someone walks in front), the other camera's reps fill the gap. A no rep counts only when
// neither camera counted a rep then.
const WINDOW_MS = 1200;     // a rep on each camera this close (after the gap between the feeds) is the same rep
const MAX_OFFSET_MS = 3000; // the feeds are no further apart than this
const MATCH_MS = 700;      // matching on timing: a rep on each camera this close (after the gap) is a rep seen on both
const MIN_REPS = 3;         // matching on timing alone needs this many reps on each camera ...
const MIN_SHARE = 0.6;      // ... and this share of the fewer of them seen on both

const usable = (bib) => !!bib && bib !== 'No number';
const timesOf = (a, kind) => (a[kind] || []).filter(Number.isFinite).slice().sort((x, y) => x - y);
// how many of xs have one of ys within the window, with ys moved by off
// (soft: each counts more the closer it is, so the gap found is where reps line up exactly, not just within the window)
function together(xs, ys, off, win = MATCH_MS, soft = false) {
  let i = 0, n = 0;
  for (const x of xs) {
    while (i < ys.length && ys[i] + off < x - win) i++;
    if (i < ys.length && Math.abs(ys[i] + off - x) <= win) { n += soft ? 1 - Math.abs(ys[i] + off - x) / win : 1; i++; }
  }
  return n;
}
// the gap between two cameras' feeds: where the most reps of these pairs of athletes line up
function bestOffset(pairs) {
  let best = { off: 0, n: -1 };
  for (let off = -MAX_OFFSET_MS; off <= MAX_OFFSET_MS; off += 100) {
    const n = pairs.reduce((s, [xs, ys]) => s + together(xs, ys, off, MATCH_MS, true), 0);
    if (n > best.n || (n === best.n && Math.abs(off) < Math.abs(best.off))) best = { off, n };
  }
  return best.off;
}
// one camera's times and another's (moved by off) as one list: two within the window are one
function union(xs, ys, off) {
  const all = [...xs.map((t) => ({ t, k: 0 })), ...ys.map((t) => ({ t: t + off, k: 1 }))].sort((p, q) => p.t - q.t);
  const out = [];
  for (const e of all) {
    const last = out[out.length - 1];
    if (last && e.t - last.t <= WINDOW_MS && !last.from.has(e.k)) { last.from.add(e.k); continue; }
    out.push({ t: e.t, from: new Set([e.k]) });
  }
  return out;
}
const overlaps = (a, b) => a.firstAt <= b.lastAt && b.firstAt <= a.lastAt;

/**
 * athletes: the server's records ({ n, src, cam, bib, firstAt, lastAt, reps, noReps, repTimes, noRepTimes }).
 * groups: lists of camera numbers that film the same athletes.
 * Returns [{ ns, cams, bib, reps, noReps, both, offsetMs, by, firstAt, lastAt }]: one per athlete seen on two cameras.
 */
function mergeAthletes(athletes, groups) {
  const out = [], used = new Set();
  for (const group of groups || []) {
    const cams = [...new Set(group.map(Number))].filter((c) => c > 0);
    if (cams.length < 2) continue;
    const live = athletes.filter((a) => a.src === 'live' && cams.includes(a.cam));
    // every pair of athletes on two different cameras of the group that could be one person, best first
    const pairs = [];
    for (const ca of cams) {
      for (const cb of cams) {
        if (ca >= cb) continue;
        const cand = [];
        for (const a of live) for (const b of live) if (a.cam === ca && b.cam === cb && overlaps(a, b)) cand.push({ a, b, ar: timesOf(a, 'repTimes'), br: timesOf(b, 'repTimes') });
        const sameNumber = cand.filter(({ a, b }) => usable(a.bib) && a.bib === b.bib);
        const off = bestOffset((sameNumber.length ? sameNumber : cand).map(({ ar, br }) => [ar, br]));
        for (const { a, b, ar, br } of cand) {
          const n = together(ar, br, off);
          if (sameNumber.some((x) => x.a === a && x.b === b)) { pairs.push({ a, b, off, score: 2 + n / 1000, by: 'number' }); continue; }
          if (usable(a.bib) && usable(b.bib)) continue; // two different numbers: two people
          const fewer = Math.min(ar.length, br.length);
          if (fewer < MIN_REPS || n < MIN_REPS || n / fewer < MIN_SHARE) continue;
          pairs.push({ a, b, off, score: n / fewer + n / 1000, by: 'timing' });
        }
      }
    }
    pairs.sort((p, q) => q.score - p.score);
    for (const { a, b, off, by } of pairs) {
      if (used.has(a.n) || used.has(b.n)) continue;
      used.add(a.n); used.add(b.n);
      const reps = union(timesOf(a, 'repTimes'), timesOf(b, 'repTimes'), off);
      // a camera that reported more reps than it gave times for (times kept from part way): count the difference too
      const missing = Math.max(0, (a.reps || 0) - timesOf(a, 'repTimes').length, (b.reps || 0) - timesOf(b, 'repTimes').length);
      const noReps = union(timesOf(a, 'noRepTimes'), timesOf(b, 'noRepTimes'), off)
        .filter((x) => !reps.some((r) => Math.abs(r.t - x.t) <= WINDOW_MS));
      out.push({
        ns: [a.n, b.n], cams: [a.cam, b.cam], bib: usable(a.bib) ? a.bib : usable(b.bib) ? b.bib : '',
        reps: reps.length + missing, noReps: noReps.length, both: reps.filter((r) => r.from.size > 1).length,
        counts: [a.reps || 0, b.reps || 0], offsetMs: off, by,
        firstAt: a.firstAt < b.firstAt ? a.firstAt : b.firstAt, lastAt: a.lastAt > b.lastAt ? a.lastAt : b.lastAt,
      });
    }
  }
  return out;
}

// what a groups setting can be: lists of 2 or more camera numbers, each camera in one list
function readGroups(v) {
  const seen = new Set(), out = [];
  for (const g of Array.isArray(v) ? v.slice(0, 20) : []) {
    const cams = [...new Set((Array.isArray(g) ? g : []).map((c) => Math.round(+c)).filter((c) => c >= 1 && c <= 99 && !seen.has(c)))];
    if (cams.length >= 2) { cams.forEach((c) => seen.add(c)); out.push(cams.sort((x, y) => x - y)); }
  }
  return out;
}

module.exports = { mergeAthletes, readGroups, WINDOW_MS };
