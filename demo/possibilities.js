// AI Possibilities (demo/index.html, behind the subtle "AI Possibilities" button at the bottom): eight things the same cameras, AI
// judge and referee platform could grow into, each with a small looping animation. demo.js loads this the first time the area opens.
// Drawn, not filmed: the athletes, bibs, places, scores and times are invented.
import { G, sample, solve, figure } from '../learn/obstacle-anim.js';
import { SCENES } from '../learn/obstacle-scenes.js';
import { pose, objBox, bubble, f1 } from './demo.js';

const NONE = new Set();
const STILL = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const camT = (c, z = 1) => `translate(200 112) scale(${f1(c[2] * z)}) translate(${f1(-c[0])} ${f1(-c[1])})`;
const scene = (sc, s, P, extra = '') => `${sc.back(s, NONE, P, 0)}${figure(P)}${sc.front ? sc.front(s, NONE, P, 0) : ''}${extra}`;
const markAt = (tl, re) => tl.marks.find((m) => !m.kind && re.test(m.text))?.t ?? tl.end / 2;
const firstAt = (tl, ok) => { for (let t = 0; t < tl.end; t += 0.04) { const s = sample(tl, t); if (ok(s, solve(s))) return t; } return tl.end / 2; };
const typed = (text, since, cps = 48) => text.slice(0, Math.max(0, Math.floor(since * cps)));
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** the athlete's box, in world units */
const bbox = (P) => {
  const pts = [P.head, P.sh, P.hip, P.la[1], P.la[2], P.ra[1], P.ra[2], P.ll[1], P.ll[2], P.rl[1], P.rl[2]];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs) - 8, Math.min(...ys) - 12, Math.max(...xs) + 8, Math.max(...ys) + 4];
};
/** a race bib on the athlete's chest */
const bib = (P, no = '2076') => { const c = [(P.sh[0] + P.hip[0]) / 2, (P.sh[1] + P.hip[1]) / 2]; return `<g class="pBib"><rect x="${f1(c[0] - 6.5)}" y="${f1(c[1] - 4.5)}" width="13" height="9" rx="1.2"/><text x="${f1(c[0])}" y="${f1(c[1] + 1.6)}">${no}</text></g>`; };
/** show the parts of an HTML animation whose time has come (data-at), and hide those whose time is up (data-until) */
function atIn(root, t) {
  for (const e of root.querySelectorAll('[data-at]')) {
    const on = t >= +e.dataset.at && (!e.dataset.until || t < +e.dataset.until);
    if (e.classList.contains('in') !== on) e.classList.toggle('in', on);
  }
}
/** a live leaderboard: rows slide to their new places */
const ROW_H = 42;
const boardHtml = (rows) => `<div class="pBoard" style="height:${rows.length * ROW_H}px">${rows.map((r) => `<div class="pLb${r.me ? ' me' : ''}" data-id="${r.id}"><b class="pos"></b><span class="cc">${r.cc}</span><span class="who">${r.who}</span>${r.win ? '<span class="pWin"><i></i></span>' : ''}<b class="n"></b></div>`).join('')}</div>`;
function placeRows(board, order, vals, wins) {
  order.forEach((id, i) => {
    const r = board.querySelector(`[data-id="${id}"]`);
    const top = `${i * ROW_H}px`; if (r.style.top !== top) r.style.top = top;
    r.querySelector('.pos').textContent = i + 1;
    const n = r.querySelector('.n'), v = String(vals[id]); if (n.textContent !== v) n.textContent = v;
    if (wins) r.querySelector('.pWin i').style.width = `${wins[id]}%`;
  });
}

// ================================================================================================ 1 · the referee assistant and learning
const ASSIST = {
  len: 12, still: 9,
  init(el) {
    el.innerHTML = `<div class="pChat">
      <div class="pChatTop"><img src="../icons/spartanreferee/icon-192.png" alt=""><div><b>Referee Assistant</b><span>Knows the 2026 rules and the officiating handbook</span></div></div>
      <p class="pMsg me" data-at="0.4">The athlete put the atlas stone down on the way back. Is that allowed?</p>
      <p class="pMsg ai" data-at="1.7"><span class="pDots" aria-hidden="true"><i></i><i></i><i></i></span><span class="txt">Yes. The stone can be put down, but it must be picked up again from exactly the same spot. Rolling it is a fail. <span class="pRule">Rule 4.1.3</span></span></p>
      <div class="pLearn" data-at="5.6"><div><b>Learning · Atlas Carry</b><span>Quick check passed</span></div><div class="pBar"><i></i></div><small>Programme 80% done · 5-week streak · works with no signal</small></div>
    </div>`;
    this.ans = el.querySelector('.pMsg.ai');
  },
  draw(t) { atIn(this.el, t); this.ans.classList.toggle('typing', t < 3.3); },
};

// ================================================================================================ 2 · VAR: judged, written to the timing record
const VAR = {
  len: 11.5, still: 9.5,
  init(el) {
    el.innerHTML = `<div class="pVar">
      <div class="pRec"><div class="pRecHead"><b>Timing record · #2076</b><span>Elite · wave 1</span></div>
        <div class="pRow" data-at="0.5"><span>Atlas Carry</span><em class="ok">Pass</em><small>AI judged · 0:48</small></div>
        <div class="pRow" data-at="1.3"><span>Chain Carry</span><em class="bad">Fail · dragged</em><small>AI flagged · ▶ clip attached</small></div>
        <div class="pRow" data-at="2.1"><span>Rope Climb</span><em class="ok">Pass</em><small>AI judged · bell seen and heard</small></div>
        <div class="pRow pPen" data-at="7.4"><span>Chain Carry</span><em class="bad">Penalty added</em><small>Confirmed by the referee · clip kept for appeals</small></div>
      </div>
      <div class="pRef" data-at="2.9"><div class="obStage aiStage"><svg viewBox="0 0 400 225" role="img" aria-label="The flagged clip: the chain dragged along the ground"><g class="obWorld"></g></svg><span class="aiPhase bad">Clip for review · Chain Carry</span></div>
        <div class="pRefBar"><div><b>Referee's phone</b><span class="pRefState"></span></div><div class="pRefBtns" aria-hidden="true"><span>Overrule</span><span class="yes">Confirm</span></div></div></div>
    </div>`;
    this.sc = SCENES.chain(); this.tl = this.sc.fails[0];
    this.world = el.querySelector('.obWorld'); this.state = el.querySelector('.pRefState'); this.yes = el.querySelector('.yes');
  },
  draw(t) {
    atIn(this.el, t);
    const at = clamp((t - 2.9) / 4) * this.tl.end, s = sample(this.tl, at), P = solve(s);
    this.world.setAttribute('transform', camT(s.cam));
    this.world.innerHTML = scene(this.sc, s, P, `${pose(P, 'ATHLETE #2076', true)}${objBox(s.obj, 9, 'CHAIN ON THE GROUND', true)}`);
    const done = t >= 6.7, msg = t < 2.9 ? '' : done ? 'Confirmed: the penalty stands' : 'AI flag: chain dragged. Watching the clip…';
    if (this.state.textContent !== msg) this.state.textContent = msg;
    this.state.classList.toggle('done', done);
    this.yes.classList.toggle('on', t >= 6.4);
  },
};

// ================================================================================================ 3 · personal highlight reels
const SHOTS = [
  { sc: 'burpee', name: 'BURPEE ZONE', line: 'every rep counted', from: () => 0.1 },
  { sc: 'atlas', name: 'ATLAS CARRY', line: 'stone up, carried clean', from: (tl) => firstAt(tl, (s) => s.hold > 0.99) - 0.6 },
  { sc: 'rope', name: 'ROPE CLIMB', line: 'bell rung', from: (tl) => markAt(tl, /bell/i) - 1.7 },
  { sc: 'chain', name: 'CHAIN CARRY', line: 'the full loop', from: (tl) => firstAt(tl, (s) => s.hold > 0.99) },
];
const TILES = [[25, 24], [204, 24], [25, 126], [204, 126]], TW = 171, TH = 96;
const FILM = {
  len: 16.5, still: 8.4,
  init(el) {
    el.innerHTML = `<div class="obStage aiStage pFilm"><svg viewBox="0 0 400 225" role="img" aria-label="Animation: the AI finds one athlete on every camera by their bib and cuts their film"></svg></div><p class="pCap"></p>`;
    this.svg = el.querySelector('svg'); this.cap = el.querySelector('.pCap');
    this.shots = SHOTS.map((sh) => {
      const sc = SCENES[sh.sc](), tl = sc.good, a = clamp(sh.from(tl), 0, Math.max(0, tl.end - 2));
      const s = sample(tl, Math.min(tl.end, a + 0.8)), P = solve(s), b = bbox(P), c = s.cam;
      const toT = (x, y) => [200 + (x - c[0]) * c[2], 112 + (y - c[1]) * c[2]];
      return { ...sh, sc, tl, a, still: `<g class="obWorld" transform="${camT(c)}">${scene(sc, s, P, bib(P))}</g>`, box: [...toT(b[0], b[1]), ...toT(b[2], b[3])] };
    });
  },
  tile(i, x, y, w, h, found, t) {
    const sh = this.shots[i], [x0, y0, x1, y1] = sh.box, scan = 20 + ((t * 260 + i * 70) % 190);
    return `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 400 225"><rect class="pTileBg" width="400" height="225"/>${sh.still}
      ${found ? `<rect class="pFound" x="${f1(x0)}" y="${f1(y0)}" width="${f1(x1 - x0)}" height="${f1(y1 - y0)}" rx="6"/><rect class="pFoundTagBg" x="${f1(x0)}" y="${f1(y0 - 30)}" width="150" height="26" rx="5"/><text class="pFoundTag" x="${f1(x0 + 8)}" y="${f1(y0 - 11)}">BIB 2076 ✓</text>`
        : `<rect class="pDim" width="400" height="225"/><line class="pScan" x1="0" y1="${f1(scan)}" x2="400" y2="${f1(scan)}"/>`}
      <text class="pTileT" x="16" y="34">CAM ${[3, 11, 17, 24][i]} · ${sh.name}</text><rect class="pTileEdge${found ? ' on' : ''}" x="2" y="2" width="396" height="221" rx="12"/></svg>`;
  },
  draw(t) {
    let html, cap;
    if (t < 4.4) {
      const found = [0.8, 1.7, 2.6, 3.5].map((x) => t >= x);
      html = `<text class="pFilmT" x="200" y="16">SEARCHING EVERY CAMERA FOR BIB 2076</text>${TILES.map(([x, y], i) => this.tile(i, x, y, TW, TH, found[i], t)).join('')}`;
      cap = `Finding bib 2076 on every camera: ${found.filter(Boolean).length} of 4 obstacles so far…`;
    } else if (t < 5.8) {
      const k = clamp((t - 4.4) / 1.3);
      html = `<text class="pFilmT" x="200" y="62">CUTTING THE FILM</text>${this.shots.map((_, i) => this.tile(i, 22 + i * 92, 80, 86, 48, true, t)).join('')}
        <rect class="pProg" x="22" y="146" width="356" height="8" rx="4"/><rect class="pProgOn" x="22" y="146" width="${f1(356 * k)}" height="8" rx="4"/><text class="pFilmS" x="200" y="174">${Math.round(k * 100)}%</text>`;
      cap = 'Cutting the four clips into one film, with titles and music…';
    } else if (t < 13.8) {
      const i = Math.min(3, Math.floor((t - 5.8) / 2)), k = (t - 5.8) - i * 2, sh = this.shots[i];
      const s = sample(sh.tl, Math.min(sh.tl.end, sh.a + k)), P = solve(s), slide = Math.min(1, k / 0.35);
      html = `<rect class="pTileBg" width="400" height="225"/><g class="obWorld" transform="${camT(s.cam, 1 + 0.05 * k)}">${scene(sh.sc, s, P, bib(P))}</g>
        <rect class="pBars" width="400" height="16"/><rect class="pBars" y="209" width="400" height="16"/>
        <image href="../icons/spartanreferee/logo-red.png" x="12" y="24" width="22" height="22"/><text class="pFilmBrand" x="40" y="39">MY SPARTAN RACE</text>
        <g transform="translate(${f1(-170 * (1 - slide))} 0)"><rect class="pLower" x="0" y="162" width="196" height="38"/><rect class="pLowerEdge" x="0" y="162" width="4" height="38"/>
          <text class="pLowerT" x="12" y="179">#2076 · ${sh.name}</text><text class="pLowerS" x="12" y="193">${sh.line}</text></g>
        <rect class="pFlash" width="400" height="225" opacity="${f1(Math.max(0, 1 - k / 0.18) * (i ? 0.85 : 0))}"/>`;
      cap = `Playing #2076's film: shot ${i + 1} of 4.`;
    } else {
      html = `<rect class="pEnd" width="400" height="225"/><image href="../icons/spartanreferee/logo-red.png" x="176" y="30" width="48" height="48"/>
        <text class="pEndT" x="200" y="108">YOUR SPARTAN RACE</text><text class="pFilmS" x="200" y="128">#2076 · film 1:52</text>
        <circle class="pPlayC" cx="200" cy="164" r="20"/><path class="pPlayT" d="M194 153 L211 164 L194 175 Z"/><text class="pFilmS" x="200" y="206">Ready 4 minutes after the finish · tap to share</text>`;
      cap = "On the athlete's phone 4 minutes after the finish, ready to share.";
    }
    this.svg.innerHTML = html;
    if (this.cap.textContent !== cap) this.cap.textContent = cap;
  },
};

// ================================================================================================ 4 · the live broadcast, called by the AI
const SPEAKER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
const CAST = {
  init(el) {
    this.sc = SCENES.rope(); this.tl = this.sc.good;
    this.bell = markAt(this.tl, /bell/i);
    this.t0 = firstAt(this.tl, (s) => Math.min(s.lf[1], s.rf[1]) < G - 8);
    this.split = (this.bell - this.t0).toFixed(1);
    this.len = this.tl.end + 3; this.still = this.bell + 1.4;
    el.innerHTML = `<div class="obStage aiStage"><svg viewBox="0 0 400 225" role="img" aria-label="Animation: an elite heat broadcast with the AI's skeleton tracking, split time and commentary"><g class="obWorld"></g><g class="aiScreen"></g></svg></div>
      <div class="pCast"><p class="pSaid">${SPEAKER}<span><b>AI commentary</b> <span class="pSaidT"></span></span></p>
        <p class="pMini">Live leaderboard · win chance</p>${boardHtml([{ id: '2207', cc: 'US', who: '#2207', win: 1 }, { id: '3164', cc: 'GB', who: '#3164', win: 1, me: 1 }, { id: '1950', cc: 'AU', who: '#1950', win: 1 }])}</div>`;
    this.world = el.querySelector('.obWorld'); this.screen = el.querySelector('.aiScreen');
    this.said = el.querySelector('.pSaidT'); this.board = el.querySelector('.pBoard');
  },
  draw(t) {
    const at = Math.min(t, this.tl.end), s = sample(this.tl, at), P = solve(s), rung = t >= this.bell;
    this.world.setAttribute('transform', camT(s.cam));
    this.world.innerHTML = scene(this.sc, s, P, pose(P, rung ? `#3164 · ${this.split} s` : '#3164', false));
    const secs = t < this.t0 ? 0 : rung ? +this.split : t - this.t0;
    this.screen.innerHTML = `<rect class="pLive" x="8" y="8" width="42" height="15" rx="3"/><text class="pLiveT" x="29" y="19">● LIVE</text>
      <rect class="aiMapBg" x="53" y="8" width="104" height="15" rx="3"/><text class="aiMapT" x="60" y="18.2">ELITE · HEAT 2 · ROPE CLIMB</text>
      ${t >= this.t0 ? `<rect class="aiMapBg" x="300" y="8" width="92" height="${rung ? 36 : 24}" rx="6"/><text class="pSplitT" x="346" y="25">${secs.toFixed(1)} s</text>
        ${rung ? '<text class="pFast" x="346" y="38">FASTEST TODAY</text>' : ''}` : ''}`;
    const lines = [[0, 'Into the Rope Climb, and #3164 is second, two seconds down on the leader.'], [this.t0, 'Feet locked on the rope, and this is quick. Very quick…'], [this.bell, `Bell! ${this.split} seconds, the fastest climb of the day, and #3164 takes the lead!`]];
    const [from, text] = lines.filter(([a]) => t >= a).pop(), line = typed(text, t - from);
    if (this.said.textContent !== line) this.said.textContent = line;
    const k = clamp((t - this.bell) / 0.9), lead = k > 0.5;
    placeRows(this.board, lead ? ['3164', '2207', '1950'] : ['2207', '3164', '1950'],
      { 2207: '6:41', 3164: lead ? '6:39' : '6:43', 1950: '6:52' },
      { 2207: Math.round(lerp(46, 27, k)), 3164: Math.round(lerp(31, 61, k)), 1950: Math.round(lerp(23, 12, k)) });
  },
};

// ================================================================================================ 5 · the Spartan Score
const BENCH = [['Rope Climb', 63, '6.2 s · elite 3.9 s', 1], ['Burpees', 69, '18 a minute · elite 26'], ['Atlas Carry', 71, '0:58 · elite 0:41'], ['Chain Carry', 77, '1:34 · elite 1:12']];
const SCORE = {
  len: 12.5, still: 10,
  init(el) {
    el.innerHTML = `<div class="pScore">
      <div class="pRing"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="pRingBg" cx="60" cy="60" r="50"/><circle class="pRingFg" cx="60" cy="60" r="50" pathLength="100"/></svg><div><b class="pScoreN">0</b><span>Spartan Score<br>#2076</span></div></div>
      <div class="pBench"><p class="pMini">Speed and technique against the elites</p>
        ${BENCH.map(([n, w, v, weak], i) => `<div class="pBRow${weak ? ' weak' : ''}" data-at="${(2.4 + i * 0.5).toFixed(1)}"><span>${n}</span><div class="pBBar" style="--w:${w}%"><i></i></div><small>${v}${weak ? ' · <b>most to gain</b>' : ''}</small></div>`).join('')}
        <p class="pTech" data-at="4.6">Rope technique: <b>arms only</b>. Elites use a foot lock: about 2 s faster.</p></div>
      <div class="pPlan"><p class="pMini">The 4-week plan it builds</p><ol>
        <li data-at="5.8"><b>Week 1 · Rope:</b> foot-lock drills and dead hangs, to take 2 s off the climb</li>
        <li data-at="6.6"><b>Week 2 · Burpees:</b> paced sets of 8, to hold 22 a minute</li>
        <li data-at="7.4"><b>Weeks 3 and 4 · Carries:</b> heavy odd-object carries, then a test race</li>
        <li class="pNext" data-at="8.4">After the next race, the score shows what improved.</li></ol></div>
    </div>`;
    this.n = el.querySelector('.pScoreN'); this.ring = el.querySelector('.pRingFg');
  },
  draw(t) {
    atIn(this.el, t);
    const k = clamp((t - 0.3) / 1.9), v = Math.round(742 * (1 - (1 - k) ** 3));
    if (this.n.textContent !== String(v)) this.n.textContent = v;
    this.ring.style.strokeDashoffset = f1(100 - v / 10);
  },
};

// ================================================================================================ 6 · the at-home burpee judge
const HOME = {
  init(el) {
    const sc = this.sc = SCENES.burpee(), fail = sc.fails[0];
    this.reps = [sc.good, sc.good, fail, sc.good];
    this.starts = []; let at = 0; for (const r of this.reps) { this.starts.push(at); at += r.end; }
    this.fault = fail.marks.find((m) => m.kind === 'bad')?.t ?? fail.end / 2;
    this.len = at + 1.4; this.still = this.starts[2] + this.fault + 0.2;
    el.innerHTML = `<div class="pHome"><div class="pPhone"><div class="obStage aiStage"><svg viewBox="0 0 400 225" role="img" aria-label="Animation: a phone camera on the floor judging burpees at home"><g class="obWorld"></g><g class="aiScreen"></g></svg></div></div>
      <div><p class="pMini">Global burpee challenge · 5 minutes · live</p>${boardHtml([{ id: 'ae', cc: 'AE', who: 'Dubai · #5520' }, { id: 'fr', cc: 'FR', who: 'Lyon · #0931' }, { id: 'me', cc: 'GB', who: 'You', me: 1 }, { id: 'us', cc: 'US', who: 'Denver · #1187' }])}
        <p class="pNote">Judged to the Burpee Zone's standard: a no-rep doesn't count, wherever you are.</p></div></div>`;
    this.world = el.querySelector('.obWorld'); this.screen = el.querySelector('.aiScreen'); this.board = el.querySelector('.pBoard');
  },
  draw(t) {
    let i = this.reps.findIndex((r, j) => t < this.starts[j] + r.end); if (i < 0) i = this.reps.length - 1;
    const rep = this.reps[i], local = Math.min(rep.end, t - this.starts[i]), s = sample(rep, local), P = solve(s);
    const good = (j) => this.reps[j] !== this.reps[2];
    let count = 14, lastDone = -9;
    this.reps.forEach((r, j) => { const end = this.starts[j] + r.end; if (t >= end && good(j)) { count++; lastDone = end; } });
    const bad = i === 2 && local >= this.fault;
    this.world.setAttribute('transform', camT(s.cam));
    this.world.innerHTML = scene(this.sc, s, P, pose(P, bad ? 'NO-REP' : `REP ${count + 1}`, bad));
    this.screen.innerHTML = `<rect class="pLive" x="8" y="8" width="38" height="15" rx="3"/><text class="pLiveT" x="27" y="19">● REC</text>
      <rect class="aiMapBg" x="49" y="8" width="88" height="15" rx="3"/><text class="aiMapT" x="56" y="18.2">VIRTUAL QUALIFIER · ${mmss(212 - t)}</text>
      <rect class="aiMapBg" x="322" y="8" width="70" height="48" rx="8"/><text class="pCount" x="357" y="39">${count}</text><text class="aiMapT" x="357" y="50" text-anchor="middle">REPS</text>
      ${t - lastDone < 0.7 ? bubble(357, 76, '+1') : ''}${bad ? bubble(200, 30, 'NO-REP · CHEST NOT TO THE GROUND', 'bad') : ''}`;
    const vals = { ae: 16, fr: 15, me: count, us: 13 };
    placeRows(this.board, ['ae', 'fr', 'me', 'us'].sort((a, b) => vals[b] - vals[a] || (a === 'me') - (b === 'me')), vals);
  },
};

// ================================================================================================ 7 · safety and course ops, from above
const ROUTE2 = (f) => { const a = 2 * Math.PI * f; return [200 + 150 * Math.cos(a) + 22 * Math.cos(3 * a), 112 + 78 * Math.sin(a) + 14 * Math.sin(2 * a)]; };
const OBS = Array.from({ length: 12 }, (_, k) => (k + 0.5) / 12);
const Q7 = OBS[6], F9 = OBS[8], TENT = [200, 112];
const DOTS = Array.from({ length: 18 }, (_, i) => ({ f0: (i / 18 + 0.013 * Math.sin(i * 7) + 1) % 1, v: 0.026 + 0.014 * (((i * 37) % 10) / 10) }));
const SAFETY = {
  len: 13, still: 11,
  init(el) {
    el.innerHTML = `<div class="pMap"><svg viewBox="0 0 400 225" role="img" aria-label="Animation: the course from above, with a queue predicted at obstacle 7 and an athlete down at obstacle 9"></svg></div>
      <div class="pFeed">
        <p class="pAlert warn" data-at="2.4"><b>Obstacle 7 · queue building</b>A 6-minute wait is predicted in 10 minutes. Suggest opening the second lane.</p>
        <p class="pAlert bad" data-at="4.9"><b>Athlete down · obstacle 9</b>Fell from the wall and hasn't moved for 20 seconds (camera 9-B). The nearest medic is on the way, with the exact spot.</p>
        <p class="pAlert ok" data-at="9.4"><b>Medic with the athlete</b>1 minute 50 seconds after the fall.</p></div>`;
    this.svg = el.querySelector('svg');
    const pts = Array.from({ length: 201 }, (_, i) => ROUTE2(i / 200));
    this.track = pts.map((p) => `${f1(p[0])},${f1(p[1])}`).join(' ');
    const p = ROUTE2(F9), q = ROUTE2(F9 + 0.004), nx = -(q[1] - p[1]), ny = q[0] - p[0], nl = Math.hypot(nx, ny);
    this.down = [p[0] + (nx / nl) * 9, p[1] + (ny / nl) * 9];
  },
  draw(t) {
    const qs = clamp((t - 0.4) / 2.6), dt = 1 / 20, steps = Math.floor(t / dt);
    let queue = 0;
    const dots = DOTS.map(({ f0, v }) => {
      let f = f0;
      for (let n = 0; n < steps; n++) { const ahead = (((Q7 - f) % 1) + 1) % 1; f = (f + v * dt * (ahead < 0.08 ? 1 - qs * 0.88 * (1 - ahead / 0.08) : 1)) % 1; }
      const ahead = (((Q7 - f) % 1) + 1) % 1; if (ahead < 0.08) queue++;
      return ROUTE2(f);
    });
    const fallen = t >= 4.2, me = fallen ? this.down : ROUTE2(F9 - 0.05 + 0.0105 * t);
    const mk = clamp((t - 5.6) / 3.4), medic = [lerp(TENT[0], this.down[0] - 7, mk), lerp(TENT[1], this.down[1] - 5, mk)];
    const pulse = 7 + 5 * ((t * 1.6) % 1);
    this.svg.innerHTML = `<rect class="pTerrain" width="400" height="225"/>
      ${[[60, 40, 34], [330, 190, 40], [110, 190, 26], [352, 36, 28], [250, 150, 22]].map(([x, y, r]) => `<circle class="pWood" cx="${x}" cy="${y}" r="${r}"/>`).join('')}
      <polyline class="pTrack" points="${this.track}"/><polyline class="pTrackC" points="${this.track}"/>
      ${qs > 0 ? `<circle class="pQueue" cx="${f1(ROUTE2(Q7)[0])}" cy="${f1(ROUTE2(Q7)[1])}" r="${f1(8 + queue * 2.6 * qs)}"/>` : ''}
      <g class="pTent"><rect x="${TENT[0] - 16}" y="${TENT[1] - 10}" width="32" height="20" rx="3"/><path d="M${TENT[0]} ${TENT[1] - 6}v12M${TENT[0] - 6} ${TENT[1]}h12"/></g><text class="pMapL" x="${TENT[0]}" y="${TENT[1] + 21}">MEDICAL</text>
      ${OBS.map((f, k) => { const [x, y] = ROUTE2(f), cls = k === 6 && qs > 0.5 ? ' warn' : k === 8 && fallen ? ' bad' : ''; return `<circle class="pObs${cls}" cx="${f1(x)}" cy="${f1(y)}" r="6.5"/><text class="pObsN" x="${f1(x)}" y="${f1(y + 2.4)}">${k + 1}</text>`; }).join('')}
      ${dots.map(([x, y]) => `<circle class="pDot" cx="${f1(x)}" cy="${f1(y)}" r="2.6"/>`).join('')}
      ${fallen ? `<circle class="pPulse" cx="${f1(me[0])}" cy="${f1(me[1])}" r="${f1(pulse)}" opacity="${f1(1 - (pulse - 7) / 5)}"/>` : ''}
      <circle class="pDot${fallen ? ' down' : ''}" cx="${f1(me[0])}" cy="${f1(me[1])}" r="${fallen ? 3.4 : 2.6}"/>
      ${t >= 5.6 ? `<g class="pMedic"><circle cx="${f1(medic[0])}" cy="${f1(medic[1])}" r="5"/><path d="M${f1(medic[0])} ${f1(medic[1] - 3)}v6M${f1(medic[0] - 3)} ${f1(medic[1])}h6"/></g>` : ''}
      ${qs > 0.5 ? bubble(ROUTE2(Q7)[0] + 66, ROUTE2(Q7)[1] + 4, 'QUEUE PREDICTED', 'warn') : ''}
      ${fallen ? bubble(me[0], me[1] - 16, mk >= 1 ? 'MEDIC ON SCENE' : 'ATHLETE DOWN', mk >= 1 ? '' : 'bad') : ''}
      <rect class="aiMapBg" x="8" y="8" width="112" height="15" rx="3"/><text class="aiMapT" x="15" y="18.2">COURSE OPS · LIVE FROM 40 CAMERAS</text>`;
    atIn(this.el, t);
  },
};

// ================================================================================================ 8 · the 3D course
const HGT = (x, z) => 0.42 * Math.exp(-((x - 0.35) ** 2 + (z + 0.15) ** 2) / 0.16) + 0.25 * Math.exp(-((x + 0.55) ** 2 + (z - 0.45) ** 2) / 0.1) + 0.04 * Math.sin(4 * x + 1) * Math.cos(3 * z);
const ROUTE3 = (u) => { const a = 2 * Math.PI * u; return [0.72 * Math.cos(a) + 0.12 * Math.cos(3 * a), 0.62 * Math.sin(a) + 0.1 * Math.sin(2 * a)]; };
const N3 = 22, HS = 1.6, VS = 0.5, ELEV = (h) => Math.round(180 + h * VS * 1000); // km to a unit across, km to a unit up
const STOPS = [[44, 92, 58], [96, 136, 70], [172, 158, 104], [226, 220, 204]];
const tint = (k, sh) => { const x = clamp(k) * 3, i = Math.min(2, Math.floor(x)), f = x - i; return `rgb(${STOPS[i].map((c, j) => Math.round(lerp(c, STOPS[i + 1][j], f) * sh)).join(',')})`; };
const COURSE = {
  len: 26, still: 3,
  init(el) {
    el.innerHTML = `<div class="p3d"><svg viewBox="0 0 400 225" role="img" aria-label="Animation: the course in 3D, turning, with its hills, obstacles and athletes' live positions"></svg></div>
      <div class="pHud"><span class="pHudLive"></span></div>`;
    this.svg = el.querySelector('svg'); this.live = el.querySelector('.pHudLive');
    // the terrain: heights on a grid, each square's colour from its height and how it faces the light
    const V = []; for (let i = 0; i <= N3; i++) { V.push([]); for (let j = 0; j <= N3; j++) { const x = -1 + (2 * i) / N3, z = -1 + (2 * j) / N3; V[i].push([x, HGT(x, z), z]); } }
    const L = [-0.55, 0.8, -0.25], ll = Math.hypot(...L), cell = 2 / N3;
    this.quads = [];
    for (let i = 0; i < N3; i++) for (let j = 0; j < N3; j++) {
      const a = V[i][j], b = V[i + 1][j], c = V[i + 1][j + 1], d = V[i][j + 1];
      const dx = ((b[1] - a[1]) + (c[1] - d[1])) / 2 / cell, dz = ((d[1] - a[1]) + (c[1] - b[1])) / 2 / cell;
      const n = [-dx * 1.2, 1, -dz * 1.2], nl = Math.hypot(...n), lit = Math.max(0, (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / nl / ll);
      this.quads.push({ v: [a, b, c, d], fill: tint((a[1] + b[1] + c[1] + d[1]) / 4 / 0.45, 0.55 + 0.5 * lit) });
    }
    let top = V[0][0]; for (const row of V) for (const v of row) if (v[1] > top[1]) top = v;
    this.top = top;
    // the route: along the ground, its length, and the gradient of each piece
    const M = 180; this.route = []; let km = 0;
    for (let i = 0; i <= M; i++) { const [x, z] = ROUTE3(i / M), y = HGT(x, z); if (i) { const p = this.route[i - 1]; km += Math.hypot(x - p[0], z - p[2]) * HS; } this.route.push([x, y + 0.012, z, km]); }
    this.grad = this.route.slice(1).map((p, i) => { const q = this.route[i]; return ((p[1] - q[1]) * VS) / (p[3] - q[3]) * 100; });
    const sorted = [...this.grad].sort((a, b) => b - a), steep = sorted[Math.floor(sorted.length * 0.07)];
    this.steep = this.grad.map((g) => g >= steep);
    this.km = km; this.maxG = Math.round(sorted[0]);
    el.querySelector('.pHud').insertAdjacentHTML('afterbegin', `<span><b>${km.toFixed(1)} km</b> course</span><span><b>7</b> obstacles</span><span><b>${ELEV(top[1])} m</b> highest point</span><span class="steep"><b>${this.maxG}%</b> steepest climb</span>`);
  },
  draw(t) {
    const yaw = 0.5 + (t / this.len) * 2 * Math.PI, ca = Math.cos(yaw), sa = Math.sin(yaw), CE = Math.cos(0.6), SE = Math.sin(0.6);
    const P = ([x, y, z]) => { const xr = x * ca - z * sa, zr = x * sa + z * ca, Y = y * 1.5, d = zr * CE - Y * SE, k = 400 / (3.8 + d); return [200 + xr * k, 124 - (Y * CE + zr * SE) * k, d]; };
    const qs = this.quads.map((q) => { const p = q.v.map(P); return { p, d: (p[0][2] + p[1][2] + p[2][2] + p[3][2]) / 4, fill: q.fill }; }).sort((a, b) => b.d - a.d);
    const rp = this.route.map(P), pts = (a) => a.map((p) => `${f1(p[0])},${f1(p[1])}`).join(' ');
    let steep = ''; for (let i = 0; i < this.steep.length; i++) if (this.steep[i]) steep += `<line class="p3Steep" x1="${f1(rp[i][0])}" y1="${f1(rp[i][1])}" x2="${f1(rp[i + 1][0])}" y2="${f1(rp[i + 1][1])}"/>`;
    const pin = (u, label, cls = '') => { const p = rp[Math.round(u * (rp.length - 1))]; return `<g class="p3Pin${cls}"><line x1="${f1(p[0])}" y1="${f1(p[1])}" x2="${f1(p[0])}" y2="${f1(p[1] - 15)}"/><circle cx="${f1(p[0])}" cy="${f1(p[1] - 19)}" r="${label.length > 2 ? 9 : 6}"/><text x="${f1(p[0])}" y="${f1(p[1] - 16.6)}">${label}</text></g>`; };
    const ath = Array.from({ length: 7 }, (_, i) => (0.04 + i * 0.13 + t * 0.0095 * (1 + (i % 3) * 0.14)) % 1);
    const top = P(this.top), mine = ath[2], mi = Math.min(this.grad.length - 1, Math.floor(mine * this.grad.length)), mp = rp[Math.round(mine * (rp.length - 1))];
    this.svg.innerHTML = `${qs.map((q) => `<polygon points="${pts(q.p)}" fill="${q.fill}" stroke="${q.fill}"/>`).join('')}
      <polyline class="p3RouteB" points="${pts(rp)}"/><polyline class="p3Route" points="${pts(rp)}"/>${steep}
      ${[1, 2, 3, 4, 5, 6, 7].map((k) => pin(k / 8, String(k))).join('')}${pin(0, 'S/F', ' sf')}
      <text class="p3Top" x="${f1(top[0])}" y="${f1(top[1] - 6)}">▲ ${ELEV(this.top[1])} m</text>
      ${ath.map((u, i) => { const p = rp[Math.round(u * (rp.length - 1))]; return `<circle class="p3Ath${i === 2 ? ' me' : ''}" cx="${f1(p[0])}" cy="${f1(p[1])}" r="${i === 2 ? 4 : 3}"/>`; }).join('')}
      ${bubble(mp[0], mp[1] - 9, '#2076')}
      <rect class="aiMapBg" x="8" y="8" width="96" height="15" rx="3"/><text class="aiMapT" x="15" y="18.2">3D COURSE · LIVE TRACKING</text>`;
    const g = this.grad[mi], msg = `#2076 live: km ${(mine * this.km).toFixed(1)} · ${g >= 0 ? 'climbing' : 'downhill'} ${Math.abs(Math.round(g))}% · ${ELEV(this.route[Math.round(mine * (this.route.length - 1))][1])} m up`;
    if (this.live.textContent !== msg) this.live.textContent = msg;
  },
};

// ================================================================================================ running them: only those in view, none if motion is reduced
const KINDS = { assist: ASSIST, var: VAR, film: FILM, cast: CAST, score: SCORE, home: HOME, safety: SAFETY, course: COURSE };
/** the running animations (exported to check a moment in the browser: a.draw(a.t = 5)) */
export const anims = [];
let last = 0, running = false;
const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { for (const e of es) { const a = anims.find((x) => x.el === e.target); if (a) a.seen = e.isIntersecting; } }, { rootMargin: '60px' }) : null;
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
  if (STILL || document.hidden) return;
  for (const a of anims) if (a.seen) { a.t += dt; if (a.t >= a.len) a.t = 0; a.draw(a.t); }
}
export function start(root) {
  for (const el of root.querySelectorAll('[data-p]')) {
    const kind = KINDS[el.dataset.p]; if (!kind) continue;
    const a = Object.create(kind); a.el = el; a.t = 0; a.seen = !io;
    a.init(el); a.draw(STILL ? a.still : 0);
    anims.push(a); io?.observe(el);
  }
  if (!running) { running = true; requestAnimationFrame(tick); }
}
