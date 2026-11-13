/* Viaggio service worker: the app opens instantly and works offline after the first visit.
   - Only same-origin requests are handled. Google Maps / Firebase traffic is never touched or cached here.
   - /_next/static (hashed, immutable) and fonts: cache-first.
   - The page itself: NETWORK-FIRST (revalidated with the server, a cheap 304 when nothing changed).
     If the network is slow (> NAV_TIMEOUT) or offline, the saved copy opens instantly and the update lands in the background.
     So a new deploy shows up on the next normal load, with no waiting for a timer and no clearing of browser data.
   - Icons / manifest / other files: serve the saved copy, refresh it in the background at most every 12 hours.
   - Every new page version also pre-downloads its JS/CSS, so it is already available offline.
   - "Update available": the page asks this worker to CHECK now and then; the worker compares the server's page with the one
     it served, and if they differ it sends {type:'UPDATE'} so the app can offer a Reload button.
   Works under any base path (GitHub Pages sub-folder etc.) because it derives everything from its own scope. */
const CACHE = 'viaggio-v3';           // bump to force every device to drop old files
const MAX = 200;                      // cap on cached files (the page shell is never evicted)
const REFRESH = 12 * 60 * 60 * 1000;
const NAV_TIMEOUT = 3500;             // ms to wait for the network before opening the saved page
const SCOPE = self.registration.scope;
const SERVED = SCOPE + '__served';    // fingerprint of the page version the app was last opened with

const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const fresh = (res) => Date.now() - (new Date(res.headers.get('date') || 0).getTime() || 0) < REFRESH;

async function trim(c) {
  const ks = (await c.keys()).filter((r) => r.url !== SCOPE && r.url !== SERVED);
  if (ks.length > MAX) await Promise.all(ks.slice(0, ks.length - MAX).map((r) => c.delete(r)));
}

async function store(c, req, res) {
  if (res && res.ok && !res.redirected && res.type === 'basic') { await c.put(req, res.clone()); await trim(c); }
  return res;
}

const markServed = async (c, hash) => { await c.put(SERVED, new Response(hash)); };

/* download every hashed JS/CSS/font the page references that we do not have yet */
async function precache(c, html) {
  const urls = new Set();
  for (const m of html.matchAll(/(?:src|href)="([^"]*\/_next\/static\/[^"]+)"/g)) {
    try { const u = new URL(m[1].replace(/&amp;/g, '&'), SCOPE); if (u.origin === self.location.origin) urls.add(u.href); } catch {}
  }
  await Promise.all([...urls].map(async (u) => {
    if (await c.match(u)) return;
    try { await store(c, new Request(u), await fetch(u)); } catch {}
  }));
}

/* fetch the page from the server (revalidating), save it, and start saving its assets */
async function pullShell(c, mode) {
  const res = await fetch(SCOPE, { cache: mode });
  if (!res.ok) throw new Error('shell ' + res.status);
  await store(c, SCOPE, res);
  const html = await res.clone().text();
  return { res, hash: await sha(html), pre: precache(c, html) };
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    try { const c = await caches.open(CACHE), s = await pullShell(c, 'reload'); await markServed(c, s.hash); await s.pre; } catch {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('viaggio-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function navigate(e, req) {
  const c = await caches.open(CACHE);
  if (new URL(req.url).pathname !== new URL(SCOPE).pathname) { // not the app page: plain network-first
    try { return await fetch(req); } catch { return (await c.match(req, { ignoreSearch: true })) || (await c.match(SCOPE)) || Response.error(); }
  }
  const net = pullShell(c, 'no-cache');
  net.catch(() => {});
  let got = null;
  try { got = await Promise.race([net, new Promise((r) => setTimeout(r, NAV_TIMEOUT, null))]); } catch {}
  if (got) { e.waitUntil(Promise.all([markServed(c, got.hash), got.pre])); return got.res; }
  const hit = await c.match(SCOPE);
  if (!hit) return (await net).res; // nothing saved yet: wait for the network
  e.waitUntil(net.then((s) => s.pre).catch(() => {}));
  e.waitUntil(hit.clone().text().then(sha).then((h) => markServed(c, h)));
  return hit;
}

/* the page asks "is there a newer version?"; we answer only when there is */
self.addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'CHECK') return;
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    const served = await c.match(SERVED).then((r) => r && r.text());
    const s = await pullShell(c, 'no-cache');
    await s.pre;
    if (served && s.hash !== served) (await self.clients.matchAll({ type: 'window' })).forEach((w) => w.postMessage({ type: 'UPDATE' }));
  })().catch(() => {}));
});

const cacheFirst = async (req) => {
  const c = await caches.open(CACHE), hit = await c.match(req);
  return hit || store(c, req, await fetch(req));
};

const staleWhileRevalidate = async (e, req) => {
  const c = await caches.open(CACHE), hit = await c.match(req);
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
  if (req.mode === 'navigate') return e.respondWith(navigate(e, req));
  if (url.pathname.includes('/_next/static/') || /\.(?:woff2?|ttf|otf)$/i.test(url.pathname)) return e.respondWith(cacheFirst(req));
  e.respondWith(staleWhileRevalidate(e, req));
});
