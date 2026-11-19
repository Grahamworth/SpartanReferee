// Every page at phone width, as a referee and as an admin: what makes the page scroll sideways, what's too small to tap, and a
// screenshot of each. Runs against the local dev server (node api/dev-server.js, with ADMIN_EMAILS=boss@example.com), in Chrome.
//   node scripts/mobile-check.mjs [out folder] [width]      (default: scratch folder mobile-check, 360 wide)
// Exits 1 if any page scrolls sideways. Signs in as test accounts only; on the dev server nothing is saved, except /learn's
// learn_dev schema when LEARN_FROM_AZ=1.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'mobile-check'));
const WIDTH = Number(process.argv[3]) || 360;
const SITE = process.env.SITE || 'http://localhost:8795';
const CHROME = process.env.CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const api = async (method, p, token, body) => {
  const r = await fetch(`${SITE}/api/${p}`, { method, headers: { 'X-Session': token || '', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => null);
};
const login = async (email) => (await api('POST', 'auth/google', '', { idToken: `dev:${email}` })).token;
const boss = await login('boss@example.com');
await api('POST', 'admin/referees', boss, { email: 'maria.lopez@example.com' });
const events = (await api('GET', 'events', boss))?.events || [];
// Maria: head referee at the first event and referee at the second; the admin referees the first too
for (const [i, e] of events.slice(0, 2).entries()) await api('POST', 'admin/assignments', boss, { eventId: e.id, email: 'maria.lopez@example.com', role: i ? 'referee' : 'head' });
if (events[0]) await api('POST', 'admin/assignments', boss, { eventId: events[0].id, email: 'boss@example.com' });
const maria = await login('maria.lopez@example.com');

// [name, page, who, a script that's true once the page has drawn]
const PAGES = [
  ['front', 'index.html', null, 'true'],
  ['home-referee', 'home.html', maria, "!document.getElementById('content').hidden"],
  ['home-admin', 'home.html', boss, "!document.getElementById('content').hidden"],
  ['console-referee', 'console.html', maria, "!document.getElementById('whatFor').hidden"],
  ['console-history', 'console.html#history', maria, "!document.getElementById('whatFor').hidden"],
  ['results', 'results.html', maria, 'document.readyState === "complete"'],
  ['admin', 'customers.html', boss, "!document.getElementById('content').hidden"],
  ['event-referee', `event.html?id=${events[0]?.id || ''}`, maria, "!document.getElementById('content').hidden || !document.getElementById('error').hidden"],
  ['event-not-head', `event.html?id=${events[1]?.id || ''}`, maria, "!document.getElementById('content').hidden || !document.getElementById('error').hidden"],
  ['console-not-head', `console.html?unit=e${events[1]?.id || ''}`, maria, "!document.getElementById('whatFor').hidden"],
  ['learn-camera-course', 'learn/#/cameras', maria, "!!document.querySelector('#view .card') && location.hash.includes('camera-station')"],
  ['learn-referee', 'learn/', maria, "!!document.querySelector('#view .card') || !document.getElementById('error').hidden"],
  ['learn-profile-referee', 'learn/#/profile', maria, "!!document.querySelector('#view .card')"],
  ['learn-people-admin', 'learn/#/people', boss, "!!document.querySelector('#view .card')"],
  ['learn-audit-admin', 'learn/#/audit', boss, "!!document.querySelector('#view .card')"],
  ['camera-guide', 'streaming.html', null, 'true'],
  ['phone-guide', 'phone.html', null, 'true'],
  ['signed-out-home', 'home.html', '', "!document.getElementById('signIn').hidden"],
];
// the learning platform's pages (when it's on: LEARN_FROM_AZ=1), as the demo people who'd see them ("view as")
const learnApi = async (p, asId = '') => { const r = await fetch(`${SITE}/api/learn/${p}`, { headers: { 'X-Session': boss, 'X-Learn-As-Invented': '1', ...(asId ? { 'X-Learn-As': asId } : {}) } }); return r.ok ? r.json() : null; };
const me = await learnApi('me');
if (me) {
  const who = (n) => me.viewAs.find((p) => p.legalName === n)?.id || '';
  const anna = who('Anna Kowalska'), tomas = who('Tomas Novak');
  const ocr = await learnApi('programmes/ocr-referee', anna);
  const lesson = ocr?.modules?.flatMap((m) => m.lessons).find((l) => l.code === 'ocr-4-2');
  const assessment = ocr?.assessments?.[0];
  const rec = await learnApi(`people/${anna}/record`, anna);
  const ready = "!!document.querySelector('#view .card, #view .qCard') || !document.getElementById('error').hidden";
  PAGES.push(
    ['learn-programmes', 'learn/#/programmes', boss, ready],
    ['learn-programme-ocr', 'learn/#/programmes/ocr-referee', boss, ready, anna],
    ['learn-lesson', `learn/#/lesson/${lesson?.id}`, boss, "!!document.getElementById('lpStage')?.children.length || !document.getElementById('error').hidden", anna],
    ['learn-lesson-spanish', `learn/#/lesson/${lesson?.id}?locale=es`, boss, "!!document.getElementById('lpStage')?.children.length || !document.getElementById('error').hidden", anna],
    ['learn-assessment', `learn/#/assessment/${assessment?.id}`, boss, ready, anna],
    ['learn-attempt', `learn/#/attempt/${rec?.attempts?.[0]?.id}`, boss, ready, anna],
    ['learn-credential', `learn/#/credential/${rec?.credentials?.[0]?.id}`, boss, ready, anna],
    ['learn-rules', 'learn/#/rules', boss, ready, anna],
    ['learn-rule', 'learn/#/rules/OCR-2026-4.2.13', boss, ready],
    ['learn-reviews', 'learn/#/reviews?programme=ocr-referee', boss, ready],
    ['learn-refresh', 'learn/#/refresh?more=1', boss, ready],
    ['learn-badges', 'learn/#/badges', boss, ready],
    ['learn-events-manage', 'learn/#/events?manage=1', boss, ready],
    ['learn-progress', 'learn/#/progress?status=all', boss, ready],
    ['learn-invites', 'learn/#/invites', boss, ready],
    ['learn-reports', 'learn/#/reports', boss, ready],
    ['learn-handbook', 'learn/#/handbook/ocr-referee?locale=es', boss, ready, anna],
    ['learn-media', 'learn/#/media', boss, ready],
    ['learn-assessing', 'learn/#/assessing', boss, ready, tomas],
    ['learn-diagnostics', 'learn/#/diagnostics', boss, ready],
  );
}

const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9335', `--user-data-dir=${prof}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let bad = 0;
try {
  let targets;
  for (let i = 0; i < 40; i++) { try { targets = await (await fetch('http://127.0.0.1:9335/json')).json(); break; } catch { await sleep(250); } }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const waiting = new Map();
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const js = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send('Page.enable'); await send('Runtime.enable');
  const phone = (h = 780) => send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: h, deviceScaleFactor: 2, mobile: true });
  await phone();
  await send('Page.navigate', { url: `${SITE}/index.html` }); await sleep(1000);

  for (const [name, page, token, ready, asId = ''] of PAGES) {
    await phone();
    await js(`${asId ? `localStorage.setItem('sr_learn_as', ${JSON.stringify(asId)})` : "localStorage.removeItem('sr_learn_as')"}; ${token === null ? '' : token ? `localStorage.setItem('sp_token', ${JSON.stringify(token)})` : "localStorage.removeItem('sp_token')"}`);
    // CHECK_LANG=de: every page in that language (?lang= before the #), to catch long words and right-to-left layouts
    const at = process.env.CHECK_LANG ? page.replace(/^([^?#]*)(\?[^#]*)?/, (m, p, q) => `${p}${q ? `${q}&` : '?'}lang=${process.env.CHECK_LANG}`) : page;
    await send('Page.navigate', { url: `${SITE}/${at}` }); await sleep(150);
    await send('Page.reload', { ignoreCache: true });
    for (let i = 0; i < 40; i++) { await sleep(300); if (await js(ready)) break; }
    await sleep(700);
    const report = await js(`(() => {
      // the phone's width, not innerWidth: a phone widens the page to fit whatever is too wide, which would hide it
      const W = ${WIDTH}, wide = [], small = [];
      const label = (el) => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '')) + ' "' + (el.textContent || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 30) + '"';
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        if (!r.width || cs.visibility === 'hidden' || cs.position === 'fixed') continue;
        // (something in a row that's meant to be swiped along doesn't count)
        const inScroller = (() => { for (let p = el.parentElement; p; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowX)) return true; return false; })();
        if (r.right > W + 1 && !inScroller && ![...el.children].some((c) => c.getBoundingClientRect().right > W + 1)) wide.push(label(el) + ' to ' + Math.round(r.right) + 'px');
        if (el.matches('a, button, select, input:not([type=hidden]), summary, [role=button]') && el.offsetParent && (r.height < 32 || r.width < 32) && !el.closest('p, li small, .note, small, td, dd') && !(el.matches('input[type=radio], input[type=checkbox]') && (el.closest('label')?.getBoundingClientRect().height || 0) >= 40))
          small.push(label(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      }
      return { scroll: document.documentElement.scrollWidth, W, wide: wide.slice(0, 8), small: small.slice(0, 10), height: document.documentElement.scrollHeight };
    })()`);
    await phone(Math.min(Math.max(report.height, 780), 6000)); await sleep(300);
    // the viewport, sized to the page up to 6000px: capturing the whole of a very long page (the handbook) stalls Chrome
    const { result } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(result.data, 'base64'));
    const sideways = report.scroll > report.W;
    if (sideways) bad++;
    console.log(`${sideways ? 'SIDEWAYS' : 'ok      '} ${name} (${report.scroll}/${report.W}px wide, ${report.height}px tall)`);
    for (const w of report.wide) console.log(`    too wide: ${w}`);
    for (const s of report.small) console.log(`    small to tap: ${s}`);
    // the header's menu, opened: every row in it
    if (await js("!!document.querySelector('.menuBtn') && getComputedStyle(document.querySelector('.menuBtn')).display !== 'none'")) {
      await js("document.querySelector('.menuBtn').click()"); await sleep(200);
      const rows = await js("[...document.querySelectorAll('.top .topRight > *')].filter((e) => e.offsetParent).map((e) => [(e.textContent || e.value || '').trim().slice(0, 24), Math.round(e.getBoundingClientRect().height)])");
      const tiny = rows.filter(([, h]) => h < 40);
      console.log(`    menu: ${rows.map(([t]) => t || '?').join(' | ')}${tiny.length ? ` (small: ${tiny.map(([t, h]) => `${t} ${h}px`).join(', ')})` : ''}`);
      if (tiny.length) bad++;
      if (['home-referee', 'learn-people-admin', 'admin'].includes(name)) { await phone(780); const m = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, `${name}-menu.png`), Buffer.from(m.result.data, 'base64')); }
    }
  }
  ws.close();
} finally {
  chrome.kill(); await sleep(800);
  fs.rmSync(prof, { recursive: true, force: true, maxRetries: 5 });
}
console.log(`screenshots in ${OUT}`);
process.exit(bad ? 1 : 0);
