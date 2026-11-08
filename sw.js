// HeadJudge keeps no offline copy. The Spartans app, which lived here at /app until 8 November 2026, installed one; Spartans has
// its own site now. A browser that still has that worker gets this one instead, which clears what it kept and removes itself.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
})()));
