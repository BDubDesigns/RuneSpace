# Location Scenes — Industrial Scene Header (Issue #78)

Owns the responsive industrial scene header integrated into the top of the existing location/activity panel. Single asset per location, shared `LocationSceneHeader` component, registry-owned metadata — no location conditionals in UI, no separate artwork per breakpoint.

This document owns the runtime scene contract and presentation behavior. Art
direction, generation, master/derivative handling, asset preparation, and visual
QA belong to `docs/art-cookbook.md`.

## Canonical paths

- Component: `features/location-scene/LocationSceneHeader.tsx` (shared, single responsive viewport: mobile shallow cinematic strip, desktop taller reveal)
- Registry SSOT: `game/content/locations.ts` (`LOCATIONS`, `presentation.scene`)
- Schema: `game/schemas/locations.ts` (`presentation.scene: { asset, width, height, alt, focal?, overlay? }`)
- Compositor: `features/location-scene/SceneComposition.tsx` (the one stage that lays out a scene's background and optional transparent overlay; used by the Location header and by layered conversation backgrounds)
- Assets: `public/location-scenes/*.webp` — committed local WebP, no CDN, no runtime transform
- Consumer: `features/location-scene/LocationSurface.tsx` (stationary Location composition; integrated into its `Panel tone="raised"`; header lives inside the panel's top edge so the scene feels built into RuneSpace, not inserted as a photo)

## Issue #145 surface ownership

`docs/architecture.md` is the ownership source of truth for the Play surfaces:
Location owns this scene and the stationary activity/population presentation;
the dedicated Map and in-transit Journey surfaces do not render a destination
scene. Same-location character browsing and profile details remain below this
Location header, not on Map. The fixed footer is **Character · Inventory · Map ·
Missions**, with Inventory and Equipment consolidated into one tabbed overlay.

## Registry / schema contract

```ts
presentation: {
  mapIconKey: "crash_site_deposit" | "processing_yard" | … // hex identifier; full enum in game/schemas/locations.ts
  layout:     "crash_site" | "processing_yard" | …          // full enum in game/schemas/locations.ts
  localMap:   { axial: {q,r}, label: string }
  scene:      { asset: "/location-scenes/<slug>.webp" | "/location-scenes/<slug>.png", width: number, height: number, alt: string, focal?: {x:0..100, y:0..100} }
}
```

- `asset` is validated as `/location-scenes/*.webp` or `/location-scenes/*.png` (local only, no remote URLs, no `..` traversal).
- `width`/`height` are intrinsic delivered dimensions (used by `next/image` for `sizes` + layout stability).
- The contract is the **4:1 aspect ratio**, not a fixed pixel size. Approved art
  is recorded at the resolution it was actually delivered at and is never
  upscaled to match an older entry (Holo Hollow's 1536×384 set, issue #159).
- `overlay` is optional (#351): one transparent layer composed over `asset`. See "Layered scenes" below.
- `alt` is concise, useful, distinct per location — decorative wrappers are elsewhere.
- `focal` is optional `{x,y}` in percent (0–100), defaulting to center-top-ish when absent. It drives `object-position` so the shared viewport keeps the subject readable without shipping a second crop. New locations add one entry; no per-location CSS branches.
- Resolver helper: `resolveLocationScene(getLocation, id)` returns `scene | undefined` (unknown id → `undefined`, never a broken path).

## Assets (product-owner-approved, one per location)

Derived from the three supplied source images via repository-local optimization (ffmpeg `libwebp` Lanczos downsample to 1920×480, quality 80). No regeneration of approved art, no alternate artwork, no text/logo/chrome baked into pixels — real HTML/CSS UI overlays provide all labels.

| Location | Source supplied file | Staged size | Delivered | Dimensions | Bytes |
|---|---|---|---|---|---|
| Crash Site | `img_c36e73d1177b.png` (derelict hull / crane / outpost) | 2508×627 (2.2 MB PNG) | `crash-site.webp` | 1920×480 | ~101,390 |
| Abandoned Processing Yard | `img_fb1a4b922908.png` (conveyor / hopper / gantry / rust) | 2508×627 (2.6 MB PNG) | `processing-yard.webp` | 1920×480 | ~151,250 |
| DeWhat? Emergency Power Annex | `img_b54f385f2859.png` (bunker capsule / cyan arcane light) | 2508×627 (2.1 MB PNG) | `power-annex.webp` | 1920×480 | ~95,352 |
| **Total** |  |  |  |  | **~348 kB** (lossy WebP q80, ~95% saving vs 6.9 MB source PNGs) |

The Crash Site's legacy scene above was replaced by Thrust Issues (#330) with two
baked panoramas of the **Rivet Utility Shuttle** (`crash-site-crashed.webp` and
`crash-site-repaired.webp`, 1536×384), and those were in turn replaced by the
layered scene in "Layered scenes" below (#351). The two baked WebPs and their
masters are kept, unreferenced by the game, because a published Update's hero
still points at the repaired one (`docs/public-updates.md`); do not delete them.
`game/content/locations.ts` is authoritative for the current paths.

This table records the original issue #78 set. Later scenes (The Long
Scramble, The Jag, Holo Hollow, and Holo Hollow's Local Places) are recorded in
`game/content/locations.ts` and `game/content/local-places.ts`, which are
authoritative for current asset paths and dimensions.

Aspect is 4:1 panoramic (2508:627 → 1920:480). No baked UI, labels, flavor text, or chrome in the raster. Restrained industrial ambience (rust, haze, wet ground, puddles) is in the photography; the UI adds cyan/amber accents.

## Responsive presentation

One `LocationSceneHeader` renders the same asset at both breakpoints; only the viewport height changes. Mobile stays visually unchanged per spec.

- **Mobile** — `h-[126px]` (~31.5% of intrinsic height at 4:1). Wide, shallow scenic strip spanning the useful width of the location/activity panel. Vertical cost is restrained so primary gameplay stays near the top at the canonical 390px viewport. At 390px the usable panel is ~366px, so ~366×126 is ~2.9:1 — `object-cover` crops sides but shows the full vertical extent.
- **`sm` (≥640px)** — `h-[168px]` (~35%). Slightly taller so the wide composition breathes.
- **Desktop / `lg` (≥1024px)** — `h-[252px]` (~52.5%) — noticeably taller to genuinely reveal more top/bottom environmental context on the wide desktop column. GameShell is `max-w-7xl` with a `20rem` aside (~890px usable column vs 4:1 source), so ~890×252 is ~3.5:1 and `object-cover` keeps sides while revealing sky + foreground rather than cropping them (the prior ~890×196 = ~4.5:1 cropped top/bottom; mobile already showed the full height). Same asset, same `object-position` focal, no per-location branches.

Cropping is via `object-cover` + `object-position: focal.x% focal.y%`. The scene itself is not zoomed aggressively into its center; mobile preserves a strong horizontal sense of place. `sizes="(max-width: 640px) 100vw, (max-width: 1024px) 92vw, 890px"` reflects the real desktop column (~890px usable, not a 640px guess) so `next/image` picks a correctly-sized derivative and does not stretch a 640w source on 1× desktop. The 1920 masters have headroom. The current-location scene is the surface's above-the-fold hero and is authored `priority` (issue #117), so it is preloaded rather than lazily discovered after layout; the other locations' scenes are not fetched on the current page at all.

## Scene-header composition (real UI, not baked pixels)

All chrome is HTML/CSS rendered over/around the image. All scrim/hairline/plate translucency values are owned by `app/globals.css` (`--rs-scene-*` / `--rs-plate-*` tokens — see `docs/design-system.md`'s ownership rule) and consumed by `features/location-scene/LocationSceneHeader.tsx`; the component holds no literal `rgb(...)` or `rgba(...)` color recipes.

- **Upper-left** — current-location eyebrow (`CRASH SITE` / `ABANDONED PROCESSING YARD` / `DEWHAT? EMERGENCY POWER ANNEX`) as a `rs-map-plate--state` smoked plaque driven by `--rs-scene-plate-top` / `--rs-scene-plate-bottom` (50% translucency so scene shows through), fitted.
- **Bottom-right** — contextual pill only where meaningful (`FERRITE SHALE` at The Jag, `POWER CELL` at the Annex), `bg-[var(--rs-surface-panel)]` solid to match the character nameplate, yellow/orange `border-[var(--rs-accent-mining)]`, square, bottom-anchored so long eyebrows don't clip.
- **Middle band** — the scene photograph itself with a vertical scrim `from-[var(--rs-scene-scrim-top)]` → `to-[var(--rs-scene-scrim-bottom)]` (`0.22→0.72`) and `aria-hidden` decorative layers.
- **Lower-left over image** — character name (`star drifter` etc.) as an opaque `bg-[var(--rs-surface-panel)]` plate clipped with a tent angle (`clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 100%, 0 100%)`), `truncate` on overflow.
- **Framing** — thin structural `border-b border-[var(--rs-border-structural)]`, cyan top hairline `bg-[var(--rs-scene-hairline-cyan)]` + amber bottom `bg-[var(--rs-scene-hairline-amber)]` (each a `linear-gradient` token). No full-bleed hero card, no landing-page treatment, no parallax/particles/video.
- **Blend** — vertical scrim + hairlines tie the scene into the surrounding `bg-[var(--rs-surface-raised)]` panel.

## Placement and gameplay hierarchy

The header is inside the generic play console `Panel tone="raised"` (`!p-0 overflow-hidden` so the scene's top edge aligns with the panel's bevel). The rest of the panel is `p-5`:

- During **stationary** play, the header is visible and the location's activity controls flow directly below it. The generic `PlayConsole` keeps per-activity gating (e.g. `showMiningActivity` for Mining), success-chance display, start/stop/refresh, latest-attempt feedback, and recovery — none are removed or gated by artwork. The Long Scramble intentionally composes scene, description, and population without an activity block or generic production placeholder.
- **Processing Yard** receives scene art while exposing its stationary Refining console; Mining controls remain available only at The Jag.
- The **Annex** scene composes with the existing `PowerAnnexClaimPanel` inside
  the stationary Location surface; the claim authority and UI remain owned by
  the Power Annex feature.
- No horizontal `overflow-x`, no fixed-footer collision, no push of primary actions excessively below the fold at 390px.

## One place, more than one scene (issue #209)

A location's scene is its **resolved state's** scene, not a constant. Deep Jag
is the first location that needs this: the same place is a collapsed passage
while its brace is unfinished and an open working mine once the brace is welded
in, and both are the same World Location with the same identity, description
field and map hex.

The mechanism is the narrow location-state boundary
(`game/domain/location-state.ts`), not a scene-specific one. A location may
author `stateVariants`, each naming what it requires (an accepted Mission, a
completed repair target) and overriding any of description, travelability, map
status, available actions and scene. `LocationSurface` composes the location
from `state.locationStates[locationId]`, so the scene, the description and the
eyebrow all follow the same resolution and cannot disagree.

Variants are authored most specific first and the first satisfied one wins.
They derive from facts the game already owns authoritatively — Mission
acceptance and repair completion — and never read or write a state flag of
their own, which is why there is no `deep_jag_open` column to drift from the
repair record. Startup validation rejects a variant naming an unknown Mission
or repair target.

Deep Jag's two scenes are an approved matched pair: same camera, same framing,
same lighting, same delivered dimensions, differing only in the cleared rubble
and the installed brace. Each carries its own `alt`, because what a screen
reader should hear genuinely differs between the two states.

## Skatboll's southern road (issue #342)

The South Access Track and The South Cut are ordinary single-scene locations with
native 1536×384 4:1 lossy WebP scenes (`south-access-track.webp`, `the-south-cut.webp`;
the approved masters are kept, unaltered, in `assets/location-scenes/` — they were
delivered JPEG-encoded, so they carry a `.jpg` extension). The Track's scene is
activity-free on purpose; The South Cut's is a close, reinforced entrance cut into
black laminated oil shale, not an open quarry, and the map identifier matches it.
Scenes carry no baked ship, people, text or UI.

## Holo Hollow Landing and Last Leg Trading (issue #357)

Holo Hollow Landing's scene (`holo-hollow-landing.webp`, 1536×384 opaque lossy WebP)
is the approved **empty** pad with its weathered H.H. lettering: no ship, no
person, no text overlay. A parked ship is a later, separate overlay, so nothing
here reserves or fakes one. Its Local Place, Last Leg Trading, has its own distinct
4:1 exterior (`last-leg-trading-exterior.webp`, delivered at its native 2508×627),
and its conversation surface is the separate 15:8 interior
(`last-leg-trading-interior.webp`, 1717×916) behind Toll's transparent 400×500
portraits (`public/npc-art/toll-kade-*.png`), so Toll is never baked into a
background. The approved masters are kept in `assets/`. The two flight-cinematic
backdrops that shipped in the same art handoff are **not** used here; they belong
to the flight cinematic below.

## Layered scenes: one background, a state-selected overlay (issue #351)

The Crash Site is the first scene made of **one opaque empty background plus one
transparent overlay**, instead of a baked panorama per state. The ground, framing,
chrome and clouds are authored once; only the ship layer changes, so nothing
flashes or goes blank between states.

| Layer | Delivered file | Dimensions | Notes |
|---|---|---|---|
| Background (always) | `crash-site-empty.webp` | 1536×384, opaque, lossy q80 | Approved darker/overcast empty Crash Site: mesas, facility on the right, open muddy centre, **no ship and no detached debris**. |
| Crashed Rivet | `rivet-crashed.webp` | 1249×584, alpha, lossy q85 / alpha 100 | Torn hull and its local detached wreckage. **Debris exists only on this overlay.** |
| Repaired Rivet | `rivet-repaired.webp` | 1307×612, alpha | The existing approved repaired transparent master, reused as supplied. |

The three unaltered masters are kept in `assets/location-scenes/`
(`crash-site-empty-overcast-master.png`, `rivet-crashed-transparent-master.png`,
`rivet-repaired-transparent-master.png`). `scripts/prepare-crash-site-art.mjs`
derives the three files from them (see `docs/art-cookbook.md`).

States resolve through the existing state-variant seam, unchanged: the base scene
is the crashed Rivet, and `CRASH_SITE_SHIP_RESTORED_VARIANT_ID` (required:
`REPAIR_TARGET_IDS.propulsionSystem` complete, per character) swaps in the repaired
Rivet. There is no second flag, and it is not gated on Wade's turn-in.

**No-ship is a reachable state since the first flight (#358).** A scene with no
`overlay` is the bare empty background, and the compositor renders it from the same
elements. The Crash Site selects it through `CRASH_SITE_SHIP_DEPARTED_VARIANT_ID`
(`requires: { shipBerth: "elsewhere" }`), authored first so it wins over the
restored ship: whether the ship has left is the ship's own authoritative berth
(`character_ships.berth_location_id`, via `LocationStateFacts.shipBerthLocationId`),
never inferred from the Propulsion repair or Wade's Mission, and never from where
the character happens to be standing. Walking away from the Crash Site can never
remove a ship that is still parked there.

**A parked ship at another site.** Holo Hollow Landing's base scene is its empty
4:1 pano (`holo-hollow-landing.webp`); its `HOLO_HOLLOW_LANDING_SHIP_BERTHED_VARIANT_ID`
(`requires: { shipBerth: "here" }`) composes the same canonical
`rivet-repaired.webp` over it, placed on the pad's painted circle
(`{ left: 36.0, top: 38.2, width: 28.0 }`, ground contact about 90% down the
canvas). No bespoke duplicate art, and no mobile/desktop split. The overlay stays
inside its canvas (`tests/unit/ship.test.ts`).

### Placement is scene-relative metadata

`overlay.placement` is `{ left, top, width }` in **percent of the background's own
canvas**; the overlay's height follows its intrinsic aspect, so a ship is never
stretched. There are no pixel offsets and no mobile/desktop split. To place another
parked ship at another site, author the overlay and its placement — no CSS.

### One stage, one transform

`SceneComposition` puts the background and the overlay in a single stage element
that reproduces `object-fit: cover` + `object-position: focal` with container query
units (`width: max(100cqw, 100cqh × aspect)`, offset by the focal fraction). Both
layers are cropped, scaled and offset together, so the ship cannot drift from its
landing mark at 390px, at the 890×252 desktop viewport, or in between, and a
transparent contact shadow stays on the ground it was cast on. The viewport (the
header's `h-[126px] sm:h-[168px] lg:h-[252px]` box, or a dialogue's 15:8 frame)
remains the caller's; there is no JavaScript measurement, so server-rendered
markup is already correct. Every location renders through the same stage; a scene
without an overlay is simply the background.

- **Performance / LCP.** The background keeps `priority` and is the one preload.
  The overlay is `loading="eager"` but never `priority`, and its `sizes` reflects
  the ship's real rendered width, so it neither competes for LCP nor downloads the
  full stage width.
- **Accessibility.** The scene's `alt` describes the whole composition (ship state
  included) and rides on the background; the overlay is `alt=""` and
  `aria-hidden`, so the place is announced once. Each state authors its own `alt`
  that names what is there; none says "empty location".

### Conversations

Wade's Crash Site conversation backdrops (`crashSiteExterior` →
`crashSiteExteriorRepaired`, the existing `repaired` rule) carry
`composition: <the location's scene for that state>`, and `DialogueScene` renders
that composition through the same `SceneComposition` stage inside its 15:8 frame.
There is no second composite file and no second placement to drift. A background
with no `composition` renders exactly as before. QC Studio renders through the real
`DialogueScene`, so its preview shows the ship; its background list still carries
`asset` (the base layer) and `alt`.

## The Rivet flight cinematic (issue #359)

The first flight (#358) is presented by `features/ship/FlightCinematic.tsx`, inside
the in-flight `FlightPanel`, in the same 15:8 frame a conversation uses
(`aspect-[15/8] min-h-56 sm:min-h-72`). It is a **presentation layer** over the
server's recorded flight: it reads `state.ship.flight` and nothing else, and it
never lands, refuels or completes anything.

| Phase | Visual target | Backdrop |
|---|---|---|
| Takeoff | 0–2.5 s | `crash-site-departure.webp` (1717×916, opaque lossy, shipless) |
| Chart | 2.5–12 s | native SVG nav chart, no artwork |
| Touchdown | 12–15 s | `holo-hollow-landing-arrival.webp` (1717×916, opaque lossy, shipless) |

- **Art.** Both backdrops are the approved 15:8 environments from the first-flight
  art handoff, committed as delivered with their unaltered masters
  (`assets/location-scenes/*-master.png`). Neither is a 4:1 location pano, and
  neither has a ship baked in. The Rivet is the one canonical
  `rivet-repaired.webp` (`REPAIRED_RIVET_OVERLAY`), placed per backdrop in
  `game/content/flight-cinematics.ts` with the same percent-of-canvas `placement`
  a location overlay uses, and rendered inside the `SceneComposition` stage (as a
  stage child) so crop and ship move together. A soft CSS contact shadow stays on
  the ground while the ship lifts or settles.
- **Timing.** `flightCinematicFrame` (`features/ship/flight.ts`) derives the phase,
  the time already spent in it and the chart progress from the flight's own
  `startedAt` / `arrivesAt`. Takeoff and touchdown are 2.5 s and 3 s targets that
  divide the recorded duration (and shrink for a shorter flight); the chart is the
  rest. The touchdown pose is reached at the scheduled arrival, so the cinematic
  adds no time. Each phase mounts a CSS keyframe animation whose negative
  `animation-delay` is the time already spent in that phase, so a reload, a
  reopened panel or a reconnect resumes mid-motion instead of restarting takeoff.
  Past the arrival instant the frame holds the settled pose and the panel says
  touchdown is pending until the server confirms; the Play surface then shows the
  arrived location and the durable arrival notice. A player who returns after
  landing never sees the cinematic.
- **Chart.** `features/ship/flight-chart.ts` points the leg in the same direction as
  the Local Map (from the two places' authored axial coordinates), labels both
  real places, and titles the chart from the cinematic content ("Skatboll local
  flight"). It invents no distance and implies no second planet. The marker is a
  miniature of the approved Rivet through the Next.js image optimizer.
- **Effects.** Small CSS-only effects ride the same phase envelope (inline duration
  and negative delay) as the ship: two lift plumes under the fore and aft hull and
  a glow on the drive ring (inside the moving ship layer), and dust on the ground
  line in front of the wheels (a ground layer, coloured per backdrop by
  `dustColor`: brown mud at the Crash Site, grey spray on the pad). Takeoff:
  ignition in the first ~0.3 s, dust peaking ~0.4 s and thinning as the ship
  climbs. Touchdown: thrust holds through the descent and spools down over the
  last ~0.6 s, with a short dust puff as the wheels meet the pad that has settled
  by the arrival instant. The flicker only dims and brightens (0.8–1.0 opacity,
  150 ms); nothing switches fully on and off. Positions are percent of the ship's
  mark, so they crop with the art.
- **Art ready before Launch.** `features/ship/flight-cinematic-images.ts` derives the
  exact optimized `/_next/image` variants the frame renders (backdrops with their
  srcset and sizes, the ship overlay, the chart miniature), and the components read
  the same props. Opening the Flight Controls (Board Ship) fetches and decodes
  them. A LAUNCH tap before that has finished shows "Preparing launch visuals…"
  and sends the ordinary launch command as soon as the art is ready, fails, or
  `FLIGHT_VISUALS_WAIT_MS` (6 s) passes. Nothing is spent, recorded or timed before
  that command succeeds, and the art never decides whether a launch is allowed. A
  warm-up older than 45 s is refreshed at Launch, because optimizer responses are
  cacheable for 60 s before revalidation. After a mid-flight reload, the cinematic
  warms the later phases' art itself.
- **Reduced motion and access.** Under `prefers-reduced-motion` the ship rests on
  its mark with no effects, the chart's moving marker and growing trail are **not
  rendered** (followed live through `matchMedia`, not hidden by CSS, so no browser's
  visibility heuristic for an SVG group can disagree), and the panel's countdown
  and progress meter carry the flight. The frame is a `<figure>` whose caption names
  the phase; one polite live announcement is made per phase, and the chart is an
  `img` with a factual label. No flashing.
- **Hydration.** The frame depends on the browser clock, so its phase layers render
  only after mount; server markup is a stable empty frame.

A later route adds its own entry to `FLIGHT_CINEMATICS` (typed over every
`ShipRouteId`); there is no generic cinematic engine. The interplanetary leg (#375) is two
such entries, below.

## Stillreach Slice A scenes (issue #373)

Stillreach's eight World Locations are ordinary single-scene locations: native-ratio 4:1
opaque lossy WebPs at 1536×384 (q80), one per location, with no overlay and no state
variant. The approved masters are kept unaltered in `assets/location-scenes/<slug>-master.png`
(seven 2508×627, The Survey Line 2048×512) and `scripts/prepare-stillreach-art.mjs` derives
the WebPs by downsampling, never upscaling. No scene carries a baked ship, person, text or
UI.

| Location | `public/location-scenes/` file | Source master | Bytes |
|---|---|---|---|
| Stillreach Landing Station | `stillreach-landing-station.webp` | 2508×627 | 158,664 |
| Windward Track | `windward-track.webp` | 2508×627 | 173,658 |
| Hilltop Workshop | `hilltop-workshop.webp` | 2508×627 | 148,474 |
| Prospecting Quarry | `prospecting-quarry.webp` | 2508×627 | 174,700 |
| The Low Hum | `the-low-hum.webp` | 2508×627 | 119,182 |
| The Survey Line | `the-survey-line.webp` | 2048×512 | 133,140 |
| The Dry Seam | `the-dry-seam.webp` | 2508×627 | 222,474 |
| Harmonic Workings | `harmonic-workings.webp` | 2508×627 | 167,298 |

The Landing Station's panorama is **empty on purpose**: the bioluminescent fungal ring is
the physical landing pad, and no ship is baked in. Since #375 the repaired Rivet composes onto
it through the existing `overlay` / `shipBerth` seam, like Holo Hollow Landing (see "Stillreach
Slice B" below). The other seven are scenery only: their buildings, rigs and mine works are environmental
illustration, not an operable Rig, merchant or mine, and the locations author no action.
Each `alt` is distinct and grounded in what the panorama shows; every `focal` keeps the
subject inside the 390 px strip's 2.9:1 crop.

## Stillreach Slice B: berth and interplanetary cinematic (issue #375)

Two owner-approved placements of the one canonical `rivet-repaired.webp`, each measured on a
true Pillow composite of the untrimmed 1774×887 master and converted to the trimmed overlay's
box (alpha bounds 16, 43, 1742×816) at the same scale, so the runtime ship lands on exactly the
approved pixels. The composites themselves are review references only and are not committed.

| View | Canvas | Approved composite | Runtime `placement` (% of canvas) |
|---|---|---|---|
| 4:1 World Location, berthed (`stillreach_landing_station_ship_berthed`) | `stillreach-landing-station.webp` 1536×384 | "Option 2 — balanced": scale 0.205, top-left (585, 84) | left 38.3, top 24.171, width 23.249 |
| 15:8 cinematic (takeoff from / touchdown at Stillreach) | `stillreach-landing-station-cinematic.webp` 1717×916 | "Option B — Balanced": 515 px wide, top-left (680, 268) | left 39.874, top 30.62, width 29.453 |

- **Berth.** The Landing Station authors one state variant, `requires: { shipBerth: "here" }`,
  that adds the overlay and a description naming the ship; its base scene stays the empty
  panorama. Walking away never removes the ship and walking there never adds it. QA'd at
  390 px and desktop: the ship sits centred in the ring, as in the reference.
- **Cinematic art.** The new approved empty 15:8 scene (1717×916, master
  `assets/location-scenes/stillreach-landing-station-cinematic-master.png`, SHA-256
  `7cee91fe78f9…`) is encoded at its native size, q80, by
  `scripts/prepare-stillreach-slice-b-art.mjs`, which refuses any other file. It is not a
  crop of the 4:1 panorama.
- **Both directions.** Holo Hollow Landing → Stillreach takes off from Holo Hollow Landing's
  existing approved 15:8 pad backdrop (`holo-hollow-landing-arrival.webp`, same mark as the
  first flight's touchdown) and touches down on the Stillreach scene; the return takes off
  from the Stillreach scene and touches down on the same Holo Hollow pad. The Crash Site is
  never an interplanetary backdrop, and no new Skatboll art was needed.
- **Chart.** `chart: { kind: "interplanetary" }` draws the two worlds (Skatboll always left,
  Stillreach always right), each labelled with its landing station, and the same bowed route
  and Rivet marker as the local chart (`interplanetaryChartGeometry`). Outbound the marker
  crosses left to right, home right to left. It states no distance or scale.
- **Planet appearances.** Each world is drawn by the generic native-SVG `PlanetBody`
  (`features/ship/PlanetBody.tsx`) from its typed presentation in `game/content/planets.ts`:
  a palette (surface, shadow, highlight, rim) lit from one off-centre light, optional faint
  bands, an optional tilted ring (far half behind the body, near half in front) and an
  optional atmospheric halo. Skatboll is slate blue and steel grey with banding, a thin ring
  and a cold rim; Stillreach is deep violet with teal accents and a soft aurora halo, no
  ring. No per-planet CSS or ID branches: a new world is a new entry. Labels keep clear of
  each world's ring or halo (`chartPlanetReach`), aligned across the chart. Static art, so
  reduced motion changes nothing about them.
- **Station anchors.** Each presentation authors a `flightAnchor` inside its disc, in body
  radii from the centre (Skatboll upper right `{0.45, -0.35}`, Stillreach centre left
  `{-0.55, 0}`). `planetAnchorPoint` resolves it for any drawn size, and `chartPlanetAnchor`
  for the chart: the route's two ends, the station dot on each world and the Rivet marker's
  start and finish are that one point, so the flight home is the same two points reversed.
  Draw order: route, worlds, station dots, Rivet. The dots stay under reduced motion.
- **Timing.** The same `flightCinematicFrame`: 2.5 s takeoff and 3 s touchdown inside the
  recorded 260 s, so the chart holds the other 254.5 s. Resume, reduced motion, minimize,
  arrival-pending and no-replay-after-landing behave exactly as for the first flight.

### Last Leg Trading's fuel terminal Local Place (issue #375)

`stillreach_fuel_terminal` is a 4:1 Local Place scene like Holo Hollow's: the owner-approved
2048×512 PNG (SHA-256 `654577e0220e…`, kept unaltered as
`assets/location-scenes/stillreach-fuel-terminal-master.png`) downsampled whole to
`stillreach-fuel-terminal.webp`, 1536×384 lossy q80, by
`scripts/prepare-stillreach-slice-b-art.mjs`, as Slice A treated its 2048×512 panorama. It
shows the unmanned trading post at the edge of the landing ground under the same twilight
aurora, with the vending terminal and a canister rack at its centre; focal (50, 55) keeps
both in the 390 px header strip and the directory card. No person, ship or game UI is baked
in. Its alt text describes a terminal service, not an NPC or another World Location.

## Transit truthfulness

While traveling, `state.travelState` is authoritative and the character's
`currentLocationId` remains the origin until arrival commits (see
`docs/gameplay-foundations.md` + `server/play.ts` resolution). The header:

- **Omits the scene entirely during transit** (no destination preview). `PlayConsole` renders no `LocationSceneHeader` when `inTransit === true`.
- Therefore the destination scene is never shown as though arrival already occurred. No walking-Travel cinematic, vehicle scene, or intermediate state is invented. (A Rivet flight is not Travel: its cinematic above shows the arrival backdrop during touchdown, but the arrived location scene still appears only once the server confirms the landing.)

When the authoritative Travel state disappears, the primary surface composes
the destination Location on its next accepted state; no client-side arrival
latch is used.

## Performance and accessibility

- Correct intrinsic `width`/`height` + responsive `sizes` on `next/image`.
- Local, compressed WebP (~95–150 kB per scene, ~348 kB total). No image CDN, no remote runtime imagery.
- The current-location scene is a `priority` image: it is the measured LCP element of the Location and Local Place surfaces, so `next/image` preloads it instead of authoring `loading="lazy"` and discovering it after layout. Exactly one scene renders per surface, so this is one preload, not a page of eager artwork. Non-visible future-location scenes are still not fetched (they only load when the character is actually there), and the Local Place directory thumbnails below the hero stay lazy. Measured before/after evidence is in `docs/audits/issue-117-image-delivery-evidence.md`.
- Meaningful `alt` per scene, concise and useful; decorative gradient/scrim layers are `aria-hidden`.
- Focus order, action controls, alerts, and `prefers-reduced-motion` are preserved (the scene has no motion of its own; plates use `rs-map-plate` which respects the global `* { animation-duration: 0.01ms }` reduced-motion rule).

## Adding a future location

1. Add its scene entry to `game/content/locations.ts` under `presentation.scene` (`asset`, `width`, `height`, `alt`, optional `focal {x,y}` in percent). Ensure `asset` is already committed under `public/location-scenes/<slug>.webp` (the schema also accepts `.png`) and follows the repo's existing asset conventions — do not rely on incoming filenames.
2. Prepare and visually approve the asset according to `docs/art-cookbook.md`, with no baked text/chrome. Approved delivered art is committed as delivered; never upscale it to match an existing entry's pixel size.
3. Record the committed file's actual intrinsic dimensions and focal where justified.
4. No UI code changes beyond the data entry — `LocationSceneHeader` consumes the registry.

Local Place scenes (`game/content/local-places.ts`, issue #159) use the same
`/location-scenes/` directory, the same metadata shape, and the same
`LocationSceneHeader`, which takes any subject carrying an id, a display name,
and scene metadata.

### Before / after scene pairs (issue #172)

A Local Place that something inside it can permanently change authors a second
scene plus a second description under `presentation.repaired`, and the derived
surface (`deriveLocalPlaceSurface`) picks between them from authoritative repair
completion. The header is unchanged: it receives whichever subject the
derivation returned.

The two scenes in such a pair are the one case where **identical composition is
required**. Same camera, same framing, same lighting, same time of day — the
only difference is the thing the player fixed. The art cookbook's
"same-background syndrome" warning is about distinct places reading as the same
spot; a before/after pair of one place is the opposite requirement, and a change
of angle would read as a different location rather than as repair.

Because the pair is authored in one content entry, the asset paths, intrinsic
dimensions, and alt text are the whole contract — swapping art is a
content-only change.

Alt text must differ between the two states and describe what actually changed.
The repaired/damaged distinction is meant to be carried by more than the
picture, so "canopy torn open, bench collapsed in the mud" versus "canopy whole
and squared on welded bracing, bench remounted" is the part a screen-reader
user relies on.

| Crew Stop state (#172) | Supplied master | Delivered | Dimensions | Bytes |
|---|---|---|---|---|
| Damaged | 2048×512 PNG (2.4 MB) | `holo-hollow-crew-stop-damaged.webp` | 1536×384 | ~107 kB |
| Repaired | 2048×512 PNG (2.4 MB) | `holo-hollow-crew-stop-repaired.webp` | 1536×384 | ~109 kB |

Both were downsampled with Lanczos and encoded at libwebp quality 80 — the same
derivation as the issue #78 set above — and flattened, since environment art is
opaque. 1536×384 matches the Holo Hollow Local Place set rather than upscaling
to the older 1920×480 convention. The Update hero references this same canonical
scene directly under
`public/location-scenes/`, per `docs/public-updates.md`.

| Rusk Recovery (#190) | Delivered | Dimensions | Bytes |
|---|---|---|---|
| Location scene | `rusk-recovery.webp` | 1536×384 | ~227 kB |
| Conversation background | `rusk-recovery-dialogue.webp` | 1710×912 | ~466 kB |
| Map identifier | `map-icons/rusk-recovery.webp` | 512×230, transparent lossless | ~71 kB |
| Scrap Metal item art | `item-art/scrap-metal.webp` | transparent lossless | ~980 kB |

Wade's yard ships **one static scene**, not a before/after pair: what changes
with progression is who is standing in it and what they will let the player
touch, never the place itself. The Workbench and the beaten-up Work Orders
terminal are physically in the art from the first visit, so their player-facing
surfaces can appear later without the picture changing. The Fabrication Station
(#232) follows the same rule — the yard's machining gear is already in the
picture, so Fabricate and Tinker are activity UI under the shared scene, with no
station scene of its own. The yard also ships its
own conversation background rather than reusing the 4:1 scene, the same choice
the Holo Hollow interiors made. That release's Update hero references the same
canonical scene under
`public/location-scenes/`, per `docs/public-updates.md`.

**Known art follow-up (non-blocking).** The three Holo Hollow Local Place
exteriors (`holo-hollow-souvenirs-exterior.webp`,
`holo-hollow-assistance-center-exterior.webp`, `hh-bnb-exterior.webp`) are
accepted for issue #159, but their surroundings are visually very similar, so
the buildings read as if they occupy nearly the same spot. A later approved art
polish pass should give each building a more distinct setting while preserving
the approved building identities (see `docs/art-cookbook.md`). Do not
regenerate or replace these assets outside that pass.

The Local Place scenes (#159, #172) and every other World Location are unchanged:
none authors an overlay.

## Explicit non-goals (not in this slice)

No map-hex redesign, new locations/adjacency, Travel/Mining/Power Cell/inventory/equipment/persistence/reward changes, Annex Enter/Exit mechanic, multiple selectable scenes per location, full-screen hero art, parallax, particles, video backgrounds, cinematic transitions, or broad header/footer redesign.
