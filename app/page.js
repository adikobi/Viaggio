'use client';
import { Fragment, useEffect, useRef, useState } from 'react';
const KEY = 'viaggio.v1', LEGS = 'viaggio.legs', UI = 'viaggio.ui', SYNC = 'viaggio.sync', K = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const FB = { apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID };
const uid = () => Math.random().toString(36).slice(2, 9);
const CATS = ['Sightseeing', 'Food', 'Lodging', 'Transport', 'Shopping', 'Other'];
const MODES = { DRIVING: 'Drive', WALKING: 'Walk', TRANSIT: 'Transit' };
const MC = { DRIVING: '#e5483a', WALKING: '#12805c', TRANSIT: '#2563eb' };
const SPD = { DRIVING: 40, WALKING: 5, TRANSIT: 22 };
const newDay = () => ({ id: uid(), title: '', places: [], notes: '', todos: [], mode: 'WALKING', lm: {}, alt: [] });
const newTrip = (name) => ({ id: uid(), name, cc: '€', notes: '', todos: [], days: [newDay()], wish: [] });
const norm = (v) => {
  v.ts ||= 1;
  v.trips.forEach((t) => { t.notes ??= ''; t.todos ??= []; t.cc ??= '€'; t.wish ??= []; t.days.forEach((d) => { d.title ??= ''; d.notes ??= ''; d.todos ??= []; d.mode ??= 'WALKING'; d.lm ??= {}; d.alt ??= []; }); });
  return v;
};
const modeOf = (d, a, z) => d?.lm?.[a.id + '>' + z.id] || d?.mode || 'WALKING';
const fmt = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`);
const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const ll = (p) => `${p.lat},${p.lng}`;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const A = (t) => ({ dir: 'auto', lang: /[\u0590-\u05FF]/.test(t || '') ? 'he' : undefined });
const tagsOf = (p) => [...new Set([p.cat.toLowerCase(), ...((p.note || '').match(/#[\p{L}\p{N}_]+/gu) || []).map((t) => t.slice(1).toLowerCase())])];
const gmaps = (o, d, m) => `https://www.google.com/maps/dir/?api=1${o ? '&origin=' + ll(o) : ''}&destination=${ll(d)}&travelmode=${m.toLowerCase()}`;
const TTL = 30 * 864e5; // cached leg times stay valid 30 days
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* Google polyline encoding (5 decimals): a cached route is ~6x smaller than a [{lat,lng}] array, so far more routes fit in localStorage */
const encPoly = (pts) => { let o = '', pl = 0, pn = 0; const e = (v) => { v = v < 0 ? ~(v << 1) : v << 1; while (v >= 32) { o += String.fromCharCode((32 | (v & 31)) + 63); v >>= 5; } o += String.fromCharCode(v + 63); }; for (const p of pts) { const a = Math.round(p.lat * 1e5), n = Math.round(p.lng * 1e5); e(a - pl); e(n - pn); pl = a; pn = n; } return o; };
const decPoly = (s) => { const out = []; let i = 0, a = 0, n = 0; const d = () => { let r = 0, sh = 0, b; do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); return r & 1 ? ~(r >> 1) : r >> 1; }; while (i < s.length) { a += d(); n += d(); out.push({ lat: a / 1e5, lng: n / 1e5 }); } return out; };
const pathOf = (e) => e.path || (e.enc ? decPoly(e.enc) : []);
const slowNet = () => { const c = navigator.connection; return !!c && (c.saveData === true || /(^|-)2g$/.test(c.effectiveType || '')); };
const project = (v, d = 0.99) => (v / 1000) * d / (1 - d);
const tick = (ms = 8) => { try { navigator.vibrate?.(ms); } catch {} };
/* Apple-style rubber band: resistance grows the further past the edge you drag */
const band = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));
let mapsP, fbP;
const loadMaps = () => (mapsP ||= new Promise((res, rej) => {
  if (window.google?.maps) return res();
  window.__gm = res;
  const s = document.createElement('script');
  s.src = `https://maps.googleapis.com/maps/api/js?key=${K}&v=quarterly&loading=async&callback=__gm`;
  s.onerror = () => { mapsP = null; rej(); }; document.head.append(s);
}));
const fb = () => (fbP ||= Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]).then(([a, Au, F]) => {
  const app = a.initializeApp(FB);
  // initializeAuth without a popup resolver: no auth iframe/gapi download on every launch (the resolver is passed at sign-in)
  const auth = Au.initializeAuth(app, { persistence: [Au.indexedDBLocalPersistence, Au.browserLocalPersistence] });
  // on-device Firestore cache: reconnects only download what changed, and edits made offline are queued
  let db; try { db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); } catch { db = F.getFirestore(app); }
  return { A: Au, F, auth, db };
}).catch((e) => { fbP = null; throw e; }));
// one shared, lazily created route-library loader
let routeP;
const getRoute = () => (routeP ||= loadMaps().then(() => google.maps.importLibrary('routes')).then((l) => l.Route).catch((e) => { routeP = null; throw e; }));

/* straight-line fallback so a leg is never blank */
const est = (a, z, m) => {
  const r = Math.PI / 180, dl = (z.lat - a.lat) * r, dn = (z.lng - a.lng) * r;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(z.lat * r) * Math.sin(dn / 2) ** 2;
  const d = 2 * 6371 * Math.asin(Math.sqrt(h)) * 1.3 * 1000;
  return { d, t: Math.max(1, Math.round((d / 1000 / SPD[m]) * 60)), est: true, path: [{ lat: a.lat, lng: a.lng }, { lat: z.lat, lng: z.lng }] };
};
/* returns route, false (definitively no route) or null (failed after retries) */
async function fetchLeg(Route, a, z, mode) {
  for (let n = 0; n < 3; n++) {
    try {
      const { routes } = await Route.computeRoutes({ origin: { lat: a.lat, lng: a.lng }, destination: { lat: z.lat, lng: z.lng }, travelMode: mode, fields: ['path', 'distanceMeters', 'durationMillis'] });
      const rt = routes?.[0]; if (!rt) return false;
      return { d: rt.distanceMeters, t: Math.max(1, Math.round(rt.durationMillis / 60000)), path: rt.path.map((p) => ({ lat: +p.lat.toFixed(5), lng: +p.lng.toFixed(5) })) };
    } catch { await sleep(500 * 2 ** n); }
  }
  return null;
}

const P = {
  nav: 'M3 11l18-8-8 18-2-8-8-2z', up: 'M12 19V5M5 12l7-7 7 7', down: 'M12 5v14M19 12l-7 7-7-7', heart: 'M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z',
  x: 'M6 6l12 12M18 6L6 18', plus: 'M12 5v14M5 12h14', chev: 'M6 9l6 6 6-6', loc: 'M12 2v3M12 19v3M2 12h3M19 12h3M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14', list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  split: 'M3 5h18v14H3zM10 5v14', trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', share: 'M12 15V3M7 8l5-5 5 5M5 13v7h14v-7', pin: 'M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 1 0 0-14M20 20l-4-4', left: 'M15 6l-6 6 6 6', right: 'M9 6l6 6-6 6', moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  car: 'M5 16V11l2-5h10l2 5v5M3 16h18M7.5 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 1 0 0 3M16.5 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 1 0 0 3', walk: 'M13 4.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 1 0 0 3M10 22l2-7-3-3 1-5 3 3 3 1M9 12l-3 2',
  bus: 'M5 4h14v13H5zM5 11h14M8 20v-3M16 20v-3', dots: 'M5 12h.01M12 12h.01M19 12h.01', note: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5', retry: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7', box: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
};
const Ic = ({ n, s = 20 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[n]} /></svg>;
const MI = { DRIVING: 'car', WALKING: 'walk', TRANSIT: 'bus' };

/* ---- Place search: Google (debounced, cached, session-tokened) with automatic Photon fallback ---- */
const FBK = 'viaggio.geo.fallback', QC_MAX = 60;
let useFb = false; try { useFb = sessionStorage.getItem(FBK) === '1'; } catch {}
const goFb = () => { useFb = true; try { sessionStorage.setItem(FBK, '1'); } catch {} };
const qCache = new Map(); // "g|query" or "p|query" -> suggestions, avoids repeat requests
const remember = (k, v) => { if (qCache.size >= QC_MAX) qCache.delete(qCache.keys().next().value); qCache.set(k, v); };
const newPlace = (o) => ({ id: uid(), name: '', addr: '', lat: 0, lng: 0, pid: '', cat: 'Sightseeing', time: '', sub: '', cost: 0, note: '', ...o });
const quotaErr = (e) => /quota|429|RESOURCE_EXHAUSTED|network|failed to fetch|PERMISSION_DENIED|OVER_QUERY/i.test(String(e?.message || e));
/* Photon GeoJSON feature -> same shape as a Google-picked place */
const fromPhoton = (f) => {
  const p = f.properties || {}, [lng, lat] = f.geometry.coordinates;
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const addr = [...new Set([street, p.district, p.city || p.town || p.village || p.county, p.state, p.country].filter(Boolean))].join(', ');
  const name = p.name || street || addr;
  return { key: (p.osm_type || '') + (p.osm_id || '') + ',' + lat + ',' + lng, label: name, sub: addr === name ? '' : addr, place: newPlace({ name, addr: addr || name, lat, lng, pid: p.osm_id ? `osm:${p.osm_type || ''}${p.osm_id}` : '' }) };
};
async function photon(q, signal) {
  const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5`, { signal });
  if (!r.ok) throw new Error('photon ' + r.status);
  return ((await r.json()).features || []).map(fromPhoton);
}
async function gSearch(q, token) {
  const { AutocompleteSuggestion } = await google.maps.importLibrary('places');
  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({ input: q, sessionToken: token });
  return suggestions.filter((s) => s.placePrediction).slice(0, 5).map((s) => {
    const pp = s.placePrediction;
    return { key: pp.placeId, label: pp.mainText?.text || pp.text.text, sub: pp.secondaryText?.text || '', pred: pp };
  });
}

function Search({ onPick, focus }) {
  const [q, setQ] = useState(''), [items, setItems] = useState([]), [open, setOpen] = useState(false), [hi, setHi] = useState(-1), [src, setSrc] = useState(useFb ? 'p' : 'g');
  const cb = useRef(), tok = useRef(), seq = useRef(0), ac = useRef(), inp = useRef(); cb.current = onPick;
  const lib = useRef();
  useEffect(() => { if (focus) setTimeout(() => inp.current?.focus(), 60); return () => ac.current?.abort(); }, []);
  const run = async (text) => {
    const n = ++seq.current; ac.current?.abort(); ac.current = new AbortController();
    const done = (list, s) => { if (n === seq.current) { setItems(list); setSrc(s); setHi(-1); setOpen(true); } };
    if (!useFb) {
      const ck = 'g|' + text.toLowerCase(); if (qCache.has(ck)) return done(qCache.get(ck), 'g');
      try {
        await loadMaps();
        const { AutocompleteSessionToken } = lib.current ||= await google.maps.importLibrary('places');
        tok.current ||= new AutocompleteSessionToken();
        const list = await gSearch(text, tok.current); remember(ck, list); return done(list, 'g');
      } catch (e) { if (!quotaErr(e)) return done([], 'g'); goFb(); }
    }
    const ck = 'p|' + text.toLowerCase(); if (qCache.has(ck)) return done(qCache.get(ck), 'p');
    try { const list = await photon(text, ac.current.signal); remember(ck, list); done(list, 'p'); } catch (e) { if (e?.name !== 'AbortError') done([], 'p'); }
  };
  const t = useRef();
  const change = (v) => {
    setQ(v); clearTimeout(t.current);
    const s = v.trim(); if (s.length < 3) { seq.current++; setItems([]); setOpen(false); return; }
    t.current = setTimeout(() => run(s), 450); // wait for the user to pause typing
  };
  const pick = async (it) => {
    setOpen(false); setQ(''); setItems([]);
    if (it.place) return cb.current(it.place);
    try {
      const p = it.pred.toPlace(); // inherits the session token -> autocomplete + details billed as one session
      await p.fetchFields({ fields: ['displayName', 'formattedAddress', 'location', 'id'] });
      tok.current = null;
      cb.current(newPlace({ name: p.displayName, addr: p.formattedAddress, lat: p.location.lat(), lng: p.location.lng(), pid: p.id }));
    } catch { tok.current = null; }
  };
  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && items.length) { e.preventDefault(); pick(items[Math.max(hi, 0)]); }
    else if (e.key === 'Escape') setOpen(false);
  };
  return <div className="srch" style={{ position: 'relative' }}>
    <input ref={inp} {...A(q)} value={q} placeholder="Search a place…" enterKeyHint="search" autoComplete="off" role="combobox" aria-expanded={open} aria-autocomplete="list"
      onChange={(e) => change(e.target.value)} onKeyDown={key} onFocus={() => items.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
      style={{ width: '100%', boxSizing: 'border-box' }} />
    {open && <div role="listbox" style={{ position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 50, marginTop: 4, background: 'Canvas', color: 'CanvasText', border: '1px solid rgba(128,128,128,.35)', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,.2)', overflow: 'hidden' }}>
      {items.map((it, i) => <div key={it.key} role="option" aria-selected={i === hi} onMouseDown={(e) => { e.preventDefault(); pick(it); }} onMouseEnter={() => setHi(i)}
        style={{ padding: '10px 12px', cursor: 'pointer', background: i === hi ? 'rgba(128,128,128,.18)' : 'transparent' }}>
        <div {...A(it.label)} style={{ fontWeight: 600 }}>{it.label}</div>{it.sub && <small {...A(it.sub)} style={{ opacity: .7 }}>{it.sub}</small>}
      </div>)}
      {!items.length && <div style={{ padding: '10px 12px', opacity: .7 }}>No results</div>}
      <small style={{ display: 'block', padding: '4px 12px 6px', opacity: .5, textAlign: 'right' }}>{src === 'g' ? 'Google' : 'OpenStreetMap · Photon'}</small>
    </div>}
  </div>;
}

const Chips = ({ opts, val, on, f = (x) => x }) => <div className="chips">{opts.map((o) => <button key={o} className="chip" aria-pressed={val === o} onClick={() => on(o)}>{f(o)}</button>)}</div>;

function Todos({ items, set, del }) {
  const [v, setV] = useState('');
  const add = () => { const t = v.trim(); if (!t) return; set((l) => [...l, { id: uid(), text: t, done: false }]); setV(''); };
  return <>
    <div className="addrow"><input {...A(v)} value={v} onChange={(e) => setV(e.target.value)} placeholder="Add a task" enterKeyHint="done" onKeyDown={(e) => e.key === 'Enter' && add()} /><button className="ib acc" onClick={add} aria-label="Add task"><Ic n="plus" /></button></div>
    {items.map((t) => <div key={t.id} className={'todo' + (t.done ? ' done' : '')}>
      <label><input type="checkbox" checked={t.done} onChange={() => set((l) => l.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))} /></label>
      <span {...A(t.text)} className="bd" style={{ flex: 1 }}>{t.text}</span>
      <button className="ib" onClick={() => del(t)} aria-label="Delete"><Ic n="x" /></button>
    </div>)}
  </>;
}

function Dialog({ d, close }) {
  const [v, setV] = useState(d.input ?? '');
  useEffect(() => { const k = (e) => e.key === 'Escape' && close(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  const go = (e) => { e.preventDefault(); if (d.input !== undefined && !v.trim()) return; d.ok(v.trim()); close(); };
  return <div className="scrim" onClick={close}><form className="dlg" role="dialog" aria-modal="true" onSubmit={go} onClick={(e) => e.stopPropagation()}>
    <h2>{d.title}</h2>
    {d.text && <p className="sum" style={{ margin: 0 }}>{d.text}</p>}
    {d.input !== undefined && <input autoFocus {...A(v)} value={v} onChange={(e) => setV(e.target.value)} placeholder={d.ph} />}
    <div className="row"><button type="button" className="ghost" onClick={close}>Cancel</button><button className={d.danger ? 'ghost danger' : 'btn'} autoFocus={d.input === undefined}>{d.label || 'OK'}</button></div>
  </form></div>;
}

function AddDlg({ label, onPick, close }) {
  useEffect(() => { const k = (e) => e.key === 'Escape' && close(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  return <div className="scrim top" onClick={close}><div className="dlg" role="dialog" aria-modal="true" aria-label="Add a place" onClick={(e) => e.stopPropagation()}>
    <div className="dh"><h2>Add to {label}</h2><button className="ib" onClick={close} aria-label="Close"><Ic n="x" /></button></div>
    <Search focus onPick={(p) => { onPick(p); close(); }} />
  </div></div>;
}

const useMedia = (q) => { const [m, setM] = useState(false); useEffect(() => { const x = matchMedia(q), f = () => setM(x.matches); f(); x.addEventListener('change', f); return () => x.removeEventListener('change', f); }, [q]); return m; };

export default function Page() {
  const [s, setS] = useState(null);
  const [rdy, setRdy] = useState(null); // uid whose cloud copy has been read; uploads are blocked until then
  const [legs, setLegs] = useState({});
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(null);
  const [drag, setDrag] = useState(null);
  const [ok, setOk] = useState(!!K);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState('plan');
  const [ns, setNs] = useState('day');
  const [q, setQ] = useState('');
  const [online, setOnline] = useState(true);
  const [user, setUser] = useState(null);
  const [live, setLive] = useState(false);
  const [snap, setSnap] = useState('half');
  const [dsk, setDsk] = useState('split');
  const [pw, setPw] = useState(440);
  const [toast, setToast] = useState(null);
  const [upd, setUpd] = useState(false); const updSkip = useRef(false); // a newer version of the app is ready
  const [dlg, setDlg] = useState(null);
  const [adding, setAdding] = useState(false); // false | true (route / travel list) | 'alt' (backup ideas)
  const [menu, setMenu] = useState(false);
  const desk = useMedia('(min-width:900px)');
  const [dsPref, setDsPref] = useState(null), [auto, setAuto] = useState(false), [wantMap, setWantMap] = useState(false), [mapErr, setMapErr] = useState(false), [mapTry, setMapTry] = useState(0);
  const ds = dsPref ?? auto; // data saver: explicit choice, else follow the device's Data Saver / 2G state
  const mapNote = ready ? '' : mapErr ? 'Couldn’t load the map.' : !online ? 'Offline — the map loads when you reconnect. Your itinerary and saved routes still work.' : ds && !wantMap ? 'Data saver is on, so the map isn’t loaded.' : '';
  const mapBtn = ready ? '' : mapErr ? 'Retry' : online && ds && !wantMap ? 'Load map' : '';
  const loadMapNow = () => { setMapErr(false); setWantMap(true); setMapTry((n) => n + 1); };
  const map = useRef(), mk = useRef([]), pl = useRef([]), cache = useRef({}), miss = useRef(new Set()), info = useRef(), openId = useRef(null), sRef = useRef(), remote = useRef(0), me = useRef();
  const app = useRef(), panel = useRef(), bnd = useRef(), fitRef = useRef(), uiLoaded = useRef(false);
  const dirty = useRef(false), forceFor = useRef(-1), busy = useRef(false), authOff = useRef(null);
  // The SYNC flag is what makes the next launch restore the session, so it is set whenever Firebase reports a signed-in user (not only after the popup promise resolves, which mobile browsers often never do)
  const watchAuth = () => fb().then(({ A: Au, auth }) => { Au.getRedirectResult(auth, Au.browserPopupRedirectResolver).catch(() => {}); authOff.current ||= Au.onAuthStateChanged(auth, (u) => { if (u) localStorage.setItem(SYNC, '1'); setUser(u); }); });
  sRef.current = s;

  useEffect(() => {
    let v = null;
    try { v = JSON.parse(localStorage.getItem(KEY)); cache.current = JSON.parse(localStorage.getItem(LEGS)) || {}; } catch {}
    try { const u = JSON.parse(localStorage.getItem(UI)); if (u) { u.snap && setSnap(u.snap); u.dsk && setDsk(u.dsk); u.pw && setPw(u.pw); typeof u.dsPref === 'boolean' && setDsPref(u.dsPref); } } catch {}
    uiLoaded.current = true; dirty.current = true; setAuto(slowNet()); // dirty: first persist migrates old route entries to the compact format
    setS(v?.trips ? norm(v) : { ts: 0, trips: [newTrip('Italy')], cur: 0, day: 0, theme: matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light' });
    let swOff = () => {};
    if ('serviceWorker' in navigator) { // new versions: the worker (sw.js) detects a newer deploy and we offer a Reload button instead of reloading under the user's hands
      const sw = navigator.serviceWorker, had = !!sw.controller, ask = () => sw.controller?.postMessage({ type: 'CHECK' });
      const offer = () => { if (!updSkip.current) setUpd(true); };
      const onMsg = (ev) => { if (ev.data?.type === 'UPDATE') offer(); }, onCtl = () => { if (had) offer(); };
      const onVis = () => { if (!document.hidden) { sw.getRegistration().then((r) => r?.update()).catch(() => {}); ask(); } };
      sw.addEventListener('message', onMsg); sw.addEventListener('controllerchange', onCtl); document.addEventListener('visibilitychange', onVis);
      sw.register(`${process.env.NEXT_PUBLIC_BASE_PATH}/sw.js`, { updateViaCache: 'none' }).then((r) => r.update().catch(() => {})).catch(() => {});
      const t1 = setTimeout(ask, 4000), t2 = setInterval(ask, 30 * 60 * 1000);
      swOff = () => { sw.removeEventListener('message', onMsg); sw.removeEventListener('controllerchange', onCtl); document.removeEventListener('visibilitychange', onVis); clearTimeout(t1); clearInterval(t2); };
    }
    const f = () => setOnline(navigator.onLine); f(); addEventListener('online', f); addEventListener('offline', f);
    navigator.storage?.persist?.().catch(() => {}); // stops the browser from clearing the saved login/data when storage is low
    if (FB.apiKey && localStorage.getItem(SYNC)) watchAuth(); // Firebase is only loaded for people who signed in to sync
    return () => swOff();
  }, []);
  useEffect(() => { if (view === 'more' && FB.apiKey) fb().catch(() => {}); }, [view]); // warm up so the sign-in popup isn't blocked
  useEffect(() => { if (s) { localStorage.setItem(KEY, JSON.stringify(s)); document.documentElement.dataset.theme = s.theme; } }, [s]);
  useEffect(() => { if (uiLoaded.current) try { localStorage.setItem(UI, JSON.stringify({ snap, dsk, pw, dsPref })); } catch {} }, [snap, dsk, pw, dsPref]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t); }, [toast]);

  useEffect(() => {
    setRdy(null); remote.current = 0; // new/changed account: nothing is known about the cloud copy yet
    if (!user) return; let off, dead;
    // Never upload before the cloud copy has been read. Otherwise a freshly signed-in device pushes its local data over the account.
    const apply = (snapd) => {
      if (dead) return;
      if (!snapd.exists() && snapd.metadata.fromCache) return; // empty answer from the on-device cache says nothing about the server: keep waiting
      const d = snapd.data(); remote.current = d?.ts || 0;
      if (d && d.ts > (sRef.current.ts || 0)) setS(norm(JSON.parse(d.json))); // cloud is newer: it wins
      setRdy(user.uid); // from here on, local edits newer than the cloud copy are uploaded
    };
    fb().then(({ F, db }) => {
      if (dead) return;
      const ref = F.doc(db, 'users', user.uid);
      if (ds) F.getDoc(ref).then(apply).catch(() => {}); // data saver: one read per launch instead of a live connection
      else off = F.onSnapshot(ref, apply);
    }).catch(() => {});
    return () => { dead = true; off?.(); };
  }, [user, ds]);
  useEffect(() => {
    if (!user || rdy !== user.uid || !s || !(s.ts > remote.current)) return;
    const t = setTimeout(() => fb().then(({ F, db }) => { remote.current = s.ts; return F.setDoc(F.doc(db, 'users', user.uid), { json: JSON.stringify(s), ts: s.ts }); }).catch(() => {}), ds ? 4000 : 800);
    return () => clearTimeout(t);
  }, [s, user, ds, rdy]);

  const trip = s?.trips[s.cur], day = trip && (trip.days[s.day] || trip.days[0]), places = day?.places || [];
  const up = (fn) => setS((x) => { const c = structuredClone(x); const t = c.trips[c.cur]; c.day = Math.min(c.day, t.days.length - 1); fn(c, t, t.days[c.day]); c.ts = Date.now(); return c; });
  const patch = (i, k, v) => up((_, __, d) => { d.places[i][k] = v; });
  const move = (a, b) => up((_, __, d) => { if (b >= 0 && b < d.places.length) d.places.splice(b, 0, d.places.splice(a, 1)[0]); });
  const say = (msg, act, fn) => setToast({ msg, act, fn });
  const undoable = (msg, fn) => { const prev = sRef.current; fn(); say(msg, 'Undo', () => setS({ ...prev, ts: Date.now() })); };
  const addToDay = (p) => { up((_, __, d) => { d.places.push(p); }); say(`Added to Day ${(sRef.current?.day || 0) + 1}`); };
  const toBackup = (i) => { undoable('Moved to Backup ideas', () => up((_, __, d) => { d.alt ||= []; d.alt.push(d.places.splice(i, 1)[0]); })); setOpen(null); };
  const toRoute = (id) => undoable('Added to the route', () => up((_, __, d) => { const k = (d.alt || []).findIndex((x) => x.id === id); if (k >= 0) d.places.push(d.alt.splice(k, 1)[0]); }));
  const addAlt = (p) => { up((_, __, d) => { d.alt ||= []; d.alt.push(p); }); say('Added to Backup ideas'); };
  const addPlace = (p) => { if (ns === 'trip') { up((_, t) => { t.wish.push(p); }); say('Added to Travel locations'); } else addToDay(p); };
  const confirmDel = (title, text, label, msg, fn) => setDlg({ title, text, label, danger: true, ok: () => undoable(msg, fn) });
  const retryLegs = () => { miss.current.clear(); forceFor.current = retry + 1; setRetry(retry + 1); }; // an explicit tap is allowed to use data even in data saver
  const refreshLegs = () => { places.slice(0, -1).forEach((a, i) => { delete cache.current[legKey(a, places[i + 1], modes[i])]; if (modes[i] === 'WALKING') delete cache.current[legKey(places[i + 1], a, modes[i])]; }); dirty.current = true; retryLegs(); say('Recalculating travel times'); };

  const modes = places.slice(0, -1).map((a, i) => modeOf(day, a, places[i + 1]));
  const legKey = (a, z, m) => m + ll(a) + '>' + ll(z);
  const rsig = places.map((p) => p.id + ll(p)).join() + '|' + modes.join();
  const msig = places.map((p) => p.id + p.name + ll(p)).join();

  /* ---------- route cache: look up -> (maybe) fetch -> persist ---------- */
  const getLeg = (a, z, m) => {
    const c = cache.current, now = Date.now();
    let e = c[legKey(a, z, m)];
    if (e) { e.u = now; return e; }
    if (m !== 'WALKING') return null; // a walk A→B is the same as B→A: reuse it instead of fetching again
    e = c[legKey(z, a, m)];
    if (!e) return null;
    e.u = now;
    return e.none ? e : { ...e, enc: undefined, path: [...pathOf(e)].reverse() };
  };
  const resolveLeg = async (a, z, mode, net) => {
    const key = legKey(a, z, mode), old = getLeg(a, z, mode);
    if (old && !old.at) old.at = Date.now();
    const fresh = old && Date.now() - old.at < TTL;
    let r = old && !old.none ? old : null; // stale data still beats an estimate
    if (!fresh && net && navigator.onLine && !miss.current.has(key)) {
      let f = null;
      try { f = await fetchLeg(await getRoute(), a, z, mode); } catch {}
      if (f === false) { cache.current[key] = { none: true, at: Date.now() }; dirty.current = true; r = null; }
      else if (f) { cache.current[key] = { ...f, at: Date.now() }; dirty.current = true; r = f; }
      else miss.current.add(key);
    }
    return r;
  };
  const persist = () => {
    const c = cache.current; if (!dirty.current) return;
    for (const e of Object.values(c)) if (e.path) { e.enc = encPoly(e.path); delete e.path; }
    for (let n = 0; n < 6; n++) { // if storage is full, drop the least recently used 30%
      try { localStorage.setItem(LEGS, JSON.stringify(c)); dirty.current = false; return; }
      catch { const ks = Object.keys(c).sort((x, y) => (c[x].u || c[x].at || 0) - (c[y].u || c[y].at || 0)); ks.slice(0, Math.ceil(ks.length * 0.3)).forEach((k) => delete c[k]); }
    }
  };
  const prepare = async () => { // download every missing route of the whole trip in one go (do this on Wi-Fi)
    if (!navigator.onLine) return say('Connect to the internet first');
    miss.current.clear();
    const jobs = [...new Map(trip.days.flatMap((d) => d.places.slice(0, -1).map((a, i) => { const z = d.places[i + 1], m = modeOf(d, a, z); return [legKey(a, z, m), { a, z, m }]; }))).values()];
    const todo = jobs.filter((j) => { const o = getLeg(j.a, j.z, j.m); return !(o && Date.now() - (o.at || 0) < TTL); });
    if (!todo.length) return say('All routes are already saved on this device');
    say(`Saving ${todo.length} route${todo.length > 1 ? 's' : ''}…`);
    const q = [...todo];
    await Promise.all(Array.from({ length: Math.min(4, q.length) }, async () => { while (q.length) { const j = q.shift(); await resolveLeg(j.a, j.z, j.m, true); } }));
    persist(); setRetry((n) => n + 1);
    const got = todo.filter((j) => { const o = getLeg(j.a, j.z, j.m); return o && Date.now() - (o.at || 0) < TTL; }).length;
    say(got === todo.length ? 'Trip saved for offline use' : `Saved ${got} of ${todo.length} routes — try again with a better connection`);
  };

  /* ---------- map ---------- */
  fitRef.current = () => {
    const m = map.current, b = bnd.current; if (!m || !b || !app.current) return;
    const mw = document.getElementById('map'); if (!mw || mw.offsetWidth < 60) return;
    const pad = desk ? { top: 72, left: 72, right: 72, bottom: 72 }
      : { top: 76, left: 36, right: 72, bottom: (app.current.querySelector('.pr.' + { peek: 'pk', half: 'hf', full: 'fl' }[snap])?.offsetHeight || 0) + 40 };
    m.fitBounds(b, pad);
  };
  useEffect(() => {
    if (!K || !s || map.current || busy.current || mapErr || !online || (ds && !wantMap)) return; // offline or data saver: don't spend data on the map
    busy.current = true;
    loadMaps().then(async () => {
      const { Map } = await google.maps.importLibrary('maps');
      map.current = new Map(document.getElementById('map'), { center: { lat: 42.5, lng: 12.5 }, zoom: 5, mapId: 'DEMO_MAP_ID', disableDefaultUI: true, zoomControl: false, gestureHandling: 'greedy', zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM } });
      info.current = new google.maps.InfoWindow();
      info.current.addListener('closeclick', () => { openId.current = null; });
      map.current.addListener('click', () => { info.current.close(); openId.current = null; });
      setReady(true);
    }).catch(() => { busy.current = false; setMapErr(true); });
  }, [!!s, wantMap, ds, online, mapTry]);
  useEffect(() => { map.current?.setOptions({ zoomControl: desk }); }, [desk, ready]);

  // markers
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    let dead = false;
    mk.current.forEach((o) => (o.map = null)); mk.current = [];
    info.current?.close(); openId.current = null;
    (async () => {
      const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');
      if (dead) return;
      const b = new google.maps.LatLngBounds();
      places.forEach((p, i) => {
        const pin = document.createElement('div'); pin.className = 'pin'; pin.textContent = i + 1;
        const mkr = new AdvancedMarkerElement({ map: m, position: { lat: p.lat, lng: p.lng }, content: pin, title: p.name });
        mkr.addListener('click', () => {
          if (openId.current === p.id) { info.current.close(); openId.current = null; return; } // second click hides
          const st = sRef.current, t = st.trips[st.cur], d = t.days[st.day] || t.days[0];
          const c = d.places.find((x) => x.id === p.id) || p, idx = d.places.findIndex((x) => x.id === p.id);
          const md = idx > 0 ? modeOf(d, d.places[idx - 1], c) : d.mode || 'WALKING';
          const meta = [c.time, c.cost > 0 ? t.cc + c.cost : ''].filter(Boolean).join(' · ');
          info.current.setContent(`<div class="iw" dir="auto"><b>${esc(c.name)}</b>${c.sub ? `<div class="isub">${esc(c.sub)}</div>` : ''}${c.addr ? `<div class="iad">${esc(c.addr)}</div>` : ''}${meta ? `<div class="imeta">${esc(meta)}</div>` : ''}${c.note ? `<div class="inote">${esc(c.note)}</div>` : ''}<a href="${gmaps(null, c, md)}" target="_blank" rel="noopener">Navigate</a></div>`);
          info.current.open({ map: m, anchor: mkr }); openId.current = p.id;
        });
        mk.current.push(mkr); b.extend({ lat: p.lat, lng: p.lng });
      });
      if (places.length === 1) { b.extend({ lat: places[0].lat + 0.004, lng: places[0].lng + 0.004 }); b.extend({ lat: places[0].lat - 0.004, lng: places[0].lng - 0.004 }); }
      bnd.current = places.length ? b : null;
      if (places.length) fitRef.current();
    })();
    return () => { dead = true; };
  }, [msig, ready]);

  // travel times: served from the on-device cache first; the network is only used for legs that are missing or older than TTL.
  // Works without the map, so saved times show offline and in data saver mode.
  useEffect(() => {
    let dead = false;
    const net = !ds || ready || forceFor.current === retry;
    const jobs = places.slice(0, -1).map((a, i) => ({ a, z: places[i + 1], mode: modes[i], key: legKey(a, places[i + 1], modes[i]) }));
    (async () => {
      const queue = [...jobs];
      await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
        while (queue.length && !dead) {
          const j = queue.shift(), r = (await resolveLeg(j.a, j.z, j.mode, net)) || est(j.a, j.z, j.mode);
          if (dead) return;
          setLegs((p) => ({ ...p, [j.key]: { d: r.d, t: r.t, est: !!r.est } }));
        }
      }));
      persist(); // paid-for results are saved even if this pass was superseded
    })();
    return () => { dead = true; };
  }, [rsig, retry, ds, ready, online]);

  // route lines: drawn from the cache (dashed straight line until a real route exists)
  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    pl.current.forEach((o) => o.setMap(null)); pl.current = [];
    places.slice(0, -1).forEach((a, i) => {
      const z = places[i + 1], mode = modes[i], e = getLeg(a, z, mode), p = e && !e.none ? pathOf(e) : [], real = p.length > 1;
      const path = real ? p : est(a, z, mode).path, col = MC[mode];
      pl.current.push(new google.maps.Polyline(!real || mode === 'WALKING'
        ? { map: m, path, strokeOpacity: 0, icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, strokeColor: col, scale: 3 }, offset: '0', repeat: '12px' }] }
        : { map: m, path, strokeColor: col, strokeWeight: 5, strokeOpacity: 0.85 }));
    });
    return () => { pl.current.forEach((o) => o.setMap(null)); pl.current = []; };
  }, [legs, ready, rsig]);

  // refit when layout changes
  useEffect(() => { if (!ready || (!desk && snap === 'full')) return; const t = setTimeout(() => fitRef.current(), 480); return () => clearTimeout(t); }, [snap, dsk, desk, ready]);
  useEffect(() => {
    const el = document.getElementById('map'); if (!el || !ready || !desk) return;
    let t; const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => fitRef.current(), 180); });
    ro.observe(el); return () => { ro.disconnect(); clearTimeout(t); };
  }, [ready, desk, !!s]);

  useEffect(() => {
    if (!live || !ready) { me.current?.setMap?.(null); me.current = null; return; }
    const id = navigator.geolocation.watchPosition(({ coords: c }) => {
      const pos = { lat: c.latitude, lng: c.longitude };
      if (!me.current) { me.current = new google.maps.Marker({ map: map.current, position: pos, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#2f7bd9', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 } }); map.current.panTo(pos); }
      else me.current.setPosition(pos);
    }, () => setLive(false), { enableHighAccuracy: true });
    return () => navigator.geolocation.clearWatch(id);
  }, [live, ready]);

  /* ---------- bottom-sheet drag (mobile) ---------- */
  const sheet = useRef(null);
  const onSheetDown = (e) => {
    if (desk || e.button > 0 || !e.target.closest('.grip,.top') || e.target.closest('button,select,a,input')) return;
    const full = panel.current.offsetHeight, rect = panel.current.getBoundingClientRect();
    const pr = (c) => app.current.querySelector('.pr.' + c).offsetHeight;
    sheet.current = { y0: e.clientY, v0: innerHeight - rect.top, min: pr('pk'), max: full, pts: [[performance.now(), e.clientY]], moved: false, snaps: { peek: pr('pk'), half: pr('hf'), full: pr('fl') }, tap: !!e.target.closest('.grip') };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onSheetMove = (e) => {
    const g = sheet.current; if (!g) return;
    const dy = g.y0 - e.clientY; if (!g.moved && Math.abs(dy) < 5) return;
    if (!g.moved) { g.moved = true; app.current.dataset.drag = ''; }
    let v = g.v0 + dy; if (v > g.max) v = g.max + band(v - g.max, 220); if (v < g.min) v = g.min - band(g.min - v, 220);
    g.pts.push([performance.now(), e.clientY]); if (g.pts.length > 6) g.pts.shift();
    app.current.style.setProperty('--vis', v + 'px'); g.v = v;
  };
  const onSheetUp = () => {
    const g = sheet.current; sheet.current = null; if (!g) return;
    delete app.current.dataset.drag;
    if (!g.moved) { delete app.current.dataset.fling; g.tap && tick(6); g.tap && setSnap((x) => (x === 'peek' ? 'half' : x === 'half' ? 'full' : 'peek')); return; }
    const [t0, y0] = g.pts[0], [t1, y1] = g.pts.at(-1), vel = t1 > t0 ? (y0 - y1) / (t1 - t0) * 1000 : 0; // px/s, up positive
    const proj = Math.max(g.min, Math.min(g.max, g.v + project(vel)));
    const best = Object.entries(g.snaps).sort((a, b) => Math.abs(a[1] - proj) - Math.abs(b[1] - proj))[0][0];
    app.current.style.removeProperty('--vis');
    const el = app.current;
    if (Math.abs(vel) > 600) { el.dataset.fling = ''; setTimeout(() => delete el.dataset.fling, 750); } else delete el.dataset.fling;
    if (best !== snap) tick();
    setSnap(best);
  };

  /* ---------- desktop resizer ---------- */
  const onRzDown = (e) => { e.currentTarget.setPointerCapture(e.pointerId); app.current.dataset.drag = ''; e.currentTarget.dataset.on = '1'; };
  const onRzMove = (e) => { if (e.currentTarget.dataset.on) setPw(Math.round(Math.max(340, Math.min(720, e.clientX)))); };
  const onRzUp = (e) => { delete e.currentTarget.dataset.on; delete app.current.dataset.drag; };

  if (!s) return null;
  const legList = places.slice(0, -1).map((a, i) => legs[legKey(a, places[i + 1], modes[i])]);
  const total = legList.reduce((a, l) => a + (l?.t || 0), 0);
  const cost = places.reduce((a, p) => a + (+p.cost || 0), 0);
  const share = () => {
    const u = gmaps(places[0], places.at(-1), day.mode || 'WALKING') + (places.length > 2 ? `&waypoints=${places.slice(1, -1).map(ll).join('|')}` : '');
    navigator.share ? navigator.share({ title: `${trip.name} · Day ${s.day + 1}`, url: u }).catch(() => {}) : navigator.clipboard.writeText(u).then(() => say('Link copied'));
  };
  const hits = q.trim() ? trip.days.flatMap((d, di) => d.places.map((p, pi) => ({ p, di, pi }))).filter(({ p }) => {
    const n = q.trim().toLowerCase().replace(/^#/, ''); return [p.name, p.sub, p.addr, p.note, ...tagsOf(p)].join(' ').toLowerCase().includes(n);
  }) : null;
  const backup = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(s)], { type: 'application/json' })); a.download = 'viaggio-backup.json'; a.click(); };
  const restore = async (e) => { try { const d = JSON.parse(await e.target.files[0].text()); if (Array.isArray(d.trips)) { setS(norm({ ...d, ts: Date.now() })); say('Backup restored'); } else throw 0; } catch { say('Invalid file'); } };
  const signIn = () => watchAuth().then(() => fb()).then(({ A: Au, auth }) => {
    const prov = new Au.GoogleAuthProvider(), R = Au.browserPopupRedirectResolver;
    // popups are unreliable on phones: fall back to a full-page redirect
    return Au.signInWithPopup(auth, prov, R).catch((e) => /popup-blocked|operation-not-supported|web-storage-unsupported/.test(e?.code || '') ? Au.signInWithRedirect(auth, prov, R) : Promise.reject(e));
  }).then(() => localStorage.setItem(SYNC, '1')).catch((e) => { if (!/popup-closed|cancelled/.test(e?.code || '')) say('Sign-in failed' + (e?.code ? ': ' + e.code.replace('auth/', '') : '')); });
  const signOut = () => fb().then(({ A: Au, auth }) => Au.signOut(auth)).then(() => { localStorage.removeItem(SYNC); setUser(null); }).catch(() => {});
  const showOn = (p) => { if (!map.current) return; map.current.panTo(p); map.current.setZoom(15); if (!desk) setSnap('peek'); else if (dsk === 'list') setDsk('split'); };
  const hasTabs = (view === 'plan' && !hits) || view === 'notes';
  const peekOrList = snap === 'peek';
  const tm = ns === 'trip', sc = tm ? 'trip' : Math.min(s.day, trip.days.length - 1);
  const nobj = sc === 'trip' ? trip : trip.days[sc];
  const upN = (fn) => up((c, t) => fn(sc === 'trip' ? t : t.days[c.day]));
  const delTask = (t) => confirmDel('Delete task?', t.text, 'Delete', 'Task deleted', () => upN((o) => { o.todos = o.todos.filter((x) => x.id !== t.id); }));
  const moveDay = (dir) => up((c, t) => { const i = c.day, j = i + dir; if (j >= 0 && j < t.days.length) { t.days.splice(j, 0, t.days.splice(i, 1)[0]); c.day = j; } });
  const removeDay = () => {
    if (trip.days.length < 2) return say('A trip needs at least one day');
    const rm = () => up((c, t) => { t.days.splice(c.day, 1); c.day = Math.max(0, c.day - 1); });
    confirmDel(`Remove Day ${s.day + 1}${day.title ? ' · ' + day.title : ''}?`, 'Its stops, notes and tasks will be deleted.', 'Remove', 'Day removed', rm);
  };

  const ViewSwitch = () => <div className="vs" role="group" aria-label="Layout">{[['list', 'list', 'List'], ['split', 'split', 'Split'], ['map', 'map', 'Map']].map(([k, ic, l]) => <button key={k} aria-pressed={dsk === k} aria-label={l} title={l} onClick={() => setDsk(k)}><Ic n={ic} /></button>)}</div>;

  const leg = (a, z, i) => {
    const md = modes[i], L = legList[i], lk = a.id + '>' + z.id;
    return <div className="leg" style={{ '--mc': MC[md] }}>
      <span />
      <div className="lgc">
        <div className="lm" role="group" aria-label="Travel mode">{Object.keys(MODES).map((k) => <button key={k} aria-pressed={md === k} aria-label={MODES[k]} title={MODES[k]} onClick={() => up((_, __, d) => { d.lm ||= {}; if (k === (d.mode || 'WALKING')) delete d.lm[lk]; else d.lm[lk] = k; })}><Ic n={MI[k]} s={18} /></button>)}</div>
        <span className="lt">{L ? <>{L.est && '~'}<b>{fmt(L.t)}</b> · {km(L.d)}</> : <i className="sk" />}</span>
        {L?.est && <button className="ib" onClick={retryLegs} aria-label="Estimate only — retry" title="Estimate only — retry"><Ic n="retry" s={18} /></button>}
        <a className="ib" href={gmaps(a, z, md)} target="_blank" rel="noopener" aria-label="Navigate this leg"><Ic n="nav" s={18} /></a>
      </div>
    </div>;
  };

  const backupCard = (p) => <div className="card" key={p.id} style={{ marginBottom: 8 }}><div className="pl" style={{ alignItems: 'center' }}><div className="main" style={{ cursor: 'default' }}><b {...A(p.name)} className="bd">{p.name}</b><small {...A(p.sub || p.addr)}>{p.sub || p.addr}</small></div>
    <a className="ib navme" href={gmaps(null, p, 'WALKING')} target="_blank" rel="noopener" aria-label="Navigate from current location" title="Navigate from current location"><Ic n="loc" s={18} /></a>
    <button className="ghost" style={{ margin: '8px 0' }} onClick={() => toRoute(p.id)}>+ Route</button>
    <button className="ib" onClick={() => confirmDel('Remove from Backup ideas?', p.name, 'Remove', 'Place removed', () => up((_, __, d) => { d.alt = (d.alt || []).filter((w) => w.id !== p.id); }))} aria-label="Delete"><Ic n="x" /></button></div></div>;

  const wishCard = (p) => <div className="card" key={p.id} style={{ marginBottom: 8 }}><div className="pl" style={{ alignItems: 'center' }}><div className="main" style={{ cursor: 'default' }}><b {...A(p.name)} className="bd">{p.name}</b><small {...A(p.addr)}>{p.addr}</small></div>
    <a className="ib navme" href={gmaps(null, p, 'WALKING')} target="_blank" rel="noopener" aria-label="Navigate from current location" title="Navigate from current location"><Ic n="loc" s={18} /></a>
    <button className="ghost" style={{ margin: '8px 0' }} onClick={() => addToDay({ ...p, id: uid() })}>+ Day {s.day + 1}</button>
    <button className="ib" onClick={() => confirmDel('Remove location?', p.name, 'Remove', 'Location removed', () => up((_, t) => { t.wish = t.wish.filter((w) => w.id !== p.id); }))} aria-label="Delete"><Ic n="x" /></button></div></div>;

  const stop = (p, i) => (
    <div className={'card' + (drag === i ? ' drag' : '')} draggable={desk && open !== p.id} onDragStart={() => setDrag(i)} onDragEnd={() => setDrag(null)} onDragOver={(e) => e.preventDefault()} onDrop={() => drag !== null && move(drag, i)}>
      <div className="pl st">
        <div className="main" onClick={() => setOpen(open === p.id ? null : p.id)}>
          {p.time && <span className="tm">{p.time}</span>}
          <b {...A(p.name)} className="bd">{p.name}</b>
          {p.sub && <span {...A(p.sub)} className="sub bd">{p.sub}</span>}
          {p.cost > 0 && <small className="meta">{trip.cc}{p.cost}</small>}
        </div>
        <button className="ib mv" aria-label="Move up" disabled={i === 0} onClick={(e) => { e.stopPropagation(); move(i, i - 1); }}><Ic n="up" s={18} /></button>
        <button className="ib mv" aria-label="Move down" disabled={i === places.length - 1} onClick={(e) => { e.stopPropagation(); move(i, i + 1); }}><Ic n="down" s={18} /></button>
        <a className="ib navme" href={gmaps(null, p, i > 0 ? modes[i - 1] : day.mode || 'WALKING')} target="_blank" rel="noopener" aria-label="Navigate from current location" title="Navigate from current location" onClick={(e) => e.stopPropagation()}><Ic n="loc" s={18} /></a>
        <button className="ib chev" aria-expanded={open === p.id} aria-label="Edit stop" onClick={() => setOpen(open === p.id ? null : p.id)}><Ic n="chev" /></button>
      </div>
      {open === p.id && <div className="det">
        <label className="fld"><span className="lbl">Notes · shown on the map · use #tags</span><textarea {...A(p.note)} rows="3" value={p.note} onChange={(e) => patch(i, 'note', e.target.value)} /></label>
        <div className="acts">
          <button className="act" onClick={() => move(i, i - 1)} disabled={i === 0}><Ic n="up" />Up</button>
          <button className="act" onClick={() => move(i, i + 1)} disabled={i === places.length - 1}><Ic n="down" />Down</button>
          <button className="act" onClick={() => showOn(p)}><Ic n="pin" />On map</button>
          <button className="act" onClick={() => { up((_, t) => { t.wish.push({ ...p, id: uid() }); }); say('Saved to Travel locations'); }}><Ic n="heart" />Save</button>
          <button className="act" onClick={() => toBackup(i)}><Ic n="box" />Backup</button>
          <button className="act danger" onClick={() => confirmDel('Remove stop?', p.name, 'Remove', 'Stop removed', () => up((_, __, d) => { d.places.splice(i, 1); }))}><Ic n="trash" />Remove</button>
        </div>
        <label className="fld"><span className="lbl">Text under the name</span><input {...A(p.sub)} maxLength={200} value={p.sub || ''} placeholder="e.g. Book tickets ahead" onChange={(e) => patch(i, 'sub', e.target.value)} /></label>
        <div className="fld"><span className="lbl">Time</span><Chips opts={['09:00', '12:30', '15:00', '19:30']} val={p.time} on={(v) => patch(i, 'time', p.time === v ? '' : v)} /><input type="time" value={p.time} onChange={(e) => patch(i, 'time', e.target.value)} aria-label="Time" /></div>
        <label className="fld"><span className="lbl">Budget</span>
          <div className="step"><i>{trip.cc}</i><input type="number" inputMode="decimal" min="0" value={p.cost} onChange={(e) => patch(i, 'cost', +e.target.value)} /><button onClick={() => patch(i, 'cost', Math.max(0, +p.cost - 10))} aria-label="Less">−</button><button onClick={() => patch(i, 'cost', +p.cost + 10)} aria-label="More">+</button></div>
        </label>
        <div className="fld"><span className="lbl">Category</span><Chips opts={CATS} val={p.cat} on={(v) => patch(i, 'cat', v)} /></div>
      </div>}
    </div>
  );

  return (
    <main className="app" ref={app} data-snap={snap} data-dsk={dsk} data-tabs={hasTabs}>
      <div className="mapw">
        {ok && !mapNote ? <div id="map" /> : ok ? <div className="nomap"><div><p>{mapNote}</p>{mapBtn && <button className="btn" onClick={loadMapNow}>{mapBtn}</button>}</div></div> : <div className="nomap"><p>Map unavailable.<br />Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY or go online — your itinerary still works.</p></div>}
        {dsk === 'map' && <div className="vsw-float desk-only"><ViewSwitch /></div>}
        {ok && <div className="fabs">
          <button className="fab" aria-label="Fit route" onClick={() => fitRef.current()}><Ic n="fit" /></button>
          <button className="fab" aria-label="Live location" aria-pressed={live} onClick={() => setLive(!live)}><Ic n="loc" /></button>
        </div>}
      </div>
      <i className="pr pk" /><i className="pr hf" /><i className="pr fl" />
      <div className="rz desk-only" role="separator" aria-orientation="vertical" aria-label="Resize panel" tabIndex={0} onPointerDown={onRzDown} onPointerMove={onRzMove} onPointerUp={onRzUp} onPointerCancel={onRzUp} onDoubleClick={() => setPw(440)} onKeyDown={(e) => { if (e.key === 'ArrowLeft') setPw((w) => Math.max(340, w - 24)); if (e.key === 'ArrowRight') setPw((w) => Math.min(720, w + 24)); }} />
      <style>{`.app{--pw:${pw}px}`}</style>
      <section className="panel" ref={panel}>
        <div className="head" onPointerDown={onSheetDown} onPointerMove={onSheetMove} onPointerUp={onSheetUp} onPointerCancel={onSheetUp}>
          <div className="grip mob-only"><i /></div>
          <div className="top">
            <label className="ttl"><select aria-label="Trip" value={s.cur} onChange={(e) => up((c) => { c.cur = +e.target.value; c.day = 0; })}>{s.trips.map((t, i) => <option key={t.id} value={i}>{t.name}</option>)}</select><Ic n="chev" s={18} /></label>
            {ok && <button className="ib fill mob-only" onClick={() => setSnap(peekOrList ? 'half' : 'peek')} aria-label={peekOrList ? 'Show itinerary' : 'Show map'}><Ic n={peekOrList ? 'list' : 'map'} /></button>}
            {ok && <div className="desk-only"><ViewSwitch /></div>}
            <button className="ib fill" onClick={() => setDlg({ title: 'New trip', input: '', ph: 'e.g. Rome', label: 'Create', ok: (n) => up((c) => { c.trips.push(newTrip(n)); c.cur = c.trips.length - 1; c.day = 0; }) })} aria-label="New trip"><Ic n="plus" /></button>
          </div>
          {hasTabs && <div className="tabs" role="tablist">
            <button role="tab" className="tab" aria-selected={tm} onClick={() => setNs('trip')}><Ic n="pin" s={16} />Travel</button>
            {trip.days.map((d, i) => <button key={d.id} role="tab" className="tab" aria-selected={!tm && i === s.day} onClick={() => { setNs('day'); up((c) => { c.day = i; }); }}>Day {i + 1}</button>)}
            <button className="tab" onClick={() => { setNs('day'); up((c, t) => { t.days.push(newDay()); c.day = t.days.length - 1; }); }}><Ic n="plus" s={16} />Day</button>
          </div>}
        </div>

        <div className="body"><div className="wrap">
          {!online && <div className="off">Offline — itinerary and saved routes available</div>}
          {hasTabs && (tm ? <h1 className="dtl">Travel locations</h1> : <input key={day.id} className="dtl" {...A(day.title)} maxLength={80} value={day.title || ''} placeholder={`Day ${s.day + 1}`} aria-label="Day title" enterKeyHint="done" onChange={(e) => up((_, __, d) => { d.title = e.target.value; })} />)}
          <div className="seg">{[['plan', 'Plan'], ['notes', 'Notes'], ['more', 'More']].map(([k, v]) => <button key={k} aria-pressed={view === k} onClick={() => setView(k)}>{v}</button>)}</div>

          {view === 'plan' && <div key={'plan:' + sc}>
            <div className="find"><Ic n="search" /><input {...A(q)} placeholder="Filter stops or #tags…" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" /></div>
            {hits ? <>
              {hits.map(({ p, di, pi }) => <div className="card" key={p.id} onClick={() => { setNs('day'); up((c) => { c.day = di; }); setQ(''); }} style={{ cursor: 'pointer', marginBottom: 8 }}><div className="main"><b {...A(p.name)} className="bd">{p.name}</b><small>Day {di + 1} · stop {pi + 1}{p.sub ? ' · ' + p.sub : ''}</small></div></div>)}
              {!hits.length && <p className="sum">No matches.</p>}
            </> : <>
              {tm ? <>
                <h2 className="sec" style={{ marginTop: 6 }}>Travel locations</h2>
                {ok && <Search onPick={addPlace} />}
                <div style={{ height: 14 }} />
                {!trip.wish.length && <p className="sum">General places for the whole trip. Search above, or save a stop from its edit panel.</p>}
                {trip.wish.map(wishCard)}
              </> : <>
              <div className="row tr" style={{ justifyContent: 'flex-end' }}>
                <button className="ib fill" onClick={refreshLegs} aria-label="Recalculate travel times" title="Recalculate travel times"><Ic n="retry" /></button>
                <div className="menuw">
                  <button className="ib fill" aria-label="Day options" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}><Ic n="dots" /></button>
                  {menu && <>
                    <div className="mclose" onClick={() => setMenu(false)} />
                    <div className="menu" role="menu">
                      <button role="menuitem" disabled={s.day === 0} onClick={() => { moveDay(-1); setMenu(false); }}><Ic n="left" />Move day earlier</button>
                      <button role="menuitem" disabled={s.day === trip.days.length - 1} onClick={() => { moveDay(1); setMenu(false); }}><Ic n="right" />Move day later</button>
                      <button role="menuitem" className="danger" onClick={() => { setMenu(false); removeDay(); }}><Ic n="trash" />Remove day</button>
                    </div>
                  </>}
                </div>
              </div>
              <div className="stats"><div className="stat"><b>{places.length}</b><small>stops</small></div><div className="stat"><b>{total ? '~' + fmt(total) : '—'}</b><small>travel time</small></div><div className="stat"><b>{trip.cc}{cost}</b><small>budget</small></div></div>
              {ok && <Search onPick={addPlace} />}
              <div style={{ height: 14 }} />
              {!places.length && <div className="empty">No stops for Day {s.day + 1} yet.<br />Search a place above, or tap + to add one.</div>}
              <div className="tl">{places.map((p, i) => <Fragment key={p.id}>
                <div className={'stop' + (i === places.length - 1 ? ' last' : '')}>
                  <button className="node" onClick={() => showOn(p)} aria-label={`Show ${p.name} on map`}><span className="n">{i + 1}</span></button>
                  {stop(p, i)}
                </div>
                {i < places.length - 1 && leg(p, places[i + 1], i)}
              </Fragment>)}</div>
              {places.length > 1 && <button className="btn full" style={{ marginTop: 18 }} onClick={share}><Ic n="share" />Share day in Google Maps</button>}
              <h2 className="sec">Backup ideas</h2>
              <p className="sum">Other options for Day {s.day + 1} that aren’t in the route. Move any stop here from its edit panel, or add one with “+ Route”.</p>
              {(day.alt || []).map(backupCard)}
              {ok && <button className="ghost" style={{ marginTop: 4 }} onClick={() => setAdding('alt')}><Ic n="plus" s={18} />Add a backup place</button>}
              <h2 className="sec">Travel locations · wish list</h2>
              {!trip.wish.length && <p className="sum">Saved places for the whole trip appear on every day. Save a stop from its edit panel.</p>}
              {trip.wish.map(wishCard)}
              </>}
            </>}
          </div>}

          {view === 'notes' && <div key={'notes:' + sc}>
            <h2 className="sec" style={{ marginTop: 6 }}>{tm ? 'Travel notes · whole trip' : `Day ${sc + 1}${nobj.title ? ' · ' + nobj.title : ''} notes`}</h2>
            <textarea key={nobj.id} {...A(nobj.notes)} rows="7" placeholder={tm ? 'Bookings, reminders, phrases… use #tags' : 'Plans, reservations, reminders for this day…'} value={nobj.notes} onChange={(e) => upN((o) => { o.notes = e.target.value; })} />
            <h2 className="sec">To-do</h2>
            <Todos key={nobj.id} items={nobj.todos} set={(fn) => upN((o) => { o.todos = fn(o.todos); })} del={delTask} />
          </div>}

          {view === 'more' && <div key="more">
            <h2 className="sec" style={{ marginTop: 6 }}>Account sync</h2>
            {!FB.apiKey ? <p className="sum">Firebase not configured — see README. Data is stored on this device only.</p> : user
              ? <div className="row"><span className="sum" style={{ margin: 0, flex: 1 }}>Synced as {user.email}</span><button className="ghost" onClick={signOut}>Sign out</button></div>
              : <button className="btn full" onClick={signIn}>Sign in with Google to sync</button>}
            <h2 className="sec">Data and offline</h2>
            <div className="fld"><span className="lbl">Data saver</span><Chips opts={['On', 'Off']} val={ds ? 'On' : 'Off'} on={(v) => setDsPref(v === 'On')} /></div>
            <p className="sum">{ds ? 'The map and new route lookups wait until you ask. Your itinerary and saved routes work without data.' : 'The map loads automatically. Routes are saved on this device and reused, never recalculated.'}</p>
            <div className="row"><button className="ghost" onClick={prepare}>Save trip routes for offline</button></div>
            <h2 className="sec">Trip</h2>
            <div className="fld"><span className="lbl">Currency</span><Chips opts={['€', '$', '£', '₪']} val={trip.cc} on={(v) => up((_, t) => { t.cc = v; })} /></div>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="ghost" onClick={() => up((c) => { c.theme = c.theme === 'dark' ? 'light' : 'dark'; })}><Ic n="moon" />{s.theme === 'dark' ? 'Light theme' : 'Dark theme'}</button>
              <button className="ghost danger" onClick={() => s.trips.length > 1 ? confirmDel(`Delete “${trip.name}”?`, 'This removes all its days, notes and tasks.', 'Delete', 'Trip deleted', () => up((c) => { c.trips.splice(c.cur, 1); c.cur = 0; c.day = 0; })) : say('Keep at least one trip')}><Ic n="trash" />Delete trip</button>
            </div>
            <h2 className="sec">Backup</h2>
            <div className="row"><button className="ghost" onClick={backup}>Export JSON</button><label className="ghost">Import JSON<input type="file" accept="application/json" onChange={restore} hidden /></label></div>
          </div>}
        </div></div>
      </section>
      {ok && <button className="addfab" aria-label={`Add a place to ${tm ? 'Travel locations' : 'Day ' + (s.day + 1)}`} onClick={() => setAdding(true)}><Ic n="plus" s={26} /></button>}
      {toast && <div className="toast" role="status" key={toast.msg}>{toast.msg}{toast.act && <button onClick={() => { toast.fn(); setToast(null); }}>{toast.act}</button>}</div>}
      {upd && <div className="toast" role="status" style={{ top: 'calc(var(--top) + 68px)' }}>New version available<button onClick={() => location.reload()}>Reload</button><button aria-label="Later" style={{ background: 'none', color: 'inherit', padding: 0, width: 36 }} onClick={() => { updSkip.current = true; setUpd(false); }}><Ic n="x" s={16} /></button></div>}
      {dlg && <Dialog d={dlg} close={() => setDlg(null)} />}
      {adding && <AddDlg label={adding === 'alt' ? `Day ${s.day + 1} backup ideas` : tm ? 'Travel locations' : `Day ${s.day + 1}`} onPick={adding === 'alt' ? addAlt : addPlace} close={() => setAdding(false)} />}
    </main>
  );
}
