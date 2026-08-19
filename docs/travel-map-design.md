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
1. **Top** — state plate (`YOU ARE HERE` / `REACHABLE` / `SELECTED` / `ORIGIN` / `DESTINATION`) — fitted smoked plaque, never truncated, may slightly overhang.
2. **Upper-middle / center** — decorative location identifier (Layer 2, `aria-hidden`, clipped to hex, `0.72W×0.68H@0.58`).
3. **Lower-middle** — location nameplate (Layer 3, fitted smoked plaque, `inline-flex`, reduced padding, centered, 1–2 lines, max-width controlled).
4. **Bottom** — activity/status plate (`Mining` / `Daily cells` / `Offline`, `data-map-status`, same smoked family).
5. **Corner/secondary** — population chip (`N here`, `data-map-population`) on the current tile only, same family.

The decorative asset must conform to these zones; UI is never moved to accommodate art.

## Layering (HexMapSvg, no polygon-bounds change)
- **Layer 1 — shared hex chassis:** outer `polygon` (state fill via existing `hexFill`), inset panel seams
  (`0.92` + `0.88` inner polygons), wear/grime via subtle stroke opacity, rivets as tiny circles at inset
  corners (`0.91` inset vertices). Reusable across all locations; state colors remain dominant.
  Polygon bounds and native-button touch targets are unchanged (`hexPoints(cx,cy,w)` + `hexButtonStyle`).
- **Layer 2 — decorative identifier (dedicated artwork zone):** single-file helper resolves `mapIconKey → /map-icons/…` asset.
  Each hex has `<clipPath id="hex-clip-<id>">` built from `hexPoints`, then `<image href="…"`
  `x/y/width=0.72W / height=0.68H` (artwork zone viewport), `preserveAspectRatio="xMidYMid meet"` and
  `opacity="0.58"`. With tight-alpha-cropped sources (512 long-edge lossless WebP), the visibly painted
  width is ~71.6% (Crash Site), 61.8% (Processing Yard), 64.2% (Power Annex) at the unified 140 — inside the relaxed 55–75% invariant. The zone is centered slightly above hex
  center (~6% H offset) so the lower nameplate cluster overlaps minimally. Subordinate to state/name/status
  plates, does not change bounds, does not overlap routes, does not hide `data-route-progress`.
- **Layer 3 — nameplate / status / population (HexButton):** `justify-between` with `py-1.5`; state **plate** pinned
  high as a fitted smoked plaque (`data-map-state`, `rs-map-plate rs-map-plate--state`, `inline-flex whitespace-nowrap`, always fits, may overhang),
  dedicated spacer `h-[44px]` (`data-map-artwork-spacer`) defining the mid band, then lower fitted
  cluster (`data-map-nameplate` as `rs-map-plate rs-map-plate--nameplate` at `inline-flex max-w-[66%]`, reduced `px-2` hugging),
  `data-map-population` and `data-map-status` as same-family smoked plaques. All plates share `rs-map-plate`:
  dark navy/charcoal `linear-gradient` (top→bottom `0.74→0.62`), `clip-path` chamfer (`var(--rs-bevel-small)`),
  outer + inner inset border, faint top highlight/bottom shadow. Not flat UI boxes. Overlap is minimal because the plates
  sit low and the art sits centered in the spacer-defined band. The current The Jag tile (YOU ARE HERE + N here + MINING) is the stress case.
- **Routes:** `undirectedRoutes` (`stroke accent-secondary`, `strokeWidth=3`) and `data-route-progress`
  (`stroke accent-arcane`, `3.5`) drawn at same z-order / widths as before.

## Nameplate behavior
- `location.presentation.localMap.label` (`Crash Site` / `Processing Yard` / `Power Annex`) is rendered
  as a **fitted plaque** (`inline-flex`, `px-2` hugging, `max-w-[66%]`, `rs-map-plate--nameplate`),
  not a full-width bar. If it wraps, plate height grows inside `HexButton` — artwork is never resized.
  Processing Yard no longer sits inside an oversized slab; plate surface is the shared smoked
  dark navy/charcoal (partially transparent, top→bottom gradient, chamfered + double border, highlight/shadow).

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
- Flat-top triangle, `LOCAL_MAP_HEX_WIDTH=140` unified (no mobile/desktop branching, one `buildLocalMapGeometry` path), `hexButtonStyle` overlay,
  `LOCAL_MAP_PADDING`, `LOCAL_MAP_ROUTE_GAP=30` (~30px edge-to-edge at the unified 140), and single-path `buildLocalMapGeometry` remain authoritative.

## Registry / metadata contract
- `game/schemas/locations.ts: presentation.mapIconKey` is `z.enum(["crash_site_deposit","processing_yard","power_annex"])`.
  No second identifier field was added. `features/travel/local-map-identifiers.ts` resolves local assets via
  `MAP_IDENTIFIER_ASSET_BY_KEY: Record<MapIconKey,string>` — one indirection, no scattered `if (id===…)` in panel code.
- New locations **must** provide a compact identifier through the same `mapIconKey → helper` boundary and a local
  `public/map-icons/<slug>.webp` asset (lossless transparent, tightly cropped, ≤512 long edge); no baked text/status
  in art; opaque background must be removed / made subordinate; respect hex zones and 55–65% painted width / ≤ `0.38`
  opacity rules; report tight bbox + derived painted width at 140.

## Assets (approved, local-only, optimized for raw <image> delivery)
| File | Source (staging provenance) | BBox-cropped size | Delivered | Bytes | Saving |
|---|---|---|---|---|---|
| `public/map-icons/crash-site.webp` | `img_638277192bac.png` (wrecked hull) | 512×421 (from 1536×1264) | lossless WebP, RGBA, tight crop | 113,128 | 92% vs 1,480,335 PNG |
| `public/map-icons/processing-yard.webp` | `img_57cb431b0abe.png` (hopper/conveyor/gantry/crusher) | 512×488 (from 1424×1358) | lossless WebP, RGBA, tight crop | 121,046 | 91% vs 1,312,699 PNG |
| `public/map-icons/power-annex.webp` | `img_82b4c98005fa.png` (battery rack/power core) | 512×470 (from 1536×1409) | lossless WebP, RGBA, tight crop | 121,428 | 92% vs 1,498,011 PNG |
| **Total** |  |  |  | **355,602** | **92% vs 4,291,045 raw** |

Derived from the three 1536² RGBA PNGs at 30e0c0a via tight alpha-bbox crop + Lanczos downsample to 512 long-edge +
lossless WebP (method 4, Pillow). Transparent treatment preserved (RGBA, no opaque fill); no remote URL, no placeholder,
no generic substitution, no baked gameplay/name text. Viewport `0.72W×0.68H` with `xMidYMid meet` paints at ~71.6% /
61.8% / 64.2% hex width at the unified 140 (substantially larger than prior 0.60×0.62@0.32). Raw `<image>` delivery path is correct — the
painted art no longer ships 1536² sources. Art is contained (`meet`) in a dedicated middle zone between the top
state label and lower nameplate cluster, not full-bleed; nameplate sits toward the lower portion of the hex to
minimize overlap (HexButton is `justify-between` with a `data-map-artwork-spacer`). Opacity `0.58` is plainly
recognizable yet subordinate to gameplay state.

## Accessibility
- Decorative `image` + wrapper `g` are `aria-hidden="true"`; no extra focus target; no role/label on art.
- Native `button`s retain `aria-current`, `aria-pressed`, `aria-label` (current/reachable/population/selected/inTransit),
  `aria-describedby` to description, `disabled` during transit, visible `:focus-visible` ring (`rs-focus`), touch target
  from `hexButtonStyle` (`hexWidth × hexHeight` ≥ ~108×93, ≥44px practical minimum). Text-based state never color-only.
- Respects `prefers-reduced-motion` (panel has no animations; global `* { animation-duration: 0.01ms }` covers the hex button
  `scale-[1.025]` hover).

## Responsiveness
- Primary constraint 390px mobile (compact `108` hexes where the current tile shows `YOU ARE HERE` + `N here` +
  `Mining`/`Daily cells`/`Offline`). Not scaled at breakpoints: `140` + `11px` + fitted `66%` are consistent at both breakpoints. Verified: no horizontal
  `overflow-x`, no collision with the fixed bottom nav (`--rs-bottom-nav-clearance`), and the map container is
  `mx-auto` centered with geometry-derived `width`/`height`.
