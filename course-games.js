// The obstacle mini-games: one for each kind of obstacle, played the way the real one is done. Every game takes a
// difficulty (0 easy .. 1+ hard) that grows the further round the course you are and with the course
// (Kids < Sprint < Super < Beast < Ultra). Each is drawn side-on, with the athlete doing the move as you play.
//   walls     - wall (run up, plant, jump to the top, pull over), inverted, hanging, slip wall (rope up the slope),
//               stairway (jump from step to step)
//   nets      - A-frame (up, over the top, down), cargo net (reach into the swaying net), tilting ladder
//   ropes     - rope climb (pull, lock the feet, pull…), Hercules hoist (pull the weight up, lower it under control)
//   rigs      - monkey bars and ape hanger (grab at the end of each swing), rings / Hydra / twister (grab as it
//               swings to you), Bender (reach for each bar), Tyrolean (hand over hand, keep the legs hooked),
//               Z wall and Olympus (the right hold, with your grip running down), spider (brace and shuffle)
//   carries   - carry (steps against your stamina, shoulder swaps), bucket (keep the grip while you walk),
//               atlas (lift, carry, 5 burpees, back), drag (pull it in hand over hand, then drag it back)
//   ground    - crawl (elbows in turn, flat under the low wires), balance and slackline, hurdles, fire jump,
//               hay bales, over-under (OUOU) and over-under-through (OUT)
//   others    - spear / ball throw, laser pistol, the bell
// A game: init(C), key(C, k, down) for presses and releases, tick(C, dt, g, W, H) draws and returns 'win' / 'fail',
// progress(C) 0..1 (the runner acts it out), buttons: the on-screen buttons [[label, key]], fail: whether it can be
// failed, label: its short name, title: the headline before it starts, help: what to do.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ARROW = { left: '◀', right: '▶', up: '▲', down: '▼' };
const RED = '#e2231a', GREEN = '#3fbf4a', GOLD = '#facc15', WOOD = '#9a6b3f', DARK = '#2a2a2a', MUD = '#5b4a33', SKIN = '#e8c39e';

/** Which game an obstacle plays. */
export function gameFor(name, kind) {
  const n = name.toUpperCase();
  if (kind === 'memoryBoard' || kind === 'memoryTest') return kind;
  if (/LASER/.test(n)) return 'laser';
  if (kind === 'aim') return 'throw';
  if (/SLIP/.test(n)) return 'slipWall';
  if (/INVERTED/.test(n)) return 'inverted';
  if (/HANGING/.test(n)) return 'hangingWall';
  if (/OLYMPUS/.test(n)) return 'olympus';
  if (/Z WALL/.test(n)) return 'zWall';
  if (/STAIRWAY/.test(n)) return 'stairway';
  if (/ROPE CLIMB/.test(n)) return 'rope';
  if (/TILTING LADDER|LADDER/.test(n)) return 'tiltLadder';
  if (/A FRAME/.test(n)) return 'aFrame';
  if (/NET|CARGO/.test(n) && kind !== 'crawl') return 'cargoNet';
  if (/MONKEY/.test(n)) return 'monkeyBars';
  if (/APE HANGER/.test(n)) return 'apeHanger';
  if (/MULTIRING|TWISTER|HYDRA|ARMER/.test(n)) return 'rings';
  if (/BENDER/.test(n)) return 'bender';
  if (/TYROLEAN/.test(n)) return 'tyrolean';
  if (/SPIDER/.test(n)) return 'spider';
  if (kind === 'hoist') return 'hoist';
  if (/ATLAS/.test(n)) return 'atlas';
  if (/BUCKET/.test(n)) return 'bucket';
  if (/PLATE DRAG|TIRE DRAG/.test(n)) return 'drag';
  if (kind === 'carry') return 'carry';
  if (kind === 'crawl') return 'crawl';
  if (/SLACKLINE/.test(n)) return 'slackline';
  if (kind === 'balance') return 'balance';
  if (/FIRE/.test(n)) return 'fireJump';
  if (/HAY/.test(n)) return 'hay';
  if (/OUOU/.test(n)) return 'overUnder';
  if (/^OUT\b|\bOUT$/.test(n)) return 'overUnderThrough';
  if (kind === 'hurdle') return 'jumps';
  if (kind === 'bell') return 'powerJump';
  return 'wall'; // walls of every height
}

// ---------------------------------------------------------------- drawing
const text = (g, s, x, y, size = 30, col = '#ddd', align = 'center') => { g.font = `bold ${size}px system-ui, sans-serif`; g.fillStyle = col; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y); };
const bar = (g, x, y, w, h, f, col, bg = '#333') => { g.fillStyle = bg; g.fillRect(x, y, w, h); g.fillStyle = col; g.fillRect(x, y, w * clamp(f, 0, 1), h); };
const vbar = (g, x, y, w, h, f, col, bg = '#333') => { g.fillStyle = bg; g.fillRect(x, y, w, h); g.fillStyle = col; g.fillRect(x, y + h * (1 - clamp(f, 0, 1)), w, h * clamp(f, 0, 1)); };
const ground = (g, W, y, col = MUD) => { g.fillStyle = col; g.fillRect(0, y, W, 220 - y); };
const line = (g, pts, col = '#fff', w = 4) => { g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); };
const meter = (g, label, f, x, y, w = 150, col = GOLD) => { text(g, label, x, y - 12, 15, '#9a9a9a', 'left'); bar(g, x, y, w, 10, f, f < 0.25 ? '#ff6b6b' : col); };
const timeLeft = (g, C, W) => C.limit && text(g, `${Math.max(0, Math.ceil(C.limit - C.t))} s`, W - 24, 22, 20, C.limit - C.t < 4 ? '#ff9b9b' : '#9a9a9a', 'right');
const status = (g, s, W, col = '#ddd') => text(g, s, W / 2, 22, 21, col);
// The athlete, side-on: x, y at the feet, s the height in pixels. Poses: stand, run, crouch, hang, reach, lean,
// crawl, flat, carry, over, jump. ph animates (a stride, a reach).
function athlete(g, x, y, s, pose = 'stand', ph = 0, col = '#fff') {
  const h = s, head = h * 0.13, sw = Math.sin(ph * Math.PI * 2);
  g.save(); g.translate(x, y);
  const L = (p) => line(g, p, col, Math.max(3, h * 0.07));
  const dot = (px, py) => { g.fillStyle = SKIN; g.beginPath(); g.arc(px, py, head, 0, 7); g.fill(); };
  if (pose === 'crawl' || pose === 'flat') {
    const lift = pose === 'flat' ? 0 : h * 0.12;
    L([[-h * 0.5, -lift * 0.5], [h * 0.25, -lift]]); dot(h * 0.42, -lift - head * 0.6);
    L([[h * 0.2, -lift], [h * 0.35 + sw * h * 0.12, 0]]); L([[-h * 0.5, -lift * 0.5], [-h * 0.75 - sw * h * 0.1, 0]]);
  } else if (pose === 'hang' || pose === 'reach') {
    // hanging from hands at (0, -h): arms up
    const hx = pose === 'reach' ? h * 0.18 * sw : 0;
    L([[-h * 0.08 + hx, -h], [0, -h * 0.72]]); L([[h * 0.08 - hx, -h], [0, -h * 0.72]]);
    dot(0, -h * 0.66); L([[0, -h * 0.58], [sw * h * 0.05, -h * 0.25]]);
    L([[sw * h * 0.05, -h * 0.25], [-h * 0.08 + sw * h * 0.1, 0]]); L([[sw * h * 0.05, -h * 0.25], [h * 0.08 + sw * h * 0.1, 0]]);
  } else if (pose === 'crouch') {
    dot(h * 0.05, -h * 0.62); L([[0, -h * 0.52], [-h * 0.05, -h * 0.28]]); L([[-h * 0.05, -h * 0.28], [h * 0.18, -h * 0.18], [h * 0.05, 0]]);
    L([[-h * 0.05, -h * 0.28], [-h * 0.2, -h * 0.12], [-h * 0.12, 0]]); L([[0, -h * 0.45], [h * 0.2, -h * 0.3]]);
  } else if (pose === 'lean') {
    dot(h * 0.28, -h * 0.82); L([[h * 0.2, -h * 0.72], [0, -h * 0.4]]); L([[h * 0.18, -h * 0.66], [h * 0.42, -h * 0.9]]);
    L([[0, -h * 0.4], [-h * 0.12, 0]]); L([[0, -h * 0.4], [h * 0.1, 0]]);
  } else if (pose === 'carry') {
    dot(0, -h * 0.87); L([[0, -h * 0.77], [0, -h * 0.42]]); L([[0, -h * 0.72], [h * 0.15, -h * 0.82]]);
    L([[0, -h * 0.42], [h * 0.12 * sw, 0]]); L([[0, -h * 0.42], [-h * 0.12 * sw, 0]]);
  } else {
    const run = pose === 'run' || pose === 'jump', tuck = pose === 'jump' ? 0.18 : 0;
    dot(run ? h * 0.06 : 0, -h * 0.87); L([[run ? h * 0.04 : 0, -h * 0.77], [0, -h * 0.42]]);
    L([[0, -h * 0.72], [h * 0.14 * (run ? sw : 0.3), -h * 0.5]]); L([[0, -h * 0.72], [-h * 0.14 * (run ? sw : 0.3), -h * 0.5]]);
    L([[0, -h * 0.42], [h * (run ? 0.18 * sw : 0.06), -h * tuck]]); L([[0, -h * 0.42], [-h * (run ? 0.18 * sw : 0.06), -h * tuck]]);
  }
  g.restore();
}
// a tap-in-the-zone bar: a marker sweeps, the zone is where it counts
function sweepBar(g, x, y, w, h, ph, z0, z1, col = '#fff') {
  g.fillStyle = '#333'; g.fillRect(x, y, w, h); g.fillStyle = GREEN; g.fillRect(x + w * z0, y, w * (z1 - z0), h);
  g.fillStyle = col; g.fillRect(x + w * ph - 4, y - 8, 8, h + 16);
}
const pingPong = (t, period) => { const p = (t / period) % 2; return p < 1 ? p : 2 - p; };

// ---------------------------------------------------------------- the games
export const GAMES = {
  // ======== WALLS
  // Run up, plant your foot at the base, jump for the top; then pull yourself over. Higher walls: a tighter plant
  // and more to pull.
  wall: {
    label: 'Wall: plant, jump, pull over', title: 'Over the wall', fail: true, buttons: [['Jump / pull ◀', 'left'], ['Pull ▶', 'right']],
    help: 'Tap when the runner is on the green to plant and jump. Then ◀ ▶ in turn to pull yourself over the top.',
    init(C) {
      const m = C.o.name.match(/([6-9])/); C.ft = m ? +m[1] : /2X1/i.test(C.o.name) ? 7 : 6;
      C.stage = 'run'; C.goes = 3; C.pulls = 0; C.need = Math.round((C.ft - 4) * 1.4 + C.diff * 2); C.side = null; C.z = [0.62 + C.diff * 0.04, 0.84 - (C.ft - 6) * 0.02 - C.diff * 0.04];
      C.limit = 0; C.runT = 0;
    },
    key(C, k, down) {
      if (!down) return;
      if (C.stage === 'run' && (k === 'left' || k === 'right' || k === 'tap')) {
        const p = C.runT / 1.1;
        if (p >= C.z[0] && p <= C.z[1]) { C.stage = 'pull'; C.limit = C.t + 4 + C.need * 0.7 - C.diff * 1.5; C.msg = 'Got the top!'; }
        else { C.goes--; C.msg = p < C.z[0] ? 'Too early: short of the top' : 'Too late: you ran into the wall'; C.runT = 0; if (C.goes <= 0) C.result = 'fail'; }
      } else if (C.stage === 'pull' && (k === 'left' || k === 'right')) {
        if (k !== C.side) { C.pulls++; C.side = k; if (C.pulls >= C.need) C.result = 'win'; } else C.slip = 0.4;
      }
    },
    tick(C, dt, g, W, H) {
      const gy = 196, wx = 600, wh = 30 + C.ft * 12;
      ground(g, W, gy); g.fillStyle = WOOD; g.fillRect(wx, gy - wh, 26, wh); g.fillStyle = '#6e4a2a'; for (let y = gy - wh + 14; y < gy; y += 18) g.fillRect(wx, y, 26, 2);
      text(g, `${C.ft} ft`, wx + 13, gy - wh - 12, 16, '#9a9a9a');
      if (C.stage === 'run') {
        C.runT += dt * (1 + C.diff * 0.5); if (C.runT > 1.1) { C.goes--; C.msg = 'Too late: you ran into the wall'; C.runT = 0; if (C.goes <= 0) C.result = 'fail'; }
        const p = C.runT / 1.1, x = 80 + (wx - 110) * Math.min(1, p);
        g.fillStyle = 'rgba(63,191,74,0.35)'; g.fillRect(80 + (wx - 110) * C.z[0], gy, (wx - 110) * (C.z[1] - C.z[0]), 10);
        athlete(g, x, gy, 90, 'run', C.t * 2.4);
        status(g, C.msg || `Plant on the green · ${C.goes} go${C.goes === 1 ? '' : 'es'} left`, W, C.msg && !/Got/.test(C.msg) ? '#ff9b9b' : '#ddd');
      } else {
        C.slip = Math.max(0, (C.slip || 0) - dt); if (C.t > C.limit) C.result = 'fail';
        // hanging from the top, hauling up, then crouched on top as the last pull takes you over
        const f = C.pulls / C.need;
        if (f < 0.75) athlete(g, wx - 4, gy - wh + 90 - f * 50, 90, 'hang', C.pulls * 0.5); else athlete(g, wx + 13, gy - wh, 60, 'crouch');
        bar(g, 40, 50, 260, 14, f, GOLD); text(g, C.slip ? 'Same hand twice – swap!' : `Pull over: ${C.side === 'left' ? '▶' : C.side === 'right' ? '◀' : '◀ or ▶'} next`, 40, 30, 19, C.slip ? '#ff9b9b' : '#ddd', 'left'); timeLeft(g, C, W);
      }
      return C.result;
    },
    progress: (C) => (C.stage === 'pull' ? 0.25 + 0.75 * C.pulls / C.need : 0.2 * Math.min(1, C.runT / 1.1)),
  },
  // A wall that leans towards you: climb the slats with ◀ ▶ on the beat, then swing a leg over at the top
  inverted: {
    label: 'Inverted wall: climb, leg over', title: 'Up the inverted wall', fail: true, buttons: [['◀', 'left'], ['▶', 'right'], ['Leg over', 'up']],
    help: 'Climb the slats: ◀ ▶ in turn as the marker crosses the green. At the top, press Leg over as your leg swings highest.',
    init(C) { C.slats = 4; C.at = 0; C.side = null; C.beat = 1 - C.diff * 0.35; C.zone = 0.3 - C.diff * 0.12; C.stage = 'climb'; C.stall = 0; C.limit = 16 - C.diff * 4; C.tries = 2; },
    key(C, k, down) {
      if (!down) return;
      if (C.stage === 'climb' && (k === 'left' || k === 'right') && !C.stall) {
        const ph = (C.t / C.beat) % 1;
        if (Math.abs(ph - 0.5) < C.zone / 2 && k !== C.side) { C.at++; C.side = k; if (C.at >= C.slats) C.stage = 'leg'; } else C.stall = 0.6;
      } else if (C.stage === 'leg' && k === 'up') {
        const sw = Math.sin(C.t * (3 + C.diff * 2));
        if (sw > 0.75 - C.diff * 0.1) C.result = 'win'; else { C.tries--; C.msg = 'Not high enough – swing again'; if (C.tries <= 0) C.result = 'fail'; }
      }
    },
    tick(C, dt, g, W, H) {
      const gy = 196; ground(g, W, gy); C.stall = Math.max(0, C.stall - dt); if (C.t > C.limit) C.result = 'fail';
      line(g, [[520, gy], [610, gy - 150]], WOOD, 14); for (let i = 1; i <= C.slats; i++) line(g, [[520 + i * 18, gy - i * 30], [500 + i * 18, gy - i * 30]], '#c9a24a', 6);
      const f = C.at / C.slats;
      if (C.stage === 'climb') {
        athlete(g, 495 + f * 75, gy - f * 120, 80, 'hang', C.at * 0.5);
        sweepBar(g, 40, 60, 300, 24, (C.t / C.beat) % 1, 0.5 - C.zone / 2, 0.5 + C.zone / 2, C.stall ? '#ff6b6b' : '#fff');
        status(g, C.stall ? 'Off the beat – stalled' : `Slat ${C.at} of ${C.slats}`, W);
      } else {
        const sw = Math.sin(C.t * (3 + C.diff * 2));
        athlete(g, 570, gy - 120, 80, 'hang', 0); line(g, [[570, gy - 140], [570 + 40 * sw, gy - 140 - 30 * Math.max(0, sw)]], '#fff', 6);
        vbar(g, 60, 40, 24, 140, (sw + 1) / 2, sw > 0.75 - C.diff * 0.1 ? GREEN : GOLD); text(g, C.msg || 'Leg over when the bar is green', 100, 110, 20, C.msg ? '#ff9b9b' : '#ddd', 'left');
      }
      timeLeft(g, C, W); return C.result;
    },
    progress: (C) => (C.stage === 'leg' ? 0.85 : 0.8 * C.at / C.slats),
  },
  // Hang from the top board and pull up (keep tapping or you sag back), then hook a leg over as you reach the top
  hangingWall: {
    label: 'Hanging wall: pull up, hook over', title: 'Hanging wall', fail: true, buttons: [['Pull', 'tap'], ['Hook leg', 'up']],
    help: 'Tap Pull fast to haul yourself up – ease off and you sag. When the bar reaches the green, press Hook leg.',
    init(C) { C.h = 0; C.limit = 12 - C.diff * 3; C.sag = 0.35 + C.diff * 0.25; C.tries = 2; },
    key(C, k, down) {
      if (!down) return;
      if (k === 'tap') C.h = Math.min(1, C.h + 0.075 - C.diff * 0.02);
      if (k === 'up') { if (C.h >= 0.82) C.result = 'win'; else { C.tries--; C.msg = 'Too low to hook – pull higher'; if (C.tries <= 0) C.result = 'fail'; } }
    },
    tick(C, dt, g, W, H) {
      const gy = 196; ground(g, W, gy); C.h = Math.max(0, C.h - C.sag * dt * (C.energy < 0.3 ? 1.4 : 1)); if (C.t > C.limit) C.result = 'fail';
      g.fillStyle = WOOD; g.fillRect(560, 40, 26, gy - 40); g.fillStyle = '#c9a24a'; g.fillRect(546, 36, 54, 10);
      athlete(g, 545, 140 - C.h * 70 + 60, 80, 'hang', C.h);
      vbar(g, 60, 36, 28, 150, C.h, C.h >= 0.82 ? GREEN : GOLD); g.fillStyle = 'rgba(63,191,74,0.5)'; g.fillRect(56, 36, 36, 150 * 0.18);
      text(g, C.msg || (C.h >= 0.82 ? 'Hook your leg now!' : 'Pull, pull, pull'), 110, 110, 21, C.msg ? '#ff9b9b' : '#ddd', 'left');
      timeLeft(g, C, W); return C.result;
    },
    progress: (C) => 0.8 * C.h,
  },
  // Up the slippery slope on the rope: hand over hand (◀ ▶ in turn) faster than your feet slide back
  slipWall: {
    label: 'Slip wall: hand over hand up the rope', title: 'Slip wall', fail: true, buttons: [['◀ hand', 'left'], ['▶ hand', 'right']],
    help: 'Hand over hand up the rope: ◀ ▶ in turn, quickly. Stop, or use the same hand twice, and your feet slide back.',
    init(C) { C.h = 0; C.side = null; C.limit = 13 - C.diff * 3; C.slide = 0.08 + C.diff * 0.06; },
    key(C, k, down) { if (!down || (k !== 'left' && k !== 'right')) return; if (k !== C.side) { C.h = Math.min(1, C.h + 0.055); C.side = k; if (C.h >= 1) C.result = 'win'; } else { C.h = Math.max(0, C.h - 0.06); C.slipped = 0.5; } },
    tick(C, dt, g, W, H) {
      const gy = 196; ground(g, W, gy); C.h = Math.max(0, C.h - C.slide * dt); C.slipped = Math.max(0, (C.slipped || 0) - dt); if (C.t > C.limit) C.result = 'fail';
      g.fillStyle = '#7a5530'; g.beginPath(); g.moveTo(300, gy); g.lineTo(640, 50); g.lineTo(640, gy); g.fill();
      line(g, [[640, 46], [300, gy - 6]], '#c9b27a', 3);
      const x = 320 + C.h * 300, y = gy - C.h * 140;
      athlete(g, x, y, 70, 'lean', C.h * 6);
      bar(g, 40, 50, 220, 14, C.h, GOLD); status(g, C.slipped ? 'Slipping! Swap hands' : 'Keep the hands going', W, C.slipped ? '#ff9b9b' : '#ddd'); timeLeft(g, C, W);
      return C.result;
    },
    progress: (C) => C.h,
  },
  // Big steps up the stairway: hold to load your legs, let go in the green to reach the next board (narrower higher up)
  stairway: {
    label: 'Stairway: jump step to step', title: 'Up the stairway', fail: true, buttons: [['Hold, let go to jump', 'tap']],
    help: 'Hold to load your legs, let go in the green to reach the next step. Each step up is harder.',
    init(C) { C.steps = 4 + Math.round(C.diff * 2); C.at = 0; C.p = 0; C.holding = false; C.misses = 0; },
    key(C, k, down) {
      if (k !== 'tap') return;
      if (down) { C.holding = true; C.p = 0; return; }
      if (!C.holding) return; C.holding = false;
      const z = this.zone(C); if (C.p >= z[0] && C.p <= z[1]) { C.at++; C.msg = ''; if (C.at >= C.steps) C.result = 'win'; } else { C.misses++; C.msg = C.p < z[0] ? 'Short – again' : 'Too much – again'; if (C.misses >= 3) C.result = 'fail'; }
    },
    zone(C) { const w = 0.22 - C.at * 0.025 - C.diff * 0.05; return [0.6, 0.6 + Math.max(0.07, w)]; },
    tick(C, dt, g, W, H) {
      const gy = 196; ground(g, W, gy); if (C.holding) C.p = (C.p + dt * (0.7 + C.diff * 0.3)) % 1.05;
      for (let i = 0; i < C.steps; i++) { g.fillStyle = i < C.at ? '#c9a24a' : WOOD; g.fillRect(380 + i * 55, gy - 25 - i * 26, 70, 10); line(g, [[380 + i * 55, gy], [380 + i * 55, gy - 25 - i * 26]], '#6e4a2a', 4); }
      const sx = C.at ? 380 + (C.at - 1) * 55 + 30 : 330, sy = C.at ? gy - 25 - (C.at - 1) * 26 : gy;
      athlete(g, sx, sy, 70, C.holding ? 'crouch' : 'stand');
      const z = this.zone(C); vbar(g, 60, 36, 28, 150, Math.min(1, C.p), GOLD); g.fillStyle = 'rgba(63,191,74,0.55)'; g.fillRect(56, 36 + 150 * (1 - z[1]), 36, 150 * (z[1] - z[0]));
      text(g, C.msg || `Step ${C.at + 1} of ${C.steps}${C.misses ? ` · ${3 - C.misses} misses left` : ''}`, 110, 110, 21, C.msg ? '#ff9b9b' : '#ddd', 'left');
      return C.result;
    },
    progress: (C) => 0.85 * C.at / C.steps,
  },
  // ======== NETS AND LADDERS
  // Up one side of the A-frame (◀ ▶ into the gaps as the net sways), over the top (cross when the frame is still), down
  aFrame: {
    label: 'A-frame: up, over, down', title: 'Over the A-frame', fail: true, buttons: [['◀', 'left'], ['Over the top', 'up'], ['▶', 'right']],
    help: '◀ ▶ in turn when the marker is in the green (the net sways). At the top, press Over the top when it’s steady. Then climb down.',
    init(C) { C.up = /SMALL/i.test(C.o.name) ? 4 : 6; C.at = 0; C.side = null; C.stage = 'up'; C.limit = 14 + C.up - C.diff * 3; C.stall = 0; },
    key(C, k, down) {
      if (!down) return;
      const sway = Math.sin(C.t * (1.6 + C.diff)), zc = 0.5 + sway * 0.25, ph = pingPong(C.t, 0.8 - C.diff * 0.2), inZone = Math.abs(ph - zc) < 0.14 - C.diff * 0.04;
      if ((C.stage === 'up' || C.stage === 'down') && (k === 'left' || k === 'right') && !C.stall) {
        if (inZone && k !== C.side) { C.at++; C.side = k; if (C.stage === 'up' && C.at >= C.up) C.stage = 'top'; else if (C.stage === 'down' && C.at >= C.up * 2) C.result = 'win'; } else C.stall = 0.6;
      } else if (C.stage === 'top' && k === 'up') { if (Math.abs(sway) < 0.35) { C.stage = 'down'; C.side = null; } else C.stall = 0.8; }
    },
    tick(C, dt, g, W, H) {
      const gy = 196; ground(g, W, gy); C.stall = Math.max(0, C.stall - dt); if (C.t > C.limit) C.result = 'fail';
      const sway = Math.sin(C.t * (1.6 + C.diff)), apex = [560, 40 + sway * 2];
      line(g, [[430, gy], apex, [690, gy]], WOOD, 8); for (let i = 1; i < 7; i++) { line(g, [[430 + i * 18, gy - i * 22], [690 - i * 18, gy - i * 22]], 'rgba(201,178,122,0.5)', 2); }
      const f = C.stage === 'down' ? 1 + (C.at - C.up) / C.up : C.at / C.up;
      const x = f <= 1 ? 430 + 130 * f : 560 + 130 * (f - 1), y = gy - (f <= 1 ? f : 2 - f) * 150;
      athlete(g, x - 18, y, 60, 'hang', C.at * 0.5);
      if (C.stage === 'top') { status(g, Math.abs(sway) < 0.35 ? 'Steady – over the top now!' : 'Wait for the net to steady…', W, Math.abs(sway) < 0.35 ? '#9be89f' : '#ddd'); }
      else { const zc = 0.5 + sway * 0.25; sweepBar(g, 40, 60, 300, 24, pingPong(C.t, 0.8 - C.diff * 0.2), zc - 0.14 + C.diff * 0.04, zc + 0.14 - C.diff * 0.04, C.stall ? '#ff6b6b' : '#fff'); status(g, C.stall ? 'Missed the gap – stalled' : C.stage === 'up' ? 'Climbing up' : 'Climbing down', W); }
      timeLeft(g, C, W); return C.result;
    },
    progress: (C) => (C.stage === 'down' ? 0.5 + 0.5 * (C.at - C.up) / C.up : 0.5 * C.at / C.up),
  },
  // Reach into the net: each hand into the gap that opens as the net sways (the gap moves; reach as it passes you)
  cargoNet: {
    label: 'Cargo net: reach into the gaps', title: 'Up the cargo net', fail: true, buttons: [['◀ reach', 'left'], ['▶ reach', 'right']],
    help: 'The gap for each hand drifts with the net: reach (◀ or ▶ in turn) when the hand is over the gap.',
    init(C) { C.need = 8 + Math.round(C.diff * 4); C.at = 0; C.side = null; C.limit = 12 + C.need - C.diff * 3; C.miss = 0; },
    key(C, k, down) {
      if (!down || (k !== 'left' && k !== 'right')) return;
      const gap = Math.sin(C.t * (1.3 + C.diff * 1.1) + (k === 'left' ? 0 : 2)) * 0.5;
      if (k !== C.side && Math.abs(gap) < 0.15 - C.diff * 0.04) { C.at++; C.side = k; if (C.at >= C.need) C.result = 'win'; }
      else { C.miss++; C.msg = 0.6; C.at = Math.max(0, C.at - 1); }
    },
    tick(C, dt, g, W, H) {
      const gy = 196; ground(g, W, gy); C.msg = Math.max(0, (C.msg || 0) - dt); if (C.t > C.limit) C.result = 'fail';
      g.strokeStyle = 'rgba(201,178,122,0.6)'; g.lineWidth = 2; const sw = Math.sin(C.t * 1.3) * 8;
      for (let i = 0; i <= 8; i++) { line(g, [[420 + i * 30 + sw, 30], [420 + i * 30 - sw, gy]], 'rgba(201,178,122,0.6)', 2); }
      for (let j = 0; j <= 6; j++) line(g, [[420, 30 + j * 27], [660, 30 + j * 27]], 'rgba(201,178,122,0.6)', 2);
      const f = C.at / C.need; athlete(g, 540, gy - f * 120, 70, 'hang', C.at * 0.5);
      for (const [k, x] of [['left', 120], ['right', 300]]) {
        const gap = Math.sin(C.t * (1.3 + C.diff * 1.1) + (k === 'left' ? 0 : 2)) * 0.5, ok = Math.abs(gap) < 0.15 - C.diff * 0.04;
        g.fillStyle = '#333'; g.fillRect(x - 70, 90, 140, 16); g.fillStyle = ok ? GREEN : '#555'; g.fillRect(x - 70 + 140 * (0.5 + gap) - 12, 86, 24, 24);
        g.fillStyle = '#fff'; g.fillRect(x - 2, 80, 4, 36); text(g, ARROW[k], x, 140, 26, k === C.side ? '#666' : '#fff');
      }
      status(g, C.msg ? 'Grabbed rope, not the gap – slipped down' : `Reach ${C.at} of ${C.need}`, W, C.msg ? '#ff9b9b' : '#ddd'); timeLeft(g, C, W);
      return C.result;
    },
    progress: (C) => 0.85 * C.at / C.need,
  },
  // Step up the tilting ladder: each step tips it towards that foot, so step on the side that brings it back level
  tiltLadder: {
    label: 'Tilting ladder: keep it level', title: 'Tilting ladder', fail: true, buttons: [['◀ foot', 'left'], ['▶ foot', 'right']],
    help: 'Each step tips the ladder towards that side. Step with the foot that brings it back towards level. Too far and you come off.',
    init(C) { C.need = 8 + Math.round(C.diff * 3); C.at = 0; C.tilt = 0; C.v = 0; },
    key(C, k, down) { if (!down || (k !== 'left' && k !== 'right')) return; C.v += (k === 'left' ? -1 : 1) * (0.32 + C.diff * 0.1); C.at++; if (C.at >= C.need && Math.abs(C.tilt) < 0.7) C.result = 'win'; },
    tick(C, dt, g, W, H) {
      const gy = 196; ground(g, W, gy);
      C.v += (Math.sin(C.t * 1.7) * 0.25 + C.tilt * 0.6) * dt * (1 + C.diff); C.tilt += C.v * dt * 2.2; C.v *= 0.96;
      if (Math.abs(C.tilt) > 1) C.result = 'fail';
      g.save(); g.translate(560, gy); g.rotate(C.tilt * 0.45);
      line(g, [[-30, 0], [-30, -160]], WOOD, 6); line(g, [[30, 0], [30, -160]], WOOD, 6); for (let i = 1; i < 9; i++) line(g, [[-30, -i * 18], [30, -i * 18]], '#c9a24a', 4);
      athlete(g, 0, -(C.at / C.need) * 150, 64, 'hang', C.at * 0.5); g.restore();
      g.fillStyle = '#333'; g.fillRect(60, 80, 300, 16); g.fillStyle = GREEN; g.fillRect(210 - 30, 76, 60, 24); g.fillStyle = Math.abs(C.tilt) > 0.7 ? '#ff6b6b' : '#fff'; g.fillRect(210 + C.tilt * 150 - 5, 70, 10, 36);
      text(g, C.tilt > 0.15 ? 'Leaning right – step ◀' : C.tilt < -0.15 ? 'Leaning left – step ▶' : 'Level', 210, 130, 20, '#ddd'); status(g, `Rung ${Math.min(C.at, C.need)} of ${C.need}`, W);
      return C.result;
    },
    progress: (C) => 0.85 * Math.min(1, C.at / C.need),
  },
  // ======== ROPES AND THE HOIST
  // J-hook: lock the feet (▼), pull up (▲), lock, pull… Pull without locking first and you slide back; ring the bell
  rope: {
    label: 'Rope climb: lock the feet, pull', title: 'Rope climb', fail: true, buttons: [['▼ Lock feet', 'down'], ['▲ Pull up', 'up'], ['Ring bell', 'tap']],
    help: 'Lock your feet (▼), then pull up (▲), lock, pull… Pulling without a lock burns your arms and slides you down. Ring the bell at the top.',
    init(C) { C.need = 6 + Math.round(C.diff * 3); C.h = 0; C.locked = false; C.arms = 1; C.limit = 14 + C.need - C.diff * 3; },
    key(C, k, down) {
      if (!down) return;
      if (k === 'down') { C.locked = true; C.msg = ''; }
      else if (k === 'up') { if (C.locked) { C.h++; C.locked = false; C.arms = Math.max(0, C.arms - 0.05); } else { C.arms -= 0.18 + C.diff * 0.06; C.h = Math.max(0, C.h - 0.5); C.msg = 'No lock – you slid down'; } if (C.arms <= 0) C.result = 'fail'; }
      else if (k === 'tap' && C.h >= C.need) C.result = 'win';
    },
    tick(C, dt, g, W, H) {
      const gy = 196; ground(g, W, gy); if (C.t > C.limit) C.result = 'fail'; C.arms = Math.min(1, C.arms + (C.locked ? 0.05 : 0) * dt);
      line(g, [[560, 10], [560 + Math.sin(C.t * 1.2) * 4, gy - 4]], '#c9b27a', 6); g.fillStyle = GOLD; g.beginPath(); g.arc(575, 22, 10, 0, 7); g.fill();
      const f = Math.min(1, C.h / C.need); athlete(g, 560, gy - f * 120, 70, C.locked ? 'crouch' : 'hang', C.h * 0.5);
      meter(g, 'Arms', C.arms, 40, 60); status(g, C.h >= C.need ? 'At the top – ring the bell!' : C.msg || (C.locked ? 'Feet locked – pull ▲' : 'Lock your feet ▼'), W, C.msg ? '#ff9b9b' : C.h >= C.need ? '#9be89f' : '#ddd');
      bar(g, 40, 100, 200, 12, f, GOLD); timeLeft(g, C, W); return C.result;
    },
    progress: (C) => 0.9 * Math.min(1, C.h / C.need),
  },
  // Hercules hoist: hand over hand (◀ ▶ in turn) to raise the weight; sit back (hold ▼) to rest it; then lower it
  // gently by holding ▼ – let it drop and you fail
  hoist: {
    label: 'Hercules hoist: haul up, lower gently', title: 'Hercules hoist', fail: true, buttons: [['◀ pull', 'left'], ['▶ pull', 'right'], ['Hold ▼ to brace / lower', 'down']],
    help: 'Pull ◀ ▶ in turn to raise the weight to the top. Hold ▼ to brace and rest. Then hold ▼ to let it down slowly – let go too early and it crashes.',
    init(C) { C.h = 0; C.side = null; C.brace = false; C.arms = 1; C.stage = 'up'; C.limit = 22 - C.diff * 5; C.weight = /\bHH\b|HERCULE/i.test(C.o.name) && C.diff > 0.4 ? 1.25 : 1; },
    key(C, k, down) {
      if (k === 'down') { C.brace = down; return; }
      if (!down || C.stage !== 'up' || C.brace) return;
      if (k !== C.side) { C.h = Math.min(1, C.h + 0.06 / C.weight); C.side = k; C.arms = Math.max(0, C.arms - 0.025 * C.weight); if (C.h >= 1) { C.stage = 'down'; C.msg = 'At the top! Now hold ▼ and lower it'; } }
    },
    tick(C, dt, g, W, H) {
      const gy = 196; ground(g, W, gy); if (C.t > C.limit) C.result = 'fail';
      if (C.stage === 'up') { if (C.brace) C.arms = Math.min(1, C.arms + 0.18 * dt); else C.h = Math.max(0, C.h - (C.arms < 0.2 ? 0.2 : 0.08) * dt * C.weight); }
      else { if (C.brace) { C.h = Math.max(0, C.h - 0.28 * dt); if (C.h <= 0) C.result = 'win'; } else { C.h -= 1.4 * dt; if (C.h <= 0.02) { C.msg = 'You let it drop!'; C.result = 'fail'; } } }
      line(g, [[640, 30], [700, 30]], '#555', 8); line(g, [[700, 30], [700, 160 - C.h * 120]], '#c9b27a', 3); line(g, [[640, 30], [560, 150]], '#c9b27a', 3);
      g.fillStyle = '#444'; g.fillRect(684, 160 - C.h * 120, 32, 30); text(g, `${Math.round(C.weight * 40)}kg`, 700, 175 - C.h * 120, 11, '#ddd');
      athlete(g, 540, gy, 80, C.brace ? 'lean' : 'stand', C.h * 4);
      vbar(g, 760, 36, 18, 150, C.h, GOLD); meter(g, 'Arms', C.arms, 40, 60);
      status(g, C.msg || (C.brace ? 'Braced – resting' : 'Pull ◀ ▶'), W, /drop/.test(C.msg || '') ? '#ff9b9b' : '#ddd'); timeLeft(g, C, W);
      return C.result;
    },
    progress: (C) => (C.stage === 'up' ? 0.5 * C.h : 0.5 + 0.5 * (1 - C.h)),
  },
  // ======== RIGS
  // Monkey bars: swing, and grab the next bar (◀ ▶ in turn) at the far end of each swing
  monkeyBars: {
    label: 'Monkey bars: grab at the end of the swing', title: 'Monkey bars', fail: true, buttons: [['◀ hand', 'left'], ['▶ hand', 'right']],
    help: 'You swing forward and back. Grab the next bar with ◀ then ▶ (in turn) as the swing reaches the green, at its far end.',
    init(C) { C.need = 7 + Math.round(C.diff * 4); C.at = 0; C.side = null; C.lives = 2; C.period = 1.2 - C.diff * 0.3; C.zone = 0.22 - C.diff * 0.08; },
    key(C, k, down) {
      if (!down || (k !== 'left' && k !== 'right')) return;
      const s = Math.sin(C.t * Math.PI * 2 / C.period);
      if (k !== C.side && s > 1 - C.zone * 2) { C.at++; C.side = k; if (C.at >= C.need) C.result = 'win'; }
      else { C.lives--; C.msg = k === C.side ? 'Same hand – you need the other one' : 'Not at the end of the swing'; if (C.lives <= 0) C.result = 'fail'; }
    },
    tick(C, dt, g, W, H) {
      const gy = 196; g.fillStyle = '#2b4a6b'; g.fillRect(0, gy - 6, W, 30);
      line(g, [[380, 54], [800, 54]], '#888', 6); for (let i = 0; i < 14; i++) line(g, [[380 + i * 30, 48], [380 + i * 30, 60]], '#bbb', 4);
      const s = Math.sin(C.t * Math.PI * 2 / C.period), x = 400 + C.at * 30;
      g.save(); g.translate(x, 54); g.rotate(-s * 0.4); athlete(g, 0, 110, 110, 'hang', 0); g.restore();
      g.fillStyle = '#333'; g.fillRect(60, 80, 260, 14); g.fillStyle = GREEN; g.fillRect(60 + 260 * (1 - C.zone), 76, 260 * C.zone, 22); g.fillStyle = '#fff'; g.fillRect(60 + 260 * (s + 1) / 2 - 4, 70, 8, 34);
      status(g, C.msg || `Bar ${C.at} of ${C.need} · ${C.side === 'left' ? '▶' : C.side === 'right' ? '◀' : '◀ or ▶'} next`, W, C.msg ? '#ff9b9b' : '#ddd');
      text(g, C.lives > 1 ? '1 slip allowed' : 'No more slips', 190, 130, 16, '#9a9a9a');
      return C.result;
    },
    progress: (C) => 0.9 * C.at / C.need,
  },
  // Ape hanger: up the rope to the bars (lock, pull), then the high bars across, which are further apart
  apeHanger: {
    label: 'Ape hanger: rope up, bars across', title: 'Ape hanger', fail: true, buttons: [['▼ lock', 'down'], ['▲ pull', 'up'], ['◀ hand', 'left'], ['▶ hand', 'right']],
    help: 'Up the rope first: ▼ lock your feet, ▲ pull, lock, pull. Then across the bars: ◀ ▶ in turn at the far end of each swing.',
    init(C) { C.stage = 'rope'; C.h = 0; C.locked = false; C.ropeNeed = 3; GAMES.monkeyBars.init(C); C.need = 6 + Math.round(C.diff * 3); C.zone = 0.18 - C.diff * 0.06; },
    key(C, k, down) {
      if (C.stage === 'rope') { if (!down) return; if (k === 'down') C.locked = true; else if (k === 'up') { if (C.locked) { C.h++; C.locked = false; if (C.h >= C.ropeNeed) { C.stage = 'bars'; C.t0b = C.t; } } else C.msg = 'Lock first'; } return; }
      GAMES.monkeyBars.key(C, k, down);
    },
    tick(C, dt, g, W, H) {
      if (C.stage === 'rope') {
        const gy = 196; g.fillStyle = '#2b4a6b'; g.fillRect(0, gy - 6, W, 30); line(g, [[420, 40], [420, gy - 6]], '#c9b27a', 6); line(g, [[400, 40], [800, 40]], '#888', 6);
        athlete(g, 420, gy - 6 - (C.h / C.ropeNeed) * 100, 70, C.locked ? 'crouch' : 'hang');
        status(g, C.msg || (C.locked ? 'Pull ▲' : 'Lock your feet ▼'), W); return C.result;
      }
      return GAMES.monkeyBars.tick(C, dt, g, W, H);
    },
    progress: (C) => (C.stage === 'rope' ? 0.2 * C.h / C.ropeNeed : 0.2 + 0.7 * C.at / C.need),
  },
  // Rings, Hydra pipes and the twister: each one swings (or turns) – grab it (◀ ▶ in turn) as it comes to your hand
  rings: {
    label: 'Rings: grab as it swings to you', title: 'Across the rig', fail: true, buttons: [['◀ hand', 'left'], ['▶ hand', 'right']],
    help: 'Each ring (or pipe, or twister handle) swings towards you and away. Grab it with ◀ then ▶ (in turn) as it reaches your hand.',
    init(C) {
      const n = C.o.name.toUpperCase();
      C.items = Array.from({ length: 6 + Math.round(C.diff * 3) }, (_, i) => (/TWISTER|PLUS/.test(n) && i >= 4 ? 'twister' : /HYDRA/.test(n) ? 'pipe' : 'ring'));
      C.at = 0; C.side = null; C.lives = 2; C.ph = C.items.map(() => C.r() * 6);
    },
    key(C, k, down) {
      if (!down || (k !== 'left' && k !== 'right')) return;
      const near = this.near(C);
      if (k !== C.side && near > 0.82 - C.diff * 0.06) { C.at++; C.side = k; if (C.at >= C.items.length) C.result = 'win'; }
      else { C.lives--; C.msg = k === C.side ? 'Same hand – use the other' : 'Grabbed at air'; if (C.lives <= 0) C.result = 'fail'; }
    },
    near(C) { const i = C.at, sp = C.items[i] === 'twister' ? 2.4 : 1.7 + C.diff; return (Math.sin(C.t * sp + C.ph[i]) + 1) / 2; },
    tick(C, dt, g, W, H) {
      const gy = 196, top = 50; g.fillStyle = '#2b4a6b'; g.fillRect(0, gy - 6, W, 30); line(g, [[300, top], [820, top]], '#888', 8);
      C.items.forEach((it, i) => {
        const x = 330 + i * 52, near = i === C.at ? this.near(C) : 0.5, sw = (near - 0.5) * 40;
        if (it === 'twister') { g.save(); g.translate(x, top + 46); g.rotate(C.t * 2.4 + C.ph[i]); line(g, [[-18, 0], [18, 0]], i < C.at ? '#666' : GOLD, 6); g.restore(); line(g, [[x, top], [x, top + 46]], '#888', 3); }
        else { line(g, [[x, top], [x - sw, top + 42]], '#888', 2); if (it === 'pipe') line(g, [[x - sw - 12, top + 48], [x - sw + 12, top + 48]], i < C.at ? '#666' : '#ccc', 7); else { g.strokeStyle = i < C.at ? '#666' : i === C.at && near > 0.82 - C.diff * 0.06 ? GREEN : GOLD; g.lineWidth = 4; g.beginPath(); g.arc(x - sw, top + 50, 9, 0, 7); g.stroke(); } }
      });
      athlete(g, 330 + Math.max(0, C.at - 1) * 52, top + 158, 100, 'hang', C.at * 0.5);
      bar(g, 40, 70, 200, 18, this.near(C), this.near(C) > 0.82 - C.diff * 0.06 ? GREEN : '#777');
      status(g, C.msg || `${C.items[C.at] || 'ring'} ${Math.min(C.at + 1, C.items.length)} of ${C.items.length} · grab when the bar is green`, W, C.msg ? '#ff9b9b' : '#ddd');
      return C.result;
    },
    progress: (C) => 0.9 * C.at / C.items.length,
  },
  // Bender: reach up and over for each angled bar – hold to stretch, let go in the green (further each bar)
  bender: {
    label: 'Bender: reach for each bar', title: 'The Bender', fail: true, buttons: [['Hold to reach, let go to grab', 'tap']],
    help: 'Hold to stretch for the next bar, let go in the green to grab it. The bars lean out further as you go up, then you come over the top.',
    init(C) { C.bars = 5 + Math.round(C.diff * 2); C.at = 0; C.p = 0; C.holding = false; C.misses = 0; },
    key(C, k, down) {
      if (k !== 'tap') return; if (down) { C.holding = true; C.p = 0; return; } if (!C.holding) return; C.holding = false;
      const z0 = 0.55 + C.at * 0.03, z1 = z0 + 0.16 - C.diff * 0.05;
      if (C.p >= z0 && C.p <= z1) { C.at++; if (C.at >= C.bars) C.result = 'win'; } else { C.misses++; C.msg = C.p < z0 ? 'Short of the bar' : 'Overreached'; if (C.misses >= 3) C.result = 'fail'; }
    },
    tick(C, dt, g, W, H) {
      const gy = 196; ground(g, W, gy); if (C.holding) C.p = (C.p + dt * 0.75) % 1.05;
      line(g, [[520, gy], [520, 20]], '#666', 8); for (let i = 0; i < C.bars; i++) line(g, [[520 - i * 10, gy - 30 - i * 26], [560 - i * 10, gy - 30 - i * 26]], i < C.at ? '#666' : '#ccc', 6);
      athlete(g, 535 - C.at * 10, gy - C.at * 26 + 10, 70, C.holding ? 'reach' : 'hang', C.p);
      const z0 = 0.55 + C.at * 0.03, z1 = z0 + 0.16 - C.diff * 0.05; vbar(g, 60, 36, 28, 150, Math.min(1, C.p), GOLD); g.fillStyle = 'rgba(63,191,74,0.55)'; g.fillRect(56, 36 + 150 * (1 - z1), 36, 150 * (z1 - z0));
      text(g, C.msg || `Bar ${C.at + 1} of ${C.bars}`, 110, 110, 21, C.msg ? '#ff9b9b' : '#ddd', 'left'); return C.result;
    },
    progress: (C) => 0.85 * C.at / C.bars,
  },
  // Tyrolean: hang under the rope, hand over hand (◀ ▶ in turn); when your legs start to slip, hook them back (▼)
  tyrolean: {
    label: 'Tyrolean: hand over hand, legs hooked', title: 'Tyrolean traverse', fail: true, buttons: [['◀ hand', 'left'], ['▼ re-hook legs', 'down'], ['▶ hand', 'right']],
    help: 'Hand over hand along the rope with ◀ ▶ in turn. When your legs start slipping off, press ▼ quickly to hook them back on.',
    init(C) { C.d = 0; C.side = null; C.legs = 1; C.limit = 18 - C.diff * 4; C.slipEvery = 2.6 - C.diff; C.next = C.slipEvery; },
    key(C, k, down) {
      if (!down) return;
      if (k === 'down') { C.legs = 1; C.slipping = false; C.next = C.t + C.slipEvery * (0.7 + C.r() * 0.6); return; }
      if ((k === 'left' || k === 'right') && k !== C.side) { C.d = Math.min(1, C.d + 0.045 * (C.slipping ? 0.4 : 1)); C.side = k; if (C.d >= 1) C.result = 'win'; }
    },
    tick(C, dt, g, W, H) {
      const gy = 196; g.fillStyle = '#2b4a6b'; g.fillRect(0, gy - 6, W, 30); if (C.t > C.limit) C.result = 'fail';
      if (C.t > C.next) C.slipping = true; if (C.slipping) { C.legs -= dt * (0.55 + C.diff * 0.4); if (C.legs <= 0) { C.msg = 'Your legs came off – you dropped'; C.result = 'fail'; } }
      line(g, [[300, 50], [800, 60]], '#c9b27a', 4); const x = 310 + C.d * 470;
      g.save(); g.translate(x, 52); g.rotate(-Math.PI / 2 * 0.9); athlete(g, 0, 60, 60, 'hang', C.d * 8); g.restore();
      meter(g, 'Legs on the rope', C.legs, 40, 90, 200, GREEN); status(g, C.slipping ? 'Legs slipping – ▼ hook them back!' : 'Hand over hand ◀ ▶', W, C.slipping ? '#ff9b9b' : '#ddd'); timeLeft(g, C, W);
      return C.result;
    },
    progress: (C) => 0.9 * C.d,
  },
  // Z wall: traverse sideways along the holds – each move asks for a direction (the next hold); your grip runs down
  // as you hang, and comes back a little on the big holds
  zWall: {
    label: 'Z wall: the right hold, keep your grip', title: 'Z wall', fail: true, buttons: [['◀', 'left'], ['▲', 'up'], ['▼', 'down'], ['▶', 'right']],
    help: 'The next hold lights up: press its direction (◀ ▲ ▼ ▶). Your grip drains while you hang – keep moving. Don’t touch the floor.',
    init(C) { const dirs = ['right', 'right', 'up', 'right', 'down', 'right', 'up', 'right', 'down', 'right']; C.path = Array.from({ length: 9 + Math.round(C.diff * 4) }, (_, i) => dirs[(i + Math.floor(C.r() * 3)) % dirs.length]); C.at = 0; C.grip = 1; C.wrong = 0; },
    key(C, k, down) { if (!down || !ARROW[k]) return; if (k === C.path[C.at]) { C.at++; C.grip = Math.min(1, C.grip + (C.at % 4 === 0 ? 0.2 : 0.02)); if (C.at >= C.path.length) C.result = 'win'; } else { C.wrong++; C.grip -= 0.15; C.msg = 0.5; if (C.grip <= 0) C.result = 'fail'; } },
    tick(C, dt, g, W, H) {
      const gy = 196; ground(g, W, gy); C.grip -= dt * (0.07 + C.diff * 0.06); if (C.grip <= 0) C.result = 'fail'; C.msg = Math.max(0, (C.msg || 0) - dt);
      g.fillStyle = WOOD; g.fillRect(260, 40, 160, 150); g.fillRect(420, 70, 160, 120); g.fillRect(580, 40, 160, 150);
      let x = 290, y = 120; const pts = [];
      C.path.forEach((d) => { x += d === 'right' ? 42 : 0; y += d === 'up' ? -22 : d === 'down' ? 22 : 0; pts.push([x, y]); });
      pts.forEach(([px, py], i) => { g.fillStyle = i < C.at ? '#555' : i === C.at ? GOLD : '#d26b3a'; g.beginPath(); g.arc(px, py, i === C.at ? 9 : 6, 0, 7); g.fill(); if (i === C.at) text(g, ARROW[C.path[i]], px, py - 22, 20, '#fff'); });
      const [ax, ay] = C.at ? pts[C.at - 1] : [270, 120]; athlete(g, ax, ay + 60, 66, 'hang', C.at * 0.5);
      meter(g, 'Grip', C.grip, 40, 60); status(g, C.msg ? 'Wrong hold!' : `Hold ${C.at} of ${C.path.length}`, W, C.msg ? '#ff9b9b' : '#ddd');
      return C.result;
    },
    progress: (C) => 0.9 * C.at / C.path.length,
  },
  // Olympus: across the leaning wall using holes, chains and climbing holds – use the right grip for each
  olympus: {
    label: 'Olympus: holes, chains and holds', title: 'Olympus', fail: true, buttons: [['◀ hole', 'left'], ['▲ chain', 'up'], ['▶ hold', 'right']],
    help: 'Each next grip is a hole (◀), a chain (▲) or a climbing hold (▶). Use the right one before your grip runs out.',
    init(C) { const t = ['left', 'up', 'right']; C.path = Array.from({ length: 8 + Math.round(C.diff * 4) }, () => t[Math.floor(C.r() * 3)]); C.at = 0; C.grip = 1; C.left = 1.6 - C.diff * 0.5; C.lim = C.left; },
    key(C, k, down) { if (!down || !['left', 'up', 'right'].includes(k)) return; if (k === C.path[C.at]) { C.at++; C.left = C.lim; if (C.at >= C.path.length) C.result = 'win'; } else { C.grip -= 0.3; C.msg = 0.5; if (C.grip <= 0) C.result = 'fail'; } },
    tick(C, dt, g, W, H) {
      const gy = 196; ground(g, W, gy); C.left -= dt; C.msg = Math.max(0, (C.msg || 0) - dt);
      if (C.left <= 0) { C.grip -= 0.3; C.left = C.lim; if (C.grip <= 0) C.result = 'fail'; }
      g.fillStyle = '#7a5530'; g.beginPath(); g.moveTo(300, gy); g.lineTo(340, 40); g.lineTo(800, 40); g.lineTo(760, gy); g.fill();
      C.path.forEach((tp, i) => { const x = 360 + i * (400 / C.path.length), y = 100; g.fillStyle = i < C.at ? '#555' : i === C.at ? GOLD : '#c9a24a';
        if (tp === 'left') { g.beginPath(); g.arc(x, y, 9, 0, 7); g.fillStyle = i === C.at ? GOLD : '#1c1c1c'; g.fill(); } else if (tp === 'up') line(g, [[x, 50], [x, y]], g.fillStyle, 3); else { g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); } });
      athlete(g, 360 + Math.max(0, C.at - 1) * (400 / C.path.length), 178, 80, 'hang', C.at * 0.5);
      meter(g, 'Grip', C.grip, 40, 60); bar(g, 40, 100, 150, 8, C.left / C.lim, '#888');
      status(g, C.msg ? 'Wrong grip!' : `Next: ${{ left: '◀ hole', up: '▲ chain', right: '▶ hold' }[C.path[C.at]] || ''}`, W, C.msg ? '#ff9b9b' : '#ddd'); return C.result;
    },
    progress: (C) => 0.9 * C.at / C.path.length,
  },
  // Spider: hands and feet pushed out to both walls; shuffle along with ◀ ▶ in turn, keeping the push even
  spider: {
    label: 'Spider: brace and shuffle', title: 'Spider walls', fail: true, buttons: [['◀ push', 'left'], ['▶ push', 'right']],
    help: 'Push on the left wall (◀) and the right wall (▶) in turn to shuffle along. Keep the two pushes even – lean too far either way and you drop.',
    init(C) { C.d = 0; C.bal = 0; C.side = null; C.limit = 16 - C.diff * 4; },
    key(C, k, down) { if (!down || (k !== 'left' && k !== 'right')) return; C.bal += k === 'left' ? -0.22 : 0.22; if (k !== C.side) { C.d = Math.min(1, C.d + 0.05); C.side = k; if (C.d >= 1) C.result = 'win'; } },
    tick(C, dt, g, W, H) {
      const gy = 196; g.fillStyle = '#2b4a6b'; g.fillRect(0, gy - 6, W, 30); if (C.t > C.limit) C.result = 'fail';
      C.bal += Math.sin(C.t * 2.3) * dt * (0.25 + C.diff * 0.3); C.bal *= 1 - dt * 0.6; if (Math.abs(C.bal) > 1) { C.msg = 'You slipped off the walls'; C.result = 'fail'; }
      g.fillStyle = WOOD; g.fillRect(300, 30, 500, 22); g.fillRect(300, 120, 500, 22);
      athlete(g, 320 + C.d * 450, 112 + C.bal * 14, 50, 'crawl', C.d * 10);
      g.fillStyle = '#333'; g.fillRect(40, 80, 220, 14); g.fillStyle = GREEN; g.fillRect(150 - 25, 76, 50, 22); g.fillStyle = '#fff'; g.fillRect(150 + C.bal * 110 - 4, 70, 8, 34);
      status(g, C.msg || 'Push ◀ ▶ in turn – keep it even', W, C.msg ? '#ff9b9b' : '#ddd'); timeLeft(g, C, W); return C.result;
    },
    progress: (C) => 0.9 * C.d,
  },
  // ======== CARRIES
  // Carry: each tap is a step. Steps cost stamina (more uphill); run out and you have to stop and get it back.
  // A log or sandbag also tires the shoulder: swap shoulders (▲) before it gives.
  carry: {
    label: 'Carry: pace your steps, swap shoulders', title: 'The carry', fail: false, buttons: [['◀ step', 'left'], ['▲ swap shoulder', 'up'], ['▶ step', 'right']],
    help: 'Step ◀ ▶ in turn. Each step costs stamina, more on the climb – run out and you stop to recover. Swap shoulders (▲) before the shoulder bar empties.',
    init(C) { const n = C.o.name.toUpperCase(); C.obj = /LOG/.test(n) ? 'log' : /CHAIN/.test(n) ? 'chain' : 'sandbag'; C.d = 0; C.st = 1; C.sh = 1; C.side = null; C.heavy = /CHAIN|LOG CARRY 1|ULTRA/.test(n) ? 1.25 : C.kids ? 0.6 : 1; C.rest = 0; C.dropped = 0; },
    key(C, k, down) {
      if (!down) return;
      if (k === 'up') { C.sh = 1; C.d = Math.max(0, C.d - 0.005); return; }
      if ((k !== 'left' && k !== 'right') || C.rest > 0 || k === C.side) return;
      const uphill = C.d < 0.5; C.side = k; C.d = Math.min(1, C.d + (uphill ? 0.016 : 0.026) / C.heavy); C.st -= (uphill ? 0.05 : 0.025) * C.heavy * (1 + C.diff * 0.4); C.sh -= 0.03 * C.heavy;
      if (C.st <= 0) { C.rest = 2; C.st = 0; } if (C.sh <= 0) { C.dropped++; C.rest = 2.5; C.sh = 1; C.msg = 'Dropped it – pick it back up'; } if (C.d >= 1) { C.penaltyTime = C.dropped * 5; C.result = 'win'; }
    },
    tick(C, dt, g, W, H) {
      const gy = 186; C.rest = Math.max(0, C.rest - dt); C.st = Math.min(1, C.st + dt * (C.rest ? 0.35 : 0.08));
      g.fillStyle = MUD; g.beginPath(); g.moveTo(0, 220); g.lineTo(0, gy); g.lineTo(W / 2, gy - 70); g.lineTo(W, gy); g.lineTo(W, 220); g.fill();
      const x = 40 + C.d * (W - 80), y = x < W / 2 ? gy - (x / (W / 2)) * 70 : gy - 70 + ((x - W / 2) / (W / 2)) * 70;
      athlete(g, x, y, 72, 'carry', C.d * 12);
      if (C.obj === 'log') line(g, [[x - 24, y - 64], [x + 30, y - 66]], WOOD, 12); else if (C.obj === 'chain') line(g, [[x + 8, y - 60], [x - 14, y - 40]], '#999', 6); else { g.fillStyle = '#6b6b3a'; g.fillRect(x - 6, y - 74, 26, 16); }
      meter(g, 'Stamina', C.st, 40, 50); if (C.obj !== 'chain') meter(g, 'Shoulder', C.sh, 220, 50, 150, '#8fb4ff');
      status(g, C.rest ? (C.msg || 'Out of breath – recovering…') : C.d < 0.5 ? 'Up the hill' : 'Back down', W, C.rest ? '#ff9b9b' : '#ddd');
      if (!C.rest) C.msg = ''; return C.result;
    },
    progress: (C) => C.d,
  },
  // Bucket: hold the grip (▼) the whole way while you step (◀ ▶ in turn); let go and it spills, and you refill it
  bucket: {
    label: 'Bucket: hold the grip and walk', title: 'Bucket brigade', fail: false, buttons: [['Hold ▼ grip', 'down'], ['◀ step', 'left'], ['▶ step', 'right']],
    help: 'Keep ▼ held to grip the bucket, and step ◀ ▶ in turn. Let go and it spills – you go back and refill. Your grip tires: steady steps, not a sprint.',
    init(C) { C.d = 0; C.grip = false; C.hand = 1; C.side = null; C.spills = 0; C.wait = 0; },
    key(C, k, down) {
      if (k === 'down') { C.grip = down; return; }
      if (!down || C.wait > 0 || (k !== 'left' && k !== 'right') || k === C.side) return;
      if (!C.grip) { C.spills++; C.wait = 2; C.d = Math.max(0, C.d - 0.1); C.msg = 'You let go – spilled! Refilling…'; return; }
      C.side = k; C.d = Math.min(1, C.d + 0.022 / (C.kids ? 0.7 : 1)); if (C.d >= 1) { C.penaltyTime = C.spills * 6; C.result = 'win'; }
    },
    tick(C, dt, g, W, H) {
      const gy = 186; ground(g, W, gy); C.wait = Math.max(0, C.wait - dt);
      if (C.grip) { C.hand -= dt * (0.08 + C.diff * 0.06); if (C.hand <= 0) { C.grip = false; C.spills++; C.wait = 2; C.hand = 0.6; C.msg = 'Grip gave out – spilled'; } } else C.hand = Math.min(1, C.hand + dt * 0.3);
      const x = 40 + C.d * (W - 80); athlete(g, x, gy, 72, 'carry', C.d * 12); g.fillStyle = '#d27a1a'; g.beginPath(); g.moveTo(x + 2, gy - 62); g.lineTo(x + 30, gy - 62); g.lineTo(x + 26, gy - 30); g.lineTo(x + 6, gy - 30); g.fill();
      meter(g, 'Grip', C.hand, 40, 50, 160, GREEN);
      status(g, C.wait ? C.msg : C.grip ? 'Gripped – walk ◀ ▶' : 'Hold ▼ to grip', W, C.wait ? '#ff9b9b' : '#ddd'); return C.result;
    },
    progress: (C) => C.d,
  },
  // Atlas: lift the stone (hold, let go at the top), carry it, set it down, 5 burpees, then back the same way
  atlas: {
    label: 'Atlas: lift, carry, 5 burpees, back', title: 'Atlas carry', fail: false, buttons: [['Hold to lift / tap for burpees', 'tap'], ['◀ step', 'left'], ['▶ step', 'right']],
    help: 'Hold to lift the stone and let go in the green when it’s on your chest. Walk ◀ ▶ in turn, then tap 5 burpees on the beat, and carry it back.',
    init(C) { C.stage = 'lift1'; C.p = 0; C.holding = false; C.d = 0; C.side = null; C.burp = 0; C.drops = 0; },
    key(C, k, down) {
      const lifting = C.stage === 'lift1' || C.stage === 'lift2';
      if (k === 'tap' && lifting) {
        if (down) { C.holding = true; C.p = 0; return; } if (!C.holding) return; C.holding = false;
        if (C.p > 0.68 && C.p < 0.9 - C.diff * 0.06) C.stage = C.stage === 'lift1' ? 'walk1' : 'walk2'; else { C.drops++; C.msg = 'Not on your chest – lift again'; }
        return;
      }
      if (k === 'tap' && down && C.stage === 'burpees') { const ph = (C.t * 1.2) % 1; if (ph < 0.35) { C.burp++; if (C.burp >= 5) C.stage = 'lift2'; } else C.msg = 'Wait for the beat'; return; }
      if (down && (C.stage === 'walk1' || C.stage === 'walk2') && (k === 'left' || k === 'right') && k !== C.side) {
        C.side = k; C.d += 0.08 / (C.kids ? 0.7 : 1);
        if (C.d >= 1) { C.d = 0; C.side = null; if (C.stage === 'walk1') C.stage = 'burpees'; else { C.penaltyTime = C.drops * 4; C.result = 'win'; } }
      }
    },
    tick(C, dt, g, W, H) {
      const gy = 186; ground(g, W, gy); if (C.holding) C.p = (C.p + dt * 0.7) % 1.05;
      const back = C.stage === 'walk2' || C.stage === 'lift2', x = C.stage.startsWith('walk') ? (back ? 640 - C.d * 400 : 240 + C.d * 400) : back || C.stage === 'burpees' ? 640 : 240;
      const ball = (bx, by) => { g.fillStyle = '#8a8f96'; g.beginPath(); g.arc(bx, by, 18, 0, 7); g.fill(); };
      if (C.stage === 'burpees') { const ph = (C.t * 1.2) % 1; athlete(g, x, gy, 72, ph < 0.5 ? 'flat' : 'jump', ph); ball(x + 60, gy - 18); bar(g, 40, 60, 220, 16, 1 - ph, ph < 0.35 ? GREEN : '#777'); status(g, `Burpee ${C.burp} of 5 – tap when the bar is green`, W); }
      else if (C.stage.startsWith('lift')) { athlete(g, x, gy, 72, C.holding ? 'crouch' : 'stand'); ball(x + 20, gy - 18 - C.p * 40); vbar(g, 60, 36, 28, 150, Math.min(1, C.p), GOLD); g.fillStyle = 'rgba(63,191,74,0.55)'; g.fillRect(56, 36 + 150 * (1 - (0.9 - C.diff * 0.06)), 36, 150 * (0.22 - C.diff * 0.06)); status(g, C.msg || 'Hold to lift, let go in the green', W, C.msg ? '#ff9b9b' : '#ddd'); }
      else { athlete(g, x, gy, 72, 'carry', C.d * 10); ball(x + 14, gy - 52); status(g, back ? 'Carry it back' : 'Carry it to the mark', W); }
      if (C.msg && C.t % 2 < 0.05) C.msg = ''; return C.result;
    },
    progress: (C) => ({ lift1: 0, walk1: 0.1 + 0.3 * C.d, burpees: 0.45 + 0.02 * C.burp * 0.1, lift2: 0.55, walk2: 0.6 + 0.4 * C.d }[C.stage] || 0),
  },
  // Drag: pull the plate or tyre in hand over hand (◀ ▶ in turn) on its rope, then drag it back by the strap
  drag: {
    label: 'Drag: pull it in, drag it back', title: 'The drag', fail: false, buttons: [['◀ pull', 'left'], ['▶ pull', 'right']],
    help: 'Pull the rope in hand over hand with ◀ ▶ in turn until it reaches you. Then drag it back the same way, digging in on every step.',
    init(C) { C.stage = 'pull'; C.d = 0; C.side = null; C.obj = /TIRE/i.test(C.o.name) ? 'tire' : 'plate'; C.st = 1; },
    key(C, k, down) {
      if (!down || (k !== 'left' && k !== 'right') || k === C.side || C.st <= 0.02) return;
      C.side = k; C.st -= 0.035 * (1 + C.diff * 0.5); C.d = Math.min(1, C.d + (C.stage === 'pull' ? 0.045 : 0.03));
      if (C.d >= 1) { if (C.stage === 'pull') { C.stage = 'drag'; C.d = 0; C.side = null; } else C.result = 'win'; }
    },
    tick(C, dt, g, W, H) {
      const gy = 186; ground(g, W, gy); C.st = Math.min(1, C.st + dt * 0.18);
      const ox = C.stage === 'pull' ? 760 - C.d * 380 : 380 - C.d * 300, ax = C.stage === 'pull' ? 360 : ox - 70;
      athlete(g, ax, gy, 72, 'lean', C.d * 8); line(g, [[ax + 20, gy - 45], [ox, gy - 8]], '#c9b27a', 3);
      if (C.obj === 'tire') { g.strokeStyle = '#111'; g.lineWidth = 12; g.beginPath(); g.ellipse(ox + 20, gy - 8, 28, 9, 0, 0, 7); g.stroke(); } else { g.fillStyle = '#555'; g.fillRect(ox, gy - 14, 50, 14); }
      meter(g, 'Strength', C.st, 40, 50); status(g, C.st <= 0.05 ? 'Arms burning – wait a moment' : C.stage === 'pull' ? 'Pull it in ◀ ▶' : 'Drag it back ◀ ▶', W, C.st <= 0.05 ? '#ff9b9b' : '#ddd');
      return C.result;
    },
    progress: (C) => (C.stage === 'pull' ? 0.4 * C.d : 0.4 + 0.6 * C.d),
  },
  // ======== GROUND
  // Crawl: elbows in turn (◀ ▶); where the wire dips low, hold ▼ to go flat or you snag
  crawl: {
    label: 'Crawl: elbows in turn, flat under the low wire', title: 'Under the wire', fail: false, buttons: [['◀ elbow', 'left'], ['Hold ▼ flat', 'down'], ['▶ elbow', 'right']],
    help: 'Crawl with ◀ ▶ in turn. Where the wire dips low (red), hold ▼ to go flat as you pass under it – or you snag and lose time.',
    init(C) { C.d = 0; C.side = null; C.flat = false; C.low = Array.from({ length: 3 + Math.round(C.diff * 3) }, (_, i) => 0.12 + i * (0.8 / (3 + Math.round(C.diff * 3))) + C.r() * 0.05); C.snags = 0; C.hit = new Set(); C.net = /NET/i.test(C.o.name); },
    key(C, k, down) {
      if (k === 'down') { C.flat = down; return; }
      if (!down || (k !== 'left' && k !== 'right') || k === C.side || C.snag > 0) return;
      C.side = k; C.d = Math.min(1, C.d + (C.flat ? 0.022 : 0.034));
      C.low.forEach((w, i) => { if (!C.hit.has(i) && Math.abs(C.d - w) < 0.035) { C.hit.add(i); if (!C.flat) { C.snags++; C.snag = 1.2; } } });
      if (C.d >= 1) { C.penaltyTime = C.snags * 4; C.result = 'win'; }
    },
    tick(C, dt, g, W, H) {
      const gy = 190; ground(g, W, gy); C.snag = Math.max(0, (C.snag || 0) - dt);
      const toX = (f) => 60 + f * (W - 120);
      for (let i = 0; i < 16; i++) { const f = i / 15, low = C.low.some((w) => Math.abs(f - w) < 0.04); line(g, [[toX(f), gy], [toX(f), gy - (low ? 30 : 48)]], '#666', 2); }
      line(g, [[toX(0), gy - 48], ...C.low.flatMap((w) => [[toX(w - 0.04), gy - 48], [toX(w), gy - 30], [toX(w + 0.04), gy - 48]]), [toX(1), gy - 48]], C.net ? '#888' : '#b8b8b8', 2);
      C.low.forEach((w) => { g.fillStyle = 'rgba(226,35,26,0.35)'; g.fillRect(toX(w - 0.035), gy - 34, toX(0.07) - toX(0), 6); });
      athlete(g, toX(C.d), gy, 70, C.flat ? 'flat' : 'crawl', C.d * 14, C.snag ? '#ff9b9b' : '#fff');
      const nearLow = C.low.some((w) => w - C.d > 0 && w - C.d < 0.06);
      status(g, C.snag ? 'Snagged on the wire!' : nearLow && !C.flat ? 'Low wire ahead – hold ▼' : C.flat ? 'Flat' : 'Crawl ◀ ▶', W, C.snag || (nearLow && !C.flat) ? '#ff9b9b' : '#ddd');
      return C.result;
    },
    progress: (C) => C.d,
  },
  // Balance beams: the wobble grows; hold ◀ / ▶ (or tilt with the pad) to stay over the beam
  balance: {
    label: 'Balance beam: stay over the beam', title: 'Balance beam', fail: true, buttons: [['◀ lean', 'left'], ['▶ lean', 'right']],
    help: 'Hold ◀ / ▶ to keep the marker in the middle until you reach the end.',
    init(C) { C.pos = 0; C.vel = 0; C.len = 5 + C.diff * 3; C.hold = 0; C.wob = 1; },
    key(C, k, down) { if (k === 'left') C.hold = down ? -1 : C.hold === -1 ? 0 : C.hold; if (k === 'right') C.hold = down ? 1 : C.hold === 1 ? 0 : C.hold; },
    tick(C, dt, g, W, H) {
      const push = C.hold || C.stick || 0;
      C.vel += (Math.sin(C.t * 2.1) * 0.9 + Math.sin(C.t * 3.7 + 1) * 0.6) * dt * (0.6 + C.t * 0.1) * (0.8 + C.diff) * C.wob + C.pos * dt * (1 + C.diff) + push * dt * 2.4;
      C.pos += C.vel * dt; C.vel *= 0.98;
      if (Math.abs(C.pos) > 1) C.result = 'fail'; else if (C.t >= C.len) C.result = 'win';
      const gy = 196; ground(g, W, gy); const f = C.t / C.len, x = 300 + f * 420;
      if (C.wob > 1) line(g, [[300, gy - 46], [720, gy - 46 + Math.sin(C.t * 6) * 6]], '#c9b27a', 3); else { g.fillStyle = WOOD; g.fillRect(300, gy - 46, 420, 10); line(g, [[320, gy - 36], [320, gy]], '#6e4a2a', 6); line(g, [[700, gy - 36], [700, gy]], '#6e4a2a', 6); }
      g.save(); g.translate(x, gy - 46); g.rotate(C.pos * 0.5); athlete(g, 0, 0, 80, 'stand'); line(g, [[-30, -52], [30, -52]], '#fff', 4); g.restore();
      g.fillStyle = '#333'; g.fillRect(40, 100, 220, 16); g.fillStyle = GREEN; g.fillRect(150 - 4, 92, 8, 32); g.fillStyle = Math.abs(C.pos) > 0.7 ? '#ff6b6b' : '#fff'; g.beginPath(); g.arc(150 + C.pos * 100, 108, 14, 0, 7); g.fill();
      status(g, Math.abs(C.pos) > 0.7 ? (C.pos > 0 ? 'Falling right – lean ◀' : 'Falling left – lean ▶') : 'Steady…', W, Math.abs(C.pos) > 0.7 ? '#ff9b9b' : '#ddd');
      return C.result;
    },
    progress: (C) => C.t / C.len,
  },
  // Slackline: the same, but the line bounces – the wobble is twice as lively
  slackline: {
    label: 'Slackline: ride the bounce', title: 'Slackline', fail: true, buttons: [['◀ lean', 'left'], ['▶ lean', 'right']],
    help: 'The line bounces under you: hold ◀ / ▶ to stay balanced to the far end.',
    init(C) { GAMES.balance.init(C); C.wob = 1.7; C.len = 6 + C.diff * 3; },
    key(C, k, down) { GAMES.balance.key(C, k, down); },
    tick(C, dt, g, W, H) { return GAMES.balance.tick(C, dt, g, W, H); },
    progress: (C) => C.t / C.len,
  },
  // Hurdles: they come along the track; jump each one in time (a clipped hurdle costs time, not a penalty)
  jumps: {
    label: 'Hurdles: time each jump', title: 'Hurdles', fail: false, buttons: [['Jump', 'tap']],
    help: 'Jump each hurdle as it reaches you.',
    init(C) { C.count = Math.round(3 + C.diff * 3); C.speed = 260 + C.diff * 180; C.hz = Array.from({ length: C.count }, (_, i) => 900 + i * (320 - C.diff * 80) + C.r() * 80); C.y = 0; C.vy = 0; C.clipped = 0; C.passed = 0; },
    key(C, k, down) { if (down && (k === 'tap' || k === 'up') && C.y <= 0) C.vy = 520; },
    tick(C, dt, g, W, H) {
      C.vy -= 1400 * dt; C.y = Math.max(0, C.y + C.vy * dt); if (C.y <= 0) C.vy = Math.max(0, C.vy);
      const px = 140, gy = 190; ground(g, W, gy);
      for (let i = 0; i < C.hz.length; i++) {
        C.hz[i] -= C.speed * dt; const x = C.hz[i];
        if (x > -30 && x < W + 30) { g.fillStyle = WOOD; g.fillRect(x - 22, gy - 44, 44, 8); g.fillRect(x - 20, gy - 44, 6, 44); g.fillRect(x + 14, gy - 44, 6, 44); }
        if (!C['h' + i] && x < px + 10) { C['h' + i] = 1; if (C.y < 40) { C.clipped++; C.flash = 0.4; } else C.passed++; }
      }
      C.flash = Math.max(0, (C.flash || 0) - dt);
      athlete(g, px, gy - C.y, 70, C.y > 0 ? 'jump' : 'run', C.t * 2.6, C.flash ? '#ff6b6b' : '#fff');
      status(g, `Cleared ${C.passed} · clipped ${C.clipped}`, W);
      if (C.hz.every((x, i) => C['h' + i]) && C.hz[C.hz.length - 1] < px - 60) { C.penaltyTime = C.clipped * 6; C.result = 'win'; }
      return C.result;
    },
    progress: (C) => (C.passed + C.clipped) / C.count,
  },
  // Fire jump: run up, and take off on the line – too early and you land in the flames, too late and you trip on them
  fireJump: {
    label: 'Fire jump: take off on the line', title: 'Fire jump', fail: false, buttons: [['Jump', 'tap']],
    help: 'Run up and jump when your foot is on the take-off line (green). Too early or too late and you land in the fire.',
    init(C) { C.runT = 0; C.jumped = false; C.y = 0; C.burns = 0; C.tries = 2; C.z = [0.7, 0.8 - C.diff * 0.04]; },
    key(C, k, down) {
      if (!down || (k !== 'tap' && k !== 'up') || C.jumped) return;
      const p = C.runT; C.jumped = true; C.jt = 0; C.good = p >= C.z[0] && p <= C.z[1];
    },
    tick(C, dt, g, W, H) {
      const gy = 190, fx = 560; ground(g, W, gy);
      for (let i = 0; i < 7; i++) { const h = 18 + Math.sin(C.t * 9 + i * 1.7) * 8 + (i % 2) * 6; g.fillStyle = i % 2 ? '#ff7a1a' : GOLD; g.beginPath(); g.moveTo(fx + i * 12 - 8, gy); g.lineTo(fx + i * 12, gy - h); g.lineTo(fx + i * 12 + 8, gy); g.fill(); }
      g.fillStyle = 'rgba(63,191,74,0.5)'; g.fillRect(80 + (fx - 120) * C.z[0], gy, (fx - 120) * (C.z[1] - C.z[0]), 8);
      if (!C.jumped) { C.runT += dt * (0.9 + C.diff * 0.4); if (C.runT > 1) { C.jumped = true; C.jt = 0; C.good = false; } athlete(g, 80 + (fx - 120) * Math.min(1, C.runT), gy, 72, 'run', C.t * 2.6); status(g, 'Jump on the green line', W); }
      else {
        C.jt += dt; const k = Math.min(1, C.jt / 0.8), x0 = 80 + (fx - 120) * Math.min(1, C.runT), x = x0 + (fx + 140 - x0) * k, y = Math.sin(k * Math.PI) * (C.good ? 70 : 34);
        athlete(g, x, gy - y, 72, 'jump', k, C.good ? '#fff' : '#ff9b9b'); status(g, C.good ? 'Clean over the fire!' : 'Too close – singed!', W, C.good ? '#9be89f' : '#ff9b9b');
        if (k >= 1 && C.jt > 1.2) { if (!C.good) { C.burns++; C.tries--; if (C.tries > 0) { C.runT = 0; C.jumped = false; return; } } C.penaltyTime = C.burns * 6; C.result = 'win'; }
      }
      return C.result;
    },
    progress: (C) => (C.jumped ? 0.9 : 0.5 * C.runT),
  },
  // Hay bales: climb each bale – ▲ as you reach it, then over and down
  hay: {
    label: 'Hay bales: up and over each one', title: 'Hay bale jump', fail: false, buttons: [['▲ climb', 'up']],
    help: 'Run at the bales and press ▲ as you reach each one to climb up and over. Too early or late and you bounce off.',
    init(C) { C.bales = 3 + Math.round(C.diff * 2); C.at = 0; C.x = 0; C.bounce = 0; C.slow = 0; },
    key(C, k, down) { if (!down || (k !== 'up' && k !== 'tap')) return; const next = 200 + C.at * 140; if (Math.abs(C.x + 120 - next) < 26 - C.diff * 6) { C.at++; C.onBale = 0; C.climb = 0.4; if (C.at >= C.bales) { C.penaltyTime = C.slow * 3; C.result = 'win'; } } else { C.bounce = 0.5; C.slow++; C.x = Math.max(0, C.x - 40); } },
    tick(C, dt, g, W, H) {
      const gy = 190; ground(g, W, gy); C.bounce = Math.max(0, C.bounce - dt); C.climb = Math.max(0, (C.climb || 0) - dt);
      if (!C.bounce) C.x += dt * (130 + C.diff * 60); const next = 200 + C.at * 140;
      if (C.x + 120 > next + 30 && C.at < C.bales) {
        // three bounces off the same bale and you scramble over it the slow way
        C.slow++; C.bounce = 0.5; C.x = next - 160; C.onBale = (C.onBale || 0) + 1;
        if (C.onBale >= 3) { C.onBale = 0; C.at++; C.climb = 0.6; C.x = next - 100; if (C.at >= C.bales) { C.penaltyTime = C.slow * 3; C.result = 'win'; } }
      }
      for (let i = 0; i < C.bales; i++) { g.fillStyle = '#d9b34a'; g.fillRect(200 + i * 140, gy - 40, 70, 40); line(g, [[200 + i * 140, gy - 20], [270 + i * 140, gy - 20]], '#b08a2a', 2); }
      athlete(g, C.x + 120, gy - (C.climb ? 40 : 0), 70, C.climb ? 'crouch' : 'run', C.t * 2.4, C.bounce ? '#ff9b9b' : '#fff');
      status(g, C.bounce ? 'Bounced off – again' : `Bale ${C.at + 1} of ${C.bales}: ▲ as you reach it`, W, C.bounce ? '#ff9b9b' : '#ddd'); return C.result;
    },
    progress: (C) => 0.9 * C.at / C.bales,
  },
  // Over-under (OUOU): over the high board (▲), under the low one (▼) – each one as it reaches you
  overUnder: {
    label: 'Over-under: ▲ over, ▼ under', title: 'Over, under', fail: false, buttons: [['▲ over', 'up'], ['▼ under', 'down']],
    help: 'Boards come at you: ▲ to vault over a low one, ▼ to duck under a high one – as it reaches you.',
    init(C) { this.setup(C, ['up', 'down']); },
    setup(C, kinds) { C.items = Array.from({ length: 4 + Math.round(C.diff * 2) }, (_, i) => kinds[i % kinds.length]); C.pos = C.items.map((_, i) => 800 + i * (260 - C.diff * 50)); C.at = 0; C.slips = 0; C.act = null; C.speed = 220 + C.diff * 120; },
    key(C, k, down) {
      if (!down || !['up', 'down', 'right'].includes(k)) return; const x = C.pos[C.at];
      if (x == null) return; if (Math.abs(x - 160) > 60) { C.act = { k, t: 0.4 }; return; }
      if (k === C.items[C.at]) { C.act = { k, t: 0.5, ok: true }; C.goodMoves = (C.goodMoves || 0) + 1; } else { C.slips++; C.act = { k, t: 0.5, ok: false }; }
      C.at++; if (C.at >= C.items.length) C.endAt = C.t + 0.8;
    },
    tick(C, dt, g, W, H) {
      const gy = 190; ground(g, W, gy); if (C.act) C.act.t -= dt;
      C.pos = C.pos.map((x, i) => x - C.speed * dt); if (C.pos[C.at] != null && C.pos[C.at] < 100) { C.slips++; C.at++; C.act = { k: 'miss', t: 0.5, ok: false }; if (C.at >= C.items.length) C.endAt = C.t + 0.8; }
      C.items.forEach((it, i) => { const x = C.pos[i]; if (x < -40 || x > W + 40) return; g.fillStyle = i < C.at ? '#555' : WOOD;
        if (it === 'up') g.fillRect(x - 6, gy - 50, 12, 50); else if (it === 'down') { g.fillRect(x - 6, gy - 150, 12, 100); line(g, [[x - 30, gy - 150], [x + 30, gy - 150]], '#6e4a2a', 6); } else { g.fillRect(x - 30, gy - 130, 60, 110); g.fillStyle = '#161616'; g.fillRect(x - 16, gy - 95, 32, 32); }
        text(g, { up: '▲', down: '▼', right: '▶' }[it], x, gy - 168, 18, '#9a9a9a'); });
      const a = C.act && C.act.t > 0 ? C.act : null;
      athlete(g, 160, gy - (a && a.k === 'up' ? 50 : 0), 72, a && a.k === 'down' ? 'crawl' : a && a.k === 'right' ? 'flat' : 'run', C.t * 2.4, a && a.ok === false ? '#ff9b9b' : '#fff');
      status(g, a && a.ok === false ? 'Wrong way – that cost you' : `${Math.min(C.at + 1, C.items.length)} of ${C.items.length}`, W, a && a.ok === false ? '#ff9b9b' : '#ddd');
      if (C.endAt && C.t > C.endAt) { C.penaltyTime = C.slips * 5; C.result = 'win'; } return C.result;
    },
    progress: (C) => 0.9 * C.at / C.items.length,
  },
  // Over-under-through (OUT): over, under, then through the window (▶)
  overUnderThrough: {
    label: 'Over-under-through: ▲ ▼ ▶', title: 'Over, under, through', fail: false, buttons: [['▲ over', 'up'], ['▼ under', 'down'], ['▶ through', 'right']],
    help: 'Boards come at you: ▲ over the low one, ▼ under the high one, ▶ dive through the window – as each reaches you.',
    init(C) { GAMES.overUnder.setup(C, ['up', 'down', 'right']); },
    key(C, k, down) { GAMES.overUnder.key(C, k, down); },
    tick(C, dt, g, W, H) { return GAMES.overUnder.tick(C, dt, g, W, H); },
    progress: (C) => 0.9 * C.at / C.items.length,
  },
  // ======== OTHERS
  // The bell: hold to crouch (power builds), let go in the band to reach the bell; try until you ring it
  powerJump: {
    label: 'The bell: jump to ring it', title: 'Ring the bell', fail: false, buttons: [['Hold, then let go', 'tap']],
    help: 'Hold to crouch and build power, let go in the green to reach the bell.',
    init(C) { C.p = 0; C.holding = false; C.zone = [0.72 - C.diff * 0.05, 0.86 - C.diff * 0.09]; C.tries = 0; C.jump = 0; },
    key(C, k, down) {
      if (k !== 'tap' || C.jump) return;
      if (down) { C.holding = true; C.p = 0; return; }
      if (!C.holding) return; C.holding = false; C.tries++; C.jump = 0.001; C.hit = C.p >= C.zone[0] && C.p <= C.zone[1];
      C.msg = C.hit ? '' : C.p < C.zone[0] ? 'Not high enough – again' : 'Too much – you overshot it';
    },
    tick(C, dt, g, W, H) {
      const gy = 196; ground(g, W, gy); if (C.holding) C.p = (C.p + dt * (0.55 + C.diff * 0.35)) % 1.05;
      line(g, [[600, gy], [600, 40], [650, 40]], '#666', 6); g.fillStyle = GOLD; g.beginPath(); g.arc(650, 58, 14, 0, 7); g.fill();
      let y = 0; if (C.jump) { C.jump += dt; const k = Math.min(1, C.jump / 0.7); y = Math.sin(k * Math.PI) * (C.hit ? 96 : 96 * Math.min(1, C.p / C.zone[0]) * (C.p > C.zone[1] ? 1.05 : 1)); if (k >= 1) { if (C.hit) C.result = 'win'; C.jump = 0; } }
      athlete(g, 630, gy - y, 80, C.holding ? 'crouch' : C.jump ? 'reach' : 'stand', C.jump * 2);
      const x = 60, y0 = 30, h = 160; g.fillStyle = '#333'; g.fillRect(x, y0, 40, h); g.fillStyle = GREEN; g.fillRect(x, y0 + h * (1 - C.zone[1]), 40, h * (C.zone[1] - C.zone[0]));
      g.fillStyle = GOLD; g.fillRect(x, y0 + h * (1 - Math.min(1, C.p)), 40, h * Math.min(1, C.p)); if (C.msg) text(g, C.msg, 120, 110, 21, '#ff9b9b', 'left');
      return C.result;
    },
    progress: () => 0,
  },
  // Throw: stop the aim on the target, then hold for power and let go in the band; the spear flies at the screen
  throw: {
    label: 'Throw: aim, then power', title: 'Spear throw', fail: true, buttons: [['Throw', 'tap']],
    help: 'Tap to set your aim on the target, then hold for power and let go in the green.',
    init(C) { C.stage = 'aim'; C.ax = 0; C.p = 0; C.shots = C.o.name.match(/kids/i) || C.kids ? 3 : 1; C.zone = [0.62, 0.8 - C.diff * 0.08]; C.fly = 0; C.ball = /BALL/i.test(C.o.name); },
    key(C, k, down) {
      if (k !== 'tap' || C.fly) return;
      if (C.stage === 'aim' && down) { C.aimAt = C.ax; C.stage = 'power'; C.p = 0; return; }
      if (C.stage === 'power' && down) { C.holding = true; C.p = 0; return; }
      if (C.stage === 'power' && !down && C.holding) {
        C.holding = false; C.fly = 0.001; C.hitAim = Math.abs(C.aimAt) < 0.13 - C.diff * 0.04; C.hitPower = C.p >= C.zone[0] && C.p <= C.zone[1];
      }
    },
    tick(C, dt, g, W, H) {
      const tx = W / 2, ty = 95, sc = 300;
      g.fillStyle = '#d9b34a'; g.fillRect(tx - 70, ty - 70, 140, 150);
      for (const [r, c] of [[56, '#f2f2f2'], [38, RED], [18, '#f2f2f2']]) { g.fillStyle = c; g.beginPath(); g.arc(tx, ty, r, 0, 7); g.fill(); }
      if (C.stage === 'aim') { C.ax = Math.sin(C.t * (1.6 + C.diff * 1.6)) * 0.9; const x = tx + C.ax * sc; g.strokeStyle = '#111'; g.lineWidth = 5; g.beginPath(); g.moveTo(x, ty - 70); g.lineTo(x, ty + 70); g.stroke(); text(g, 'Aim: tap when the line is on the bull', W / 2, 200, 22, '#9a9a9a'); }
      if (C.stage === 'power' && !C.fly) {
        if (C.holding) C.p = (C.p + dt * (0.6 + C.diff * 0.4)) % 1.05;
        bar(g, 40, 185, W - 80, 18, Math.min(1, C.p), GOLD); g.fillStyle = 'rgba(63,191,74,0.6)'; g.fillRect(40 + (W - 80) * C.zone[0], 180, (W - 80) * (C.zone[1] - C.zone[0]), 28);
        text(g, C.holding ? 'Let go in the green!' : 'Hold for power…', W / 2, 26, 22, '#ddd');
        const x = tx + C.aimAt * sc; g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, ty - 70); g.lineTo(x, ty + 70); g.stroke();
      }
      if (C.fly) {
        C.fly += dt; const k = Math.min(1, C.fly / 0.7);
        const endX = tx + C.aimAt * sc, endY = ty + (C.hitPower ? 0 : C.p < C.zone[0] ? 90 : -90), size = 1 - k * 0.85;
        const x = W / 2 + (endX - W / 2) * k, y = 230 + (endY - 230) * k - Math.sin(k * Math.PI) * 60;
        if (C.ball) { g.fillStyle = '#f2f2f2'; g.beginPath(); g.arc(x, y, 6 + 18 * size, 0, 7); g.fill(); }
        else { g.strokeStyle = '#7a5530'; g.lineWidth = 8 * size + 2; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 30 * size, y + 70 * size); g.stroke(); g.fillStyle = '#ccc'; g.beginPath(); g.moveTo(x, y - 14 * size); g.lineTo(x - 6 * size, y + 4 * size); g.lineTo(x + 6 * size, y + 4 * size); g.fill(); }
        if (k >= 1 && C.fly > 1.1) {
          if (C.hitAim && C.hitPower) C.result = 'win';
          else { C.shots--; if (C.shots <= 0) C.result = 'fail'; else { C.stage = 'aim'; C.fly = 0; C.msg = (C.hitAim ? '' : 'Off line. ') + (C.hitPower ? '' : C.p < C.zone[0] ? 'Fell short.' : 'Too hard.'); } }
        }
      }
      if (C.msg && !C.fly) text(g, C.msg, W / 2, 26, 22, '#ff9b9b');
      return C.result;
    },
    progress: () => 0,
  },
  // Laser pistol: targets light up; fire when the sight is on a lit one. Hit enough before time runs out.
  laser: {
    label: 'Laser pistol: hit the lit targets', title: 'Laser pistol', fail: true, buttons: [['Fire', 'tap']],
    help: 'Fire when the sight is on a lit target. Hit enough before time runs out.',
    init(C) { C.need = Math.round(4 + C.diff * 3); C.hits = 0; C.limit = 12 - C.diff * 3; C.tgt = -1; C.tgtLeft = 0; },
    key(C, k, down) { if (!down || k !== 'tap') return; const cx = (Math.sin(C.t * (1.3 + C.diff)) + 1) / 2; if (C.tgt >= 0 && Math.abs(cx - (C.tgt + 0.5) / 5) < 0.06) { C.hits++; C.tgt = -1; if (C.hits >= C.need) C.result = 'win'; } else C.shotMiss = 0.3; },
    tick(C, dt, g, W, H) {
      if (C.t > C.limit) C.result = 'fail';
      C.tgtLeft -= dt; if (C.tgtLeft <= 0) { C.tgt = Math.floor(C.r() * 5); C.tgtLeft = 1.8 - C.diff * 0.7; }
      C.shotMiss = Math.max(0, (C.shotMiss || 0) - dt);
      for (let i = 0; i < 5; i++) { const x = 40 + (W - 80) * (i + 0.5) / 5; g.fillStyle = i === C.tgt ? RED : DARK; g.beginPath(); g.arc(x, 105, 34, 0, 7); g.fill(); }
      const cx = 40 + (W - 80) * (Math.sin(C.t * (1.3 + C.diff)) + 1) / 2; g.strokeStyle = C.shotMiss ? '#ff6b6b' : '#fff'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx - 22, 105); g.lineTo(cx + 22, 105); g.moveTo(cx, 83); g.lineTo(cx, 127); g.stroke();
      text(g, `Hits ${C.hits}/${C.need}`, 60, 30, 24, '#ddd', 'left'); timeLeft(g, C, W);
      return C.result;
    },
    progress: (C) => C.hits / C.need,
  },
};

/** How hard an obstacle is: by course, and further round the course is harder. */
export function difficulty(course, at) {
  const base = { kids4: 0, kids7: 0, kids10: 0.05, sprint: 0.15, super: 0.25, beast: 0.35, ultra: 0.45 }[course.id] ?? 0.25;
  const d = base + (at / Math.max(1, course.length)) * 0.55;
  return course.kids ? d * 0.6 : d;
}
