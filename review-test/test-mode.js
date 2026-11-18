// Test mode for the video review: the real page (server/review), on the site, with no server behind it. Everything it would ask its
// server for is answered here, in the browser, with a pretend company: two cameras, some results, and uploads that "analyse" in a
// few seconds. Camera 1 is an animated demo of the pretend athletes doing burpees (drawn in the colours and numbers of their results'
// pictures, doing the reps they're credited with): shown live the way a server shows a camera (WebRTC), and recorded here, with its
// last 8 minutes made in advance, so rewinding Live, Watch, Pick athlete and previous recordings show them. Camera 2 waits for its
// phone, with its QR codes. Starting an AI judge shows TEST over the picture instead of a judge, and the people who come along are
// added to the results. Nothing is sent anywhere:
// recordings and uploaded videos stay in this browser. Built into the site by scripts/build-review-test.mjs; admins only.
//
// The free camera (window.HJ_FREE, built as /review-free/ for any company) is the same thing with nothing pretend: one camera, this
// browser's, and the real AI judge (/judge-free.html) run here, in this browser, on a minute of video at a time: a minute of camera 1
// (its recordings come in 1-minute pieces) or an uploaded video of up to a minute; and live, camera 1's own judge judging its picture
// here (rather than following a server's, as on a server).
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
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 25 25"><rect width="25" height="25" fill="#fff"/><g fill="#000">${cells}</g><rect x="7" y="10" width="11" height="5" fill="#e2231a"/><text x="12.5" y="13.9" font-size="3.6" font-family="Arial" font-weight="700" text-anchor="middle">TEST</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  })();

  // ---- the pretend server
  const cams = [
    { n: 1, live: false, from: '', route: '', video: '', watchers: 1, ai: false }, // live once this browser's camera is on
    { n: 2, live: false, from: '', route: '', video: '', watchers: 0, ai: false },
  ].slice(0, FREE ? 1 : 2);
  let athletesRev = 1, seq = 4, judgeSettings = {}, counts = [];
  // ---- test mode's people: who camera 1's animated demo shows (below), on a timetable. Each is drawn doing exactly the reps and no
  // reps they're credited with, in the colours and number of their picture. The first six were there before the page was opened
  // (its last 8 minutes are made in advance, as if it had been recording); more come along while it's open.
  const SHIRTS = ['#ffc400', '#4aa3ff', '#ff7a59', '#3ddc97', '#c084fc', '#f472b6'];
  const BIBS = ['12', '407', 'No number', '73', '219', '5', '640'];
  const PAST_MS = 8 * 60e3;
  const timetable = [];   // { bib, shirt, lane, first, last, reps, noReps, questionable, cycle, events: [{ t, type, count }], n }
  const NOREP_WHY = ['Hands: not over the ears at the top'];
  function plan(o) {
    const total = o.reps + o.noReps, from = o.first + 3000, step = (o.last - 2000 - from) / total;
    const misses = new Set(Array.from({ length: o.noReps }, (_, k) => Math.floor(((k + 1) * total) / (o.noReps + 1))));
    let count = 0;
    o.events = Array.from({ length: total }, (_, i) => (misses.has(i) ? { t: from + step * (i + 0.5), type: 'norep', count } : { t: from + step * (i + 0.5), type: 'rep', count: ++count }));
    o.cycle = Math.min(3000, step * 0.9);
    timetable.push(o);
    return o;
  }
  const athletes = [], schedOf = new Map();   // n → { a: its timetable entry, base: the time 0 of its video (an analysed recording) }
  const numbers = [];
  if (!FREE) {
    const m = (x) => T0 + x * 60e3;
    for (const [n, bib, lane, from, to, reps, noReps, questionable, round] of [
      [1, '214', 0, -7.8, -5.2, 23, 0, 0, 1], [5, '57', 1, -7.2, -4.6, 21, 0, 0, 1], [2, '88', 0, -4.8, -2.2, 19, 1, 1, 1],
      [6, '302', 1, -4.2, -1.4, 25, 3, 0, 1], [3, 'No number', 0, -2.0, -0.3, 17, 2, 0, 1], [4, '131', 1, -1.0, 1.6, 18, 0, 0, 2]]) {
      const a = plan({ bib, shirt: SHIRTS[n % SHIRTS.length], lane, first: m(from), last: m(to), reps, noReps, questionable, n });
      athletes.push({ n, src: 'live', video: '', cam: 1, round, label: n, bib, firstAt: iso(a.first), lastAt: iso(a.first), reps: 0, noReps: 0, questionable, done: false, pic: 1 });
      schedOf.set(n, { a, base: 0 });
    }
    // two numbers shown to the camera just before their athletes started
    for (const [id, n] of [['n1', 1], ['n2', 2]]) { const a = schedOf.get(n).a; numbers.push({ id, number: a.bib, src: 'live', cam: 1, video: '', firstAt: iso(a.first - 12e3), lastAt: iso(a.first - 11e3), firstT: 0, lastT: 0 }); }
  }
  seq = FREE ? 0 : 6;
  // more people while it's open, each lane free again a few seconds after the last one left; picked up by camera 1's AI judge if it's on
  const laneFree = [T0 + 12e3, T0 + 1.6 * 60e3 + 10e3];
  function planAhead(until) {
    for (let l = 0; l < 2; l++) while (laneFree[l] < until) {
      const k = timetable.length, first = laneFree[l], last = first + 60e3 + ((k * 17) % 30) * 1e3;
      plan({ bib: BIBS[k % BIBS.length], shirt: SHIRTS[(k + 2) % SHIRTS.length], lane: l, first, last, reps: 8 + ((k * 5) % 7), noReps: k % 3 === 0 ? 1 : 0, questionable: 0 });
      laneFree[l] = last + 8e3 + (k % 3) * 4e3;
    }
  }
  // what the results say now: reps so far, still going or done, and anyone the AI judge has just picked up
  function catchUp() {
    if (FREE) return;
    const now = Date.now();
    planAhead(now + 5 * 60e3);
    for (const a of timetable) if (a.n == null && cams[0].ai && cams[0].live && now >= a.first && now < a.last) {
      a.n = ++seq;
      athletes.push({ n: a.n, src: 'live', video: '', cam: 1, round: 3, label: a.n, bib: a.bib, firstAt: iso(now), lastAt: iso(now), reps: 0, noReps: 0, done: false, pic: 1 });
      schedOf.set(a.n, { a, base: 0 }); athletesRev++;
    }
    for (const x of athletes) {
      const sc = x.src === 'live' && schedOf.get(x.n); if (!sc) continue;
      const seen = sc.a.events.filter((e) => e.t <= now), reps = seen.filter((e) => e.type === 'rep').length, noReps = seen.length - reps, done = now > sc.a.last;
      if (reps !== x.reps || noReps !== x.noReps || done !== x.done) { Object.assign(x, { reps, noReps, done }); athletesRev++; }
      x.lastAt = iso(Math.min(now, sc.a.last));
    }
  }
  const events = FREE ? [] : [{ t: minsAgo(10), cam: 2, type: 'lost', route: '' }];
  const uploads = [], files = new Map(), jobs = [], prevSources = {};
  // an athlete's proof for Watch: for one in the demo, their skeleton and every rep and no rep, as the AI judge would have saved them
  // (times on the clock, or ms into the video for one found in an analysed recording); otherwise a few reps and a no rep
  const track = (a) => {
    const sc = schedOf.get(a.n);
    if (sc) {
      const now = Date.now(), d = sc.a, lo = a.src === 'upload' ? sc.base + (a.firstT || 0) * 1000 : d.first, hi = Math.min(now, a.src === 'upload' ? sc.base + (a.lastT || 0) * 1000 : d.last + 1500);
      const frames = [];
      for (let t = lo; t <= hi; t += 83) { const p = poseAt(d, t); if (p) frames.push(proofFrame(d, p.j, Math.round(t - sc.base))); }
      return { frames, events: d.events.filter((e) => e.t >= lo && e.t <= hi).map((e) => ({ type: e.type, count: e.count, t: Math.round(e.t - sc.base), from: Math.round(e.t - 0.52 * d.cycle - sc.base), reasons: e.type === 'norep' ? NOREP_WHY : [], assumed: [] })) };
    }
    const k = Math.min(a.reps, 6), up = a.src === 'upload';
    const t0 = up ? (a.firstT || 0) * 1000 : Date.parse(a.firstAt), t1 = up ? (a.lastT ?? a.firstT ?? 0) * 1000 : Date.parse(a.lastAt), step = (t1 - t0) / (k + 1);
    return { frames: [], events: Array.from({ length: k }, (_, i) => ({ type: i === 2 && a.noReps ? 'norep' : 'rep', count: i + 1, t: Math.round(t0 + step * (i + 1)), reasons: i === 2 && a.noReps ? ['Jump: both feet off the ground'] : [] })) };
  };
  const jobView = (j) => {
    const pct = Math.min(100, Math.round((Date.now() - j.at) / 80));
    if (j.state === 'running' && pct >= 100) {
      j.state = 'done';
      const round = Date.now(), span = j.span || 115;
      // a recording of the demo camera: the people in it while it recorded, with what they did in it
      if (j.from != null) {
        const s = j.from, e = s + span * 1000;
        for (const d of timetable) {
          if (d.last < s || d.first > e) continue;
          const seen = d.events.filter((x) => x.t >= s && x.t <= e), reps = seen.filter((x) => x.type === 'rep').length;
          athletes.push({ n: ++seq, src: 'upload', video: j.video, cam: 0, round, label: seq, bib: d.bib, firstT: Math.max(0, (d.first - s) / 1000), lastT: Math.min(span, (d.last - s) / 1000), firstAt: iso(j.at), lastAt: iso(Date.now()), reps, noReps: seen.length - reps, done: true, pic: 1 });
          schedOf.set(seq, { a: d, base: s });
        }
        athletesRev++;
        return { id: j.id, video: j.video, name: j.name, state: j.state, pct: 100, why: '' };
      }
      // an uploaded video: the people "found" in it, at different points in it (a share of how long it is: about 2 minutes)
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
    brand: window.HJ_BRAND || { id: 'test', name: FREE ? 'Free camera' : 'Test company', logo: '', theme: { primary: '#e2231a', accent: '#3ddc97', mode: 'dark' } },
  });
  // ---- camera 1: this browser's camera, recorded here in 10-second pieces kept for 20 minutes. A stretch of it plays as one video,
  // its pieces put together in the browser (Media Source), starting at the moment asked for, just as a server cuts a clip.
  const REC_TYPES = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/mp4;codecs=avc1.42E01E'];
  // the free camera's recordings are listed a minute at a time: as much as the AI judge analyses in one go here
  const PIECE_MS = 10e3, KEEP_MS = 20 * 60e3, BLOCK_MS = FREE ? 60e3 : 10 * 60e3, MAX_SECS = 60;
  const cam1 = { stream: null, rec: null, live: null, type: '', pieces: [], began: 0, why: '', gen: 0, tries: 0 };
  const say = (what) => { cam1.why = what; const el = document.getElementById('tmCam'); if (el) el.textContent = what; };

  // ---- test mode's camera 1: an animated demo, drawn from the timetable for any moment. Side-on figures doing burpees in two lanes:
  // down, chest to the floor, back up and a jump with hands over the head (a no rep: no jump, hands at the chest).
  const DW = 640, DH = 360, FLOOR = 0.86 * DH, SIZE = 0.5 * DH, LANE_X = [0.3 * DW, 0.68 * DW], DEMO_FPS = 15, PAST_FPS = 10;
  const J = (toe, heel, ankle, knee, hip, shoulder, elbow, wrist, ear, nose) => ({ toe, heel, ankle, knee, hip, shoulder, elbow, wrist, ear, nose });
  const POSE = {
    stand: J([0.09, 0], [-0.04, 0], [0, -0.02], [0.01, -0.27], [0, -0.52], [0.01, -0.8], [0.03, -0.64], [0.06, -0.5], [0, -0.9], [0.07, -0.9]),
    squat: J([0.09, 0], [-0.04, 0], [0, -0.02], [0.2, -0.2], [-0.04, -0.26], [0.17, -0.46], [0.27, -0.24], [0.32, -0.01], [0.22, -0.55], [0.29, -0.54]),
    plank: J([-0.6, 0], [-0.67, -0.05], [-0.64, -0.03], [-0.4, -0.05], [-0.13, -0.07], [0.2, -0.07], [0.12, -0.13], [0.25, -0.01], [0.3, -0.1], [0.37, -0.07]),
    jump: J([0.09, -0.1], [-0.04, -0.13], [0, -0.12], [0.01, -0.38], [0, -0.62], [0.01, -0.9], [0.03, -1.06], [0.04, -1.2], [0, -1], [0.07, -1]),
    top: J([0.09, 0], [-0.04, 0], [0, -0.02], [0.01, -0.27], [0, -0.52], [0.01, -0.8], [0.12, -0.7], [0.16, -0.82], [0, -0.9], [0.07, -0.9]),
  };
  // where in a burpee (0 to 1) each pose is reached; the rep counts at the top of the jump (0.82)
  const CYCLE = [[0, 'stand'], [0.15, 'squat'], [0.3, 'plank'], [0.4, 'plank'], [0.55, 'squat'], [0.7, 'stand'], [0.82, 'top'], [1, 'stand']];
  function cyclePose(p, good) {
    let i = 0; while (i < CYCLE.length - 2 && p >= CYCLE[i + 1][0]) i++;
    const [a0, n0] = CYCLE[i], [a1, n1] = CYCLE[i + 1], k = Math.max(0, Math.min(1, (p - a0) / (a1 - a0))), e = k * k * (3 - 2 * k);
    const A = POSE[n0 === 'top' && good ? 'jump' : n0], B = POSE[n1 === 'top' && good ? 'jump' : n1], out = {};
    for (const j in A) out[j] = [A[j][0] + (B[j][0] - A[j][0]) * e, A[j][1] + (B[j][1] - A[j][1]) * e];
    return out;
  }
  // someone's pose at time t, and how faded in or out they are (null: not there)
  function poseAt(d, t) {
    if (t < d.first || t > d.last + 1500) return null;
    const alpha = Math.max(0, Math.min(1, (t - d.first) / 800, (d.last + 1500 - t) / 800));
    const e = d.events.find((x) => t >= x.t - 0.82 * d.cycle && t <= x.t + 0.18 * d.cycle);
    return { j: e ? cyclePose((t - (e.t - 0.82 * d.cycle)) / d.cycle, e.type === 'rep') : POSE.stand, alpha };
  }
  const place = (d, u, side = 0) => [LANE_X[d.lane] + u[0] * SIZE + side, FLOOR + u[1] * SIZE];
  // the points the AI judge saves for Watch (app.js PROOF_POINTS: nose, ears, shoulders, elbows, wrists, hips, knees, ankles, heels, toes)
  const PROOF_JOINTS = ['nose', 'ear', 'ear', 'shoulder', 'shoulder', 'elbow', 'elbow', 'wrist', 'wrist', 'hip', 'hip', 'knee', 'knee', 'ankle', 'ankle', 'heel', 'heel', 'toe', 'toe'];
  const proofFrame = (d, j, t) => [t, 0, ...PROOF_JOINTS.flatMap((k, i) => { const [x, y] = place(d, j[k], i % 2 ? 0 : 3); return [Math.round((x / DW) * 1e4), Math.round((y / DH) * 1e4)]; })];
  function drawPerson(x, d, j, alpha) {
    const P = (k, side = 0) => place(d, j[k], side), line = (pts, w, colour) => { x.strokeStyle = colour; x.lineWidth = w; x.beginPath(); pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.stroke(); };
    x.save(); x.globalAlpha = alpha; x.lineCap = 'round'; x.lineJoin = 'round';
    const [fx] = P('ankle'), [hx] = P('hip');
    x.fillStyle = 'rgba(0,0,0,.25)'; x.beginPath(); x.ellipse((fx + hx) / 2, FLOOR + 3, SIZE * 0.32, 5, 0, 0, Math.PI * 2); x.fill();
    for (const side of [5, 0]) { // the far leg and arm a shade darker, then the near ones
      line([P('hip', side), P('knee', side), P('ankle', side)], SIZE * 0.075, side ? '#2c333c' : '#39424d');
      line([P('heel', side), P('toe', side)], SIZE * 0.045, '#15191e');
      if (side) line([P('shoulder', side), P('elbow', side), P('wrist', side)], SIZE * 0.05, '#a9845f');
      else {
        line([P('shoulder'), P('hip')], SIZE * 0.16, d.shirt);
        line([P('shoulder'), P('elbow'), P('wrist')], SIZE * 0.055, '#c9a27e');
      }
    }
    // the number on their chest, along their body
    if (d.bib && d.bib !== 'No number') {
      const [sx, sy] = P('shoulder'), [qx, qy] = P('hip'), ang = Math.atan2(qy - sy, qx - sx) - Math.PI / 2;
      x.save(); x.translate((sx + qx) / 2, (sy + qy) / 2); x.rotate(ang);
      x.fillStyle = '#fff'; x.fillRect(-SIZE * 0.07, -SIZE * 0.045, SIZE * 0.14, SIZE * 0.09);
      x.fillStyle = '#111'; x.font = `700 ${Math.round(SIZE * 0.065)}px Arial`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(d.bib, 0, 1);
      x.restore();
    }
    const [ex, ey] = P('ear'), [nx, ny] = P('nose');
    x.fillStyle = '#c9a27e'; x.beginPath(); x.arc(ex + (nx - ex) * 0.4, ey + (ny - ey) * 0.4, SIZE * 0.075, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#3b2a1e'; x.beginPath(); x.arc(ex + (nx - ex) * 0.25, ey + (ny - ey) * 0.25 - SIZE * 0.02, SIZE * 0.07, Math.PI, Math.PI * 2); x.fill();
    x.restore();
  }
  const clock = (t) => { const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
  function drawScene(x, t) {
    const g = x.createLinearGradient(0, 0, 0, FLOOR); g.addColorStop(0, '#26303a'); g.addColorStop(1, '#3a4652');
    x.fillStyle = g; x.fillRect(0, 0, DW, FLOOR);
    x.fillStyle = '#3a352d'; x.fillRect(0, FLOOR, DW, DH - FLOOR);
    x.fillStyle = '#2a2620'; for (const lx of LANE_X) x.fillRect(lx - SIZE * 0.78, FLOOR - 2, SIZE * 1.25, 8);
    x.fillStyle = 'rgba(255,255,255,.06)'; for (let i = 0; i < 6; i++) x.fillRect(40 + i * 110, 40, 70, 50); // windows on the far wall
    for (const d of timetable) { const p = poseAt(d, t); if (p) drawPerson(x, d, p.j, p.alpha); }
    const ly = DH - 34; // at the bottom, clear of the review's own camera name and LIVE tag
    x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(8, ly, 196, 26); x.fillRect(DW - 70, ly, 62, 26);
    x.fillStyle = '#fff'; x.font = '700 15px Arial'; x.textAlign = 'left'; x.textBaseline = 'middle';
    x.fillText(`CAMERA 1  ${clock(t)}`, 16, ly + 13); x.fillStyle = '#e2231a'; x.fillText('DEMO', DW - 62, ly + 13);
  }
  // live: drawn 15 times a second, and given to the page as camera 1 (recorded and shown just as a real camera is)
  function demoStream() {
    const c = document.createElement('canvas'); c.width = DW; c.height = DH;
    const x = c.getContext('2d'), draw = () => drawScene(x, Date.now());
    draw(); setInterval(draw, 1000 / DEMO_FPS);
    return c.captureStream(DEMO_FPS);
  }

  // ---- its last 8 minutes, made in advance: drawn and compressed as fast as this computer can (WebCodecs), as 10-second pieces like
  // the ones recorded live, so it's as if camera 1 had been recording before the page was opened. Newest first.
  const cat = (parts) => { const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
  const vsize = (n) => { let len = 1; while (len < 8 && n >= 2 ** (7 * len) - 1) len++; const o = new Uint8Array(len); for (let i = len - 1, v = n; i >= 0; i--, v = Math.floor(v / 256)) o[i] = v % 256; o[0] |= 1 << (8 - len); return o; };
  const el = (id, ...body) => { const b = cat(body); return cat([new Uint8Array(id), vsize(b.length), b]); };
  const uint = (id, v) => { const o = []; do { o.unshift(v % 256); v = Math.floor(v / 256); } while (v > 0); return el(id, new Uint8Array(o)); };
  const text = (id, s) => el(id, new TextEncoder().encode(s));
  // a WebM file of VP8 frames, one cluster per key frame (times in ms; the segment's size left open, as a browser's recorder does)
  function webm(frames) {
    const head = el([0x1A, 0x45, 0xDF, 0xA3], uint([0x42, 0x86], 1), uint([0x42, 0xF7], 1), uint([0x42, 0xF2], 4), uint([0x42, 0xF3], 8), text([0x42, 0x82], 'webm'), uint([0x42, 0x87], 2), uint([0x42, 0x85], 2));
    const info = el([0x15, 0x49, 0xA9, 0x66], uint([0x2A, 0xD7, 0xB1], 1e6), text([0x4D, 0x80], 'SpartanReferee demo'), text([0x57, 0x41], 'SpartanReferee demo'));
    const tracks = el([0x16, 0x54, 0xAE, 0x6B], el([0xAE], uint([0xD7], 1), uint([0x73, 0xC5], 1), uint([0x83], 1), text([0x86], 'V_VP8'), el([0xE0], uint([0xB0], DW), uint([0xBA], DH))));
    const clusters = [];
    let at = 0, blocks = [];
    const close = () => { if (blocks.length) clusters.push(el([0x1F, 0x43, 0xB6, 0x75], uint([0xE7], at), ...blocks)); blocks = []; };
    for (const f of frames) {
      if (f.key) { close(); at = Math.round(f.t); }
      const rel = Math.round(f.t) - at;
      blocks.push(el([0xA3], new Uint8Array([0x81, (rel >> 8) & 255, rel & 255, f.key ? 0x80 : 0]), f.data));
    }
    close();
    return new Blob([head, new Uint8Array([0x18, 0x53, 0x80, 0x67, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]), info, tracks, ...clusters], { type: 'video/webm' });
  }
  let pastBackTo = -Infinity; // while the earlier minutes are being made: how far back they go so far
  async function makePast(until) {
    if (!window.VideoEncoder || cam1.type !== 'video/webm;codecs=vp8') return;
    const config = { codec: 'vp8', width: DW, height: DH, bitrate: 1e6, framerate: PAST_FPS };
    if (!(await VideoEncoder.isConfigSupported(config).catch(() => null))?.supported) return;
    const c = document.createElement('canvas'); c.width = DW; c.height = DH;
    const x = c.getContext('2d', { willReadFrequently: false });
    pastBackTo = until;
    try { await makePieces(until, config, x, c); } finally { pastBackTo = -Infinity; }
  }
  async function makePieces(until, config, x, c) {
    for (let end = until; end > until - PAST_MS + 500; end -= PIECE_MS) {
      const start = Math.max(until - PAST_MS, end - PIECE_MS), frames = [];
      const enc = new VideoEncoder({ output: (ch) => { const data = new Uint8Array(ch.byteLength); ch.copyTo(data); frames.push({ t: ch.timestamp / 1000, key: ch.type === 'key', data }); }, error: () => {} });
      enc.configure(config);
      const n = Math.round(((end - start) / 1000) * PAST_FPS);
      for (let i = 0; i < n; i++) {
        drawScene(x, start + (i * 1000) / PAST_FPS);
        const f = new VideoFrame(c, { timestamp: Math.round((i * 1e6) / PAST_FPS), duration: Math.round(1e6 / PAST_FPS) });
        enc.encode(f, { keyFrame: i % PAST_FPS === 0 }); f.close();
        while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 2));
      }
      await enc.flush(); enc.close();
      if (!frames.length) return;
      const blob = webm(frames.sort((a, b) => a.t - b.t));
      const at = cam1.pieces.findIndex((p) => p.start > start);
      cam1.pieces.splice(at < 0 ? cam1.pieces.length : at, 0, { start, end, chunks: [blob], size: blob.size });
      pastBackTo = start;
      await new Promise((r) => setTimeout(r, 30)); // the page carries on meanwhile
    }
  }

  async function startCamera() {
    if (FREE && !navigator.mediaDevices?.getUserMedia) return say('camera 1: this browser can\'t share a camera here');
    try {
      // test mode's camera 1 is the animated demo; the free camera's is this browser's own
      cam1.stream = FREE ? await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false }) : demoStream();
    } catch (e) {
      if (cam1.began && e.name !== 'NotAllowedError' && cam1.tries++ < 10) { setTimeout(startCamera, 3000); return; } // it was on: keep trying a while
      return say(e.name === 'NotAllowedError' ? 'camera 1: allow the camera (address bar) and reload to record from it' : cam1.began ? 'camera 1: this browser\'s camera stopped' : 'camera 1: no camera found on this computer');
    }
    const gen = ++cam1.gen, track = cam1.stream.getVideoTracks()[0], s = track.getSettings();
    cam1.live = cam1.stream.clone(); // what live viewers are sent (whep, below)
    cam1.tries = 0;
    const route = FREE ? 'this browser' : 'demo';
    Object.assign(cams[0], { live: true, route, video: s.width ? `${s.width}×${s.height}` : `${DW}×${DH}` });
    events.push({ t: iso(cam1.began || FREE ? Date.now() : T0 - PAST_MS), cam: 1, type: 'connected', route });
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
    const first = !cam1.began;
    if (first) cam1.began = FREE ? Date.now() : T0 - PAST_MS; // the demo has been "recording" for 8 minutes
    cam1.rec = cam1.stream.clone(); // the recording's own copy: a live viewer joining doesn't hold up its frames
    say(FREE ? 'camera 1: this browser\'s camera, recorded in this browser' : 'camera 1: an animated demo, recorded in this browser');
    nextPiece(gen);
    if (first && !FREE) makePast(cam1.pieces[0].start).catch(() => {});
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
    const ms = new win.MediaSource(), url = win.URL.createObjectURL(ms);
    ms.addEventListener('sourceopen', async () => {
      win.URL.revokeObjectURL(url);
      // the demo's earlier minutes still being made back to this point: wait for them (the video shows it's loading meanwhile)
      for (let i = 0; i < 400 && pastBackTo > from; i++) await new Promise((r) => setTimeout(r, 300));
      const pieces = piecesIn(cam, from, from + secs * 1000).map((p) => ({ start: p.start, blob: new Blob(p.chunks, { type: cam1.type }) }));
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
            if (rec?.span) { const [s, e] = rec.span, secs = Math.max(5, Math.round((e - s) / 1000)); j.span = secs; j.from = s; files.set(video, (win) => clipUrl(1, s, secs, win)); }
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
  // camera 1's recordings made in this browser (the demo's, or the free camera's), and the videos uploaded here
  function recordingsNow() {
        const recs = browserRecordings();
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
      if (piecesIn(cam, from, from + secs * 1000).length || pastBackTo > from) return new Response(null, { status: 206 }); // (or still being made)
      return json({ error: cam === 1 && !cam1.pieces.length && cam1.why ? cam1.why.replace(/^camera 1: /, 'Nothing recorded: ') : 'No recording at that time' }, 404);
    }
    let body = null; try { body = init.body ? JSON.parse(init.body) : null; } catch { /* not JSON */ }
    await new Promise((r) => setTimeout(r, 60)); // a little like a real server
    catchUp(); // the demo's people: what they've done by now
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
  // a pretend picture of an athlete, as the judge crops one from the video: a figure in their coloured top, with their number
  const pic = (n) => {
    const a = athletes.find((x) => x.n === n), bib = a && a.bib !== 'No number' ? a.bib : '', shirt = schedOf.get(n)?.a.shirt || SHIRTS[n % SHIRTS.length];
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
    // (a live camera's judge judges here, rather than following a server's: no follow=)
    if (FREE && s.startsWith('/judge/judge.html')) return s.replace('/judge/judge.html', '/judge-free.html').replace(/([?&])follow=\d+&?/, '$1').replace(/[?&]$/, '');
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
  // (its live judge gets camera 1 itself, shared with the live view: no WebRTC between the two pages)
  window.hjFree = FREE ? { camera: (url) => (/station1\b/.test(url) && cam1.live?.active ? cam1.live : null), fetch: (input, init) => window.fetch(input, init), media: rewrite, ours: (p) => /^\/api\/(athlete|athlete-track|number-seen|engine\/\d+\/\w+)$/.test(p) || p.startsWith('/whep/') } : null;
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
