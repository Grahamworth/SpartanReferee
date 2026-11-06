import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareDigits } from '../ocr-prep.js';

const W = 640, H = 220;

// Draws `n` ring-shaped "digits" (h tall) on a band, rotated by deg about the centre.
function scene({ n = 4, h = 70, deg = 0, ink = 20, paper = 230, bg = 110, clutter = false } = {}) {
  const g = new Uint8Array(W * H).fill(bg);
  const rad = (deg * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const cx = W / 2, cy = H / 2;
  const w = h * 0.6, gap = h * 0.25, total = n * w + (n - 1) * gap, stroke = h * 0.14;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Back into the unrotated frame.
      const u = (x - cx) * cos + (y - cy) * sin, v = -(x - cx) * sin + (y - cy) * cos;
      if (Math.abs(v) < h * 0.9 && Math.abs(u) < total / 2 + h * 0.6) g[y * W + x] = paper;
      if (Math.abs(v) > h / 2 || Math.abs(u) > total / 2) continue;
      const k = Math.floor((u + total / 2) / (w + gap));
      const lu = u + total / 2 - k * (w + gap);
      if (lu > w) continue;
      const ring = lu < stroke || lu > w - stroke || Math.abs(v) > h / 2 - stroke;
      if (ring) g[y * W + x] = ink;
    }
  }
  if (clutter) {
    // A big dark blob (a hand or hair) off to the side and speckle.
    for (let y = 10; y < 200; y++) for (let x = 5; x < 70; x++) g[y * W + x] = 15;
    for (let i = 0; i < 400; i++) g[(Math.random() * W * H) | 0] = Math.random() < 0.5 ? 0 : 255;
  }
  return g;
}

const inkCols = (img) => {
  let n = 0;
  for (let x = 0; x < img.width; x++) {
    for (let y = 0; y < img.height; y++) if (img.data[y * img.width + x] === 0) { n++; break; }
  }
  return n;
};

test('finds a level 4-digit number', () => {
  const [best] = prepareDigits(scene(), W, H);
  assert.ok(best, 'no run found');
  assert.equal(best.digits, 4);
  assert.ok(Math.abs(best.angle) < 0.02);
  assert.ok(best.dark);
  assert.ok(inkCols(best) > 50);
});

test('levels a number tilted 15 degrees', () => {
  const [best] = prepareDigits(scene({ deg: 15 }), W, H);
  assert.equal(best.digits, 4);
  assert.ok(Math.abs(best.angle - (15 * Math.PI) / 180) < 0.05, `angle ${best.angle}`);
  // Levelled output is short and wide, not a tall slanted box.
  assert.ok(best.width > best.height * 1.9, `${best.width}x${best.height}`);
});

test('reads light print on a dark band', () => {
  const [best] = prepareDigits(scene({ ink: 235, paper: 30, bg: 120 }), W, H);
  assert.equal(best.digits, 4);
  assert.equal(best.dark, false);
});

test('ignores clutter next to the number', () => {
  const [best] = prepareDigits(scene({ clutter: true }), W, H);
  assert.equal(best.digits, 4);
});

test('skips a run with a digit it could not group (no dropped digits)', () => {
  // Four rings, the second much shorter, like an old-style "2".
  const g = scene();
  const h = 70, w = h * 0.6, gap = h * 0.25, total = 4 * w + 3 * gap;
  const x0 = Math.round(W / 2 - total / 2 + w + gap), x1 = Math.round(x0 + w);
  // Blank the second ring and redraw it at 40% height, bottom-aligned.
  for (let y = 0; y < H; y++) for (let x = x0 - 1; x <= x1 + 1; x++) if (g[y * W + x] < 100) g[y * W + x] = 230;
  const top = Math.round(H / 2 + h / 2 - h * 0.4), bot = Math.round(H / 2 + h / 2), st = 8;
  for (let y = top; y < bot; y++) for (let x = x0; x < x1; x++) {
    if (x < x0 + st || x >= x1 - st || y < top + st || y >= bot - st) g[y * W + x] = 20;
  }
  const runs = prepareDigits(g, W, H);
  assert.ok(runs.every((r) => r.digits !== 3), `got a 3-digit run: ${runs.map((r) => r.digits)}`);
});

test('skips a lone digit with unread digits beside it', () => {
  // Rings at different heights, like old-style figures: none should be read alone.
  const g = new Uint8Array(W * H).fill(230);
  const ring = (x0, y0, w, h) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      if (x < x0 + 8 || x >= x0 + w - 8 || y < y0 + 8 || y >= y0 + h - 8) g[y * W + x] = 20;
    }
  };
  ring(200, 60, 42, 70); ring(260, 100, 42, 34); ring(320, 40, 42, 70); ring(380, 70, 42, 70);
  const runs = prepareDigits(g, W, H, { minDigits: 1 });
  assert.ok(runs.every((r) => r.digits >= 4), `partial run read: ${runs.map((r) => r.digits)}`);
});

test('with the gap check off, a number is kept whatever is beside it', () => {
  // A whole picture: a digit-sized shape beside the number (a person, a tree) shouldn't lose it.
  const g = scene({ n: 3 });
  for (let y = 90; y < 130; y++) for (let x = 412; x < 438; x++) {
    if (x < 420 || x >= 430 || y < 98 || y >= 122) g[y * W + x] = 20;
  }
  const dark = (o) => prepareDigits(g, W, H, { minDigits: 3, maxDigits: 3, ...o }).filter((r) => r.dark);
  assert.equal(dark({}).length, 0, 'the check should skip the dark number by default');
  assert.equal(dark({ checkGaps: false })[0]?.digits, 3);
});

test('finds nothing in an empty frame', () => {
  assert.equal(prepareDigits(new Uint8Array(W * H).fill(128), W, H).length, 0);
});
