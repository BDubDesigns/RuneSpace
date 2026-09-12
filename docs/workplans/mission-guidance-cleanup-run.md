# Mission-guidance cleanup — overnight run ledger (#176)

Durable execution ledger for orchestration issue #176. The refreshed bodies of
#173, #143, and #174 remain authoritative for product requirements; this file
records execution state only, so a fresh session can reconstruct the run.

## Scope

- Orchestration issue: #176.
- Ordered slices (strictly sequential): **#173 → #143 → #174**.
- Shared semantic contract: **blue = Mission conversation boundary** (unaccepted
  available Mission, local discovery only at the offering NPC; or turn-in phase
  once every authored requirement is satisfied, even when remote); **green =
  accepted Mission work**. Available and turn-in stay distinct domain states
  despite sharing blue. Ambiguous multi-source requirements never invent a
  destination. Semantic state is never inferred from CSS color.
- Hard boundary: nothing merges to `main`. Per-issue work merges into the staging
  branch only. At the end, one **draft** PR `staging → main` is opened for
  Brandon's preview review (approved by Brandon on 2026-09-12; he merges after
  review, not the agent).
- Issues stay open after landing on staging (landing on staging is not shipping).
- Brandon approved (2026-09-12): Wiki/Updates edits in the slice that changes the
  player-facing fact; `.qcfailed/status.json` is left untouched overnight.

## Base

| Item | Value |
| --- | --- |
| Verified starting `origin/main` | `caed481a59c30100fb40ea6c4c0f9b0e4850dbe9` (merge of PR #171) — matched the kickoff SHA exactly |
| Staging branch | `staging/mission-guidance-cleanup` (created from `caed481`) |
| Host | Brandon's home host; `./scripts/managed-host-run.sh` with private `dev.env`, local Docker Postgres, Node 22.23.2, pnpm 9.15.4 |

## Slice status

| Slice | Branch | Staging SHA before | PR | Staging SHA after | Status |
| --- | --- | --- | --- | --- | --- |
| #173 | `issue-173-bevel-focus-visible` | (ledger commit) | — | — | in progress |
| #143 | — | — | — | — | pending |
| #174 | — | — | — | — | pending |

Final combined staging SHA: _pending_.

---

## #173 — visible focus-visible rings on beveled controls

### Findings (read-only inspection)

- `.rs-bevel` (`app/globals.css`) clips with a chamfer polygon inset by
  `--rs-bevel-small` (0.4rem). `.rs-focus:focus-visible` draws a 2px outline at
  `outline-offset: 3px` — entirely outside the polygon, so it never paints.
- `.rs-bevel.rs-mission-guidance` / `.rs-bevel.rs-mission-available` also set
  `outline: none` and come later in the file with equal specificity, so a guided
  beveled control lost the (already invisible) focus outline too.
- Real `rs-bevel` + `rs-focus` focusable consumers: `ActionButton`, `ActionLink`
  (and therefore `MissionActionButton`, `MissionActionLink`), `FormField` input,
  `PlayFooterNav` destinations, `CollapseButton`, `LocationPopulationPanel`
  trigger. All inherit one shared CSS rule, so the fix belongs there.
- Mission guidance on beveled controls = 2px inset box-shadow ring at the
  padding edge + inset glow, plus the unclipped `.rs-control-halo` exterior
  drop-shadow (#171).

### Plan / checkpoint

1. One shared rule: `.rs-bevel.rs-focus:focus-visible` keeps the 2px
   `--rs-focus-ring` outline but moves it **inside** the control with a negative
   `outline-offset`, far enough in that the whole rectangle clears the chamfer
   (so the ring is uncut) and leaves a visible gap inside the Mission inset ring.
   Outline (not box-shadow) so it composes with the Mission inset box-shadow and
   survives forced-colors. Specificity (0,3,0) beats the Mission `outline: none`.
2. No markup, sizing, bevel, or Mission color changes.
3. Regression: a shared E2E fixture that proves focus **paints** by diffing
   real element screenshots (unfocused vs keyboard-focused, and pointer-focused
   vs unfocused), decoded in-browser via canvas — no new dependency. Wired into
   canonical specs: unguided `ActionLink` + unguided `ActionButton`
   (holo-hollow), green `MissionActionLink` Enter (holo-hollow, 390px and
   desktop), blue `MissionActionButton` Talk + pointer check (walk-it-off),
   green `MissionActionButton` Talk (walk-it-off).
4. Docs: `docs/design-system.md` accessibility/bevel note.

### Execution log

- Implemented directly (small shared CSS change): `--rs-bevel-focus-inset`
  token (0.4375rem = 7px) + `.rs-bevel.rs-focus:focus-visible { outline-offset:
  calc(-1 * var(--rs-bevel-focus-inset)) }`. Ring occupies 5–7px inside the
  border edge: clear of the 6.4px chamfer at every corner and 2px inside the
  Mission inset ring (1–3px).
- Fixtures `expectKeyboardFocusRingPaints` / `expectPointerFocusWithoutRing`
  added to `tests/e2e/fixtures.ts`; wired into holo-hollow + walk-it-off.
- Tooling incident (not an app defect): a plain `pnpm test:e2e` run had every
  worker fail sign-in ("Worker authentication did not reach /characters"). The
  focused runner pins one `BETTER_AUTH_SECRET` placeholder for both the test
  process (which signs session cookies) and the server; the plain run did not.
  Rerun with the focused runner's local-only placeholder secret. Also: an earlier
  run was aborted because a `git stash` briefly reverted sources mid-build —
  never stash while a build is running.
- Two real defects found by the first pixel run and fixed:
  1. Test harness: `scrollIntoViewIfNeeded` left controls under the fixed bottom
     navigation, so both screenshots captured the footer (0 changed pixels).
     Helpers now center the control (`scrollIntoView({ block: "center" })`).
  2. CSS: guided controls get `outline: none` from `.rs-bevel.rs-mission-*`
     (later, equal specificity to `.rs-focus:focus-visible`), so the bevel rule
     must set the outline itself, not only the offset.
- Local validation on `issue-173-bevel-focus-visible` (home host):
  - `pnpm typecheck` ✅, `pnpm lint` ✅ (no warnings), `pnpm format:check` ✅,
    `pnpm test` ✅ (71 files).
  - Targeted E2E `holo-hollow.spec.ts` + `walk-it-off.spec.ts`, chromium,
    `--retries=0`: **8/8 passed** (1.4m).
  - Same specs with the pre-fix `app/globals.css` swapped in: **4 failed / 4
    passed** — exactly the four tests with focus checks fail with 0 changed
    pixels, proving the regression test detects the invisible ring.
- Visual verification (real Chromium, rendered element screenshots, committed
  to `docs/screenshots/issue-173/`): unguided Enter `ActionLink`, unguided Trade
  `ActionButton`, green Enter `MissionActionLink` (390px + 1280px), blue Talk
  `MissionActionButton` (rest vs focus), green Talk `MissionActionButton`. Each
  focused control shows a pale-cyan inner rectangle, uncut at the chamfer, 2px
  inside the green/blue Mission edge ring; exterior halos unchanged. Pointer
  focus (Wade Talk, Trade) pixel-identical to rest.

---

## #143 — generic Mission destination and turn-in guidance

### Findings (read-only inspection, from `caed481`)

- All Mission truth is server-projected: `server/mission-state.ts`
  `loadMissionProjections` → `projectMission` (`game/domain/missions.ts`) in
  authored `MISSIONS` order. Clients only reduce projections.
- `MissionProjection.stage.requirementsSatisfied` already is the semantic
  turn-in phase (all authored requirements hold, independent of location /
  stationary); `stage.turnInAvailable` is "executable now". No new fact needed.
- `deriveGuidance` today: available → `availableNpcIds` (offers at the current
  location only); accepted → first unmet requirement → equipment / action /
  cargoRepair / NPC; all satisfied → `npcGuidance(turnIn.npcId)`, i.e. turn-in
  is currently **green** and indistinguishable from active NPC work.
  `npcGuidance` yields `localPlaceId` only when the NPC's Local Place is at the
  current World Location; nothing ever yields a World Location target.
  `at_location` produces no guidance at all.
- Consumers: `NpcInteractionPanel` (Talk), `LocalPlaceDirectory` (Enter),
  `NpcConversation` hub entries via `conversation.ts guidanceFor`, Mining /
  Refining / Cargo / Equipment / Inventory. Map (`LocalMapPanel` HexButton +
  HexMapSvg) has no Mission guidance.
- Content facts: Walk It Off `[at_location theJag]` → Tansy@Jag. Cut Your Teeth
  `[at_location theJag, equipped cutter, mining 5 (rec mining), carried shale
  (rec mining)]` → Tansy@Jag. Waste Not `[refining 5 (rec refining)]` →
  Wade@Crash Site. Hold It Together `[cargo_hold_repaired]` → Wade@Crash Site.
  Keep the Change `[npc_conversation Bix@Holo Hollow, carried 3 Power Cells (no
  recommendedActionId)]` → Tansy@Jag. Location action availability:
  Crash Site = cargoHoldWelding, Processing Yard = refining, The Jag = mining.

### Plan / checkpoint

1. Domain (`game/domain/missions.ts`), one projection, no persistence:
   - `MissionGuidance` gains `turnIn?: true` (the npc/place/location targets are
     the final handoff, set exactly when `requirementsSatisfied`) and
     `locationId?` (remote World Location target; emitted only when the target
     boundary is not at the current location).
   - Location resolution is generic from authored data: `at_location` →
     its `locationId`; `npc_conversation` → its authored `locationId`; turn-in →
     `turnIn.locationId`; action-backed requirements (`recommendedActionId`) →
     the single location whose `availableActionIds` offers that action (none or
     several → no destination; current location offers it → local action only).
     Carried requirements without `recommendedActionId` (Power Cells) → nothing.
   - `MissionGuidanceTargets` adds `turnInNpcIds`, `turnInLocalPlaceIds`,
     `locationIds` (green MISSION), `turnInLocationIds` (blue TURN IN). Available
     stays its own set.
   - Presentation precedence, documented: active green > turn-in blue >
     available blue; map markers keep both facts in text/aria when they collide.
2. Presentation kind: `MissionGuidanceKind` gains `"turn_in"`, sharing the blue
   treatment (`.rs-mission-available` class + blue halo) with its own
   `data-mission-guidance="turn_in"` / halo tone.
3. Consumers: Talk (NpcInteractionPanel), hub entries (conversation.ts),
   Local Place Enter, Map hexes (marker plate MISSION / TURN IN + accessible
   label + green/blue ring on the hex, current/selected/reachable/transit kept).
4. Tests: unit projection/union tests for every #143 case + the four proof
   Missions; E2E updates where turn-in was asserted green; map marker E2E in
   walk-it-off (The Jag MISSION) and holo-hollow (Keep the Change chain).
5. Docs: `docs/missions.md` §10, `docs/travel-map-design.md`,
   `docs/design-system.md`; public Wiki/Update per `docs/public-wiki.md` /
   `docs/public-updates.md` if player-facing facts change.
