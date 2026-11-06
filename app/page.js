'use client';
import { useEffect, useRef, useState } from 'react';
const KEY = 'viaggio.v1', LEGS = 'viaggio.legs', K = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const FB = { apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY, authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN, projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID };
const uid = () => Math.random().toString(36).slice(2, 9);
const CATS = ['Sightseeing', 'Food', 'Lodging', 'Transport', 'Shopping', 'Other'];
const MODES = { DRIVING: 'Drive', WALKING: 'Walk', TRANSIT: 'Transit' };
const newTrip = (name) => ({ id: uid(), name, cc: '€', notes: '', todos: [], days: [{ id: uid(), places: [] }], wish: [] });
const fmt = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`);
const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const ll = (p) => `${p.lat},${p.lng}`;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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
const fb = () => (fbP ||= Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]).then(([a, A, F]) => { const app = a.initializeApp(FB); return { A, F, auth: A.getAuth(app), db: F.getFirestore(app) }; }));

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
  const map = useRef(), ov = useRef([]), cache = useRef({}), info = useRef(), sRef = useRef(), remote = useRef(0), me = useRef();
  sRef.current = s;

  useEffect(() => {
    let v = null;
    try { v = JSON.parse(localStorage.getItem(KEY)); cache.current = JSON.parse(localStorage.getItem(LEGS)) || {}; } catch {}
    if (v) { v.ts ||= 1; v.trips.forEach((t) => { t.notes ??= ''; t.todos ??= []; t.cc ??= '€'; }); }
    setS(v || { ts: 0, trips: [newTrip('Italy')], cur: 0, day: 0, theme: matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light' });
    navigator.serviceWorker?.register(`${process.env.NEXT_PUBLIC_BASE_PATH}/sw.js`).catch(() => {});
    const f = () => setOnline(navigator.onLine); f(); addEventListener('online', f); addEventListener('offline', f);
    if (FB.apiKey) fb().then(({ A, auth }) => A.onAuthStateChanged(auth, setUser));
  }, []);
  useEffect(() => { if (s) { localStorage.setItem(KEY, JSON.stringify(s)); document.documentElement.dataset.theme = s.theme; } }, [s]);

  useEffect(() => {
    if (!user) return; let off;
    fb().then(({ F, db }) => { off = F.onSnapshot(F.doc(db, 'users', user.uid), (snap) => { const d = snap.data(); if (d && d.ts > (sRef.current.ts || 0)) { remote.current = d.ts; setS(JSON.parse(d.json)); } }); });
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

  useEffect(() => {
    if (!K || !s || map.current) return;
    loadMaps().then(async () => {
      const { Map } = await google.maps.importLibrary('maps');
      map.current = new Map(document.getElementById('map'), { center: { lat: 42.5, lng: 12.5 }, zoom: 5, mapId: 'DEMO_MAP_ID', disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy' });
      info.current = new google.maps.InfoWindow(); setReady(true);
    }).catch(() => setOk(false));
  }, [!!s]);

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
      if (places.length) places.length === 1 ? (m.setCenter(places[0]), m.setZoom(14)) : m.fitBounds(b, 60);
      const out = [];
      for (let i = 0; i < places.length - 1; i++) {
        const a = places[i], z = places[i + 1], key = mode + ll(a) + '>' + ll(z);
        let r = cache.current[key];
        if (!r && navigator.onLine) try {
          const { routes } = await Route.computeRoutes({ origin: { lat: a.lat, lng: a.lng }, destination: { lat: z.lat, lng: z.lng }, travelMode: mode, fields: ['path', 'distanceMeters', 'durationMillis'] });
          const q = routes[0]; r = cache.current[key] = { d: q.distanceMeters, t: Math.round(q.durationMillis / 60000), path: q.path.map((p) => ({ lat: p.lat, lng: p.lng })) };
          try { localStorage.setItem(LEGS, JSON.stringify(cache.current)); } catch {}
        } catch {}
        out.push(r ? { d: r.d, t: r.t } : null);
        if (r && !dead) ov.current.push(new google.maps.Polyline({ map: m, path: r.path, strokeColor: '#b8532f', strokeWeight: 5, strokeOpacity: .85 }));
      }
      if (!dead) setLegs(out);
    })();
    return () => { dead = true; };
  }, [places.map((p) => p.id + p.name).join(), mode, ready]);

  useEffect(() => {
    if (!live || !ready) { me.current?.setMap?.(null); me.current = null; return; }
    const id = navigator.geolocation.watchPosition(({ coords: c }) => {
      const pos = { lat: c.latitude, lng: c.longitude };
      if (!me.current) me.current = new google.maps.Marker({ map: map.current, position: pos, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#2f7bd9', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 } });
      else me.current.setPosition(pos);
    }, () => setLive(false), { enableHighAccuracy: true });
    return () => navigator.geolocation.clearWatch(id);
  }, [live, ready]);

  if (!s) return null;
  const total = places.reduce((a, p) => a + (+p.dur || 0), 0) + legs.reduce((a, l) => a + (l?.t || 0), 0);
  const cost = places.reduce((a, p) => a + (+p.cost || 0), 0);
  const share = () => {
    const u = gmaps(places[0], places.at(-1), mode) + `&waypoints=${places.slice(1, -1).map(ll).join('|')}`;
    navigator.share ? navigator.share({ title: `${trip.name} · Day ${s.day + 1}`, url: u }).catch(() => {}) : navigator.clipboard.writeText(u).then(() => alert('Link copied'));
  };
  const hits = q.trim() ? trip.days.flatMap((d, di) => d.places.map((p, pi) => ({ p, di, pi }))).filter(({ p }) => {
    const n = q.trim().toLowerCase().replace(/^#/, ''); return [p.name, p.addr, p.note, ...tagsOf(p)].join(' ').toLowerCase().includes(n);
  }) : null;
  const backup = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(s)], { type: 'application/json' })); a.download = 'viaggio-backup.json'; a.click(); };
  const restore = async (e) => { try { const d = JSON.parse(await e.target.files[0].text()); if (d.trips) setS({ ...d, ts: Date.now() }); } catch { alert('Invalid file'); } };
  const signIn = () => fb().then(({ A, auth }) => A.signInWithPopup(auth, new A.GoogleAuthProvider()));
  const signOut = () => fb().then(({ A, auth }) => A.signOut(auth));

  const Stop = ({ p, i }) => (
    <div className={'card' + (drag === i ? ' drag' : '')} draggable onDragStart={() => setDrag(i)} onDragEnd={() => setDrag(null)} onDragOver={(e) => e.preventDefault()} onDrop={() => drag !== null && move(drag, i)}>
      <div className="pl">
        <span className="n">{i + 1}</span>
        <div style={{ flex: 1, minWidth: 0 }} onClick={() => setOpen(open === p.id ? null : p.id)}>
          <b dir="auto" className="bd">{p.name}</b>
          <small>{p.time ? p.time + ' · ' : ''}{fmt(p.dur || 0)}{p.cost ? ` · ${trip.cc}${p.cost}` : ''}</small>
          <div style={{ marginTop: 4 }}>{tagsOf(p).map((t) => <button key={t} className="tg" onClick={(e) => { e.stopPropagation(); setQ('#' + t); }}>#{t}</button>)}</div>
        </div>
        <div className="row" style={{ gap: 0, flexWrap: 'nowrap' }}>
          <a className="ico" style={{ textDecoration: 'none' }} href={gmaps(null, p, mode)} target="_blank" rel="noopener" aria-label="Navigate here">➤</a>
          <button onClick={() => move(i, i - 1)} aria-label="Up">↑</button><button onClick={() => move(i, i + 1)} aria-label="Down">↓</button>
          <button onClick={() => up((_, t) => { t.wish.push({ ...p, id: uid() }); })} aria-label="Wish list">♡</button>
          <button onClick={() => up((_, __, d) => { d.places.splice(i, 1); })} aria-label="Remove">✕</button>
        </div>
      </div>
      {open === p.id && <div className="det">
        <label className="w">Time<Chips opts={['09:00', '12:30', '15:00', '19:30']} val={p.time} on={(v) => patch(i, 'time', v)} /><input type="time" value={p.time} onChange={(e) => patch(i, 'time', e.target.value)} /></label>
        <label className="w">Duration<Chips opts={[30, 60, 90, 120, 180]} val={+p.dur} on={(v) => patch(i, 'dur', v)} f={fmt} /></label>
        <label className="w">Budget
          <div className="step"><i>{trip.cc}</i><input type="number" inputMode="decimal" min="0" value={p.cost} onChange={(e) => patch(i, 'cost', +e.target.value)} /><button onClick={() => patch(i, 'cost', Math.max(0, +p.cost - 10))}>−</button><button onClick={() => patch(i, 'cost', +p.cost + 10)}>+</button></div>
        </label>
        <label className="w">Category<Chips opts={CATS} val={p.cat} on={(v) => patch(i, 'cat', v)} /></label>
        <label className="w">Notes · use #tags<textarea dir="auto" rows="2" value={p.note} onChange={(e) => patch(i, 'note', e.target.value)} /></label>
      </div>}
    </div>
  );

  return (
    <main className="app">
      {ok ? <div id="map" /> : <div className="nomap"><p>Map unavailable.<br />Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY or go online — your itinerary still works.</p></div>}
      <section className="panel">
        {!online && <div className="off">Offline — itinerary and saved routes available</div>}
        <div className="top">
          <select aria-label="Trip" value={s.cur} onChange={(e) => up((c) => { c.cur = +e.target.value; c.day = 0; })}>{s.trips.map((t, i) => <option key={t.id} value={i}>{t.name}</option>)}</select>
          <div className="row">
            <button className="ico" onClick={() => setLive(!live)} aria-label="Live location" style={live ? { background: 'var(--acc)', color: '#fff' } : null}>◎</button>
            <button className="ico" onClick={() => { const n = prompt('Trip name'); n && up((c) => { c.trips.push(newTrip(n)); c.cur = c.trips.length - 1; c.day = 0; }); }} aria-label="New trip">＋</button>
          </div>
        </div>
        <div className="seg">{[['plan', 'Plan'], ['notes', 'Notes & To-do'], ['more', 'Sync']].map(([k, v]) => <button key={k} aria-pressed={view === k} onClick={() => setView(k)}>{v}</button>)}</div>

        {view === 'plan' && <>
          <input dir="auto" className="srch" style={{ minHeight: 0, marginBottom: 10 }} placeholder="Filter stops or #tags…" value={q} onChange={(e) => setQ(e.target.value)} />
          {hits ? <>
            {hits.map(({ p, di, pi }) => <div className="card" key={p.id} onClick={() => { up((c) => { c.day = di; }); setQ(''); }}><div className="pl"><span className="n">{di + 1}</span><div><b dir="auto" className="bd">{p.name}</b><small>Day {di + 1} · stop {pi + 1} · {tagsOf(p).map((t) => '#' + t).join(' ')}</small></div></div></div>)}
            {!hits.length && <p className="sum">No matches.</p>}
          </> : <>
            <div className="tabs" role="tablist">
              {trip.days.map((d, i) => <button key={d.id} role="tab" className="tab" aria-selected={i === s.day} onClick={() => up((c) => { c.day = i; })}>Day {i + 1}</button>)}
              <button className="tab" onClick={() => up((c, t) => { t.days.push({ id: uid(), places: [] }); c.day = t.days.length - 1; })}>＋ Day</button>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="row mode">{Object.entries(MODES).map(([k, v]) => <button key={k} aria-pressed={mode === k} onClick={() => setMode(k)}>{v}</button>)}</div>
              <div className="row">
                <button className="ghost" onClick={() => up((c, t) => { const i = c.day; if (i > 0) { t.days.splice(i - 1, 0, t.days.splice(i, 1)[0]); c.day--; } })} aria-label="Day earlier">←</button>
                <button className="ghost" onClick={() => up((c, t) => { const i = c.day; if (i < t.days.length - 1) { t.days.splice(i + 1, 0, t.days.splice(i, 1)[0]); c.day++; } })} aria-label="Day later">→</button>
                <button className="ghost" onClick={() => up((c, t) => { if (t.days.length > 1) { t.days.splice(c.day, 1); c.day = Math.max(0, c.day - 1); } })}>Remove day</button>
              </div>
            </div>
            <p className="sum">{places.length} stops · ~{fmt(total)} · {trip.cc}{cost}</p>
            {ok && <Search onPick={(p) => up((_, __, d) => { d.places.push(p); })} />}
            <div style={{ height: 12 }} />
            {places.map((p, i) => <div key={p.id}><Stop p={p} i={i} />{i < places.length - 1 && <div className="leg">{legs[i] ? `${MODES[mode]} · ${km(legs[i].d)} · ${fmt(legs[i].t)}` : '—'}<a href={gmaps(p, places[i + 1], mode)} target="_blank" rel="noopener">Navigate ➤</a></div>}</div>)}
            {places.length > 1 && <button className="btn" style={{ marginTop: 10 }} onClick={share}>Share day in Google Maps ↗</button>}
            <h2 className="sec">Wish list</h2>
            {!trip.wish.length && <p className="sum">Tap ♡ on a stop to save it for later.</p>}
            {trip.wish.map((p, i) => <div className="card" key={p.id}><div className="pl"><div style={{ flex: 1 }}><b dir="auto" className="bd">{p.name}</b><small dir="auto">{p.addr}</small></div>
              <button className="ghost" onClick={() => up((_, __, d) => { d.places.push({ ...p, id: uid() }); })}>+ Day {s.day + 1}</button>
              <button onClick={() => up((_, t) => { t.wish.splice(i, 1); })} aria-label="Delete">✕</button></div></div>)}
          </>}
        </>}

        {view === 'notes' && <>
          <h2 className="sec">Trip notes</h2>
          <textarea dir="auto" rows="6" placeholder="Bookings, reminders, phrases… use #tags" value={trip.notes} onChange={(e) => up((_, t) => { t.notes = e.target.value; })} />
          <h2 className="sec">To-do</h2>
          <input dir="auto" placeholder="Add task and press Enter" onKeyDown={(e) => { if (e.key === 'Enter' && e.target.value.trim()) { const v = e.target.value.trim(); e.target.value = ''; up((_, t) => { t.todos.push({ id: uid(), text: v, done: false }); }); } }} />
          {trip.todos.map((t, i) => <div key={t.id} className={'todo' + (t.done ? ' done' : '')}><input type="checkbox" checked={t.done} onChange={() => up((_, tr) => { tr.todos[i].done = !t.done; })} /><span dir="auto" className="bd" style={{ flex: 1 }}>{t.text}</span><button onClick={() => up((_, tr) => { tr.todos.splice(i, 1); })} aria-label="Delete">✕</button></div>)}
        </>}

        {view === 'more' && <>
          <h2 className="sec">Account sync</h2>
          {!FB.apiKey ? <p className="sum">Firebase not configured — see README. Data is stored on this device only.</p> : user
            ? <div className="row"><span className="sum" style={{ margin: 0, flex: 1 }}>Synced as {user.email}</span><button className="ghost" onClick={signOut}>Sign out</button></div>
            : <button className="btn" onClick={signIn}>Sign in with Google to sync</button>}
          <h2 className="sec">Trip</h2>
          <label className="det" style={{ display: 'block' }}>Currency<Chips opts={['€', '$', '£', '₪']} val={trip.cc} on={(v) => up((_, t) => { t.cc = v; })} /></label>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="ghost" onClick={() => up((c) => { c.theme = c.theme === 'dark' ? 'light' : 'dark'; })}>◐ Theme</button>
            <button className="ghost" onClick={() => s.trips.length > 1 && confirm('Delete this trip?') && up((c) => { c.trips.splice(c.cur, 1); c.cur = 0; c.day = 0; })}>Delete trip</button>
          </div>
          <h2 className="sec">Backup</h2>
          <div className="row"><button className="ghost" onClick={backup}>Export JSON</button><label className="ghost">Import JSON<input type="file" accept="application/json" onChange={restore} hidden /></label></div>
        </>}
      </section>
    </main>
  );
}
