// The exercises a station can judge, and the rep judges for the ones other
// than burpees. Pure logic, no DOM, so it can be unit tested in Node.
//
// Every judge has the same shape as BurpeeJudge: update(m, t) takes one frame
// of computeMetrics output and returns null or an event
//   {type: 'rep', count, done, detail}  or  {type: 'norep', reasons, detail}
// plus count, noReps, done, phase, live, o (options) and finish().
import { BurpeeJudge, GestureJudge, PRACTICE_REASON } from './burpee.js';

const round = (v, d) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)));
const minOf = (a, b) => (b == null ? a : a == null ? b : Math.min(a, b));
const maxOf = (a, b) => (b == null ? a : a == null ? b : Math.max(a, b));

// Shared bookkeeping: counts, no-rep reasons, phase changes that must hold
// for a few frames, and the detail recorded with each event.
class CycleJudge {
  constructor(defaults, opts) {
    this.o = { ...defaults, ...opts };
    this.count = 0;
    this.noReps = 0;
    this.reasonCounts = {};
    this.done = false;
    this.phase = 'waiting';
    this.cycle = null;
    this.runs = {};
    this.live = {};
  }

  // True once cond has held for o.phaseFrames frames in a row. cond null
  // means unknown this frame (body part hidden): the run neither grows nor
  // starts over.
  held(name, cond) {
    if (cond != null) this.runs[name] = cond ? (this.runs[name] || 0) + 1 : 0;
    return this.runs[name] >= this.o.phaseFrames;
  }

  startCycle(t, extra = {}) {
    this.cycle = { downAt: t, upAt: null, ...extra };
    this.runs = {};
  }

  rep(t) {
    this.count++;
    this.done = this.count >= this.o.targetReps;
    return { type: 'rep', count: this.count, done: this.done, detail: this.detail(t) };
  }

  noRep(t, reasons) {
    this.noReps++;
    for (const r of reasons) this.reasonCounts[r] = (this.reasonCounts[r] || 0) + 1;
    return { type: 'norep', reasons, detail: this.detail(t) };
  }

  detail(t) {
    const c = this.cycle || {};
    const out = { downAt: round(c.downAt, 0), upAt: round(c.upAt, 0), endAt: round(t, 0) };
    for (const [k, d] of Object.entries(this.constructor.MEASURES)) out[k] = typeof c[k] === 'boolean' ? c[k] : round(c[k], d);
    return out;
  }

  finish() { return null; }
}

// ---------------------------------------------------------------- air squats
// Hip crease below the top of the knee at the bottom; stand fully up (hips
// and knees straight) between reps.
export const SQUAT_REASONS = { depth: 'Hips below knees', stand: 'Stand up fully' };

export class SquatJudge extends CycleJudge {
  static DEFAULTS = { targetReps: 30, phaseFrames: 2, downKnee: 120, risingKnee: 140, standKnee: 160, standHip: 160, minDrop: -0.05 };
  static MEASURES = { minKnee: 0, maxDrop: 2, maxStandKnee: 0 };
  constructor(opts = {}) { super(SquatJudge.DEFAULTS, opts); }

  update(m, t) {
    if (this.done || !m || m.kneeAngle == null) return null;
    const o = this.o;
    this.live = { phase: this.phase, knee: m.kneeAngle, hip: m.hipAngle, drop: m.hipDrop };
    const bent = this.held('bent', m.kneeAngle < o.downKnee);
    // Hips hidden: judge standing from the knees alone.
    const standing = this.held('stand', m.kneeAngle > o.standKnee && (m.hipAngle == null || m.hipAngle > o.standHip));

    if (this.phase !== 'down') {
      if (bent) { this.startCycle(t, { minKnee: m.kneeAngle, maxDrop: m.hipDrop, maxStandKnee: null, rising: false }); this.phase = 'down'; }
      return null;
    }
    const c = this.cycle;
    c.minKnee = minOf(c.minKnee, m.kneeAngle);
    c.maxStandKnee = maxOf(c.maxStandKnee, m.kneeAngle);
    if (!c.rising) c.maxDrop = maxOf(c.maxDrop, m.hipDrop);
    if (m.kneeAngle > o.risingKnee) c.rising = true;
    const deep = c.maxDrop != null && c.maxDrop >= o.minDrop;

    if (standing) {
      c.upAt = t;
      this.phase = 'up';
      return deep ? this.rep(t) : this.noRep(t, [SQUAT_REASONS.depth]);
    }
    // Came part way up, then went down again without standing.
    if (c.rising && bent) {
      const ev = this.noRep(t, deep ? [SQUAT_REASONS.stand] : [SQUAT_REASONS.depth, SQUAT_REASONS.stand]);
      this.startCycle(t, { minKnee: m.kneeAngle, maxDrop: m.hipDrop, maxStandKnee: null, rising: false });
      return ev;
    }
    return null;
  }
}

// ---------------------------------------------------------------- push-ups
// From a plank: chest down until the elbows pass 90 degrees, arms locked out
// at the top, body kept straight (no piking or sagging at the hips).
export const PUSHUP_REASONS = { depth: 'Chest down – elbows past 90°', lockout: 'Lock arms out at the top', straight: 'Keep body straight' };

export class PushupJudge extends CycleJudge {
  static DEFAULTS = { targetReps: 30, phaseFrames: 2, plankTilt: 50, downElbow: 115, risingElbow: 120, lockElbow: 140, depthElbow: 90, hipMin: 150 };
  // The angles that only track where the athlete is in a rep, worked out from
  // the two that pass or fail it: a rep starts once the elbows bend halfway
  // from straight to the depth limit, and the push back up is under way a
  // little past that. Loosening either limit never makes a rep harder to start.
  static phases(lock, depth) {
    const down = (lock + depth) / 2;
    return { downElbow: down, risingElbow: Math.min(lock - 2, Math.max(down + 5, depth + 0.6 * (lock - depth))) };
  }

  // Options from one "straight arms" angle (Settings).
  static fromStraight(straight, opts = {}) {
    const s = Number(straight) || PushupJudge.DEFAULTS.lockElbow;
    return new PushupJudge({ ...opts, lockElbow: s, ...PushupJudge.phases(s, PushupJudge.DEFAULTS.depthElbow) });
  }
  static MEASURES = { minElbow: 0, maxElbow: 0, minHip: 0 };
  constructor(opts = {}) { super(PushupJudge.DEFAULTS, opts); }

  update(m, t) {
    if (this.done || !m || m.elbowAngle == null) return null;
    const o = this.o;
    // Arm angle from the arms actually seen (see computeMetrics), used for
    // every check so holding a plank can never look like the start of a rep.
    const straight = m.elbowStraight ?? m.elbowAngle;
    this.live = { phase: this.phase, elbow: m.elbowAngle, straight, hip: m.hipAngle, tilt: m.tilt };
    if (m.tilt != null && m.tilt < o.plankTilt) return null; // not in a plank (torso hidden: assume still in one)
    const bent = this.held('bent', straight < o.downElbow);
    const locked = this.held('lock', straight > o.lockElbow);
    const fresh = (t0) => this.startCycle(t0, { minElbow: straight, maxElbow: null, minHip: m.hipAngle, rising: false });

    if (this.phase !== 'down') {
      if (bent) { fresh(t); this.phase = 'down'; }
      return null;
    }
    const c = this.cycle;
    c.minElbow = minOf(c.minElbow, straight);
    c.maxElbow = maxOf(c.maxElbow, straight);
    c.minHip = minOf(c.minHip, m.hipAngle);
    if (straight > o.risingElbow) c.rising = true;
    const faults = () => {
      const r = [];
      if (c.minElbow > o.depthElbow) r.push(PUSHUP_REASONS.depth);
      if (c.minHip != null && c.minHip < o.hipMin) r.push(PUSHUP_REASONS.straight);
      return r;
    };

    if (locked) {
      c.upAt = t;
      this.phase = 'up';
      const r = faults();
      return r.length ? this.noRep(t, r) : this.rep(t);
    }
    if (c.rising && bent) {
      const ev = this.noRep(t, [...faults(), PUSHUP_REASONS.lockout]);
      fresh(t);
      return ev;
    }
    return null;
  }
}

// ---------------------------------------------------------------- jumping jacks
// Arms down and feet together, then hands above the head with feet wide,
// then back again. One rep per return to arms down.
export const JACK_REASONS = { hands: 'Hands above head', wide: 'Feet wide apart', together: 'Feet back together' };

export class JackJudge extends CycleJudge {
  static DEFAULTS = { targetReps: 30, phaseFrames: 2, wideSpread: 1.3, togetherSpread: 1.0 };
  static MEASURES = { maxSpread: 2, minSpreadBefore: 2, handsOver: 0 };
  constructor(opts = {}) {
    super(JackJudge.DEFAULTS, opts);
    this.closedMin = null;
  }

  update(m, t) {
    if (this.done || !m) return null;
    // One hand hidden: assume it matches the other.
    const hl = m.handYL ?? m.handYR, hr = m.handYR ?? m.handYL;
    if (m.shY == null || hl == null) return null;
    const o = this.o;
    const up = hl < m.shY && hr < m.shY;
    const down = hl > m.shY && hr > m.shY;
    const over = m.headTopY != null && hl < m.headTopY && hr < m.headTopY;
    this.live = { phase: this.phase, spread: m.feetSpread, over };
    const opened = this.held('up', up);
    const closed = this.held('down', down);

    if (this.phase !== 'open') {
      this.closedMin = minOf(this.closedMin, m.feetSpread);
      if (opened) {
        this.startCycle(t, { maxSpread: m.feetSpread, minSpreadBefore: this.closedMin, handsOver: over });
        this.phase = 'open';
      }
      return null;
    }
    const c = this.cycle;
    c.maxSpread = maxOf(c.maxSpread, m.feetSpread);
    c.handsOver = c.handsOver || over;
    if (!closed) return null;
    c.upAt = t;
    this.phase = 'closed';
    this.closedMin = m.feetSpread;
    const r = [];
    if (!c.handsOver) r.push(JACK_REASONS.hands);
    if (c.maxSpread == null || c.maxSpread < o.wideSpread) r.push(JACK_REASONS.wide);
    if (c.minSpreadBefore != null && c.minSpreadBefore > o.togetherSpread) r.push(JACK_REASONS.together);
    return r.length ? this.noRep(t, r) : this.rep(t);
  }
}

// ---------------------------------------------------------------- sit-ups
// Shoulders down to the ground, then sit up until the torso is upright.
// The rep counts as soon as the athlete is sitting up.
export const SITUP_REASONS = { down: 'Shoulders to the ground', up: 'Sit up all the way' };

export class SitupJudge extends CycleJudge {
  static DEFAULTS = { targetReps: 30, phaseFrames: 2, lyingTilt: 65, bottomTilt: 78, risingTilt: 50, topTilt: 30 };
  static MEASURES = { maxTilt: 0, minTilt: 0 };
  constructor(opts = {}) { super(SitupJudge.DEFAULTS, opts); }

  update(m, t) {
    if (this.done || !m || m.tilt == null) return null;
    const o = this.o;
    this.live = { phase: this.phase, tilt: m.tilt };
    const lying = this.held('lying', m.tilt > o.lyingTilt);
    const sitting = this.held('sit', m.tilt < o.topTilt);
    const fresh = (t0) => this.startCycle(t0, { maxTilt: m.tilt, minTilt: null, rising: false });

    if (this.phase !== 'down') {
      if (lying) { fresh(t); this.phase = 'down'; }
      return null;
    }
    const c = this.cycle;
    if (!c.rising) c.maxTilt = maxOf(c.maxTilt, m.tilt);
    c.minTilt = minOf(c.minTilt, m.tilt);
    if (m.tilt < o.risingTilt) c.rising = true;

    if (sitting) {
      c.upAt = t;
      this.phase = 'up';
      return c.maxTilt >= o.bottomTilt ? this.rep(t) : this.noRep(t, [SITUP_REASONS.down]);
    }
    if (c.rising && lying) {
      const ev = this.noRep(t, c.maxTilt >= o.bottomTilt ? [SITUP_REASONS.up] : [SITUP_REASONS.down, SITUP_REASONS.up]);
      fresh(t);
      return ev;
    }
    return null;
  }
}

// ---------------------------------------------------------------- catalogue
//
// ready: what the athlete must be doing for the counting to start.
// columns: per-rep measurements shown on the attempt page, [label, key, format].
const deg0 = (v) => (v == null ? '–' : `${Math.round(v)}°`);
const num = (d) => (v) => (v == null ? '–' : Number(v).toFixed(d));
const yn = (v) => (v == null ? '–' : v ? 'Yes' : 'No');
const tallReady = { title: 'Stand tall to start', check: 'Standing tall', test: (m) => m.tilt != null && m.tilt < 20 && (m.hipAngle == null || m.hipAngle > 160) };

export const EXERCISES = {
  burpees: {
    label: 'Burpees', unit: 'burpees', one: 'burpee',
    flow: 'Stand → chest down to the ground → back up → jump, standing tall, hands up over your ears.',
    make: (target, burpeeOpts) => new BurpeeJudge({ ...burpeeOpts, targetReps: target }),
    ready: tallReady,
    standards: [
      ['Chest to the ground', 'Chest touches the floor at the bottom of every rep.'],
      ['Jump, both feet off', 'Both feet leave the ground at the top.'],
      ['Full hip extension', 'Stand up fully: hips straight, not bent forward.'],
      ['Hands over the ears', 'The tops of the hands reach ear height in the jump. Just below is fine.'],
    ],
    columns: [['Chest', 'chestMin', num(2)], ['Jump', 'maxLift', num(3)], ['Hips', 'maxHipAngle', deg0], ['Hands', 'maxHandMargin', num(3)]],
    note: 'Chest: shoulder height over arm length at the bottom (lower is deeper). Jump: highest foot lift as a share of body height. Hips: straightest hip angle. Hands: how far the lower hand got above the ear line, as a share of body height (above zero passes).',
  },
  squats: {
    label: 'Air squats', unit: 'squats', one: 'squat',
    flow: 'Stand tall → squat until the hips are below the knees → stand all the way up.',
    make: (target) => new SquatJudge({ targetReps: target }),
    ready: tallReady,
    standards: [
      ['Hips below knees', 'At the bottom, the hip crease drops below the top of the knee.'],
      ['Stand up fully', 'Hips and knees straight at the top of every rep.'],
    ],
    columns: [['Lowest knee', 'minKnee', deg0], ['Depth', 'maxDrop', num(2)], ['Top knee', 'maxStandKnee', deg0]],
    note: 'Lowest knee: smallest knee angle. Depth: how far the hips got below the knees, as a share of thigh length (0 is level, above −0.05 passes). Top knee: straightest knee angle on the way up.',
    camera: 'Side-on or angled view works best.',
  },
  pushups: {
    label: 'Push-ups', unit: 'push-ups', one: 'push-up',
    flow: 'Plank, arms straight → lower until the elbows pass 90° → push back up to straight arms.',
    make: (target, o = {}) => PushupJudge.fromStraight(o.pushupStraight, { targetReps: target }),
    ready: {
      title: 'Get into a plank to start', check: 'In a plank, arms straight',
      test: (m, o = {}) => {
        const arms = m.elbowStraight ?? m.elbowAngle;
        return m.tilt != null && m.tilt > 50 && (arms == null || arms >= (o.lockElbow ?? o.pushupStraight ?? PushupJudge.DEFAULTS.lockElbow));
      },
      // Shown beside the check so the marshal can see what the camera measures.
      live: (m) => [
        (m?.elbowStraight ?? m?.elbowAngle) != null ? `arms ${Math.round(m.elbowStraight ?? m.elbowAngle)}°` : '',
        m?.tilt != null ? `body ${Math.round(m.tilt)}° from upright, needs over 50°` : '',
      ].filter(Boolean).join(', '),
    },
    standards: [
      ['Chest down', 'Lower until the elbows bend past 90°.'],
      ['Lock out', 'Arms fully straight at the top of every rep.'],
      ['Body straight', 'No piking or sagging at the hips.'],
    ],
    columns: [['Lowest elbow', 'minElbow', deg0], ['Top elbow', 'maxElbow', deg0], ['Hips', 'minHip', deg0]],
    note: 'Lowest elbow: deepest elbow bend (90° or less passes). Top elbow: straightest arms (140° or more passes at the middle strictness). Hips: most bent hip angle during the rep (150° or more passes).',
    camera: 'Put the phone side-on to the athlete, at floor level.',
  },
  jacks: {
    label: 'Jumping jacks', unit: 'jumping jacks', one: 'jumping jack',
    flow: 'Arms down, feet together → jump out: feet wide, hands above the head → jump back in.',
    make: (target) => new JackJudge({ targetReps: target }),
    ready: tallReady,
    standards: [
      ['Hands above head', 'Hands go up above the top of the head.'],
      ['Feet wide', 'Feet jump out wider than the shoulders.'],
      ['Back together', 'Arms down and feet back together between reps.'],
    ],
    columns: [['Feet wide', 'maxSpread', num(2)], ['Feet together', 'minSpreadBefore', num(2)], ['Hands up', 'handsOver', yn]],
    note: 'Feet wide: widest stance, as a multiple of shoulder width (1.3 or more passes). Feet together: narrowest stance before the rep (1.0 or less passes).',
    camera: 'Face the camera straight on.',
  },
  situps: {
    label: 'Sit-ups', unit: 'sit-ups', one: 'sit-up',
    flow: 'Lie back, shoulders on the ground → sit up until upright → lie back down.',
    make: (target) => new SitupJudge({ targetReps: target }),
    ready: { title: 'Lie down to start', check: 'Lying back', test: (m) => m.tilt != null && m.tilt > 65 },
    standards: [
      ['Shoulders to the ground', 'Lie right back between reps.'],
      ['Sit up all the way', 'Torso upright at the top.'],
    ],
    columns: [['Lowest', 'maxTilt', deg0], ['Highest', 'minTilt', deg0]],
    note: 'Torso angle from upright. Lowest: how far back they lay (78° or more passes). Highest: how upright they sat (30° or less passes).',
    camera: 'Put the phone side-on to the athlete, at floor level.',
  },
  practice: {
    label: 'Hand close (practice)', unit: 'reps', one: 'rep', gestures: true,
    flow: 'For trying the station without exercising: a fist, then an open hand, is one rep.',
    make: (target) => new GestureJudge({ targetReps: target }),
    ready: { title: 'Get in view to start', check: 'In view', test: () => true },
    standards: [
      ['Make a fist', 'Close your hand and hold it for a moment.'],
      ['Open your hand', 'Open it again: that is one rep.'],
      ['Thumbs down', 'Counts as a no rep, for testing.'],
    ],
    columns: [],
    note: '',
    reason: PRACTICE_REASON,
  },
};

export const exercise = (key) => EXERCISES[key] || EXERCISES.burpees;

// ---------------------------------------------------------------- strictness
// Settings → Judging strictness: one slider, 0 (not strict) to 100 (very
// strict), the same for every exercise. 50 uses each judge's standard
// limits. Either side of 50, every
// rule's limit moves in step, reaching the amounts below at 0 and 100.
export const STRICTNESS_DEFAULT = 50;
export const strictnessWord = (v) => (v <= 10 ? 'Not strict' : v < 40 ? 'Lenient' : v <= 60 ? 'Standard' : v < 90 ? 'Strict' : 'Very strict');
// Older saves stored a word.
export const strictnessValue = (v) => {
  const n = { lenient: 25, standard: 50, strict: 75 }[v] ?? Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : STRICTNESS_DEFAULT;
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// s runs from -1 (not strict) to 1 (very strict). Returns how far to move a
// limit: the lenient amount scaled by how far below 0, or the strict amount.
const amt = (s, lenient, strict) => (s < 0 ? -s * lenient : s * strict);
export const STRICTNESS = {
  burpees: (o, s) => ({
    chestMaxRatio: o.chestMaxRatio * (1 + amt(s, 0.6, -0.35)),
    // Never below about 3 cm on a 1.7 m athlete, so standing on the toes can't pass.
    jumpMinLift: o.jumpMinLift * (1 + amt(s, -0.3, 0.6)),
    hipMinAngle: Math.min(178, o.hipMinAngle + amt(s, -15, 12)),
    // Very strict: tops of the hands level with the ears. Not strict: about 22 cm below.
    handsTolerance: Math.max(0, o.handsTolerance + amt(s, 0.03, -0.1)),
    // Very strict end only: the feet must be seen off the ground in two frames in a row.
    jumpMinFrames: s > 0.8 ? Math.max(2, o.jumpMinFrames) : o.jumpMinFrames,
  }),
  squats: (o, s) => ({
    minDrop: o.minDrop + amt(s, -0.2, 0.08),
    standKnee: Math.min(178, o.standKnee + amt(s, -15, 12)),
    standHip: Math.min(178, o.standHip + amt(s, -15, 12)),
  }),
  pushups: (o, s) => {
    const lock = clamp(o.lockElbow + amt(s, -15, 15), 110, 175), depth = o.depthElbow + amt(s, 15, -15);
    return { lockElbow: lock, depthElbow: depth, ...PushupJudge.phases(lock, depth), hipMin: Math.min(175, o.hipMin + amt(s, -20, 15)) };
  },
  jacks: (o, s) => ({ wideSpread: o.wideSpread * (1 + amt(s, -0.3, 0.25)), togetherSpread: o.togetherSpread + amt(s, 0.35, -0.15) }),
  situps: (o, s) => ({ bottomTilt: Math.min(88, o.bottomTilt + amt(s, -12, 4)), topTilt: o.topTilt + amt(s, 15, -12) }),
};

// Applies a slider value (0-100) to a judge that has just been made. Rounds
// the changed limits so they read cleanly in the results.
export function applyStrictness(judge, key, value) {
  const fn = STRICTNESS[key];
  const s = (strictnessValue(value) - 50) / 50;
  if (!fn || !s || !judge?.o) return judge;
  const round = (v) => Number(v.toFixed(Math.abs(v) < 2 ? 3 : 1));
  judge.o = { ...judge.o, ...Object.fromEntries(Object.entries(fn(judge.o, s)).map(([k, v]) => [k, round(v)])) };
  return judge;
}
