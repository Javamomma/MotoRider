# ZAMA: plan to be ride-ready by spring

Goal: by the first warm weekend of spring 2027, ZAMA is an installed app on one Android phone and the family's iPhones. It finds good roads, guides a ride with the phone locked and without signal, and lets the family ride together.

One part per week. Each week ends with a short review: what shipped, what was tried on a real phone, what should change. The plan is revised at each review, so later weeks are expected to move.

## How we work

- **Roles.** The owner is the executive: he gives opinions on function, style and content, in conversation. Claude runs all development: writes, tests, reviews and merges the code, and reports in plain language.
- **Rhythm.** Each week starts automatically on Monday. It ends with a short report in the conversation: what shipped, how to try it, what was learned, and one or two questions on function or look. Pull requests are a record, not a place for the owner to review.
- **Design is part of every week.** Each part ships with its look and feel done, not as a later polish pass, and each weekly report shows a screenshot or screen recording.

## Design direction

ZAMA should feel like a well-made riding instrument, and a little like the book it is named after: calm, legible, unhurried.

- **Riding screens:** few elements, large type, high contrast, readable at a glance in sun and at night. Nothing decorative moves while the bike does.
- **Planning screens:** this is where the art lives. Roads drawn as the subject of the map, with the good ones glowing; a route card that reads like a page from a ride journal (profile, character of the road, what you will see).
- **Identity:** a proper mark and wordmark, one typeface family, a small palette (ink, paper, one warm accent), and a short line from the spirit of the book on quiet screens.
- **Sound and touch:** a distinct, pleasant chime before spoken turns; haptics for turn now and off route.

Design milestones are marked 🎨 in the table.

## How the app is built

- **One codebase.** The existing web app stays the core. [Capacitor](https://capacitorjs.com) wraps it as a native Android and iOS app, and native code is added only where the web can't do the job: background GPS, voice with the screen locked, offline storage, glasses.
- **Android** builds in GitHub Actions on every change and produces an installable APK.
- **iOS** builds in GitHub Actions on a macOS runner. Installing on the family's iPhones goes through TestFlight, which needs an Apple Developer account.
- **The website stays live** as the quick way to open a shared ride without installing anything.

## Weeks

| # | Week of | Part | Done when |
|---|---|---|---|
| 1 | Nov 16 | **Real-world shakedown.** Run the live site against the real routing, search and map services; fix what breaks; record 10 real routes as test fixtures. | Ten real A→B and loop rides plan correctly on a phone, and the fixtures run in CI. |
| 2 | Nov 23 | **App shell.** Capacitor project; Android APK from CI; iOS project compiling in CI; app icon and splash. | ZAMA is installed on the Android phone from an APK and plans a ride. 🎨 Identity: mark, wordmark, typeface, palette, icon and splash, shown as two or three options to choose from. |
| 3 | Nov 30 | **Guidance that survives a locked phone.** Native background location and spoken turns on Android and iOS; resume after a call; battery check. | A 30-minute drive with the phone locked in a pocket gets every turn spoken. 🎨 The riding screen redesigned; turn chime and haptics. |
| 4 | Dec 7 | **Good roads from map data, part 1.** Score every road in an area for curves, surface and road class from OpenStreetMap; route through the best ones instead of guessing detours. | For three known areas, the top-scored roads are ones a rider would pick, and routes use them. 🎨 The map style: good roads drawn as the subject. |
| 5 | Dec 14 | **Glasses.** The Ray-Ban Display arrives about Dec 8: run the checks in `GLASSES_HUD_PLAN.md`, then show the next turn on the glasses during a drive. | Next-turn card visible on the glasses for a whole test drive, or a written reason why not and the fallback. |
| 6 | Dec 21 | **Good roads, part 2: scenic.** Add climbs and descents from elevation data, roads along water, through forest and over passes, and distance from towns. Show why a route was picked. | Each route option says what makes it good, and a "scenic" setting changes the result. 🎨 The route card as a ride-journal page. |
| — | Dec 28 | Holiday week: no build. Review of weeks 1–6 only. | |
| 7 | Jan 4 | **Offline.** Download an area's map and road scores before leaving; planned rides keep working with no signal; reroute offline. | Airplane mode after planning: full guidance and one reroute still work. |
| 8 | Jan 11 | **Ride-day planning.** Fuel stops spaced to tank range, weather and wind along the route at ride time, sunset warning, "be home by" loops, elevation profile. | A planned ride shows fuel stops, weather and a home-by time that hold up against a manual check. |
| 9 | Jan 18 | **Family rides.** A shared ride with live positions on the map, a regroup point, and "rider stopped" alerts. Needs a small backend. | Two phones on the same ride see each other move, on Android and iPhone. |
| 10 | Jan 25 | **Ride library.** Record a ride, rate it, save it, re-ride it, import and export GPX, favourite roads. | A recorded drive can be replayed as a guided ride on another phone. 🎨 The library as a journal: each ride with its line on the map, date, and a note. |
| 11 | Feb 1 | **iPhone release.** TestFlight build to the family, install guide, fixes from their first use. | Every family iPhone has ZAMA installed and has opened a shared ride. |
| 12 | Feb 8 | **Safety and polish.** Glove-sized controls, night and sun-glare themes, do-not-disturb while riding, crash-proof resume, battery and data use, accessibility. | A written checklist passes on both platforms. |
| 13 | Feb 15 | **Winter test drives.** Three full routes driven by car with all features on; fix list worked. | No open bug that would spoil a ride. |
| 14–16 | Feb 22 – Mar 8 | **Buffer.** Slipped work, things the reviews added, Android Auto or CarPlay if wanted. | |
| 17 | Mar 15 | **Spring check.** Road data refreshed after winter, seasonal road closures, final builds. | Ready to ride. |

## What is needed from the owner

- **Apple Developer Program** ($99 a year), by week 2 if possible and no later than week 10. Without it the family's iPhones cannot install the app.
- **A Mac with Xcode, once**, to create the iOS signing certificates (the Mac mini or MacBook Air will do).
- **Google Play account** ($25 once): optional. An APK installs without it.
- **A few short drives** on the test weeks (3, 5, 7, 9, 13). By car is fine.
- **Opinions.** A reaction to each week's screenshots and questions; a sentence is enough.
- **The Meta developer app ID** for the glasses, for week 5.

## Decisions still open

- **Backend for family rides (week 9).** Supabase is the default choice; it means location data for a live ride passes through a hosted service. Kept only while a ride is active.
- **Road-score hosting (week 4).** Computing scores on the phone is private and free but slow for large areas; a small server is faster. Start on the phone and measure.
- **Routing server.** The free public server is fine for testing. If it proves unreliable in week 1, host one on the Mac mini.

## Review log

Filled in at the end of each week: what shipped, what was tested for real, what changed in the plan.

| Week | Shipped | Tested for real | Plan changes |
|---|---|---|---|
| 1 (started early, Nov 9) | Live shakedown in GitHub Actions (10 real rides, weekly); fixes for what it found: an alternate route is pinned so sharing returns the same ride, planner-made via points snap to through roads, poor options are no longer offered, mountain loops are resized to the length asked; 5 real answers as CI fixtures | Planner, guidance, search and the browser's CORS check against the real servers, from GitHub's runners: 26 options over 10 rides, problems down from 14 to 1 (a 100 mi loop west of Boulder still doubles back; now labelled). Not yet on a phone by the owner. | Session network access was declined, so live checks run in CI. The 10-rides-on-a-phone check moves to the owner's first try of the updated site. |
