// Finds a printed race number inside a grayscale crop and redraws it as clean,
// level, black-on-white digits for Tesseract. Pure logic, no DOM.
//
// 1. Adaptive threshold (local mean), once for dark-on-light print and once
//    for light-on-dark, so uneven light and either colour scheme work.
// 2. Connected components, filtered down to digit-shaped blobs.
// 3. Blobs of similar height that sit side by side (on a line up to ~25° off
//    level) are grouped into runs.
// 4. Each run is redrawn on its own: rotated level, scaled to a fixed digit
//    height and padded. Faces, hands and background never reach Tesseract.

export const PREP_DEFAULTS = {
  minDigits: 1,
  maxDigits: 6,
  minHeight: 12,      // px in the crop
  contrast: 12,       // gray levels darker/lighter than the local mean
  maxTiltDeg: 25,
  outHeight: 56,      // digit height in the redrawn image
  maxRuns: 2,
};

function integral(gray, W, H) {
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += gray[y * W + x];
      I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row;
    }
  }
  return I;
}

// fg[i] = 1 where the pixel is ink. dark: ink is darker than its surroundings.
// dev[i] is how far the pixel is from its local mean.
function threshold(gray, W, H, I, dark, C) {
  const r = Math.max(8, Math.min(60, Math.round(H / 4)));
  const fg = new Uint8Array(W * H);
  const dev = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
      const sum = I[y1 * (W + 1) + x1] - I[y0 * (W + 1) + x1] - I[y1 * (W + 1) + x0] + I[y0 * (W + 1) + x0];
      const mean = sum / ((y1 - y0) * (x1 - x0));
      const g = gray[y * W + x];
      fg[y * W + x] = dark ? (g < mean - C ? 1 : 0) : (g > mean + C ? 1 : 0);
      dev[y * W + x] = Math.abs(g - mean);
    }
  }
  return { fg, dev };
}

// 8-connected labelling. Returns labels (0 = background) and per-label stats.
function components(fg, dev, W, H) {
  const labels = new Int32Array(W * H);
  const comps = [null];
  const stack = [];
  for (let start = 0; start < W * H; start++) {
    if (!fg[start] || labels[start]) continue;
    const id = comps.length;
    const c = { id, minx: W, miny: H, maxx: -1, maxy: -1, count: 0, dev: 0 };
    labels[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop();
      const x = p % W, y = (p - x) / W;
      c.count++;
      c.dev += dev[p];
      if (x < c.minx) c.minx = x; if (x > c.maxx) c.maxx = x;
      if (y < c.miny) c.miny = y; if (y > c.maxy) c.maxy = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= W) continue;
          const q = ny * W + nx;
          if (fg[q] && !labels[q]) { labels[q] = id; stack.push(q); }
        }
      }
    }
    c.w = c.maxx - c.minx + 1;
    c.h = c.maxy - c.miny + 1;
    c.cx = (c.minx + c.maxx) / 2;
    c.cy = (c.miny + c.maxy) / 2;
    c.dev /= c.count;
    comps.push(c);
  }
  return { labels, comps };
}

function digitLike(c, W, H, o) {
  if (c.h < o.minHeight || c.h > H * 0.95) return false;
  if (c.minx === 0 || c.miny === 0 || c.maxx === W - 1 || c.maxy === H - 1) return false; // cut off by the box edge
  if (c.w < Math.max(2, c.h * 0.08)) return false;
  if (c.w > c.h * 3.2) return false;                 // up to ~3 touching digits
  const fill = c.count / (c.w * c.h);
  return fill > 0.12 && fill < 0.85;
}

// Groups digit-like blobs into side-by-side runs.
export function findRuns(comps, opts = {}) {
  const o = { ...PREP_DEFAULTS, ...opts };
  const tan = Math.tan((o.maxTiltDeg * Math.PI) / 180);
  const n = comps.length;
  const parent = comps.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const order = comps.map((_, i) => i).sort((a, b) => comps[a].cx - comps[b].cx);
  for (let ai = 0; ai < n; ai++) {
    const a = comps[order[ai]];
    for (let bi = ai + 1; bi < n; bi++) {
      const b = comps[order[bi]];
      const h = (a.h + b.h) / 2;
      const gap = b.minx - a.maxx;
      if (gap > h * 1.0) break;
      const ratio = a.h / b.h;
      if (ratio < 0.75 || ratio > 1.33) continue;
      if (gap < -h * 0.25) continue;
      if (Math.abs(b.cy - a.cy) > h * 0.3 + Math.abs(b.cx - a.cx) * tan) continue;
      parent[find(order[ai])] = find(order[bi]);
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(comps[i]);
  }
  const runs = [];
  for (const members of groups.values()) {
    members.sort((a, b) => a.cx - b.cx);
    const hs = members.map((c) => c.h).sort((a, b) => a - b);
    const h = hs[hs.length >> 1];
    const digits = members.reduce((s, c) => s + Math.max(1, Math.round(c.w / (h * 0.62))), 0);
    if (digits < o.minDigits || digits > o.maxDigits) continue;
    let angle = 0;
    if (members.length >= 2) {
      const mx = members.reduce((s, c) => s + c.cx, 0) / members.length;
      const my = members.reduce((s, c) => s + c.cy, 0) / members.length;
      let sxy = 0, sxx = 0;
      for (const c of members) { sxy += (c.cx - mx) * (c.cy - my); sxx += (c.cx - mx) ** 2; }
      if (sxx > 0) angle = Math.atan(sxy / sxx);
    }
    const lim = (o.maxTiltDeg * Math.PI) / 180;
    angle = Math.max(-lim, Math.min(lim, angle));
    // Taller print, more digits (up to the expected count) and stronger contrast
    // score higher. Contrast matters: thresholding the wrong polarity finds a
    // faint halo of paper around each real digit, digit-shaped but much closer
    // to the local mean than the ink itself.
    const dev = members.reduce((s, c) => s + c.dev, 0) / members.length;
    const score = h * Math.min(digits, o.maxDigits) * dev * (digits >= Math.max(2, o.minDigits) ? 1 : 0.4);
    runs.push({ members, h, angle, digits, score });
  }
  return runs.sort((a, b) => b.score - a.score);
}

// True if a digit-sized blob sits inside the run, or right beside it on the
// same line, but wasn't grouped with it: a digit the grouping missed (e.g. a
// short "2" among taller old-style figures). Reading such a run would drop a
// digit and give a wrong number, so it's skipped. comps holds blobs from both
// polarities; anything overlapping a member (its holes, its halo) is ignored.
function hasGap(run, comps) {
  const ids = new Set(run.members);
  const overlaps = (c) => run.members.some((m) => c.minx <= m.maxx && c.maxx >= m.minx && c.miny <= m.maxy && c.maxy >= m.miny);
  const minx = Math.min(...run.members.map((c) => c.minx)), maxx = Math.max(...run.members.map((c) => c.maxx));
  const miny = Math.min(...run.members.map((c) => c.miny)), maxy = Math.max(...run.members.map((c) => c.maxy));
  for (const c of comps) {
    if (ids.has(c) || overlaps(c) || c.h < run.h * 0.35 || c.count < run.h * run.h * 0.02) continue;
    if (c.h > run.h * 2.5 || c.w > c.h * 1.5) continue; // not digit-shaped (band edge, hand)
    const gapX = Math.max(0, c.minx - maxx, minx - c.maxx);
    const near = gapX < Math.max(run.h, c.h) * 0.8;
    const sameLine = c.maxy > miny && c.miny < maxy;
    if (near && sameLine) return true;
  }
  return false;
}

// Redraws one run, level and black on white. Returns { width, height, data }
// with one gray byte per pixel.
function render(labels, W, H, run, o) {
  const ids = new Set(run.members.map((c) => c.id));
  const cos = Math.cos(run.angle), sin = Math.sin(run.angle);
  // A tilted digit's bounding box is taller than the digit. Undo that:
  // boxH = h cos + w sin, boxW = w cos + h sin.
  const ac = Math.abs(cos), as = Math.abs(sin);
  const trueH = run.members
    .map((c) => (c.h * ac - c.w * as) / (ac * ac - as * as))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const s = o.outHeight / (trueH[trueH.length >> 1] || run.h);
  const xs = run.members.flatMap((c) => [c.minx, c.maxx + 1]);
  const ys = run.members.flatMap((c) => [c.miny, c.maxy + 1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  // Bounds of the run in the levelled frame.
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const c of run.members) {
    for (const [x, y] of [[c.minx, c.miny], [c.maxx + 1, c.miny], [c.minx, c.maxy + 1], [c.maxx + 1, c.maxy + 1]]) {
      const u = (x - cx) * cos + (y - cy) * sin, v = -(x - cx) * sin + (y - cy) * cos;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
  }
  const pad = Math.round(o.outHeight * 0.45);
  const width = Math.round((u1 - u0) * s) + pad * 2;
  const height = Math.round((v1 - v0) * s) + pad * 2;
  const data = new Uint8ClampedArray(width * height).fill(255);
  const ink = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return 0;
    return ids.has(labels[yi * W + xi]) ? 1 : 0;
  };
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const u = (px - pad) / s + u0, v = (py - pad) / s + v0;
      const x = cx + u * cos - v * sin, y = cy + u * sin + v * cos;
      // 2x2 supersample for smooth edges.
      const k = ink(x - 0.25, y - 0.25) + ink(x + 0.25, y - 0.25) + ink(x - 0.25, y + 0.25) + ink(x + 0.25, y + 0.25);
      if (k >= 2) data[py * width + px] = 0;
    }
  }
  return { width, height, data };
}

// gray: Uint8Array of W*H. Returns up to maxRuns clean images, best first.
export function prepareDigits(gray, W, H, opts = {}) {
  const o = { ...PREP_DEFAULTS, ...opts };
  const I = integral(gray, W, H);
  const passes = [true, false].map((dark) => {
    const { fg, dev } = threshold(gray, W, H, I, dark, o.contrast);
    return { dark, ...components(fg, dev, W, H) };
  });
  const everything = passes.flatMap((p) => p.comps.slice(1));
  const found = [];
  for (const { dark, labels, comps } of passes) {
    const digits = comps.slice(1).filter((c) => digitLike(c, W, H, o));
    for (const run of findRuns(digits, o).slice(0, o.maxRuns)) {
      if (!hasGap(run, everything)) found.push({ run, labels, dark });
    }
  }
  return found
    .sort((a, b) => b.run.score - a.run.score)
    .slice(0, o.maxRuns)
    .map(({ run, labels, dark }) => ({ ...render(labels, W, H, run, o), dark, angle: run.angle, digits: run.digits }));
}

// ---------------------------------------------------------------- single digits
//
// For the digit model: split a redrawn number into one glyph per digit and
// scale each to a fixed GW x GH grid (ink 1, paper 0).

export const GW = 20, GH = 28;

// mask: Uint8Array (1 = ink) of width W. box: the glyph's ink bounds.
export function normalizeGlyph(mask, W, box) {
  const out = new Float32Array(GW * GH);
  const bw = box.maxx - box.minx + 1, bh = box.maxy - box.miny + 1;
  const s = Math.min((GH - 4) / bh, (GW - 4) / bw);
  const ow = bw * s, oh = bh * s;
  const ox = (GW - ow) / 2, oy = (GH - oh) / 2;
  const N = 4; // supersampling per axis
  for (let y = 0; y < GH; y++) {
    for (let x = 0; x < GW; x++) {
      let ink = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const u = Math.floor((x + (sx + 0.5) / N - ox) / s) + box.minx;
          const v = Math.floor((y + (sy + 0.5) / N - oy) / s) + box.miny;
          if (u >= box.minx && u <= box.maxx && v >= box.miny && v <= box.maxy && mask[v * W + u]) ink++;
        }
      }
      out[y * GW + x] = ink / (N * N);
    }
  }
  return out;
}

// img: { width, height, data } gray bytes, ink is dark (as prepareDigits returns).
// Returns the digits left to right, each a GW*GH Float32Array.
export function splitGlyphs(img) {
  const W = img.width, H = img.height;
  const fg = new Uint8Array(W * H);
  for (let i = 0; i < fg.length; i++) fg[i] = img.data[i] < 128 ? 1 : 0;
  const { labels, comps } = components(fg, new Float32Array(W * H), W, H);
  let parts = comps.slice(1);
  if (!parts.length) return [];
  const tallest = Math.max(...parts.map((c) => c.h));
  parts = parts.filter((c) => c.h > tallest * 0.3 || c.count > tallest * tallest * 0.05);
  parts.sort((a, b) => a.minx - b.minx);
  // Merge pieces stacked over each other (a broken digit).
  const merged = [];
  for (const c of parts) {
    const p = merged[merged.length - 1];
    const overlap = p ? Math.min(p.maxx, c.maxx) - Math.max(p.minx, c.minx) : -1;
    if (p && overlap > Math.min(p.maxx - p.minx, c.maxx - c.minx) * 0.5) {
      p.ids.push(c.id);
      p.minx = Math.min(p.minx, c.minx); p.maxx = Math.max(p.maxx, c.maxx);
      p.miny = Math.min(p.miny, c.miny); p.maxy = Math.max(p.maxy, c.maxy);
    } else {
      merged.push({ ids: [c.id], minx: c.minx, maxx: c.maxx, miny: c.miny, maxy: c.maxy });
    }
  }
  const glyphs = [];
  for (const g of merged) {
    const ids = new Set(g.ids);
    const mask = new Uint8Array(W * H);
    for (let y = g.miny; y <= g.maxy; y++) for (let x = g.minx; x <= g.maxx; x++) if (ids.has(labels[y * W + x])) mask[y * W + x] = 1;
    const h = g.maxy - g.miny + 1, w = g.maxx - g.minx + 1;
    // Touching digits: split at the emptiest columns near even cut points.
    const k = w > h * 0.95 ? Math.max(2, Math.round(w / (h * 0.62))) : 1;
    const cuts = [g.minx];
    for (let i = 1; i < k; i++) {
      const ideal = g.minx + Math.round((w * i) / k), win = Math.round(w / k / 4);
      let best = ideal, bestInk = Infinity;
      for (let x = ideal - win; x <= ideal + win; x++) {
        let ink = 0;
        for (let y = g.miny; y <= g.maxy; y++) ink += mask[y * W + x];
        if (ink < bestInk) { bestInk = ink; best = x; }
      }
      cuts.push(best);
    }
    cuts.push(g.maxx + 1);
    for (let i = 0; i < k; i++) {
      const box = { minx: W, maxx: -1, miny: H, maxy: -1 };
      for (let y = g.miny; y <= g.maxy; y++) {
        for (let x = cuts[i]; x < cuts[i + 1]; x++) {
          if (!mask[y * W + x]) continue;
          if (x < box.minx) box.minx = x; if (x > box.maxx) box.maxx = x;
          if (y < box.miny) box.miny = y; if (y > box.maxy) box.maxy = y;
        }
      }
      if (box.maxx >= box.minx) glyphs.push(normalizeGlyph(mask, W, box));
    }
  }
  return glyphs;
}
