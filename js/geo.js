// Geometry helpers. Points are [lat, lon] arrays; distances are meters.

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Decode a Google-style encoded polyline (Valhalla uses precision 6). */
export function decodePolyline(str, precision = 6) {
  const factor = Math.pow(10, precision);
  const points = [];
  let index = 0, lat = 0, lon = 0;
  while (index < str.length) {
    for (const which of [0, 1]) {
      let result = 0, shift = 0, byte;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lon += delta;
    }
    points.push([lat / factor, lon / factor]);
  }
  return points;
}

/** Encode points as a polyline (used by tests and for compact storage). */
export function encodePolyline(points, precision = 6) {
  const factor = Math.pow(10, precision);
  let out = '', pLat = 0, pLon = 0;
  const enc = (v) => {
    v = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (v >= 0x20) {
      s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return s + String.fromCharCode(v + 63);
  };
  for (const [la, lo] of points) {
    const lat = Math.round(la * factor), lon = Math.round(lo * factor);
    out += enc(lat - pLat) + enc(lon - pLon);
    pLat = lat;
    pLon = lon;
  }
  return out;
}

export function haversine(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b in degrees, 0..360. */
export function bearing(a, b) {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Point reached travelling distM meters from p on bearing brg. */
export function destination(p, brg, distM) {
  const d = distM / R, t = rad(brg), la = rad(p[0]), lo = rad(p[1]);
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(t));
  const lo2 = lo + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return [deg(la2), ((deg(lo2) + 540) % 360) - 180];
}

/** Cumulative distance (m) at each vertex. */
export function cumulative(points) {
  const cum = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++) cum[i] = cum[i - 1] + haversine(points[i - 1], points[i]);
  return cum;
}

/** Re-sample a line so vertices are evenly spaced ~step meters apart. */
export function resample(points, step = 40) {
  if (points.length < 2) return points.slice();
  const out = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const seg = haversine(a, b);
    if (seg === 0) continue;
    let d = step - carry;
    while (d <= seg) {
      const f = d / seg;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
      d += step;
    }
    carry = seg - (d - step);
  }
  const last = points[points.length - 1];
  if (haversine(out[out.length - 1], last) > step / 4) out.push(last);
  return out;
}

const angleDiff = (a, b) => {
  let d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
};

/**
 * Twistiness of a route: total heading change in degrees per km of road,
 * measured on a resampled line so GPS-style jitter and vertex density don't
 * matter. Sharp reversals (> 150° in one step, i.e. U-turns) are ignored.
 * Rough guide: interstate ~5–15, country road ~40–80, mountain twisties 150+.
 */
export function twistiness(points) {
  const pts = resample(points, 40);
  if (pts.length < 3) return 0;
  let total = 0, length = 0, prev = bearing(pts[0], pts[1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const h = bearing(pts[i], pts[i + 1]);
    const d = Math.abs(angleDiff(prev, h));
    if (d < 150) total += d;
    prev = h;
  }
  for (let i = 1; i < pts.length; i++) length += haversine(pts[i - 1], pts[i]);
  return length > 0 ? total / (length / 1000) : 0;
}

export function twistLabel(score) {
  if (score >= 200) return 'Very twisty';
  if (score >= 110) return 'Twisty';
  if (score >= 55) return 'Some curves';
  return 'Mostly straight';
}

/**
 * Fraction of the route that re-rides road already covered earlier
 * (out-and-back spurs, doubling back). Uses a ~50 m spatial grid.
 */
export function overlapFraction(points, minGap = 600) {
  const pts = resample(points, 40);
  if (pts.length < 2) return 0;
  const cell = 0.00045; // ~50 m of latitude
  const grid = new Map();
  const key = (p, dx = 0, dy = 0) => `${Math.floor(p[0] / cell) + dx}:${Math.floor(p[1] / cell) + dy}`;
  const gapIdx = Math.ceil(minGap / 40);
  let overlapping = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx++) {
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        const list = grid.get(key(p, dx, dy));
        if (!list) continue;
        for (const j of list) {
          if (i - j > gapIdx && haversine(p, pts[j]) < 30) { hit = true; break; }
        }
      }
    }
    if (hit) overlapping++;
    const k = key(p);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  return overlapping / pts.length;
}

/**
 * Nearest vertex of `points` to p, searching [from, to). Returns
 * { index, distance } with distance in meters.
 */
export function nearestIndex(points, p, from = 0, to = points.length) {
  let best = -1, bestD = Infinity;
  const lo = Math.max(0, from), hi = Math.min(points.length, to);
  for (let i = lo; i < hi; i++) {
    const d = haversine(points[i], p);
    if (d < bestD) { bestD = d; best = i; }
  }
  return { index: best, distance: bestD };
}
