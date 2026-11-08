/* Viaggio service worker: the app itself opens with zero data after the first visit.
   - Only same-origin requests are handled. Google Maps / Firebase traffic is never touched or cached here.
   - /_next/static (hashed, immutable), fonts and icons: cache-first.
   - The page and other same-origin files: serve the saved copy instantly, refresh it in the background
     at most every 12 hours (so opening the app 5 times a day costs 2 refreshes, not 5).
   Works under any base path (GitHub Pages sub-folder etc.) because it derives everything from its own scope. */
const CACHE = 'viaggio-v2';           // bump to force every device to drop old files
const MAX = 150;                      // cap on cached files (the app shell is never evicted)
const REFRESH = 12 * 60 * 60 * 1000;
const SCOPE = self.registration.scope;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.add(new Request(SCOPE, { cache: 'reload' }))).catch(() => {}).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('viaggio-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const fresh = (res) => Date.now() - (new Date(res.headers.get('date') || 0).getTime() || 0) < REFRESH;

async function trim(c) {
  const ks = (await c.keys()).filter((r) => r.url !== SCOPE);
  if (ks.length > MAX) await Promise.all(ks.slice(0, ks.length - MAX).map((r) => c.delete(r)));
}

async function store(c, req, res) {
  if (res && res.ok && !res.redirected && res.type === 'basic') { await c.put(req, res.clone()); await trim(c); }
  return res;
}

const cacheFirst = async (req) => {
  const c = await caches.open(CACHE), hit = await c.match(req);
  return hit || store(c, req, await fetch(req));
};

const staleWhileRevalidate = async (e, req, opts) => {
  const c = await caches.open(CACHE);
  const hit = (await c.match(req, opts)) || (req.mode === 'navigate' ? await c.match(SCOPE) : undefined);
  const net = () => fetch(req).then((res) => store(c, req, res));
  if (hit) {
    if (!fresh(hit)) e.waitUntil(net().catch(() => {}));
    return hit;
  }
  return net();
};

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') return e.respondWith(staleWhileRevalidate(e, req, { ignoreSearch: true }));
  if (url.pathname.includes('/_next/static/') || /\.(?:woff2?|ttf|otf|ico|png|svg|webmanifest)$/i.test(url.pathname)) return e.respondWith(cacheFirst(req));
  e.respondWith(staleWhileRevalidate(e, req));
});
