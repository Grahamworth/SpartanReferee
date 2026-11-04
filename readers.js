// Number readers. Each takes one clean number image from prepareDigits
// ({ width, height, data } gray bytes, black digits on white) and returns
// candidate reads, best first: [{ text, conf }] with conf 0-100.
//
//   digits     - the small digit model (digit-model.js). About 1 ms. Default.
//   paddle     - PaddleOCR PP-OCRv5 English recognizer via onnxruntime-web.
//                More robust to odd fonts; 7.5 MB download, slower.
//   tesseract  - Tesseract.js. General text reader; slowest.
import { splitGlyphs } from './ocr-prep.js';
import { parseModel, readNumber } from './digit-model.js';

const ORT_BASE = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
const PADDLE_BASE = 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/english/';

export const ENGINES = {
  digits: { label: 'Digit model', minConf: 80 },
  paddle: { label: 'PaddleOCR', minConf: 60 },
  tesseract: { label: 'Tesseract', minConf: 55 },
};

export function mirrorImage(img) {
  const { width: W, height: H, data } = img;
  const out = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] = data[y * W + (W - 1 - x)];
  return { ...img, data: out };
}

function toCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const cx = c.getContext('2d');
  const id = cx.createImageData(img.width, img.height);
  for (let i = 0; i < img.data.length; i++) {
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = img.data[i];
    id.data[i * 4 + 3] = 255;
  }
  cx.putImageData(id, 0, 0);
  return c;
}

// ---------------------------------------------------------------- digit model

function digitReader() {
  let model = null;
  return {
    async load() {
      if (!model) model = parseModel(await (await fetch(new URL('./digit-model.json', import.meta.url))).json());
    },
    async read(img) {
      const r = readNumber(model, splitGlyphs(img));
      return r ? [r] : [];
    },
  };
}

// ---------------------------------------------------------------- PaddleOCR

function paddleReader() {
  let session = null, ort = null, dict = null, inputName = null;
  const H = 48; // PP-OCRv5 recognizer input height
  return {
    async load() {
      if (session) return;
      ort = await import(`${ORT_BASE}ort.min.mjs`);
      ort.env.wasm.wasmPaths = ORT_BASE;
      const [model, text] = await Promise.all([
        fetch(`${PADDLE_BASE}rec.onnx`).then((r) => { if (!r.ok) throw new Error(`model ${r.status}`); return r.arrayBuffer(); }),
        fetch(`${PADDLE_BASE}dict.txt`).then((r) => r.text()),
      ]);
      // CTC classes: 0 is blank, then one per dictionary line, then space.
      dict = ['', ...text.split(/\r?\n/).filter((l, i, a) => l !== '' || i < a.length - 1), ' '];
      session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
      inputName = session.inputNames[0];
    },
    async read(img) {
      const w = Math.max(16, Math.min(640, Math.round((img.width * H) / img.height)));
      // Resize (nearest is fine for a clean binary image) and normalize to -1..1.
      const x = new Float32Array(3 * H * w);
      for (let y = 0; y < H; y++) {
        const sy = Math.min(img.height - 1, Math.floor((y * img.height) / H));
        for (let i = 0; i < w; i++) {
          const sx = Math.min(img.width - 1, Math.floor((i * img.width) / w));
          const v = img.data[sy * img.width + sx] / 127.5 - 1;
          x[y * w + i] = x[H * w + y * w + i] = x[2 * H * w + y * w + i] = v;
        }
      }
      const out = await session.run({ [inputName]: new ort.Tensor('float32', x, [1, 3, H, w]) });
      const t = out[session.outputNames[0]];
      const [, T, C] = t.dims;
      // Greedy CTC decode, keeping only blank and digit classes.
      const digitIdx = [];
      for (let k = 0; k < C; k++) if (/^\d$/.test(dict[k] ?? '')) digitIdx.push(k);
      let text = '', conf = 100, prev = 0;
      for (let s = 0; s < T; s++) {
        const row = s * C;
        let best = 0, bp = t.data[row];
        for (const k of digitIdx) if (t.data[row + k] > bp) { bp = t.data[row + k]; best = k; }
        if (best !== 0 && best !== prev) { text += dict[best]; conf = Math.min(conf, bp * 100); }
        prev = best;
      }
      return text ? [{ text, conf }] : [];
    },
  };
}

// ---------------------------------------------------------------- Tesseract

function tesseractReader() {
  let worker = null;
  return {
    async load() {
      if (worker) return;
      if (!window.Tesseract) throw new Error('number reader not loaded');
      const w = await Tesseract.createWorker('eng', 1);
      await w.setParameters({
        tessedit_char_whitelist: '0123456789',
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
        user_defined_dpi: '300',
      });
      worker = w;
    },
    async read(img) {
      const { data } = await worker.recognize(toCanvas(img), {}, { text: true, blocks: true });
      const words = (data.blocks || []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
      return words
        .map((w) => ({ text: (w.text || '').replace(/\D/g, ''), conf: w.confidence ?? 0 }))
        .filter((w) => w.text)
        .sort((a, b) => b.conf - a.conf);
    },
  };
}

export function createReader(engine) {
  const make = { digits: digitReader, paddle: paddleReader, tesseract: tesseractReader }[engine] || digitReader;
  return { engine: ENGINES[engine] ? engine : 'digits', ...make() };
}
