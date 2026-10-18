import { planRide, requestRoutes, DEFAULT_ENDPOINT } from './routing.js';
import { twistLabel, nearestIndex } from './geo.js';
import { Guidance, maneuverIcon } from './nav.js';
import { shareUrl, rideFromHash, toGpx, savedRides } from './share.js';

const L = window.L;
const $ = (s) => document.querySelector(s);

// ---------- settings ----------
const SETTINGS_KEY = 'motorider.settings.v1';
const settings = Object.assign({ units: 'mi', tiles: 'osm', endpoint: '' }, (() => {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; }
})());
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ } };
const endpoint = () => settings.endpoint.trim() || DEFAULT_ENDPOINT;

// ---------- formatting ----------
const fmtDist = (m) => {
  if (settings.units === 'km') return m >= 1000 ? `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km` : `${Math.round(m / 10) * 10} m`;
  const mi = m / 1609.344;
  return mi >= 0.2 ? `${mi.toFixed(mi < 10 ? 1 : 0)} mi` : `${Math.round((m * 3.28084) / 50) * 50} ft`;
};
const fmtTime = (s) => {
  const h = Math.floor(s / 3600), min = Math.round((s % 3600) / 60);
  return h ? `${h} h ${min} min` : `${min} min`;
};
const kmToUnit = (km) => (settings.units === 'km' ? km : km / 1.609344);
const unitToKm = (v) => (settings.units === 'km' ? v : v * 1.609344);
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}
function status(msg, isError = false) {
  const s = $('#status');
  s.textContent = msg || '';
  s.classList.toggle('error', isError);
}

// ---------- map ----------
const map = L.map('map', { zoomControl: false, attributionControl: true }).setView([39.5, -98.35], 4);
L.control.zoom({ position: 'bottomleft' }).addTo(map);
const tileLayers = {
  osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }),
  topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17, subdomains: 'abc', attribution: '© OpenStreetMap, SRTM | © <a href="https://opentopomap.org">OpenTopoMap</a>',
  }),
};
let currentTiles = null;
function applyTiles() {
  if (currentTiles) map.removeLayer(currentTiles);
  currentTiles = (tileLayers[settings.tiles] || tileLayers.osm).addTo(map);
}
applyTiles();
map.attributionControl.addAttribution('Routing © <a href="https://valhalla.github.io/valhalla/">Valhalla</a> / FOSSGIS');

const routeLayer = L.layerGroup().addTo(map);
const pinLayer = L.layerGroup().addTo(map);
let meMarker = null;
let myPos = null;

function showMe(p) {
  myPos = p;
  if (!meMarker) meMarker = L.marker(p, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
  else meMarker.setLatLng(p);
}

function locateOnce() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not available on this device.'));
    navigator.geolocation.getCurrentPosition(
      (pos) => { const p = [pos.coords.latitude, pos.coords.longitude]; showMe(p); resolve(p); },
      () => reject(new Error('Could not get your location. Allow location access for this site.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  });
}

// ---------- planner state ----------
const state = {
  mode: 'ab',
  stops: [{ me: true, name: 'My location' }, {}],
  twist: 1,
  routes: [],
  selected: 0,
  rideName: '',
};

const stopLabel = (i, n) => (state.mode === 'loop' ? 'start' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'mid');

function renderStops() {
  const box = $('#stops');
  box.innerHTML = '';
  const list = state.mode === 'loop' ? state.stops.slice(0, 1) : state.stops;
  list.forEach((s, i) => {
    const kind = stopLabel(i, list.length);
    const row = document.createElement('div');
    row.className = 'stop';
    const placeholder = kind === 'start' ? 'Start (or tap ◎ for my location)' : kind === 'end' ? 'Where to?' : 'Stop along the way';
    row.innerHTML = `
      <span class="dot ${kind}">${kind === 'start' ? 'A' : kind === 'end' ? 'B' : i}</span>
      <input type="text" autocomplete="off" enterkeyhint="search" placeholder="${placeholder}" value="${esc(s.name || '')}">
      ${i === 0 ? '<button class="icon me" title="Use my location" aria-label="Use my location">◎</button>' : ''}
      ${kind === 'mid' ? '<button class="icon rm" title="Remove stop" aria-label="Remove stop">✕</button>' : ''}`;
    const input = row.querySelector('input');
    attachSearch(input, row, (place) => { state.stops[i] = place; renderPins(); });
    input.addEventListener('input', () => { state.stops[i] = { name: input.value }; });
    row.querySelector('.me')?.addEventListener('click', () => { state.stops[0] = { me: true, name: 'My location' }; renderStops(); });
    row.querySelector('.rm')?.addEventListener('click', () => { state.stops.splice(i, 1); renderStops(); renderPins(); });
    box.appendChild(row);
  });
  $('#btn-add-stop').hidden = state.mode === 'loop' || state.stops.length >= 7;
}

function renderPins() {
  pinLayer.clearLayers();
  const list = state.mode === 'loop' ? state.stops.slice(0, 1) : state.stops;
  list.forEach((s, i) => {
    if (s.lat == null || s.me) return;
    const kind = stopLabel(i, list.length);
    const label = kind === 'start' ? 'A' : kind === 'end' ? 'B' : i;
    L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: `<div class="pin ${kind}"><span>${label}</span></div>`, iconSize: [28, 28], iconAnchor: [14, 28] }) }).addTo(pinLayer);
  });
}

// ---------- place search (Photon, OSM-based, allows type-ahead) ----------
function attachSearch(input, row, onPick) {
  let timer, ctrl;
  const close = () => row.querySelector('.suggest')?.remove();
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) return close();
    timer = setTimeout(async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      const c = map.getCenter();
      try {
        const url = `https://photon.komoot.io/api/?limit=5&lang=en&q=${encodeURIComponent(q)}&lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}`;
        const data = await (await fetch(url, { signal: ctrl.signal })).json();
        showSuggestions(data.features || []);
      } catch (e) {
        if (e.name !== 'AbortError') close();
      }
    }, 350);
  });
  input.addEventListener('blur', () => setTimeout(close, 200));
  function showSuggestions(features) {
    close();
    if (!features.length) return;
    const ul = document.createElement('ul');
    ul.className = 'suggest';
    for (const f of features) {
      const p = f.properties;
      const title = p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.city || 'Unnamed place';
      const sub = [p.city !== title ? p.city : null, p.state, p.country].filter(Boolean).join(', ');
      const li = document.createElement('li');
      li.tabIndex = 0;
      li.innerHTML = `${esc(title)}<small>${esc(sub)}</small>`;
      const pick = () => {
        const [lon, lat] = f.geometry.coordinates;
        input.value = title;
        onPick({ lat, lon, name: title });
        close();
        map.setView([lat, lon], Math.max(map.getZoom(), 11));
      };
      li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(); });
      li.addEventListener('keydown', (e) => e.key === 'Enter' && pick());
      ul.appendChild(li);
    }
    row.appendChild(ul);
  }
}

// ---------- tap map to place stops ----------
map.on('click', (e) => {
  if (navState) return;
  const p = { lat: e.latlng.lat, lon: e.latlng.lng, name: `Dropped pin` };
  const div = document.createElement('div');
  div.className = 'row';
  const add = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { fn(); map.closePopup(); renderStops(); renderPins(); }; div.appendChild(b); };
  if (state.mode === 'loop') {
    add('Start loop here', () => (state.stops[0] = p));
  } else {
    add('Ride here', () => (state.stops[state.stops.length - 1] = p));
    add('Start here', () => (state.stops[0] = p));
    add('Add as stop', () => state.stops.splice(state.stops.length - 1, 0, p));
  }
  L.popup().setLatLng(e.latlng).setContent(div).openOn(map);
});

// ---------- planner controls ----------
function setMode(m) {
  state.mode = m;
  $('#mode-ab').classList.toggle('on', m === 'ab');
  $('#mode-loop').classList.toggle('on', m === 'loop');
  $('#loop-opts').hidden = m !== 'loop';
  $('#detour-wrap').hidden = m === 'loop';
  if (m === 'ab' && state.stops.length < 2) state.stops.push({});
  renderStops();
  renderPins();
}
$('#mode-ab').onclick = () => setMode('ab');
$('#mode-loop').onclick = () => setMode('loop');
$('#btn-add-stop').onclick = () => { state.stops.splice(state.stops.length - 1, 0, {}); renderStops(); };
$('#btn-collapse').onclick = () => {
  const c = $('#planner').classList.toggle('collapsed');
  $('#btn-collapse').textContent = c ? '▾' : '▴';
};
document.querySelectorAll('#twist-seg button').forEach((b) => (b.onclick = (e) => {
  e.preventDefault();
  state.twist = +b.dataset.v;
  document.querySelectorAll('#twist-seg button').forEach((x) => x.classList.toggle('on', x === b));
}));
const loopLen = $('#loop-len');
const updateLoopOut = () => ($('#loop-len-out').textContent = `${loopLen.value} ${settings.units}`);
loopLen.oninput = updateLoopOut;
$('#detour').oninput = () => ($('#detour-out').textContent = `+${$('#detour').value}%`);

const prefs = () => ({
  avoidHighways: $('#pref-hwy').checked,
  pavedOnly: $('#pref-paved').checked,
  avoidTolls: $('#pref-toll').checked,
});

async function resolveStops(list) {
  const out = [];
  for (const s of list) {
    if (s.me) {
      const p = myPos || (await locateOnce());
      out.push({ lat: p[0], lon: p[1], name: 'My location' });
    } else if (s.lat != null) {
      out.push(s);
    } else if (s.name && s.name.trim()) {
      throw new Error(`Pick "${s.name}" from the suggestions, or tap the map to set it.`);
    } else {
      throw new Error(state.mode === 'loop' ? 'Choose where the loop starts.' : 'Choose where you want to ride to.');
    }
  }
  return out;
}

$('#btn-plan').onclick = async () => {
  const btn = $('#btn-plan');
  btn.disabled = true;
  try {
    status('Finding your location…');
    const list = state.mode === 'loop' ? state.stops.slice(0, 1) : state.stops.filter((s, i) => i === 0 || i === state.stops.length - 1 || s.lat != null);
    const stops = await resolveStops(list);
    status('Scouting twisty roads…');
    const routes = await planRide({
      mode: state.mode,
      stops,
      loopKm: unitToKm(+loopLen.value),
      direction: $('#loop-dir').value === '' ? null : +$('#loop-dir').value,
      twistLevel: state.twist,
      maxDetour: 1 + +$('#detour').value / 100,
      prefs: prefs(),
      endpoint: endpoint(),
      onProgress: (i, n) => status(`Scouting twisty roads… ${Math.round((i / n) * 100)}%`),
    });
    status('');
    state.rideName = state.mode === 'loop' ? `${Math.round(+loopLen.value)} ${settings.units} loop from ${stops[0].name}` : `${stops[0].name} → ${stops[stops.length - 1].name}`;
    showRoutes(routes, prefs());
    $('#planner').classList.add('collapsed');
    $('#btn-collapse').textContent = '▾';
  } catch (e) {
    status(e.message, true);
  } finally {
    btn.disabled = false;
  }
};

// ---------- results ----------
let lastPrefs = {};

function twistBadge(t) {
  const label = twistLabel(t);
  const cls = t >= 200 ? 't3' : t >= 110 ? 't2' : 't1';
  return `<span class="badge ${cls}">${label}</span>`;
}

function showRoutes(routes, p) {
  state.routes = routes;
  state.selected = 0;
  lastPrefs = p;
  $('#results').hidden = false;
  $('#turns').hidden = true;
  $('#more').hidden = true;
  drawRoutes(true);
}

function drawRoutes(fit = false) {
  routeLayer.clearLayers();
  const opts = $('#options');
  opts.innerHTML = '';
  state.routes.forEach((r, i) => {
    const on = i === state.selected;
    const line = L.polyline(r.points, { color: on ? '#ff7a1a' : '#7d8794', weight: on ? 6 : 4, opacity: on ? 0.95 : 0.6 });
    if (on) L.polyline(r.points, { color: '#000', weight: 9, opacity: 0.35 }).addTo(routeLayer);
    line.on('click', () => { state.selected = i; drawRoutes(); });
    line.addTo(routeLayer);
    if (!on) line.bringToBack();

    const el = document.createElement('div');
    el.className = `opt${on ? ' on' : ''}`;
    const hwy = Math.round(r.highwayShare * 100);
    el.innerHTML = `
      <div class="t"><span>${state.routes.length > 1 ? `Option ${i + 1}` : 'Your ride'} ${twistBadge(r.twist)}</span><span>${fmtDist(r.km * 1000)}</span></div>
      <div class="s"><span>⏱ ${fmtTime(r.seconds)}</span><span>〰 ${Math.round(r.twist)}°/km of curves</span><span>${hwy ? `🛣 ~${hwy}% highway` : '🛣 no highways'}</span>${r.roughShare > 0.01 ? `<span>⚠ some rough road</span>` : ''}${r.hasToll ? '<span>💲 tolls</span>' : ''}</div>`;
    el.onclick = () => { state.selected = i; drawRoutes(); };
    opts.appendChild(el);
  });
  const sel = state.routes[state.selected];
  if (fit && sel) map.fitBounds(L.latLngBounds(sel.points), { paddingTopLeft: [20, 90], paddingBottomRight: [20, 260] });
  renderTurns();
}

function renderTurns() {
  const r = state.routes[state.selected];
  const ol = $('#turns');
  ol.innerHTML = '';
  if (!r) return;
  for (const m of r.maneuvers) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="ico">${maneuverIcon(m.type)}</span><span>${esc(m.instruction)}</span><span class="d">${m.km ? fmtDist(m.km * 1000) : ''}</span>`;
    li.onclick = () => map.setView(r.points[Math.min(m.idx, r.points.length - 1)], 15);
    ol.appendChild(li);
  }
}

const currentRide = () => {
  const r = state.routes[state.selected];
  return r && { name: state.rideName, locations: r.locations, prefs: lastPrefs };
};

$('#btn-more').onclick = () => ($('#more').hidden = !$('#more').hidden);
$('#btn-turns').onclick = () => ($('#turns').hidden = !$('#turns').hidden);
$('#btn-clear').onclick = () => {
  state.routes = [];
  routeLayer.clearLayers();
  $('#results').hidden = true;
  $('#planner').classList.remove('collapsed');
  $('#btn-collapse').textContent = '▴';
  history.replaceState(null, '', location.pathname + location.search);
};

$('#btn-share').onclick = async () => {
  const ride = currentRide();
  if (!ride) return;
  const url = shareUrl(ride, location.href);
  const r = state.routes[state.selected];
  const text = `${ride.name} — ${fmtDist(r.km * 1000)}, ${twistLabel(r.twist).toLowerCase()}. Ride it with me on MotoRider:`;
  if (navigator.share) {
    try { await navigator.share({ title: 'MotoRider ride', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  $('#share-url').value = url;
  $('#dlg-share').showModal();
};
$('#btn-copy').onclick = async () => {
  const input = $('#share-url');
  try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand('copy'); }
  toast('Link copied');
};

$('#btn-save').onclick = () => {
  const ride = currentRide();
  if (!ride) return;
  const name = prompt('Name this ride', ride.name);
  if (name === null) return;
  const r = state.routes[state.selected];
  savedRides.save({ id: `${Date.now()}`, ...ride, name: name || ride.name, km: r.km, seconds: r.seconds, twist: r.twist, savedAt: Date.now() });
  state.rideName = name || ride.name;
  toast('Ride saved');
};

$('#btn-gpx').onclick = () => {
  const r = state.routes[state.selected];
  if (!r) return;
  const blob = new Blob([toGpx(state.rideName, r)], { type: 'application/gpx+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(state.rideName || 'ride').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'ride'}.gpx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};

/** Load an exact ride (from a link or saved list) without re-planning. */
async function openRide(ride) {
  status('Loading ride…');
  $('#results').hidden = true;
  try {
    const [route] = await requestRoutes(ride.locations, ride.prefs, endpoint());
    state.rideName = ride.name || 'Shared ride';
    showRoutes([route], ride.prefs);
    status('');
    $('#planner').classList.add('collapsed');
    $('#btn-collapse').textContent = '▾';
  } catch (e) {
    status(e.message, true);
  }
}

// ---------- saved rides ----------
function renderSaved() {
  const ul = $('#saved-list');
  ul.innerHTML = '';
  const all = savedRides.list();
  if (!all.length) ul.innerHTML = '<li>No saved rides yet.</li>';
  for (const r of all) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="name">${esc(r.name)}<small>${fmtDist(r.km * 1000)} · ${twistLabel(r.twist)} · ${new Date(r.savedAt).toLocaleDateString()}</small></span>
      <button class="icon share" aria-label="Share">↗</button><button class="icon rm" aria-label="Delete">🗑</button>`;
    li.querySelector('.name').onclick = () => { $('#dlg-saved').close(); openRide(r); };
    li.querySelector('.share').onclick = async () => {
      const url = shareUrl(r, location.href);
      if (navigator.share) { try { await navigator.share({ title: r.name, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
      $('#share-url').value = url;
      $('#dlg-share').showModal();
    };
    li.querySelector('.rm').onclick = () => { if (confirm(`Delete "${r.name}"?`)) { savedRides.remove(r.id); renderSaved(); } };
    ul.appendChild(li);
  }
}
$('#btn-saved').onclick = () => { renderSaved(); $('#dlg-saved').showModal(); };

// ---------- settings ----------
$('#btn-settings').onclick = () => {
  $('#set-units').value = settings.units;
  $('#set-tiles').value = settings.tiles;
  $('#set-endpoint').value = settings.endpoint;
  $('#dlg-settings').showModal();
};
$('#dlg-settings').addEventListener('close', () => {
  const unitsChanged = settings.units !== $('#set-units').value;
  settings.units = $('#set-units').value;
  settings.tiles = $('#set-tiles').value;
  settings.endpoint = $('#set-endpoint').value;
  saveSettings();
  applyTiles();
  if (unitsChanged) {
    loopLen.value = Math.round(settings.units === 'km' ? +loopLen.value * 1.609344 : +loopLen.value / 1.609344);
    loopLen.max = settings.units === 'km' ? 400 : 250;
    updateLoopOut();
    if (state.routes.length) drawRoutes();
  }
});

// ---------- navigation ----------
let navState = null;

async function startNav() {
  const route = state.routes[state.selected];
  if (!route) return;
  if (!navigator.geolocation) return toast('GPS is not available on this device');
  navState = { route, guide: new Guidance(route), follow: true, muted: false, wakeLock: null };
  $('#planner').hidden = true;
  $('#results').hidden = true;
  $('#nav').hidden = false;
  $('#nav-off').hidden = true;
  routeLayer.clearLayers();
  L.polyline(route.points, { color: '#000', weight: 10, opacity: 0.35 }).addTo(routeLayer);
  navState.line = L.polyline(route.points, { color: '#ff7a1a', weight: 7 }).addTo(routeLayer);
  navState.done = L.polyline([], { color: '#7d8794', weight: 7 }).addTo(routeLayer);
  try { navState.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ }
  speak('Starting ride. ' + (route.maneuvers[0]?.pre || ''));
  navState.watch = navigator.geolocation.watchPosition(onFix, () => ($('#nav-text').textContent = 'GPS signal lost…'), { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  map.on('dragstart', pauseFollow);
}
const pauseFollow = () => navState && (navState.follow = false);

function onFix(pos) {
  const p = [pos.coords.latitude, pos.coords.longitude];
  showMe(p);
  const u = navState.guide.update(p);
  const r = navState.route;
  $('#nav-icon').textContent = maneuverIcon(u.next.type);
  $('#nav-dist').textContent = fmtDist(u.distanceToNext);
  $('#nav-text').textContent = u.next.instruction;
  const secLeft = r.seconds * (u.remainingM / (r.km * 1000));
  const eta = new Date(Date.now() + secLeft * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('#nav-remaining').textContent = `${fmtDist(u.remainingM)} · arrive ${eta}`;
  $('#nav-off').hidden = !u.offRoute;
  navState.line.setLatLngs(r.points.slice(u.idx));
  navState.done.setLatLngs(r.points.slice(0, u.idx + 1));
  if (u.speak) speak(u.speak);
  if (navState.follow) map.setView(p, Math.max(map.getZoom(), 15), { animate: true });
  if (u.arrived && !navState.arrived) {
    navState.arrived = true;
    speak('You have arrived. Enjoy!');
    $('#nav-text').textContent = 'You have arrived 🏁';
  }
}

function speak(text) {
  if (!text || !navState || navState.muted || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

function stopNav() {
  if (!navState) return;
  navigator.geolocation.clearWatch(navState.watch);
  navState.wakeLock?.release?.();
  map.off('dragstart', pauseFollow);
  speechSynthesis?.cancel();
  navState = null;
  $('#nav').hidden = true;
  $('#planner').hidden = false;
  $('#results').hidden = false;
  drawRoutes();
}

$('#btn-go').onclick = startNav;
$('#btn-stop').onclick = stopNav;
$('#btn-recenter').onclick = () => { if (!navState) return; navState.follow = true; if (myPos) map.setView(myPos, 16); };
$('#btn-mute').onclick = () => {
  navState.muted = !navState.muted;
  $('#btn-mute').textContent = navState.muted ? '🔇' : '🔊';
  if (navState.muted) speechSynthesis?.cancel();
};
$('#btn-reroute').onclick = async () => {
  if (!navState || !myPos) return;
  const r = navState.route;
  // Keep the stops and via points we haven't reached yet.
  const ahead = r.locations.slice(1).filter((l, i, arr) => i === arr.length - 1 || nearestIndex(r.points, [l.lat, l.lon]).index > navState.guide.idx);
  $('#nav-text').textContent = 'Rerouting…';
  try {
    const [route] = await requestRoutes([{ lat: myPos[0], lon: myPos[1] }, ...ahead], lastPrefs, endpoint());
    stopNav();
    state.routes = [route];
    state.selected = 0;
    await startNav();
  } catch (e) {
    toast(e.message);
  }
};
document.addEventListener('visibilitychange', async () => {
  // The OS drops the wake lock when the app is backgrounded; take it back.
  if (navState && document.visibilityState === 'visible' && (!navState.wakeLock || navState.wakeLock.released)) {
    try { navState.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ }
  }
});

// ---------- boot ----------
renderStops();
updateLoopOut();
locateOnce().then((p) => map.getZoom() < 6 && map.setView(p, 11)).catch(() => {});

function loadFromHash() {
  try {
    const ride = rideFromHash(location.hash);
    if (ride) openRide(ride);
  } catch (e) {
    status('That ride link looks broken. Ask for it to be sent again.', true);
  }
}
loadFromHash();
window.addEventListener('hashchange', loadFromHash);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
