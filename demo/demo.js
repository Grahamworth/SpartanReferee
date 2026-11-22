// The AI demo for Spartan's leadership (22 November 2026): what cameras and an AI judge can referee, and how it works. The obstacle
// animations are the learning platform's (learn/obstacle-anim.js and obstacle-scenes.js); over them goes what the AI sees: the pose it
// tracks, boxes on the stone or chain, the checks it ticks off, and what it would flag to a referee.
import { G, HIP, timeline, stand, walk, fly, sample, solve, figure, ln, rc, ci, pg, tx, ground, hl } from '../learn/obstacle-anim.js';
import { SCENES } from '../learn/obstacle-scenes.js';

const D = Math.PI / 180;
const f1 = (v) => (+v).toFixed(1);
const shoulder = (s) => [s.x + Math.sin(s.a * D) * Math.max(-1, Math.min(1, s.f * 1.5)) * 29, s.y - Math.cos(s.a * D) * 29];
const CM = (px) => Math.round((px / 52) * 100); // 52 px to a metre

// ------------------------------------------------------------------------------------------------ the Atlas Carry, with the halfway burpees
// out to the halfway marker carrying the stone, put it down, 5 burpees, back with it; the fail rolls it instead
const R = 11;
function atlasScene() {
  const START = 60, MID = 300;
  const on = (s) => { const sh = shoulder(s); return { lh: [sh[0] + s.f * 19, sh[1] + 22], rh: [sh[0] + s.f * 11, sh[1] + 33], hold: 1 }; };
  const squat = (x, f, objX) => ({ x, y: G - 26, a: 38, f, lf: [x - 6 * f, G], rf: [x + 7 * f, G], lh: [objX - 4, G - R * 2 + 2], rh: [objX + 4, G - R * 2] });
  const pick = (o, x, f, objX) => o.to(0.45, squat(x, f, objX)).to(0.5, (s) => ({ ...stand(x, f), ...on({ ...s, ...stand(x, f) }) }));
  const put = (o, x, f, objX) => o.to(0.05, { obj: [objX, G - R] }).to(0.45, squat(x, f, objX)).to(0.01, { hold: 0 }).to(0.4, stand(x, f));
  const burpee = (o, X) => {
    const plank = { x: X - 8, y: G - 20, a: 70, lh: [X + 18, G], rh: [X + 21, G], lf: [X - 44, G], rf: [X - 40, G], kp: [0, 1] };
    o.to(0.25, { x: X - 4, y: G - 25, a: 55, lh: [X + 18, G], rh: [X + 21, G], lf: [X - 10, G], rf: [X - 2, G] });
    o.to(0.22, plank).to(0.25, { y: G - 8, a: 88, ep: [-0.4, -1] }).to(0.25, { ...plank, ep: undefined });
    o.to(0.14, { x: X - 6, y: G - 36, a: 122 });
    o.to(0.22, { x: X - 2, y: G - 34, a: 45, lf: [X + 2, G], rf: [X + 9, G], lh: [X + 14, G - 40], rh: [X + 16, G - 38], kp: undefined });
    o.to(0.22, { ...stand(X + 4), a: 0 });
    const top = G - HIP - 18, sh = top - 29;
    fly(o, { x: X + 4, y: top, a: 0, lh: [X + 1, sh - 31], rh: [X + 8, sh - 31], lf: [X + 2, G - 18], rf: [X + 9, G - 16] }, 18);
    fly(o, { ...stand(X + 4), y: G - HIP + 2, lh: [X - 1, G - 70], rh: [X + 9, G - 72] });
    return o.to(0.25, { ...stand(X - 4), f: 1 });
  };
  const good = () => {
    const o = timeline({ ...stand(START - 30), obj: [START, G - R], hold: 0, spin: 0 }); o.ev = [];
    pick(o, START - 13, 1, START); o.ev.push({ t: o.end, k: 'lift' });
    walk(o, MID - 13, { hands: on });
    put(o, MID - 13, 1, MID); o.ev.push({ t: o.end, k: 'down' });
    walk(o, MID - 46, {}); o.to(0.25, { ...stand(MID - 46), f: 1 });
    for (let i = 1; i <= 5; i++) { burpee(o, MID - 42); o.ev.push({ t: o.end - 0.5, k: 'burpee', n: i }); }
    walk(o, MID - 13, {}); o.to(0.2, { f: 1 });
    pick(o, MID - 13, 1, MID); o.ev.push({ t: o.end, k: 'lift' });
    o.to(0.6, (s) => ({ f: -1, ...on({ ...s, f: -1 }) }));
    walk(o, START + 13, { hands: on });
    put(o, START + 13, -1, START); o.ev.push({ t: o.end, k: 'done' });
    return o.hold(0.6);
  };
  const rolled = () => {
    const o = timeline({ ...stand(START - 30), obj: [START, G - R], hold: 0, spin: 0 }); o.ev = [];
    const h = (s) => ({ lh: [s.x + 16, G - 12], rh: [s.x + 18, G - 10], hold: 0, obj: [s.x + 28, G - R], spin: s.x * 4 });
    o.to(0.5, (s) => ({ a: 32, y: G - 36, ...h(s) }));
    walk(o, 150, { hands: h, lean: 32, v: 55 }); o.ev.push({ t: o.end, k: 'roll' });
    walk(o, 240, { hands: h, lean: 32, v: 55 });
    return o.to(0.4, (s) => ({ ...stand(s.x, 1) })).hold(0.8);
  };
  const stone = (s, P, bad) => {
    const sh = P.sh, carried = [sh[0] + s.f * 13, sh[1] + 24];
    const p = [s.obj[0] + (carried[0] - s.obj[0]) * s.hold, s.obj[1] + (carried[1] - s.obj[1]) * s.hold];
    return { p, svg: `<circle class="${bad ? 'prMetal hlBad' : 'prMetal'}" cx="${f1(p[0])}" cy="${f1(p[1])}" r="${R}"/>${ln(p[0] - 6, p[1] - 3 + ((s.spin || 0) % 6), p[0] + 2, p[1] + 4, 'pr prThin')}` };
  };
  return {
    stone,
    back: () => `${ground()}${rc(START - 22, G - 3, 44, 3, 'prF')}${ln(MID + 22, G, MID + 22, G - 56, 'pr')}${pg([[MID + 22, G - 56], [MID + 40, G - 50], [MID + 22, G - 44]], 'prFlag')}${tx(MID - 6, G + 14, 'Halfway: 5 burpees')}`,
    front: (s, H, P) => stone(s, P, H.has('item')).svg,
    good: good(), fails: [rolled()],
  };
}

// ------------------------------------------------------------------------------------------------ what the AI draws: the pose it tracks
const BONES = (P) => [[P.head, P.sh], [P.sh, P.hip], [P.sh, P.la[1]], [P.la[1], P.la[2]], [P.sh, P.ra[1]], [P.ra[1], P.ra[2]], [P.hip, P.ll[1]], [P.ll[1], P.ll[2]], [P.hip, P.rl[1]], [P.rl[1], P.rl[2]]];
function pose(P, tag, bad) {
  const pts = [P.head, P.sh, P.hip, P.la[1], P.la[2], P.ra[1], P.ra[2], P.ll[1], P.ll[2], P.rl[1], P.rl[2]];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs) - 8, y0 = Math.min(...ys) - 12, x1 = Math.max(...xs) + 8, y1 = Math.max(...ys) + 4;
  const c = bad ? ' aiBad' : '';
  return `<g class="aiPose${c}">${BONES(P).map(([a, b]) => `<line class="aiBone" x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}"/>`).join('')}
    ${pts.map((p) => `<circle class="aiDot" cx="${f1(p[0])}" cy="${f1(p[1])}" r="1.9"/>`).join('')}
    <rect class="aiBox" x="${f1(x0)}" y="${f1(y0)}" width="${f1(x1 - x0)}" height="${f1(y1 - y0)}" rx="3"/>
    <rect class="aiTagBg" x="${f1(x0)}" y="${f1(y0 - 11)}" width="${tag.length * 4.5 + 8}" height="10" rx="2"/><text class="aiTag" x="${f1(x0 + 4)}" y="${f1(y0 - 3.2)}">${tag}</text></g>`;
}
const objBox = (p, r, label, bad) => `<g class="aiObj${bad ? ' aiBad' : ''}"><rect class="aiBox" x="${f1(p[0] - r - 4)}" y="${f1(p[1] - r - 4)}" width="${f1(2 * r + 8)}" height="${f1(2 * r + 8)}" rx="3"/>
  <rect class="aiTagBg" x="${f1(p[0] - r - 4)}" y="${f1(p[1] - r - 14)}" width="${label.length * 4.5 + 8}" height="10" rx="2"/><text class="aiTag" x="${f1(p[0] - r)}" y="${f1(p[1] - r - 7.2)}">${label}</text></g>`;
const bubble = (x, y, text, cls = '') => `<g class="aiBubble ${cls}"><rect x="${f1(x - text.length * 3.4 - 6)}" y="${f1(y - 11)}" width="${f1(text.length * 6.8 + 12)}" height="15" rx="7.5"/><text x="${f1(x)}" y="${f1(y)}">${text}</text></g>`;

// ------------------------------------------------------------------------------------------------ the three demos: what the AI checks
const ATLAS = {
  scene: atlasScene,
  phases: ['Clean run', 'Fail: stone rolled'],
  checks: [['lift', 'Stone lifted clear of the ground'], ['carry', 'Carried, not rolled'], ['burpees', 'Halfway burpees counted'], ['back', 'Carried back to the start']],
  look({ s, P, time, tl, phase, memo, sc }) {
    const bad = phase === 1, st = sc.stone(s, P, false), p = st.p, gap = G - (p[1] + R);
    memo.lifted ||= gap > 3;
    const moved = memo.lastX === undefined ? 0 : Math.abs(p[0] - memo.lastX); memo.lastX = p[0];
    if (s.hold > 0.5 && gap > 3) memo.carried = (memo.carried || 0) + moved;
    const rolling = bad && s.hold < 0.5 && moved > 0.2; memo.rolled ||= rolling && time > 1.2;
    const ev = (k) => tl.ev.filter((e) => e.k === k && e.t <= time);
    const n = ev('burpee').length, done = ev('done').length > 0, inBurpees = time >= (tl.ev.find((e) => e.k === 'down')?.t ?? 1e9) && time <= (tl.ev.find((e) => e.k === 'burpee' && e.n === 5)?.t ?? -1) + 0.6;
    const states = {
      lift: memo.lifted ? 'ok' : 'wait',
      carry: memo.rolled ? 'bad' : (memo.carried || 0) > 60 ? 'ok' : s.hold > 0.5 ? 'live' : 'wait',
      burpees: n >= 5 ? 'ok' : n > 0 || inBurpees ? 'live' : 'wait',
      back: done ? 'ok' : 'wait',
    };
    const vals = { lift: gap > 3 ? `+${CM(gap)} cm` : memo.lifted ? '' : 'on ground', burpees: bad ? '' : `${n} / 5`, carry: memo.rolled ? 'rolled' : '' };
    const say = memo.rolled ? 'The stone is turning on the ground and never leaves it: rolled, not carried. Flagged to the referee with the clip.'
      : done ? 'Atlas Carry complete: lifted, carried both ways, 5 good burpees. Logged against the athlete\'s chip.'
        : inBurpees ? `Burpee ${Math.max(n, 1)} of 5: chest to the ground, hips and knees extended, jump with hands above the ears.`
          : gap > 3 ? `Stone held ${CM(gap)} cm off the ground and moving with the athlete: carried.`
            : 'Watching the athlete and the stone.';
    const overlay = `${pose(P, 'ATHLETE #1842', false)}${objBox(p, R, gap > 3 ? `STONE +${CM(gap)}cm` : memo.rolled ? 'STONE ROLLING' : 'STONE', memo.rolled)}
      ${gap > 3 ? `<line class="aiGap" x1="${f1(p[0])}" y1="${f1(p[1] + R + 1)}" x2="${f1(p[0])}" y2="${G}"/>` : ''}
      ${inBurpees ? bubble(P.head[0], P.head[1] - 22, `BURPEE ${Math.max(n, 1)}/5`) : ''}`;
    return { states, vals, say, overlay, bad: memo.rolled, hl: memo.rolled ? ['item'] : [] };
  },
};

// the loop from above, beside the side view: the course, the 4 checkpoints, the athlete going round (or cutting across)
const LOOP = { cx: 346, cy: 40, rx: 40, ry: 22 };
const loopAt = (k) => [LOOP.cx - LOOP.rx * Math.cos(k * 2 * Math.PI), LOOP.cy + LOOP.ry * Math.sin(k * 2 * Math.PI)];
const CHAIN = {
  scene: () => SCENES.chain(),
  phases: ['Clean loop', 'Fail: chain dragged', 'Fail: course cut'],
  timelines: (sc) => [sc.good, sc.fails[0], sc.good],
  checks: [['grab', 'Chain picked up at the start'], ['off', 'Off the ground, not dragged'], ['loop', 'Full loop: every checkpoint'], ['course', 'Stayed on the marked course']],
  look({ s, P, phase, memo }) {
    const sh = P.sh, carried = [sh[0] + s.f * 3, sh[1] + 2];
    const p = [s.obj[0] + (carried[0] - s.obj[0]) * s.hold, s.obj[1] + (carried[1] - s.obj[1]) * s.hold];
    const moved = memo.lastX === undefined ? 0 : Math.abs(s.obj[0] - memo.lastX); memo.lastX = s.obj[0];
    memo.grabbed ||= s.hold > 0.5;
    memo.dragged ||= phase === 1 && s.hold < 0.5 && moved > 0.2;
    memo.turned ||= s.f < -0.2;
    const k = Math.max(0, Math.min(1, !memo.turned ? ((s.x - 66) / 269) * 0.5 : 0.5 + ((335 - s.x) / 269) * 0.5));
    memo.k = Math.max(memo.k || 0, k);
    const cut = phase === 2 && memo.k > 0.3 && memo.k < 0.7;
    memo.cut ||= cut;
    const gates = [0.125, 0.375, 0.625, 0.875].filter((g) => memo.k >= g && !(phase === 2 && g > 0.3 && g < 0.7)).length;
    const finished = memo.turned && s.x < 90 && s.hold < 0.5;
    const states = {
      grab: memo.grabbed || memo.dragged ? (memo.grabbed ? 'ok' : 'bad') : 'wait',
      off: memo.dragged ? 'bad' : memo.grabbed && memo.k > 0.2 ? 'ok' : memo.grabbed ? 'live' : 'wait',
      loop: gates === 4 ? 'ok' : finished && gates < 4 ? 'bad' : gates > 0 ? 'live' : 'wait',
      course: memo.cut ? 'bad' : finished ? 'ok' : memo.k > 0 ? 'live' : 'wait',
    };
    const vals = { loop: `${gates} / 4`, off: memo.dragged ? 'dragged' : '', course: memo.cut ? 'cut' : '' };
    const say = memo.dragged ? 'The chain stays on the ground and slides along behind the hands: dragged. Flagged to the referee with the clip.'
      : memo.cut ? 'The athlete has left the marked loop and skipped checkpoints 2 and 3: course cut. Flagged to the referee.'
        : finished ? 'Chain Carry complete: carried all the way, every checkpoint passed.'
          : memo.grabbed ? `Chain carried off the ground. Checkpoints passed: ${gates} of 4.` : 'Watching the athlete and the chain.';
    // the map: the course loop, its checkpoints, and the athlete's path so far (straight across when cutting)
    const path = [];
    for (let i = 0; i <= 40; i++) { const kk = (i / 40) * memo.k; if (phase === 2 && kk > 0.3 && kk < 0.7) continue; path.push(loopAt(kk)); }
    const dotAt = cut ? (() => { const a = loopAt(0.3), b = loopAt(0.7), q = (memo.k - 0.3) / 0.4; return [a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q]; })() : loopAt(memo.k);
    const chord = phase === 2 && memo.k > 0.3 ? (() => { const a = loopAt(0.3), b = memo.k < 0.7 ? dotAt : loopAt(0.7); return `<line class="aiCut" x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}"/>`; })() : '';
    const map = `<g class="aiMap"><rect class="aiMapBg" x="296" y="6" width="100" height="62" rx="6"/><text class="aiMapT" x="302" y="15">COURSE (FROM ABOVE)</text>
      <ellipse class="aiLoop" cx="${LOOP.cx}" cy="${LOOP.cy}" rx="${LOOP.rx}" ry="${LOOP.ry}"/>
      ${[0.125, 0.375, 0.625, 0.875].map((g, i) => { const q = loopAt(g), hit = memo.k >= g && !(phase === 2 && g > 0.3 && g < 0.7); return `<circle class="aiGate${hit ? ' on' : ''}" cx="${f1(q[0])}" cy="${f1(q[1])}" r="3.2"/><text class="aiGateN" x="${f1(q[0])}" y="${f1(q[1] + 1.6)}">${i + 1}</text>`; }).join('')}
      ${path.length > 1 ? `<polyline class="aiTrail" points="${path.map((q) => `${f1(q[0])},${f1(q[1])}`).join(' ')}"/>` : ''}${chord}
      <circle class="aiMe${memo.cut || memo.dragged ? ' bad' : ''}" cx="${f1(dotAt[0])}" cy="${f1(dotAt[1])}" r="3.6"/></g>`;
    const overlay = `${pose(P, 'ATHLETE #2076', false)}${objBox(p, 9, memo.dragged ? 'CHAIN DRAGGING' : s.hold > 0.5 ? 'CHAIN · CARRIED' : 'CHAIN', memo.dragged)}`;
    return { states, vals, say, overlay, screen: map, bad: memo.dragged || memo.cut, hl: memo.dragged ? ['item'] : [] };
  },
};

const ROPE = {
  scene: () => SCENES.rope(),
  phases: ['Clean climb', 'Fail: no bell'],
  timelines: (sc) => [sc.good, sc.fails.find((f) => f.marks.some((m) => /bell/i.test(m.text))) || sc.fails[0]],
  checks: [['bellSeen', 'Bell strike seen by the camera'], ['bellHeard', 'Bell strike heard by the microphone'], ['time', 'Climb timed'], ['tech', 'Technique classified']],
  look({ s, P, time, phase, memo }) {
    const feetUp = Math.min(s.lf[1], s.rf[1]) < G - 8;
    if (feetUp && memo.t0 === undefined) memo.t0 = time;
    const ringing = (s.ring || 0) > 0.03 && (s.ring || 0) < 0.995;
    if (ringing && memo.t1 === undefined) memo.t1 = time;
    memo.top = Math.min(memo.top ?? 999, s.y);
    const descending = memo.t0 !== undefined && s.y > memo.top + 20;
    memo.noBell ||= phase === 1 && descending && memo.t1 === undefined;
    const climbing = memo.t0 !== undefined && memo.t1 === undefined && !memo.noBell;
    const secs = memo.t0 === undefined ? 0 : (memo.t1 ?? (memo.noBell ? memo.tN ??= time : time)) - memo.t0;
    const tech = memo.t0 !== undefined && time - memo.t0 > 0.9;
    const states = {
      bellSeen: memo.t1 !== undefined ? 'ok' : memo.noBell ? 'bad' : climbing ? 'live' : 'wait',
      bellHeard: memo.t1 !== undefined ? 'ok' : memo.noBell ? 'bad' : climbing ? 'live' : 'wait',
      time: memo.t1 !== undefined ? 'ok' : memo.noBell ? 'bad' : memo.t0 !== undefined ? 'live' : 'wait',
      tech: tech ? 'ok' : memo.t0 !== undefined ? 'live' : 'wait',
    };
    const vals = { time: memo.t0 === undefined ? '' : `${secs.toFixed(1)} s`, tech: tech ? 'foot lock · 94%' : '' };
    const say = memo.noBell ? 'Coming down with no bell: nothing seen at the bell, nothing heard on the microphone. Flagged to the referee.'
      : memo.t1 !== undefined ? `Bell struck: seen on camera and heard on the microphone at the same moment. Climb time ${secs.toFixed(1)} s.`
        : climbing ? 'Climbing: the clock is running, the technique is a foot lock (J-hook).' : 'Waiting for the athlete to leave the ground.';
    // the bell, marked when it's struck (world), and the microphone's sound, spiking when it rings (screen)
    const bx = 229, by = G - 220;
    const bellMark = memo.t1 !== undefined && time - memo.t1 < 2.4 ? `<g class="aiObj"><circle class="aiBox" cx="${bx}" cy="${by - 4}" r="${f1(14 + 3 * Math.sin(time * 12))}"/>${bubble(bx + 4, by - 26, 'BELL ✓ SEEN + HEARD')}</g>`
      : memo.noBell ? `<g class="aiObj aiBad"><circle class="aiBox" cx="${bx}" cy="${by - 4}" r="14"/>${bubble(bx + 4, by - 26, 'NO BELL', 'bad')}</g>` : '';
    const amp = (i) => { const since = memo.t1 === undefined ? 99 : time - memo.t1; const spike = since >= 0 && since < 1.6 ? Math.exp(-since * 2.4) * (0.6 + 0.4 * Math.sin(i * 1.7 + time * 30)) : 0; return 1.2 + Math.abs(Math.sin(i * 2.3 + time * 9)) * 1.6 + spike * 13; };
    const mic = `<g class="aiMic"><rect class="aiMapBg" x="296" y="6" width="100" height="40" rx="6"/><text class="aiMapT" x="302" y="15">MICROPHONE</text>
      ${Array.from({ length: 22 }, (_, i) => { const h = amp(i); return `<rect class="aiWave${memo.t1 !== undefined && time - memo.t1 < 1.6 ? ' hot' : ''}" x="${302 + i * 4.1}" y="${f1(32 - h)}" width="2.6" height="${f1(h * 2)}" rx="1"/>`; }).join('')}</g>
      ${memo.t0 !== undefined ? `<g class="aiClock"><rect class="aiMapBg" x="296" y="52" width="100" height="22" rx="6"/><text class="aiClockT" x="346" y="67">⏱ ${secs.toFixed(1)} s</text></g>` : ''}`;
    const overlay = `${pose(P, tech ? 'ATHLETE #3164 · FOOT LOCK' : 'ATHLETE #3164', memo.noBell)}${bellMark}`;
    return { states, vals, say, overlay, screen: mic, bad: memo.noBell, hl: memo.noBell ? ['bell'] : [] };
  },
};

// ------------------------------------------------------------------------------------------------ the player
function playDemo(root, demo) {
  const sc = demo.scene(), tls = demo.timelines ? demo.timelines(sc) : [sc.good, ...sc.fails];
  const svg = root.querySelector('svg'), world = svg.querySelector('.obWorld'), screen = svg.querySelector('.aiScreen');
  const tag = root.querySelector('.aiPhase'), say = root.querySelector('.aiSay'), btn = root.querySelector('.aiPlay');
  const items = Object.fromEntries(demo.checks.map(([k]) => [k, root.querySelector(`[data-k="${k}"]`)]));
  const chips = [...root.querySelectorAll('[data-ph]')];
  let ph = 0, at = 0, last = 0, hold = 0, memo = {}, seen = true, paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const go = (i) => {
    ph = (i + tls.length) % tls.length; at = 0; hold = 0; memo = {};
    tag.textContent = `AI view · ${demo.phases[ph]}`; tag.classList.toggle('bad', ph > 0);
    for (const c of chips) c.classList.toggle('on', +c.dataset.ph === ph);
  };
  const draw = () => {
    const tl = tls[ph], s = sample(tl, at), P = solve(s), cam = s.cam;
    const r = demo.look({ s, P, time: at, tl, phase: ph, memo, sc });
    const H = new Set(r.hl);
    world.setAttribute('transform', `translate(200 112) scale(${cam[2]}) translate(${-cam[0]} ${-cam[1]})`);
    world.innerHTML = `${sc.back(s, H, P, 0)}${figure(P)}${sc.front ? sc.front(s, H, P, 0) : ''}${r.overlay}`;
    screen.innerHTML = r.screen || '';
    for (const [k, li] of Object.entries(items)) { li.dataset.state = r.states[k]; li.querySelector('b').textContent = r.vals?.[k] || ''; }
    if (say.textContent !== r.say) { say.textContent = r.say; say.classList.toggle('bad', !!r.bad); }
  };
  const tick = (now) => {
    if (!root.isConnected) return;
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    if (paused || !seen || document.hidden) return;
    const tl = tls[ph];
    at = Math.min(at + dt, tl.end);
    if (at >= tl.end) { hold += dt; if (hold > 1.6) go(ph + 1); }
    draw();
  };
  btn.addEventListener('click', () => { paused = !paused; btn.textContent = paused ? 'Play' : 'Pause'; btn.setAttribute('aria-pressed', String(!paused)); });
  for (const c of chips) c.addEventListener('click', () => { go(+c.dataset.ph); draw(); if (paused) btn.click(); });
  if ('IntersectionObserver' in window) new IntersectionObserver((e) => { seen = e[0].isIntersecting; }).observe(svg);
  btn.textContent = paused ? 'Play' : 'Pause'; btn.setAttribute('aria-pressed', String(!paused));
  go(0); draw(); requestAnimationFrame(tick);
}
const playerHtml = (demo, label) => `<div class="aiPlayer">
  <div class="obStage aiStage"><svg viewBox="0 0 400 225" role="img" aria-label="${label}"><g class="obWorld"></g><g class="aiScreen"></g></svg><span class="aiPhase"></span></div>
  <ul class="aiChecks">${demo.checks.map(([k, text]) => `<li data-k="${k}" data-state="wait"><i aria-hidden="true"></i><span>${text}</span><b></b></li>`).join('')}</ul>
  <p class="aiSay" aria-live="polite"></p>
  <div class="aiControls"><button type="button" class="small aiPlay">Pause</button>${demo.phases.map((p, i) => `<button type="button" class="small" data-ph="${i}">${p}</button>`).join('')}</div>
</div>`;

for (const [id, demo, label] of [['atlasAnim', ATLAS, 'Animation: the AI watching an Atlas Carry'], ['chainAnim', CHAIN, 'Animation: the AI watching a Chain Carry'], ['ropeAnim', ROPE, 'Animation: the AI watching a Rope Climb']]) {
  const el = document.getElementById(id);
  if (el) { el.innerHTML = playerHtml(demo, label); playDemo(el, demo); }
}

// ------------------------------------------------------------------------------------------------ the bottom menu: jump to a section, the one in view lit
const nav = [...document.querySelectorAll('.demoNav a')];
const sections = nav.map((a) => document.querySelector(a.getAttribute('href')));
const light = () => {
  const y = window.scrollY + window.innerHeight * 0.35;
  let on = 0; sections.forEach((s, i) => { if (s && s.offsetTop <= y) on = i; });
  if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) on = sections.length - 1;
  nav.forEach((a, i) => { a.classList.toggle('on', i === on); if (i === on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
};
addEventListener('scroll', light, { passive: true }); addEventListener('resize', light); light();

// the zone picture opens full size
document.querySelector('.zonePic')?.addEventListener('click', (e) => { e.preventDefault(); document.getElementById('zoneBig').showModal(); });
document.getElementById('zoneBig')?.addEventListener('click', (e) => e.currentTarget.close());
