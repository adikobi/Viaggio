'use client';
import { useEffect, useRef, useState } from 'react';
const KEY = 'viaggio.v1', LEGS = 'viaggio.legs', UI = 'viaggio.ui', K = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const FB = { apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID };
const uid = () => Math.random().toString(36).slice(2, 9);
const CATS = ['Sightseeing', 'Food', 'Lodging', 'Transport', 'Shopping', 'Other'];
const MODES = { DRIVING: 'Drive', WALKING: 'Walk', TRANSIT: 'Transit' };
const newTrip = (name) => ({ id: uid(), name, cc: '€', notes: '', todos: [], days: [{ id: uid(), places: [] }], wish: [] });
const fmt = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`);
const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const ll = (p) => `${p.lat},${p.lng}`;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const A = (t) => ({ dir: 'auto', lang: /[\u0590-\u05FF]/.test(t || '') ? 'he' : undefined });
const tagsOf = (p) => [...new Set([p.cat.toLowerCase(), ...((p.note || '').match(/#[\p{L}\p{N}_]+/gu) || []).map((t) => t.slice(1).toLowerCase())])];
const gmaps = (o, d, m) => `https://www.google.com/maps/dir/?api=1${o ? '&origin=' + ll(o) : ''}&destination=${ll(d)}&travelmode=${m.toLowerCase()}`;
let mapsP, fbP;
const loadMaps = () => (mapsP ||= new Promise((res, rej) => {
  if (window.google?.maps) return res();
  window.__gm = res;
  const s = document.createElement('script');
  s.src = `https://maps.googleapis.com/maps/api/js?key=${K}&v=weekly&loading=async&callback=__gm`;
  s.onerror = () => { mapsP = null; rej(); }; document.head.append(s);
}));
const fb = () => (fbP ||= Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]).then(([a, Au, F]) => { const app = a.initializeApp(FB); return { A: Au, F, auth: Au.getAuth(app), db: F.getFirestore(app) }; }));

const P = {
  nav: 'M3 11l18-8-8 18-2-8-8-2z', up: 'M12 19V5M5 12l7-7 7 7', down: 'M12 5v14M19 12l-7 7-7-7', heart: 'M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z',
  x: 'M6 6l12 12M18 6L6 18', plus: 'M12 5v14M5 12h14', chev: 'M6 9l6 6 6-6', loc: 'M12 2v3M12 19v3M2 12h3M19 12h3M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14', list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  split: 'M3 5h18v14H3zM10 5v14', trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', share: 'M12 15V3M7 8l5-5 5 5M5 13v7h14v-7', pin: 'M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12zM12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 1 0 0-14M20 20l-4-4', left: 'M15 6l-6 6 6 6', right: 'M9 6l6 6-6 6', moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  car: 'M5 16V11l2-5h10l2 5v5M3 16h18M7.5 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 1 0 0 3M16.5 19.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 1 0 0 3', walk: 'M13 4.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 1 0 0 3M10 22l2-7-3-3 1-5 3 3 3 1M9 12l-3 2',
  bus: 'M5 4h14v13H5zM5 11h14M8 20v-3M16 20v-3',
};
const Ic = ({ n, s = 20 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[n]} /></svg>;
const MI = { DRIVING: 'car', WALKING: 'walk', TRANSIT: 'bus' };

function Search({ onPick }) {
  const box = useRef(), cb = useRef(); cb.current = onPick;
  useEffect(() => {
    let dead;
    loadMaps().then(async () => {
      const { PlaceAutocompleteElement } = await google.maps.importLibrary('places');
      if (dead) return;
      const el = new PlaceAutocompleteElement();
      el.addEventListener('gmp-select', async ({ placePrediction }) => {
        const p = placePrediction.toPlace();
        await p.fetchFields({ fields: ['displayName', 'formattedAddress', 'location', 'id'] });
        cb.current({ id: uid(), name: p.displayName, addr: p.formattedAddress, lat: p.location.lat(), lng: p.location.lng(), pid: p.id, cat: 'Sightseeing', time: '', dur: 60, cost: 0, note: '' });
      });
      box.current.replaceChildren(el);
    }).catch(() => {});
    return () => { dead = true; };
  }, []);
  return <div ref={box} className="srch" />;
}

const Chips = ({ opts, val, on, f = (x) => x }) => <div className="chips">{opts.map((o) => <button key={o} className="chip" aria-pressed={val === o} onClick={() => on(o)}>{f(o)}</button>)}</div>;

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

const useMedia = (q) => { const [m, setM] = useState(false); useEffect(() => { const x = matchMedia(q), f = () => setM(x.matches); f(); x.addEventListener('change', f); return () => x.removeEventListener('change', f); }, [q]); return m; };

export default function Page() {
  const [s, setS] = useState(null);
  const [mode, setMode] = useState('DRIVING');
  const [legs, setLegs] = useState([]);
  const [open, setOpen] = useState(null);
  const [drag, setDrag] = useState(null);
  const [ok, setOk] = useState(!!K);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState('plan');
  const [q, setQ] = useState('');
  const [online, setOnline] = useState(true);
  const [user, setUser] = useState(null);
  const [live, setLive] = useState(false);
  const [snap, setSnap] = useState('half');
  const [dsk, setDsk] = useState('split');
  const [pw, setPw] = useState(440);
  const [toast, setToast] = useState(null);
  const [dlg, setDlg] = useState(null);
  const desk = useMedia('(min-width:900px)');
  const map = useRef(), ov = useRef([]), cache = useRef({}), info = useRef(), sRef = useRef(), remote = useRef(0), me = useRef();
  const app = useRef(), panel = useRef(), bnd = useRef(), fitRef = useRef(), uiLoaded = useRef(false);
  sRef.current = s;

  useEffect(() => {
    let v = null;
    try { v = JSON.parse(localStorage.getItem(KEY)); cache.current = JSON.parse(localStorage.getItem(LEGS)) || {}; } catch {}
    try { const u = JSON.parse(localStorage.getItem(UI)); if (u) { u.snap && setSnap(u.snap); u.dsk && setDsk(u.dsk); u.pw && setPw(u.pw); } } catch {}
    uiLoaded.current = true;
    if (v) { v.ts ||= 1; v.trips.forEach((t) => { t.notes ??= ''; t.todos ??= []; t.cc ??= '€'; }); }
    setS(v || { ts: 0, trips: [newTrip('Italy')], cur: 0, day: 0, theme: matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light' });
    navigator.serviceWorker?.register(`${process.env.NEXT_PUBLIC_BASE_PATH}/sw.js`).catch(() => {});
    const f = () => setOnline(navigator.onLine); f(); addEventListener('online', f); addEventListener('offline', f);
    if (FB.apiKey) fb().then(({ A: Au, auth }) => Au.onAuthStateChanged(auth, setUser));
  }, []);
  useEffect(() => { if (s) { localStorage.setItem(KEY, JSON.stringify(s)); document.documentElement.dataset.theme = s.theme; } }, [s]);
  useEffect(() => { if (uiLoaded.current) try { localStorage.setItem(UI, JSON.stringify({ snap, dsk, pw })); } catch {} }, [snap, dsk, pw]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t); }, [toast]);

  useEffect(() => {
    if (!user) return; let off;
    fb().then(({ F, db }) => { off = F.onSnapshot(F.doc(db, 'users', user.uid), (snapd) => { const d = snapd.data(); if (d && d.ts > (sRef.current.ts || 0)) { remote.current = d.ts; setS(JSON.parse(d.json)); } }); });
    return () => off?.();
  }, [user]);
  useEffect(() => {
    if (!user || !s || !(s.ts > remote.current)) return;
    const t = setTimeout(() => fb().then(({ F, db }) => { remote.current = s.ts; F.setDoc(F.doc(db, 'users', user.uid), { json: JSON.stringify(s), ts: s.ts }); }), 800);
    return () => clearTimeout(t);
  }, [s, user]);

  const trip = s?.trips[s.cur], places = (trip?.days[s.day] || trip?.days[0])?.places || [];
  const up = (fn) => setS((x) => { const c = structuredClone(x); const t = c.trips[c.cur]; c.day = Math.min(c.day, t.days.length - 1); fn(c, t, t.days[c.day]); c.ts = Date.now(); return c; });
  const patch = (i, k, v) => up((_, __, d) => { d.places[i][k] = v; });
  const move = (a, b) => up((_, __, d) => { if (b >= 0 && b < d.places.length) d.places.splice(b, 0, d.places.splice(a, 1)[0]); });
  const say = (msg, act, fn) => setToast({ msg, act, fn });
  const undoable = (msg, fn) => { const prev = sRef.current; fn(); say(msg, 'Undo', () => setS({ ...prev, ts: Date.now() })); };

  /* ---------- map ---------- */
  fitRef.current = () => {
    const m = map.current, b = bnd.current; if (!m || !b || !app.current) return;
    const mw = document.getElementById('map'); if (!mw || mw.offsetWidth < 60) return;
    const pad = desk ? { top: 72, left: 72, right: 72, bottom: 72 }
      : { top: 76, left: 36, right: 36, bottom: (app.current.querySelector('.pr.' + { peek: 'pk', half: 'hf', full: 'fl' }[snap])?.offsetHeight || 0) + 40 };
    m.fitBounds(b, pad);
  };
  useEffect(() => {
    if (!K || !s || map.current) return;
    loadMaps().then(async () => {
      const { Map } = await google.maps.importLibrary('maps');
      map.current = new Map(document.getElementById('map'), { center: { lat: 42.5, lng: 12.5 }, zoom: 5, mapId: 'DEMO_MAP_ID', disableDefaultUI: true, zoomControl: false, gestureHandling: 'greedy', zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_BOTTOM } });
      info.current = new google.maps.InfoWindow(); setReady(true);
    }).catch(() => setOk(false));
  }, [!!s]);
  useEffect(() => { map.current?.setOptions({ zoomControl: desk }); }, [desk, ready]);

  useEffect(() => {
    const m = map.current; if (!m || !ready) return;
    let dead = false;
    ov.current.forEach((o) => (o.setMap ? o.setMap(null) : (o.map = null))); ov.current = [];
    (async () => {
      const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');
      const { Route } = await google.maps.importLibrary('routes');
      if (dead) return;
      const b = new google.maps.LatLngBounds();
      places.forEach((p, i) => {
        const pin = document.createElement('div'); pin.className = 'pin'; pin.innerHTML = `<span>${i + 1}</span>`;
        const mk = new AdvancedMarkerElement({ map: m, position: p, content: pin, title: p.name });
        mk.addListener('click', () => { info.current.setContent(`<div class="iw" dir="auto"><b>${esc(p.name)}</b><br>${esc(p.addr || '')}<br>${p.time || ''} ${fmt(p.dur || 0)} · ${p.cat}${p.note ? '<br><i>' + esc(p.note) + '</i>' : ''}<br><a href="${gmaps(null, p, mode)}" target="_blank" rel="noopener">Navigate ➤</a></div>`); info.current.open({ map: m, anchor: mk }); });
        ov.current.push(mk); b.extend(p);
      });
      if (places.length === 1) { b.extend({ lat: places[0].lat + 0.004, lng: places[0].lng + 0.004 }); b.extend({ lat: places[0].lat - 0.004, lng: places[0].lng - 0.004 }); }
      bnd.current = places.length ? b : null;
      if (places.length) fitRef.current();
      const out = [];
      for (let i = 0; i < places.length - 1; i++) {
        const a = places[i], z = places[i + 1], key = mode + ll(a) + '>' + ll(z);
        let r = cache.current[key];
        if (!r && navigator.onLine) try {
          const { routes } = await Route.computeRoutes({ origin: { lat: a.lat, lng: a.lng }, destination: { lat: z.lat, lng: z.lng }, travelMode: mode, fields: ['path', 'distanceMeters', 'durationMillis'] });
          const rt = routes[0]; r = cache.current[key] = { d: rt.distanceMeters, t: Math.round(rt.durationMillis / 60000), path: rt.path.map((p) => ({ lat: p.lat, lng: p.lng })) };
          try { localStorage.setItem(LEGS, JSON.stringify(cache.current)); } catch {}
        } catch {}
        out.push(r ? { d: r.d, t: r.t } : null);
        if (r && !dead) ov.current.push(new google.maps.Polyline({ map: m, path: r.path, strokeColor: '#b34a26', strokeWeight: 5, strokeOpacity: .85 }));
      }
      if (!dead) setLegs(out);
    })();
    return () => { dead = true; };
  }, [places.map((p) => p.id + p.name).join(), mode, ready]);

  // refit when layout changes (sheet snap / desktop view / panel width)
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
    let v = g.v0 + dy; if (v > g.max) v = g.max + (v - g.max) * .2; if (v < g.min) v = g.min - (g.min - v) * .2;
    g.pts.push([performance.now(), e.clientY]); if (g.pts.length > 6) g.pts.shift();
    app.current.style.setProperty('--vis', v + 'px'); g.v = v;
  };
  const onSheetUp = () => {
    const g = sheet.current; sheet.current = null; if (!g) return;
    delete app.current.dataset.drag;
    if (!g.moved) { g.tap && setSnap((x) => (x === 'peek' ? 'half' : x === 'half' ? 'full' : 'peek')); return; }
    const [t0, y0] = g.pts[0], [t1, y1] = g.pts.at(-1), vel = t1 > t0 ? (y0 - y1) / (t1 - t0) * 1000 : 0; // px/s, up positive
    const proj = Math.max(g.min, Math.min(g.max, g.v + vel * .2));
    const best = Object.entries(g.snaps).sort((a, b) => Math.abs(a[1] - proj) - Math.abs(b[1] - proj))[0][0];
    app.current.style.removeProperty('--vis'); setSnap(best);
  };

  /* ---------- desktop resizer ---------- */
  const onRzDown = (e) => { e.currentTarget.setPointerCapture(e.pointerId); app.current.dataset.drag = ''; e.currentTarget.dataset.on = '1'; };
  const onRzMove = (e) => { if (e.currentTarget.dataset.on) setPw(Math.round(Math.max(340, Math.min(720, e.clientX)))); };
  const onRzUp = (e) => { delete e.currentTarget.dataset.on; delete app.current.dataset.drag; };

  if (!s) return null;
  const total = places.reduce((a, p) => a + (+p.dur || 0), 0) + legs.reduce((a, l) => a + (l?.t || 0), 0);
  const cost = places.reduce((a, p) => a + (+p.cost || 0), 0);
  const share = () => {
    const u = gmaps(places[0], places.at(-1), mode) + `&waypoints=${places.slice(1, -1).map(ll).join('|')}`;
    navigator.share ? navigator.share({ title: `${trip.name} · Day ${s.day + 1}`, url: u }).catch(() => {}) : navigator.clipboard.writeText(u).then(() => say('Link copied'));
  };
  const hits = q.trim() ? trip.days.flatMap((d, di) => d.places.map((p, pi) => ({ p, di, pi }))).filter(({ p }) => {
    const n = q.trim().toLowerCase().replace(/^#/, ''); return [p.name, p.addr, p.note, ...tagsOf(p)].join(' ').toLowerCase().includes(n);
  }) : null;
  const backup = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(s)], { type: 'application/json' })); a.download = 'viaggio-backup.json'; a.click(); };
  const restore = async (e) => { try { const d = JSON.parse(await e.target.files[0].text()); if (d.trips) { setS({ ...d, ts: Date.now() }); say('Backup restored'); } } catch { say('Invalid file'); } };
  const signIn = () => fb().then(({ A: Au, auth }) => Au.signInWithPopup(auth, new Au.GoogleAuthProvider()));
  const signOut = () => fb().then(({ A: Au, auth }) => Au.signOut(auth));
  const showOn = (p) => { if (!map.current) return; map.current.panTo(p); map.current.setZoom(15); if (!desk) setSnap('peek'); else if (dsk === 'list') setDsk('split'); };
  const hasTabs = view === 'plan' && !hits;
  const peekOrList = snap === 'peek';

  const ViewSwitch = () => <div className="vs" role="group" aria-label="Layout">{[['list', 'list', 'List'], ['split', 'split', 'Split'], ['map', 'map', 'Map']].map(([k, ic, l]) => <button key={k} aria-pressed={dsk === k} aria-label={l} title={l} onClick={() => setDsk(k)}><Ic n={ic} /></button>)}</div>;

  const stop = (p, i) => (
    <div className={'card' + (drag === i ? ' drag' : '')} draggable={desk && open !== p.id} onDragStart={() => setDrag(i)} onDragEnd={() => setDrag(null)} onDragOver={(e) => e.preventDefault()} onDrop={() => drag !== null && move(drag, i)}>
      <div className="pl">
        <button className="nb" onClick={() => showOn(p)} aria-label={`Show ${p.name} on map`}><span className="n">{i + 1}</span></button>
        <div className="main" onClick={() => setOpen(open === p.id ? null : p.id)}>
          <b {...A(p.name)} className="bd">{p.name}</b>
          <small>{p.time ? p.time + ' · ' : ''}{fmt(p.dur || 0)}{p.cost ? ` · ${trip.cc}${p.cost}` : ''}</small>
          <div>{tagsOf(p).map((t) => <button key={t} className="tg" onClick={(e) => { e.stopPropagation(); setQ('#' + t); }}>#{t}</button>)}</div>
        </div>
        <a className="ib" href={gmaps(null, p, mode)} target="_blank" rel="noopener" aria-label="Navigate here" style={{ color: 'var(--acc2)' }}><Ic n="nav" /></a>
        <button className="ib chev" aria-expanded={open === p.id} aria-label="Edit stop" onClick={() => setOpen(open === p.id ? null : p.id)}><Ic n="chev" /></button>
      </div>
      {open === p.id && <div className="det">
        <div className="fld"><span className="lbl">Time</span><Chips opts={['09:00', '12:30', '15:00', '19:30']} val={p.time} on={(v) => patch(i, 'time', p.time === v ? '' : v)} /><input type="time" value={p.time} onChange={(e) => patch(i, 'time', e.target.value)} aria-label="Time" /></div>
        <div className="fld"><span className="lbl">Duration</span><Chips opts={[30, 60, 90, 120, 180]} val={+p.dur} on={(v) => patch(i, 'dur', v)} f={fmt} /></div>
        <label className="fld"><span className="lbl">Budget</span>
          <div className="step"><i>{trip.cc}</i><input type="number" inputMode="decimal" min="0" value={p.cost} onChange={(e) => patch(i, 'cost', +e.target.value)} /><button onClick={() => patch(i, 'cost', Math.max(0, +p.cost - 10))} aria-label="Less">−</button><button onClick={() => patch(i, 'cost', +p.cost + 10)} aria-label="More">+</button></div>
        </label>
        <div className="fld"><span className="lbl">Category</span><Chips opts={CATS} val={p.cat} on={(v) => patch(i, 'cat', v)} /></div>
        <label className="fld"><span className="lbl">Notes · use #tags</span><textarea {...A(p.note)} rows="3" value={p.note} onChange={(e) => patch(i, 'note', e.target.value)} /></label>
        <div className="acts">
          <button className="act" onClick={() => move(i, i - 1)} disabled={i === 0}><Ic n="up" />Up</button>
          <button className="act" onClick={() => move(i, i + 1)} disabled={i === places.length - 1}><Ic n="down" />Down</button>
          <button className="act" onClick={() => showOn(p)}><Ic n="pin" />On map</button>
          <button className="act" onClick={() => { up((_, t) => { t.wish.push({ ...p, id: uid() }); }); say('Saved to wish list'); }}><Ic n="heart" />Save</button>
          <button className="act danger" onClick={() => undoable('Stop removed', () => up((_, __, d) => { d.places.splice(i, 1); }))}><Ic n="trash" />Remove</button>
        </div>
      </div>}
    </div>
  );

  return (
    <main className="app" ref={app} data-snap={snap} data-dsk={dsk} data-tabs={hasTabs}>
      <div className="mapw">
        {ok ? <div id="map" /> : <div className="nomap"><p>Map unavailable.<br />Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY or go online — your itinerary still works.</p></div>}
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
            {trip.days.map((d, i) => <button key={d.id} role="tab" className="tab" aria-selected={i === s.day} onClick={() => up((c) => { c.day = i; })}>Day {i + 1}</button>)}
            <button className="tab" onClick={() => up((c, t) => { t.days.push({ id: uid(), places: [] }); c.day = t.days.length - 1; })}>＋ Day</button>
          </div>}
        </div>

        <div className="body"><div className="wrap">
          {!online && <div className="off">Offline — itinerary and saved routes available</div>}
          <div className="seg">{[['plan', 'Plan'], ['notes', 'Notes'], ['more', 'More']].map(([k, v]) => <button key={k} aria-pressed={view === k} onClick={() => setView(k)}>{v}</button>)}</div>

          {view === 'plan' && <>
            <div className="find"><Ic n="search" /><input {...A(q)} placeholder="Filter stops or #tags…" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" /></div>
            {hits ? <>
              {hits.map(({ p, di, pi }) => <div className="card" key={p.id} onClick={() => { up((c) => { c.day = di; }); setQ(''); }} style={{ cursor: 'pointer' }}><div className="pl"><span className="nb"><span className="n">{di + 1}</span></span><div className="main"><b {...A(p.name)} className="bd">{p.name}</b><small>Day {di + 1} · stop {pi + 1} · {tagsOf(p).map((t) => '#' + t).join(' ')}</small></div></div></div>)}
              {!hits.length && <p className="sum">No matches.</p>}
            </> : <>
              <div className="row">
                <div className="mode">{Object.entries(MODES).map(([k, v]) => <button key={k} aria-pressed={mode === k} onClick={() => setMode(k)}><Ic n={MI[k]} s={18} />{v}</button>)}</div>
                <button className="ib fill" aria-label="Day earlier" onClick={() => up((c, t) => { const i = c.day; if (i > 0) { t.days.splice(i - 1, 0, t.days.splice(i, 1)[0]); c.day--; } })}><Ic n="left" /></button>
                <button className="ib fill" aria-label="Day later" onClick={() => up((c, t) => { const i = c.day; if (i < t.days.length - 1) { t.days.splice(i + 1, 0, t.days.splice(i, 1)[0]); c.day++; } })}><Ic n="right" /></button>
                <button className="ib fill" aria-label="Remove day" style={{ color: 'var(--danger)' }} onClick={() => { if (t0(trip) < 2) return say('A trip needs at least one day'); const rm = () => up((c, t) => { t.days.splice(c.day, 1); c.day = Math.max(0, c.day - 1); }); places.length ? setDlg({ title: `Remove Day ${s.day + 1}?`, text: `${places.length} stops will be deleted.`, label: 'Remove', danger: true, ok: () => undoable('Day removed', rm) }) : rm(); }}><Ic n="trash" /></button>
              </div>
              <div className="stats"><div className="stat"><b>{places.length}</b><small>stops</small></div><div className="stat"><b>~{fmt(total)}</b><small>total time</small></div><div className="stat"><b>{trip.cc}{cost}</b><small>budget</small></div></div>
              {ok && <Search onPick={(p) => up((_, __, d) => { d.places.push(p); })} />}
              <div style={{ height: 14 }} />
              {!places.length && <div className="empty">No stops for Day {s.day + 1} yet.<br />Search a place above to add it.</div>}
              {places.map((p, i) => <div key={p.id}>{stop(p, i)}{i < places.length - 1 && <div className="leg">{legs[i] ? `${MODES[mode]} · ${km(legs[i].d)} · ${fmt(legs[i].t)}` : '—'}<a href={gmaps(p, places[i + 1], mode)} target="_blank" rel="noopener">Navigate <Ic n="nav" s={14} /></a></div>}</div>)}
              {places.length > 1 && <button className="btn full" style={{ marginTop: 14 }} onClick={share}><Ic n="share" />Share day in Google Maps</button>}
              <h2 className="sec">Wish list</h2>
              {!trip.wish.length && <p className="sum">Save a stop from its edit panel to keep it for later.</p>}
              {trip.wish.map((p, i) => <div className="card" key={p.id}><div className="pl"><div className="main" style={{ cursor: 'default' }}><b {...A(p.name)} className="bd">{p.name}</b><small {...A(p.addr)}>{p.addr}</small></div>
                <button className="ghost" onClick={() => { up((_, __, d) => { d.places.push({ ...p, id: uid() }); }); say(`Added to Day ${s.day + 1}`); }}>+ Day {s.day + 1}</button>
                <button className="ib" onClick={() => up((_, t) => { t.wish.splice(i, 1); })} aria-label="Delete"><Ic n="x" /></button></div></div>)}
            </>}
          </>}

          {view === 'notes' && <>
            <h2 className="sec" style={{ marginTop: 6 }}>Trip notes</h2>
            <textarea {...A(trip.notes)} rows="7" placeholder="Bookings, reminders, phrases… use #tags" value={trip.notes} onChange={(e) => up((_, t) => { t.notes = e.target.value; })} />
            <h2 className="sec">To-do</h2>
            <input {...A('')} placeholder="Add task and press Enter" enterKeyHint="done" onKeyDown={(e) => { if (e.key === 'Enter' && e.target.value.trim()) { const v = e.target.value.trim(); e.target.value = ''; up((_, t) => { t.todos.push({ id: uid(), text: v, done: false }); }); } }} />
            {trip.todos.map((t, i) => <div key={t.id} className={'todo' + (t.done ? ' done' : '')}><label><input type="checkbox" checked={t.done} onChange={() => up((_, tr) => { tr.todos[i].done = !t.done; })} /></label><span {...A(t.text)} className="bd" style={{ flex: 1 }}>{t.text}</span><button className="ib" onClick={() => up((_, tr) => { tr.todos.splice(i, 1); })} aria-label="Delete"><Ic n="x" /></button></div>)}
          </>}

          {view === 'more' && <>
            <h2 className="sec" style={{ marginTop: 6 }}>Account sync</h2>
            {!FB.apiKey ? <p className="sum">Firebase not configured — see README. Data is stored on this device only.</p> : user
              ? <div className="row"><span className="sum" style={{ margin: 0, flex: 1 }}>Synced as {user.email}</span><button className="ghost" onClick={signOut}>Sign out</button></div>
              : <button className="btn full" onClick={signIn}>Sign in with Google to sync</button>}
            <h2 className="sec">Trip</h2>
            <div className="fld"><span className="lbl">Currency</span><Chips opts={['€', '$', '£', '₪']} val={trip.cc} on={(v) => up((_, t) => { t.cc = v; })} /></div>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="ghost" onClick={() => up((c) => { c.theme = c.theme === 'dark' ? 'light' : 'dark'; })}><Ic n="moon" />{s.theme === 'dark' ? 'Light theme' : 'Dark theme'}</button>
              <button className="ghost danger" onClick={() => s.trips.length > 1 ? setDlg({ title: `Delete “${trip.name}”?`, text: 'This removes all its days, notes and tasks.', label: 'Delete', danger: true, ok: () => undoable('Trip deleted', () => up((c) => { c.trips.splice(c.cur, 1); c.cur = 0; c.day = 0; })) }) : say('Keep at least one trip')}><Ic n="trash" />Delete trip</button>
            </div>
            <h2 className="sec">Backup</h2>
            <div className="row"><button className="ghost" onClick={backup}>Export JSON</button><label className="ghost">Import JSON<input type="file" accept="application/json" onChange={restore} hidden /></label></div>
          </>}
        </div></div>
      </section>
      {toast && <div className="toast" role="status" key={toast.msg}>{toast.msg}{toast.act && <button onClick={() => { toast.fn(); setToast(null); }}>{toast.act}</button>}</div>}
      {dlg && <Dialog d={dlg} close={() => setDlg(null)} />}
    </main>
  );
}
const t0 = (t) => t.days.length;
