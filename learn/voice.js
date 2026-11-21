// The Assistant's voice (21 November 2026): records what's said as a WAV (16 kHz mono, what Azure AI Speech takes on every phone,
// whatever the browser's own recorder makes), and plays answers read aloud. A recording stops itself after a minute.

/** starts recording; returns { stop: () => Promise<base64 WAV>, cancel, level: () => 0..1 } */
export async function startRecording({ maxMs = 60000, onAutoStop = null } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can\'t record: type the question instead');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  await ctx.resume().catch(() => {});
  const source = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = []; let level = 0, done = false;
  node.onaudioprocess = (e) => {
    const d = e.inputBuffer.getChannelData(0); chunks.push(new Float32Array(d));
    let s = 0; for (let i = 0; i < d.length; i += 16) s = Math.max(s, Math.abs(d[i])); level = level * 0.6 + s * 0.4;
  };
  source.connect(node); node.connect(ctx.destination);
  const close = () => { done = true; node.disconnect(); source.disconnect(); for (const tr of stream.getTracks()) tr.stop(); ctx.close().catch(() => {}); };
  const timer = setTimeout(() => { if (!done && onAutoStop) onAutoStop(); }, maxMs);
  return {
    level: () => Math.min(1, level * 3),
    cancel() { clearTimeout(timer); if (!done) close(); },
    async stop() { clearTimeout(timer); const rate = ctx.sampleRate; if (!done) close(); return wavBase64(chunks, rate); },
  };
}

// the samples, brought down to 16 kHz (each output sample the average of the ones it covers) as 16-bit PCM in a WAV
function wavBase64(chunks, rate, to = 16000) {
  const n = chunks.reduce((a, c) => a + c.length, 0), all = new Float32Array(n);
  let at = 0; for (const c of chunks) { all.set(c, at); at += c.length; }
  const ratio = rate / to, len = Math.floor(n / ratio), pcm = new Int16Array(len);
  for (let i = 0; i < len; i++) {
    const a = Math.floor(i * ratio), b = Math.min(n, Math.floor((i + 1) * ratio)); let s = 0;
    for (let j = a; j < b; j++) s += all[j];
    const v = Math.max(-1, Math.min(1, s / Math.max(1, b - a))); pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  const buf = new ArrayBuffer(44 + pcm.byteLength), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.byteLength, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, to, true); v.setUint32(28, to * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, pcm.byteLength, true);
  new Int16Array(buf, 44).set(pcm);
  const bytes = new Uint8Array(buf); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { audio: btoa(bin), seconds: len / to };
}

let playing = null;
/** plays an MP3 given as base64; stops whatever was playing */
export function play(base64) {
  stopPlaying();
  playing = new Audio(`data:audio/mpeg;base64,${base64}`);
  return playing.play().catch(() => {}); // a phone may refuse sound until the page is touched
}
export function stopPlaying() { if (playing) { playing.pause(); playing = null; } }
