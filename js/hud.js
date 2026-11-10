// hud.html: renders NavFrames for the glasses.
//
// Frame sources, picked from the URL:
//   ?src=<url>   Server-Sent Events stream (e.g. glasses-hud's /api/nav/stream)
//   ?poll=<url>  poll a JSON endpoint once a second (fallback if SSE is buffered)
//   ?demo        cycle through sample frames
//   (none)       mirror a ZAMA ride running in another tab on this device
// Also: ?units=km, ?key=<token> (sent as ?key= on src/poll URLs).

import { arrowSvg, viewModel, STALE_AFTER_MS } from './hudview.js';
import { demoFrames } from './huddemo.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const units = params.get('units') === 'km' ? 'km' : 'mi';
let frame = null;
let showEta = false;

function render() {
  const vm = viewModel(frame, { units, showEta });
  const hud = $('#hud');
  hud.dataset.state = vm.state;
  $('#turn').hidden = vm.mode !== 'turn';
  $('#compact').hidden = vm.mode !== 'compact';
  $('#eta').hidden = vm.mode !== 'eta';
  $('#msg').textContent = vm.mode === 'msg' ? vm.text : '';

  if (vm.mode === 'turn') {
    $('#arrow').innerHTML = arrowSvg(vm.icon);
    $('#dist').innerHTML = `${vm.dist.value}<small>${vm.dist.unit}</small>`;
    $('#street').textContent = vm.street;
    $('#then').hidden = !vm.then;
    if (vm.then) $('#then svg').innerHTML = arrowSvg(vm.then);
  } else if (vm.mode === 'compact') {
    $('#compact svg').innerHTML = arrowSvg(vm.icon);
    $('#compact span').textContent = vm.text;
  } else if (vm.mode === 'eta') {
    $('#eta-rem').textContent = vm.remaining;
    $('#eta-time').textContent = vm.eta;
    $('#eta-ride').textContent = vm.ride;
  }
}

function receive(f) {
  if (!f || f.v !== 1) return;
  frame = f;
  render();
}

// A tap or pinch (click / Enter / Space) toggles the ETA card.
const toggle = () => { showEta = !showEta; render(); };
document.addEventListener('click', toggle);
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });

const withKey = (url) => {
  const key = params.get('key');
  if (!key) return url;
  const u = new URL(url, location.href);
  u.searchParams.set('key', key);
  return u.toString();
};

if (params.has('demo')) {
  let i = 0;
  const frames = demoFrames();
  const next = () => { receive({ ...frames[i % frames.length], ts: Date.now() }); i++; };
  next();
  setInterval(next, 2500);
} else if (params.get('src')) {
  const es = new EventSource(withKey(params.get('src')));
  es.onmessage = (e) => { try { receive(JSON.parse(e.data)); } catch { /* ignore bad frame */ } };
} else if (params.get('poll')) {
  const url = withKey(params.get('poll'));
  const poll = async () => {
    try { const r = await fetch(url, { cache: 'no-store' }); if (r.ok) receive(await r.json()); } catch { /* offline */ }
  };
  poll();
  setInterval(poll, 1000);
} else if ('BroadcastChannel' in window) {
  new BroadcastChannel('zama-hud').onmessage = (e) => receive(e.data);
  $('#msg').textContent = 'Waiting for ZAMA…';
}

// Re-render periodically so a dead connection shows as stale.
setInterval(render, STALE_AFTER_MS / 3);
render();
if (!frame && !params.has('demo')) $('#msg').textContent ||= 'Waiting for ZAMA…';
