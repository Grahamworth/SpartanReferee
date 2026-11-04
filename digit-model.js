// Small digit classifier: one glyph (GW x GH, from splitGlyphs) -> 0-9, or
// 10 for "not a digit". A two-layer network trained on printed digits in many
// fonts by tools/train_digits.mjs; weights live in digit-model.json.
import { GW, GH } from './ocr-prep.js';

export const NOT_DIGIT = 10;

export function parseModel(json) {
  const f32 = (b64) => {
    const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Float32Array(bytes.buffer);
  };
  const m = { ...json, W1: f32(json.W1), b1: f32(json.b1), W2: f32(json.W2), b2: f32(json.b2) };
  if (m.inputs !== GW * GH) throw new Error('digit model does not match glyph size');
  return m;
}

// Returns class probabilities (length classes).
export function classify(m, x) {
  const { inputs: I, hidden: Hn, classes: C } = m;
  const h = new Float32Array(Hn);
  for (let j = 0; j < Hn; j++) {
    let s = m.b1[j];
    const row = j * I;
    for (let i = 0; i < I; i++) s += m.W1[row + i] * x[i];
    h[j] = s > 0 ? s : 0;
  }
  const z = new Float32Array(C);
  let max = -Infinity;
  for (let k = 0; k < C; k++) {
    let s = m.b2[k];
    const row = k * Hn;
    for (let j = 0; j < Hn; j++) s += m.W2[row + j] * h[j];
    z[k] = s;
    if (s > max) max = s;
  }
  let sum = 0;
  for (let k = 0; k < C; k++) { z[k] = Math.exp(z[k] - max); sum += z[k]; }
  for (let k = 0; k < C; k++) z[k] /= sum;
  return z;
}

// Reads a whole number from its glyphs. conf is the least sure digit, 0-100.
// Returns null if any glyph looks like it isn't a digit.
export function readNumber(m, glyphs) {
  if (!glyphs.length) return null;
  let text = '', conf = 100;
  for (const g of glyphs) {
    const p = classify(m, g);
    let best = 0;
    for (let k = 1; k < p.length; k++) if (p[k] > p[best]) best = k;
    if (best === NOT_DIGIT) return null;
    text += best;
    conf = Math.min(conf, p[best] * 100);
  }
  return { text, conf };
}
