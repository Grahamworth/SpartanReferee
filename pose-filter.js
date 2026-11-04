// Fills in body points the camera can't see, so judging carries on through a
// rep when one part of the body hides another (an arm behind the torso, the
// far leg in a side view, feet behind the hips at the bottom of a burpee).
// Pure logic, no DOM, so it can be unit tested in Node.
//
// For each of MediaPipe's 33 points, when its visibility is too low:
//   1. held     - it was seen within holdMs: keep where it was last seen.
//   2. mirrored - the matching point on the other side is seen: put it there,
//                 offset by how far apart the two last were (side views put
//                 the hidden limb just behind the visible one).
//   3. otherwise it is left as it is, and the judge treats it as unseen.
// Filled points get visibility exactly minVis, so they just pass.

export const TRACKING = {
  strict: { minVis: 0.6, holdMs: 150, mirror: false, mpConf: 0.5 },
  balanced: { minVis: 0.4, holdMs: 500, mirror: true, mpConf: 0.4 },
  forgiving: { minVis: 0.25, holdMs: 900, mirror: true, mpConf: 0.3 },
};

// Left/right pairs: eyes, ears, mouth, shoulders, elbows, wrists, hands, hips,
// knees, ankles, heels, toes.
const PAIRS = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22],
  [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];
const MIRROR = new Map(PAIRS.flatMap(([a, b]) => [[a, b], [b, a]]));
const OFFSET_MS = 3000; // how long a remembered left/right offset stays usable

const copy = (p) => ({ x: p.x, y: p.y, z: p.z ?? 0 });

export class PoseFilter {
  constructor(opts = {}) {
    this.o = { ...TRACKING.balanced, ...opts };
    this.reset();
  }

  reset() {
    this.last = [];     // per point: { lm, wlm, t } when last properly seen
    this.offset = [];   // per point: { lm, wlm, t } = this point minus its mirror, when both seen
    this.filled = 0;    // points filled in on the latest frame
    this.frames = 0;
    this.filledFrames = 0; // frames where any point used for judging was filled in
  }

  // pose: { lm, wlm } from MediaPipe for one person. Returns a new pose with
  // hidden points filled where possible, or null for no pose.
  update(pose, t) {
    if (!pose) return null;
    const { minVis, holdMs, mirror } = this.o;
    const seen = (i) => (pose.lm[i]?.visibility ?? 1) >= minVis;
    const n = pose.lm.length;

    // Remember what is properly seen this frame.
    for (let i = 0; i < n; i++) {
      if (!seen(i)) continue;
      this.last[i] = { lm: copy(pose.lm[i]), wlm: copy(pose.wlm[i]), t };
      const j = MIRROR.get(i);
      if (j != null && seen(j)) {
        const d = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) });
        this.offset[i] = { lm: d(pose.lm[i], pose.lm[j]), wlm: d(pose.wlm[i], pose.wlm[j]), t };
      }
    }

    const lm = pose.lm.map((p) => ({ ...p }));
    const wlm = pose.wlm.map((p) => ({ ...p }));
    let filled = 0;
    for (let i = 0; i < n; i++) {
      if (seen(i)) continue;
      const last = this.last[i];
      const j = MIRROR.get(i);
      if (last && t - last.t <= holdMs) {
        Object.assign(lm[i], last.lm, { visibility: minVis, filled: 'held' });
        Object.assign(wlm[i], last.wlm);
        filled++;
      } else if (mirror && j != null && seen(j)) {
        const off = this.offset[i] && t - this.offset[i].t <= OFFSET_MS ? this.offset[i] : null;
        const add = (p, o) => ({ x: p.x + (o?.x ?? 0), y: p.y + (o?.y ?? 0), z: (p.z ?? 0) + (o?.z ?? 0) });
        Object.assign(lm[i], add(pose.lm[j], off?.lm), { visibility: minVis, filled: 'mirrored' });
        Object.assign(wlm[i], add(pose.wlm[j], off?.wlm));
        filled++;
      }
    }
    this.filled = filled;
    this.frames++;
    if (filled) this.filledFrames++;
    return { lm, wlm };
  }
}
