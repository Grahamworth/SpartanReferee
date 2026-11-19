// The site is HeadJudge's. The Spartans app has its own site and repository (split out on 8 November 2026): its old addresses here
// lead there.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
const SPARTANS = 'https://mango-glacier-03e711403.4.azurestaticapps.net';

test('the front page is only signing in (to the app\'s Home); what SpartanReferee is moved to info.html', () => {
  const home = read('index.html');
  assert.match(home, /<title>SpartanReferee/);
  assert.ok(!hrefs(home).includes('register.html'));
  assert.match(home, /<div id="msBtn"><\/div>\s*<div id="devBtn">/);
  assert.ok(home.includes("microsoftButton(document.getElementById('msBtn'), 'learn/', failed)"), 'signing in leads to the app\'s Home');
  assert.ok(home.includes("if (signedIn()) location.replace('learn/')"), 'signed in already: straight there');
  assert.deepStrictEqual(hrefs(home).filter((h) => !h.startsWith('http') && !h.startsWith('/') && !h.startsWith('icons/') && !h.endsWith('.css')), ['./', 'info.html', 'streaming.html', 'privacy.html']);
  const info = read('info.html');
  assert.match(info, /Every rep judged, <span>for Spartan<\/span>/);
  assert.ok(hrefs(info).includes(`${SPARTANS}/`), 'and on to the Spartans site');
  assert.doesNotMatch(info + home, /hub\.js/, 'with none of the Spartans app in it');
});
test('every page the front and info pages link to exists', () => {
  for (const h of [...hrefs(read('index.html')), ...hrefs(read('info.html'))]) {
    if (/^(https?:|\.\/$)/.test(h)) continue;
    assert.ok(fs.existsSync(new URL(`../${h}`, import.meta.url)), h);
  }
});
test('Spartans has left: its pages are gone, and their old addresses go to the Spartans site', () => {
  for (const f of ['app', 'chat', 'course', 'profile', 'news', 'past', 'scoreboard', 'admin', 'judging', 'camera']) assert.ok(!fs.existsSync(new URL(`../${f}.html`, import.meta.url)), f);
  for (const f of ['hub.js', 'scripts/build-app.sh', 'courses']) assert.ok(!fs.existsSync(new URL(`../${f}`, import.meta.url)), f);
  const routes = JSON.parse(read('staticwebapp.config.json')).routes;
  assert.deepStrictEqual(routes.find((r) => r.route === '/app'), { route: '/app', redirect: `${SPARTANS}/`, statusCode: 301 });
  assert.strictEqual(routes.find((r) => r.route === '/downloads/spartans.apk').redirect, `${SPARTANS}/downloads/spartans.apk`);
});
test('SpartanReferee\'s pages go back to SpartanReferee\'s home, and what the judge still links to of Spartans is on the Spartans site', () => {
  assert.match(read('recordings.html'), /href="\.\/"[^>]*>‹ Home/);
  for (const f of ['streaming', 'phone']) assert.match(read(`${f}.html`), /class="mark" href="\.\/"/, f);
  assert.match(read('customers.html'), /class="mark" href="learn\/"/, 'Config goes to the app');
  // the camera guides are SpartanReferee's, and up to date
  for (const f of ['streaming', 'phone']) {
    const p = read(`${f}.html`);
    assert.match(p, /headjudge\.css/, f);
    assert.doesNotMatch(p, /styles\.css|Scan station QR code|14 days|recordings\.html/, f);
  }
  for (const f of ['judge.html', 'judge-gate.js']) assert.doesNotMatch(read(f), /href="(app|profile|scoreboard)\.html/, f);
});
test('the Broadcaster has its own SpartanReferee page, with no way back to the Spartans home and no setup guide', () => {
  const page = read('broadcaster.html');
  assert.match(read('scripts/build-broadcaster.sh'), /cp "\$SRC\/broadcaster\.html" "\$BUILD\/www\/index\.html"/);
  assert.match(page, /headjudge\.css/);
  for (const gone of ['app.html', 'home-link', 'styles.css', 'streaming.html', 'Setup guide']) assert.ok(!page.includes(gone), gone);
});
test('a referee\'s home page: their name, their events (each with Book cameras), and the ways to learning, cameras and (admins) admin', () => {
  const page = read('home.html'), js = read('home.js');
  assert.match(page, /<h1>Hello, <span id="name"><\/span><\/h1>/);
  assert.match(page, /<h2>Your upcoming events<\/h2>/);
  assert.match(page, /id="learnTile" href="learn\/" hidden/);
  assert.match(page, /<a class="tile" href="console.html">/);
  assert.match(page, /id="adminTile" href="customers.html" hidden/);
  assert.ok(js.includes("call('home')"));
  assert.ok(js.includes('href="event.html?id=${encodeURIComponent(e.id)}"'), 'each event opens its own page');
  assert.ok(js.includes('Head referee'));
  assert.ok(js.includes("show($('adminTile'), !!h.admin)"));
  // the console takes the event it's given, and leads back home (home.html now sends anyone to the app's Home tab); in the app the
  // logo and the Home tab go to Home, and My profile is the icon at the top right
  assert.ok(read('console.js').includes("new URLSearchParams(location.search).get('unit')"));
  // the pages outside the app (Config, the cameras, results, the setup guide) have the app's tabs in their header (appnav.js)
  for (const f of ['console', 'event', 'customers', 'results', 'streaming']) {
    assert.match(read(`${f}.html`), /<header class="top" data-tab="\w+">/, f);
    assert.ok(read(`${f}.html`).includes('<script type="module" src="appnav.js"></script>'), f);
  }
  assert.match(read('learn/index.html'), /<a href="\.\.\/customers.html" data-view="config" data-show="global_admin" hidden>Config<\/a>/);
  assert.ok(read('appnav.js').includes("new URL('learn/index.html', root)"), 'the tabs come from the app: one list');
  assert.match(read('home.html'), /location\.replace\('learn\/' \+ location\.hash\)/);
  assert.match(read('learn/index.html'), /<a class="mark" href="#\/">/);
  assert.match(read('learn/index.html'), /<a href="#\/" data-view="home">Home<\/a>/);
  assert.match(read('learn/index.html'), /class="profileBtn" id="profileBtn" href="#\/profile" aria-label="My profile"/);
});
test('on a phone, every page\'s header is the name and a Menu button, with big rows to tap (check: node scripts/mobile-check.mjs)', () => {
  const base = read('api-base.js'), css = read('headjudge.css');
  assert.ok(base.includes("btn.className = 'menuBtn'") && base.includes("setAttribute('aria-expanded'"));
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*\.top:has\(\.menuBtn\) \.topRight \{ display: none; \}[\s\S]*min-height: 48px/);
  assert.ok(fs.existsSync(new URL('../scripts/mobile-check.mjs', import.meta.url)));
});
test("an event's page: its cameras (book, open or watch them on the console), its referees and its camera hours", () => {
  const page = read('event.html'), js = read('event.js');
  for (const id of ['camGo', 'people', 'days', 'spartanLink']) assert.match(page, new RegExp(`id="${id}"`), id);
  assert.ok(js.includes("call(`event/${id}`)"));
  assert.ok(js.includes("consoleUrl = `console.html?unit=${encodeURIComponent(e.unit)}`"));
  assert.ok(js.includes("b && b.state === 'on' ? `${consoleUrl}&go=live` : consoleUrl"), 'Watch live once its cameras are on');
  assert.ok(js.includes('show(go, !!b || (!e.over && p.canBook))'), 'Book the burpee cameras only for its head referee or an admin');
  assert.ok(read('console.js').includes("show($('book'), state === 'off' && s.unit?.kind !== 'training' && mine)"), 'the console books only for them');
  assert.match(read('console.html'), /id="headBooks" hidden>The event's head referee books and runs its burpee cameras/);
  assert.match(read('scripts/site-files.txt'), /^event\.js$/m);
});
test("camera setup is a course in Learning, whose last lesson is the only place a practice camera is booked; the console just says where", async () => {
  const learn = read('learn/practice.js');
  assert.ok(learn.includes("call('practice-camera', { method: 'POST'"));
  assert.ok(learn.includes('href="../review-free/"'), 'the free camera for everyone');
  assert.ok(!fs.existsSync(new URL('../learn/cameras.js', import.meta.url)), 'no separate Cameras area');
  assert.doesNotMatch(read('learn/index.html'), /data-view="cameras"/);
  assert.ok(read('learn/learn.js').includes("location.replace('#/programmes/camera-station')"), 'old links land on the course');
  const { CAMERA, CAMERA_LESSONS, CAMERA_ASSESSMENT } = await import('../scripts/learn-camera-course.mjs');
  assert.strictEqual(CAMERA.id, 'camera-station');
  const keys = CAMERA.modules.flatMap((m) => m.lessons.map((l) => l.key));
  assert.deepStrictEqual(keys.filter((k) => !CAMERA_LESSONS[k]), [], 'every lesson has content');
  assert.deepStrictEqual(CAMERA_LESSONS['cam-4-1'].en.map((s) => s.action), ['free-camera', 'practice-camera']);
  assert.ok(CAMERA_ASSESSMENT.questions.every((q) => q.options.some((o) => o.correct)));
  assert.ok(read('console.js').includes("show($('book'), state === 'off' && s.unit?.kind !== 'training' && mine)"));
  assert.match(read('console.html'), /id="trainingFromLearn" hidden data-i18n>Practice cameras are booked from the <a href="learn\/#\/programmes\/camera-station">camera course in Learning/);
});
test('nothing on the site\'s file list looks like the personal test videos the deploy refuses (clips/, test.mp4, pub*.html)', () => {
  const files = read('scripts/site-files.txt').split('\n').filter(Boolean);
  assert.deepStrictEqual(files.filter((f) => /clips|test\.mp4$|(^|\/)pub[^/]*\.html$/i.test(f)), []);
  for (const f of files) assert.ok(fs.existsSync(new URL(`../${f}`, import.meta.url)), `${f} is listed but missing`);
});
test("the first visit asks for a language (the browser's own suggested first), on the home page or Learning; it's saved with the referee and a new device uses it", () => {
  const js = read('language.js');
  assert.match(read('home.html'), /id="langCard" hidden>\s*<h2>Choose your language<\/h2>/);
  assert.match(read('learn/index.html'), /id="langCard" hidden>\s*<h2>Choose your language<\/h2>/);
  assert.ok(read('home.js').includes("if (language(h, $('langCard'))) return;"));
  assert.ok(read('learn/learn.js').includes("if (language(await viaCache('site/home', () => siteCall('home')), $('langCard'))) return;"));
  assert.ok(js.includes("call('home', { method: 'POST', body: { language: b.dataset.lang } })"));
  assert.ok(js.includes('if (!saved() && h.language !== I.lang) { keep(h.language); location.reload(); return true; }'), 'a new device');
  assert.ok(js.includes("if (saved() && saved() !== h.language) call('home', { method: 'POST', body: { language: saved() } })"), 'a change from the menu is saved back');
  assert.match(read('scripts/site-files.txt'), /^language\.js$/m);
});
test('every script and stylesheet a published page loads, and every module the app imports, is in the site\'s file list (so it is deployed)', () => {
  const listed = new Set(read('scripts/site-files.txt').split('\n').map((s) => s.trim()).filter(Boolean));
  const missing = [];
  for (const page of [...listed].filter((f) => f.endsWith('.html'))) {
    const dir = page.includes('/') ? page.slice(0, page.lastIndexOf('/') + 1) : '';
    for (const [, src] of read(page).matchAll(/(?:src|href)="([\w./-]+\.(?:js|css))"/g)) {
      if (/^(https?:)?\/\//.test(src)) continue;
      const path = src.startsWith('/') ? src.slice(1) : new URL(src, `http://x/${dir}`).pathname.slice(1);
      if (!listed.has(path)) missing.push(`${page} -> ${path}`);
    }
  }
  for (const js of [...listed].filter((f) => f.startsWith('learn/') && f.endsWith('.js'))) {
    for (const [, src] of read(js).matchAll(/^import [^'\n]*'(\.\.?\/[\w./-]+\.js)'/gm)) {
      const path = new URL(src, 'http://x/learn/').pathname.slice(1);
      if (!listed.has(path)) missing.push(`${js} -> ${path}`);
    }
  }
  assert.deepStrictEqual(missing, []);
});
