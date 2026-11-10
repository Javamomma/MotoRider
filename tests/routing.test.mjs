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

test('planner-made via points snap to through roads; pinned ones do not', () => {
  const r = buildRequest([A, { lat: 40.2, lon: -105.2, through: true, major: true }, { lat: 40.3, lon: -105.1, through: true }, B], {});
  assert.deepEqual(r.locations[1].search_filter, { min_road_class: 'tertiary' });
  assert.equal(r.locations[1].radius, 1000);
  assert.equal(r.locations[2].search_filter, undefined);
  assert.ok(detourCandidates([A, B], 1)[0][1].major);
  assert.ok(loopCandidates(A, 100, 0, 1)[0][2].major);
});

test('an alternate is pinned to its own road so it can be asked for again', async () => {
  const first = straight([40, -105], 30, 200), second = wiggly([40, -105], 30, 200, 25);
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ trip: fakeTrip(first), alternates: [{ trip: fakeTrip(second) }] }) });
  const { requestRoutes, pinned } = await import('../js/routing.js');
  const [a, b] = await requestRoutes([A, B], { alternates: 2 }, 'https://x.test', fetchImpl);
  assert.equal(a.locations.length, 2);
  assert.equal(b.locations.length, 5);
  assert.ok(b.locations.slice(1, 4).every((l) => l.through && !l.major));
  // The pins lie on the alternate's own line, about a quarter, half and three quarters along.
  const mid = b.locations[2];
  assert.ok(second.some((p) => Math.abs(p[0] - mid.lat) < 1e-5 && Math.abs(p[1] - mid.lon) < 1e-5));
  assert.equal(pinned([A, B], first.slice(0, 3)).length, 2);
});

test('options that double back, leave the pavement or run far too long are not offered', async () => {
  const { acceptable } = await import('../js/routing.js');
  const ok = { km: 60, overlap: 0.02, roughShare: 0 };
  assert.ok(acceptable(ok, { baseKm: 50 }));
  assert.ok(!acceptable({ ...ok, overlap: 0.2 }, { baseKm: 50 }));
  assert.ok(!acceptable({ ...ok, roughShare: 0.3 }, { baseKm: 50 }));
  assert.ok(acceptable({ ...ok, roughShare: 0.3 }, { baseKm: 50, pavedOnly: false }));
  assert.ok(!acceptable({ ...ok, km: 150 }, { baseKm: 50 }));
  assert.ok(!acceptable({ ...ok, km: 250 }, { targetKm: 160 }));
});

test('a loop that comes back far too long is resized and tried again', async () => {
  const sizes = [];
  const fetchImpl = async (url, init) => {
    const locs = JSON.parse(init.body).locations;
    const span = haversine([locs[0].lat, locs[0].lon], [locs[2].lat, locs[2].lon]) / 1000;
    sizes.push(span);
    // Mountain roads: the ride is eight times the circle's width.
    return { ok: true, status: 200, json: async () => ({ trip: fakeTrip(wiggly([40, -105], 30, 300, 20), { km: span * 8 }) }) };
  };
  const routes = await planRide({ mode: 'loop', stops: [A], loopKm: 100, direction: 90, twistLevel: 1, fetchImpl, politeDelay: 0 });
  assert.equal(sizes.length, 6); // three headings, each tried twice
  assert.ok(sizes[1] < sizes[0] * 0.7, `resized ${sizes[0]} -> ${sizes[1]}`);
  assert.ok(Math.abs(routes[0].km - 100) < 30, `${routes[0].km} km`);
});
