// Lets the installed web app open without signal: pages and files come from the network when it's there
// (so updates arrive straight away) and from the copy kept on the phone when it isn't. The chat and news (/api) are never cached.
const CACHE = 'spartans-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || e.request.headers.has('range')) return;
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok && r.type === 'basic') { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request).then((m) => m || caches.match('./'))),
  );
});
