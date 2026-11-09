// Builds two server-free copies of the video review (server/review) into the site, both answered by review-test/test-mode.js
// instead of a server:
//   /review-test/      test mode: camera 1 is this browser's camera, the rest is pretend. Admins, to click around the review.
//   /review-free/      the free camera, for any company: one camera, this browser's, with the real AI judge run in this browser on
//                      a minute of video at a time (/judge-free.html, the Burpee Judge reporting to the page that opened it).
//   node scripts/build-review-test.mjs <site folder>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv[2]) throw new Error('Which site folder? node scripts/build-review-test.mjs <site folder>');
const site = process.argv[2];
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const swapper = (what, text) => {
  let s = text;
  const swap = (from, to) => { if (!s.includes(from)) throw new Error(`${what} has changed: "${from}" isn't in it`); s = s.replace(from, to); return swap; };
  return { swap, done: () => s };
};

// the sign-in check: who may open it, the cover others see, and what starts once they're in
const gate = (who, admit, refused) => `<script type="module">
  import { getMe, call } from '/api-base.js';
  const cover = document.createElement('div');
  cover.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#12161c;color:#f4f6f8;display:grid;place-content:center;text-align:center;padding:24px;font:16px/1.5 Barlow,system-ui,sans-serif';
  cover.innerHTML = '<p style="color:#a3acb7">Checking…</p>';
  document.body.append(cover);
  (async () => {
    const me = await getMe(true);
    ${admit}
    cover.innerHTML = '<div style="max-width:420px"><p style="font:italic 800 32px Barlow Condensed,sans-serif;text-transform:uppercase;margin:0 0 8px">${who}</p><p>${refused}</p><p><a style="color:#ffc400;font-weight:700" href="/console.html">Go to my console</a></p></div>';
  })().catch(() => { cover.innerHTML = '<p>Can\\'t check who you are right now. <a style="color:#ffc400" href="/console.html">Go to my console</a></p>'; });
</script>`;
const banner = (text) => `<div id="testBanner" style="position:fixed;left:10px;bottom:10px;z-index:40;background:#ffc400;color:#101010;font:700 14px/1.3 Barlow,system-ui,sans-serif;padding:7px 14px;box-shadow:0 2px 12px rgba(0,0,0,.5);pointer-events:none">${text}</div>
<style>@media (max-width: 760px) { #testBanner { bottom: calc(72px + env(safe-area-inset-bottom)) !important; font-size: 12px !important; padding: 4px 9px !important; } #testBanner .tmMore { display: none; } }</style>`;

function build(folder, { first, end, more = (s) => s }) {
  const out = path.join(site, folder);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const f of ['review.js', 'review.css', 'counts.js']) fs.copyFileSync(path.join(SRC, 'server/review', f), path.join(out, f));
  for (const f of ['test-mode.js', 'test-judge.html']) fs.copyFileSync(path.join(SRC, 'review-test', f), path.join(out, f));
  const h = swapper('The review page', read('server/review/index.html'));
  // the stand-in for the server goes in first, before the page asks it anything
  h.swap('<link rel="stylesheet" href="review.css">', `${first}<script src="test-mode.js"></script>\n<link rel="stylesheet" href="review.css">`)
    ('<script src="/judge/brand.js" defer></script>', '<script src="/brand.js" defer></script>')
    ('</body>', `${end}\n</body>`);
  more(h.swap);
  fs.writeFileSync(path.join(out, 'index.html'), h.done());
  console.log('wrote', out);
}

// ---- test mode: a banner, so it's never mistaken for a real event, and only admins get past it
build('review-test', {
  first: '',
  end: banner('TEST MODE<span class="tmMore"> · <span id="tmCam">camera 1: starting the demo…</span> · the rest is pretend · nothing leaves this browser</span>')
    + gate('Test review', 'if (me?.admin) { cover.remove(); window.hjTestStart?.(); return; } // camera 1 is this browser\'s camera',
      'This is for HeadJudge admins. Sign in to your console with your admin account, then open it from there.'),
});

// ---- the free camera: any company that's signed in (and not blocked), in its own colours
build('review-free', {
  first: '<script>window.HJ_FREE = true;</script>\n',
  end: banner('FREE CAMERA<span class="tmMore"> · <span id="tmCam">camera 1: asking for this browser\'s camera…</span> · the AI judge runs in this browser · nothing leaves this browser</span>')
    // no phones and no clips to save: those need a server
    + '\n<style>#addCam, .camcard img, .camcard p, .camcard details { display: none !important; }</style>\n'
    + gate('Free camera', `if (me?.user) {
      const { company } = await call('companies/mine').catch(() => ({}));
      if (me.admin || company?.status === 'approved') {
        if (company) window.HJ_BRAND = { id: company.id, name: company.name, logo: company.logo || '', theme: company.theme || {} };
        cover.remove(); window.hjTestStart?.(); return;
      }
    }`, 'The free camera is for companies using HeadJudge. Sign in to your console, then open it from there.'),
  more: (swap) => swap('This server takes two cameras. Open HeadJudge Broadcaster on the phone and scan a camera\'s code. Any Wi-Fi or mobile signal will do.',
    'The free camera is this computer\'s own camera, recorded in this browser for 20 minutes. Its AI judge runs in this browser too, live or on a minute of video. Phones as cameras and saving clips need a server: book one from your console.')
    ('<small>From the last 7 days</small>', '<small>A minute of camera 1</small>')
    ('<small>Analysed on the server</small>', '<small>Up to 1 minute, analysed here</small>')
    ('Videos are analysed on the server, in the background. You can close this page: the results are here when it\'s done.',
      'Videos of up to 1 minute are analysed here, in this browser. A minute takes a few minutes on a laptop. Keep this tab open and in front while it works.'),
});

// ---- the free camera's AI judge: the Burpee Judge, opened only by the free camera's page (no referee check: that page checked)
const j = swapper('The judge page', read('judge.html'));
j.swap('<script type="module" src="judge-gate.js"></script>\n', '')
  ('<meta charset="utf-8">', `<meta charset="utf-8">
<script>
  // Opened by the free camera (/review-free/): what it finds goes to that page, and its videos play from there.
  (() => {
    let P = null; try { P = window.parent !== window && window.parent.hjFree; } catch { /* not ours */ }
    if (!P) { location.replace('/review-free/'); return; }
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const u = new URL(typeof input === 'string' ? input : input.url, location.href);
      return u.origin === location.origin && P.ours(u.pathname) ? P.fetch(input, init) : realFetch(input, init);
    };
    window.hjLocalCamera = (url) => P.camera(url); // a live camera: this browser's own, handed over (app.js connectStream)
    const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    Object.defineProperty(HTMLMediaElement.prototype, 'src', { get() { return d.get.call(this); }, set(v) { d.set.call(this, P.media(v, window)); }, configurable: true });
  })();
</script>`);
fs.writeFileSync(path.join(site, 'judge-free.html'), j.done());
console.log('wrote', path.join(site, 'judge-free.html'));
