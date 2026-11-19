// The installable SpartanReferee app's service worker: it keeps the referee's pages (Home and Learning) on the phone so they open with
// no signal at a venue. What the server says (events, lessons, rules) is kept by the pages themselves (offline.js), per person.
//   Home and Learning's own files   from the network when there's signal (so a deploy shows at once), else the copy kept here.
//                                   With a copy here, a slow network gets 3 seconds before the copy is used.
//   another page, offline           offline.html, which says it needs a connection and leads back to what works.
//   fonts and the PDF maker         kept the first time, then used from here.
//   the API, the camera pages       never touched.
// VERSION becomes the deployed commit (scripts/deploy-site.sh), so each deploy fetches the files afresh.
const VERSION = '__VERSION__';
const SHELL = `sr-shell-${VERSION}`, EXTRA = 'sr-extra', DATA = 'sr-data'; // DATA belongs to offline.js: never cleared here
const FILES = ['/home.html', '/home.js', '/learn/', '/offline.html', '/offline.js', '/api-base.js', '/email-signin-web.js', '/email-signin-core.js',
  '/language.js', '/i18n.js', '/headjudge.css', '/study.css', '/look.js', '/tracked-demos.js', '/exercises.js', '/burpee.js', '/pose-filter.js', '/manifest.webmanifest',
  '/learn/learn.css', '/learn/learn.js', '/learn/core.js', '/learn/programmes.js', '/learn/people.js', '/learn/lesson.js', '/learn/practice.js',
  '/learn/assess.js', '/learn/judgement.js', '/learn/govern.js', '/learn/reports.js', '/learn/diagnostics.js', '/learn/saved.js', '/learn/sharp.js',
  '/icons/spartanreferee/icon-192.png', '/icons/spartanreferee/icon-512.png'];
const OURS = new Set(FILES);
const ours = (path) => OURS.has(path) || path === '/learn/index.html' || path.startsWith('/i18n/') || path.startsWith('/icons/spartanreferee/');
const KEPT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];

self.addEventListener('install', (e) => e.waitUntil((async () => {
  const c = await caches.open(SHELL);
  // each on its own, so one missing file doesn't stop the rest
  await Promise.all(FILES.map((f) => fetch(f, { cache: 'no-cache' }).then((r) => (r.ok ? c.put(f, r) : null)).catch(() => null)));
  await self.skipWaiting();
})()));
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('sr-shell-') && k !== SHELL) await caches.delete(k);
  await self.clients.claim();
})()));

const keyOf = (u) => (u.pathname === '/learn/index.html' ? '/learn/' : u.pathname); // the same page by either address
async function kept(u) {
  const c = await caches.open(SHELL);
  return (await c.match(keyOf(u))) || (await caches.match(keyOf(u), { ignoreSearch: true }));
}
async function networkFirst(req, u) {
  const copy = await kept(u);
  const net = fetch(req).then(async (r) => {
    if (r.ok && r.type === 'basic') await (await caches.open(SHELL)).put(keyOf(u), r.clone());
    return r;
  });
  if (!copy) return net.catch(() => (req.mode === 'navigate' ? offlinePage() : Response.error()));
  const slow = new Promise((res) => setTimeout(() => res(copy), 3000));
  return Promise.race([net.catch(() => copy), slow]);
}
async function offlinePage() {
  return (await caches.match('/offline.html')) || new Response('<!doctype html><meta charset="utf-8"><title>Offline</title><p>You\'re offline. <a href="/home.html">Home</a>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
async function keptFirst(req) {
  const c = await caches.open(EXTRA), hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok || r.type === 'opaque') await c.put(req, r.clone());
  return r;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin === self.location.origin) {
    if (u.pathname.startsWith('/api/')) return;
    if (ours(u.pathname)) { e.respondWith(networkFirst(req, u)); return; }
    if (req.mode === 'navigate') e.respondWith(fetch(req).catch(offlinePage));
    return;
  }
  if (KEPT_HOSTS.includes(u.hostname)) e.respondWith(keptFirst(req));
});
