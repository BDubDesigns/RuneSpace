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
| #143 | `issue-143-mission-destination-guidance` | `058adfa` | #178 | `ab0e754` | integrated (commit `96df680`, `--no-ff` merge) |
| #174 | `issue-174-mission-guidance-strips` | `ab0e754` | #179 | `12de109` | integrated (commit `6d97358`, `--no-ff` merge) |

Final combined code SHA: `12de1098767c46ac51e3e0c7ef95f01421800ede` (all three
slices). Later staging commits, if any, are ledger-only documentation.

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

### Execution log

- Branch `issue-174-mission-guidance-strips` from `ab0e754` (post-#143).
- PR #178 (#143) remote CI: fast checks, PostgreSQL integration, canonical E2E
  shards 1–3, Full gate, Merge gate — all ✅.
- Implemented directly (Opus): `missionGuidancePhase` (domain; reads
  `stage.requirementsSatisfied`, unit-proven identical to `guidance.turnIn` in
  every Keep the Change stage × location); `features/missions/MissionGuidanceStrips.tsx`
  rendered as `PlayConsole`'s first child on every surface; old
  `MissionObjectivePanel` deleted. Strips reuse the shared
  `.rs-mission-guidance` / blue classes on a dark `--rs-surface-panel` row, text
  phase label (Active / Turn in), current objective, plus other unmet
  requirements with numeric progress (projection text, no parsing).
- Reconciliation (recorded per #174 "stop and reconcile explicitly"):
  click-to-open-Mission-Log removed (explicitly forbidden on strips; the footer
  Missions button remains the Log entry point). The existing, tested Open
  Equipment shortcut is preserved unchanged in accessible name and behaviour,
  inside the strip whose Mission targets equipment; the strip itself is not a
  control.
- Test migration: `[data-mission-objective*]` → strip selectors in walk-it-off /
  cut-your-teeth. The six old "HUD lists no requirements" assertions encoded the
  superseded single-objective design: two now assert the in-progress
  requirement IS shown (equip stage → Mining; Mining stage → Shale), four stay
  count 0 where no other numeric requirement remains, plus new blue-phase
  assertions. Walk-it-off's "NPC panel immediately follows the objective
  panel" sibling check replaced by a turn-in-phase check (layout intentionally
  changed); new "no strip stack before any Mission is accepted" check.
- Terminology guard (`mission-framework.test.ts`) listed the deleted panel;
  retargeted to its successor file (guard strength unchanged).
- New canonical E2E (holo-hollow): two accepted Missions (Hold It Together
  work + Keep the Change remote turn-in) — first child under the header on
  Location, Map, Local Place, Journey; order; phases in text; blue stays blue at
  The Jag; completed strip disappears; static position + scrolls away; glow not
  clipped; 390px no overflow; stack < 35% of viewport; strip and Map TURN IN
  agree.
- Local: typecheck ✅, lint ✅, format ✅, unit 73 files / 713 ✅, Wiki/Update
  validation ✅. `pnpm test:integration` (disposable PostgreSQL) on the #174
  branch: 23 files / 258 passed, 9 skipped (gated one-time backfill suites) ✅.
- First #174 targeted run: the #143 Keep the Change map test failed at its
  "no invented guidance anywhere" check (`page.locator("[data-mission-guidance]")`
  count 0 in Holo Hollow after Bix) because the new strips also carried
  `data-mission-guidance`. Diagnosis: a strip is a status row, not an
  interaction target, so the attribute conflated two meanings. Fix in the
  component (not the test): strips expose only `data-mission-phase`
  (`work` / `turn_in`); the #174 E2E asserts phase and that the stack contains
  no `[data-mission-guidance]`; `docs/missions.md` records the contract. The
  new strip test itself passed on that run (plain run: 9 passed, 1 failed —
  exactly `holo-hollow.spec.ts:152`, expected 0 / received 1).
- `pnpm test:e2e:focused cut-your-teeth` on the #174 branch: **1/1 passed**
  (strip selectors + blue-phase assertions). The later attribute fix touches no
  selector this spec uses.
- Temporary screenshot hooks removed after capture; rerunning holo-hollow +
  walk-it-off on the fixed component.
- Visual verification (real Chromium, 390px, `docs/screenshots/issue-174/`):
  Location and Map show the green Hold It Together (Active) and blue Keep the
  Change (Turn in, remote) strips as the first content under the header, dark
  interiors, crisp white objective text, shared border/outline/glow; the Map's
  The Jag TURN IN hex agrees with the blue strip; Journey shows the single
  remaining blue strip above the transit panel. Compact, no overflow.
- Noted, not changed (out of scope): `docs/testing-strategy.md` still quotes
  "73 behavioral tests in 14 specs" and omits holo-hollow; nothing enforces the
  count, and the text was already stale before this run. Docs: `docs/missions.md` strip subsection, `design-system.md`
  note; Wiki line + unpublished `following-the-job` Update amended.

---

## Final combined validation (staging head `12de109`)

All three slices integrated in order: `44ca235` → #173 `058adfa` → #143
`ab0e754` → #174 `12de109`. `origin/main` unchanged at `caed481`.

### Local CI-parity sequence (home host, `./scripts/managed-host-run.sh`)

| Step | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm lint` | ✅ |
| `pnpm format:check` | ✅ |
| `pnpm test` | ✅ 73 files / 713 tests |
| `pnpm drizzle-kit migrate` (committed-migration check; no new migrations) | ✅ |
| `pnpm test:integration` (disposable PostgreSQL) | ✅ 23 files / 258 passed, 9 skipped (gated backfill suites) |
| `pnpm build` (CI build-only placeholder secret) | ✅ |
| `pnpm test:e2e:canonical` | ✅ 83 passed, 0 retries (215.8 s) |

### Composition checks (#176)

- #173 on later controls: the canonical walk-it-off test paints and diffs the
  keyboard focus ring on Tansy's Talk control, which #143 made blue `turn_in`;
  holo-hollow paints it on the green Enter link at 390px and desktop.
- #143 ↔ #174 agreement: the canonical strip test asserts the blue Keep the
  Change strip and the Map's blue The Jag TURN IN hex for the same state, and
  that strips never carry `data-mission-guidance` (so #143's "no invented
  guidance" count stays meaningful).
- Keep the Change end-to-end: holo-hollow covers Holo Hollow MISSION → shop
  Enter green → Bix green → no invented Cell source → The Jag TURN IN while
  remote → Tansy blue at The Jag.
- Mission discovery unchanged: walk-it-off still asserts Wade's blue
  `available` offer and no strip before acceptance; availability never reaches
  the map or a Local Place entrance (unit + E2E).
- Mission Log unchanged: cut-your-teeth still asserts the Log's requirement
  checklist and next-step copy.
- Mobile: strips and map markers verified at 390px (no horizontal overflow).

### Remote

- Slice PRs into staging: #177 and #178 — every check ✅ (fast, PostgreSQL,
  canonical shards 1–3, Full gate, Merge gate); #179 — every check ✅ as well.
- Draft review PR `staging → main`: **#180** (opened per Brandon's approval,
  `full-ci` applied). Combined-head run `34691151983` on `12de109`:
  fast checks ✅, PostgreSQL integration ✅, canonical shards 1–3 ✅, Full gate
  ✅; Merge gate ✗ by design ("Draft checkpoint: merge validation is
  intentionally unsatisfied"). The superseded run `34691150986` shows cancelled
  jobs (including the unexpanded `shard ${{ matrix.shard }}` row) because the
  `full-ci` label started the replacement run — CI concurrency, not a failure. The first run was cancelled by the label-triggered
  replacement run (expected CI concurrency); draft `Merge gate` is designed to
  stay unsatisfied. Preview: `https://pr-180.runespace.qcfailed.com` —
  `/api/build-info` `releaseId` = `12de1098767c46ac51e3e0c7ef95f01421800ede`,
  **exact match** with the PR head (verified by bounded polling).

### Run end state

- `main`: `caed481` — untouched by the run (no merge, no push, no reset).
- `staging/mission-guidance-cleanup`: code head `12de109` = #173 → #143 → #174,
  each via its own PR (#177, #178, #179) and `--no-ff` merge; this ledger's
  final update is a docs-only commit on top.
- Draft review PR #180 (`staging → main`, `full-ci`) is Brandon's to review
  and merge; issues #173, #143, #174, #176 stay open until then.
- No production deployment, no production or preview database changes, no
  Coolify/Docker/CI configuration changes.
