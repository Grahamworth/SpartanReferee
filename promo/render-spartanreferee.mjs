// The SpartanReferee promo video: promo/spartanreferee.html drawn frame by frame in headless Chrome, then put together by ffmpeg.
//   node api/dev-server.js 8795 (the local site), node promo/shoot.mjs (the phone pictures), then
//   node promo/render-spartanreferee.mjs [fps]   → promo/out/spartanreferee-promo.mp4 (1920 × 1080, H.264)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { launch } from './cdp.mjs';

const FPS = Number(process.argv[2]) || 30;
const FRAMES = new URL('./frames/', import.meta.url), OUT = new URL('./out/', import.meta.url);
fs.rmSync(FRAMES, { recursive: true, force: true }); fs.mkdirSync(FRAMES, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });

const page = await launch({ port: 9334 });
await page.size(1920, 1080, 1);
await page.goto('http://localhost:8795/promo/spartanreferee.html', 1000);
await page.eval('window.ready');
const duration = await page.eval('window.DURATION');
const n = Math.round(duration * FPS);
const started = Date.now();
for (let f = 0; f < n; f++) {
  await page.eval(`window.render(${(f / FPS).toFixed(4)}); true`);
  await page.shot(new URL(`${String(f).padStart(5, '0')}.jpg`, FRAMES), { format: 'jpeg', quality: 92 });
  if (f % 150 === 0) console.log(`frame ${f} of ${n} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
}
await page.close();
const mp4 = new URL('spartanreferee-promo.mp4', OUT);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${FRAMES.pathname.slice(1)}%05d.jpg`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4.pathname.slice(1)], { stdio: 'inherit' });
console.log('made', mp4.pathname.slice(1), `${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB`);
