/* Predict service worker.
 * The build step (tools/build_site.sh) replaces __BUILD__ with the git commit, so every deploy
 * gets a new cache name and the old one is deleted. All paths are relative: GitHub Pages serves
 * this app under /Predict/, not at the root. */
const VERSION = 'predict-shell-__BUILD__';

// Every file the app needs offline (pages, scripts, styles, fonts, tables, questions) is listed in precache.json,
// which tools/build_site.sh writes for each deploy. The worker keeps all of them, or none: if one fetch fails the
// install fails and the phone keeps running the previous version.
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // cache: 'reload' skips the browser's own HTTP cache (GitHub Pages sends max-age=600), so a new
    // deploy never precaches a ten-minute-old copy of itself.
    const res = await fetch('./precache.json', { cache: 'reload' });
    if (!res.ok) throw new Error('precache.json is missing');
    const files = await res.json();
    await cache.addAll(['./', ...files].map((u) => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('predict-shell-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Opening the app: ask the network first (revalidating, so a new deploy shows up at once) and
  // keep a copy; offline, fall back to the copy.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Everything else (scripts, tables, questions, letters): this build's copy first, then the
  // network, keeping what it returns. A new build means a new cache, so nothing goes stale.
  event.respondWith(
    caches.open(VERSION).then((cache) =>
      cache.match(req).then((hit) => hit || fetch(req, { cache: 'no-cache' }).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }))
    )
  );
});
