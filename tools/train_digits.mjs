// Trains the digit model on glyphs from render_digits.py and writes
// digit-model.json.
//
//   node tools/train_digits.mjs <train.bin> <test.bin> [out.json]
//
// A two-layer network (GW*GH -> HIDDEN -> 11), ReLU, softmax, plain SGD with
// momentum. Glyphs go through the same normalizeGlyph the app uses.
import fs from 'node:fs';
import { GW, GH, normalizeGlyph } from '../ocr-prep.js';
import { parseModel, classify } from '../digit-model.js';

const SIZE = 64, REC = 1 + (SIZE * SIZE) / 8;
const HIDDEN = 96, CLASSES = 11, EPOCHS = 14, LR0 = 0.05, MOM = 0.9, BATCH = 32, L2 = 1e-5;

function load(path) {
  const buf = fs.readFileSync(path);
  const n = Math.floor(buf.length / REC);
  const X = [], Y = [];
  const mask = new Uint8Array(SIZE * SIZE);
  for (let r = 0; r < n; r++) {
    const off = r * REC;
    const box = { minx: SIZE, maxx: -1, miny: SIZE, maxy: -1 };
    for (let i = 0; i < SIZE * SIZE; i++) {
      const ink = (buf[off + 1 + (i >> 3)] >> (i & 7)) & 1;
      mask[i] = ink;
      if (!ink) continue;
      const x = i % SIZE, y = (i - x) / SIZE;
      if (x < box.minx) box.minx = x; if (x > box.maxx) box.maxx = x;
      if (y < box.miny) box.miny = y; if (y > box.maxy) box.maxy = y;
    }
    if (box.maxx < 0) continue;
    X.push(normalizeGlyph(mask, SIZE, box));
    Y.push(buf[off]);
  }
  return { X, Y };
}

const [trainPath, testPath, outPath = 'digit-model.json'] = process.argv.slice(2);
const train = load(trainPath), test = load(testPath);
console.log(`train ${train.X.length}, test ${test.X.length}`);

const I = GW * GH;
let seed = 1;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
const W1 = Float32Array.from({ length: HIDDEN * I }, () => gauss() * Math.sqrt(2 / I));
const b1 = new Float32Array(HIDDEN);
const W2 = Float32Array.from({ length: CLASSES * HIDDEN }, () => gauss() * Math.sqrt(2 / HIDDEN));
const b2 = new Float32Array(CLASSES);
const vW1 = new Float32Array(W1.length), vb1 = new Float32Array(HIDDEN), vW2 = new Float32Array(W2.length), vb2 = new Float32Array(CLASSES);
const gW1 = new Float32Array(W1.length), gb1 = new Float32Array(HIDDEN), gW2 = new Float32Array(W2.length), gb2 = new Float32Array(CLASSES);
const h = new Float32Array(HIDDEN), z = new Float32Array(CLASSES), dh = new Float32Array(HIDDEN);

function step(x, y) {
  for (let j = 0; j < HIDDEN; j++) {
    let s = b1[j];
    const row = j * I;
    for (let i = 0; i < I; i++) s += W1[row + i] * x[i];
    h[j] = s > 0 ? s : 0;
  }
  let max = -Infinity;
  for (let k = 0; k < CLASSES; k++) {
    let s = b2[k];
    const row = k * HIDDEN;
    for (let j = 0; j < HIDDEN; j++) s += W2[row + j] * h[j];
    z[k] = s; if (s > max) max = s;
  }
  let sum = 0;
  for (let k = 0; k < CLASSES; k++) { z[k] = Math.exp(z[k] - max); sum += z[k]; }
  dh.fill(0);
  for (let k = 0; k < CLASSES; k++) {
    const d = z[k] / sum - (k === y ? 1 : 0);
    gb2[k] += d;
    const row = k * HIDDEN;
    for (let j = 0; j < HIDDEN; j++) { gW2[row + j] += d * h[j]; dh[j] += d * W2[row + j]; }
  }
  for (let j = 0; j < HIDDEN; j++) {
    if (h[j] <= 0) continue;
    const d = dh[j];
    gb1[j] += d;
    const row = j * I;
    for (let i = 0; i < I; i++) if (x[i]) gW1[row + i] += d * x[i];
  }
}

function apply(lr) {
  const upd = (W, g, v) => {
    for (let i = 0; i < W.length; i++) {
      v[i] = MOM * v[i] - lr * (g[i] / BATCH + L2 * W[i]);
      W[i] += v[i];
      g[i] = 0;
    }
  };
  upd(W1, gW1, vW1); upd(b1, gb1, vb1); upd(W2, gW2, vW2); upd(b2, gb2, vb2);
}

const b64 = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
const exportModel = () => ({ inputs: I, hidden: HIDDEN, classes: CLASSES, glyph: [GW, GH], W1: b64(W1), b1: b64(b1), W2: b64(W2), b2: b64(b2) });

function accuracy(data) {
  const m = parseModel(exportModel());
  let ok = 0;
  const wrong = {};
  for (let n = 0; n < data.X.length; n++) {
    const p = classify(m, data.X[n]);
    let best = 0;
    for (let k = 1; k < CLASSES; k++) if (p[k] > p[best]) best = k;
    if (best === data.Y[n]) ok++;
    else wrong[`${data.Y[n]}->${best}`] = (wrong[`${data.Y[n]}->${best}`] || 0) + 1;
  }
  return { acc: ok / data.X.length, wrong };
}

const order = train.X.map((_, i) => i);
for (let ep = 0; ep < EPOCHS; ep++) {
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const lr = LR0 * (ep < EPOCHS - 4 ? 1 : 0.2);
  for (let n = 0; n < order.length; n++) {
    step(train.X[order[n]], train.Y[order[n]]);
    if ((n + 1) % BATCH === 0) apply(lr);
  }
  const t = accuracy(test);
  console.log(`epoch ${ep + 1}: test accuracy ${(t.acc * 100).toFixed(2)}%`);
  if (ep === EPOCHS - 1) console.log('confusions', Object.entries(t.wrong).sort((a, b) => b[1] - a[1]).slice(0, 12));
}
fs.writeFileSync(outPath, JSON.stringify(exportModel()));
console.log(`wrote ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(0)} KB)`);
