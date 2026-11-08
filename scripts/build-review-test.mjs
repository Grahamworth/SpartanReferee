// Builds the video review's test mode into the site: the real review page (server/review) at /review-test/, answered by
// review-test/test-mode.js instead of a server. Admins open it from their console to click around the review without paying for one.
//   node scripts/build-review-test.mjs <site folder>        (writes <site folder>/review-test)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv[2]) throw new Error('Which site folder? node scripts/build-review-test.mjs <site folder>');
const out = path.join(process.argv[2], 'review-test');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of ['review.js', 'review.css', 'counts.js']) fs.copyFileSync(path.join(SRC, 'server/review', f), path.join(out, f));
for (const f of ['test-mode.js', 'test-judge.html']) fs.copyFileSync(path.join(SRC, 'review-test', f), path.join(out, f));

let html = fs.readFileSync(path.join(SRC, 'server/review/index.html'), 'utf8');
const swap = (from, to) => { if (!html.includes(from)) throw new Error(`The review page has changed: "${from}" isn't in it`); html = html.replace(from, to); };
// the pretend server goes in first, before the page asks it anything
swap('<link rel="stylesheet" href="review.css">', '<script src="test-mode.js"></script>\n<link rel="stylesheet" href="review.css">');
swap('<script src="/judge/brand.js" defer></script>', '<script src="/brand.js" defer></script>');
// a banner, so it's never mistaken for a real event, and only admins get past it
swap('</body>', `<div id="testBanner" style="position:fixed;left:10px;bottom:10px;z-index:40;background:#ffc400;color:#101010;font:700 14px/1.3 Barlow,system-ui,sans-serif;padding:7px 14px;box-shadow:0 2px 12px rgba(0,0,0,.5);pointer-events:none">TEST MODE<span class="tmMore"> · pretend data, no server, nothing is saved</span></div>
<style>@media (max-width: 760px) { #testBanner { bottom: calc(72px + env(safe-area-inset-bottom)) !important; font-size: 12px !important; padding: 4px 9px !important; } #testBanner .tmMore { display: none; } }</style>
<script type="module">
  import { getMe } from '/api-base.js';
  const cover = document.createElement('div');
  cover.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#12161c;color:#f4f6f8;display:grid;place-content:center;text-align:center;padding:24px;font:16px/1.5 Barlow,system-ui,sans-serif';
  cover.innerHTML = '<p style="color:#a3acb7">Checking…</p>';
  document.body.append(cover);
  getMe(true).then((me) => {
    if (me?.admin) { cover.remove(); return; }
    cover.innerHTML = '<div style="max-width:420px"><p style="font:italic 800 32px Barlow Condensed,sans-serif;text-transform:uppercase;margin:0 0 8px">Test review</p><p>This is for HeadJudge admins. Sign in to your console with your admin account, then open it from there.</p><p><a style="color:#ffc400;font-weight:700" href="/console.html">Go to my console</a></p></div>';
  }, () => { cover.innerHTML = '<p>Can\\'t check who you are right now. <a style="color:#ffc400" href="/console.html">Go to my console</a></p>'; });
</script>
</body>`);
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log('wrote', out);
