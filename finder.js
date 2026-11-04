// Person finder for several athletes at once: RTMO (OpenMMLab, Apache 2.0),
// run in the browser with ONNX Runtime Web. MediaPipe Pose, which does the
// judging, finds people one at a time and often sees two athletes standing
// close together as one; RTMO finds everyone in the picture in one pass and
// keeps them apart much better. It's only used to say where people are: the
// app then zooms MediaPipe in on anyone it missed, for the full 33-point pose
// the judges need.
//
// RTMO-s takes 640 x 640, grey-padded, blue-green-red, 0-255, and returns
// boxes with scores (non-maximum suppression already done inside).
// ONNX Runtime: built into the Receiver and the apps (vendor/ort), from the internet on the website
const LOCAL = location.protocol === 'app:' || location.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(location.hostname);
const ORT = LOCAL ? new URL('vendor/ort/', import.meta.url).href : 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
// the built-in copy's loader is named .js (some app views won't load .mjs files)
const ORT_PATHS = LOCAL ? { mjs: ORT + 'ort-wasm-simd-threaded.jsep.js', wasm: ORT + 'ort-wasm-simd-threaded.jsep.wasm' } : ORT;
export const FINDER_URL = 'rtmo-s.onnx';

export async function loadFinder(url = FINDER_URL) {
  if (!window.ort) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = `${ORT}ort.webgpu.min.js`;
      s.onload = res; s.onerror = () => rej(new Error('ONNX Runtime did not load'));
      document.head.append(s);
    });
  }
  const ort = window.ort;
  ort.env.wasm.wasmPaths = ORT_PATHS;
  let session = null, provider = null;
  for (const ep of ['webgpu', 'wasm']) {
    try { session = await ort.InferenceSession.create(url, { executionProviders: [ep] }); provider = ep; break; } catch { /* try the next */ }
  }
  if (!session) throw new Error('person finder did not load');

  const S = 640;
  const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const input = new Float32Array(3 * S * S);
  return {
    provider,
    // People in part of src (crop, as shares of the frame): boxes as shares
    // of the whole frame, best first. The picture is copied before this
    // returns its promise, so src can move on to the next frame.
    async find(src, W, H, crop = { x: 0, y: 0, w: 1, h: 1 }, minScore = 0.3) {
      const cw = crop.w * W, ch = crop.h * H, r = Math.min(S / cw, S / ch);
      cx.fillStyle = 'rgb(114,114,114)';
      cx.fillRect(0, 0, S, S);
      cx.drawImage(src, crop.x * W, crop.y * H, cw, ch, 0, 0, cw * r, ch * r);
      const d = cx.getImageData(0, 0, S, S).data;
      for (let i = 0, n = S * S; i < n; i++) { input[i] = d[i * 4 + 2]; input[n + i] = d[i * 4 + 1]; input[2 * n + i] = d[i * 4]; }
      const out = await session.run({ input: new ort.Tensor('float32', input, [1, 3, S, S]) });
      const dets = out.dets.data, n = out.dets.dims[1];
      const boxes = [];
      for (let p = 0; p < n; p++) {
        const score = dets[p * 5 + 4];
        if (score < minScore) continue;
        const [x0, y0, x1, y1] = [0, 1, 2, 3].map((k) => dets[p * 5 + k] / r);
        boxes.push({ x0: crop.x + x0 / W, y0: crop.y + y0 / H, x1: crop.x + x1 / W, y1: crop.y + y1 / H, score });
      }
      return boxes.sort((a, b) => b.score - a.score);
    },
  };
}
