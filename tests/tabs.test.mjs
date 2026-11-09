// One set of tabs for a company: Booking and History on the console, Live, Results and Cameras on its servers while they're on,
// and the video review has the same five, its Booking and History taking you back.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { tabsFor } from '../apptabs-core.js';

const require = createRequire(import.meta.url);
const auth = require('../server/auth.js');
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const shown = (t) => Object.keys(t.show).filter((k) => t.show[k]);

test('someone who has never booked sees only Booking', () => {
  assert.deepStrictEqual(shown(tabsFor({ wanted: 'off', servers: [{ state: 'off' }] }, false)), ['booking']);
  assert.deepStrictEqual(shown(tabsFor(null, false)), ['booking']);
});
test('after a booking: Results and History; Results is the saved results while the servers are off', () => {
  const t = tabsFor({ wanted: 'off', servers: [{ state: 'off' }] }, true);
  assert.deepStrictEqual(shown(t), ['booking', 'results', 'history']);
  assert.strictEqual(t.onServer.results, false);
});
test('a booking made ahead adds nothing until its servers are on their way', () => {
  assert.deepStrictEqual(shown(tabsFor({ wanted: 'on', scheduled: true, servers: [{ state: 'off' }] }, true)), ['booking', 'results', 'history']);
});
test('starting: Live and Cameras are there but wait; on: they open the server, and so does Results', () => {
  const starting = tabsFor({ wanted: 'on', servers: [{ state: 'starting' }] }, true);
  assert.deepStrictEqual(shown(starting), ['booking', 'live', 'results', 'cameras', 'history']);
  assert.deepStrictEqual([starting.waiting.live, starting.waiting.cameras, starting.onServer.results], [true, true, false]);
  const on = tabsFor({ wanted: 'on', servers: [{ state: 'on' }, { state: 'starting' }] }, true);
  assert.deepStrictEqual([on.waiting.live, on.waiting.cameras, on.onServer.results], [false, false, true]);
});

test('the console and the results page both have the tab bar; the console\'s Past results link has gone', () => {
  for (const f of ['console.html', 'results.html']) assert.match(read(f), /<nav id="appTabs" class="appTabs" aria-label="Your pages" hidden><\/nav>/, f);
  assert.ok(!read('console.html').includes('Past results and downloads'));
  assert.match(read('console.js'), /drawAppTabs\(\$\('appTabs'\)/); assert.match(read('results.js'), /drawAppTabs\(\$\('appTabs'\), \{ active: 'results'/);
  // the review's tabs and its server switcher come back through the console: ?go=live&n=2
  assert.ok(read('console.js').includes("['live', 'results', 'cameras'].includes(go)"));
});
test('the video review has the same five tabs, Booking first, and its log is folded under Cameras', () => {
  const page = read('server/review/index.html');
  const tabs = [...page.matchAll(/<button data-(tab|go)="(\w+)"/g)].map((m) => m[2]);
  assert.deepStrictEqual(tabs.slice(0, 5), ['booking', 'live', 'judge', 'cameras', 'history']);
  assert.ok(!page.includes('data-tab="log"') && !page.includes('<section id="log"'));
  assert.match(page, /<details class="logBox" id="logBox">[\s\S]*id="eventList"/);
  assert.match(read('server/review/review.css'), /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/, 'five along the bottom on a phone');
});
test('a sign-in link lands on the tab asked for, and nothing else gets through', () => {
  const at = (q) => auth.landing(new URLSearchParams(q));
  assert.strictEqual(at('tab=results&n=2&of=3'), '/?tab=results&n=2&of=3');
  assert.strictEqual(at(''), '/?tab=live&n=1&of=1');
  assert.strictEqual(at('tab=https://evil.example&n=99&of=-1'), '/?tab=live&n=1&of=1');
  assert.strictEqual(at('tab=cameras&n=3&of=1'), '/?tab=cameras&n=3&of=3', 'never server 3 of 1');
  assert.match(read('server/index.js'), /Location: auth\.landing\(u\.searchParams\)/);
});
