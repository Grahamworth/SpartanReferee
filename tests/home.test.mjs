// The site is HeadJudge's. The Spartans app has its own site and repository (split out on 8 November 2026): its old addresses here
// lead there.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
const SPARTANS = 'https://mango-glacier-03e711403.4.azurestaticapps.net';

test('the home page is HeadJudge\'s, and leads to registering a company and the console', () => {
  const home = read('index.html');
  assert.match(home, /<title>HeadJudge/);
  assert.ok(hrefs(home).includes('register.html'));
  assert.ok(hrefs(home).includes('console.html'));
  assert.ok(hrefs(home).includes(`${SPARTANS}/`), 'and on to the Spartans site');
  assert.doesNotMatch(home, /hub\.js|manifest/, 'with none of the Spartans app in it');
});
test('every page the home page links to exists', () => {
  for (const h of hrefs(read('index.html'))) {
    if (/^(https?:|\.\/$)/.test(h)) continue;
    assert.ok(fs.existsSync(new URL(`../${h}`, import.meta.url)), h);
  }
});
test('Spartans has left: its pages are gone, and their old addresses go to the Spartans site', () => {
  for (const f of ['app', 'chat', 'course', 'profile', 'news', 'past', 'scoreboard', 'admin', 'judging', 'camera']) assert.ok(!fs.existsSync(new URL(`../${f}.html`, import.meta.url)), f);
  for (const f of ['manifest.webmanifest', 'hub.js', 'scripts/build-app.sh', 'courses']) assert.ok(!fs.existsSync(new URL(`../${f}`, import.meta.url)), f);
  const routes = JSON.parse(read('staticwebapp.config.json')).routes;
  assert.deepStrictEqual(routes.find((r) => r.route === '/app'), { route: '/app', redirect: `${SPARTANS}/`, statusCode: 301 });
  assert.strictEqual(routes.find((r) => r.route === '/downloads/spartans.apk').redirect, `${SPARTANS}/downloads/spartans.apk`);
  // a browser that installed the Spartans app from here has its offline copy cleared
  assert.match(read('sw.js'), /registration\.unregister\(\)/);
});
test('HeadJudge\'s pages go back to HeadJudge\'s home, and what the judge still links to of Spartans is on the Spartans site', () => {
  for (const f of ['phone', 'recordings', 'streaming']) assert.match(read(`${f}.html`), /href="\.\/"[^>]*>‹ Home/, f);
  for (const f of ['register', 'customers']) assert.match(read(`${f}.html`), /class="mark" href="\.\/"/, f);
  for (const f of ['judge.html', 'judge-gate.js']) assert.doesNotMatch(read(f), /href="(app|profile|scoreboard)\.html/, f);
});
test('the Broadcaster has its own HeadJudge page, with no way back to the Spartans home and no setup guide', () => {
  const page = read('broadcaster.html');
  assert.match(read('scripts/build-broadcaster.sh'), /cp "\$SRC\/broadcaster\.html" "\$BUILD\/www\/index\.html"/);
  assert.match(page, /headjudge\.css/);
  for (const gone of ['app.html', 'home-link', 'styles.css', 'streaming.html', 'Setup guide']) assert.ok(!page.includes(gone), gone);
});
