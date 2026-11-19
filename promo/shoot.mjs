// Phone screenshots of the site for the promo video, from the local copy (node api/dev-server.js 8795, signed in as the local admin).
//   node promo/shoot.mjs     → promo/shots/*.png (390 × 844 at 3×, as a phone shows them)
import fs from 'node:fs';
import { launch, sleep } from './cdp.mjs';

const BASE = 'http://localhost:8795';
const OUT = new URL('./shots/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });
const token = (await (await fetch(`${BASE}/api/auth/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: 'dev:boss@example.com' }) })).json()).token;

const page = await launch();
await page.size(390, 844, 3, true);
await page.goto(`${BASE}/learn/`, 300);
await page.eval(`localStorage.setItem('sp_token', ${JSON.stringify(token)}); localStorage.setItem('sr_lang', 'en'); localStorage.setItem('sr_look', 'dark'); true`);
let n = 0;
const go = async (hash, settle = 2500) => { await page.goto(`${BASE}/learn/?v=${++n}${hash}`, settle); }; // a full load each time: only the # changing wouldn't restart the app
const top = () => page.eval('scrollTo(0, 0); true');
const toEl = (sel, off = 70) => page.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; scrollTo(0, e.getBoundingClientRect().top + scrollY - ${off}); return true; })()`);
const shot = async (name) => { await sleep(400); await page.shot(new URL(`${name}.png`, OUT)); console.log('shot', name); };

// home, the obstacles list, an obstacle with its animation, its video and its call to make
await go('#/'); await top(); await shot('home');
await go('#/obstacles'); await toEl('h1', 90); await shot('obstacles');
await go('#/obstacles/monkey', 4500); await toEl('.obAnim', 60); await shot('obstacle-anim');
await go('#/obstacles/tireflip', 3000); await toEl('.obVideo', 60); await shot('obstacle-video');
await go('#/obstacles/zwall', 2500);
await page.eval(`document.querySelector('.obCallBtn[data-i="1"]').click(); true`);
await toEl('#obCall', 60); await shot('make-the-call');
await toEl('.obVerdicts', 40); await shot('good-bad');
// Referee Essentials, and a lesson slide with the burpee animation
await go('#/programmes/referee-essentials'); await toEl('h1', 90); await shot('programme');
const lesson = await page.eval(`[...document.querySelectorAll('a')].find((a) => a.textContent.includes('The penalty must match'))?.getAttribute('href') || ''`);
if (lesson) {
  await go(lesson, 3000);
  for (let i = 0; i < 8; i++) {
    const h = await page.eval(`document.querySelector('#lpStage h2')?.textContent || ''`);
    if (h === 'Watch the whole rep') break;
    const idx = await page.eval(`+(document.querySelector('.lpCount span')?.textContent || '1').split('/')[0]`);
    await page.eval(`document.getElementById(${idx > 3 ? "'lpPrev'" : "'lpNext'"}).click(); true`); await sleep(700);
  }
  await sleep(2500); await toEl('.lpFig', 60); await shot('lesson-anim');
  // the editor's picture box, with its four tabs
  await go(`#/programs/referee-essentials/${lesson.split('/').pop()}`, 3000);
  await page.eval(`document.querySelectorAll('.edFig')[2].click(); true`); await sleep(500);
  await toEl('.edSlide:nth-of-type(3) .edFig', 70); await shot('editor');
}
// the same obstacle page in German
await page.eval(`localStorage.setItem('sr_lang', 'de'); true`);
await go('#/obstacles/hoist', 4000); await toEl('h1', 90); await shot('german');
await page.eval(`localStorage.setItem('sr_lang', 'en'); true`);
await page.close();
