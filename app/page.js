'use client';
import { useEffect, useRef, useState } from 'react';
const KEY = 'viaggio.v1', LEGS = 'viaggio.legs', K = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const uid = () => Math.random().toString(36).slice(2, 9);
const CATS = ['Sightseeing', 'Food', 'Lodging', 'Transport', 'Shopping', 'Other'];
const MODES = { DRIVING: 'Drive', WALKING: 'Walk', TRANSIT: 'Transit' };
const newTrip = (name) => ({ id: uid(), name, days: [{ id: uid(), places: [] }], wish: [] });
const fmt = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const ll = (p) => `${p.lat},${p.lng}`;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let mapsP;
const loadMaps = () => (mapsP ||= new Promise((res, rej) => {
  if (window.google?.maps) return res();
  window.__gm = res;
  const s = document.createElement('script');
  s.src = `https://maps.googleapis.com/maps/api/js?key=${K}&v=weekly&loading=async&callback=__gm`;
  s.onerror = () => { mapsP = null; rej(); }; document.head.append(s);
}));

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
  return <div ref={box} />;
}

export default function Page() {
  const [s, setS] = useState(null);
  const [mode, setMode] = useState('DRIVING');
  const [legs, setLegs] = useState([]);
  const [open, setOpen] = useState(null);
  const [drag, setDrag] = useState(null);
  const [ok, setOk] = useState(!!K);
  const [ready, setReady] = useState(false);
  const map = useRef(), ov = useRef([]), cache = useRef({}), info = useRef();

  useEffect(() => {
    let v = null;
    try { v = JSON.parse(localStorage.getItem(KEY)); cache.current = JSON.parse(localStorage.getItem(LEGS)) || {}; } catch {}
    setS(v || { trips: [newTrip('Italy')], cur: 0, day: 0, theme: matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light' });
    navigator.serviceWorker?.register(`${process.env.NEXT_PUBLIC_BASE_PATH}/sw.js`).catch(() => {});
  }, []);
  useEffect(() => { if (s) { localStorage.setItem(KEY, JSON.stringify(s)); document.documentElement.dataset.theme = s.theme; } }, [s]);

  const trip = s?.trips[s.cur], day = trip?.days[s.day] || trip?.days[0], places = day?.places || [];
  const up = (fn) => setS((x) => { const c = structuredClone(x); const t = c.trips[c.cur]; c.day = Math.min(c.day, t.days.length - 1); fn(c, t, t.days[c.day]); return c; });
  const patch = (i, k, v) => up((_, __, d) => { d.places[i][k] = v; });
  const move = (a, b) => up((_, __, d) => { if (b < 0 || b >= d.places.length) return; d.places.splice(b, 0, d.places.splice(a, 1)[0]); });

  useEffect(() => {
    if (!K || !s || map.current) return;
    loadMaps().then(async () => {
      const { Map } = await google.maps.importLibrary('maps');
      map.current = new Map(document.getElementById('map'), { center: { lat: 42.5, lng: 12.5 }, zoom: 5, mapId: 'DEMO_MAP_ID', disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy' });
      info.current = new google.maps.InfoWindow();
      setReady(true);
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
        mk.addListener('click', () => { info.current.setContent(`<div class="iw"><b>${esc(p.name)}</b><br>${esc(p.addr || '')}<br>${p.time || ''} ${fmt(p.dur || 0)} · ${p.cat}${p.note ? '<br><i>' + esc(p.note) + '</i>' : ''}</div>`); info.current.open({ map: m, anchor: mk }); });
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

  if (!s) return null;
  const total = places.reduce((a, p) => a + (+p.dur || 0), 0) + legs.reduce((a, l) => a + (l?.t || 0), 0);
  const cost = places.reduce((a, p) => a + (+p.cost || 0), 0);
  const exportUrl = () => {
    const u = `https://www.google.com/maps/dir/?api=1&origin=${ll(places[0])}&destination=${ll(places.at(-1))}&travelmode=${{ DRIVING: 'driving', WALKING: 'walking', TRANSIT: 'transit' }[mode]}&waypoints=${places.slice(1, -1).map(ll).join('|')}`;
    navigator.share ? navigator.share({ title: `${trip.name} · Day ${s.day + 1}`, url: u }).catch(() => {}) : navigator.clipboard.writeText(u).then(() => alert('Link copied'));
  };
  const addTrip = () => { const n = prompt('Trip name'); if (n) up((c) => { c.trips.push(newTrip(n)); c.cur = c.trips.length - 1; c.day = 0; }); };

  return (
    <main className="app">
      {ok ? <div id="map" /> : <div className="nomap"><p>Map unavailable.<br />Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY or go online — your itinerary still works.</p></div>}
      <section className="panel">
        <div className="top">
          <select aria-label="Trip" value={s.cur} onChange={(e) => up((c) => { c.cur = +e.target.value; c.day = 0; })}>{s.trips.map((t, i) => <option key={t.id} value={i}>{t.name}</option>)}</select>
          <div className="row">
            <button className="ico" onClick={addTrip} aria-label="New trip">＋</button>
            <button className="ico" onClick={() => s.trips.length > 1 && confirm('Delete trip?') && up((c) => { c.trips.splice(c.cur, 1); c.cur = 0; c.day = 0; })} aria-label="Delete trip">🗑</button>
            <button className="ico" onClick={() => up((c) => { c.theme = c.theme === 'dark' ? 'light' : 'dark'; })} aria-label="Theme">◐</button>
          </div>
        </div>
        <div className="tabs" role="tablist">
          {trip.days.map((d, i) => <button key={d.id} role="tab" className="tab" aria-selected={i === s.day} onClick={() => up((c) => { c.day = i; })}>Day {i + 1}</button>)}
          <button className="tab" onClick={() => up((c, t) => { t.days.push({ id: uid(), places: [] }); c.day = t.days.length - 1; })}>＋ Day</button>
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row mode">{Object.entries(MODES).map(([k, v]) => <button key={k} aria-pressed={mode === k} onClick={() => setMode(k)}>{v}</button>)}</div>
          <div className="row">
            <button className="ghost" onClick={() => up((c, t) => { if (t.days.length > 1) { t.days.splice(c.day, 1); c.day = Math.max(0, c.day - 1); } })}>Remove day</button>
            <button className="ghost" onClick={() => up((c, t) => { const i = c.day; if (i > 0) { t.days.splice(i - 1, 0, t.days.splice(i, 1)[0]); c.day--; } })} aria-label="Move day earlier">←</button>
            <button className="ghost" onClick={() => up((c, t) => { const i = c.day; if (i < t.days.length - 1) { t.days.splice(i + 1, 0, t.days.splice(i, 1)[0]); c.day++; } })} aria-label="Move day later">→</button>
          </div>
        </div>
        <p className="sum">{places.length} stops · ~{fmt(total)} total · budget {cost.toFixed(0)}</p>
        {ok && <Search onPick={(p) => up((_, __, d) => { d.places.push(p); })} />}
        <div style={{ height: 12 }} />
        {places.map((p, i) => (
          <div key={p.id}>
            <div className={'card' + (drag === i ? ' drag' : '')} draggable onDragStart={() => setDrag(i)} onDragEnd={() => setDrag(null)} onDragOver={(e) => e.preventDefault()} onDrop={() => drag !== null && move(drag, i)}>
              <div className="pl">
                <span className="n">{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }} onClick={() => setOpen(open === p.id ? null : p.id)}>
                  <b>{p.name}</b><small>{p.time ? p.time + ' · ' : ''}{fmt(p.dur || 0)} · </small><span className="tag">{p.cat}</span>
                </div>
                <div className="row" style={{ gap: 2 }}>
                  <button onClick={() => move(i, i - 1)} aria-label="Up">↑</button><button onClick={() => move(i, i + 1)} aria-label="Down">↓</button>
                  <button onClick={() => up((_, t) => { t.wish.push({ ...p, id: uid() }); })} aria-label="Save to wish list">♡</button>
                  <button onClick={() => up((_, __, d) => { d.places.splice(i, 1); })} aria-label="Remove">✕</button>
                </div>
              </div>
              {open === p.id && <div className="det">
                <label>Time<input type="time" value={p.time} onChange={(e) => patch(i, 'time', e.target.value)} /></label>
                <label>Duration (min)<input type="number" min="0" step="15" value={p.dur} onChange={(e) => patch(i, 'dur', +e.target.value)} /></label>
                <label>Category<select value={p.cat} onChange={(e) => patch(i, 'cat', e.target.value)}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></label>
                <label>Budget<input type="number" min="0" value={p.cost} onChange={(e) => patch(i, 'cost', +e.target.value)} /></label>
                <label className="w">Notes<textarea rows="2" value={p.note} onChange={(e) => patch(i, 'note', e.target.value)} /></label>
              </div>}
            </div>
            {i < places.length - 1 && <div className="leg">{legs[i] ? `${MODES[mode]} · ${km(legs[i].d)} · ${fmt(legs[i].t)}` : '—'}</div>}
          </div>
        ))}
        {places.length > 1 && <button className="btn" style={{ marginTop: 10 }} onClick={exportUrl}>Share day in Google Maps ↗</button>}
        <h2 className="sec">Wish list</h2>
        {trip.wish.length === 0 && <p className="sum">Tap ♡ on a stop to save it for later.</p>}
        {trip.wish.map((p, i) => <div className="card" key={p.id}><div className="pl"><div style={{ flex: 1 }}><b>{p.name}</b><small>{p.addr}</small></div>
          <button className="ghost" onClick={() => up((_, __, d) => { d.places.push({ ...p, id: uid() }); })}>+ Day {s.day + 1}</button>
          <button onClick={() => up((_, t) => { t.wish.splice(i, 1); })} aria-label="Delete">✕</button></div></div>)}
      </section>
    </main>
  );
}
