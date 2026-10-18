# ☯ ZAMA: Zen and the Art of Motorcycle Adventure

*The ride is the destination.* A nod to Robert Pirsig's *Zen and the Art of Motorcycle Maintenance*, ZAMA is a phone app for planning **motorcycle-friendly rides**: scenic, twisty, paved roads with no major highways. It gives turn-by-turn voice directions, and you can **share any ride with family** by sending a link.

It's a web app that installs to your home screen (iPhone and Android), so there's no app store involved and nothing to pay for.

## What it does

- **A → B rides.** Pick a destination, add stops if you want, and ZAMA finds curvy back-road routes to get there.
- **Loop rides.** Choose a length (say 60 mi) and a direction, and get a round trip that starts and ends at home.
- **Ride style.** Choose *Direct*, *Curvy* or *Twistiest*, and how much extra distance you'll accept for better roads. Major highways, dirt/gravel and tolls can each be turned on or off.
- **Up to 3 route options**, each showing distance, time, a twistiness rating (degrees of curve per km), and how much of it is on highways.
- **Ride mode.** Full-screen turn-by-turn guidance with spoken directions. It keeps the screen awake, shows your ETA, and offers to reroute if you go off course.
- **Share.** Tap *Share* to send the ride by text or email. Anyone who opens the link sees the exact same route and can ride it.
- **Save** favourite rides on your phone. **Download GPX** to load a ride into a Garmin, TomTom Rider, Calimoto, Scenic, etc.
- **Terrain map** option (Settings), which helps spot mountain roads.
- **Tap the map** to drop a start, stop or destination.

## Install it on your phone

Once it's hosted (see below), open the site on your phone:

- **iPhone (Safari):** Share button → *Add to Home Screen*.
- **Android (Chrome):** ⋮ menu → *Install app* / *Add to Home screen*.

The family can install it the same way, or just open the ride links you send.

## Hosting (free)

The repo deploys itself to **GitHub Pages** on every push to `main`:

1. Merge to `main`.
2. In GitHub go to **Settings → Pages**, and under *Build and deployment* set **Source = GitHub Actions**.
3. The site will be at `https://<your-username>.github.io/MotoRider/`. The address follows the repo name, so renaming the repo to `ZAMA` makes it `.../ZAMA/`.

> GitHub Pages for a **private** repo needs a paid GitHub plan. Otherwise, make the repo public (there are no secrets in it), or drag the folder onto [Netlify Drop](https://app.netlify.com/drop) or Cloudflare Pages. Any static host works. It must be **https** for GPS to work.

## How routes are chosen

Routing is done by [Valhalla](https://github.com/valhalla/valhalla) using its **motorcycle** profile on OpenStreetMap data, with highways, trails and unpaved roads penalised or excluded. For curvy rides ZAMA asks for several candidate routes (alternates, plus detours through generated waypoints either side of the direct line, or around a circle for loops) and scores each one:

- **Twistiness:** total heading change per km of road, on a resampled line.
- Penalties for **highway** and **rough-road** share, **doubling back** over the same road, and going past your **extra-distance** limit (or, for loops, missing the target length).

"Scenic" is approximated by twisty minor roads. Those are usually the scenic ones, but ZAMA doesn't know about views. Add stops through places you know are beautiful to steer it there.

## Services used (all free, OpenStreetMap-based)

| What | Service |
| --- | --- |
| Map tiles | openstreetmap.org, OpenTopoMap |
| Place search | Photon (komoot) |
| Routing | FOSSGIS public Valhalla server |

These are community-run servers meant for light use, which is fine for a family. If you ride a lot, or the routing server is busy, you can point **Settings → Routing server** at your own Valhalla instance.

## Development

No build step. It's plain HTML/CSS/JS modules plus vendored Leaflet.

```sh
npm start   # serves on http://localhost:8080
npm test    # unit tests (geometry, scoring, sharing, navigation)
```

| File | Purpose |
| --- | --- |
| `js/app.js` | UI, map, planner, ride mode |
| `js/routing.js` | Valhalla requests, candidate generation, scoring |
| `js/geo.js` | Polyline decoding, twistiness, overlap detection |
| `js/nav.js` | Progress tracking and voice prompts |
| `js/share.js` | Share links, saved rides, GPX |
| `sw.js` | Offline app shell |

⚠️ Always follow road signs and ride to the conditions. Route data comes from OpenStreetMap and may be out of date.
