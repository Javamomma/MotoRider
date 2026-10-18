// Route planning on top of the Valhalla routing engine (motorcycle costing).
// Twisty rides are found by asking for several candidate routes — detours
// through generated via points — and scoring each for curves, highway use
// and backtracking.

import { decodePolyline, haversine, bearing, destination, twistiness, overlapFraction } from './geo.js';

export const DEFAULT_ENDPOINT = 'https://valhalla1.openstreetmap.de';

/**
 * Location: { lat, lon, name?, through? }. `through` marks a generated via
 * point the ride passes through without stopping.
 */
export function buildRequest(locations, prefs = {}) {
  const last = locations.length - 1;
  const req = {
    locations: locations.map((l, i) => ({
      lat: +l.lat.toFixed(6),
      lon: +l.lon.toFixed(6),
      type: i > 0 && i < last && l.through ? 'through' : 'break',
    })),
    costing: 'motorcycle',
    costing_options: {
      motorcycle: {
        use_highways: prefs.avoidHighways === false ? 0.5 : 0.0,
        use_tolls: prefs.avoidTolls ? 0.0 : 0.5,
        use_trails: 0.0,
        use_ferry: 0.2,
        exclude_unpaved: prefs.pavedOnly !== false,
        shortest: false,
      },
    },
    directions_options: { units: 'kilometers', language: 'en-US' },
  };
  if (prefs.alternates && locations.length === 2) req.alternates = prefs.alternates;
  return req;
}

/** Turn a Valhalla `trip` into a flat route object. */
export function parseTrip(trip) {
  const points = [];
  const maneuvers = [];
  for (const leg of trip.legs) {
    const offset = points.length;
    for (const p of decodePolyline(leg.shape, 6)) points.push(p);
    for (const m of leg.maneuvers) {
      maneuvers.push({
        type: m.type,
        instruction: m.instruction,
        alert: m.verbal_transition_alert_instruction || m.verbal_pre_transition_instruction || m.instruction,
        pre: m.verbal_pre_transition_instruction || m.instruction,
        street: (m.street_names || [])[0] || '',
        km: m.length,
        seconds: m.time,
        idx: offset + m.begin_shape_index,
        highway: !!m.highway,
        toll: !!m.toll,
        rough: !!m.rough,
        ferry: !!m.ferry,
      });
    }
  }
  const km = trip.summary.length;
  const sum = (f) => maneuvers.filter(f).reduce((s, m) => s + m.km, 0);
  return {
    points,
    maneuvers,
    km,
    seconds: trip.summary.time,
    highwayShare: km > 0 ? sum((m) => m.highway) / km : 0,
    roughShare: km > 0 ? sum((m) => m.rough) / km : 0,
    hasToll: maneuvers.some((m) => m.toll),
    twist: twistiness(points),
    overlap: overlapFraction(points),
  };
}

export class RoutingError extends Error {}

export async function requestRoutes(locations, prefs, endpoint = DEFAULT_ENDPOINT, fetchImpl = fetch) {
  const body = buildRequest(locations, prefs);
  let res;
  try {
    res = await fetchImpl(`${endpoint.replace(/\/$/, '')}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new RoutingError('Could not reach the routing server. Check your connection.');
  }
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok || !data.trip) {
    if (res.status === 429) throw new RoutingError('The free routing server is busy. Wait a minute and try again.');
    throw new RoutingError(data.error ? `No route found: ${data.error}` : `Routing failed (HTTP ${res.status}).`);
  }
  const trips = [data.trip, ...(data.alternates || []).map((a) => a.trip)];
  return trips.map((t) => ({ ...parseTrip(t), locations }));
}

/** Higher is better. Rewards curves; punishes highways, dirt, backtracking and overly long detours. */
export function scoreRoute(route, { baseKm, maxDetour = 1.5, targetKm } = {}) {
  let s = route.twist;
  s *= 1 - Math.min(1, route.highwayShare * 1.5);
  s *= 1 - Math.min(1, route.roughShare * 2);
  s *= 1 - Math.min(1, route.overlap * 4);
  if (baseKm && route.km > baseKm * maxDetour) s *= Math.max(0, 1 - (route.km / (baseKm * maxDetour) - 1) * 3);
  if (targetKm) s *= Math.max(0, 1 - Math.max(0, Math.abs(route.km - targetKm) / targetKm - 0.15) * 2);
  return s;
}

const pt = (l) => [l.lat, l.lon];
const loc = (p, extra = {}) => ({ lat: p[0], lon: p[1], ...extra });

/**
 * Candidate location lists for an A→B(→C…) ride: one via point per leg,
 * pushed sideways from the leg's midpoint by `offset` × leg length.
 */
export function detourCandidates(stops, level) {
  const offsets = level >= 2 ? [0.18, -0.18, 0.33, -0.33] : level === 1 ? [0.15, -0.15] : [];
  return offsets.map((off) => {
    const out = [stops[0]];
    for (let i = 1; i < stops.length; i++) {
      const a = pt(stops[i - 1]), b = pt(stops[i]);
      const d = haversine(a, b);
      if (d > 8000) {
        const mid = destination(a, bearing(a, b), d / 2);
        out.push(loc(destination(mid, bearing(a, b) + 90, d * off), { through: true }));
      }
      out.push(stops[i]);
    }
    return out;
  });
}

/**
 * Candidate location lists for a loop ride of roughly `km` starting and
 * ending at `start`, heading off in `direction` degrees (or every way if null).
 */
export function loopCandidates(start, km, direction = null, count = 4) {
  // Roads wander, so the drawn circle is smaller than the target length.
  const radius = (km * 1000) / (2 * Math.PI * 1.3);
  const s = pt(start);
  const headings = direction == null
    ? Array.from({ length: count }, (_, i) => (i * 360) / count + 20)
    : [direction - 25, direction, direction + 25].slice(0, count);
  return headings.map((h) => {
    const center = destination(s, h, radius);
    const back = (h + 180) % 360; // bearing from center to start
    const vias = [-80, 0, 80].map((a) => loc(destination(center, back + 180 + a, radius), { through: true }));
    return [start, ...vias, { ...start }];
  });
}

/**
 * Plan a ride. opts: { mode: 'ab'|'loop', stops, loopKm, direction,
 * twistLevel 0..2, maxDetour, prefs, endpoint, onProgress, fetchImpl }.
 * Resolves to routes sorted best-first (max 3).
 */
export async function planRide(opts) {
  const { mode, stops, prefs = {}, endpoint, onProgress = () => {}, fetchImpl = fetch } = opts;
  const twistLevel = opts.twistLevel ?? 1;
  const call = (locs, extra = {}) => requestRoutes(locs, { ...prefs, ...extra }, endpoint, fetchImpl);
  const gap = () => new Promise((r) => setTimeout(r, opts.politeDelay ?? 250));

  let candidates = [];
  let firstError = null;
  let base = [];
  let lists;

  if (mode === 'loop') {
    lists = loopCandidates(stops[0], opts.loopKm, opts.direction ?? null, twistLevel >= 2 ? 5 : 3);
  } else {
    onProgress(0, 1);
    base = await call(stops, { alternates: stops.length === 2 ? 2 : 0 });
    candidates.push(...base);
    lists = detourCandidates(stops, twistLevel);
  }

  for (let i = 0; i < lists.length; i++) {
    onProgress(i + 1, lists.length + 1);
    try {
      await gap();
      candidates.push(...(await call(lists[i])));
    } catch (e) {
      firstError ??= e;
    }
  }
  if (!candidates.length) throw firstError || new RoutingError('No route found.');

  const baseKm = base.length ? base[0].km : null;
  const ctx = { baseKm, maxDetour: opts.maxDetour ?? 1.5, targetKm: mode === 'loop' ? opts.loopKm : null };
  for (const r of candidates) r.score = scoreRoute(r, ctx);
  // Twist level 0 means "direct": favour the base route.
  if (twistLevel === 0 && base.length) base[0].score = Infinity;

  candidates.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const r of candidates) {
    const dup = picked.some((p) => Math.abs(p.km - r.km) / p.km < 0.02 && Math.abs(p.twist - r.twist) < 4);
    if (!dup) picked.push(r);
    if (picked.length === 3) break;
  }
  return picked;
}
