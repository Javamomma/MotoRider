import { encodePolyline, destination } from '../js/geo.js';

/** A straight line of n points, stepM apart, heading brg. */
export function straight(start, brg, n, stepM = 50) {
  const pts = [start];
  for (let i = 1; i < n; i++) pts.push(destination(pts[i - 1], brg, stepM));
  return pts;
}

/** A zig-zag road that changes heading by ±turn every segment. */
export function wiggly(start, brg, n, turn = 30, stepM = 50) {
  const pts = [start];
  for (let i = 1; i < n; i++) pts.push(destination(pts[i - 1], brg + (i % 2 ? turn : -turn), stepM));
  return pts;
}

/** Minimal Valhalla-shaped trip for a single leg. */
export function fakeTrip(points, { km = 10, time = 900, highway = false } = {}) {
  return {
    summary: { length: km, time },
    legs: [{
      shape: encodePolyline(points, 6),
      maneuvers: [
        { type: 1, instruction: 'Head north.', length: km, time, begin_shape_index: 0, highway, verbal_pre_transition_instruction: 'Head north.' },
        { type: 4, instruction: 'You have arrived.', length: 0, time: 0, begin_shape_index: points.length - 1 },
      ],
    }],
  };
}
