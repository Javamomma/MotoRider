// NavFrame: the small message the glasses HUD renders (see docs/GLASSES_HUD_PLAN.md).

const ICONS = {
  1: 'straight', 2: 'slight-right', 3: 'slight-left', 4: 'arrive', 5: 'arrive', 6: 'arrive',
  7: 'straight', 8: 'straight', 9: 'slight-right', 10: 'right', 11: 'sharp-right',
  12: 'uturn', 13: 'uturn', 14: 'sharp-left', 15: 'left', 16: 'slight-left',
  17: 'straight', 18: 'slight-right', 19: 'slight-left', 20: 'slight-right', 21: 'slight-left',
  22: 'straight', 23: 'slight-right', 24: 'slight-left', 25: 'merge', 26: 'roundabout', 27: 'roundabout',
  28: 'ferry', 29: 'ferry',
};

export const iconFor = (valhallaType) => ICONS[valhallaType] || 'straight';

/** Coarse distances so the frame only changes when the rider would notice. */
export function roundDist(m) {
  if (m < 200) return Math.round(m / 10) * 10;
  if (m < 1000) return Math.round(m / 50) * 50;
  return Math.round(m / 100) * 100;
}

const THEN_WINDOW_M = 300;

/**
 * Build a NavFrame from a Guidance update.
 * `guide` is the Guidance instance (for cumulative distances), `u` its latest update.
 */
export function toNavFrame(guide, u, { eta = '', ride = '', now = Date.now() } = {}) {
  const ms = guide.route.maneuvers;
  const state = u.arrived ? 'arrived' : u.offRoute ? 'offroute' : 'navigating';
  const frame = {
    v: 1,
    ts: now,
    state,
    next: { icon: iconFor(u.next.type), text: u.next.instruction, distM: roundDist(u.distanceToNext) },
    remainingM: roundDist(u.remainingM),
    eta,
    ride,
  };
  const after = ms[u.nextIndex + 1];
  if (after && state === 'navigating') {
    const last = guide.cum.length - 1;
    const gap = guide.cum[Math.min(after.idx, last)] - guide.cum[Math.min(u.next.idx, last)];
    if (gap < THEN_WINDOW_M) frame.then = { icon: iconFor(after.type) };
  }
  return frame;
}

export const idleFrame = (now = Date.now()) => ({ v: 1, ts: now, state: 'idle' });

/** Everything except the timestamp: used to skip sending unchanged frames. */
const sig = (f) => JSON.stringify({ ...f, ts: 0 });

/**
 * Sends frames to the glasses HUD (HTTP POST) and to any open hud.html tab
 * on this device (BroadcastChannel), at most once per `minIntervalMs` and
 * only when something visible changed. State changes always go out at once.
 */
export class HudPublisher {
  constructor({ url = '', key = '', minIntervalMs = 1000, fetchImpl = globalThis.fetch?.bind(globalThis), channel = null, clock = () => Date.now() } = {}) {
    this.url = url.trim();
    this.key = key;
    this.minIntervalMs = minIntervalMs;
    this.fetchImpl = fetchImpl;
    this.clock = clock;
    this.channel = channel ?? (typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('zama-hud') : null);
    this.lastSig = '';
    this.lastState = '';
    this.lastSent = -Infinity;
    this.failures = 0;
  }

  /** Returns true if the frame was sent. */
  publish(frame) {
    const s = sig(frame);
    const t = this.clock();
    if (s === this.lastSig) return false;
    if (frame.state === this.lastState && t - this.lastSent < this.minIntervalMs) return false;
    this.lastSig = s;
    this.lastState = frame.state;
    this.lastSent = t;
    try { this.channel?.postMessage(frame); } catch { /* tab channel unavailable */ }
    if (this.url && this.fetchImpl) {
      const headers = { 'Content-Type': 'application/json' };
      if (this.key) headers.Authorization = `Bearer ${this.key}`;
      this.fetchImpl(this.url, { method: 'POST', headers, body: JSON.stringify(frame), keepalive: true })
        .then((r) => { this.failures = r.ok ? 0 : this.failures + 1; })
        .catch(() => { this.failures += 1; });
    }
    return true;
  }

  close() {
    this.publish(idleFrame(this.clock()));
    try { this.channel?.close(); } catch { /* ignore */ }
  }
}
