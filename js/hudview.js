// Pure presentation logic for hud.html, kept DOM-free so it can be unit tested.

export const FULL_CARD_WITHIN_M = 800;
export const STALE_AFTER_MS = 15000;

const ROTATION = {
  straight: 0, 'slight-right': 45, right: 90, 'sharp-right': 135,
  'slight-left': -45, left: -90, 'sharp-left': -135, merge: 20,
};

/** Inline SVG markup (viewBox -100..100) for a NavFrame icon. */
export function arrowSvg(icon) {
  if (icon === 'uturn') {
    return '<path class="shape" d="M-40 80 V-20 A40 40 0 0 1 40 -20 V40"/><path class="head" d="M40 85 L5 30 H75 Z"/>';
  }
  if (icon === 'roundabout') {
    return '<circle class="shape" cx="0" cy="-10" r="42"/><path class="shape" d="M0 85 V32"/><path class="head" d="M30 -70 L75 -48 L35 -20 Z"/>';
  }
  if (icon === 'arrive') {
    return '<path class="shape" d="M-40 85 V-80"/><path class="head" d="M-40 -80 H60 L35 -45 L60 -10 H-40 Z"/>';
  }
  if (icon === 'ferry') {
    return '<path class="shape" d="M-75 25 H75 L50 65 H-50 Z"/><path class="shape" d="M-30 25 V-35 H30 V25"/>';
  }
  const deg = ROTATION[icon] ?? 0;
  // Bent arrow: stem comes up from the bottom, then turns by `deg`.
  return `<path class="shape" d="M0 90 V10"/><g transform="translate(0 10) rotate(${deg})"><path class="shape" d="M0 0 V-55"/><path class="head" d="M0 -95 L-38 -45 H38 Z"/></g>`;
}

export function formatDist(m, units = 'mi') {
  if (units === 'km') {
    return m >= 1000 ? { value: (m / 1000).toFixed(m < 10000 ? 1 : 0), unit: 'km' } : { value: String(Math.round(m)), unit: 'm' };
  }
  const mi = m / 1609.344;
  if (mi >= 0.1) return { value: mi.toFixed(mi < 10 ? 1 : 0), unit: 'mi' };
  return { value: String(Math.round((m * 3.28084) / 50) * 50), unit: 'ft' };
}

/**
 * Decide what to show. Returns { mode, ... } where mode is
 * 'turn' | 'compact' | 'eta' | 'msg'.
 */
export function viewModel(frame, { units = 'mi', showEta = false, now = Date.now() } = {}) {
  if (!frame || frame.state === 'idle') return { mode: 'msg', text: '', state: 'idle' };
  if (frame.state === 'arrived') return { mode: 'msg', text: 'Arrived 🏁', state: 'arrived' };
  const stale = now - frame.ts > STALE_AFTER_MS;
  const state = stale ? 'stale' : frame.state;
  if (showEta) {
    const rem = formatDist(frame.remainingM ?? 0, units);
    return { mode: 'eta', state, remaining: `${rem.value} ${rem.unit}`, eta: frame.eta ? `Arrive ${frame.eta}` : '', ride: frame.ride || '' };
  }
  const d = formatDist(frame.next.distM, units);
  if (frame.state === 'offroute') {
    return { mode: 'turn', state, icon: 'uturn', dist: d, street: 'Off route — rerouting', then: null };
  }
  if (frame.next.distM > FULL_CARD_WITHIN_M) {
    return { mode: 'compact', state, icon: frame.next.icon, text: `${d.value} ${d.unit}` };
  }
  return { mode: 'turn', state, icon: frame.next.icon, dist: d, street: streetOf(frame.next.text), then: frame.then?.icon || null };
}

/** "Turn right onto Ridge Road." → "Ridge Road"; falls back to the whole instruction. */
export function streetOf(text = '') {
  const m = /\b(?:onto|on|toward|towards|to)\s+(.+?)\.?$/i.exec(text);
  return (m ? m[1] : text).replace(/\.$/, '');
}
