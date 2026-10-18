import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePolyline, encodePolyline, haversine, destination, twistiness, overlapFraction, resample } from '../js/geo.js';
import { straight, wiggly } from './helpers.mjs';

test('polyline round-trips at precision 6', () => {
  const pts = [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]];
  const back = decodePolyline(encodePolyline(pts, 6), 6);
  back.forEach((p, i) => { assert.ok(Math.abs(p[0] - pts[i][0]) < 1e-6); assert.ok(Math.abs(p[1] - pts[i][1]) < 1e-6); });
});

test('decodes the reference Google polyline (precision 5)', () => {
  const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
  assert.deepEqual(pts.map((p) => p.map((v) => +v.toFixed(3))), [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
});

test('destination and haversine agree', () => {
  const p = destination([45, -100], 37, 12345);
  assert.ok(Math.abs(haversine([45, -100], p) - 12345) < 1);
});

test('resample spaces points evenly', () => {
  const r = resample(straight([40, -105], 0, 11, 100), 40);
  for (let i = 1; i < r.length - 1; i++) assert.ok(Math.abs(haversine(r[i - 1], r[i]) - 40) < 0.5);
});

test('straight roads score near zero, wiggly roads score high', () => {
  const flat = twistiness(straight([40, -105], 45, 200));
  const twisty = twistiness(wiggly([40, -105], 45, 200, 25));
  assert.ok(flat < 2, `straight: ${flat}`);
  assert.ok(twisty > 150, `wiggly: ${twisty}`);
});

test('overlapFraction detects out-and-back spurs', () => {
  const out = straight([40, -105], 90, 60, 50);
  const spur = [...out, ...out.slice().reverse()];
  assert.ok(overlapFraction(out) === 0);
  assert.ok(overlapFraction(spur) > 0.35);
});
