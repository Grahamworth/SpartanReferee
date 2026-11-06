// Burpee rep judging. Pure logic, no DOM, so it can be unit tested in Node.
//
// A rep is valid only when every Spartan penalty-burpee standard is seen:
//   1. Chest to ground at the bottom
//   2. Vertical jump with both feet leaving the ground
//   3. Full hip extension at the top of the jump
//   4. Tops of the hands at ear height while jumping (just below is fine)
//
// Input per frame is the MediaPipe Pose output for one person:
//   lm  = normalized image landmarks (x, y in 0..1, y down, with .visibility)
//   wlm = world landmarks in metres, centred on the hips

export const LM = {
  NOSE: 0, L_EYE: 2, R_EYE: 5, L_EAR: 7, R_EAR: 8,
  L_SH: 11, R_SH: 12, L_EL: 13, R_EL: 14, L_WR: 15, R_WR: 16,
  L_PINKY: 17, R_PINKY: 18, L_INDEX: 19, R_INDEX: 20,
  L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26,
  L_ANK: 27, R_ANK: 28, L_HEEL: 29, R_HEEL: 30, L_FOOT: 31, R_FOOT: 32,
};

import { offPicture } from './pose-filter.js';

export const DEFAULTS = {
  targetReps: 30,
  downEnterTilt: 60,     // torso degrees from vertical to count as "on the ground"
  upExitTilt: 35,        // torso degrees from vertical to count as "back up"
  phaseFrames: 2,        // consecutive frames needed to change phase (de-glitch)
  chestMaxRatio: 0.45,   // shoulder height above wrists / arm length at the bottom
  jumpMinLift: 0.02,     // toes must rise this fraction of body height (about 3.5 cm)
  tiptoeLift: 0.04,      // when only heels/ankles are seen, they must rise this much more
                         // (going up on the toes lifts the heels about this far)
  jumpMinFrames: 1,      // consecutive airborne frames needed (a quick hop may only show in one)
  floorWindowMs: 800,    // how far back to look for the planted-feet floor level
  hipMinAngle: 130,      // torso-to-thigh angle (180 = straight). Cameras read a fully
                         // extended jump at about 130-155°, so this is lower than it looks
  handsTolerance: 0.1,   // top of the hands may sit this fraction of body height below
                         // the estimated ear line (about 17 cm on a 1.7 m athlete)
  handsWindowMs: 250,    // hands must be up within this time of being airborne
  hipWindowMs: 150,      // hips must be extended within this time of being airborne
  minVisibility: 0.5,
};

const v3 = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) });
const len = (v) => Math.hypot(v.x, v.y, v.z);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 });
const deg = (r) => (r * 180) / Math.PI;

function angle(a, b, c) {
  const u = v3(a, b), w = v3(c, b);
  const d = len(u) * len(w);
  if (!d) return null;
  const cos = Math.max(-1, Math.min(1, (u.x * w.x + u.y * w.y + u.z * w.z) / d));
  return deg(Math.acos(cos));
}

// Reduce one frame of landmarks to the handful of numbers the judge needs.
// Any value that can't be measured reliably this frame is null.
export function computeMetrics(lm, wlm, opts = DEFAULTS) {
  if (!lm || !wlm) return null;
  const minVis = opts.minVisibility ?? DEFAULTS.minVisibility;
  const vis = (...ids) => ids.every((i) => (lm[i].visibility ?? 1) >= minVis);
  const m = {
    tilt: null, chestRatio: null, hipAngle: null,
    handYL: null, handYR: null, earY: null, footY: null, toeY: null, heelY: null, noseY: null,
    wristsBelowHips: false, fullBody: false, hipY: null, torsoLen: null,
    kneeAngle: null, elbowAngle: null, elbowStraight: null, hipDrop: null, shY: null, headTopY: null, feetSpread: null,
    handsOff: false, feetOff: false, kneesOff: false, armsOff: false,
  };
  // opts.offScreen: points outside the picture aren't measured at all (the *Off values above say so).
  const out = (i) => !!opts.offScreen && (lm[i].off ?? offPicture(lm[i]));

  // Torso from whichever shoulder and hip are seen (in a side view the far
  // ones are often hidden behind the body).
  const avgOf = (pts, ids) => {
    const s = ids.filter((i) => vis(i));
    if (!s.length) return null;
    return s.map((i) => pts[i]).reduce((a, p) => ({ x: a.x + p.x / s.length, y: a.y + p.y / s.length, z: a.z + (p.z || 0) / s.length }), { x: 0, y: 0, z: 0 });
  };
  const shW = avgOf(wlm, [LM.L_SH, LM.R_SH]), hipW = avgOf(wlm, [LM.L_HIP, LM.R_HIP]);
  const torsoVisible = !!(shW && hipW);
  if (torsoVisible) {
    const t = v3(shW, hipW);
    const l = len(t);
    if (l) m.tilt = deg(Math.acos(Math.min(1, Math.abs(t.y) / l)));
  }

  // Chest to ground, from whichever arms are seen.
  const bothArms = [[LM.L_SH, LM.L_EL, LM.L_WR], [LM.R_SH, LM.R_EL, LM.R_WR]];
  const arms = bothArms.filter((ids) => vis(...ids) && !ids.some(out));
  m.armsOff = !arms.length && bothArms.some((ids) => ids.some(out));
  if (torsoVisible && arms.length) {
    const arm = (s, e, w) => len(v3(wlm[s], wlm[e])) + len(v3(wlm[e], wlm[w]));
    const armLen = arms.reduce((a, ids) => a + arm(...ids), 0) / arms.length;
    const sh = avgOf(wlm, arms.map((ids) => ids[0]));
    const wr = avgOf(wlm, arms.map((ids) => ids[2]));
    if (armLen > 0) m.chestRatio = Math.abs(wr.y - sh.y) / armLen;
    // The same in the picture. For an athlete far off, the 3D estimate is
    // rough and the pose model's smoothing can keep it off the floor in a quick
    // burpee, so the lower of the two decides.
    const ar = opts.aspect ?? 1;
    const d2 = (a, b) => Math.hypot((lm[a].x - lm[b].x) * ar, lm[a].y - lm[b].y);
    const armLen2 = arms.reduce((a, [s, e, w]) => a + d2(s, e) + d2(e, w), 0) / arms.length;
    const shY2 = arms.reduce((a, ids) => a + lm[ids[0]].y, 0) / arms.length;
    const wrY2 = arms.reduce((a, ids) => a + lm[ids[2]].y, 0) / arms.length;
    if (armLen2 > 0) m.chestRatio = Math.min(m.chestRatio ?? Infinity, Math.abs(wrY2 - shY2) / armLen2);
    const wrY = wrY2;
    m.wristsBelowHips = wrY > avgOf(lm, [LM.L_HIP, LM.R_HIP]).y;
  }

  // Hip angle = torso centre line vs each thigh, so shoulder width doesn't
  // make a straight body read as bent. Use the less extended side, so one
  // bent hip can't pass.
  if (torsoVisible) {
    const torso = v3(shW, hipW);
    const sides = [];
    for (const [h, k] of [[LM.L_HIP, LM.L_KNEE], [LM.R_HIP, LM.R_KNEE]]) {
      if (!vis(h, k) || out(k)) continue;
      const a = angle({ x: wlm[h].x + torso.x, y: wlm[h].y + torso.y, z: (wlm[h].z || 0) + torso.z }, wlm[h], wlm[k]);
      if (a != null) sides.push(a);
    }
    if (sides.length) m.hipAngle = Math.min(...sides);
    m.kneesOff = !sides.length && (out(LM.L_KNEE) || out(LM.R_KNEE));
  }

  const handY = (ids) => {
    const ys = ids.filter((i) => vis(i) && !out(i)).map((i) => lm[i].y);
    return ys.length ? Math.min(...ys) : null;
  };
  m.handYL = handY([LM.L_WR, LM.L_INDEX, LM.L_PINKY]);
  m.handYR = handY([LM.R_WR, LM.R_INDEX, LM.R_PINKY]);
  // A hand that's only guessed (hidden behind the body, so held where it was
  // last seen or copied from the other side) is dropped when the other hand is
  // really seen: the judge then goes by the real one.
  const guessed = (ids) => ids.filter((i) => vis(i)).every((i) => lm[i].filled);
  const lIds = [LM.L_WR, LM.L_INDEX, LM.L_PINKY], rIds = [LM.R_WR, LM.R_INDEX, LM.R_PINKY];
  if (m.handYL != null && m.handYR != null) {
    if (guessed(lIds) && !guessed(rIds)) m.handYL = null;
    else if (guessed(rIds) && !guessed(lIds)) m.handYR = null;
  }
  m.handsOff = m.handYL == null && m.handYR == null && [...lIds, ...rIds].some(out);

  // Head heights are never taken from the head itself (it turns, tilts and
  // hides). They are estimated from the shoulders and hips: carry on past the
  // shoulders along the torso line by a share of the torso length. Ear level
  // is about 0.35 of a torso above the shoulders, the top of the head 0.65.
  const yOf = (ids) => { const s = ids.filter((i) => vis(i)); return s.length ? s.reduce((a, i) => a + lm[i].y, 0) / s.length : null; };
  const shI = avgOf(lm, [LM.L_SH, LM.R_SH]), hipI = avgOf(lm, [LM.L_HIP, LM.R_HIP]);
  const above = (k) => (shI && hipI ? shI.y + (shI.y - hipI.y) * k : null);
  m.earY = above(0.35);
  m.noseY = m.earY;

  // Lowest visible foot point, from either foot. In a side view the far foot
  // is usually behind the near one; the pose filter places it from the near
  // foot when it is hidden, so one seen foot is enough.
  const feet = [LM.L_ANK, LM.L_HEEL, LM.L_FOOT, LM.R_ANK, LM.R_HEEL, LM.R_FOOT].filter((i) => vis(i));
  if (feet.length) m.footY = Math.max(...feet.map((i) => lm[i].y));
  // For the jump, toes and heels separately: going up on the toes lifts the
  // heels but not the toes, so only the toes show a real jump.
  const lowest = (ids) => { const s = ids.filter((i) => vis(i) && !out(i)); return s.length ? Math.max(...s.map((i) => lm[i].y)) : null; };
  m.toeY = lowest([LM.L_FOOT, LM.R_FOOT]);
  m.heelY = lowest([LM.L_HEEL, LM.R_HEEL, LM.L_ANK, LM.R_ANK]);
  m.feetOff = m.toeY == null && m.heelY == null && [LM.L_FOOT, LM.R_FOOT, LM.L_HEEL, LM.R_HEEL, LM.L_ANK, LM.R_ANK].some(out);

  // Whole body in view: a shoulder, a hip and a foot. The head isn't needed.
  // Works face on or side on.
  m.fullBody = torsoVisible && m.footY != null;

  // Extra measurements for the other exercises (exercises.js).
  // Knee and elbow angles: average of the visible sides, in 3D.
  const avgAngle = (pairs) => {
    const a = pairs.filter((ids) => vis(...ids)).map(([p, q, r]) => angle(wlm[p], wlm[q], wlm[r])).filter((x) => x != null);
    return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  };
  m.kneeAngle = avgAngle([[LM.L_HIP, LM.L_KNEE, LM.L_ANK], [LM.R_HIP, LM.R_KNEE, LM.R_ANK]]);
  m.elbowAngle = avgAngle([[LM.L_SH, LM.L_EL, LM.L_WR], [LM.R_SH, LM.R_EL, LM.R_WR]]);
  // How straight the arms are, for push-up start and lockout. The 3D angle
  // above reads straight arms as bent side on (depth is poorly estimated and
  // the far arm is guessed), so use the arms actually seen, and for each the
  // straighter of the 3D angle and the angle in the picture. Side on, the arm
  // moves across the picture, so the picture angle is the true one.
  const asp = opts.aspect ?? 1; // frame width / height, so picture angles aren't squashed
  const flat = (i) => ({ x: lm[i].x * asp, y: lm[i].y, z: 0 });
  const armIds = [[LM.L_SH, LM.L_EL, LM.L_WR], [LM.R_SH, LM.R_EL, LM.R_WR]].filter((ids) => vis(...ids));
  const real = armIds.filter((ids) => !ids.some((i) => lm[i].filled));
  const straights = (real.length ? real : armIds)
    .map(([p, q, r]) => Math.max(angle(wlm[p], wlm[q], wlm[r]) ?? 0, angle(flat(p), flat(q), flat(r)) ?? 0))
    .filter((a) => a > 0);
  m.elbowStraight = straights.length ? Math.max(...straights) : null;
  // Squat depth: how far the hips are below the knees in the picture, as a
  // share of thigh length (0 = level, above 0 = hips lower).
  const drops = [[LM.L_HIP, LM.L_KNEE], [LM.R_HIP, LM.R_KNEE]].filter((ids) => vis(...ids)).map(([h, k]) => {
    const thigh = Math.hypot(lm[h].x - lm[k].x, lm[h].y - lm[k].y);
    return thigh ? (lm[h].y - lm[k].y) / thigh : null;
  }).filter((x) => x != null);
  m.hipDrop = drops.length ? Math.max(...drops) : null;
  m.shY = yOf([LM.L_SH, LM.R_SH]);
  // Hip height and torso length in the picture, for spotting a jump from the
  // whole body rising when the feet are out of shot.
  m.hipY = hipI ? hipI.y : null;
  m.torsoLen = shI && hipI ? Math.hypot((shI.x - hipI.x) * asp, shI.y - hipI.y) : null;
  m.headTopY = above(0.65);
  // Feet apart, as a multiple of shoulder width (world coordinates).
  if (vis(LM.L_ANK, LM.R_ANK, LM.L_SH, LM.R_SH)) {
    const sw = Math.hypot(wlm[LM.L_SH].x - wlm[LM.R_SH].x, wlm[LM.L_SH].z - wlm[LM.R_SH].z);
    if (sw) m.feetSpread = Math.hypot(wlm[LM.L_ANK].x - wlm[LM.R_ANK].x, wlm[LM.L_ANK].z - wlm[LM.R_ANK].z) / sw;
  }
  return m;
}

export const REASONS = {
  chest: 'Chest to ground',
  unseen: "Couldn't see the bottom",
  jump: 'Jump – both feet off the ground',
  hands: 'Hands over ears',
  hips: 'Full hip extension',
};

export class BurpeeJudge {
  constructor(opts = {}) {
    this.o = { ...DEFAULTS, ...opts };
    this.reset();
  }

  reset() {
    this.count = 0;
    this.questionable = 0; // reps counted with something outside the picture
    this.noReps = 0;
    this.reasonCounts = {};
    this.phase = 'waiting'; // waiting (before first plank) | down | up
    this.cycle = null;
    this.bodyH = null;
    this.standHipY = null; // hip height when standing tall, for jumps with the feet out of shot
    this.plankRun = 0;
    this.uprightRun = 0;
    this.done = false;
    this.live = {}; // latest per-frame values, for the debug overlay
  }

  // Feed one frame. Returns an event or null:
  //   {type: 'rep', count, done, detail}  or  {type: 'norep', reasons: [...], detail}
  // detail holds what was measured for that burpee (see _detail).
  update(m, t) {
    if (this.done || !m) return null;
    const o = this.o;
    this.lastT = t;

    if (m.tilt != null && m.hipAngle != null && m.hipAngle > 135 && m.tilt < o.upExitTilt &&
        m.footY != null && m.noseY != null) {
      const h = m.footY - m.noseY;
      if (h > 0.05) this.bodyH = this.bodyH == null ? h : this.bodyH + (h - this.bodyH) * (h > this.bodyH ? 0.3 : 0.05);
    }
    // Standing hip height, learnt slowly while standing tall. Frames where the
    // hips are clearly higher than usual (a jump) don't move it.
    const scale = this._scale(m);
    if (this.phase !== 'down' && m.hipY != null && scale && m.tilt != null && m.tilt < 15 &&
        m.hipAngle != null && m.hipAngle >= 165) {
      if (this.standHipY == null) this.standHipY = m.hipY;
      else if (m.hipY > this.standHipY - 0.02 * scale) this.standHipY = this.standHipY * 0.9 + m.hipY * 0.1;
    }

    // When the torso can't be measured this frame, keep counting frames as
    // before rather than starting over. When the arms are hidden, assume a
    // flat torso is a plank.
    if (m.tilt != null) {
      const plank = m.tilt > o.downEnterTilt && (m.wristsBelowHips || m.chestRatio == null);
      const upright = m.tilt < o.upExitTilt;
      this.plankRun = plank ? this.plankRun + 1 : 0;
      this.uprightRun = upright ? this.uprightRun + 1 : 0;
    }
    this.live = { phase: this.phase, tilt: m.tilt, chest: m.chestRatio, hip: m.hipAngle };

    let event = null;

    if (this.phase !== 'down' && this.plankRun >= o.phaseFrames) {
      if (this.cycle && !this.cycle.resolved) event = this._noRep(this._upReasons());
      this.cycle = { downAt: t, upAt: null, chestMin: Infinity, chestSeen: 0, frames: [], resolved: false };
      this.phase = 'down';
      return event;
    }

    if (this.phase === 'down') {
      if (m.chestRatio != null) {
        this.cycle.chestSeen++;
        this.cycle.chestMin = Math.min(this.cycle.chestMin, m.chestRatio);
      } else if (m.armsOff) this.cycle.chestOff = true;
      this.live.chestMin = this.cycle.chestMin;
      if (this.uprightRun >= o.phaseFrames) {
        this.phase = 'up';
        this.cycle.upAt = t;
        const low = this.cycle.chestSeen && this.cycle.chestMin <= o.chestMaxRatio;
        // Arms outside the picture at any point on the way down: the lowest moment may not have been seen, so it's taken as good.
        if (!low && this.cycle.chestOff) this.cycle.chestAssumed = true;
        else if (!this.cycle.chestSeen) event = this._noRep([REASONS.unseen]);
        else if (!low) event = this._noRep([REASONS.chest]);
      }
      return event;
    }

    if (this.phase === 'up') {
      const c = this.cycle;
      const tol = o.handsTolerance * (scale ?? 0.8);
      // Both hands when both are seen; in a side view the far hand is often
      // hidden behind the head, so then the near hand decides.
      const hl = m.handYL ?? m.handYR, hr = m.handYR ?? m.handYL;
      const handsSeen = m.earY != null && hl != null;
      const hands = handsSeen && hl <= m.earY + tol && hr <= m.earY + tol;
      // How far the lower hand is above the allowed line, as a share of body height.
      const handMargin = handsSeen && scale ? (m.earY + tol - Math.max(hl, hr)) / scale : null;
      const hip = m.hipAngle != null && m.hipAngle >= o.hipMinAngle;
      // Outside the picture, it can't be judged: taken as good, and the rep is marked so someone can check it. Hands and
      // hips seen doing it wrong still fail, and a jump measured from the hips still has to rise.
      const handsOff = !handsSeen && m.handsOff && m.earY != null, hipOff = m.hipAngle == null && m.kneesOff;

      // Jump from the toes when they're seen. With only heels or ankles seen,
      // they must rise by more than going up on the toes would lift them.
      // (Callers that only give footY are treated as giving the toes.)
      const toeY = m.toeY !== undefined ? m.toeY : m.footY ?? null;
      const heelY = m.heelY ?? null;
      const liftOf = (key, y) => c.frames
        .filter((f) => f[key] != null && t - f.t <= o.floorWindowMs)
        .reduce((mx, f) => Math.max(mx, f[key]), y) - y;
      // Feet out of shot: the whole body must rise. Hips are compared with their
      // standing height (not the crouch just before, which would make standing
      // up look like a jump), and must rise by more than tiptoe would lift them.
      let air = false, lift = null, by = null;
      if (toeY != null) {
        lift = liftOf('toeY', toeY);
        by = 'toes';
      } else if (heelY != null) {
        lift = liftOf('heelY', heelY) - o.tiptoeLift * (scale ?? 0); // lift beyond tiptoe height
        by = 'heels';
      } else if (m.hipY != null && this.standHipY != null && scale) {
        lift = this.standHipY - m.hipY - o.tiptoeLift * scale;
        by = 'body';
      }
      if (lift != null && scale) air = lift > o.jumpMinLift * scale;
      const airOff = !air && lift == null && m.feetOff && m.tilt != null && m.tilt < o.upExitTilt; // stood up, feet out of shot
      c.frames.push({ t, footY: m.footY, toeY, heelY, air: air || airOff, airReal: air, hands: hands || handsOff, handsReal: hands, hip: hip || hipOff, hipReal: hip, by,
        lift: scale && lift != null ? lift / scale : null, hipAngle: m.hipAngle ?? null, handMargin });
      Object.assign(this.live, { lift: scale && lift != null ? lift / scale : null, liftBy: by, air, hands, hipOk: hip });

      if (!c.resolved) {
        const r = this._evaluate();
        if (r.jump && r.hands && r.hips) {
          c.resolved = true;
          this.count++;
          if (r.assumed.length) this.questionable++;
          this.done = this.count >= o.targetReps;
          return { type: 'rep', count: this.count, done: this.done, ...(r.assumed.length ? { assumed: r.assumed } : {}), detail: this._detail(r) };
        }
      }
    }
    return null;
  }

  // Size of the athlete in the picture (feet to ears), for limits given as a
  // share of body height. From the feet when they've been seen; otherwise
  // about three torso lengths.
  _scale(m) {
    return this.bodyH ?? (m?.torsoLen ? m.torsoLen * 3 : null);
  }

  // End of attempt: report what the last unresolved cycle was missing.
  finish() {
    if (this.cycle && !this.cycle.resolved && this.phase === 'up') return this._noRep(this._upReasons());
    return null;
  }

  _evaluate() {
    const o = this.o;
    const f = this.cycle.frames;
    const airTimes = [];
    let run = [];
    for (const fr of f) {
      if (fr.air) run.push(fr.t);
      else { if (run.length >= o.jumpMinFrames) airTimes.push(...run); run = []; }
    }
    if (run.length >= o.jumpMinFrames) airTimes.push(...run);
    const near = (key, win) => airTimes.some((ta) => f.some((fr) => fr[key] && Math.abs(fr.t - ta) <= win));
    // what only passed because it was outside the picture
    const assumed = [];
    if (airTimes.length && !f.some((fr) => fr.airReal)) assumed.push('feet');
    if (near('hands', o.handsWindowMs) && !near('handsReal', o.handsWindowMs)) assumed.push('hands');
    if (near('hip', o.hipWindowMs) && !near('hipReal', o.hipWindowMs)) assumed.push('hips');
    if (this.cycle.chestAssumed) assumed.push('chest');
    return { jump: airTimes.length > 0, hands: near('hands', o.handsWindowMs), hips: near('hip', o.hipWindowMs), assumed };
  }

  _upReasons() {
    const r = this._evaluate();
    if (!r.jump) return [REASONS.jump];
    const out = [];
    if (!r.hands) out.push(REASONS.hands);
    if (!r.hips) out.push(REASONS.hips);
    return out;
  }

  _noRep(reasons) {
    this.cycle.resolved = true;
    this.noReps++;
    for (const r of reasons) this.reasonCounts[r] = (this.reasonCounts[r] || 0) + 1;
    return { type: 'norep', reasons, detail: this._detail(this.cycle.frames.length ? this._evaluate() : null) };
  }

  // What was measured for the current burpee. Times are in the caller's clock.
  _detail(r) {
    const c = this.cycle;
    const f = c.frames;
    const max = (key) => {
      const v = f.map((fr) => fr[key]).filter((x) => x != null);
      return v.length ? Math.max(...v) : null;
    };
    const round = (v, d) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)));
    return {
      downAt: round(c.downAt, 0),
      upAt: round(c.upAt, 0),
      endAt: round(this.lastT, 0),
      chestMin: round(c.chestMin, 3),       // shoulder height / arm length at the bottom
      chestFrames: c.chestSeen,             // frames where the chest could be measured
      maxLift: round(max('lift'), 3),       // highest foot lift / body height
      airFrames: f.filter((fr) => fr.air).length,
      maxHipAngle: round(max('hipAngle'), 1),
      maxHandMargin: round(max('handMargin'), 3), // > 0: hands got above the ear line
      jump: r ? r.jump : null,
      hands: r ? r.hands : null,
      hips: r ? r.hips : null,
      assumed: r ? r.assumed : [],
    };
  }
}

// Practice mode: stands in for the burpee judge so the station can be tried
// without doing burpees. A closed fist then an open hand is one good rep; a
// thumbs down is a no rep. gesture is a MediaPipe gesture name or null.
export const PRACTICE_REASON = 'Practice no rep (thumbs down)';

export class GestureJudge {
  constructor({ targetReps = 30, holdFrames = 3 } = {}) {
    this.o = { targetReps, holdFrames };
    this.count = 0;
    this.noReps = 0;
    this.done = false;
    this.phase = 'open'; // open -> fist -> open (rep)
    this.last = null;
    this.run = 0;
    this.fistAt = null;
    this.live = {};
  }

  update(gesture, t) {
    if (this.done) return null;
    this.run = gesture === this.last ? this.run + 1 : 1;
    this.last = gesture;
    this.live = { phase: this.phase, gesture };
    if (this.run !== this.o.holdFrames) return null; // act once per held gesture
    const detail = { downAt: this.fistAt, upAt: null, endAt: t };
    if (gesture === 'Closed_Fist' && this.phase === 'open') {
      this.phase = 'fist';
      this.fistAt = t;
    } else if (gesture === 'Open_Palm' && this.phase === 'fist') {
      this.phase = 'open';
      this.count++;
      this.done = this.count >= this.o.targetReps;
      return { type: 'rep', count: this.count, done: this.done, detail };
    } else if (gesture === 'Thumb_Down') {
      this.phase = 'open';
      this.noReps++;
      return { type: 'norep', reasons: [PRACTICE_REASON], detail };
    }
    return null;
  }

  finish() { return null; }
}
