// The installable app: its manifest, its service worker (sw.js) and what offline.js keeps on the phone for use with no signal.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const exists = (f) => fs.existsSync(new URL(`../${f}`, import.meta.url));
const siteFiles = read('scripts/site-files.txt').split('\n').map((s) => s.trim()).filter(Boolean);

test('the manifest makes an app that opens on the referee\'s home page, with icons that exist', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.strictEqual(m.start_url, '/home.html'); assert.strictEqual(m.display, 'standalone'); assert.strictEqual(m.scope, '/');
  for (const i of [...m.icons, ...m.shortcuts.flatMap((s) => s.icons)]) assert.ok(exists(i.src.slice(1)), i.src);
  assert.ok(m.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512'));
  assert.ok(m.icons.some((i) => i.sizes === '192x192'));
  for (const f of ['home.html', 'learn/index.html', 'offline.html']) assert.match(read(f), /<link rel="manifest" href="\/manifest\.webmanifest">/, f);
});
test('the service worker keeps Home and Learning\'s files, every one of them on the site, and never touches the API', () => {
  const sw = read('sw.js');
  const files = JSON.parse(sw.match(/const FILES = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  for (const f of files) {
    const file = f === '/learn/' ? 'learn/index.html' : f.slice(1);
    assert.ok(exists(file), f); assert.ok(siteFiles.includes(file), `${f} is deployed`);
  }
  // every script Learning and Home load, and everything those load in turn, is kept, so they start with no signal
  const seen = new Set();
  const follow = (path) => {
    if (seen.has(path)) return; seen.add(path);
    assert.ok(files.includes(path), `${path} is kept`);
    const dir = path.slice(0, path.lastIndexOf('/') + 1);
    for (const m of read(path.slice(1)).matchAll(/(?:from |import\()'(\.\.?\/[\w./-]+\.js)'/g)) follow(new URL(m[1], `https://x${dir}`).pathname);
  };
  follow('/learn/learn.js'); follow('/home.js');
  assert.ok(seen.has('/burpee.js') && seen.has('/learn/saved.js'), 'it followed the imports all the way');
  assert.match(sw, /startsWith\('\/api\/'\)\) return;/);
  assert.match(read('scripts/deploy-site.sh'), /sed -i "s\/__VERSION__\/\$COMMIT\/" "\$OUT\/sw\.js"/, 'each deploy names its commit, so phones fetch the files afresh');
});
test('Home and Learning register the app, and Sign out clears what it kept', () => {
  assert.match(read('home.js'), /registerApp\(\)/); assert.match(read('learn/learn.js'), /registerApp\(\)/);
  assert.match(read('api-base.js'), /import\('\.\/offline\.js'\)\)\.clearAll\(\)/);
  assert.match(read('home.html'), /id="installCard"/);
});
test('Home, Learning and the offline page have the study look, with its Look button, and the app keeps both', () => {
  for (const f of ['home.html', 'learn/index.html', 'offline.html']) { assert.match(read(f), /study\.css"/, f); assert.match(read(f), /look\.js"><\/script>/, f); }
  const sw = read('sw.js');
  for (const f of ['/study.css', '/look.js', '/learn/sharp.js']) assert.ok(sw.includes(`'${f}'`), f);
  assert.doesNotMatch(read('judge.html'), /study\.css/, 'the event-day pages keep their own look');
});
test('saving for offline asks for lessons by the same address the player does, so the player finds them', () => {
  assert.match(read('learn/lesson.js'), /call\(lessonPath\(id, q\.get\('locale'\) \|\| pageLang, q\.get\('content'\)\)\)/);
  assert.match(read('learn/saved.js'), /get\(lessonPath\(l\.id, lang\)\)/);
  // the rules and the handbook too
  assert.match(read('learn/govern.js'), /call\(`rules\?programme=\$\{encodeURIComponent\(pid\)\}`\)/); assert.match(read('learn/saved.js'), /get\(`rules\?programme=\$\{encodeURIComponent\(pid\)\}`\)/);
  assert.match(read('learn/govern.js'), /call\(`handbook\/\$\{encodeURIComponent\(rest\)\}\?locale=\$\{encodeURIComponent\(locale\)\}`\)/);
});

// ---------------------------------------------------------------- offline.js, in node with a pretend browser
function browser() {
  const ls = new Map();
  globalThis.localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) };
  const stores = new Map();
  globalThis.caches = {
    open: async (n) => { if (!stores.has(n)) stores.set(n, new Map()); const s = stores.get(n); return { put: async (k, r) => s.set(String(k), await r.clone().arrayBuffer().then((b) => new Response(b, { headers: r.headers }))), match: async (k) => s.get(String(k))?.clone(), delete: async (k) => s.delete(String(k)) }; },
    delete: async (n) => stores.delete(n),
  };
  Object.defineProperty(globalThis, 'location', { value: { origin: 'https://site.example', protocol: 'https:', hostname: 'site.example' }, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
  return { ls };
}
const O = async () => import(`../offline.js?${Math.random()}`);
const noSignal = () => Promise.reject(new TypeError('Failed to fetch'));

test('what\'s kept is the signed-in person\'s: another sign-in on the phone never sees it', async () => {
  browser(); const o = await O();
  localStorage.setItem('sp_token', 'tokenA');
  o.setOwner('Ann@Example.com');
  await o.keep('me', { name: 'Ann' });
  assert.deepStrictEqual((await o.recall('me')).data, { name: 'Ann' });
  localStorage.setItem('sp_token', 'tokenB'); // someone else signs in
  assert.strictEqual(await o.recall('me'), null);
  localStorage.setItem('sp_token', 'tokenA');
  await o.clearAll(); // Sign out
  assert.strictEqual(await o.recall('me'), null);
});
test('a GET: the server\'s answer when there\'s signal (kept), the kept copy when there isn\'t, and the server\'s "no" stays a no', async () => {
  browser(); const o = await O();
  localStorage.setItem('sp_token', 't'); o.setOwner('ann@example.com');
  assert.deepStrictEqual(await o.viaCache('rules', async () => ({ v: 1 })), { v: 1 });
  assert.deepStrictEqual(await o.viaCache('rules', noSignal), { v: 1 }, 'no signal: the kept copy');
  navigator.onLine = false;
  assert.deepStrictEqual(await o.viaCache('rules', () => { throw new Error('not even tried'); }), { v: 1 }, 'offline: not even tried');
  await assert.rejects(o.viaCache('handbook', noSignal), (e) => e.offline === true, 'nothing kept: says so');
  navigator.onLine = true;
  await assert.rejects(o.viaCache('rules', () => Promise.reject(Object.assign(new Error('Not yours'), { status: 403 }))), /Not yours/);
  assert.deepStrictEqual(await o.viaCache('rules', () => Promise.reject(Object.assign(new Error('waking'), { status: 503 }))), { v: 1 }, 'the server failing: the kept copy');
});
test('lesson progress made offline waits, the latest per lesson, and goes when there\'s signal', async () => {
  browser(); const o = await O();
  localStorage.setItem('sp_token', 't'); o.setOwner('ann@example.com');
  o.queue({ path: 'lessons/L1/progress', method: 'PUT', body: { slide: 2 }, key: 'lessons/L1/progress' });
  o.queue({ path: 'lessons/L1/progress', method: 'PUT', body: { slide: 5 }, key: 'lessons/L1/progress' });
  o.queue({ path: 'lessons/L1/complete', method: 'POST', body: {} });
  assert.strictEqual(o.waiting(), 2);
  await o.flush(noSignal);
  assert.strictEqual(o.waiting(), 2, 'still no signal: kept');
  const sent = [];
  await o.flush(async (x) => { sent.push(x); if (x.method === 'POST') throw Object.assign(new Error('no'), { status: 400 }); });
  assert.deepStrictEqual(sent.map((x) => x.body), [{ slide: 5 }, {}]);
  assert.strictEqual(o.waiting(), 0, 'sent, or refused by the server and dropped');
});
