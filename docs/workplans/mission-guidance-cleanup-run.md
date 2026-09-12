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
| #173 | `issue-173-bevel-focus-visible` | `44ca235` | #177 | `058adfa` | integrated (commit `9e4c782`, `--no-ff` merge) |
| #143 | `issue-143-mission-destination-guidance` | `058adfa` | — | — | in progress |
| #174 | `issue-174-mission-guidance-strips` | (post-#143 staging head) | — | — | planned |

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

### Execution log

- Domain implemented directly (Opus): `MissionGuidance.turnIn` / `.locationId`;
  `npcBoundaryGuidance` (remote World Location → local NPC/Local Place) used
  for `npc_conversation` and turn-in; `at_location` → `locationId`;
  `actionDestination` (single offering location, else none); carried
  requirements with no `recommendedActionId` → no guidance. Target sets split
  into active / `turnIn*`; `npcGuidanceMeaning` / `localPlaceGuidanceMeaning`
  own precedence (active > turn_in > available). `MissionGuidanceKind` gains
  `turn_in` (blue class, own `mission-turn-in` halo tone). Consumers: Talk,
  Local Place Enter, hub entries (`conversation.ts guidanceFor`), Map hexes
  (MISSION / TURN IN plate overlaid in the artwork band + ring polygon outside
  the chassis; aria "Mission destination." / "Mission turn-in.").
- Updated 8 pre-#143 unit tests that encoded the superseded semantics (turn-in
  green in `npcIds`; "no World Location channel") — each strengthened to the
  refreshed contract, none weakened. Updated E2E turn-in expectations
  (walk-it-off Tansy, cut-your-teeth Tansy + Wade) from `active` to `turn_in`.
- Delegated (Sonnet, reviewed by Opus): `tests/unit/mission-destination-guidance.test.ts`
  (21 tests, every #143 projection case + the four proof Missions + hub entries;
  no implementation discrepancies found). Docs/Wiki/Update pass delegated to a
  second Sonnet agent (review pending).
- New/extended E2E: walk-it-off (The Jag MISSION on map after acceptance),
  cut-your-teeth (Processing Yard MISSION before travel; Crash Site TURN IN at the
  Yard; Wade `turn_in`), holo-hollow new test (Keep the Change: Holo Hollow
  MISSION from Crash Site → no invented Cell source → The Jag TURN IN while in
  Holo Hollow → Tansy `turn_in` halo at The Jag; ring paint check).
- Local: `pnpm typecheck` ✅, `pnpm lint` ✅, unit 688/688 ✅ (before the new file);
  with the new file 72 files / 709 tests ✅. Docs agent output reviewed; one
  correction made (`travel-map-design.md` described "both plates" — it is one
  plate reading MISSION / TURN IN / MISSION · TURN IN).
- Targeted E2E (plain `pnpm test:e2e`, holo-hollow + walk-it-off +
  cut-your-teeth, `--retries=0`): 9 passed, 1 failed —
  `cut-your-teeth.spec.ts:212` expected "3 / 10" shale, got "1 / 10". Observed
  a real (non-deterministic) Mining roll in the failure screenshot; the plain run
  lacks `RUNESPACE_E2E_MINING=true`, which the focused/canonical runners set to
  select the deterministic server Mining RNG. Test-environment difference, not a
  #143 defect (the failing line precedes every #143 assertion in that test).
  Reproducing through the sanctioned `pnpm test:e2e:focused cut-your-teeth`.
- Visual review (real Chromium, `docs/screenshots/issue-143/`): green Holo
  Hollow ring + MISSION and blue The Jag ring + TURN IN paint clearly; current /
  reachable / visible plates stay legible at 390px and desktop. Defect found:
  the marker plate drifted right (touching The Jag's edge) because
  `.rs-map-plate { position: relative }` (later in globals.css) overrode the
  Tailwind `absolute`. Fix: absolute wrapper span positions, plate inside.
- `pnpm test:e2e:focused cut-your-teeth` (sanctioned runner, deterministic Mining
  flags): **1/1 passed** — including every new #143 assertion in it (Processing
  Yard MISSION, Crash Site TURN IN from the Yard, Tansy + Wade `turn_in`).
  Diagnosis confirmed: the plain-run failure was the missing
  `RUNESPACE_E2E_MINING` flag, not a code defect.

---

## #174 — compact top-of-Play Mission guidance strips

### Findings (read-only inspection, pre-#143-merge)

- Play composition: `PlayScreen` → `GameShell` (`space-y-4`: `PlayTopBar`
  header, then `<main>`) → `PlayConsole`, whose `space-y-4` container renders
  exactly one surface first (Map → `LocalMapPanel`; in transit → `JourneyPanel`;
  else `LocationSurface`, which also hosts the active Local Place). The first
  child of `PlayConsole`'s container is therefore "immediately below the Play
  header, before primary surface content" on every surface — the one shared
  boundary.
- Current `MissionObjectivePanel` (`[data-mission-objective]`): renders only on
  `surface === "primary"` (never Map), shows ONE Mission (newest
  `ready_for_completion`, else newest active), brass `--rs-mission-*` card.
  Existing interactions: (a) the whole card is a button opening the Mission Log
  focused on that Mission; (b) an **Open Equipment** shortcut when the Mission's
  guidance targets equipment — covered by `openEquipmentFromMissionGuidance`
  (cut-your-teeth E2E: "must not regress into the footer Inventory → Equipment
  tab relay").
- Mission order: `state.missions` is authored `MISSIONS` order (server
  `loadMissionProjections`) — the existing deterministic order.
- #143 semantics to consume: `projection.stage.requirementsSatisfied` (turn-in
  phase; mirrors `guidance.turnIn`) — no UI re-derivation.

### Plan / checkpoint

1. New `features/missions/MissionGuidanceStrips.tsx`, rendered as the first
   child of `PlayConsole` on every surface (Location, Local Place, Journey, Map),
   normal flow, not sticky; replaces `MissionObjectivePanel`.
2. One strip per accepted non-completed Mission (`active` /
   `ready_for_completion`) in `state.missions` order; no selection/tracking;
   no strip stack at all when none.
3. Semantic phase from one domain helper (`missionGuidancePhase(projection)` →
   `"work" | "turn_in"`, reading `stage.requirementsSatisfied`) — green work /
   blue turn-in via the shared Mission tokens; dark surface, crisp text, border,
   real exterior glow (not clipped: no bevel/clip-path/overflow on the strip).
4. Content: Mission title · current objective, plus compact progress for every
   authored requirement that has numeric progress (preserves multi-requirement
   Missions), all from the projection; no Mission-ID branches, no prose parsing.
5. Interaction reconciliation (issue: "stop and reconcile explicitly"):
   - Click-to-open-Mission-Log is **removed** — #174 explicitly forbids
     click-to-open Mission Log on strips; the footer Missions button remains the
     Log's entry point.
   - **Open Equipment** is an existing, tested Mission-guidance affordance, not
     new strip behavior. Preserve it: rendered as a separate compact control
     beside/below the owning strip when that Mission's guidance targets
     equipment (unchanged trigger + accessible name). The strip itself stays
     non-interactive.
6. Tests: unit for the phase helper + strip model; E2E: stack placement
   (first child under header) on Location, Local Place, Journey, Map; green vs
   blue incl. remote turn-in; multi-strip stacking + mixed state; 390px no
   overflow; glow paints; update existing `[data-mission-objective]`
   assertions to the strip contract.
7. Docs: `docs/missions.md` (short strip section pointing to §10),
   `docs/design-system.md`; Wiki/Update amended in the same unpublished
   `following-the-job` Update if player-facing.
