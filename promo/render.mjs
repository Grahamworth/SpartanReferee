// Exports promo.html to an MP4, frame by frame, in headless Chrome (needs Chrome running with --remote-debugging-port=9333).
//   node promo/render.mjs stills <out dir> 1.5 6 12 ...     pictures at those times, to check the look
//   node promo/render.mjs video  <out.mp4>                  the whole video
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const MUXER = path.join(DIR, 'node_modules/mp4-muxer/build/mp4-muxer.js');
const [, , what, out, ...times] = process.argv;
let finished;
const uploaded = new Promise((r) => { finished = r; });
const server = http.createServer((q, r) => {
  if (q.method === 'POST') { // the finished video, from the page
    const parts = [];
    q.on('data', (c) => parts.push(c));
    q.on('end', () => { fs.writeFileSync(out, Buffer.concat(parts)); r.end('ok'); finished(); });
    return;
  }
  const file = q.url.startsWith('/muxer') ? MUXER : path.join(DIR, 'promo.html');
  r.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(file).pipe(r);
}).listen(8797);

const t = (await (await fetch('http://127.0.0.1:9333/json')).json()).find((x) => x.type === 'page');
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const wait = new Map();
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } else if (d.method === 'Runtime.consoleAPICalled') console.log(d.params.args[0]?.value); else if (d.method === 'Runtime.exceptionThrown') console.log('PAGE EXC', d.params.exceptionDetails.exception?.description?.slice(0, 400)); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => { const d = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (d.result?.exceptionDetails) throw new Error(d.result.exceptionDetails.exception?.description); return d.result.result.value; };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://localhost:8797/' });
await new Promise((r) => setTimeout(r, 2000));
await ev('window.ready');
console.log('fonts', await ev(`document.fonts.check('italic 900 40px "Barlow Condensed"') + ' ' + document.fonts.check('600 40px Barlow')`));

if (what === 'stills') {
  fs.mkdirSync(out, { recursive: true });
  for (const s of times) {
    const url = await ev(`renderAt(${s}); document.getElementById('c').toDataURL('image/jpeg', .8)`);
    fs.writeFileSync(path.join(out, `t${s}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
  }
} else {
  await ev(`new Promise((res, rej) => { const s = document.createElement('script'); s.src = '/muxer.js'; s.onload = res; s.onerror = rej; document.head.append(s); })`);
  // Not awaited through the debugger: the page uploads the file itself when it's done.
  ev(`(async () => {
    const FPS = 30, W = 1920, H = 1080, frames = Math.round(DURATION * FPS), c = document.getElementById('c');
    const config = { codec: 'avc1.640028', width: W, height: H, bitrate: 8000000, framerate: FPS };
    const ok = await VideoEncoder.isConfigSupported(config);
    if (!ok.supported) throw new Error('H.264 encoding is not available in this browser');
    const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H }, fastStart: 'in-memory' });
    let failed = null;
    const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failed = e; console.log('encoder error ' + e.message); } });
    enc.configure(config);
    for (let f = 0; f < frames; f++) {
      if (failed) throw failed;
      renderAt(f / FPS);
      if (f % 300 === 0) console.log('frame ' + f + ' of ' + frames);
      const frame = new VideoFrame(c, { timestamp: Math.round(f * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
      enc.encode(frame, { keyFrame: f % 60 === 0 });
      frame.close();
      while (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
    }
    console.log('flushing');
    await enc.flush();
    muxer.finalize();
    console.log('uploading');
    await fetch('/out', { method: 'POST', body: muxer.target.buffer });
    console.log('uploaded');
  })().catch((e) => console.log('FAILED ' + e.message))`);
  const giveUp = setTimeout(() => { console.log('timed out waiting for the video'); process.exit(1); }, 180000);
  await uploaded;
  clearTimeout(giveUp);
  console.log('wrote', out, fs.statSync(out).size);
}
server.close();
process.exit();
