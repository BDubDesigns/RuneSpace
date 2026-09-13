# Location Scenes — Industrial Scene Header (Issue #78)

Owns the responsive industrial scene header integrated into the top of the existing location/activity panel. Single asset per location, shared `LocationSceneHeader` component, registry-owned metadata — no location conditionals in UI, no separate artwork per breakpoint.

This document owns the runtime scene contract and presentation behavior. Art
direction, generation, master/derivative handling, asset preparation, and visual
QA belong to `docs/art-cookbook.md`.

## Canonical paths

- Component: `features/location-scene/LocationSceneHeader.tsx` (shared, single responsive viewport: mobile shallow cinematic strip, desktop taller reveal)
- Registry SSOT: `game/content/locations.ts` (`LOCATIONS`, `presentation.scene`)
- Schema: `game/schemas/locations.ts` (`presentation.scene: { asset, width, height, alt, focal? }`)
- Assets: `public/location-scenes/*.webp` — committed local WebP, no CDN, no runtime transform
- Consumer: `features/location-scene/LocationSurface.tsx` (stationary Location composition; integrated into its `Panel tone="raised"`; header lives inside the panel's top edge so the scene feels built into RuneSpace, not inserted as a photo)

## Issue #145 surface ownership

`docs/architecture.md` is the ownership source of truth for the Play surfaces:
Location owns this scene and the stationary activity/population presentation;
the dedicated Map and in-transit Journey surfaces do not render a destination
scene. Same-location character browsing and profile details remain below this
Location header, not on Map. The fixed footer is **Characters · Inventory · Map ·
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

Cropping is via `object-cover` + `object-position: focal.x% focal.y%`. The scene itself is not zoomed aggressively into its center; mobile preserves a strong horizontal sense of place. `sizes="(max-width: 640px) 100vw, (max-width: 1024px) 92vw, 890px"` reflects the real desktop column (~890px usable, not a 640px guess) so `next/image` picks a correctly-sized derivative and does not stretch a 640w source on 1× desktop. The 1920 masters have headroom. No lazy/eager mis-wiring: the current-location scene loads immediately with its panel; the other two locations' scenes are not eagerly fetched on the current page.

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

## Transit truthfulness

While traveling, `state.travelState` is authoritative and the character's
`currentLocationId` remains the origin until arrival commits (see
`docs/gameplay-foundations.md` + `server/play.ts` resolution). The header:

- **Omits the scene entirely during transit** (no destination preview). `PlayConsole` renders no `LocationSceneHeader` when `inTransit === true`.
- Therefore the destination scene is never shown as though arrival already occurred. No travel cinematic, vehicle scene, or intermediate state is invented.

When the authoritative Travel state disappears, the primary surface composes
the destination Location on its next accepted state; no client-side arrival
latch is used.

## Performance and accessibility

- Correct intrinsic `width`/`height` + responsive `sizes` on `next/image`.
- Local, compressed WebP (~95–150 kB per scene, ~348 kB total). No image CDN, no remote runtime imagery.
- Current-location scene loads with the panel; non-visible future-location scenes are not eagerly fetched (they only load when the character is actually there).
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

Because the pair is authored in one content entry, replacing temporary imagery
with approved final art is a content-only change to those asset paths, their
intrinsic dimensions, and their alt text.

**Known art follow-up (non-blocking).** The three Holo Hollow Local Place
exteriors (`holo-hollow-souvenirs-exterior.webp`,
`holo-hollow-assistance-center-exterior.webp`, `hh-bnb-exterior.webp`) are
accepted for issue #159, but their surroundings are visually very similar, so
the buildings read as if they occupy nearly the same spot. A later approved art
polish pass should give each building a more distinct setting while preserving
the approved building identities (see `docs/art-cookbook.md`). Do not
regenerate or replace these assets outside that pass.

## Explicit non-goals (not in this slice)

No map-hex redesign, new locations/adjacency, Travel/Mining/Power Cell/inventory/equipment/persistence/reward changes, Annex Enter/Exit mechanic, multiple selectable scenes per location, full-screen hero art, parallax, particles, video backgrounds, cinematic transitions, or broad header/footer redesign.
