import test from 'node:test';
import assert from 'node:assert/strict';
import { toNavFrame, roundDist, iconFor, HudPublisher, idleFrame } from '../js/hudframe.js';
import { viewModel, streetOf, formatDist, arrowSvg } from '../js/hudview.js';
import { demoFrames } from '../js/huddemo.js';
import { Guidance } from '../js/nav.js';
import { parseTrip } from '../js/routing.js';
import { straight, fakeTrip } from './helpers.mjs';

function twoTurnRoute() {
  const pts = straight([40, -105], 0, 101, 50); // 5 km
  const trip = fakeTrip(pts, { km: 5 });
  trip.legs[0].maneuvers.splice(1, 0,
    { type: 10, instruction: 'Turn right onto Ridge Road.', length: 0, time: 0, begin_shape_index: 60 },
    { type: 15, instruction: 'Turn left onto Lefthand Canyon Drive.', length: 0, time: 0, begin_shape_index: 64 });
  return { pts, guide: new Guidance(parseTrip(trip)) };
}

test('roundDist and icons', () => {
  assert.equal(roundDist(123), 120);
  assert.equal(roundDist(437), 450);
  assert.equal(roundDist(3449), 3400);
  assert.equal(iconFor(10), 'right');
  assert.equal(iconFor(26), 'roundabout');
  assert.equal(iconFor(999), 'straight');
});

test('toNavFrame builds the contract, with "then" for a close follow-up turn', () => {
  const { pts, guide } = twoTurnRoute();
  const f = toNavFrame(guide, guide.update(pts[50]), { eta: '3:42 PM', ride: 'Test', now: 5 });
  assert.equal(f.v, 1);
  assert.equal(f.ts, 5);
  assert.equal(f.state, 'navigating');
  assert.deepEqual(f.next, { icon: 'right', text: 'Turn right onto Ridge Road.', distM: 500 });
  assert.deepEqual(f.then, { icon: 'left' }); // 200 m after the right turn
  assert.equal(f.remainingM, 2500);
  assert.equal(f.eta, '3:42 PM');
});

test('toNavFrame reports off-route and arrival', () => {
  const { pts, guide } = twoTurnRoute();
  const away = [pts[30][0], pts[30][1] + 0.01];
  guide.update(away); guide.update(away);
  assert.equal(toNavFrame(guide, guide.update(away)).state, 'offroute');
  assert.equal(toNavFrame(guide, guide.update(pts[100])).state, 'arrived');
});

test('publisher sends on change, throttles to once a second, and posts with the key', async () => {
  let t = 0;
  const posts = [];
  const sent = [];
  const pub = new HudPublisher({
    url: 'https://hud.example/api/nav', key: 'k1', clock: () => t,
    channel: { postMessage: (f) => sent.push(f), close() {} },
    fetchImpl: async (url, init) => { posts.push({ url, init }); return { ok: true }; },
  });
  const frame = (d, state = 'navigating') => ({ v: 1, ts: t, state, next: { icon: 'right', text: 'x', distM: d } });
  assert.equal(pub.publish(frame(500)), true);
  t = 200; assert.equal(pub.publish(frame(500)), false, 'unchanged');
  t = 400; assert.equal(pub.publish(frame(450)), false, 'throttled');
  t = 1100; assert.equal(pub.publish(frame(450)), true);
  t = 1200; assert.equal(pub.publish(frame(450, 'offroute')), true, 'state change skips the throttle');
  pub.close();
  assert.equal(sent.length, 4);
  assert.equal(sent[3].state, 'idle');
  assert.equal(posts.length, 4);
  assert.equal(posts[0].init.headers.Authorization, 'Bearer k1');
  assert.equal(JSON.parse(posts[0].init.body).next.distM, 500);
});

test('publisher without a URL only mirrors to local tabs', () => {
  const sent = [];
  let called = false;
  const pub = new HudPublisher({ channel: { postMessage: (f) => sent.push(f) }, fetchImpl: () => { called = true; } });
  pub.publish(idleFrame(1));
  assert.equal(sent.length, 1);
  assert.equal(called, false);
});

test('view model: compact far away, full card near, ETA toggle, stale, arrived', () => {
  const now = 100000;
  const f = (distM, extra = {}) => ({ v: 1, ts: now, state: 'navigating', next: { icon: 'right', text: 'Turn right onto Ridge Road.', distM }, remainingM: 38200, eta: '3:42 PM', ...extra });
  assert.equal(viewModel(f(4800), { now }).mode, 'compact');
  const near = viewModel(f(120, { then: { icon: 'left' } }), { now });
  assert.equal(near.mode, 'turn');
  assert.equal(near.street, 'Ridge Road');
  assert.equal(near.then, 'left');
  assert.deepEqual(near.dist, { value: '400', unit: 'ft' });
  assert.equal(viewModel(f(120), { now, showEta: true }).eta, 'Arrive 3:42 PM');
  assert.equal(viewModel(f(120), { now: now + 20000 }).state, 'stale');
  assert.equal(viewModel(f(120, { state: 'offroute' }), { now }).street, 'Off route — rerouting');
  assert.equal(viewModel({ v: 1, ts: now, state: 'arrived' }, { now }).mode, 'msg');
  assert.equal(viewModel(null).mode, 'msg');
});

test('formatting helpers', () => {
  assert.equal(streetOf('Bear left onto Lefthand Canyon Drive.'), 'Lefthand Canyon Drive');
  assert.equal(streetOf('Continue.'), 'Continue');
  assert.deepEqual(formatDist(800, 'km'), { value: '800', unit: 'm' });
  assert.deepEqual(formatDist(16093.44), { value: '10', unit: 'mi' });
  for (const i of ['right', 'uturn', 'roundabout', 'arrive', 'ferry', 'merge']) assert.match(arrowSvg(i), /<path|<circle/);
  for (const d of demoFrames()) assert.equal(d.v, 1);
});

test('default fetch is bound so browsers accept the call', async () => {
  const realFetch = globalThis.fetch;
  let thisArg = 'unset';
  globalThis.fetch = function (url, init) { thisArg = this; return Promise.resolve({ ok: true }); };
  try {
    const pub = new HudPublisher({ url: 'https://hud.example/api/nav', channel: { postMessage() {} } });
    pub.publish(idleFrame(1));
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(thisArg, globalThis);
  } finally {
    globalThis.fetch = realFetch;
  }
});
