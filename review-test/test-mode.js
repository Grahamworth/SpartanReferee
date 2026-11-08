// Test mode for the video review: the real page (server/review), on the site, with no server behind it. Everything it would ask its
// server for is answered here, in the browser, with a pretend company: two cameras (one live, one waiting for its phone with its QR
// codes), some results, and uploads that "analyse" in a few seconds. Starting an AI judge shows TEST instead of a judge. Nothing is
// sent anywhere: an uploaded video stays in this browser. Built into the site by scripts/build-review-test.mjs; admins only.
(() => {
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
    { n: 1, live: true, from: '', route: 'internet', video: '1280×720', watchers: 1, ai: false },
    { n: 2, live: false, from: '', route: '', video: '', watchers: 0, ai: false },
  ];
  let athletesRev = 1, seq = 4, judgeSettings = {}, counts = [];
  const athletes = [
    { n: 1, src: 'live', video: '', cam: 1, round: 1, label: 1, bib: '214', firstAt: minsAgo(22), lastAt: minsAgo(18), reps: 23, noReps: 0, done: true, pic: 0 },
    { n: 2, src: 'live', video: '', cam: 1, round: 1, label: 2, bib: '88', firstAt: minsAgo(15), lastAt: minsAgo(11), reps: 19, noReps: 1, questionable: 1, done: true, pic: 0 },
    { n: 3, src: 'live', video: '', cam: 2, round: 1, label: 3, bib: 'No number', firstAt: minsAgo(9), lastAt: minsAgo(6), reps: 17, noReps: 2, done: true, pic: 0 },
    { n: 4, src: 'live', video: '', cam: 1, round: 2, label: 4, bib: '131', firstAt: minsAgo(2), lastAt: minsAgo(0.1), reps: 8, noReps: 0, done: false, pic: 0 },
  ];
  const numbers = [
    { id: 'n1', number: '214', src: 'live', cam: 1, video: '', firstAt: minsAgo(22.2), lastAt: minsAgo(22.1), firstT: 0, lastT: 0 },
    { id: 'n2', number: '88', src: 'live', cam: 1, video: '', firstAt: minsAgo(15.3), lastAt: minsAgo(15.2), firstT: 0, lastT: 0 },
  ];
  const events = [{ t: minsAgo(25), cam: 1, type: 'connected', route: 'internet' }, { t: minsAgo(10), cam: 2, type: 'lost', route: '' }];
  const uploads = [], files = new Map(), jobs = [];
  const track = (a) => ({ frames: [], events: Array.from({ length: Math.min(a.reps, 6) }, (_, i) => ({ type: i === 2 && a.noReps ? 'norep' : 'rep', count: i + 1, t: Date.parse(a.firstAt) + 20000 + i * 9000, reasons: i === 2 && a.noReps ? ['Jump: both feet off the ground'] : [] })) });
  const jobView = (j) => {
    const pct = Math.min(100, Math.round((Date.now() - j.at) / 80));
    if (j.state === 'running' && pct >= 100) {
      j.state = 'done';
      athletes.push({ n: ++seq, src: 'upload', video: j.video, cam: 0, round: 1, label: seq, bib: '305', firstT: 3, lastT: 41, firstAt: iso(j.at), lastAt: iso(Date.now()), reps: 12, noReps: 1, done: true, pic: 0 });
      athletesRev++;
    }
    return { id: j.id, video: j.video, name: j.name, state: j.state, pct: j.state === 'done' ? 100 : pct, why: j.why || '' };
  };
  const state = () => ({
    now: new Date().toISOString(), cams: cams.map((c) => ({ ...c, judging: c.ai && c.live, fps: c.ai && c.live ? 15 : 0 })),
    marks: [], events, athletesRev, record: true, keepDays: 7, maxJudges: 2, until: T0 + 2 * 3600e3, firstCamera: 1,
    brand: { id: 'test', name: 'Test company', logo: '', theme: { primary: '#ffc400', accent: '#3ddc97', mode: 'dark' } },
  });
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
      case '/api/athlete-track': return json(track(athletes.find((a) => a.n === +q.get('n')) || { reps: 0, firstAt: iso(Date.now()) }));
      case '/api/athlete':
        if (method === 'DELETE') { const i = athletes.findIndex((a) => a.n === +q.get('n')); if (i >= 0) athletes.splice(i, 1); athletesRev++; }
        return json({ ok: true });
      case '/api/judge-settings':
        if (method === 'PUT') { judgeSettings[body.key] = body.value; return json({ ok: true }); }
        return json(judgeSettings);
      case '/api/recorded': return json([]);
      case '/api/marks': return json({ ok: true });
      case '/api/counts':
        if (method === 'POST') { counts = counts.filter((c) => c.id !== body.id).concat(body); return json({ ok: true }); }
        if (method === 'DELETE') { counts = counts.filter((c) => c.id !== q.get('id')); return json({ ok: true }); }
        return json({ counts });
      case '/api/uploads':
        if (method === 'DELETE') { const name = q.get('name'); uploads.splice(uploads.findIndex((u) => u.name === name) >>> 0, 1); return json({ ok: true }); }
        return json(uploads);
      case '/api/upload-jobs':
        if (method === 'POST') {
          const video = body?.video || '';
          if (body?.previous) return json({ error: 'There are no recordings in test mode' }, 502);
          const old = jobs.find((j) => j.video === video); if (old) jobs.splice(jobs.indexOf(old), 1);
          const j = { id: `job${jobs.length + 1}`, video, name: body?.name || video, state: 'running', at: Date.now() };
          jobs.push(j); return json(jobView(j));
        }
        return json(jobs.map(jobView));
      case '/api/upload-jobs/stop': { const j = jobs.find((x) => x.video === body?.video); if (j && j.state === 'running') { j.state = 'stopped'; j.why = 'Stopped. What it found so far is on the right.'; } return json({ stopped: !!j }); }
      case '/api/previous-recordings': return json({ recordings: [{ id: 'r1', cam: 1, size: 412e6, startedAt: minsAgo(40), file: 'test.mp4', name: '' }] });
      case '/api/server': return json({ log: ['Test mode: there is no server'], cloud: {}, idle: {} });
      default: return json({ error: 'Not in test mode' }, 404);
    }
  }
  const ours = (path) => (path.startsWith('/api/') && path !== '/api/me') || path.startsWith('/whep/') || path === '/clip';
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin !== location.origin || !ours(url.pathname)) return realFetch(input, init);
    if (url.pathname.startsWith('/whep/') || url.pathname === '/clip') return new Response('no video in test mode', { status: 404 });
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
      files.set(saved, URL.createObjectURL(file)); uploads.unshift({ name: saved, size: file.size || 0 });
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
  // what the page points frames and videos at: the camera settings come from the site's own judge page, a started AI judge shows TEST,
  // and an uploaded video plays from this browser
  const rewrite = (v) => {
    const s = String(v);
    if (s.startsWith('/judge/judge.html')) return s.includes('settings=1') ? s.replace('/judge/judge.html', '/judge.html') : 'test-judge.html';
    const up = /^\/uploads\/(.+)$/.exec(s); if (up) return files.get(decodeURIComponent(up[1])) || s;
    return s;
  };
  for (const El of [HTMLIFrameElement, HTMLVideoElement]) {
    const d = Object.getOwnPropertyDescriptor(El === HTMLIFrameElement ? HTMLIFrameElement.prototype : HTMLMediaElement.prototype, 'src');
    Object.defineProperty(El.prototype, 'src', { get() { return d.get.call(this); }, set(v) { d.set.call(this, rewrite(v)); }, configurable: true });
  }
  new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      for (const el of [n, ...n.querySelectorAll('video[src], iframe[src]')]) if (el.matches?.('video[src], iframe[src]')) { const was = el.getAttribute('src'), now = rewrite(was); if (now !== was) el.setAttribute('src', now); }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.HJ_TEST = true;
})();
