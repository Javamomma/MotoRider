import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeRide, decodeRide, shareUrl, rideFromHash, toGpx, savedRides } from '../js/share.js';
import { Guidance, spokenDistance } from '../js/nav.js';
import { parseTrip } from '../js/routing.js';
import { destination } from '../js/geo.js';
import { straight, fakeTrip } from './helpers.mjs';

const ride = {
  name: 'Sunday loop — café ☕',
  locations: [{ lat: 40.01234567, lon: -105.3, name: 'Home' }, { lat: 40.2, lon: -105.1, through: true }, { lat: 40.01234567, lon: -105.3, name: 'Home' }],
  prefs: { avoidHighways: true, avoidTolls: true, pavedOnly: true },
};

test('share links round-trip, including unicode names and via points', () => {
  const back = decodeRide(encodeRide(ride));
  assert.equal(back.name, ride.name);
  assert.equal(back.locations[1].through, true);
  assert.equal(back.locations[0].lat, 40.01235);
  assert.deepEqual(back.prefs, ride.prefs);
  const url = shareUrl(ride, 'https://example.com/MotoRider/?x=1#old');
  assert.ok(url.startsWith('https://example.com/MotoRider/?x=1#ride='));
  assert.equal(rideFromHash(new URL(url).hash).name, ride.name);
  assert.equal(rideFromHash('#nothing'), null);
});

test('bad links are rejected', () => {
  assert.throws(() => decodeRide('bm90IGpzb24'));
});

test('GPX contains route and track', () => {
  const r = parseTrip(fakeTrip(straight([40, -105], 0, 10)));
  const gpx = toGpx('A & B <ride>', r);
  assert.match(gpx, /<name>A &amp; B &lt;ride&gt;<\/name>/);
  assert.equal((gpx.match(/<trkpt /g) || []).length, 10);
  assert.equal((gpx.match(/<rtept /g) || []).length, 2);
});

test('saved rides store and remove', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  savedRides.save({ id: '1', name: 'one' }, storage);
  savedRides.save({ id: '2', name: 'two' }, storage);
  assert.deepEqual(savedRides.list(storage).map((r) => r.id), ['2', '1']);
  savedRides.remove('1', storage);
  assert.equal(savedRides.list(storage).length, 1);
});

test('guidance tracks progress, announces turns once, and flags off-route', () => {
  const pts = straight([40, -105], 0, 101, 50); // 5 km north
  const trip = fakeTrip(pts, { km: 5 });
  trip.legs[0].maneuvers.splice(1, 0, { type: 10, instruction: 'Turn right onto Ridge Road.', verbal_transition_alert_instruction: 'Turn right onto Ridge Road.', verbal_pre_transition_instruction: 'Turn right onto Ridge Road.', length: 0, time: 0, begin_shape_index: 60 });
  const g = new Guidance(parseTrip(trip));

  let u = g.update(pts[0]);
  assert.equal(u.next.instruction, 'Turn right onto Ridge Road.');
  assert.ok(Math.abs(u.distanceToNext - 3000) < 5);

  u = g.update(pts[45]); // 750 m before the turn
  assert.match(u.speak, /^In half a mile, turn right/);
  assert.equal(g.update(pts[46]).speak, null);
  u = g.update(pts[58]);
  assert.equal(u.speak, 'Turn right onto Ridge Road.');

  const away = destination(pts[70], 90, 300);
  assert.equal(g.update(away).offRoute, false);
  g.update(away);
  assert.equal(g.update(away).offRoute, true);
  assert.equal(g.update(pts[100]).arrived, true);
});

test('spoken distances', () => {
  assert.equal(spokenDistance(800), 'half a mile');
  assert.equal(spokenDistance(5000), '3.1 miles');
  assert.equal(spokenDistance(100), '300 feet');
});
