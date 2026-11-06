// Counting reps by hand, to measure the AI judge: your marks against its reps. Pure logic, so it can be unit tested.
(function (root) {
  const WINDOW_MS = 1500; // a press and the AI's rep this close are the same rep

  // Pairs up two lists of times, nearest first, each used once.
  function pair(a, b, win) {
    const all = [];
    a.forEach((x, i) => b.forEach((y, j) => { const d = Math.abs(x.t - y.t); if (d <= win) all.push({ i, j, d }); }));
    all.sort((p, q) => p.d - q.d);
    const ai = new Map(), bi = new Map();
    for (const { i, j } of all) if (!ai.has(i) && !bi.has(j)) { ai.set(i, j); bi.set(j, i); }
    return { ai, bi };
  }

  // marks: yours, [{ t (ms into the video), type: 'rep' | 'norep' }]. events: the AI's, [{ t, type, reasons, assumed }].
  function compare(marks, events, win = WINDOW_MS) {
    const byTime = (x, y) => x.t - y.t;
    const yours = marks.filter((m) => m.type === 'rep').sort(byTime), yourNo = marks.filter((m) => m.type === 'norep').sort(byTime);
    const ai = events.filter((e) => e.type === 'rep').sort(byTime), aiNo = events.filter((e) => e.type === 'norep').sort(byTime);
    const reps = pair(yours, ai, win);
    const near = (list, t) => list.filter((x) => Math.abs(x.t - t) <= win).sort((p, q) => Math.abs(p.t - t) - Math.abs(q.t - t))[0];
    const items = [];
    yours.forEach((m, i) => {
      if (reps.ai.has(i)) { const e = ai[reps.ai.get(i)]; items.push({ t: m.t, kind: 'agree', aiT: e.t, assumed: e.assumed || [] }); return; }
      const no = near(aiNo, m.t);
      items.push({ t: m.t, kind: 'missed', note: no ? `The AI gave a no rep: ${(no.reasons || [])[0] || 'no reason saved'}` : 'The AI saw nothing here' });
    });
    ai.forEach((e, j) => {
      if (reps.bi.has(j)) return;
      items.push({ t: e.t, kind: 'extra', assumed: e.assumed || [], note: near(yourNo, e.t) ? 'You marked this a no rep' : 'You didn\'t mark anything here' });
    });
    const noReps = pair(yourNo, aiNo, win);
    const agree = items.filter((x) => x.kind === 'agree').length, missed = items.filter((x) => x.kind === 'missed').length, extra = items.filter((x) => x.kind === 'extra').length;
    return {
      yourReps: yours.length, aiReps: ai.length, yourNoReps: yourNo.length, aiNoReps: aiNo.length, noRepsAgree: noReps.ai.size,
      agree, missed, extra, score: agree + missed + extra ? agree / (agree + missed + extra) : null, items: items.sort(byTime),
    };
  }

  // Who the AI thought each counted person was: whoever agrees with them most, each AI athlete used once. A person whose
  // reps also landed on another AI athlete probably had the tracking swap between them.
  // counts: [{ id, marks }]. athletes: [{ n, label, bib, events }].
  function matchPeople(counts, athletes, win = WINDOW_MS) {
    const tries = [];
    for (const c of counts) for (const a of athletes) tries.push({ c, a, r: compare(c.marks, a.events, win) });
    tries.sort((x, y) => y.r.agree - x.r.agree || y.r.aiReps - x.r.aiReps);
    const out = new Map(), used = new Set();
    for (const t of tries) { if (out.has(t.c.id) || used.has(t.a.n) || !t.r.agree) continue; out.set(t.c.id, t); used.add(t.a.n); }
    return counts.map((c) => {
      const best = out.get(c.id);
      const also = tries.filter((t) => t.c === c && t.a !== best?.a && t.r.agree >= 2).map((t) => ({ label: t.a.label, bib: t.a.bib, agree: t.r.agree }));
      return { id: c.id, athlete: best ? best.a : null, result: best ? best.r : compare(c.marks, [], win), also };
    });
  }

  const api = { compare, matchPeople, WINDOW_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RepCount = api;
})(typeof window !== 'undefined' ? window : globalThis);
