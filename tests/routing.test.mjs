import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, parseTrip, planRide, loopCandidates, detourCandidates, scoreRoute } from '../js/routing.js';
import { haversine } from '../js/geo.js';
import { straight, wiggly, fakeTrip } from './helpers.mjs';

const A = { lat: 40.0, lon: -105.3, name: 'A' };
const B = { lat: 40.4, lon: -105.0, name: 'B' };

test('request avoids highways, trails and unpaved roads by default', () => {
  const r = buildRequest([A, { ...B, through: true }, B], {});
  const m = r.costing_options.motorcycle;
  assert.equal(r.costing, 'motorcycle');
  assert.equal(m.use_highways, 0);
  assert.equal(m.use_trails, 0);
  assert.equal(m.exclude_unpaved, true);
  assert.deepEqual(r.locations.map((l) => l.type), ['break', 'through', 'break']);
});

test('parseTrip computes highway share from maneuvers', () => {
  const r = parseTrip(fakeTrip(straight([40, -105], 0, 50), { highway: true }));
  assert.equal(r.highwayShare, 1);
  assert.equal(r.points.length, 50);
  assert.equal(r.maneuvers[1].idx, 49);
});

test('detours add one sideways via point per long leg', () => {
  const c = detourCandidates([A, B], 2);
  assert.equal(c.length, 4);
  for (const list of c) {
    assert.equal(list.length, 3);
    assert.ok(list[1].through);
  }
  assert.equal(detourCandidates([A, B], 0).length, 0);
});

test('loop candidates start and end at home, roughly the right size', () => {
  const [c] = loopCandidates(A, 100, 90, 1);
  assert.equal(c.length, 5);
  assert.equal(c[0].lat, c[4].lat);
  let ring = 0;
  for (let i = 1; i < c.length; i++) ring += haversine([c[i - 1].lat, c[i - 1].lon], [c[i].lat, c[i].lon]);
  assert.ok(ring > 50000 && ring < 100000, `ring ${ring}`);
  // Heading east means the loop's via points sit east of the start.
  assert.ok(c[2].lon > A.lon);
});

test('scoring prefers twisty over highway and punishes long detours', () => {
  const base = { twist: 120, highwayShare: 0, roughShare: 0, overlap: 0, km: 50 };
  assert.ok(scoreRoute(base) > scoreRoute({ ...base, highwayShare: 0.5 }));
  assert.ok(scoreRoute(base, { baseKm: 50 }) > scoreRoute({ ...base, km: 120 }, { baseKm: 50, maxDetour: 1.5 }));
});

test('planRide picks the curviest candidate first', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    // The direct route is straight; every detour comes back twisty.
    const pts = calls.length === 1 ? straight([40, -105], 30, 300) : wiggly([40, -105], 30, 300, 15 + calls.length * 5);
    return { ok: true, status: 200, json: async () => ({ trip: fakeTrip(pts, { km: 15 + calls.length }) }) };
  };
  const routes = await planRide({ mode: 'ab', stops: [A, B], twistLevel: 1, prefs: {}, fetchImpl, politeDelay: 0 });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].alternates, 2);
  assert.ok(routes.length >= 2);
  assert.ok(routes[0].twist > routes[routes.length - 1].twist);
  assert.equal(routes[0].locations.length, 3);
});

test('planRide surfaces routing errors', async () => {
  const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: 'No path could be found for input' }) });
  await assert.rejects(planRide({ mode: 'ab', stops: [A, B], fetchImpl, politeDelay: 0 }), /No route found/);
});
