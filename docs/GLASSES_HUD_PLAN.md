# ZAMA on Meta Ray-Ban Display — plan

Goal: while riding, the next turn shows in the glasses and the phone stays in a pocket or on the bars. ZAMA keeps doing the planning, GPS and guidance on the phone; the glasses only **display** a tiny, glanceable "next turn" card.

## What we're working with

| Piece | Where | Status |
| --- | --- | --- |
| ZAMA | this repo, web app (PWA) on the phone | live; guidance stops when the screen locks |
| glasses-hud | `~/Projects/glasses-hud` on the Mac mini (Bun/TS, 600×600 web app, tailnet-only `:8443`) | built; untested on glasses until they arrive Dec 8 |
| Argus | `Javamomma/MetaGlassesAI` branch `claude/modest-mayer-307i3g` (Android, `DisplayCard` → DAT `Display.sendContent`, 32×7 chars, ≤1 redraw/300 ms) | emulator only; DAT display APIs are experimental and need a Meta Developer Center app ID |

The Display panel is 600×600 at 30 Hz, black is transparent, keep 24 px clear at the edges. Glasses accept one companion session at a time.

## The shared contract: `NavFrame`

Everything below speaks one small JSON message, so the display side can change without touching ZAMA's routing.

```json
{
  "v": 1,
  "ts": 1767800000000,
  "state": "navigating",
  "next": { "icon": "right", "text": "Turn right onto Ridge Road", "distM": 420 },
  "then": { "icon": "left" },
  "remainingM": 38200,
  "eta": "3:42 PM",
  "ride": "Sunday canyon loop"
}
```

- `state`: `navigating` | `offroute` | `arrived` | `idle`
- `icon`: `straight` `slight-right` `right` `sharp-right` `uturn` `sharp-left` `left` `slight-left` `merge` `roundabout` `ferry` `arrive`
- `then` is optional: shown small when the following turn is < 300 m after `next`.
- Sent on change, at most once per second; `distM` is rounded (10 m under 200 m, 50 m under 1 km, 100 m above).

Mapping to an Argus `DisplayCard`: `title` = distance ("420 m" / "0.3 mi"), `body` = `next.text` (fits 28×6), `contentType = STATUS`, `priority = HIGH` under 150 m else `NORMAL`, `group = "zama"`. Off-route → `NOTIFICATION` "Off route — rerouting". Arrived → card for 10 s then clear.

## Glance design (600×600)

Big arrow (≈220 px) top-centre, distance under it in large type, street name one line below, nothing else. White/amber on transparent black, no map, no animation except the distance number. A tap (index pinch) toggles a second card: remaining distance + ETA. Nothing on screen requires input while riding.

## Phases

**Phase 0 — before the glasses arrive (ZAMA side, can start now)**
1. Extract a `toNavFrame(update)` function from ZAMA's guidance (`js/nav.js`), with unit tests.
2. Add `hud.html`: a 600×600 glance page that renders a `NavFrame` per the design above. Testable in any desktop browser at 600×600.
3. Add a "Glasses" toggle in ZAMA settings that, during a ride, POSTs each `NavFrame` to a configurable HUD URL.

**Phase 1 — Dec 8, with glasses-hud (quickest path)**
1. glasses-hud adds two routes: `POST /api/nav` (store latest frame, shared-secret header) and `GET /api/nav/stream` (Server-Sent Events) plus a **Ride** tile that renders the frame (reuse ZAMA's `hud.html`).
2. Phone runs ZAMA (Tailscale on the phone so it can reach the Mac mini). Glasses open the Ride tile.
3. Checks on real hardware: does the Display's browser reach the tailnet URL (the existing `/probe` page answers this), does SSE keep updating with the screen off on the phone, latency phone → mini → glasses on 5G.
- Weakness: needs cell signal and the Mac mini up; ZAMA in a phone browser still pauses when the phone locks.

**Phase 2 — the robust version: ZAMA Android app talking to the glasses directly**
1. Wrap ZAMA with Capacitor (same web code) and add native background GPS + voice, so guidance runs with the screen off.
2. Add Meta's Device Access Toolkit and render `NavFrame` with `Display.sendContent` (arrow image + two text lines), reusing Argus's `DatHud` renderer and 300 ms redraw limit. No Mac mini, no relay, works in dead zones once the route is loaded.
3. Neural Band: tap = toggle ETA card, swipe = mute voice.
- Needs: Meta Developer Center app ID/token, sideloaded build (experimental display APIs can't be published to the store yet). Only one companion app can hold the glasses at a time, so this runs instead of Argus during a ride.

**Phase 3 — nice to have**
Offline route caching for dead zones; "family ride" mode (riders share live position + the same route); speed-limit and curve warnings ahead of tight corners.

## Open questions to settle on Dec 8
- Does the Display fit comfortably under your helmet (full-face vs. open-face)? This decides whether the glasses are the main display or a passenger/off-bike tool.
- Does the Display browser hold an SSE connection, or must the page poll?
- Is the Meta AI app or Visor going to be the glasses companion? (Argus and DAT can't both be.)

## Safety rules for the display
Glanceable only: one instruction at a time, no scrolling text, no notifications from other apps during a ride, auto-dim between turns (show the card from 800 m before a turn until the turn is done, otherwise just a small distance-to-turn line).
