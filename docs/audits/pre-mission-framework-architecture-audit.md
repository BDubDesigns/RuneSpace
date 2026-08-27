# Pre-Mission-Framework Architecture Audit — RuneSpace `main` @ `a1a4fc6`

**Date:** 2026-08-26  
**Scope commit:** `a1a4fc6` — `feat(issue-119): make Inventory item details generic and metadata-driven (#120)`  
**Auditor:** Hermes (branch `audit/issue-121-pre-mission-framework-audit`)  
**Mandate:** Issue #121 — inspection and documentation only. No production code, test, schema, balance, dependency, CI, or doc changes except this report. Recently addressed boundaries #112, #116, #119/#120 treated as resolved unless a concrete remaining violation is proven.  
**Intended consumer:** Issue #114 — *Build an authoritative declarative mission framework with semantic quest guidance* (full issue re-read before writing).

---

## 1. Executive summary

Fresh `main` is **safe to generalize into #114 without a prerequisite blocker issue**. The two production missions prove the same invariants #114 needs to reuse rather than replace: server-authoritative acceptance/completion guarded by a shared character-row lock, timestamp-only persistence with derived state, atomic exactly-once reward commits, deterministic objective projection from live equipment/inventory observations, and SG-ready separation of *requirements satisfied* from *turn-in performable*.

No A-level (blocker) finding survived evidence checks. The most material risks are shaped as two B-level items — show-vs-consume semantics exercised atomically through the #112 adapter (B1), and a single semantic dialogue/guidance projection contract instead of extending the two parallel routing helpers (B2). Both are already explicitly required by #114 and are ordinary framework implementation work, not reasons to stop and fix something first; they are documented here as implementation risks and focus areas for #114 (see §6 and §8).

The audit also confirms the three "do not rediscover" claims: carried-stack mutation is centralized and missions do not bypass it; mass formatting is canonical through `game/domain/mass.ts`; generic inventory details no longer branch on item IDs. Those slices are strengths to preserve, not debt to report.

**Final recommendation — exactly one:** **(1) Proceed with #114 unchanged** — no new amendments; B1 and B2 are documented as important implementation risks and focus areas already explicitly required by #114 (see §6 and §8). No separate blocker issue is required.

---

## 2. Scope and inspected authoritative surfaces

The audit was performed from fresh `origin/main` (`git fetch` → `git reset --hard origin/main` on 2026-08-26). `AGENTS.md`, `docs/architecture.md`, `docs/component-boundaries.md`, `docs/game-rules.md`, `docs/gameplay-foundations.md`, `docs/testing-strategy.md`, and `docs/development-workflow.md` were re-read before analysis, and every conclusion below was checked against real code, schema, and tests — not remembered architecture.

### Persistence and schema

| Surface | Evidence |
|---|---|
| Mission rows | `db/rune-space.ts` `characterMissions` `primaryKey(characterId, missionId)`, `check(completion_requires_acceptance)` |
| Inventory | `inventoryStacks` (one row = one slot, `quantity > 0`, `characterId` index), `itemInstances` (unique instances, `currentCharge` nullable-norm), `equippedItems` (`characterId+instanceId` owns + slot uniqueness) |
| Action cursor | `activeActions` (`characterId` PK — one row enforces one-active-action), `characterTravelState`, `characterMiningState` / `characterRefiningState` |
| Progression | `characterSkillXp` (`characterId, skillId` unique, `totalXp >= 0`) |

### Domain and content

| Surface | Evidence |
|---|---|
| Mission definitions | `game/content/missions.ts` — `WALK_IT_OFF`, `CUT_YOUR_TEETH`, `MissionDefinition`, `MissionReward` (`item \| skill_xp`), `MissionObjectiveStep` (`equip_item \| carry_stack`) |
| Mission projection | `game/domain/missions.ts` — `deriveMissionState`, `projectMission`, `renderObjectiveTemplate`, `requiredQuantity`, `stepSatisfied`, `stepsSatisfied` |
| Balance SSOT | `game/config/balance.ts` — `getEffectiveGameBalance()`, `getItemDefinition()`, `skillLevelThresholds()` |
| Identity SSOT | `game/config/foundations.ts` — `ITEM_IDS`, `MISSION_IDS`, `NPC_IDS`, `LOCATION_IDS`, `ACTION_IDS`, `SKILL_IDS` |
| Inventory rules | `game/domain/inventory.ts` — `planUniqueItemAddition`, `planExactStackRemoval`, `planStackAddition`, `planExactStackAddition`, `planPossibleAwardAdditions` |
| Equipment rules | `game/domain/equipment.ts` — `deriveEquipmentLoadout`, `planEquipmentChange`, `isCompatibleEquipmentAssignment` |
| Progression rule | `game/domain/progression.ts` — `grantSkillXp`, `levelFromXp`, `skillLevelProgress` (sole XP boundary) |
| Mass presentation | `game/domain/mass.ts` — `formatMassGrams` (integer-gram SSOT, locale-independent) |
| Dialogue content | `game/content/dialogue.ts` — `DialogueSequence` / `DialogueBeat` (`npc \| item \| skill_xp`), `DIALOGUE_IDS`, `CUT_YOUR_TEETH_DIALOGUE` |
| Location/NPC SSOT | `game/content/locations.ts`, `game/content/npcs.ts`, `game/config/foundations.ts:LOCATION_IDS` |

### Server orchestration

| Surface | Evidence |
|---|---|
| Command lock | `server/action-resolution.ts` — `withResolvedOwnedCharacter`, `withLockedOwnedCharacter`, `lockOwnedCharacter` (`characters … for update`), durable `activeActions` cursor, `readOnlySnapshot` guard |
| Mission commands | `server/missions.ts` — `acceptWalkItOff`, `completeWalkItOff`, `acceptCutYourTeeth`, `completeCutYourTeeth` |
| Mission projection | `server/mission-state.ts` — `loadMissionProjections`, `buildObservation`, `prerequisiteCompletedFor` |
| Inventory adapter | `server/carried-inventory.ts` — `addStackableItem`, `applyStackRemovalPlan`, `consumeStackableItem`, `removeFromSelectedStack`, `loadOwnedItemInstances` |
| Progression writer | `server/progression.ts` — `grantCharacterSkillXp` |
| Equipment writer | `server/equipment.ts` — `changeEquipment` |
| Play-state assembly | `server/mining.ts` — `stateFromTransaction`, `loadMiningSnapshot`, `createPlayResolver` (lazy resolve + persist before cursor advance), `MiningGameplayState` |
| Request validation | `game/schemas/gameplay.ts` — mission request schemas (`characterId` only), inventory/equipment/travel schemas |
| Server actions | `server/actions.ts` — `acceptWalkItOffAction`, `completeWalkItOffAction`, `acceptCutYourTeethAction`, `completeCutYourTeethAction` (thin Zod + ownership wrappers) |
| Travel/scavenge/power-annex/refining/welding/cargo-hold | `server/travel.ts`, `server/mining.ts`, `server/refining.ts`, `server/welding.ts`, `server/power-annex.ts`, `server/cargo-hold.ts` — inspected only where they affect stationary/busy, inventory findings, or transaction boundaries |

### Projection and UI

| Surface | Evidence |
|---|---|
| Dialogue routing | `features/npc/NpcInteractionPanel.tsx` — `resolveDialogueForNpc`, `asMissionState`, `turnInAvailable` derivation |
| Mission panel | `features/missions/MissionObjectivePanel.tsx` — `state.missions` reverse-scan for `active → available → completedFallback` |
| Dialogue player | `features/dialogue/DialoguePlayer.tsx`, `features/dialogue/DialogueScene.tsx` |
| Inventory/equipment/mining UI | `features/mining/InventoryPanel.tsx`, `features/mining/InventoryDetailsStats.tsx`, `features/mining/MiningConsole.tsx`, `features/mining/EquipmentPanel.tsx`, `features/shared/CargoReadout.tsx` |

### Tests inspected

Unit: `tests/unit/missions.test.ts`, `tests/unit/cut-your-teeth.test.ts`, `tests/unit/mass.test.ts`, `tests/unit/inventory-generic-details.test.ts`, `tests/unit/equipment.test.ts`, `tests/unit/mining.test.ts`.

Integration (real PostgreSQL, condition-gated): `tests/integration/walk-it-off.test.ts`, `tests/integration/cut-your-teeth.test.ts`, `tests/integration/carried-inventory.test.ts`, `tests/integration/carried-stack-adapter.test.ts`.

E2E: `tests/e2e/walk-it-off.spec.ts`, `tests/e2e/cut-your-teeth.spec.ts`, `tests/e2e/mining.spec.ts`, `tests/e2e/travel.spec.ts`, `tests/e2e/inventory-equip.spec.ts`.

### Explicitly not expanded

Repository-wide lint/formatting sweep, generic scripting engine design, Quest Log or navigation redesign, third mission authoring, ECS/event-bus proposals, and admin console (#113) internals — all out of scope per #121 §Guardrails and sampled only where they would materially mislead #114.

---

## 3. Current mission architecture map — Walk It Off and Cut Your Teeth end-to-end

Both missions share the same persistence shape and the same `withResolvedOwnedCharacter` character-row serialization, but keep separate server functions and separate dialogue helpers. The map below names the exact modules that own each step.

### 3.1 Shared primitives

- **Persistence owns only timestamps.** `characterMissions(characterId, missionId, acceptedAt, completedAt)` with `completedAt IS NULL OR acceptedAt IS NOT NULL` check (`db/rune-space.ts:characterMissions`). No objective progress, counts, or history rows ever persist.
- **Mission identity lives once.** `game/config/foundations.ts:MISSION_IDS.walkItOff / cutYourTeeth` → `game/content/missions.ts:WALK_IT_OFF / CUT_YOUR_TEETH` (title/summary/NPC/location/reward/prerequisite/objectives) → `game/domain/missions.ts:projectMission` derives `state + currentObjective + stage` on every read.
- **State derivation is four-valued.** `game/domain/missions.ts:deriveMissionState` → `not_accepted` (no `acceptedAt`), `completed` (`completedAt`), `ready_for_completion` (`acceptedAt && stationary && atRelevantLocation && stepsSatisfied`), otherwise `active`. Walk It Off has no `objectiveSteps`, so `stepsSatisfied` defaults true and readiness collapses to location+stationary — the deliberately preserved location-based shape (`game/domain/missions.ts:stepsSatisfied`).
- **Every command re-validates inside the lock.** `server/action-resolution.ts:lockOwnedCharacter` joins `playerAccounts.userId` → `characters.id for update`, then locks `activeActions for update` and lazily resolves any elapsed ticks before the caller-supplied `command` runs. Concurrency is therefore serialized on the character PK, not on a per-mission lock.
- **Gameplay projection is assembled in one place.** `server/mining.ts:stateFromTransaction` is the sole `MiningGameplayState` factory: it calls `server/mission-state.ts:loadMissionProjections` alongside XP, stacks, equipment, travel, and scavenge rows. UI never reconstructs missions from scattered fetches.

### 3.2 Walk It Off — authoritative lifecycle

| Stage | Authoritative owner | What actually happens | Evidence |
|---|---|---|---|
| **Discovery** | Location + NPC SSOT, not mission rows | Mission is invisible until the player reaches a quest giver: the panel hides `not_accepted` (`features/missions/MissionObjectivePanel.tsx:active/available/completedFallback` scan). NPC presence is location-driven (`NpcInteractionPanel` + `game/content/npcs.ts:getNpcAtLocation`). | `features/missions/MissionObjectivePanel.tsx:30-60`, `game/content/npcs.ts` |
| **Acceptance** | `server/missions.ts:acceptWalkItOff` | Requires stationary at Crash Site or The Jag and no `activeActions` row (`wade.homeLocationId` or `tansy.homeLocationId`). Reads `characterMissions for update` scoped to `WALK_IT_OFF.id`; idempotent on `already_completed`/`already_accepted`; inserts `(characterId, WALK_IT_OFF.id, acceptedAt: now)` with `onConflictDoNothing`. | `server/missions.ts:116-173` |
| **Objective projection** | `game/domain/missions.ts:deriveCurrentObjective` + `server/mission-state.ts:buildObservation` | No `objectiveSteps`, so panel shows `travelObjective` ("Travel to The Jag") when `active && currentLocationId !== theJag`, else `completionObjective` ("Talk to Tansy Rusk"). `buildObservation` is not needed for travel-family missions but is still built for uniform `stage` data (`requirementsSatisfied` true — no steps to fail). | `game/domain/missions.ts:112-157`, `game/content/missions.ts:WALK_IT_OFF` |
| **Completion eligibility** | Stationary + location gate | `completeWalkItOff` refuses `not_accepted` and `not_stationary` (`context.action` present or `currentLocationId !== theJag`). | `server/missions.ts:181-260` |
| **Reward — atomically** | Single `withResolvedOwnedCharacter` transaction | Preflights capacity through `game/domain/inventory.ts:planUniqueItemAddition` using the live `deriveEquipmentLoadout` snapshot (slots + mass). On `ok` inserts one `itemInstances(Salvage Cutter, currentCharge: 0)` and stamps `characterMissions.completedAt` with `isNull(completedAt)` guard — both commit or both roll back. Retries observe `already_completed`. | `server/missions.ts:261-322` |
| **Dialogue turn-in** | `game/content/dialogue.ts:getWalkItOffDialogue` + `features/npc/NpcInteractionPanel.tsx:resolveDialogueForNpc` | Wade: `wadeOffer (accept_mission)` → `wadeFollowUp`; Tansy local: `tansyBeforeMission (accept_mission)` ↔ `tansyCompletion (complete_mission, actionLabel:"Claim Cutter")` → `tansyAfterClaim` (item beat `Salvage Cutter ×1`, presentation-only) → capacity branches `tansyCapacitySlots/Mass`. `turnInAvailable` carves the Talk button's `mission` intent (`NpcInteractionPanel.tsx:turnInAvailable`). | `game/content/dialogue.ts`, `features/npc/NpcInteractionPanel.tsx:50-120` |
| **Post-completion** | Prerequisite signal | `projectMission(... prerequisiteCompleted)` for `CUT_YOUR_TEETH` becomes satisfied; `MissionObjectivePanel` starts leading with the newly `available` Cut Your Teeth instead of a stale completed banner (`completedFallback` only when no next story mission is currently available). | `server/mission-state.ts:prerequisiteCompletedFor`, `features/missions/MissionObjectivePanel.tsx` |

Key preserved invariant: explorer-first routing — a fresh character can walk to The Jag before ever talking to Wade and still accept Walk It Off at Tansy via the remote-accept path (`server/missions.ts:canAcceptAtLocation`). The explorer dialogue branch at `tansyBeforeMission` exists precisely to teach the chain rather than hide it (`game/content/dialogue.ts:tansyBeforeMission`).

### 3.3 Cut Your Teeth — authoritative lifecycle

| Stage | Authoritative owner | What actually happens | Evidence |
|---|---|---|---|
| **Prerequisite gate** | Both content and command | Content: `CUT_YOUR_TEETH.prerequisiteMissionId = walkItOff` (`game/content/missions.ts`). Projection: `prerequisiteSatisfied = completedAt` on `walkItOff` row (`server/mission-state.ts:prerequisiteCompletedFor`). Command: `acceptCutYourTeeth` and `completeCutYourTeeth` both re-query `walkItOff` inside the transaction and refuse `prerequisite` — owning a Cutter or carrying shale never bypasses it. | `game/content/missions.ts:CUT_YOUR_TEETH`, `server/mission-state.ts:41-52`, `server/missions.ts:363-438, 499-540` |
| **Acceptance** | `server/missions.ts:acceptCutYourTeeth` | Tansy-only, stationary at `theJag`, prerequisite already completed, `for update` on all `characterMissions` for character, idempotent. No location other than The Jag is accepted. | `server/missions.ts:339-390` |
| **Objective steps** | `game/content/missions.ts:CUT_YOUR_TEETH.objectiveSteps` | Two ordered steps: `equip_item(Salvage Cutter)` → `carry_stack(Ferrite Shale, quantity: undefined → authoritative `stackLimit` 10 via `game/config/balance.ts:items.ferriteShale.stackLimit`). Templates are the authored copy; `{item}`, `{carried}`, `{required}` are substituted by `game/domain/missions.ts:renderObjectiveTemplate` from the live `MissionObservation`. | `game/content/missions.ts:63-108`, `game/domain/missions.ts:38-80` |
| **Live observation** | `server/mission-state.ts:buildObservation` | `equippedCarriedIds` = assignments whose instance is still genuinely carried (a stored Cutter does not satisfy equip); `carriedQuantities` = sum across `inventoryStacks`; `itemNames` via `game/content/item-presentation.ts:resolveItemPresentation`; `stackLimits` via `getItemDefinition()`. Canonical step items are always included in `observedItemIds` even at zero quantity, so `0 / 10` never collapses to `0 / 1` (`server/mission-state.ts:72-108`). | `server/mission-state.ts:72-108` |
| **Projection stages** | `game/domain/missions.ts:projectMission` | Emits `stage.requirementsSatisfied` (all steps hold), `stage.turnInAvailable` (`ready_for_completion && requirementsSatisfied`), `stage.nextObjectiveKind` (first unsatisfied kind). Separation is the proven #110 invariant: requirements can be satisfied while still `active` (busy) — never a false "need more shale" when the stack is already full but `context.action` exists (`game/domain/missions.ts:deriveMissionState` requires `stationary` for `ready_for_completion`). | `game/domain/missions.ts:27-57, 140-226` |
| **Contextual dialogue & panel copy** | `features/npc/NpcInteractionPanel.tsx:resolveDialogueForNpc` (`ready`/`busy`/`equip`/`stack`) → `game/content/dialogue.ts:getCutYourTeethActiveDialogue` | `requirementsSatisfied && turnInAvailable` → `tansyCutYourTeethTurnIn (complete_mission, actionLabel:"SHOW SHALE")`; `requirementsSatisfied && !turnInAvailable` → `tansyCutYourTeethBusy` (explicitly "Finish what you're doing", never "gather more"); `nextObjectiveKind === equip_item` → `tansyCutYourTeethEquipReminder`; else → `tansyCutYourTeethStackReminder`. Panel `currentObjective` tracks the same ordering: travel → first unsatisfied step template → completion (`game/domain/missions.ts:deriveCurrentObjective`). | `game/content/dialogue.ts:CUT_YOUR_TEETH_DIALOGUE`, `features/npc/NpcInteractionPanel.tsx:73-108` |
| **Completion — atomically, without consuming shale** | `server/missions.ts:completeCutYourTeeth` inside `withResolvedOwnedCharacter` | Re-validates prerequisite, **stationary** (`context.action` + `locationId === theJag`), **equip** (instanceId still carried + `assignments.some(gear:mining_tool + itemId:Salvage Cutter)`, suit slot `mining_tool` from `getEffectiveGameBalance().items.salvageCutter.suitSlotId`), **full stack** (`carriedShale = sum(ferrite_shale stacks) ≥ shaleDefinition.stackLimit`). On success, `update characterMissions set completedAt where isNull(completedAt)` and `grantCharacterSkillXp(..., SKILL_IDS.mining, 100, miningLevelThresholds)` in same transaction — both succeed or both roll back; retries/concurrent first-completions serialize on the character lock and observe `already_completed`. Shale is **inspected, never consumed** — no `delete/update inventoryStacks` in this path (deliberate #110 "show not give" semantics). | `server/missions.ts:440-574`, `server/progression.ts:grantCharacterSkillXp`, `game/domain/progression.ts:grantSkillXp` |
| **Presentation after success** | `game/content/dialogue.ts:tansyCutYourTeethCompletion` | Five beats, presentation-only: `item(ferrite_shale, 10)` + `skill_xp(mining, 100)` + three Tansy lines. Never mutates state (`NpcInteractionPanel.tsx:overrideIsCompletion` path). | `game/content/dialogue.ts:363-392` |
| **Ready-while-busy nuance** | `game/domain/missions.ts:stage` + `server/mining.ts:stateFromTransaction` | While Mining/Refining/Welding `activeAction` exists, `state = active` but `stage.requirementsSatisfied = true`; `currentObjective` is already the completion copy ("Show a full stack…"). Clearing `activeActions` flips to `ready_for_completion` without re-collection. Integration coverage asserts this transition explicitly. | `game/domain/missions.ts:stage`, `tests/integration/cut-your-teeth.test.ts:406-452` |

Dialogue content invariant worth preserving: `tansyCutYourTeethStackReminder` teaches the intended loop ("Put that Salvage Cutter in your Mining Tool slot and work The Jag… If you scavenge a few… they still count") without creating a second acquisition authority — scavenged shale satisfies via the same `carriedQuantities` sum (`game/content/dialogue.ts:tansyCutYourTeethStackReminder` **not** `scavenge.ts`).

### 3.4 Mission projection → client contract

`server/mining.ts:stateFromTransaction` (lines ~758-925) assembles one `MiningGameplayState` that carries `missions: readonly MissionProjection[]` alongside inventory/equipment/XP/travel/scavenge. Every `MiningGameplayState`-returning command (`accept*`, `complete*`, `getMiningGameplayState`) produces the same projection through the same `loadMissionProjections` call, so there is no per-command projection fork. UI surfaces (`MissionObjectivePanel`, `NpcInteractionPanel`) consume only that projection — no endpoint derives mission truth a second way (`server/mission-state.ts` is the single projection owner).

---

## 4. Architectural strengths to preserve

#114 should reuse, not replace, the boundaries below. Each entry names why it is load-bearing for a declarative framework.

| # | Strength | Why it matters to #114 | Where it lives |
|---|---|---|---|
| **S1** | **Server-authoritative mission mutation behind one character lock.** Every acceptance/completion runs in `withResolvedOwnedCharacter` with `characters for update` → `activeActions for update` → `characterMissions for update`. Two concurrent first-completions cannot both win; the loser observes `already_completed`. | Gives the generic completion transaction its exactly-once primitive for free; #114 does not need a per-mission lock or an idempotency table. | `server/action-resolution.ts:withResolvedOwnedCharacter`, `server/missions.ts:accept*/complete*` |
| **S2** | **Timestamp-only persistence with derived, stateless projection.** No `objectiveProgress`, `carriedSinceAccept`, or `attemptLedger` rows. `deriveMissionState` + `stepsSatisfied` + `deriveCurrentObjective` recompute from `acceptedAt/completedAt + currentLocationId + stationary + observation` every read. | Makes the "ordinary missions are data + live state" thesis true: a third mission can add new `objectiveSteps` without migrating a progress ledger or backfilling history. | `db/rune-space.ts:characterMissions`, `game/domain/missions.ts:deriveMissionState/stepsSatisfied` |
| **S3** | **Semantic `stage` separated from prose.** `stage.requirementsSatisfied` vs `stage.turnInAvailable` plus `nextObjectiveKind` lets dialogue/turn-in routing avoid parsing `currentObjective` strings. | Is exactly the primitive #114's dialogue branching and guidance highlighting should extend — a closed-kind signal, not a string match. | `game/domain/missions.ts:MissionProjection.stage`, `features/npc/NpcInteractionPanel.tsx:resolveDialogueForNpc` |
| **S4** | **Canonical balance and identity SSOTs with narrow reward vocabulary.** `getEffectiveGameBalance() / getItemDefinition()` is the sole stack-limit/mass source; `game/config/foundations.ts` is the sole identity source. Reward is still `item \| skill_xp` (`MissionDefinition.reward`), not an effect script. | Lets a third mission's carried-quantity requirement reference an authoritative `stackLimit` without duplicating balance, and keeps reward commits small and auditable. | `game/config/balance.ts`, `game/config/foundations.ts`, `game/content/missions.ts:MissionReward` |
| **S5** | **Centralized carried-stack mutation adapter.** `server/carried-inventory.ts:consumeStackableItem / removeFromSelectedStack / addStackableItem / applyStackRemovalPlan` scope every `inventoryStacks` write to `(characterId, id)` and order removals deterministically (`quantity asc, createdAt asc, id asc`). Mission paths that need to consume must go through it, not raw `delete`. | Is the already-proven boundary #114's consumed-item turn-ins must reuse — avoids inventing mission-specific stack SQL and keeps atomicity inside the mission transaction. | `server/carried-inventory.ts:88-176`, `game/domain/inventory.ts:planExactStackRemoval` |
| **S6** | **Canonical mass formatting.** `formatMassGrams` (integer-gram arithmetic, locale-independent `g`/`kg` with trailing-zero stripping, `RangeError` on malformed input) is the single player-facing mass path. | Removes mass as a framework concern; #114 and any future capacity UI keep using the same token and never re-implement unit math. | `game/domain/mass.ts`, `features/mining/InventoryDetailsStats.tsx`, `features/mining/EquipmentPanel.tsx`, `features/shared/CargoReadout.tsx` |
| **S7** | **Generic inventory detail projection.** `features/mining/InventoryDetailsStats.tsx` renders any stack from `ResolvedInventorySelection` metadata (quantity/stackLimit/mass), not a `ferriteShale ? … : powerCell ? …` branch. Issue #119's value is real — first-ten-minutes inspection confirms zero item-ID enumeration in that panel. | Means the generic carried-quantity requirement and generic total-mass detail already agree: metadata, not mission knowledge, decides presentation. Third mission item details will render without a new branch. | `features/mining/InventoryDetailsStats.tsx`, `features/mining/inventory-selection.ts` |
| **S8** | **Hard prerequisite re-validation on every write.** Cut Your Teeth's prerequisite is declared in content (`prerequisiteMissionId`), projected via `prerequisiteCompletedFor`, **and** re-checked inside both `acceptCutYourTeeth` and `completeCutYourTeeth`. Owning a Cutter or carrying shale never bypasses it, and a `completedFallback` panel never leaks an unavailable quest. | Shows the declarative prerequisite signal is already true; #114 just needs to promote the re-validation into its generic transaction rather than adding a new prerequisite service. | `game/content/missions.ts:CUT_YOUR_TEETH`, `server/mission-state.ts:prerequisiteCompletedFor`, `server/missions.ts:365-530` |
| **S9** | **Busy-aware completion without lying.** When requirements are satisfied but Mining is still running, `state = active`, `stage.requirementsSatisfied = true && turnInAvailable = false`, `currentObjective` is already the completion copy, and NPC busy dialogue ("Finish what you're doing…") never claims more shale is needed. Clearing `activeActions` flips to `ready_for_completion` without re-collection. | Is the precise distinction #114's `turnInAvailable` and guidance must preserve: highlight eligibility vs performability, not just possession. | `game/domain/missions.ts:deriveMissionState + deriveCurrentObjective + stage`, `game/content/dialogue.ts:tansyCutYourTeethBusy` |
| **S10** | **Lean request contracts.** Mission accept/complete schemas carry only `characterId` (`game/schemas/gameplay.ts:AcceptWalkItOffRequestSchema` family). Item identity, required quantity, equipped-slot checks, and reward amounts are server-owned — no `requiredQuantity` or `consume` flag from the client. | Keeps #114's show-vs-consume distinction server-authored: the client sends intent ("complete"), not a shopping list. | `game/schemas/gameplay.ts`, `server/actions.ts:accept*/complete*Action` |
| **S11** | **Narrow, proven test invariants.** Unit proves traversal/completion copy and `stage` semantics without DB; integration proves exactly-once Cutter grant, exactly-once +100 XP, no shale consumption, busy refusal, stale-stack scoping, and concurrent first-completion serialization against real PostgreSQL; E2E proves Inventory → Equip → Show Shale journey with DialoguePlayer item/XP beats. Each layer carries load it is cheapest at. | Means #114 can add its consume-item transaction coverage alongside these without re-proving travel/equip already proved below it. | `tests/unit/cut-your-teeth.test.ts`, `tests/integration/walk-it-off.test.ts`, `tests/integration/cut-your-teeth.test.ts`, `tests/e2e/cut-your-teeth.spec.ts` |
| **S12** | **No speculative infrastructure.** No quest event bus, no ECS conversion, no Lua/JSON scripting, no per-step ledger, no random rewards, no party/shared scaffolding. `MISSION_IDS` / `missions: Map` is two entries and a `getMission()` helper — intentionally small. | Gives #114 a clean place to introduce a **closed set** requirement/effect vocabulary instead of inheriting a generic engine. | `game/config/foundations.ts:MISSION_IDS`, `game/content/missions.ts:missions` |

---

## 5. A-level findings — Blockers

**Result: none.**

Every candidate blocker was checked against live code and either had no concrete failure mode or contradicted the "do not rediscover resolved debt" guard with no remaining violation. Where a risk is real but not blocking, it appears as a B-level item with an explicit-confidence label and the smallest proportionate handling inside #114 (see §6 and §8).

Candidates inspected and cleared (evidence, not assertion):

| Candidate | Check | Outcome |
|---|---|---|
| Duplicate mission authority / contradictory state | Searched for any second mission-state table, per-mission status column, or client-side `missionState` reconstruction. Single source is `characterMissions` + `game/domain/missions.ts` projection; UI receives `MiningGameplayState.missions` from `stateFromTransaction`. | **Clear.** — `db/rune-space.ts`, `server/mission-state.ts`, `server/mining.ts:stateFromTransaction` |
| Server-authority bypass (client supplies quantities/items) | Inspected all mission request schemas — `characterId` only — and both completion commands re-read `inventoryStacks`/`equippedItems` inside the transaction. | **Clear.** — `game/schemas/gameplay.ts`, `server/missions.ts:complete*` |
| Non-atomic mission completion + inventory/XP | Walk It Off: Cutter `insert itemInstances` + `characterMissions.completedAt` in same `withResolvedOwnedCharacter`; Cut Your Teeth: `characterMissions.completedAt` + `grantCharacterSkillXp` in same transaction, with `isNull(completedAt)` guard. Integration asserts retry-after-capacity and concurrent completions keep exactly one reward. | **Clear.** — `server/missions.ts:completeWalkItOff/completeCutYourTeeth`, `tests/integration/*` |
| Carousel/concurrency double-reward or double-consume | Character-row lock (`characters for update`) plus `characterMissions for update` serializes concurrent first-completions; `isNull(completedAt)` update guard makes the second observe `already_completed`. Capacity-failure tests prove refusal without partial writes. | **Clear.** — `server/action-resolution.ts:lockOwnedCharacter`, `server/missions.ts` |
| Inventory bypass (mission hand-ins outside #112 adapter) | Walk It Off uses `itemInstances` (unique item) — intentionally outside stack adapter; Cut Your Teeth performs **zero** `inventoryStacks` writes ("show"). No `delete from inventoryStacks` outside `server/carried-inventory.ts` in `server/missions.ts`. | **Clear.** Follow the #112 adapter when #114 adds consumed-item missions (see B1). |
| Scattered mass formatting violation post-#116 | Grepped `features/`, `game/`, `server/` for any mass string interpolation; only `game/domain/mass.ts` → `formatMassGrams` callers remain (`InventoryDetailsStats`, `EquipmentPanel`, `CargoReadout`). Remaining `toFixed`/`toLocaleString` uses are unrelated display (timers, XP totals, percentages) — not mass. | **Clear.** — `grep: formatMassGrams`, `game/domain/mass.ts` |
| Per-item details branching post-#119/#120 | `InventoryDetailsStats.tsx` renders generically from `ResolvedInventorySelection` (quantity/stackLimit/mass); no `if itemId === ferriteShale` branches remain. Coverage exists (`inventory-generic-details.test.ts`). | **Clear.** |
| Objective-prose parsing in routing | Full grep confirms dialogue/NPC/mission-panel code routes on `MissionProjection.state` and `stage.*`, never regexes `currentObjective`. Comment-level guard `never regex-parses player-facing objective copy` present in `NpcInteractionPanel`. | **Clear.** — `game/domain/missions.ts`, `features/npc/NpcInteractionPanel.tsx` |
| Equipment SSOT violation (container vs gear) | `game/domain/equipment.ts:deriveEquipmentLoadout` validates `assignmentKind + suitSlotId` and throws `EquipmentRuleError` on mismatch; `Cut Your Teeth` checks `gear:mining_tool` inside transaction — carrying ≠ equipped. | **Clear.** — `game/domain/equipment.ts`, `server/missions.ts:equip check` |

Because no finding meets the "demonstrated correctness / server-authority / data-integrity / security problem requiring a fix **before** #114" bar, no separate blocker issue is proposed.

---

## 6. B-level findings — Meaningful debt (real, not blocking)

Two findings. Each lists exact files, current behavior, the concrete failure mode or future cost that motivated the severity, relevance to #114, confidence, and the smallest proportionate handling.

### B1 — Consumed-item turn-in has no exercised generic transaction (show vs consume must be implemented inside #114)

- **Files:** `server/missions.ts:completeCutYourTeeth` (inspects but never deletes `inventoryStacks`), `server/carried-inventory.ts:consumeStackableItem / applyStackRemovalPlan`, `game/domain/inventory.ts:planExactStackRemoval`, `game/content/missions.ts:MissionReward` (narrow) and current `MissionObjectiveStep` shape, `game/schemas/gameplay.ts:Accept*/Complete*RequestSchema` (characterId only).
- **What the architecture actually does:** Current authored missions exercise only two effect shapes: grant-one-unique-item (Walk It Off) and grant-Skill-XP-with-zero-consumption (Cut Your Teeth "show shale"). The carried-stack adapter (`consumeStackableItem` — lock `inventoryStacks` ordered `quantity asc, createdAt asc, id asc`, plan all-or-nothing via `planExactStackRemoval`, apply `deletedStackIds/updatedStacks`) is proven by non-mission callers (refining, cargo-hold) but has no mission completion path that consumes in the same transaction as `characterMissions.completedAt` + `grantCharacterSkillXp`.
- **Concrete risk / future cost if left informal:** A future consumed-item mission that naively deletes `inventoryStacks` without ordering/pinning, without scoping to `characterId`, without planning before mutating, or without keeping the deletion inside the same exactly-once mission transaction could: double-consume under retry, consume the wrong stack kind (non-deterministic order), or partially commit consumption while the `completedAt` guard or XP write rolls back — permanently losing player inventory for no completion.
- **#114 status — already explicitly required:** Show vs consume with `require N / consume 0` and `require N / consume N`, atomic consumed-item turn-in through #112 with authoritative revalidation and rollback, and no bespoke mission transaction for ordinary semantics are all explicit requirements of #114 (see #114 §Show vs consume item requirements and acceptance criteria). The gap below is therefore already covered by #114 and is documented here as an implementation focus area, not as a new amendment.
- **Confidence:** **Proven architectural gap** (current missions do not exercise a consumed path; adjacent systems do). Not speculative — the next ordinary mission would re-derive the same adapter call by hand.
- **Implementation focus for #114:** Implement the explicitly required declarative consumption signal, re-read and lock `inventoryStacks for update`, use `server/carried-inventory.ts:consumeStackableItem` / `applyStackRemovalPlan` inside the same `withResolvedOwnedCharacter` transaction that stamps completion and rewards, and refuse the whole completion when `missingQuantity > 0` without committing any effect. Keep the request schema `characterId`-only. Representation note — A1's `consume?: number` directly on `carry_stack` is one possible minimal representation; #114 explicitly leaves exact types/names implementation-owned and says not to conflate requirement satisfaction with item consumption. The audit does not lock that exact structure — a separate narrow turn-in/effect representation is equally valid if inspection shows it better preserves separation. Leave the final representation for #114 Checkpoint 0.

### B2 — Two parallel dialogue/mission-panel routers should become one semantic contract before a third mission is added

- **Files:** `game/content/dialogue.ts:getWalkItOffDialogue / getCutYourTeethActiveDialogue / CUT_YOUR_TEETH_DIALOGUE` (authored sequences) and `features/npc/NpcInteractionPanel.tsx:resolveDialogueForNpc` (semantic routing with explicit `MissionState` + `stage` inputs) alongside `features/missions/MissionObjectivePanel.tsx` (reverse-scan over `state.missions` with `active || available || completedFallback`).
- **What the architecture actually does:** Both missions' NPC conversations route correctly **without** parsing prose — `NpcInteractionPanel` maps `stage.requirementsSatisfied/turnInAvailable/nextObjectiveKind` to `CUT_YOUR_TEETH_DIALOGUE.equipReminder/stackReminder/busy/turnIn`, and `MissionObjectivePanel` picks `active → available → completedFallback` from the same `MissionProjection` array. The contract is sound, but the routing table is split: Walk It Off keeps its own `getWalkItOffDialogue(wade/tansy, state)` helper, Cut Your Teeth introduces a second `getCutYourTeethActiveDialogue(objective: "equip"|"stack"|"ready"|"busy")`, and the panel duplicates mission ordering. A third ordinary mission would add a third helper unless #114 introduces one generic mapping.
- **Concrete risk / future cost:** Extending the current two-helper shape without a closed mapping reintroduces the bespoke-per-mission orchestration #114 exists to remove: each mission would invent its own panel-comparer and its own NPC router, string IDs (`walk_it_off`, `cut_your_teeth`) would leak into React, and the "mapping meaningful requirement states to authored dialogue sequences without building a generic boolean-expression language" requirement would be proven by two diverging examples rather than one shared table.
- **#114 status — already explicitly required:** A reusable authoritative mission framework that removes shared orchestration and makes a third ordinary mission primarily declarative, semantic dialogue routing without prose parsing or mission-ID chains, and a generic `is this entity/control currently a quest-guidance target?` contract are all explicit requirements of #114. B2 is therefore already covered and is documented here as an implementation focus area, not as a new amendment.
- **Confidence:** **Credible risk** — not a correctness bug today, but directly contradicted if #114 extended the two-helper shape instead of unifying it.
- **Implementation focus for #114:** Replace the two helpers with a single data-driven mapping keyed by semantic state (existing `stage` shapes such as `requirementsSatisfied / turnInAvailable / nextObjectiveKind` — one possible minimal shape is a table like `MissionDefinition.dialogue: { offer?, equipReminder?, stackReminder?, busy?, turnIn?, completion? }` handled in §8), and let `MissionObjectivePanel` + `NpcInteractionPanel` consume `stage` generically. §8's prior A4 illustration preserves the closed `equip_item | carry_stack` vocabulary and the generic UI-consumer rule already required by #114; exact shape remains implementation-owned per #114 and is deferred to Checkpoint 0.

---

## 7. C-level observations — Cleanup / nit

Grouped compactly. Each would be inappropriate to bundle into a blocker or to fix inside this inspection-only issue.

| Ref | Area | Observation | Why C and not B |
|---|---|---|---|
| **C1** | Display formatting outside mass | `toFixed(1/2)` for timers/percentages (`MiningConsole`, `RefiningConsole`, `LocalMapPanel`) and `toLocaleString()` for XP totals are intentionally **not** mass — `game/domain/mass.ts` correctly owns mass alone, and these unrelated presentations are deterministic and locale-tolerant per the actual contract. | No SSOT violation; presentation preference only. |
| **C2** | Item-detail projection helper shape | `features/mining/inventory-selection.ts` and `features/mining/InventoryDetailsStats.tsx` are the newly-generic detail path post-#120; method-card presentation for the Cutter (equipment) still renders in `EquipmentPanel`. The split is correct: inventory detail is fungible-metadata, equipment detail is assignment-metadata. | Working separation — no duplication to remove. |
| **C3** | `loadMissionProjections` `for update` on read | `server/mission-state.ts:loadMissionProjections` locks `inventoryStacks` + `equippedItems for update` even though `stateFromTransaction` is read-only projection. This is safe inside the surrounding `withResolvedOwnedCharacter` transaction (the character row already serializes), but makes the read path slightly heavier than a plain `select`. | Harmless in current load; #114 may promote the read to `select … for share` or plain `select` when not mutating — no behavior change. |
| **C4** | `MISSIONS` map duplication | `game/content/missions.ts:missions = new Map([[WALK_IT_OFF.id, …],[CUT_YOUR_TEETH.id, …]])` duplicates the already-ordered `MISSIONS` array entries. `getMission()` could derive from the array. | Tiny duplication; no correctness impact. |
| **C5** | Mining/Refining resolver random seeding | `server/mining.ts:defaultMiningRandom / defaultRefiningRandom` gate on `CI + RUNESPACE_E2E_MINING + localhost DB` is load-bearing E2E determinism but reads `DATABASE_URL` synchronously inside the helper. Test host already sets the env; just worth noting as a parochial coupling. | Internal E2E helper preference. |
| **C6** | Dialogue `actionLabel` fallback | `features/dialogue/DialoguePlayer.tsx:actionLabel = sequence.actionLabel ?? ("Accept mission" | "Claim Cutter")` preserves legacy hardcoded fallback while authored `SHOW SHALE` flows through `actionLabel`. #114 should ensure third mission labels are explicit in content — no code change needed today. | Already correct; naming polish only. |
| **C7** | `characterMissions` `for update` scoping | `acceptWalkItOff` scopes its `for update` with `eq(missionId, walkItOff)` (narrow lock), while Cut Your Teeth locks all missions for character (`eq(characterId)` only). Both are correct under the character PK lock — just a stylistic inconsistency to normalize when the generic transaction lands. | No race: `lockOwnedCharacter` serializes regardless. |

No open file handles, no stray network calls, and no repository-wide rename sweep is recommended in this slice.

---

## 8. #114-specific implications — already required by #114 (no new amendments)

On re-read of current #114 against the audit evidence, the five items previously labeled "amendments A1-A5" are **already explicitly required by #114**. This section therefore does not propose amendments. It maps the audit's focus areas to the existing #114 requirements and clarifies the one representation choice that must remain implementation-owned.

**Correction from the previous draft:** calling an item an "amendment" merely because the audit confirms #114 should implement something #114 already requires was inaccurate. No amendment is proposed. The correct disposition is to document B1 and B2 as important implementation risks and focus areas already covered by #114 and to leave exact type shapes for #114 Checkpoint 0.

The following requirements are already explicitly present in #114 and need no addition:

- show-vs-consume semantics with `require N / consume 0` and `require N / consume N`;
- atomic consumed-item turn-in through #112 with authoritative revalidation and rollback;
- ordinary missions not requiring bespoke `acceptSpecificMission` / `completeSpecificMission` / projection / dialogue orchestration;
- semantic dialogue routing without prose parsing or mission-ID chains;
- optional authored recommended acquisition interactions separate from requirement truth;
- validation against authoritative source/output SSOT where practical;
- no Scavenge auto-highlight merely because it can yield Ferrite Shale;
- a reusable neon-green quest-guidance visual treatment;
- a common projected quest-guidance contract consumed generically by UI surfaces.

The audit's contribution is to flag **where implementation risk concentrates** inside those already-required items (B1, B2) and to illustrate — without locking — one minimal shape consistent with current repository conventions. #114 explicitly states that exact types/names are implementation-owned after inspection and that requirement satisfaction must not be conflated with item consumption; the final representation is therefore deferred to #114 Checkpoint 0.

### Focus area 1 — Declarative requirement/effect vocabulary (illustrative, not prescriptive)

Current proven definition (authoritative, taken from `game/content/missions.ts`):

```ts
MissionDefinition {
  id, title, summary
  offeringNpcId, completionNpcId, relevantLocationId
  reward: { kind: "item"; itemId } | { kind: "skill_xp"; skillId; amount }
  prerequisiteMissionId?
  travelObjective?, completionObjective?, availableObjective?
  objectiveSteps?: readonly (equip_item<ItemId> | carry_stack<ItemId, quantity?>)[]
}
```

Requirement satisfaction (does the character currently meet the objective?) and item consumption (does the turn-in hand items in?) must remain separable — #114 says not to conflate them. One possible minimal representation that preserves that separation is a `consume` signal alongside `carry_stack`:

```ts
// One possible shape — not locked by this audit:
carry_stack {
  itemId: ItemId
  quantity?: number        // undefined → canonical stackLimit from getItemDefinition
  consume?: number         // illustration only: 0 = show (default), N = consume N at turn-in
  template: string
}
```

An equally valid alternative that repository evidence does not rule out is a separate narrow turn-in/effect representation (for example, a `turnIn: { consume?: { itemId, quantity }[] }` or similar small effect table) that keeps consumption out of the satisfaction predicate entirely. The audit does not have evidence that one is superior to the other in this codebase. #114 Checkpoint 0 should choose after inspecting current domain/transaction boundaries and naming the trade-off. Either way, `consume` defaults to show-only for Cut Your Teeth (preserves "you keep the shale" presentation) and a third mission's consumed path becomes the first exercised consumed turn-in through B1. Keep `reward` and `prerequisiteMissionId` as the narrow closed vocabulary — no generic effect script.

### Focus area 2 — Preserve SSOT for stack quantity; keep recommendations separate and validated

Already required by #114 and proven by current code: `quantity` omitted means "canonical full stack via `getItemDefinition().stackLimit`" (`game/domain/missions.ts:requiredQuantity`). That stays the single source for *what* the player needs. The recommended/intended acquisition path is the separate, already-required authored signal:

```ts
// One possible shape — exact name remains implementation-owned:
MissionDefinition {
  objectiveSteps: [...]
  guidance?: { recommendedActionId?: ActionId }  // e.g. ferrite_shale_mining, refining
}
```

Where practical, validate the recommendation against the authoritative drop/output SSOT at startup (Mining outputs `ferriteShale`; Refining consumes `ferriteShale` → outputs `refinedFerrite`/`slag`) — already required by #114 — and do not duplicate drop tables inside mission content. Do not auto-highlight every technically valid source; Scavenge must not glow merely because it can yield shale (explicit #114 requirement).

### Focus area 3 — One generic completion path that exercises show-vs-consume atomically (B1 — already required)

Already required by #114: ordinary missions must not require a bespoke mission transaction; consumed stackables must use #112's authoritative inventory boundary and commit atomically with mission completion/rewards; concurrent first-completions must not duplicate completion, rewards, or consumed items. Current code keeps two bespoke completions (`server/missions.ts:completeWalkItOff`, `completeCutYourTeeth`) with their own prerequisite/location/equipment/capacity checks. #114's already-required generic path — illustrated here without prescribing names — should, inside the existing `withResolvedOwnedCharacter` character lock:

1. Re-read and re-lock `characterMissions`, `characters.currentLocationId`, `equippedItems`, `inventoryStacks for update`.
2. Re-check **prerequisite** (if any) + **stationary** (`context.action === undefined` + `currentLocationId === relevantLocationId`) + every `objectiveSteps` satisfaction against the live `MissionObservation`.
3. For requirements whose authored effect is to consume, call `server/carried-inventory.ts:consumeStackableItem` (or `planExactStackRemoval` + `applyStackRemovalPlan` if batching) — all inside the same transaction. On `ok:false` (`missingQuantity > 0`), refuse `insufficient_items` without committing any mutation.
4. Stamp `characterMissions.completedAt where isNull(completedAt)` and apply every `MissionReward` through its proven single boundary (`grantCharacterSkillXp` for `skill_xp`; Cutter-style unique-item insertion through `planUniqueItemAddition` + `itemInstances insert` for `item`) — both succeed together or both roll back.
5. Serialize concurrent first-completions exactly as today: character-row lock + `isNull(completedAt)` guard → second request observes `already_completed` with exactly-once reward/consumption.

No new idempotency table and no bypass of the #112 adapter. Synthetic/test missions may exercise consumed-item semantics in integration tests; #114 already says not to add a fake player-visible production quest solely for coverage.

### Focus area 4 — Unify dialogue routing and guidance projection behind the same semantic `stage` (B2 — already required)

Already required by #114: dialogue branching maps semantic mission state to authored sequences without widespread mission-ID/prose checks, and the framework projects reusable quest-guidance targets consumed through a common contract. Replace `getWalkItOffDialogue` + `getCutYourTeethActiveDialogue` with one mapping that keeps authored sequences as content and uses `stage` as the router. One possible minimal illustration (exact shape implementation-owned, deferred to Checkpoint 0):

```ts
// Illustrative only — not locked:
MissionDefinition {
  dialogue: {
    offer?: DialogueId                // prerequisite-satisfied + not_accepted at relevant NPC
    equipReminder?: DialogueId        // stage.nextObjectiveKind === "equip_item"
    stackReminder?: DialogueId        // stage.nextObjectiveKind === "carry_stack"
    busy?: DialogueId                 // stage.requirementsSatisfied && !stage.turnInAvailable
    turnIn?: DialogueId               // stage.turnInAvailable
    completion?: DialogueId           // state === "completed" or turn-in success override
  }
  guidance?: { recommendedActionId?: ActionId }
}
```

Projection adds one stable semantic surface #114 already requires UI to consume instead of mission-ID checks:

```ts
// Illustrative only — not locked:
MissionProjection {
  // existing: missionId, title, summary, state, currentObjective, offeringNpcId, completionNpcId,
  //           prerequisiteSatisfied, offeringNpcName, availableObjective, stage
  guidanceTargets?: {
    npcId?: NpcId
    equipmentItemId?: ItemId
    actionId?: ActionId
  }
}
```

`NpcInteractionPanel.resolveDialogueForNpc` then becomes `stage → dialogueId` generically, `MissionObjectivePanel` keeps its `active → available → completedFallback` precedence but derived from sorted `MISSIONS`, and each consumer (NPC Talk button, Equipment affordance, Mining/Refining Start controls) reads `isQuestGuidanceTarget(entityId)` as a common question — the contract #114 §UI consumer rule already requires. No arbitrary boolean-expression DSL; the closed `equip_item | carry_stack` next-kind already spans the proven branches. Final names/shapes remain for #114 Checkpoint 0.

### Focus area 5 — Reusable neon-green quest-guidance treatment (already required)

Already required by #114: a distinct high-contrast neon-green treatment (outline/border, text where appropriate, restrained glow) that remains legible over dark/industrial backgrounds, with a shared token/component convention rather than ad-hoc green classes per component. One possible minimal placement is a custom property under `app/globals.css` (existing `--rs-*` convention from `docs/design-system.md`) and a shared `QuestGuidance` primitive consumed by `InventoryPanel`, `EquipmentPanel`, `NpcInteractionPanel`, `MiningConsole`/`RefiningConsole` from projected `guidanceTargets`. Respect `prefers-reduced-motion`; do not animate the glow. Exact token value remains implementation-owned.

---

## 9. Test coverage assessment

### What current tests prove well (keep and extend, do not replace)

| Boundary | Primary proof | What it guarantees for #114 |
|---|---|---|
| **Derivation invariants (no DB)** | `tests/unit/missions.test.ts`, `tests/unit/cut-your-teeth.test.ts` — travel vs completion copy, equip-first precedence, `0/10` vs `N/10`, `requirementsSatisfied vs turnInAvailable`, `nextObjectiveKind`, prerequisite availability, no-progress-history shape. | Objective/step/guidance semantics without needing a browser. |
| **Mass canonical shape** | `tests/unit/mass.test.ts` — integer-gram `g`/`kg` rendering with trailing-zero stripping and `RangeError` on malformed. | #114 has no mass work of its own. |
| **Inventory detail genericity** | `tests/unit/inventory-generic-details.test.ts`, `features/mining/InventoryDetailsStats` assertions — no item-ID branching, canonical stack-limit/mass rendering. | Third mission item details will render without a new branch. |
| **Walk It Off exactly-once + capacity** | `tests/integration/walk-it-off.test.ts` — explorer-first accept at either location, arrival-alone-is-not-completion, slot/mass refusal without partial writes, concurrent completion → exactly one Cutter unequipped, account isolation. | The unique-item reward + capacity-preflight pattern #114's item-reward effect must reuse. |
| **Cut Your Teeth persistence** | `tests/integration/cut-your-teeth.test.ts:536` — prerequisite refusal, Tansy-only stationary gate, equip-then-stack precedence, stale-Cutter-stack coupling, 0/10 and N/10 mapping through live `buildObservation`, busy-but-satisfied distinction, exactly-once +100 XP without shale consumption, concurrent first-completion serialization, prerequisites via `getMiningGameplayState` projection. | The equip/carried-quantity requirement pattern and the "requirements satisfied ≠ turn-in available" invariant #114 generalizes. |
| **Browser journey** | `tests/e2e/cut-your-teeth.spec.ts`, `tests/e2e/walk-it-off.spec.ts` — Inventory → Equip flow, Show Shale `SHOW SHALE` control, shale item beat + Mining XP tile + post-completion lines, drawer/markup accessibility, stale-selection refuses deterministically (`inventory-equip.spec.ts`, `mining.spec.ts`). | Explorer-visible regression coverage for the same acceptance/turn-in loop #114 migrates. |
| **Action cursor / timing** | `tests/unit` + `tests/integration/gameplay-foundations.test.ts`, `tests/integration/travel.test.ts` — `calculateResolutionWindow`, `cursorAfterConsumedTicks`, travel + mining cursor advancement. | Stationary check remains trustworthy inside the mission transaction. |

### Meaningful gaps #114 should close (checklist — do not re-prove above layers at higher layers)

These are framed as new tests #114 must add when its generic transaction ships, not as defects in today's coverage:

- [ ] **Consume-item mission transaction** — synthetic/test mission with `carry_stack(ferriteShale, 10, consume:10)` completes once atomically: insufficient shale refuses with no inventory or reward delta; exactly-enough consumes the exact `10` via `planExactStackRemoval` ordering and stamps `completedAt + XP/item reward` together; stale quantity between observation and completion refuses; partial failure rolls back all three (inventory delta, completion stamp, reward) together.
- [ ] **Concurrent consumed turn-in** — two concurrent first-completion requests with `consume > 0` produce `{completed, already_completed}` and exactly one inventory deletion + exactly one XP/item reward (same guard as today's non-consumed concurrency tests).
- [ ] **Show-only ≠ consume** — `consume:0` proves zero `inventoryStacks` writes (today's `cut-your-teeth` assertion generalized via the generic transaction), while `consume:N` proves `N` removed.
- [ ] **First-unmet-requirement ordering** — synthetic mission with `equip_item(Cutter)` then `carry_stack(Shale)` asserts `nextObjectiveKind` flips from `equip_item` to `carry_stack` in authored order (extends existing `cut-your-teeth.test.ts §emits semantic stage data` pattern to arbitrary ordering).
- [ ] **Prerequisite propagation** — generic prerequisite `A → B` asserts `state: not_accepted, prerequisiteSatisfied: false` → after completing `A` projects `prerequisiteSatisfied: true + availableObjective`, and server acceptance of `B` still refuses before `A.completedAt` inside transaction.
- [ ] **Stationary re-validation under generic path** — generic `completeMission` refuses `not_stationary` even when stacks/equipment hold, and becomes eligible immediately after `activeActions` clears (extends today's Cut Your Teeth busy test to arbitrary mission).
- [ ] **No prose parsing** — unit assertion that generic dialogue routing returns the same sequence when `currentObjective` text is replaced but `stage` is held constant (extends today's grep-verified prose-avoidance into a typed invariant).
- [ ] **Guidance semantic projection** — unit asserts: required NPC Talk target projected while `stage.turnInAvailable` (or unmet equip/stack that identifies an NPC), recommended equipment affordance targeted while `nextObjectiveKind === equip_item && !requirementsSatisfied`, recommended Mining/Refining `Start` targeted only when `carry_stack` unsatisfied and `guidance.recommendedActionId`'s authoritative output actually yields the required item — **and** that a valid-but-not-recommended source (e.g. Scavenge for shale) is **not** targeted.
- [ ] **UI consumer contract** — representative component test proving `NpcInteractionPanel`, `EquipmentPanel`, and `MiningConsole` read `isQuestGuidanceTarget()` and apply the shared guidance treatment without any `if (missionId === "cut_your_teeth")` conditional (accessible assertion + one structural hash against mission-ID strings in features).

### Non-gaps — deliberately out of scope for #114

- Stack-split selection inside mission turn-ins (general Inventory `selectedStack` handling is already covered by `inventory-selection.test.ts`, `carried-stack-adapter.test.ts`, and the overlay E2E `inventory-equip.spec.ts`). Missions do not carry per-stack consumption selection in the current design; the consumed requirement is an exact quantity satisfied from any stacks in canonical order, so selected-stack scoping does not belong in the mission completion API.
- Quest Log, navigation redesign, or admin reset tooling — all explicitly deferred beyond #114 (`#114 §Simplicity constraints`).

---

## 10. Final recommendation — exactly one

### (1) Proceed with #114 unchanged

No separate A-level blocker issue is required, and **no new amendment to #114 is proposed**. B1 (show-vs-consume atomically through #112) and B2 (single semantic dialogue/guidance contract) are documented as important implementation risks and focus areas already explicitly required by #114; §8 maps them to those existing requirements and clarifies that exact representation choices (including whether consumption lives on `carry_stack` or in a separate narrow turn-in/effect table) remain implementation-owned for #114 Checkpoint 0. Use Walk It Off and Cut Your Teeth as the migration proof cases for the resulting generic completion + guidance projection.

**What §8 is now:** not an amendment list, but an illustration — without locking — of one minimal shape consistent with current repository conventions for each already-required requirement, including the trade-off note that requirement satisfaction vs consumption separation must be preserved. The closed set `location, npc, equip_item, carry_stack(require/consume), item-reward, skill_xp-reward, guidance(npc/equipment/action)` already spans the proven production behavior and the explicitly foreseen third-mission hand-in, and no generic scripting language, event-bus, per-step ledger, or random-reward machinery is proposed.

---

## Appendix — Files referenced (complete)

`AGENTS.md`; `docs/architecture.md`, `docs/component-boundaries.md`, `docs/game-rules.md`, `docs/gameplay-foundations.md`, `docs/design-system.md`, `docs/testing-strategy.md`, `docs/development-workflow.md`; `game/config/balance.ts`, `game/config/foundations.ts`; `game/content/missions.ts`, `game/content/dialogue.ts`, `game/content/npcs.ts`, `game/content/locations.ts`, `game/content/item-presentation.ts`, `game/content/skill-presentation.ts`, `game/content/conversation-backgrounds.ts`; `game/domain/missions.ts`, `game/domain/inventory.ts`, `game/domain/equipment.ts`, `game/domain/progression.ts`, `game/domain/mass.ts`, `game/domain/timing.ts`, `game/domain/travel.ts`, `game/domain/mining.ts`, `game/domain/refining.ts`, `game/domain/scavenge.ts`; `game/schemas/gameplay.ts`, `game/schemas/ids.ts`; `db/rune-space.ts`, `db/auth-schema.ts`; `server/action-resolution.ts`, `server/mission-state.ts`, `server/missions.ts`, `server/mining.ts` (`stateFromTransaction`, `loadMiningSnapshot`, `createPlayResolver`), `server/progression.ts`, `server/carried-inventory.ts`, `server/equipment.ts`, `server/actions.ts`, `server/travel.ts`; `features/npc/NpcInteractionPanel.tsx`, `features/missions/MissionObjectivePanel.tsx`, `features/dialogue/DialoguePlayer.tsx`, `features/dialogue/DialogueScene.tsx`, `features/mining/InventoryPanel.tsx`, `features/mining/InventoryDetailsStats.tsx`, `features/mining/inventory-selection.ts`, `features/mining/EquipmentPanel.tsx`, `features/mining/MiningConsole.tsx`, `features/shared/CargoReadout.tsx`; tests listed in §9; `.qcfailed/status.json` (reread; no change required by this inspection-only issue).

---

*Deliberately not rediscussed as debt:* #112 carried-stack adapter completeness, #116 canonical mass formatting, #119/#120 generic inventory detail — all verified as resolved on fresh `main` with no remaining violation (see §5 table). No production code, test, schema, balance, dependency, CI, or doc outside this report was modified.

