# Hybrid Plated-Signage Local Map — Issue #53 Implementation Plan

> **For Hermes:** Implement task-by-task on branch `feat/issue-53-hybrid-plated-signage` from `origin/main` (`e0d62bab…`). Use `streamlined-development-workflow` (spark-builder → Terra post-implementation review). One draft PR, no merge.

**Goal:** Give `LocalMapPanel` a restrained shared industrial hex chassis with one subdued location-specific decorative identifier per location, without changing gameplay, routes, or interaction model.

**Architecture:** Layer 1 = shared hex chassis in `HexMapSvg` (inset plating, inner border, wear, rivets). Layer 2 = per-location decorative identifier rendered inside the hex (SVG clip, `aria-hidden`), resolved from the existing `presentation.mapIconKey`. Layer 3 = real UI text/plates remain in `HexButton` (unchanged semantics). Smallest direct change: reuse existing geometry, Zod schema, and registry vocabulary — no CMS, no second identifier field.

**Tech Stack:** Next.js 15, React 19, Tailwind + `app/globals.css` `--rs-*` tokens, Zod, Vitest, Playwright, pnpm 9, `public/` local assets.

---

## Context

- Issue #53 owns the compact `LocalMapPanel` only; full scene art is #78. Three locations: `Crash Site` (`crash_site_deposit`), `Abandoned Processing Yard` (`processing_yard`), `DeWhat? Emergency Power Annex` (`power_annex`). Compact labels: `Crash Site` / `Processing Yard` / `Power Annex`; full names stay in the detail card.
- `AGENTS.md` + `docs/architecture.md` + `docs/component-boundaries.md` + `docs/design-system.md` + `docs/development-workflow.md` + `docs/testing-strategy.md` are authoritative. Read `features/travel/LocalMapPanel.tsx` (833 lines), `features/travel/local-map-layout.ts`, `features/travel/route-progress.ts`, `game/content/locations.ts`, `game/schemas/locations.ts` before changing code.
- Current `HexMapSvg` draws flat `polygon` hexes with `hexFill(current,selected)` + route `line`s + `selectedMarker` + `data-route-progress`. `HexButton` is a native `button` overlay with `aria-pressed`, `aria-current`, `aria-label` (current/reachable/selected/population), `aria-describedby` to `loc-desc-*`, `data-map-location`, `data-map-population`, `data-map-status`, `disabled={inTransit}`. Responsive hex widths: `MOBILE_LOCAL_MAP_HEX_WIDTH=108`, `LOCAL_MAP_HEX_WIDTH=128`. Geometry via `buildLocalMapGeometry` + `hexPoints(cx,cy,w)` + `LOCAL_MAP_ROUTE_GAP=12`, `LOCAL_MAP_PADDING=16`, `axialToPixel`.
- Approved production identifiers (THIS PLAN'S ASSET CHECKPOINT — do not regenerate/substitute):
  - `img_638277192bac.png` — Crash Site (wrecked hull / detached trailer on rocks)
  - `img_57cb431b0abe.png` — Processing Yard (hopper + conveyor + gantry + crusher + rock pile)
  - `img_82b4c98005fa.png` — Power Annex (capacitor rack + power core + distribution modules + hazard stripe)
  These are grayscale isometric technical art on black. Commit as local transparent assets under `public/map-icons/` (acceptable fallback per issue: SVG emblem-style preferred when it remains strong at size, otherwise transparent grayscale WebP/PNG subordinate to text/state). Report format/dimensions/file sizes per asset checkpoint. Do NOT download third-party images, use remote URLs, ship AI placeholders, or silently substitute generic icons. If approved assets missing: stop and request them.
- No new locations/adjacency/routes/mechanics/rewards. Do not change travel interaction (select hex → detail card updates → explicit Walk confirm; selecting never begins travel). Do not add panning/zooming/callout boxes/painted world background/animations.

## Registry / metadata boundary

- Inspect `game/schemas/locations.ts` — `LocationDefinitionSchema.presentation.mapIconKey` is already `z.enum(["crash_site_deposit","processing_yard","power_annex"])`. Reconcile that vocabulary — do NOT introduce a second parallel field. Add only the narrowest metadata required to resolve the compact identifier asset.
- Narrowest addition: either (a) keep `mapIconKey` as the sole key and resolve to `public/map-icons/<key>.webp` via a small helper `resolveMapIdentifierAsset(mapIconKey)` (no new schema field), OR (b) if a path is genuinely needed, add `presentation.localMap.identifierAsset` as `z.string().min(1)` referencing the local path and keep `mapIconKey` for layout semantics. Prefer (a) unless inspection shows a real reason for (b). Document the choice and why `mapIconKey` was reconciled, not duplicated.
- `game/content/locations.ts` is SSOT — `LOCATIONS`, `LOCAL_MAP_LOCATION_IDS`, `presentation.localMap.{axial,label}` stay authoritative. No registry branching per location.

---

### Task 1: Add local map identifier assets (approved production truth)

**Objective:** Commit the three approved identifier assets locally as the production source.

**Files:**
- Create: `public/map-icons/crash-site.webp` (or `.png` if WebP conversion would alter tonal fidelity — see note below)
- Create: `public/map-icons/processing-yard.webp`
- Create: `public/map-icons/power-annex.webp`
- Optional companion: `public/map-icons/README.md` (one-line provenance: which `mapIconKey` → which file, conversion notes)
- Inspect: `/opt/data/cache/images/img_*.png` are the already-cached copies of the Discord attachments

**Steps:**

1. Copy the three cached images from `/opt/data/cache/images/`:
   - `img_638277192bac.png` → `public/map-icons/crash-site.png` (Crash Site)
   - `img_57cb431b0abe.png` → `public/map-icons/processing-yard.png` (Processing Yard)
   - `img_82b4c98005fa.png` → `public/map-icons/power-annex.png` (Power Annex)
2. Decide asset format: prefer cropped transparent SVGs/emblem-style if they remain strong at hex size; acceptable fallback is optimized transparent grayscale WebP/PNG that remains subordinate to text/state. For #53's photoreal isometric art on black, the practical step is: remove/black-to-transparent the background, crop to identifier bounds, compress to WebP (or keep PNG if transparency fidelity requires it). If conversion risks visual change, keep grayscale PNG and note why.
3. Optimize: `cwebp`/`sharp`/`squoosh` or `pnpm` image tooling if present; otherwise use an existing project script or small Node helper — do not add a new dependency unless blocked. Record before/after sizes.
4. Report production dimensions and file sizes (required self-review #1).

**Verify:**
- `ls -lh public/map-icons/` shows three files, each referenced only locally (no remote URL).
- `file public/map-icons/*` confirms image type; `identify` or a small Node read confirms non-zero intrinsic size.

**Commit:** `feat(map): add approved #53 local-map identifier assets (crash/processing/annex)`

---

### Task 2: Reconcile registry map-identifier boundary (mapIconKey → asset)

**Objective:** Resolve identifier assets from the existing `mapIconKey` without inventing a second field.

**Files:**
- Modify: `game/schemas/locations.ts` (only if `localMap.identifierAsset` is genuinely needed; otherwise no edit)
- Create/Modify: `game/content/locations.ts` or `features/travel/local-map-identifiers.ts` (small helper: `MAP_IDENTIFIER_ASSET_BY_KEY: Record<MapIconKey, string>`)
- Inspect: `game/config/foundations.ts` (`LOCATION_IDS`), existing `presentation.layout` usage

**Steps:**

1. Define a narrow helper, e.g.:
   ```ts
   // features/travel/local-map-identifiers.ts
   export const MAP_IDENTIFIER_ASSET_BY_KEY = {
     crash_site_deposit: "/map-icons/crash-site.webp",
     processing_yard: "/map-icons/processing-yard.webp",
     power_annex: "/map-icons/power-annex.webp",
   } as const satisfies Record<MapIconKey, string>;
   export function resolveMapIdentifierAsset(mapIconKey: MapIconKey): string { return MAP_IDENTIFIER_ASSET_BY_KEY[mapIconKey]; }
   ```
2. If `localMap.identifierAsset` is instead needed, add it narrowly with Zod validation; do not keep two unexplained identifier fields — document the reconciliation and remove/greppably deprecate the old term if it was redundant.
3. Ensure no location-specific JSX conditionals scatter through `LocalMapPanel.tsx` — one helper, one indirection.

**Verify:** `pnpm typecheck` after edit; `grep -r "mapIconKey\|identifierAsset" --include="*.ts" --include="*.tsx"` shows single boundary.

**Commit:** `feat(map): reconcile mapIconKey → local asset boundary for #53`

---

### Task 3: Shared plated hex chassis (Layer 1) — restrained industrial treatment

**Objective:** Give the shared hex a restrained industrial treatment without changing polygon bounds or touch targets.

**Files:**
- Modify: `features/travel/local-map-layout.ts` (only if new hex-chassis helpers/constants are needed; otherwise no edit)
- Modify: `features/travel/LocalMapPanel.tsx` — `HexMapSvg` polygon rendering + `hexPoints` boundary
- Inspect: `app/globals.css` `--rs-*` tokens (`--rs-surface-raised`, `--rs-border-structural`, `--rs-accent-*`, etc.)

**Steps:**

1. In `HexMapSvg`, keep `hexPoints(cx,cy,w)` and `LOCAL_MAP_HEX_WIDTH` / `hexWidth` polygon geometry exactly — do not move polygon bounds or expand the native button's `hexButtonStyle` touch target.
2. Replace the flat `hexFill` fill with a layered hex chassis: e.g., a slightly inset secondary polygon or `<g>` with `filter`/`drop-shadow` for inset panel seam, plus very subtle wear/grime via CSS gradients or an inline pattern, plus minimal rivets/fasteners rendered as tiny circles at inset corners (or via a small SVG pattern). Keep it reusable across all locations; do not change per-location color — state colors (`current`/`selected`) remain dominant.
3. Preserve existing state fills: `current` → `accent-primary-subtle`/`accent-primary`, `selected` → `accent-mining-subtle`/`accent-mining`, default → `surface-raised`/`border-structural`. Chassis detail must sit *beneath* or *along* the hex edge, not over route lines or progress.
4. Preserve route lines: `undirectedRoutes` (`stroke accent-secondary`) and `data-route-progress` (`stroke accent-arcane`) remain drawn at the same z-order and `strokeWidth` (3 / 3.5) and must not be hidden by chassis decoration.

**Verify (lean):** Visual: hexes still align to `buildLocalMapGeometry` routes; no overflow past `mapGeometry.width/height`. Run `pnpm typecheck` + `pnpm lint`.

**Commit:** `feat(map): add shared plated hex chassis (layer 1) for #53`

---

### Task 4: Location decorative identifiers inside hexes (Layer 2) — subordinate art zone

**Objective:** Render one compact identifier per location inside the hex's center zone, `aria-hidden`, geometrically contained.

**Files:**
- Modify: `features/travel/LocalMapPanel.tsx` — `HexMapSvg` (identifier layer) + `hexPoints` clip
- Modify: `features/travel/local-map-identifiers.ts` from Task 2 (asset paths)
- Inspect: `features/travel/local-map-layout.ts:hexPoints` for clipPath generation

**Steps:**

1. Reserve the center/upper-middle hex zone for the identifier per #53's hex information zones:
   1. Top = state label, 2. Upper-middle/center = decorative identifier, 3. Lower-middle = nameplate, 4. Bottom = activity/status plate, 5. Corner = population. Enforce this with a `<clipPath id="hex-clip-${locationId}">` built from `hexPoints(cx,cy,w)` per hex, then `<image href={resolveMapIdentifierAsset(mapIconKey)} clip-path="url(#hex-clip-...)" preserveAspectRatio="xMidYMid meet" opacity="0.28-0.38" />` (tune: art must remain subordinate to text/state — low opacity, no busy enlargement).
2. Resolve asset: `getLocation(layout.locationId)!.presentation.mapIconKey` → `resolveMapIdentifierAsset` → `href`. Do not scatter `if (id === ...)` in `LocalMapPanel.tsx`; consume the helper.
3. Mark decorative: `aria-hidden="true"` on the `<image>` and its ancestor `<g>`; no separate focus target; do not add `role` or `aria-label` to art.
4. Containment rules: identifier must not change polygon bounds, not overlap route lines to suggest false adjacency, not hide `data-route-progress`, not create horizontal overflow or fixed-footer collision. Size asset to ~55–65% of hex width, centered.

**Verify (lean):** At `MOBILE_LOCAL_MAP_HEX_WIDTH (108)` and `LOCAL_MAP_HEX_WIDTH (128)`, names/status/population remain readable over art. No `overflow-x` at any viewport.

**Commit:** `feat(map): render compact decorative identifiers in hex center zone (layer 2)`

---

### Task 5: Real UI nameplate + status/population plates (Layer 3) — centered responsive plates

**Objective:** Ensure location names remain real text in a reusable responsive nameplate; keep status/population real UI and readable.

**Files:**
- Modify: `features/travel/LocalMapPanel.tsx` — `HexButton` typography + plate containers
- Inspect: `components/ui/Panel.tsx`, `components/ui/SectionHeader.tsx` token usage

**Steps:**

1. Nameplate (lower-middle zone): keep `{name}` (already `location.presentation.localMap.label`: `Crash Site` / `Processing Yard` / `Power Annex`) as centered real text with flexible `max-w`, one line normally, two lines when wrapped (adjust plate height/typography within `HexButton`, not artwork). Use shared dark industrial plate: `border-[color:var(--rs-item-plate-border)] bg-[color:var(--rs-item-plate-surface)]` (or new `--rs-hex-nameplate-*` tokens if globals.css has them) — reliable contrast over art without heavy `text-outline`.
2. Population: preserve current behavior or compress to chip, but meaning must remain obvious in context and accessible label must still announce population. Keep `data-map-population` badge, `aria-hidden` visual + full accessible label in `HexButton`'s `accessibleLabel`. Do not remove the feature to make room; the crowded current-tile case (`YOU ARE HERE` + `N here` + `Mining`/`Daily cells`/`Offline`) must proof as readable.
3. Bottom activity/status plate: keep `tileStatusLabel` (`Mining`/`Daily cells`/`Offline`) in `data-map-status`; preserve its secondary contrast separate from state colors. Do not bake status into art.
4. Ensure selected/current markers remain non-color-only: `aria-pressed`, `aria-current`, and the `selectedMarker` checkmark stay.

**Verify (lean):** Desktop + compact mobile (390px) renders: name one-line, forced two-line variant (e.g., temporary long label in a test render), population badge, status badge all inside hex. `pnpm typecheck` + `pnpm lint` + `pnpm test` (focused if needed).

**Commit:** `feat(map): polish hex nameplate + status/population plates (layer 3) for #53`

---

### Task 6: State, route, and travel interaction preservation

**Objective:** Prove gameplay state remains dominant and routing is geometrically intact; preserve master-detail travel flow.

**Files:**
- Inspect: `features/travel/route-progress.ts`, `features/travel/LocalMapPanel.tsx` (origin/destination/routeProgress), `server/actions.ts` (`beginTravelAction`), `tests/unit/local-map-layout.test.ts`
- No code intent beyond preservation proof, but fix any accidental regression here.

**Steps:**

1. Preserve: `current` (`YOU ARE HERE`) vs `reachable` vs `selected` (`SELECTED`) vs `Origin`/`Destination` vs `disabled/read-only while inTransit` vs `routeProgress` (arcane line) remain unmistakable; location identity is shape/silhouette/markings/label, not permanent semantic color assignment.
2. Preserve: `selectedLocation` → detail card below map → `ActionButton` Walk confirm (with `WALK_SECONDS`, mining-active note). Selecting a hex must never begin travel.
3. Preserve: flat-top triangle, `axial` coordinates, adjacency-derived `undirectedRoutes`/`routeSegments`, `deriveRouteEndpoints` gap=apothem math, responsive `hexWidth`, native button overlay. Decorative layers must not alter polygon bounds, overlap routes falsely, hide progress, or expand touch targets.

**Verify (lean tests — the risky boundaries for #53):**
- Unit (Vitest): every `LOCATION_IDS` resolves a valid compact identifier via `resolveMapIdentifierAsset` (valid mapIconKey → local `/map-icons/...` path, no remote, no undefined).
- Unit: `current/reachable/selected` vs `origin/destination/inTransit readOnly` vs compact label fit vs `routeProgress direction` vs `select-does-not-begin-travel` still behave as `tests/unit/local-map-layout.test.ts` + focused `LocalMapPanel` tests expect.
- Unit: status text (`Mining`/`Daily cells`/`Offline`) + population (`N here`) remain real text and accessible (button label still announces both).
- Run `pnpm test` for unit; run the travel-relevant Playwright smoke if present (`pnpm test:e2e:focused` or `pnpm test:e2e <travel>` as per `docs/testing-strategy.md`).

**Commit:** `test(map): cover #53 state/route/identifier invariants (lean)`

---

### Task 7: Accessibility, responsiveness, and documentation

**Objective:** Meet #53's a11y/responsiveness obligations and document the new map contract.

**Files:**
- Modify: `features/travel/LocalMapPanel.tsx` (a11y: `aria-current`, `aria-pressed`, `disabled`, decorative `aria-hidden`, focus ring `rs-focus`, touch-target, reduced motion)
- Create/Modify: `docs/design-system.md` or `docs/assets/map-identifier-art.md` (or new `docs/travel-map-design.md` if design-system would bloat — keep it narrowest)
- Inspect: `docs/architecture.md`, `docs/testing-strategy.md`

**Steps:**

1. A11y: decorative `<image>` is `aria-hidden`; no extra focus targets; preserve native map buttons, accessible full names/descriptions, `aria-current` for current, `aria-pressed` for selected, `disabled` during transit, visible `:focus-visible` ring, 44px practical touch target; do not add `color: transparent` tricks that hide state; respect `prefers-reduced-motion` (no animation required for #53).
2. Responsiveness: verify primary constraint 390px mobile (compact hexes where current tile may have population+status), plus desktop scaling — avoid solving crowding by shrinking text unreadably, removing state, hover-only semantics, or overflow. Check no horizontal document overflow (`overflow-x`) and no collision with fixed bottom nav.
3. Docs: canonical compact identifier asset paths, identifier format/dimension guidance (transparent WebP/PNG preferred, ~55-65% hex width, low opacity subordinate), shared hex layering/zoning rules (top→bottom zones), nameplate behavior (flexible max-width, centered, 1/2 lines), registry metadata contract (`mapIconKey` reconciliation), rules for future locations (must provide compact identifier through shared boundary, no baked gameplay text).

**Verify:** `pnpm lint` + `pnpm typecheck` + axe-free scan if available; manual viewport checks at 390px + desktop.

**Commit:** `docs(map): document #53 hex layering, plates, and identifier asset contract`

---

### Task 8: Production build, screenshots, draft PR, and self-review report

**Objective:** Ship a draft PR with evidence and the required self-review report, and do not merge.

**Files:**
- No new code beyond Task 7 polish; this is evidence + PR.
- Deliverable: `.hermes/plans/<this-file>.md` committed first on the feature branch (factory plan-artifact rule), then PR body + Kanban handoff.

**Steps:**

1. Commit plan first on `feat/issue-53-hybrid-plated-signage` (verify SHA matches this file).
2. Run canonical validation from `AGENTS.md` §6 / `docs/development-workflow.md`:
   ```bash
   pnpm install --frozen-lockfile
   pnpm typecheck
   pnpm lint
   pnpm format:check
   pnpm test
   pnpm build
   # Canonical E2E is gated (requires localhost PG, Node 22.0.x <23, pnpm 9).
   # Run the travel/population journey that exercises LocalMapPanel if locally runnable:
   pnpm test:e2e:canonical   # or pnpm test:e2e:focused travel — record real outcome, never claim a substitute gate passed
   ```
   Capture exact commands/exit codes. If Docker/PG unavailable locally, capture the real failure and let the CI gate provide it — state the block precisely in the PR body.
3. Capture required visual evidence (live preview = primary; screenshots = evidence not substitute):
   - mobile stationary map with current populated
   - desktop stationary map
   - mobile selected-but-not-current
   - desktop selected-but-not-current
   - one in-transit origin/destination/progress state
   Use the actual Coolify preview URL (`pr-<ACTUAL_PR_NUMBER>.<production-domain>`, NOT `pr-<issue-number>`) or a local production build if preview not yet available — derive the host from the real `gh pr create --draft` PR number.
4. Open exactly one draft PR with `Closes #53` in the body. Include: every asset added (format/dims/file size), registry boundary decision re `mapIconKey`, hex layer/zoning implementation, one-line vs wrapped nameplate behavior, crowded current-tile population behavior, proof that every current/selected/transit state remains readable, proof that route geometry/progress did not change, a11y treatment, exact mobile/desktop preview evidence URLs/screenshots, exact local + remote (CI) validation results. State no gameplay/persistence/route/mining/claim/profile behavior changed.
5. Required self-review (paste into PR body per #53):
   1. every production compact identifier asset, including format, dimensions, file size
   2. final registry/map-identifier metadata boundary and how existing `mapIconKey` was handled
   3. exact hex layer/zoning implementation
   4. one-line and wrapped/two-line nameplate behavior
   5. crowded current-tile population behavior
   6. proof every current/selected/transit state readable
   7. proof route geometry/progress unchanged
   8. accessibility treatment
   9. exact mobile/desktop preview evidence
   10. exact local + remote validation results

**Verify before marking PR ready:** `git diff --name-only origin/main...HEAD -- .hermes/plans` must be empty after the plan-removal cleanup commit (factory Phase 6 gate) — but keep the plan committed on the feature branch until Terra review completes; remove it only before `gh pr ready`.

**Commit:** `chore: open draft PR for #53 — hybrid plated signage local map`

---

## Tests (risk-based, lean)

- Every `LOCATION_IDS` → valid compact identifier path (no undefined, no remote URL).
- `current/selected/reachable` + `origin/destination/readOnly while traveling` + `select-does-not-begin-travel` + `detail-card confirmation flow intact`.
- `routeProgress direction/treatment` still correct (forward vs reverse progress end equality).
- `state/name/status/population` remain inside own hexes at `108` and `128` (or `390px` viewport).
- `route lines` do not intersect protected text/status regions.
- No horizontal overflow / fixed-footer collision.
- Accessible names: `aria-current`, `aria-pressed`, `aria-label` (population announced), `aria-describedby` to description, decorative art `aria-hidden`.

## risks

- **Art dominance:** keep identifier opacity ≤0.38 and size ≤65% hex width; verify nameplate contrast over art.
- **Route credibility:** never let chassis/pattern overlap the gap between hex edges and route endpoints (`LOCAL_MAP_ROUTE_GAP`).
- **Scope bleed:** refuse any request to add panning/zooming, new routes, orMining/claim changes.
- **CI gate confusion:** draft sync runs only fast-checks; need `full-ci` label or `ready` state for full canonical + integration. Poll `gh pr checks` on the CURRENT head SHA.

## Non-goals (from #53)

- No full scene artwork (#78), no new locations/adjacency, no travel duration/route/mining/claim/inventory/equipment/persistence changes, no annex enter/exit, no painted world background, no callouts, no zoom/pan, no animations, no header/footer redesign.

---

## Plan → Implementation handoff

- Repo: `/opt/data/runespace-ref` → `BDubDesigns/RuneSpace`
- Issue: https://github.com/BDubDesigns/RuneSpace/issues/53
- Plan path: `.hermes/plans/YYYY-MM-DD_HHMMSS-hybrid-plated-signage.md` (this file — update the timestamped name in the impl card)
- Branch: `feat/issue-53-hybrid-plated-signage` from `origin/main@e0d62bab`
- Workers: `spark-builder` (impl, `oracle-build-box-environment`) → `technical-lead` Terra (post-implementation review, `oracle-build-box-environment`), parent-chained so Terra auto-promotes when impl → `done`. Fix loop: Terra SELF-HEALS by creating `spark-builder` FIX + `technical-lead` RE-REVIEW cards (max 3 laps).
- Manager already stages approved assets on the branch before builder dispatch — builder must not regenerate them.
