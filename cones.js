// Cones on the ground in front of the athletes (a camera setting). Pure logic, no DOM, so it can be unit tested in Node.
//
// At some events each athlete does their reps behind a cone, often with a number on it. A cone is easy to find by
// colour and shape, and it never moves, so it pins each athlete to their own patch of ground (multi.js): the person
// doing reps behind a cone is the athlete, someone walking past isn't, and an athlete lost for a moment is looked
// for behind their cone again. The cone's number, once read, is the athlete's number until one is read from them.
//
// findCones() looks at a small copy of the frame for blobs of the cone colour (strongly coloured: skin and most
// clothes in shade aren't), joins the parts of one cone split by a reflective white band, and keeps the cone shapes:
// narrower at the top than the bottom, filled like a cone, not too big or too small. ConeTracker keeps the ones that
// stay still over a few looks: a coloured top doing burpees moves, a cone doesn't.
//
// Cones of mixed colours are found by their numbers instead (needNumber): any strongly coloured cone shape that
// stays put is looked at for a number, and only one whose number is read is used. Anything else that happens to be
// cone shaped and brightly coloured never gets a number, so it's never used.

export const CONE_COLOURS = {
  orange: { label: 'Orange', hues: [[6, 34]] },
  red: { label: 'Red', hues: [[342, 360], [0, 8]] },
  yellow: { label: 'Yellow', hues: [[42, 66]] },
  green: { label: 'Green', hues: [[80, 165]] },
  blue: { label: 'Blue', hues: [[190, 250]] },
  pink: { label: 'Pink', hues: [[290, 340]] },
  // cones of mixed colours, told apart by their numbers: any strong colour, and only a cone whose number is read is used
  any: { label: 'Any colour', hues: [[0, 360]] },
};

export const CONE_DEFAULTS = {
  minSat: 0.5,        // this strongly coloured (skin is about 0.2 to 0.45)
  minVal: 0.3,        // and this bright
  minArea: 0.00002,   // share of the picture: a small cone far off is still bigger than this
  maxArea: 0.02,      // anything bigger is a wall, a banner or someone close up
  minPixels: 6,
  minHeight: 4,       // pixels of the small copy looked at: anything shorter is a speck of ground
  minAspect: 0.2,     // height / width: a flat marker disc ...
  maxAspect: 3.5,     // ... to a tall traffic cone
  minFill: 0.3,       // share of its box it fills: a cone is about half
  maxFill: 0.95,
  taper: 0.95,        // the top third no wider than this share of the bottom third
  joinGap: 0.8,       // parts of one cone split by a white band: this close (shares of the smaller part's height)
  stillDist: 0.6,     // between looks a cone moves less than this (shares of its width)
  confirmLooks: 3,    // seen this many times ...
  confirmMs: 1200,    // ... over at least this long: a cone
  dropMs: 2500,       // a possible cone not seen again this long is forgotten
  forgetMs: 30000,    // a cone not seen this long (someone stood in front of it, it was moved) is forgotten
};

function hueOf(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return { h: 0, s: 0, v: max / 255 };
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  return { h, s: d / max, v: max / 255 };
}

/**
 * The cones in one picture. rgba: W x H pixels (canvas getImageData order). colour: a CONE_COLOURS key.
 * Returns [{ x, y, x0, y0, x1, y1, w, h }] as shares of the picture: (x, y) the middle of its base, where it stands.
 */
export function findCones(rgba, W, H, colour = 'orange', o = CONE_DEFAULTS) {
  const hues = (CONE_COLOURS[colour] || CONE_COLOURS.orange).hues;
  const mask = new Uint8Array(W * H);
  for (let i = 0, j = 0; j < W * H; i += 4, j++) {
    const { h, s, v } = hueOf(rgba[i], rgba[i + 1], rgba[i + 2]);
    if (s >= o.minSat && v >= o.minVal && hues.some(([a, b]) => h >= a && h <= b)) mask[j] = 1;
  }
  // connected parts, each with its box and every row's extent
  const label = new Int32Array(W * H), parts = [], stack = new Int32Array(W * H);
  for (let start = 0; start < W * H; start++) {
    if (!mask[start] || label[start]) continue;
    const id = parts.length + 1, p = { x0: W, y0: H, x1: -1, y1: -1, n: 0, rows: new Map() };
    let top = 0; stack[top++] = start; label[start] = id;
    while (top) {
      const j = stack[--top], x = j % W, y = (j / W) | 0;
      p.n++; if (x < p.x0) p.x0 = x; if (x > p.x1) p.x1 = x; if (y < p.y0) p.y0 = y; if (y > p.y1) p.y1 = y;
      const r = p.rows.get(y); if (r) { if (x < r[0]) r[0] = x; if (x > r[1]) r[1] = x; } else p.rows.set(y, [x, x]);
      if (x > 0 && mask[j - 1] && !label[j - 1]) { label[j - 1] = id; stack[top++] = j - 1; }
      if (x < W - 1 && mask[j + 1] && !label[j + 1]) { label[j + 1] = id; stack[top++] = j + 1; }
      if (y > 0 && mask[j - W] && !label[j - W]) { label[j - W] = id; stack[top++] = j - W; }
      if (y < H - 1 && mask[j + W] && !label[j + W]) { label[j + W] = id; stack[top++] = j + W; }
    }
    if (p.n >= 2) parts.push(p);
  }
  // one cone split by a white band: parts one above the other, overlapping left to right, a small gap between
  parts.sort((a, b) => a.y0 - b.y0);
  for (let i = 0; i < parts.length; i++) {
    const a = parts[i]; if (!a) continue;
    for (let j = i + 1; j < parts.length; j++) {
      const b = parts[j]; if (!b) continue;
      const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1, narrower = Math.min(a.x1 - a.x0, b.x1 - b.x0) + 1;
      const gap = b.y0 - a.y1 - 1, smaller = Math.min(a.y1 - a.y0, b.y1 - b.y0) + 1;
      if (overlap < 0.6 * narrower || gap < 0 || gap > o.joinGap * smaller + 1) continue;
      a.x0 = Math.min(a.x0, b.x0); a.x1 = Math.max(a.x1, b.x1); a.y1 = Math.max(a.y1, b.y1); a.n += b.n;
      for (const [y, r] of b.rows) { const s = a.rows.get(y); if (s) { s[0] = Math.min(s[0], r[0]); s[1] = Math.max(s[1], r[1]); } else a.rows.set(y, [...r]); }
      parts[j] = null; j = i; // look again: the joined part may now reach another
    }
  }
  const out = [];
  for (const p of parts) {
    if (!p || p.n < o.minPixels) continue;
    const w = p.x1 - p.x0 + 1, h = p.y1 - p.y0 + 1, box = w * h;
    if (box / (W * H) < o.minArea || box / (W * H) > o.maxArea) continue;
    const aspect = h / w, fill = p.n / box;
    if (h < o.minHeight || aspect < o.minAspect || aspect > o.maxAspect || fill < o.minFill || fill > o.maxFill) continue;
    // narrower at the top: the average width of its top third against its bottom third
    const width = (from, to) => { let s = 0, n = 0; for (let y = from; y <= to; y++) { const r = p.rows.get(y); if (r) { s += r[1] - r[0] + 1; n++; } } return n ? s / n : 0; };
    const third = Math.max(1, Math.floor(h / 3));
    const topW = width(p.y0, p.y0 + third - 1), bottomW = width(p.y1 - third + 1, p.y1);
    if (h >= 3 && !(topW <= o.taper * bottomW)) continue;
    out.push({ x: (p.x0 + p.x1 + 1) / 2 / W, y: (p.y1 + 1) / H, x0: p.x0 / W, y0: p.y0 / H, x1: (p.x1 + 1) / W, y1: (p.y1 + 1) / H, w: w / W, h: h / H });
  }
  return out;
}

/** The cones that stay put, from one look after another. Each: { id, x, y, x0, y0, x1, y1, w, h, number, still }.
 * opts.needNumber: a cone is only used (sure) once its number is read. */
export class ConeTracker {
  constructor(opts = {}) { this.o = { ...CONE_DEFAULTS, ...opts }; this.cones = []; this.nextId = 1; }

  /** found: findCones() of this look, t: ms. skip(cone): true for a blob that's part of a person (a top, say). */
  update(found, t, skip = () => false) {
    const o = this.o, used = new Set();
    for (const f of found) {
      if (skip(f)) continue;
      let best = null, bestD = Infinity;
      for (const c of this.cones) {
        if (used.has(c)) continue;
        const d = Math.hypot(f.x - c.x, f.y - c.y) / Math.max(c.w, f.w, 0.004);
        if (d < o.stillDist && d < bestD) { best = c; bestD = d; }
      }
      if (best) {
        used.add(best);
        // a cone doesn't move, so where it is settles slowly (one look can catch it half hidden)
        for (const k of ['x', 'y', 'x0', 'y0', 'x1', 'y1', 'w', 'h']) best[k] += (f[k] - best[k]) * 0.3;
        best.looks++; best.seenAt = t;
        if (!best.still && best.looks >= o.confirmLooks && t - best.firstAt >= o.confirmMs) best.still = true;
      } else {
        const c = { id: this.nextId++, ...f, looks: 1, firstAt: t, seenAt: t, still: false, number: null, reads: [], tries: 0 };
        this.cones.push(c); used.add(c);
      }
    }
    this.cones = this.cones.filter((c) => t - c.seenAt < (c.still ? o.forgetMs : o.dropMs));
    return this.sure;
  }

  /** cones that have stayed put (each worth reading a number from) */
  get still() { return this.cones.filter((c) => c.still); }
  /** cones to use: those that stayed put, and (needNumber) whose number is read */
  get sure() { return this.cones.filter((c) => c.still && (!this.o.needNumber || c.number)); }

  /** a number read on cone c (or null, nothing read): read the same twice in its last six reads, it's the cone's. */
  read(c, text) {
    c.tries++;
    c.reads = [...c.reads, text].slice(-6);
    if (text && c.reads.filter((x) => x === text).length >= 2) c.number = text;
    return c.number;
  }

  reset() { this.cones = []; }
}

/** Where to read cone c's number: the cone, a little either side, and above it (a card on top). Shares of the picture. */
export function coneReadBox(c) {
  const x0 = Math.max(0, c.x0 - c.w * 0.35), x1 = Math.min(1, c.x1 + c.w * 0.35);
  const y0 = Math.max(0, c.y0 - c.h * 0.6), y1 = Math.min(1, c.y1 + c.h * 0.05);
  return { x0, y0, x1, y1 };
}
