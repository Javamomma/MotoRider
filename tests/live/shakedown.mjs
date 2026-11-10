// Live shakedown: plans real rides against the real services and reports what came back.
// Run by .github/workflows/live.yml (GitHub's runners can reach the servers); not part of `npm test`.
//   node tests/live/shakedown.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { planRide, requestRoutes, buildRequest, DEFAULT_ENDPOINT } from '../../js/routing.js';
import { Guidance } from '../../js/nav.js';
import { toNavFrame } from '../../js/hudframe.js';
import { toGpx } from '../../js/share.js';

const out = process.argv[2] || 'live-out';
fs.mkdirSync(out, { recursive: true });
const UA = { 'User-Agent': 'ZAMA-shakedown/1.0 (github.com/Javamomma/MotoRider)' };
const liveFetch = (url, init = {}) => fetch(url, { ...init, headers: { ...(init.headers || {}), ...UA } });

const P = (lat, lon, name) => ({ lat, lon, name });
const RIDES = [
  { id: 'boulder-estes', mode: 'ab', stops: [P(40.015, -105.2705, 'Boulder'), P(40.3772, -105.5217, 'Estes Park')], twistLevel: 2 },
  { id: 'dragon', mode: 'ab', stops: [P(35.4665, -83.9199, 'Deals Gap'), P(35.6118, -84.0071, 'Tabcat Bridge')], twistLevel: 1 },
  { id: 'stillwater-taylors', mode: 'ab', stops: [P(45.0566, -92.8061, 'Stillwater MN'), P(45.4019, -92.6524, 'Taylors Falls')], twistLevel: 2 },
  { id: 'duluth-two-harbors', mode: 'ab', stops: [P(46.7867, -92.1005, 'Duluth'), P(47.0227, -91.6707, 'Two Harbors')], twistLevel: 1 },
  { id: 'driftless', mode: 'ab', stops: [P(43.8014, -91.2396, 'La Crosse'), P(43.5553, -90.8887, 'Viroqua')], twistLevel: 2 },
  { id: 'city-direct', mode: 'ab', stops: [P(44.9778, -93.265, 'Minneapolis'), P(44.9537, -93.09, 'Saint Paul')], twistLevel: 0 },
  { id: 'with-stop', mode: 'ab', stops: [P(40.015, -105.2705, 'Boulder'), P(39.9614, -105.5108, 'Nederland'), P(40.0794, -105.5083, 'Ward')], twistLevel: 1 },
  { id: 'loop-60mi-any', mode: 'loop', stops: [P(45.0566, -92.8061, 'Stillwater MN')], loopKm: 96.5, direction: null, twistLevel: 1 },
  { id: 'loop-100mi-west', mode: 'loop', stops: [P(40.015, -105.2705, 'Boulder')], loopKm: 161, direction: 270, twistLevel: 2 },
  { id: 'loop-30mi-short', mode: 'loop', stops: [P(43.8014, -91.2396, 'La Crosse')], loopKm: 48, direction: 90, twistLevel: 1 },
];

const rows = [];
const problems = [];
const note = (id, msg) => { problems.push(`${id}: ${msg}`); console.log(`  ! ${msg}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. The raw shape of one answer, so parsing assumptions can be checked against the real thing.
try {
  const body = buildRequest(RIDES[0].stops, { alternates: 2 });
  const res = await liveFetch(`${DEFAULT_ENDPOINT}/route`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const raw = await res.json();
  console.log(`raw /route: HTTP ${res.status}; top keys ${Object.keys(raw)}; alternates ${raw.alternates?.length ?? 0}`);
  const m = raw.trip?.legs?.[0]?.maneuvers || [];
  console.log('maneuver keys seen:', [...new Set(m.flatMap((x) => Object.keys(x)))].sort().join(' '));
  console.log('first maneuvers:', JSON.stringify(m.slice(0, 3)));
  console.log('summary:', JSON.stringify(raw.trip?.summary), 'units:', raw.trip?.units);
  fs.writeFileSync(path.join(out, 'raw-boulder-estes.json'), JSON.stringify(raw));
  if (!raw.trip) note('raw', `no trip in answer: ${JSON.stringify(raw).slice(0, 300)}`);
} catch (e) { note('raw', `request failed: ${e.message}`); }

// 2. Each ride through the app's own planner.
for (const ride of RIDES) {
  console.log(`\n== ${ride.id}`);
  const t0 = Date.now();
  let calls = 0;
  const counting = (u, i) => { calls++; return liveFetch(u, i); };
  try {
    const routes = await planRide({ ...ride, prefs: { avoidHighways: true, pavedOnly: true }, maxDetour: 1.6, fetchImpl: counting, politeDelay: 1100 });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    routes.forEach((r, i) => {
      const row = { ride: ride.id, option: i + 1, km: +r.km.toFixed(1), min: Math.round(r.seconds / 60), twist: Math.round(r.twist), hwy: +(r.highwayShare * 100).toFixed(0),
        rough: +(r.roughShare * 100).toFixed(0), overlap: +(r.overlap * 100).toFixed(0), turns: r.maneuvers.length, pts: r.points.length, score: Math.round(r.score), vias: r.locations.filter((l) => l.through).length };
      rows.push(row);
      console.log(' ', JSON.stringify(row));
      if (!r.points.length || !r.maneuvers.length) note(ride.id, 'empty route');
      if (r.maneuvers.some((m) => !m.instruction)) note(ride.id, 'a maneuver has no instruction');
      if (r.maneuvers.at(-1).idx !== r.points.length - 1) note(ride.id, `last maneuver idx ${r.maneuvers.at(-1).idx} is not the last point ${r.points.length - 1}`);
      if (r.highwayShare > 0.15) note(ride.id, `option ${i + 1} is ${row.hwy}% highway with highways avoided`);
      if (r.overlap > 0.12) note(ride.id, `option ${i + 1} doubles back on ${row.overlap}% of its length`);
      if (ride.mode === 'loop' && Math.abs(r.km - ride.loopKm) / ride.loopKm > 0.3) note(ride.id, `option ${i + 1} is ${row.km} km for a ${ride.loopKm} km loop`);
    });
    console.log(`  ${routes.length} options, ${calls} server calls, ${secs}s`);
    if (ride.mode === 'ab' && ride.twistLevel > 0 && routes.length < 2) note(ride.id, 'only one option came back');
    // Guidance, HUD frames and GPX over the best route: nothing should throw, every turn should be announced.
    const best = routes[0];
    const g = new Guidance(best);
    let spoken = 0, frames = 0, arrived = false;
    for (let i = 0; i < best.points.length; i += Math.max(1, Math.floor(best.points.length / 4000))) {
      const u = g.update(best.points[i]);
      if (u.speak) spoken++;
      if (toNavFrame(g, u).v === 1) frames++;
      arrived ||= u.arrived;
    }
    arrived ||= g.update(best.points.at(-1)).arrived;
    console.log(`  guidance: ${spoken} prompts for ${best.maneuvers.length} maneuvers, arrived=${arrived}, gpx ${toGpx(ride.id, best).length} bytes`);
    if (!arrived) note(ride.id, 'guidance never reported arrival');
    if (spoken < best.maneuvers.length - 2) note(ride.id, `only ${spoken} spoken prompts for ${best.maneuvers.length} maneuvers`);
    // A compact fixture: the exact locations plus what the server answered for them.
    const [exact] = await requestRoutes(best.locations, { avoidHighways: true, pavedOnly: true }, DEFAULT_ENDPOINT, liveFetch);
    if (Math.abs(exact.km - best.km) / best.km > 0.01) note(ride.id, `re-requesting the chosen locations gave ${exact.km.toFixed(1)} km, not ${best.km.toFixed(1)} (share links would differ)`);
    fs.writeFileSync(path.join(out, `${ride.id}.json`), JSON.stringify({ ride, locations: best.locations, km: best.km, seconds: best.seconds, twist: best.twist,
      maneuvers: best.maneuvers, points: best.points.map((p) => [+p[0].toFixed(5), +p[1].toFixed(5)]) }));
  } catch (e) {
    note(ride.id, `planning failed: ${e.message}`);
  }
  await sleep(1500);
}

// 3. Place search as the app asks it.
console.log('\n== place search');
for (const q of ['Estes Park', 'Tail of the Dragon', 'Stillwater', '123 Main St Minneapolis']) {
  try {
    const res = await liveFetch(`https://photon.komoot.io/api/?limit=5&lang=en&q=${encodeURIComponent(q)}&lat=45&lon=-93`);
    const data = await res.json();
    const f = data.features || [];
    console.log(`  "${q}": HTTP ${res.status}, ${f.length} results; first: ${JSON.stringify(f[0]?.properties && { name: f[0].properties.name, city: f[0].properties.city, state: f[0].properties.state, type: f[0].properties.type, osm_value: f[0].properties.osm_value })} cors=${res.headers.get('access-control-allow-origin')}`);
    if (!f.length) note('search', `no results for "${q}"`);
  } catch (e) { note('search', `"${q}" failed: ${e.message}`); }
  await sleep(1000);
}

// 4. Can a browser on the live site call the routing server? (CORS preflight as Chrome sends it.)
try {
  const res = await liveFetch(`${DEFAULT_ENDPOINT}/route`, { method: 'OPTIONS', headers: { Origin: 'https://javamomma.github.io', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  console.log(`\nCORS preflight to routing: HTTP ${res.status}, allow-origin=${res.headers.get('access-control-allow-origin')}, allow-headers=${res.headers.get('access-control-allow-headers')}`);
  if (!res.headers.get('access-control-allow-origin')) note('cors', 'routing server sent no Access-Control-Allow-Origin on the preflight');
} catch (e) { note('cors', `preflight failed: ${e.message}`); }

fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ at: new Date().toISOString(), rows, problems }, null, 1));
console.log(`\n==== ${rows.length} route options over ${RIDES.length} rides; ${problems.length} problems`);
problems.forEach((p) => console.log(' - ' + p));
