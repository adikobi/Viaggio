const V='v3';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(clients.claim()));
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET'||new URL(r.url).origin!==location.origin)return;
const hashed=r.url.includes('/_next/static/');
e.respondWith(caches.open(V).then(async c=>{const m=await c.match(r);if(m&&hashed)return m;
const f=fetch(r).then(x=>{if(x.ok)c.put(r,x.clone());return x});
return m?(f.catch(()=>{}),m):f.catch(()=>c.match(self.registration.scope))}))});
