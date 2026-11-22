// The AI demo for Spartan's leadership (22 November 2026): what cameras and an AI judge can referee, and how it works. The obstacle
// animations are the learning platform's (learn/obstacle-anim.js and obstacle-scenes.js); over them goes what the AI sees: the pose it
// tracks, boxes on the stone or chain, the checks it ticks off, and what it would flag to a referee.
import { G, sample, solve, figure } from '../learn/obstacle-anim.js';
import { SCENES } from '../learn/obstacle-scenes.js';

const f1 = (v) => (+v).toFixed(1);
const CM = (px) => Math.round((px / 52) * 100); // 52 px to a metre

// ------------------------------------------------------------------------------------------------ the Atlas Carry (rule 4.1.3)
// the learning platform's own: from the start out past the far flags, turn, back; put down once on the way back and picked up from the
// same spot; placed at the start. The fail rolls it. No burpees: that requirement was removed from the 2026 rules.
const R = 11, START = 66, FLAG = 300;
const stoneAt = (s, P) => { const c = [P.sh[0] + s.f * 13, P.sh[1] + 24]; return [s.obj[0] + (c[0] - s.obj[0]) * s.hold, s.obj[1] + (c[1] - s.obj[1]) * s.hold]; };

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
  scene: () => SCENES.atlas(),
  phases: ['Clean run', 'Fail: stone rolled'],
  checks: [['lift', 'Stone lifted clear of the ground'], ['far', 'Carried past the far flags'], ['carry', 'Carried, never rolled'], ['spot', 'Put down, picked up from the same spot'], ['back', 'Placed back at the start']],
  look({ s, P, phase, memo }) {
    const p = stoneAt(s, P), gap = G - (p[1] + R), held = s.hold > 0.5;
    memo.lifted ||= gap > 3;
    const moved = memo.lastX === undefined ? 0 : Math.abs(s.obj[0] - memo.lastX); memo.lastX = s.obj[0];
    memo.rolled ||= phase === 1 && !held && moved > 0.2 && memo.lifted;
    memo.far ||= memo.lifted && s.f < -0.2;
    // put down on the way back: the AI pins the spot, and checks the pick-up is from it
    if (memo.far && !held && !memo.rolled && s.obj[0] > START + 40 && memo.down === undefined) memo.down = s.obj[0];
    if (memo.down !== undefined && held && memo.again === undefined) memo.again = Math.abs(s.obj[0] - memo.down) < 4;
    const done = memo.far && !held && Math.abs(s.obj[0] - START) < 4 && memo.again !== undefined;
    const states = {
      lift: memo.lifted ? 'ok' : 'wait',
      far: memo.far ? 'ok' : held ? 'live' : 'wait',
      carry: memo.rolled ? 'bad' : done ? 'ok' : held ? 'live' : 'wait',
      spot: memo.again === true ? 'ok' : memo.again === false ? 'bad' : memo.down !== undefined ? 'live' : 'wait',
      back: done ? 'ok' : memo.rolled ? 'bad' : 'wait',
    };
    const vals = { lift: gap > 3 ? `+${CM(gap)} cm` : '', carry: memo.rolled ? 'rolled' : '', spot: memo.down !== undefined && memo.again === undefined ? 'pinned' : '' };
    const say = memo.rolled ? 'The stone is turning on the ground and never leaves it: rolled, not carried. Flagged to the referee with the clip.'
      : done ? 'Atlas Carry complete: carried past the far flags and back, picked up from where it was put down, placed at the start.'
        : memo.down !== undefined && memo.again === undefined ? 'The stone is down. The AI has pinned the spot: it must be picked up from exactly there.'
          : memo.again ? 'Picked up from exactly where it was put down: carry on.'
            : memo.far ? 'Past the far flags and turned: now back to the start.'
              : gap > 3 ? `Stone held ${CM(gap)} cm off the ground and moving with the athlete: carried.` : 'Watching the athlete and the stone.';
    const pin = memo.down !== undefined && (memo.again === undefined || held) ? `<g class="aiObj"><line class="aiGap" x1="${f1(memo.down)}" y1="${G + 2}" x2="${f1(memo.down)}" y2="${G - 34}"/>${bubble(memo.down, G - 36, 'SPOT PINNED')}</g>` : '';
    const overlay = `${pose(P, 'ATHLETE #1842', false)}${objBox(p, R, gap > 3 ? `STONE +${CM(gap)}cm` : memo.rolled ? 'STONE ROLLING' : 'STONE', memo.rolled)}
      ${gap > 3 ? `<line class="aiGap" x1="${f1(p[0])}" y1="${f1(p[1] + R + 1)}" x2="${f1(p[0])}" y2="${G}"/>` : ''}${pin}
      ${memo.far ? '' : `<line class="aiFinish" x1="${FLAG + 6}" y1="${G + 4}" x2="${FLAG + 6}" y2="${G - 70}"/>`}`;
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

// ------------------------------------------------------------------------------------------------ marketing: the action photos
// stills from the same animations at each obstacle's best moment, framed as the athlete would get them
const firstAt = (tl, ok) => { for (let t = 0; t < tl.end; t += 0.04) { const s = sample(tl, t); if (ok(s, solve(s))) return t; } return tl.end / 2; };
const markAt = (tl, re) => tl.marks.find((m) => !m.kind && re.test(m.text))?.t ?? tl.end / 2;
const PHOTOS = [
  { scene: () => SCENES.rope(), at: (tl) => markAt(tl, /bell/i) - 0.35, crop: (P) => [P.head[0] - 52, P.head[1] - 48, 120, 150], bib: '#3164', name: 'Rope Climb', line: 'Bell in 3.8 s' },
  { scene: () => SCENES.atlas(), at: (tl) => firstAt(tl, (s) => s.hold > 0.99 && s.f > 0 && s.x > 170), crop: (P) => [P.hip[0] - 50, P.head[1] - 28, 120, 150], bib: '#1842', name: 'Atlas Carry', line: 'Stone lifted 75 cm' },
  { scene: () => SCENES.burpee(), at: (tl) => markAt(tl, /jump/i), crop: (P) => [P.hip[0] - 60, P.head[1] - 52, 120, 150], bib: '#2076', name: 'Burpee Zone', line: '30 burpees, 0 no-reps' },
];
const photosEl = document.getElementById('photos');
if (photosEl) photosEl.innerHTML = PHOTOS.map((ph) => {
  const sc = ph.scene(), tl = sc.good, s = sample(tl, ph.at(tl)), P = solve(s), [x, y, w, h] = ph.crop(P, s);
  return `<figure class="photo"><div class="obWorld photoPic"><svg viewBox="${f1(x)} ${f1(y)} ${w} ${h}" role="img" aria-label="Action photo: ${ph.name}">${sc.back(s, new Set(), P, 0)}${figure(P)}${sc.front ? sc.front(s, new Set(), P, 0) : ''}</svg></div>
    <img class="photoLogo" src="../icons/spartanreferee/logo-red.png" alt=""><figcaption><b>${ph.bib} · ${ph.name}</b><span>${ph.line}</span></figcaption></figure>`;
}).join('');

// ------------------------------------------------------------------------------------------------ the tabs: Refereeing and Marketing
const TABS = [['tabRefBtn', 'tabRef'], ['tabMktBtn', 'tabMkt']];
const showTab = (panel, scroll) => {
  for (const [b, p] of TABS) { const on = p === panel; document.getElementById(b).classList.toggle('on', on); document.getElementById(b).setAttribute('aria-selected', String(on)); document.getElementById(p).hidden = !on; }
  document.body.classList.toggle('mktOn', panel === 'tabMkt');
  if (scroll) document.querySelector('.demoTabs').scrollIntoView({ block: 'start' });
  light();
};
for (const [b, p] of TABS) document.getElementById(b)?.addEventListener('click', () => { history.replaceState(null, '', p === 'tabMkt' ? '#marketing' : '#burpee'); showTab(p, true); });
if (location.hash === '#marketing') showTab('tabMkt', false);
for (const a of document.querySelectorAll('.demoNav a')) a.addEventListener('click', () => { if (document.getElementById('tabRef').hidden) showTab('tabRef', false); });
