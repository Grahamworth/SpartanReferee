// The site's home address is HeadJudge's, and the Spartans home has moved to /app.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

test('the home page is HeadJudge\'s, and leads to registering a company and the console', () => {
  const home = read('index.html');
  assert.match(home, /<title>HeadJudge/);
  assert.ok(hrefs(home).includes('register.html'));
  assert.ok(hrefs(home).includes('console.html'));
  assert.ok(hrefs(home).includes('/app'), 'and on to the Spartans app');
  assert.doesNotMatch(home, /hub\.js|manifest/, 'with none of the Spartans app in it');
});
test('every page the home page links to exists', () => {
  for (const h of hrefs(read('index.html'))) {
    if (/^(https?:|\.\/$|\/app$)/.test(h)) continue;
    assert.ok(fs.existsSync(new URL(`../${h}`, import.meta.url)), h);
  }
});
test('the Spartans home is at /app, on the site and when installed', () => {
  assert.match(read('app.html'), /<title>Spartans<\/title>/);
  const routes = JSON.parse(read('staticwebapp.config.json')).routes;
  assert.deepStrictEqual(routes.find((r) => r.route === '/app'), { route: '/app', rewrite: '/app.html' });
  assert.strictEqual(JSON.parse(read('manifest.webmanifest')).start_url, '/app');
});
test('Spartans pages go back to the Spartans home, and HeadJudge pages to HeadJudge\'s', () => {
  for (const f of ['admin', 'camera', 'chat', 'course', 'judge', 'news', 'past', 'profile', 'scoreboard']) {
    assert.match(read(`${f}.html`), /href="app\.html"[^>]*>‹ Spartans home/, f);
  }
  for (const f of ['judging', 'phone', 'recordings', 'streaming']) assert.match(read(`${f}.html`), /href="\.\/"[^>]*>‹ Home/, f);
  for (const f of ['register', 'customers']) assert.match(read(`${f}.html`), /class="mark" href="\.\/"/, f);
});
test('the Spartans app still opens on the Spartans home, and the back button still knows it', () => {
  const build = read('scripts/build-app.sh');
  assert.match(build, /^WEB="app\.html /m);
  assert.match(build, /cp "\$SRC\/app\.html" "\$BUILD\/www\/index\.html"/);
  assert.match(read('app/native/android/MainActivity.java'), /path\.equals\("\/app\.html"\)/);
});
test('the Broadcaster has its own HeadJudge page, with no way back to the Spartans home and no setup guide', () => {
  const page = read('broadcaster.html');
  assert.match(read('scripts/build-broadcaster.sh'), /cp "\$SRC\/broadcaster\.html" "\$BUILD\/www\/index\.html"/);
  assert.match(page, /headjudge\.css/);
  for (const gone of ['app.html', 'home-link', 'styles.css', 'streaming.html', 'Setup guide']) assert.ok(!page.includes(gone), gone);
});
