// Ride sharing: compact links, saved rides, and GPX export.

const b64url = {
  encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(s) {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  },
};

/**
 * A ride is stored as the exact locations (including generated via points)
 * plus routing prefs, so anyone opening the link gets the same route.
 */
export function rideToPayload(ride) {
  return {
    v: 1,
    n: ride.name || '',
    l: ride.locations.map((l) => [+l.lat.toFixed(5), +l.lon.toFixed(5), l.through ? 1 : 0, l.name || '']),
    p: { h: ride.prefs.avoidHighways === false ? 0 : 1, t: ride.prefs.avoidTolls ? 1 : 0, u: ride.prefs.pavedOnly === false ? 0 : 1 },
  };
}

export function payloadToRide(p) {
  if (!p || p.v !== 1 || !Array.isArray(p.l) || p.l.length < 2) throw new Error('Unrecognised ride link');
  return {
    name: String(p.n || ''),
    locations: p.l.map(([lat, lon, through, name]) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Bad coordinates in ride link');
      return { lat, lon, through: !!through, name: name || '' };
    }),
    prefs: { avoidHighways: p.p?.h !== 0, avoidTolls: p.p?.t === 1, pavedOnly: p.p?.u !== 0 },
  };
}

export function encodeRide(ride) {
  return b64url.encode(JSON.stringify(rideToPayload(ride)));
}

export function decodeRide(str) {
  return payloadToRide(JSON.parse(b64url.decode(str)));
}

export function shareUrl(ride, base) {
  const u = new URL(base);
  u.hash = `ride=${encodeRide(ride)}`;
  return u.toString();
}

export function rideFromHash(hash) {
  const m = /ride=([A-Za-z0-9_-]+)/.exec(hash || '');
  return m ? decodeRide(m[1]) : null;
}

const xml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

/** GPX with both a route (turn points) and a track (full geometry). */
export function toGpx(name, route) {
  const title = xml(name || 'MotoRider ride');
  const rtepts = route.maneuvers
    .map((m) => {
      const p = route.points[Math.min(m.idx, route.points.length - 1)];
      return `    <rtept lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}"><name>${xml(m.instruction)}</name></rtept>`;
    })
    .join('\n');
  const trkpts = route.points.map((p) => `      <trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="MotoRider" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${title}</name></metadata>
  <rte>
    <name>${title}</name>
${rtepts}
  </rte>
  <trk>
    <name>${title}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}

const KEY = 'motorider.rides.v1';

export const savedRides = {
  list(storage = globalThis.localStorage) {
    try { return JSON.parse(storage.getItem(KEY)) || []; } catch { return []; }
  },
  save(entry, storage = globalThis.localStorage) {
    const all = savedRides.list(storage).filter((r) => r.id !== entry.id);
    all.unshift(entry);
    try { storage.setItem(KEY, JSON.stringify(all.slice(0, 50))); } catch { /* storage full or blocked */ }
    return all;
  },
  remove(id, storage = globalThis.localStorage) {
    const all = savedRides.list(storage).filter((r) => r.id !== id);
    try { storage.setItem(KEY, JSON.stringify(all)); } catch { /* ignore */ }
    return all;
  },
};
