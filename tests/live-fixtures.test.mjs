// Real answers from the routing server (tests/live/shakedown.mjs), replayed through guidance, HUD frames and GPX.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Guidance } from '../js/nav.js';
import { toNavFrame } from '../js/hudframe.js';
import { toGpx, decodeRide, encodeRide } from '../js/share.js';
import { twistiness, overlapFraction } from '../js/geo.js';

const dir = new URL('./fixtures/live/', import.meta.url);
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const fx = JSON.parse(fs.readFileSync(new URL(file, dir)));
  test(`real ride ${file}: guidance reaches the end and announces the turns`, () => {
    const route = { points: fx.points, maneuvers: fx.maneuvers, km: fx.km, seconds: fx.seconds };
    const g = new Guidance(route);
    let spoken = 0, last;
    for (const p of fx.points) {
      last = g.update(p);
      if (last.speak) spoken++;
      assert.equal(last.offRoute, false);
      assert.equal(toNavFrame(g, last).v, 1);
    }
    assert.ok(last.arrived, 'arrived');
    assert.ok(spoken >= fx.maneuvers.length - 2, `${spoken} prompts for ${fx.maneuvers.length} maneuvers`);
    // Fixture points are rounded to about a metre, which nudges the figure on the tightest roads.
    assert.ok(Math.abs(twistiness(fx.points) - fx.twist) / fx.twist < 0.05);
    assert.ok(overlapFraction(fx.points) <= 0.12);
    assert.match(toGpx(file, route), /<trkpt /);
    const ride = { name: file, locations: fx.locations, prefs: {} };
    assert.equal(decodeRide(encodeRide(ride)).locations.length, fx.locations.length);
  });
}
