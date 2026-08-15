# Travel Map — Hybrid Plated-Signage (Issue #53)

## Scope
Owns the compact `LocalMapPanel` treatment only. Full current-location scene artwork is #78.
Three locations: Crash Site (`crash_site_deposit`), Abandoned Processing Yard (`processing_yard`),
Emergency Power Annex (`power_annex`). The panel's job is fast readable navigation and gameplay-state
communication on a phone; hexes are **not** miniature scene paintings.

## Canonical paths
- Panel: `features/travel/LocalMapPanel.tsx`
- Geometry: `features/travel/local-map-layout.ts` (`hexPoints`, `buildLocalMapGeometry`, responsive widths)
- Registry boundary: `features/travel/local-map-identifiers.ts` (`MAP_IDENTIFIER_ASSET_BY_KEY`, `resolveMapIdentifierAsset`)
- Registry SSOT: `game/content/locations.ts` (`LOCATIONS`, `LOCAL_MAP_LOCATION_IDS`, `presentation.localMap`)
- Schema: `game/schemas/locations.ts` (`presentation.mapIconKey`)

## Hex information zones (top → bottom, per hex)
1. **Top** — state label (`YOU ARE HERE` / `REACHABLE` / `SELECTED` / `ORIGIN` / `DESTINATION`).
2. **Upper-middle / center** — decorative location identifier (Layer 2, `aria-hidden`, clipped to hex).
3. **Lower-middle** — location nameplate (Layer 3, real text, centered, 1–2 lines, max-width controlled).
4. **Bottom** — activity/status plate (`Mining` / `Daily cells` / `Offline`, `data-map-status`).
5. **Corner/secondary** — population chip (`N here`, `data-map-population`) on the current tile only.

The decorative asset must conform to these zones; UI is never moved to accommodate art.

## Layering (HexMapSvg, no polygon-bounds change)
- **Layer 1 — shared hex chassis:** outer `polygon` (state fill via existing `hexFill`), inset panel seams
  (`0.92` + `0.88` inner polygons), wear/grime via subtle stroke opacity, rivets as tiny circles at inset
  corners (`0.91` inset vertices). Reusable across all locations; state colors remain dominant.
  Polygon bounds and native-button touch targets are unchanged (`hexPoints(cx,cy,w)` + `hexButtonStyle`).
- **Layer 2 — decorative identifier:** single-file helper resolves `mapIconKey → /map-icons/…` asset.
  Each hex has `<clipPath id="hex-clip-<id>">` built from `hexPoints`, then `<image href="…"`
  `x/y/width=0.60W / height=0.62H` (image viewport), `preserveAspectRatio="xMidYMid meet"` and `opacity="0.32"`.
  With tight-alpha-cropped sources (512 long-edge lossless WebP), the visibly painted width is 60.0% (Crash Site),
  56.3% (Processing Yard), 58.5% (Power Annex) at both 108 mobile and 128 desktop — inside the 55–65% rule.
  Whole group is `aria-hidden`, centered slightly above center so the lower nameplate keeps contrast.
  Does not change bounds, does not overlap routes, does not hide `data-route-progress`.
- **Layer 3 — nameplate / status / population (HexButton):** real text. Name uses
  `border-[color:var(--rs-item-plate-border)] bg-[color:var(--rs-item-nameplate-surface)]`
  (`rgb(9 21 34 / 0.9)`), `max-w-[84%]` (→ `80%` at `sm`), `break-words`, `text-[11px] sm:text-[13px]`.
  One line normally; two lines when wrapped (plate grows, art unchanged). Population and status remain
  `aria-hidden` visual chips with full accessible label in `HexButton`'s `aria-label`.
- **Routes:** `undirectedRoutes` (`stroke accent-secondary`, `strokeWidth=3`) and `data-route-progress`
  (`stroke accent-arcane`, `3.5`) drawn at same z-order / widths as before.

## Nameplate behavior
- `location.presentation.localMap.label` (`Crash Site` / `Processing Yard` / `Power Annex`) is rendered
  as plain centered text. Fixed `max-w` resolves crowding without rewording artwork; if it wraps, plate
  height/typography grows inside `HexButton` — artwork is never resized.
- Contrast is `var(--rs-item-nameplate-surface)` + `var(--rs-text-primary)` over the subordinate art.

## Population treatment
Preserved (`You are here` + `N here`). Web-visible `N here` remains on the current tile; accessible button
`aria-label` still announces `N other characters here.` Disclosure/list (`Characters here`) and profile flow
(issues #62/#64) are untouched. Population is never color-only.

## State / route / travel preservation
- `current` / `reachable` / `selected` / `origin` / `destination` / `readOnly while inTransit`
  vs `YOU ARE HERE` / `SELECTED` / `Origin` / `Destination` labels and `aria-current` / `aria-pressed`
  / `disabled` are unmistakable; location identity is silhouette/markings/label, not semantic color assignment.
- Selection never begins travel. Master-detail flow: select hex → detail card → explicit `Walk` confirm
  (`beginTravelAction`, `WALK_SECONDS`). All adjacency/route math (`axial`, `deriveRouteEndpoints` apothem +
  `LOCAL_MAP_ROUTE_GAP`, `routeProgressSegment` forward/reverse equality) unchanged.
- Flat-top triangle, `MOBILE_LOCAL_MAP_HEX_WIDTH=108` / `LOCAL_MAP_HEX_WIDTH=128`, `hexButtonStyle` overlay,
  `LOCAL_MAP_PADDING`, and responsive `buildLocalMapGeometry` remain authoritative.

## Registry / metadata contract
- `game/schemas/locations.ts: presentation.mapIconKey` is `z.enum(["crash_site_deposit","processing_yard","power_annex"])`.
  No second identifier field was added. `features/travel/local-map-identifiers.ts` resolves local assets via
  `MAP_IDENTIFIER_ASSET_BY_KEY: Record<MapIconKey,string>` — one indirection, no scattered `if (id===…)` in panel code.
- New locations **must** provide a compact identifier through the same `mapIconKey → helper` boundary and a local
  `public/map-icons/<slug>.webp` asset (lossless transparent, tightly cropped, ≤512 long edge); no baked text/status
  in art; opaque background must be removed / made subordinate; respect hex zones and 55–65% painted width / ≤ `0.38`
  opacity rules; report tight bbox + derived painted width at 108/128.

## Assets (approved, local-only, optimized for raw <image> delivery)
| File | Source (staging provenance) | BBox-cropped size | Delivered | Bytes | Saving |
|---|---|---|---|---|---|
| `public/map-icons/crash-site.webp` | `img_638277192bac.png` (wrecked hull) | 512×421 (from 1536×1264) | lossless WebP, RGBA, tight crop | 113,128 | 92% vs 1,480,335 PNG |
| `public/map-icons/processing-yard.webp` | `img_57cb431b0abe.png` (hopper/conveyor/gantry/crusher) | 512×488 (from 1424×1358) | lossless WebP, RGBA, tight crop | 121,046 | 91% vs 1,312,699 PNG |
| `public/map-icons/power-annex.webp` | `img_82b4c98005fa.png` (battery rack/power core) | 512×470 (from 1536×1409) | lossless WebP, RGBA, tight crop | 121,428 | 92% vs 1,498,011 PNG |
| **Total** |  |  |  | **355,602** | **92% vs 4,291,045 raw** |

Derived from the three 1536² RGBA PNGs at 30e0c0a via tight alpha-bbox crop + Lanczos downsample to 512 long-edge +
lossless WebP (method 4, Pillow). Transparent treatment preserved (RGBA, no opaque fill); no remote URL, no placeholder,
no generic substitution, no baked gameplay/name text. Viewport `0.60W×0.62H` with `xMidYMid meet` paints at 60.0% /
56.3% / 58.5% hex width at both 108 and 128 (inside 55–65%). Raw `<image>` delivery path is correct — the 43–51px
painted art no longer ships 1536² sources.

## Accessibility
- Decorative `image` + wrapper `g` are `aria-hidden="true"`; no extra focus target; no role/label on art.
- Native `button`s retain `aria-current`, `aria-pressed`, `aria-label` (current/reachable/population/selected/inTransit),
  `aria-describedby` to description, `disabled` during transit, visible `:focus-visible` ring (`rs-focus`), touch target
  from `hexButtonStyle` (`hexWidth × hexHeight` ≥ ~108×93, ≥44px practical minimum). Text-based state never color-only.
- Respects `prefers-reduced-motion` (panel has no animations; global `* { animation-duration: 0.01ms }` covers the hex button
  `scale-[1.025]` hover).

## Responsiveness
- Primary constraint 390px mobile (compact `108` hexes where the current tile shows `YOU ARE HERE` + `N here` +
  `Mining`/`Daily cells`/`Offline`). Also scaled at `sm` (`128` hexes, larger typography). Verified: no horizontal
  `overflow-x`, no collision with the fixed bottom nav (`--rs-bottom-nav-clearance`), and the map container is
  `mx-auto` centered with geometry-derived `width`/`height`.
