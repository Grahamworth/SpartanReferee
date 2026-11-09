// Test mode for the video review: the real page (server/review), on the site, with no server behind it. Everything it would ask its
// server for is answered here, in the browser, with a pretend company: two cameras, some results, and uploads that "analyse" in a
// few seconds. Camera 1 is this browser's own camera: shown live the way a server shows one (WebRTC), and recorded here, so rewinding
// Live, Watch, Pick athlete and previous recordings play real video. Camera 2 waits for its phone, with its QR codes. Starting an AI
// judge shows TEST over the picture instead of a judge, and pretend athletes turn up in the recording. Nothing is sent anywhere:
// recordings and uploaded videos stay in this browser. Built into the site by scripts/build-review-test.mjs; admins only.
//
// The free camera (window.HJ_FREE, built as /review-free/ for any company) is the same thing with nothing pretend: one camera, this
// browser's, and the real AI judge (/judge-free.html) run here, in this browser, on a minute of video at a time: a minute of camera 1
// (its recordings come in 1-minute pieces) or an uploaded video of up to a minute. There's no live AI judge: it would need a server.
(() => {
  const FREE = !!window.HJ_FREE;
  const realFetch = window.fetch.bind(window);
  const T0 = Date.now(), iso = (ms) => new Date(ms).toISOString(), minsAgo = (m) => iso(Date.now() - m * 60e3);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  // a QR-like picture saying TEST (it doesn't encode anything)
  const qr = (() => {
    let cells = '';
    for (let i = 0; i < 21; i++) for (let j = 0; j < 21; j++) {
      const corner = (a, b) => i >= a && i < a + 7 && j >= b && j < b + 7;
      const on = corner(0, 0) || corner(14, 0) || corner(0, 14)
        ? (() => { const a = i >= 14 ? 14 : 0, b = j >= 14 ? 14 : 0, u = i - a, v = j - b; return u === 0 || u === 6 || v === 0 || v === 6 || (u >= 2 && u <= 4 && v >= 2 && v <= 4); })()
        : ((i * 7 + j * 13 + i * j * 3) % 5) < 2;
      if (on) cells += `<rect x="${i + 2}" y="${j + 2}" width="1" height="1"/>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 25"><rect width="25" height="25" fill="#fff"/><g fill="#000">${cells}</g><rect x="7" y="10" width="11" height="5" fill="#ffc400"/><text x="12.5" y="13.9" font-size="3.6" font-family="Arial" font-weight="700" text-anchor="middle">TEST</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  })();

  // ---- the pretend server
  const cams = [
    { n: 1, live: false, from: '', route: '', video: '', watchers: 1, ai: false }, // live once this browser's camera is on
    { n: 2, live: false, from: '', route: '', video: '', watchers: 0, ai: false },
  ].slice(0, FREE ? 1 : 2);
  let athletesRev = 1, seq = 4, judgeSettings = {}, counts = [];
  const athletes = FREE ? [] : [
    { n: 1, src: 'live', video: '', cam: 1, round: 1, label: 1, bib: '214', firstAt: minsAgo(22), lastAt: minsAgo(18), reps: 23, noReps: 0, done: true, pic: 0 },
    { n: 2, src: 'live', video: '', cam: 1, round: 1, label: 2, bib: '88', firstAt: minsAgo(15), lastAt: minsAgo(11), reps: 19, noReps: 1, questionable: 1, done: true, pic: 0 },
    { n: 3, src: 'live', video: '', cam: 2, round: 1, label: 3, bib: 'No number', firstAt: minsAgo(9), lastAt: minsAgo(6), reps: 17, noReps: 2, done: true, pic: 0 },
    { n: 4, src: 'live', video: '', cam: 1, round: 2, label: 4, bib: '131', firstAt: minsAgo(2), lastAt: minsAgo(0.1), reps: 8, noReps: 0, done: false, pic: 0 },
    // on camera 1 at the same time as others, so the people bar needs a second lane
    { n: 5, src: 'live', video: '', cam: 1, round: 1, label: 5, bib: '57', firstAt: minsAgo(20), lastAt: minsAgo(16), reps: 21, noReps: 0, done: true, pic: 0 },
    { n: 6, src: 'live', video: '', cam: 1, round: 1, label: 6, bib: '302', firstAt: minsAgo(8), lastAt: minsAgo(4), reps: 25, noReps: 3, done: true, pic: 0 },
  ];
  seq = FREE ? 0 : 6;
  const numbers = FREE ? [] : [
    { id: 'n1', number: '214', src: 'live', cam: 1, video: '', firstAt: minsAgo(22.2), lastAt: minsAgo(22.1), firstT: 0, lastT: 0 },
    { id: 'n2', number: '88', src: 'live', cam: 1, video: '', firstAt: minsAgo(15.3), lastAt: minsAgo(15.2), firstT: 0, lastT: 0 },
  ];
  const events = FREE ? [] : [{ t: minsAgo(25), cam: 1, type: 'connected', route: 'internet' }, { t: minsAgo(10), cam: 2, type: 'lost', route: '' }];
  const uploads = [], files = new Map(), jobs = [], prevSources = {};
  // a few reps and a no rep, spread across the time they were on screen
  const track = (a) => {
    const k = Math.min(a.reps, 6), up = a.src === 'upload';
    const t0 = up ? (a.firstT || 0) * 1000 : Date.parse(a.firstAt), t1 = up ? (a.lastT ?? a.firstT ?? 0) * 1000 : Date.parse(a.lastAt), step = (t1 - t0) / (k + 1);
    return { frames: [], events: Array.from({ length: k }, (_, i) => ({ type: i === 2 && a.noReps ? 'norep' : 'rep', count: i + 1, t: Math.round(t0 + step * (i + 1)), reasons: i === 2 && a.noReps ? ['Jump: both feet off the ground'] : [] })) };
  };
  const jobView = (j) => {
    const pct = Math.min(100, Math.round((Date.now() - j.at) / 80));
    if (j.state === 'running' && pct >= 100) {
      j.state = 'done';
      // the people "found" in it, at different points in the video (a share of how long it is: about 2 minutes for an upload)
      const round = Date.now(), span = j.span || 115;
      for (const [bib, from, to, reps, noReps] of [['305', 0.03, 0.36, 12, 1], ['44', 0.1, 0.5, 15, 0], ['No number', 0.41, 0.7, 9, 2], ['118', 0.57, 0.97, 18, 0]]) {
        const firstT = Math.round(from * span * 10) / 10, lastT = Math.round(to * span * 10) / 10;
        athletes.push({ n: ++seq, src: 'upload', video: j.video, cam: 0, round, label: seq, bib, firstT, lastT, firstAt: iso(j.at), lastAt: iso(Date.now()), reps, noReps, done: true, pic: 1 });
      }
      athletesRev++;
    }
    return { id: j.id, video: j.video, name: j.name, state: j.state, pct: j.state === 'done' ? 100 : pct, why: j.why || '' };
  };
  const state = () => ({
    now: new Date().toISOString(), cams: cams.map((c) => ({ ...c, judging: c.ai && c.live, fps: c.ai && c.live ? 15 : 0 })),
    marks: [], events, athletesRev, record: true, keepDays: 7, maxJudges: FREE ? 0 : 2, until: FREE ? 0 : T0 + 2 * 3600e3, firstCamera: 1,
    site: new URL('../console.html', location.href).href, // the site's own console: Booking and History go there
    brand: window.HJ_BRAND || { id: 'test', name: FREE ? 'Free camera' : 'Test company', logo: '', theme: { primary: '#ffc400', accent: '#3ddc97', mode: 'dark' } },
  });
  // ---- camera 1: this browser's camera, recorded here in 10-second pieces kept for 20 minutes. A stretch of it plays as one video,
  // its pieces put together in the browser (Media Source), starting at the moment asked for, just as a server cuts a clip.
  const REC_TYPES = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/mp4;codecs=avc1.42E01E'];
  // the free camera's recordings are listed a minute at a time: as much as the AI judge analyses in one go here
  const PIECE_MS = 10e3, KEEP_MS = 20 * 60e3, BLOCK_MS = FREE ? 60e3 : 10 * 60e3, MAX_SECS = 60;
  const cam1 = { stream: null, rec: null, live: null, type: '', pieces: [], began: 0, why: '', gen: 0, tries: 0 };
  const say = (what) => { cam1.why = what; const el = document.getElementById('tmCam'); if (el) el.textContent = what; };
  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) return say('camera 1: this browser can\'t share a camera here');
    try {
      cam1.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
    } catch (e) {
      if (cam1.began && e.name !== 'NotAllowedError' && cam1.tries++ < 10) { setTimeout(startCamera, 3000); return; } // it was on: keep trying a while
      return say(e.name === 'NotAllowedError' ? 'camera 1: allow the camera (address bar) and reload to record from it' : cam1.began ? 'camera 1: this browser\'s camera stopped' : 'camera 1: no camera found on this computer');
    }
    const gen = ++cam1.gen, track = cam1.stream.getVideoTracks()[0], s = track.getSettings();
    cam1.live = cam1.stream.clone(); // what live viewers are sent (whep, below)
    cam1.tries = 0;
    Object.assign(cams[0], { live: true, route: 'this browser', video: s.width ? `${s.width}×${s.height}` : '' });
    events.push({ t: iso(Date.now()), cam: 1, type: 'connected', route: 'this browser' });
    // lost (unplugged, the computer slept, the browser's camera service restarted): back as soon as it can be, as a phone reconnects
    track.addEventListener('ended', () => {
      if (gen !== cam1.gen) return;
      cams[0].live = false; events.push({ t: iso(Date.now()), cam: 1, type: 'lost', route: '' });
      for (const st of [cam1.stream, cam1.rec, cam1.live]) st?.getTracks().forEach((t) => t.stop());
      say('camera 1: lost this browser\'s camera, trying again…');
      setTimeout(startCamera, 2000);
    });
    cam1.type = REC_TYPES.find((t) => window.MediaRecorder?.isTypeSupported(t) && window.MediaSource?.isTypeSupported(t)) || '';
    if (!cam1.type) return say('camera 1: live from this browser\'s camera, but this browser can\'t record it here');
    if (!cam1.began) cam1.began = Date.now();
    cam1.rec = cam1.stream.clone(); // the recording's own copy: a live viewer joining doesn't hold up its frames
    say('camera 1: this browser\'s camera, recorded in this browser');
    nextPiece(gen);
  }
  // Each piece is a recording of its own, so any of them can start a clip. Its clock starts at its first frame, the one the camera
  // gives just after it's started, so that's where it's placed in time. Where it ends is measured once it stops: a recorder
  // that's fallen behind (a busy computer) loses the frames it hadn't got to, which the next piece, started 3 s before, covers.
  const append = (sb, buf) => new Promise((ok, no) => { sb.onupdateend = ok; sb.onerror = no; sb.appendBuffer(buf); });
  async function videoLength(blob) {
    const v = document.createElement('video'), ms = new MediaSource();
    v.src = URL.createObjectURL(ms);
    await new Promise((r) => ms.addEventListener('sourceopen', r, { once: true }));
    URL.revokeObjectURL(v.src);
    try { const sb = ms.addSourceBuffer(cam1.type); await append(sb, await blob.arrayBuffer()); const b = sb.buffered; return b.length ? b.end(b.length - 1) : 0; }
    catch { return 0; } finally { v.removeAttribute('src'); v.load(); }
  }
  function nextPiece(gen) {
    if (gen !== cam1.gen || !cam1.rec?.active) return;
    // on this computer's clock; its end is its latest data until it's measured
    let mr;
    try { mr = new MediaRecorder(cam1.rec, { mimeType: cam1.type, videoBitsPerSecond: 1.5e6, videoKeyFrameIntervalDuration: 1000 }); } catch { return say('camera 1: this browser can\'t record it here'); }
    const piece = { start: Date.now(), end: Date.now(), chunks: [], size: 0 };
    mr.ondataavailable = (e) => { if (e.data.size) { piece.chunks.push(e.data); piece.size += e.data.size; piece.end = Date.now(); } };
    mr.onstop = async () => { const len = piece.size ? await videoLength(new Blob(piece.chunks, { type: cam1.type })) : 0; if (len) piece.end = piece.start + len * 1000; };
    mr.start(1000);
    cam1.pieces.push(piece);
    // the next one starts before this one stops: no gap between them (the next is laid over this one's last moments)
    setTimeout(() => { nextPiece(gen); setTimeout(() => { if (mr.state !== 'inactive') mr.stop(); }, 3000); }, PIECE_MS);
    const old = Date.now() - KEEP_MS;
    while (cam1.pieces.length && cam1.pieces[0].end < old) cam1.pieces.shift();
  }
  const piecesIn = (cam, from, to) => (cam === 1 ? cam1.pieces.filter((p) => p.size && p.end > from && p.start < to) : []);
  // a clip from `from` for `secs`: a Media Source the video plays, its time 0 being `from` (made in the window that plays it: a Media
  // Source only plays in the page it was made in, and the AI judge has a page of its own)
  function clipUrl(cam, from, secs, win = window) {
    const pieces = piecesIn(cam, from, from + secs * 1000).map((p) => ({ start: p.start, blob: new Blob(p.chunks, { type: cam1.type }) }));
    const ms = new win.MediaSource(), url = win.URL.createObjectURL(ms);
    ms.addEventListener('sourceopen', async () => {
      win.URL.revokeObjectURL(url);
      try {
        const sb = ms.addSourceBuffer(cam1.type);
        ms.duration = secs; // its whole length from the start, so a jump ahead isn't cut short while the pieces go in
        for (const x of pieces) {
          // a recording's last cluster has no end, so the parser is reset before each piece (which also resets the window)
          sb.abort();
          sb.appendWindowEnd = secs;
          sb.timestampOffset = (x.start - from) / 1000; // before `from` is cut off
          await append(sb, await x.blob.arrayBuffer());
        }
        if (ms.readyState === 'open') ms.endOfStream();
      } catch { try { ms.endOfStream('decode'); } catch { /* the video has moved on */ } }
    }, { once: true });
    return url;
  }
  // a stretch a recorder fell behind on is a gap in a clip: the video steps over it rather than waiting there for good
  const stepOver = (v) => {
    if (!(v instanceof HTMLMediaElement) || !v.currentSrc.startsWith('blob:') || v.readyState >= 3) return;
    const b = v.buffered, t = v.currentTime;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= t && t < b.end(i) - 0.1) return; // it has what it needs: just loading
      if (b.start(i) > t && b.start(i) - t < 8) { v.currentTime = b.start(i) + 0.05; return; }
    }
  };
  document.addEventListener('waiting', (e) => stepOver(e.target), true);
  setInterval(() => document.querySelectorAll('video').forEach((v) => !v.paused && stepOver(v)), 700); // and once more pieces are in
  // a server lists a camera's recordings in 10-minute files; here they're the 10-minute stretches since the camera came on
  function browserRecordings() {
    const out = [], last = cam1.pieces.at(-1);
    if (!last) return out;
    // each stretch exactly: a piece that runs over its end is cut there, and its rest starts the next one
    for (let b = cam1.began, i = 1; b < last.end; b += BLOCK_MS, i++) {
      const ps = piecesIn(1, b, b + BLOCK_MS), from = ps.length ? Math.max(b, ps[0].start) : 0, to = Math.min(b + BLOCK_MS, Math.max(...ps.map((p) => p.end)));
      if (ps.length && to - from >= 1000) out.push({ id: `here${i}`, cam: 1, size: ps.reduce((n, p) => n + p.size, 0), startedAt: iso(from), file: `camera1-here${i}.webm`, name: '', span: [from, to] });
    }
    return out;
  }
  // the server's WebRTC (WHEP) answer for a live camera, given here: a connection inside this page, from the camera to the picture
  async function whep(path, offer) {
    const n = +(/station(\d+)/.exec(path) || [])[1];
    if (n !== 1 || !cam1.live?.active || typeof offer !== 'string') return new Response('not live', { status: 404 });
    // the viewers share one copy of the camera, kept for as long as the camera is (copies coming and going upset Chrome's camera)
    const pc = new RTCPeerConnection(), copy = cam1.live;
    for (const t of copy.getTracks()) pc.addTrack(t, copy);
    await pc.setRemoteDescription({ type: 'offer', sdp: offer });
    await pc.setLocalDescription(await pc.createAnswer());
    await new Promise((ok) => { if (pc.iceGatheringState === 'complete') ok(); pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && ok()); setTimeout(ok, 1500); });
    pc.addEventListener('connectionstatechange', () => { if (['failed', 'disconnected'].includes(pc.connectionState)) pc.close(); });
    return new Response(pc.localDescription.sdp, { status: 201, headers: { 'Content-Type': 'application/sdp' } });
  }
  // while camera 1's AI judge is "on", someone turns up in its recording every half minute, so Watch has real video to show
  const BIBS = ['12', '407', 'No number', '73', '219', '5', '640'];
  if (!FREE) setInterval(() => {
    const now = Date.now();
    if (!cams[0].live || !cams[0].ai || !piecesIn(1, now - 26e3, now - 2e3).length) return;
    const reps = 6 + (seq % 9);
    athletes.push({ n: ++seq, src: 'live', video: '', cam: 1, round: 3, label: seq, bib: BIBS[seq % BIBS.length], firstAt: iso(Math.max(now - 26e3, cam1.pieces[0].start)), lastAt: iso(now - 2e3), reps, noReps: seq % 3 ? 0 : 1, done: true, pic: 1 });
    athletesRev++;
  }, 30e3);

  // ---- the free camera's AI judge: what it reports about each athlete is kept here, as a server's review keeps it
  const tracks = new Map(), pics = new Map();
  const athleteFor = (b, at) => {
    const src = b.src === 'upload' ? 'upload' : 'live', cam = +b.cam || 0, video = String(b.video || ''), round = String(b.round || ''), label = +b.label || 0;
    let a = athletes.find((x) => x.src === src && x.cam === cam && x.video === video && x.round === round && x.label === label);
    if (!a) { a = { n: ++seq, src, cam, video, round, label, bib: '', firstAt: at, lastAt: at, reps: 0, noReps: 0, done: false, pic: 0 }; athletes.push(a); athletesRev++; }
    return a;
  };
  const isNum = (v) => v != null && v !== '' && Number.isFinite(+v);
  function athleteSaid(b) {
    const at = !isNaN(Date.parse(b.at)) ? iso(Date.parse(b.at)) : iso(Date.now()), a = athleteFor(b, at);
    if (at < a.firstAt) a.firstAt = at;
    if (at > a.lastAt) a.lastAt = at;
    if (isNum(b.t)) { const t = +b.t; if (a.firstT == null || t < a.firstT) a.firstT = t; if (a.lastT == null || t > a.lastT) a.lastT = t; }
    if (b.bib) a.bib = String(b.bib).slice(0, 12);
    for (const k of ['reps', 'noReps', 'questionable']) if (isNum(b[k])) a[k] = Math.max(0, +b[k] | 0);
    if (b.box && isNum(b.box.x) && isNum(b.box.y)) { a.box = { x: +b.box.x, y: +b.box.y }; a.boxAt = at; if (isNum(b.t)) a.boxT = +b.t; }
    if (b.done) { a.done = true; a.id = String(b.id || ''); }
    if (typeof b.pic === 'string' && b.pic.startsWith('data:image/jpeg;base64,')) { pics.set(a.n, b.pic); a.pic = Date.now(); }
    athletesRev++;
    return a;
  }
  function trackSaid(b) {
    const a = athleteFor(b, !isNaN(Date.parse(b.at)) ? iso(Date.parse(b.at)) : iso(Date.now())), t = tracks.get(a.n) || { frames: [], events: [] };
    for (const f of Array.isArray(b.frames) ? b.frames : []) if (Array.isArray(f)) t.frames.push(f);
    for (const e of Array.isArray(b.events) ? b.events : []) if (e && (e.type === 'rep' || e.type === 'norep')) t.events.push(e);
    tracks.set(a.n, t);
  }
  function numberSaid(b) {
    const number = String(b.number || '').replace(/\D/g, '').slice(0, 12); if (!number) return;
    const at = !isNaN(Date.parse(b.at)) ? iso(Date.parse(b.at)) : iso(Date.now()), src = b.src === 'upload' ? 'upload' : 'live', cam = +b.cam || 0, video = String(b.video || ''), t = isNum(b.t) ? +b.t : null;
    const same = numbers.findLast((x) => x.number === number && x.src === src && x.cam === cam && x.video === video);
    if (same && (src === 'upload' ? t != null && same.lastT != null && t >= same.lastT && t - same.lastT <= 20 : Date.parse(at) - Date.parse(same.lastAt) <= 20000)) { same.lastAt = at; same.lastT = t; }
    else { numbers.push({ id: `n${numbers.length + 1}`, number, src, cam, video, firstAt: at, lastAt: at, firstT: t, lastT: t }); athletesRev++; }
  }
  // One video at a time, in a page of its own out of sight (the judge exactly as a server runs it), followed until it's done.
  let judging = null, jobSeq = 0;
  const LOAD_MS = 3 * 60e3, STALL_MS = 2 * 60e3;
  function nextJob() {
    if (judging) return;
    const j = jobs.find((x) => x.state === 'queued'); if (!j) return;
    const f = document.createElement('iframe');
    f.title = 'AI judge'; f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
    // in view but invisible: a page out of view is slowed down by the browser
    f.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:400px;border:0;opacity:0;pointer-events:none;z-index:-1';
    f.src = `/judge-free.html?${new URLSearchParams({ video: '/uploads/' + encodeURIComponent(j.video), name: j.name, go: '1', cfg: 'upload', bg: '1' })}`;
    document.body.append(f);
    judging = { j, f, began: Date.now(), movedAt: Date.now() };
    Object.assign(j, { state: 'running', pct: 0, why: '' });
  }
  function endJob(state, why = '') {
    const { j, f } = judging; judging = null;
    Object.assign(j, { state, why }); if (state === 'done') j.pct = 100;
    f.remove(); athletesRev++;
    nextJob();
  }
  setInterval(() => {
    if (!judging) return;
    const { j, f } = judging, w = f.contentWindow, a = w?.__analysis;
    let err = ''; try { const e = w?.document.getElementById('homeError'); if (e && !e.hidden) err = e.textContent.trim(); } catch { /* loading */ }
    if (a) { a.stop = !!j.stopAsked; if (a.pct !== j.pct) { j.pct = a.pct; judging.movedAt = Date.now(); } }
    if (a?.done) { judging.doneAt ??= Date.now(); if (Date.now() - judging.doneAt > 1500) endJob(j.stopAsked ? 'stopped' : 'done', j.stopAsked ? 'Stopped. What it found so far is on the right.' : ''); return; }
    if (err) return endJob('failed', err.replace(/\.?$/, '.'));
    if (j.stopAsked && !a) return endJob('stopped', 'Stopped before it began.');
    if (!a && Date.now() - judging.began > LOAD_MS) return endJob('failed', 'The AI judge didn\'t load in this browser.');
    if (a && Date.now() - judging.movedAt > STALL_MS) return endJob('failed', 'It stopped making progress.');
  }, 1000);
  // how long a video is (a recording straight from a browser may not say until it's been looked through)
  const lengthOf = (url) => new Promise((ok) => {
    const v = document.createElement('video'); v.preload = 'metadata'; v.muted = true;
    const done = (d) => { v.removeAttribute('src'); v.load(); ok(d); };
    v.onloadedmetadata = () => { if (Number.isFinite(v.duration)) return done(v.duration); v.ondurationchange = () => Number.isFinite(v.duration) && done(v.duration); v.currentTime = 1e9; };
    v.onerror = () => done(NaN);
    setTimeout(() => done(Number.isFinite(v.duration) ? v.duration : NaN), 15000);
    v.src = url;
  });
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

  async function answer(path, q, method, body) {
    const eng = /^\/api\/engine\/(\d+)(?:\/(\w+))?$/.exec(path);
    if (eng) {
      const c = cams.find((x) => x.n === +eng[1]);
      if (!c) return json({ error: 'No such camera' }, 404);
      if (FREE && !eng[2] && body?.on) return json({ error: 'The free camera has no live AI judge. Analyse a minute of its recording on the Results tab (Previous recordings), or book a server to judge live.' });
      if (!eng[2]) c.ai = !!body?.on;
      return json({ ok: true });
    }
    switch (path) {
      case '/api/state': return json(state());
      case '/api/days': return json([new Date().toISOString().slice(0, 10)]);
      case '/api/cameras': return json({ cameras: cams.map((c) => ({ n: c.n, live: c.live, video: c.video, larixUrl: `rtmp://test.headjudge.invalid:1935/live/station${c.n}?user=larix&pass=test`, rtmp: '', phone: qr, larix: qr })), bitrate: 3500, max: 2, firstCamera: 1 });
      case '/api/athletes': return json({ rev: athletesRev, list: [...athletes].reverse(), numbers });
      case '/api/athlete-track':
        if (method === 'POST') { trackSaid(body || {}); return json({ ok: true }); }
        if (FREE) { const t = tracks.get(+q.get('n')) || { frames: [], events: [] }; return json({ frames: [...t.frames].sort((x, y) => x[0] - y[0]), events: [...t.events].sort((x, y) => x.t - y.t) }); }
        return json(track(athletes.find((a) => a.n === +q.get('n')) || { reps: 0, firstAt: iso(Date.now()) }));
      case '/api/athlete':
        if (method === 'POST') return json({ ok: true, n: athleteSaid(body || {}).n });
        if (method === 'DELETE') { const i = athletes.findIndex((a) => a.n === +q.get('n')); if (i >= 0) athletes.splice(i, 1); athletesRev++; }
        return json({ ok: true });
      case '/api/number-seen': numberSaid(body || {}); return json({ ok: true });
      case '/api/judge-settings':
        if (method === 'PUT') { judgeSettings[body.key] = body.value; return json({ ok: true }); }
        return json(judgeSettings);
      case '/api/recorded': return json(piecesIn(+q.get('cam'), 0, Infinity).map((p) => ({ start: iso(p.start), duration: (p.end - p.start) / 1000 })));
      case '/api/marks': return json({ ok: true });
      case '/api/counts':
        if (method === 'POST') { counts = counts.filter((c) => c.id !== body.id).concat(body); return json({ ok: true }); }
        if (method === 'DELETE') { counts = counts.filter((c) => c.id !== q.get('id')); return json({ ok: true }); }
        return json({ counts });
      case '/api/uploads':
        if (method === 'DELETE') {
          const name = q.get('name'); uploads.splice(uploads.findIndex((u) => u.name === name) >>> 0, 1);
          if (FREE) { for (let i = athletes.length - 1; i >= 0; i--) if (athletes[i].src === 'upload' && athletes[i].video === name) { tracks.delete(athletes[i].n); pics.delete(athletes[i].n); athletes.splice(i, 1); } athletesRev++; }
          return json({ ok: true });
        }
        return json(uploads);
      case '/api/upload-jobs':
        if (FREE && method === 'POST') {
          let video = body?.video || '', name = body?.name || video;
          if (body?.previous) {
            const rec = recordingsNow().find((x) => x.id === body.previous);
            if (!rec) return json({ error: 'That recording is no longer in this browser' });
            if (rec.cam) {
              // a minute of camera 1, kept as a video of its own while it's judged and watched
              const [s, e] = rec.span, secs = Math.min(MAX_SECS, Math.max(1, Math.round((e - s) / 1000)));
              video = `${iso(s).replace(/[:.]/g, '-')}_Camera_1.webm`; name = `Camera 1, ${new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
              files.set(video, (win) => clipUrl(1, s, secs, win)); prevSources[video] = rec.file;
              if (!uploads.some((u) => u.name === video)) uploads.unshift({ name: video, size: rec.size });
            } else { video = rec.file; name = rec.name; }
          }
          if (!files.has(video)) return json({ error: 'That video is no longer in this browser' });
          if (judging?.j.video === video) return json({ id: judging.j.id, video, name, state: 'running', pct: judging.j.pct || 0 });
          for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].video === video) jobs.splice(i, 1);
          const j = { id: `job${++jobSeq}`, video, name, state: 'queued', pct: 0, at: Date.now() };
          jobs.push(j); nextJob();
          return json({ id: j.id, video, name, state: j.state, pct: 0 });
        }
        if (FREE) return json(jobs.map(({ id, video, name, state, pct, why }) => ({ id, video, name, state, pct: pct || 0, why: why || '' })));
        if (method === 'POST') {
          const video = body?.video || '';
          // a previous recording, "fetched" to be analysed (there's no video to play in test mode)
          if (body?.previous) {
            const rec = recordingsNow().find((x) => x.id === body.previous), video = `${new Date().toISOString().replace(/[:.]/g, '-')}_Recording_${body.previous}.mp4`;
            if (rec) prevSources[video] = rec.file; // as the server does: its local copy, and the recording it came from
            const j = { id: `job${jobs.length + 1}`, video, name: `Recording ${body.previous}`, state: 'running', at: Date.now() };
            // one recorded here plays: the people found in it are spread across how long it is
            if (rec?.span) { const [s, e] = rec.span, secs = Math.max(5, Math.round((e - s) / 1000)); j.span = secs; files.set(video, () => clipUrl(1, s, secs)); }
            jobs.push(j); return json(jobView(j));
          }
          const old = jobs.find((j) => j.video === video); if (old) jobs.splice(jobs.indexOf(old), 1);
          const j = { id: `job${jobs.length + 1}`, video, name: body?.name || video, state: 'running', at: Date.now() };
          jobs.push(j); return json(jobView(j));
        }
        return json(jobs.map(jobView));
      case '/api/upload-jobs/stop': {
        const j = jobs.find((x) => x.video === body?.video);
        if (FREE && j?.state === 'queued') Object.assign(j, { state: 'stopped', why: 'Stopped before it began.' });
        else if (FREE && j?.state === 'running') j.stopAsked = true;
        else if (j && j.state === 'running') { j.state = 'stopped'; j.why = 'Stopped. What it found so far is on the right.'; }
        return json({ stopped: !!j });
      }
      case '/api/previous-recordings': return json({ recordings: recordingsNow(), sources: prevSources });
      case '/api/server': return json({ log: ['Test mode: there is no server'], cloud: {}, idle: {} });
      default: return json({ error: 'Not in test mode' }, 404);
    }
  }
  // camera 1's recordings made in this browser, camera 2's pretend 10-minute recordings from the last half hour (it has no video), one
  // from yesterday nobody's judged, and the videos uploaded here
  function recordingsNow() {
        const seg = (id, cam, startMs) => ({ id, cam, size: 380e6 + cam * 7e6, startedAt: iso(startMs), file: `cam${cam}-${id}.mp4`, name: '' });
        const recs = [...browserRecordings(), ...(FREE ? [] : [seg('c2a', 2, T0 - 10 * 60e3), seg('c2b', 2, T0 - 20 * 60e3), seg('old', 1, T0 - 26 * 3600e3)])];
        // (a minute of camera 1 being judged is listed as camera 1's, not as an upload)
        for (const u of uploads) if (!FREE || !prevSources[u.name]) recs.push({ id: `u-${u.name}`, cam: 0, size: u.size, startedAt: iso(Date.now() - 60e3), file: u.name, name: u.name.replace(/^[\dTZ-]+_/, '') });
        return recs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  // who you are and your company go to the site's real API; everything a server would answer is answered here
  const SITE_API = /^\/api\/(me|companies\/mine)$/;
  const ours = (path) => (path.startsWith('/api/') && !SITE_API.test(path)) || path.startsWith('/whep/') || path === '/clip';
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || !ours(url.pathname)) return realFetch(input, init);
    if (url.pathname.startsWith('/whep/')) return whep(url.pathname, init.body);
    // asked first, so a missing recording says why (the video itself comes through rewrite, below)
    if (url.pathname === '/clip') {
      const cam = +url.searchParams.get('cam'), from = Date.parse(url.searchParams.get('start')), secs = +url.searchParams.get('duration') || 60;
      if (piecesIn(cam, from, from + secs * 1000).length) return new Response(null, { status: 206 });
      return json({ error: cam === 1 && !cam1.pieces.length && cam1.why ? cam1.why.replace(/^camera 1: /, 'Nothing recorded: ') : 'No recording at that time' }, 404);
    }
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { /* not JSON */ }
    await new Promise((r) => setTimeout(r, 60)); // a little like a real server
    return answer(url.pathname, url.searchParams, (init.method || 'GET').toUpperCase(), body);
  };
  // uploads go nowhere: the file stays in this browser, and plays from here
  const RealXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = class extends RealXHR {
    open(method, url, ...rest) { this.testUrl = new URL(url, location.href); return super.open(method, url, ...rest); }
    send(file) {
      if (!this.testUrl || this.testUrl.pathname !== '/api/upload') return super.send(file);
      const name = this.testUrl.searchParams.get('name') || 'video.mp4', saved = `${new Date().toISOString().replace(/[:.]/g, '-')}_${name.replace(/[^\w.-]+/g, '_')}`;
      const url = URL.createObjectURL(file);
      const refuse = (error) => { URL.revokeObjectURL(url); Object.defineProperty(this, 'status', { value: 413 }); Object.defineProperty(this, 'responseText', { value: JSON.stringify({ error }) }); this.onload?.(); };
      // the free camera's AI judge takes a minute of video at a time
      if (FREE) {
        lengthOf(url).then((secs) => {
          if (!Number.isFinite(secs)) return refuse('this browser can\'t play that video');
          if (secs > MAX_SECS + 0.5) return refuse(`the free camera analyses videos of up to 1 minute, and this one is ${mmss(secs)}. Trim it to the minute you want judged, or book a server for longer videos`);
          files.set(saved, url); uploads.unshift({ name: saved, size: file.size || 0 });
          Object.defineProperty(this, 'status', { value: 200 }); Object.defineProperty(this, 'responseText', { value: JSON.stringify({ saved }) });
          this.onload?.();
        });
        return;
      }
      files.set(saved, url); uploads.unshift({ name: saved, size: file.size || 0 });
      let k = 0;
      const tick = () => {
        k += 25; this.upload.onprogress?.({ lengthComputable: true, loaded: k, total: 100 });
        if (k < 100) return setTimeout(tick, 150);
        Object.defineProperty(this, 'status', { value: 200 }); Object.defineProperty(this, 'responseText', { value: JSON.stringify({ saved }) });
        this.onload?.();
      };
      setTimeout(tick, 150);
    }
  };
  // a pretend picture of an athlete, as the judge crops one from the video: a figure in a coloured top, with their number
  const SHIRTS = ['#ffc400', '#4aa3ff', '#ff7a59', '#3ddc97', '#c084fc', '#f472b6'];
  const pic = (n) => {
    const a = athletes.find((x) => x.n === n), bib = a && a.bib !== 'No number' ? a.bib : '', shirt = SHIRTS[n % SHIRTS.length];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 80"><rect width="60" height="80" fill="#2b3640"/><rect y="62" width="60" height="18" fill="#3a352d"/>
      <circle cx="30" cy="14" r="8" fill="#c9a27e"/><path d="M17 26h26l3 24H14z" fill="${shirt}"/><path d="M19 50h9l-1 26h-7zM32 50h9l-1 26h-7z" fill="#39424d"/>
      <path d="M17 27l-7 20M43 27l7 20" stroke="#c9a27e" stroke-width="5" stroke-linecap="round"/>
      ${bib ? `<rect x="21" y="32" width="18" height="11" fill="#fff"/><text x="30" y="40.5" font-size="8" font-family="Arial" font-weight="700" text-anchor="middle">${bib}</text>` : ''}</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  };
  for (const a of athletes) a.pic = 1;
  // what the page points frames, videos and pictures at: the camera settings come from the site's own judge page, a started AI judge
  // (or a detailed analysis) shows TEST over its camera or clip, recordings and uploaded videos play from this browser, and athletes'
  // pictures are drawn here
  const rewrite = (v, win = window) => {
    const s = String(v);
    const p = /\/api\/athlete-pic\?n=(\d+)/.exec(s); if (p) return FREE ? pics.get(+p[1]) || 'data:,' : pic(+p[1]);
    // the free camera's AI judge is the real one, in this browser
    if (FREE && s.startsWith('/judge/judge.html')) return s.replace('/judge/judge.html', '/judge-free.html');
    if (s.startsWith('/judge/judge.html')) {
      if (s.includes('settings=1')) return s.replace('/judge/judge.html', '/judge.html');
      const jq = new URL(s, location.href).searchParams;
      return `test-judge.html?${new URLSearchParams({ cam: jq.get('follow') || '', clip: jq.get('clip') || '', at: jq.get('pickt') || '' })}`;
    }
    if (s.startsWith('/clip?')) { const cq = new URL(s, location.href).searchParams; return clipUrl(+cq.get('cam'), Date.parse(cq.get('start')), +cq.get('duration') || 60, win); }
    const up = /^\/uploads\/(.+)$/.exec(s);
    if (up) { const f = files.get(decodeURIComponent(up[1])); return typeof f === 'function' ? f(win) : f || s; }
    return s;
  };
  // the free camera's AI judge page (/judge-free.html) reports here, and plays its videos from here
  window.hjFree = FREE ? { fetch: (input, init) => window.fetch(input, init), media: rewrite, ours: (p) => /^\/api\/(athlete|athlete-track|number-seen|engine\/\d+\/\w+)$/.test(p) } : null;
  // for the TEST judge window: camera 1 live, or a clip or video to play
  window.hjTestCamera = (n) => (n === 1 && cam1.stream?.active ? cam1.stream : null);
  window.hjTestMedia = rewrite;
  for (const El of [HTMLIFrameElement, HTMLVideoElement, HTMLImageElement]) {
    const d = Object.getOwnPropertyDescriptor(El === HTMLVideoElement ? HTMLMediaElement.prototype : El.prototype, 'src');
    Object.defineProperty(El.prototype, 'src', { get() { return d.get.call(this); }, set(v) { d.set.call(this, rewrite(v)); }, configurable: true });
  }
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      for (const el of [n, ...n.querySelectorAll('video[src], iframe[src], img[src]')]) if (el.matches?.('video[src], iframe[src], img[src]')) { const was = el.getAttribute('src'), now = rewrite(was); if (now !== was) el.setAttribute('src', now); }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  // there's no server to sign out of: Sign out says what it would do
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('#signOut')) return;
    e.preventDefault();
    if (FREE) { location.href = '/console.html'; return; }
    window.toast?.('Test mode: on a real server, this signs this browser out of the video review');
  }, true);
  // nor to save a clip from
  document.addEventListener('click', (e) => {
    if (!e.target.closest?.('a[href^="/clip?"]')) return;
    e.preventDefault();
    window.toast?.(FREE ? 'Saving clips needs a server: book one from your console' : 'Test mode: on a real server, this saves the clip as an MP4 file');
  }, true);
  window.HJ_TEST = true;
  // the camera is asked for once the page knows it's an admin looking (scripts/build-review-test.mjs)
  window.hjTestStart = () => { window.hjTestStart = () => {}; startCamera(); };
  document.addEventListener('DOMContentLoaded', () => { if (cam1.why) say(cam1.why); });
})();
