// Turn-by-turn guidance: tracks progress along a route from GPS fixes and
// decides when to announce the next maneuver.

import { cumulative, nearestIndex } from './geo.js';

const OFF_ROUTE_M = 80;
const OFF_ROUTE_FIXES = 3;
const EARLY_ALERT_M = 800; // ~half a mile
const LATE_ALERT_M = 120;

export class Guidance {
  constructor(route) {
    this.route = route;
    this.cum = cumulative(route.points);
    this.total = this.cum[this.cum.length - 1];
    this.idx = 0;
    this.offCount = 0;
    this.spoken = new Set();
  }

  /**
   * Feed a GPS fix ([lat, lon]). Returns
   * { idx, distanceToRoute, next, distanceToNext, remainingM, offRoute, speak, arrived }.
   */
  update(p) {
    const pts = this.route.points;
    // Look ahead from the last known position so overlapping road
    // (out-and-back, figure eights) doesn't make us jump around.
    let near = nearestIndex(pts, p, this.idx - 5, this.idx + 600);
    if (near.distance > OFF_ROUTE_M) {
      const global = nearestIndex(pts, p);
      if (global.distance < near.distance - 20) near = global;
    }
    const offRoute = near.distance > OFF_ROUTE_M ? ++this.offCount >= OFF_ROUTE_FIXES : ((this.offCount = 0), false);
    if (near.distance <= OFF_ROUTE_M) this.idx = Math.max(this.idx, near.index);

    const ms = this.route.maneuvers;
    let nextI = ms.findIndex((m) => m.idx > this.idx);
    if (nextI < 0) nextI = ms.length - 1;
    const next = ms[nextI];
    const distanceToNext = Math.max(0, this.cum[Math.min(next.idx, pts.length - 1)] - this.cum[this.idx]);
    const remainingM = Math.max(0, this.total - this.cum[this.idx]);

    let speak = null;
    if (!offRoute) {
      if (distanceToNext <= LATE_ALERT_M && !this.spoken.has(`${nextI}:late`)) {
        speak = next.pre;
        this.spoken.add(`${nextI}:late`).add(`${nextI}:early`);
      } else if (distanceToNext <= EARLY_ALERT_M && distanceToNext > LATE_ALERT_M * 2 && !this.spoken.has(`${nextI}:early`)) {
        speak = `In ${spokenDistance(distanceToNext)}, ${lowerFirst(next.alert)}`;
        this.spoken.add(`${nextI}:early`);
      }
    }
    const arrived = remainingM < 40 && nextI === ms.length - 1;
    return { idx: this.idx, distanceToRoute: near.distance, next, nextIndex: nextI, distanceToNext, remainingM, offRoute, speak, arrived };
  }
}

const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);

export function spokenDistance(m, units = 'mi') {
  if (units === 'km') return m >= 1000 ? `${(m / 1000).toFixed(1).replace(/\.0$/, '')} kilometers` : `${Math.round(m / 50) * 50} meters`;
  const mi = m / 1609.344;
  if (mi >= 0.4 && mi < 0.6) return 'half a mile';
  if (mi >= 0.2 && mi < 0.4) return 'a quarter mile';
  if (mi >= 0.6) return `${mi.toFixed(1).replace(/\.0$/, '')} miles`;
  return `${Math.round((m * 3.28084) / 100) * 100} feet`;
}

/** Arrow glyph for a Valhalla maneuver type. */
export function maneuverIcon(type) {
  const map = {
    1: '⬆', 2: '↗', 3: '↖', 4: '🏁', 5: '🏁', 6: '🏁', 7: '⬆', 8: '⬆', 9: '↗', 10: '➡', 11: '↘',
    12: '↩', 13: '↩', 14: '↙', 15: '⬅', 16: '↖', 17: '⬆', 18: '↗', 19: '↖', 20: '↗', 21: '↖',
    22: '⬆', 23: '↗', 24: '↖', 25: '⤴', 26: '⟳', 27: '⟳', 28: '⛴', 29: '⛴',
  };
  return map[type] || '⬆';
}
