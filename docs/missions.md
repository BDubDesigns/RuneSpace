# Mission framework

Authoritative authoring contract for the declarative single-phase mission system introduced by #124 / #125.

The document describes the mission framework's own contracts. It is intentionally narrow: it does not document the temporary shared-play orchestration that currently hosts projection (the Mining-named play-state loader / context) as permanent architecture — see §2. That surrounding host is expected to move under #127 and this document must remain valid across it.

Base your work on the current PR #125 implementation (`game/content/missions.ts`, `game/domain/missions.ts`, `game/domain/action-outputs.ts`, `game/content/dialogue.ts`, `server/missions.ts`, `server/mission-state.ts`, `game/schemas/gameplay.ts`, `server/actions.ts`, `app/globals.css`). The original #114 proposal is superseded where implementation refined details (most notably, availability guidance).

## 1. Purpose and boundary

RuneSpace currently supports **ordinary single-phase, server-authoritative missions expressed primarily through authored mission definitions**.

- A mission is a small declarative definition (offers, ordered requirements, turn-in, one reward, dialogue mapping) plus authored dialogue sequences.
- Generic projection derives live state (`not_accepted` / `active` / `ready_for_completion` / `completed`), objective copy, and semantic guidance from authoritative character state on every command.
- Generic server commands handle acceptance and completion for all missions.

The framework deliberately does not attempt to support every future quest shape. If a real new mission needs a novel requirement kind, reward shape, or persistent phase history, extend the framework deliberately (§13–§14) rather than adding a mission-specific transaction or UI branch.

## 2. Authoritative homes

| Concern | Current home(s) | Notes |
| --- | --- | --- |
| Mission definitions / content | `game/content/missions.ts` — `MissionDefinition`, `MissionOffer`, `MissionRequirement`, `MissionTurnIn`, `MissionDialogue`, `MissionReward`, `MISSIONS` registry, `WALK_IT_OFF` / `CUT_YOUR_TEETH` | `getMission(id)` is the content accessor. |
| Generic mission projection | `game/domain/missions.ts` — `projectMission`, `deriveMissionState`, `deriveQuestGuidanceTargets`, `validateMissionDefinitions`; `server/mission-state.ts` — `loadMissionProjections` | Projection recomputes from live authoritative state; no quest progress is persisted beyond `acceptedAt` / `completedAt`. |
| Generic acceptance / completion boundary | `server/missions.ts` — `acceptMission`, `completeMission` (+ `completeMissionWithDefinition` test seam); `server/actions.ts` — `acceptMissionAction` / `completeMissionAction`; `game/schemas/gameplay.ts` — `AcceptMissionRequestSchema` / `CompleteMissionRequestSchema` | Shared `runMissionCommand` character lock / reconciliation wrapper. See §12. |
| Authored dialogue | `game/content/dialogue.ts` — `DIALOGUE_SEQUENCES` / `getDialogue`; `game/domain/missions.ts` stage types consumed by `resolveNpcMissionDialogue`, `getMissionCapacityRefusalDialogue`, `getMissionCompletionPresentation` | Sequences are content; routing is semantic state (§9). |
| Semantic guidance projection | `game/domain/missions.ts` — `MissionGuidance`, `QuestGuidanceTargets`, `deriveQuestGuidanceTargets`; `app/globals.css` — `--rs-quest-guidance-*` / `--rs-quest-available-*` and `.rs-quest-guidance` / `.rs-quest-available` | Guidance is a derived set consumed by `NpcInteractionPanel`, `MiningConsole`, `RefiningConsole`, `EquipmentPanel`, `InventoryPanel`. |

The play-state loader that currently projects `state.missions` (today part of the Mining-named orchestration and `MiningPlayContext` / `useMiningPlay`) is intentionally **not** documented here as long-term architecture. Treat it as the current host for projection, not the framework's contract. Do not depend on its module name to reason about missions.

## 3. MissionDefinition

Current terminology (`game/content/missions.ts`):

```ts
type MissionDefinition = {
  id: MissionId;                         // stable content ID
  title: string;
  summary: string;
  prerequisiteMissionId?: MissionId;     // absent for the first mission
  offers: readonly MissionOffer[];       // ≥1 authored offer interactions
  requirements: readonly MissionRequirement[]; // ordered live-state checks
  turnIn: MissionTurnIn;                 // authoritative completion interaction
  reward: MissionReward;                 // exactly one, see §8
  availableObjective?: string;           // presentation copy only, see §10–§11
  dialogue: MissionDialogue;             // semantic dialogue mapping
};
```

- **Stable ID** — `MISSION_IDS` in `game/config/foundations.ts`. Referenced by persistence (`characterMissions`), projection, and dialogue routing. Never rename without a migration.
- **`title` / `summary`** — player-facing names on the mission.
- **`prerequisiteMissionId`** — when present, the referenced mission must be `completed` before this one is offered or accepted. Validated at module load (unknown ID or self-cycle fails fast).
- **`offers[]`** — one or more authored offer routes (§4).
- **`requirements[]`** — ordered requirements (§5) evaluated against live authoritative state on every projection.
- **`turnIn`** — `npcId` + `locationId` + `requiresStationary: true` + objective copy + `dialogueId` (§7). Mission location semantics are authored here and **never** derived from an NPC's `homeLocationId`.
- **`reward`** — exactly one narrow reward (§8).
- **`dialogue`** — optional semantic mappings (§9).
- **`availableObjective`** — optional pre-acceptance copy (§10). Not a capability signal.

Registry validation (`validateMissionDefinitions`) runs at module load against content + authoritative balance (NPC/location/item/dialogue existence, prerequisite shape, stackable checks, stack limits, reward skill curve, and `recommendedActionId` capability). An authoring mistake never reaches a player as a silent runtime refusal.

## 4. Mission offers

A mission may have **multiple authored offer routes**. Offer NPC / location / dialogue are authored data; UI must never infer these rules from NPC names or prose.

**Useful example — Walk It Off** (`WALK_IT_OFF.offers`):

- **Route A:** `Wade` at `Crash Site` — `dialogueId: wadeOffer`, `activeDialogueId` while the mission is active; ordinary completed story via `completedNpcDialogue` (Wade) after completion.
- **Route B:** `Tansy` at `The Jag` — `dialogueId: tansyBeforeMission`, `acceptedContinuationDialogueId: tansyAfterRemoteAcceptance`.

Both routes are real. The second exists so a player who walks straight to The Jag can meet Tansy first and immediately receive the same mission — the framework calls this *explorer-first remote acceptance*. Offer location/dialogue semantics are authored explicitly in `MissionOffer`:

```ts
type MissionOffer = {
  npcId: NpcId;
  locationId: LocationId;
  dialogueId: DialogueId;
  acceptedContinuationDialogueId?: DialogueId; // shown right after accept at this offer
  activeDialogueId?: DialogueId;               // active follow-up at this offer NPC
};

// Ordinary post-completion story dialogue authored per completed mission, including
// NPCs who were not that mission's offer/turn-in participant. Newest completed mission
// that authors dialogue for the NPC wins — how story state advances globally.
type MissionNpcDialogue = { npcId: NpcId; dialogueId: DialogueId };
```

A mission may also author `completedNpcDialogue: readonly MissionNpcDialogue[]` on `MissionDefinition` so a later mission can advance story dialogue for NPCs outside its offer/turn-in set (e.g. Cut Your Teeth advancing Wade after Tansy's turn-in).

Consumers never read `offers[0]` as "the" offer and never infer location from an NPC record.

## 5. Ordered requirement vocabulary

The currently supported live-state requirement kinds (`MissionRequirement`) are a **closed union**:

| Kind | Fields | What satisfies it |
| --- | --- | --- |
| `at_location` | `locationId`, `objective` | `currentLocationId === locationId` (current location alone) |
| `equipped_item` | `itemId`, `objective` | the item genuinely occupies its authoritative compatible slot (carried instance + `equippedItems` assignment; a stored instance does not count) |
| `carried_stack` | `itemId`, `quantity?`, `turnIn`, `objective`, `recommendedActionId?` | current carried quantity for `itemId` ≥ resolved required quantity (§6) |

**Ordering owns the objective.** The first unmet requirement in authored order becomes the current semantic objective / guidance step. `requirements` order is gameplay — changing it changes the player's progression and guidance.

For example, Cut Your Teeth authors:

1. `at_location: The Jag` → "Return to The Jag"
2. `equipped_item: salvageCutter` → "Equip the {item} from Inventory"
3. `carried_stack: ferriteShale` (full stack, show) → "Get a full stack of {item} — {carried} / {required}"

If the character is away from The Jag, (1) is the current objective even though (2) and (3) are also unmet.

**Live-state observation, not provenance.** Requirements observe current authoritative state (location, `equippedItems` + carried instances, `inventoryStacks`). The framework never creates "visited / mined since acceptance" ledgers. Scavenged shale and mined shale are indistinguishable — carried `ferriteShale` counts regardless of how it was obtained. See §14 for what this boundary currently excludes.

## 6. Carried-stack quantity and disposition

```ts
type CarriedStackTurnIn = "show" | "consume_required_quantity";

type CarriedStackRequirement = {
  kind: "carried_stack";
  itemId: ItemId;                 // must be a stackable item
  quantity?: number;              // see below
  turnIn: CarriedStackTurnIn;     // show vs consume
  objective: string;              // "{item}", "{carried}", "{required}" substituted
  recommendedActionId?: ActionId; // teaching hint, validated — see §10
};
```

- **Explicit `quantity`** — positive integer within the authoritative stack limit. Registry validation rejects non-integers, non-positives, and values exceeding `stackLimit`.
- **Omitted `quantity` means the authoritative full stack limit.** The projection resolves the number from the item definition's `stackLimit` (via `stackLimits` in `MissionObservation`), not from duplicated quest data. Cut Your Teeth omits the quantity for `ferriteShale`; the required amount resolves to `10` because that is `ferriteShale`'s current stack limit — so changing the balance changes the mission's full-stack meaning without editing quest content.
- **`show`** — the stack is a condition only. Turn-in inspects the quantity and consumes zero. Cut Your Teeth uses `show`.
- **`consume_required_quantity`** — turn-in hands in exactly the required quantity through the authoritative carried-stack mutation boundary.

**Satisfaction vs. consumption are separate.** Whether the character *carries* the quantity (projection) is distinct from whether the turn-in *takes* it (completion command). An ordinary `show` mission never writes `inventoryStacks`.

**Consumed-item turn-ins use authoritative carried-stack mutation semantics.** Consumption builds exact pure removal plans per requirement via `planExactStackRemoval` (deterministic order: quantity, then `createdAt`, then `id`) and applies them through the inventory planner boundary. There are no player-selected-stack semantics — the author declares the required quantity and the server resolves which stacks to decrement.

## 7. Turn-in semantics

`MissionTurnIn` is an independent authoritative constraint:

```ts
type MissionTurnIn = {
  npcId: NpcId;
  locationId: LocationId;        // the mission's completion location, authored here
  requiresStationary: true;      // must be stationary (no active action)
  objective: string;             // shown once every requirement holds
  dialogueId: DialogueId;        // drives the complete_mission action
};
```

Key rules:

- **All requirements may be satisfied while turn-in is still unavailable.** `deriveMissionState` and `MissionProjection.stage` distinguish `requirementsSatisfied` (every authored requirement holds) from `turnInAvailable` (requirements hold **and** the character is stationary **at** `turnIn.locationId`). `ready_for_completion` requires all three together. While busy, the objective already advances to the turn-in copy and guidance already targets the turn-in NPC, but the turn-in is merely not performable yet.
- **`turnIn.locationId` is an independent eligibility constraint.** It is checked separately from the requirement list — in `deriveMissionState` for projection and again in `completeMissionForDefinition` for server authority.
- **`requiresStationary` is independent.** `activeActionId !== undefined` refuses the turn-in regardless of requirements.
- **Authors must not duplicate the turn-in location as an `at_location` requirement merely to make eligibility correct.** `at_location` requirements exist for objective progression when the mission actually requires that location *state* (e.g. Walk It Off's "Travel to The Jag" progression, Cut Your Teeth's "Return to The Jag" step). The turn-in constraint itself does not need a duplicated requirement to stay correct.

## 8. Rewards

The framework currently supports **exactly one reward per mission, and only these two shapes** (`MissionReward`):

```ts
type MissionReward =
  | { kind: "item"; itemId: ItemId }                 // Walk It Off: Salvage Cutter
  | { kind: "skill_xp"; skillId: SkillId; amount: number }; // Cut Your Teeth: +100 Mining XP
```

- **Item** — granted as **one new unique item instance** through the generic completion boundary (capacity-preflighted, guarded by the `completedAt` exactly-once stamp). Registry validation rejects stackable item rewards at definition time because there is no authorized execution path for them yet. Reward initialization derives from `getItemMaximumCharge`: chargeable items arrive depleted (`currentCharge: 0`), others get the schema's `null` — no silent claim of arbitrary charge semantics.
- **Skill XP** — granted through the authoritative progression boundary (`grantCharacterSkillXp`). `amount` must be a positive integer and `skillId` must have a progression curve (`skillLevelThresholds`).

**Not currently supported:** stackable item rewards, bundles, multi-reward missions, credits, reputation, generic effects, or similar. A real mission that genuinely needs one of these earns an explicit, narrow framework extension — do not add a mission-specific transaction or widen the reward union speculatively.

## 9. Dialogue

Dialogue remains **authored content** while semantic mission state **selects** the appropriate sequence. Server and UI code must not parse dialogue or objective prose to determine gameplay rules.

### Authored dialogue homes

- **Sequences** — `game/content/dialogue.ts` (`DialogueSequence`, `DIALOGUE_SEQUENCES`, `getDialogue`). Beats are presentation only (`npc` / `item` / `skill_xp`); item and skill-XP beats never mutate state.
- **Semantic mapping** — `MissionOffer` (`dialogueId`, `acceptedContinuationDialogueId`, `activeDialogueId`) plus `MissionDefinition.completedNpcDialogue` (ordinary post-completion story dialogue per NPC) and `MissionDialogue` for turn-in-stage branches, capacity, and the one-shot completion presentation.

### Currently supported semantic dialogue routing

All routed through the single generic router `resolveNpcMissionDialogue(npcId, projections)` in `game/content/dialogue.ts`, which consumes `NpcDialogueProjection` (`missionId`, `state`, `prerequisiteSatisfied`, `stage`). Routing scans projections newest-first in three tiers: offers → active missions → completed missions, driven exclusively by semantic state, never by mission-ID chains in UI code. Completed-story routing prefers the newest/furthest authored mission state for each NPC; `completionPresentationDialogueId` is **not** persistent idle dialogue — it is immediate one-shot presentation after success (§9.1).

| Routing tier | Kind | Source | When it is selected |
| --- | --- | --- | --- |
| Offer | **Offer** | `MissionOffer.dialogueId` | `not_accepted` + prerequisite satisfied + this NPC authors an offer |
| Offer | **Authored acceptance continuation** | `MissionOffer.acceptedContinuationDialogueId` | returned alongside the offer resolution; UI presents it immediately after a successful `accept_mission` at that offer (Tansy remote acceptance → Cutter claim) |
| Active (turn-in NPC) | **Turn-in** | `MissionTurnIn.dialogueId` | `active` / `ready_for_completion` + every requirement holds (the stage turns the interaction into a completion attempt; busy is distinguished below) |
| Active (turn-in NPC) | **Requirements satisfied but busy** | `MissionDialogue.busyDialogueId` | requirements hold but `turnInAvailable` is false because the character is still busy |
| Active (turn-in NPC) | **Equipment reminder** | `MissionDialogue.equipmentReminderDialogueId` | first unmet requirement `kind === "equipped_item"` |
| Active (turn-in NPC) | **Carried-item reminder** | `MissionDialogue.carriedReminderDialogueId` | first unmet requirement `kind === "carried_stack"` |
| Active (other offer NPC) | **Active follow-up** | `MissionOffer.activeDialogueId` | the offer NPC while the mission is active — e.g. Wade while Walk It Off is active |
| Completion | **Capacity refusal — slots** | `MissionDialogue.capacitySlotsDialogueId` | item reward preflight failed on `slots` (selected generically from the mission's mapping after a `capacity` refusal) |
| Completion | **Capacity refusal — mass** | `MissionDialogue.capacityMassDialogueId` | item reward preflight failed on `mass` |
| Completed story | **Ordinary post-completion dialogue** | `MissionDefinition.completedNpcDialogue` | newest completed mission that authors ordinary dialogue for this NPC; one-shot completion presentation is **not** reused here |
| Completion presentation (one-shot) | **Completion presentation** | `MissionDialogue.completionPresentationDialogueId` (`getMissionCompletionPresentation`) | presentation-only beats (`item` / `skill_xp`) shown immediately after the authoritative success via the transient override in `NpcInteractionPanel`; subsequent conversations route to the completed-story dialogue above |

Action labels on sequences (`actionLabel`, e.g. "Claim Cutter", "SHOW SHALE") are authored copy for the terminal control. Capacity and completion beats are presentation only — the authoritative completion stamp, consumption, and reward already committed when they become visible.

### 9.1 Completion presentation is one-shot, not persistent idle

`MissionDialogue.completionPresentationDialogueId` is narrowly-scoped one-shot UI presentation shown immediately after the authoritative completion succeeds (via the transient `sequenceOverride` in `NpcInteractionPanel`). After that conversation closes, later talks route to ordinary completed-story dialogue (the newest authored `completedNpcDialogue`), not a replay of the reward beats. A refresh/reopen after completion likewise routes to ordinary story dialogue — no durable pending-presentation persistence is added in this issue. Ordinary future missions should author new post-completion dialogue instead of reusing the presentation as idle.

## 10. Quest guidance

Quest guidance answers one question for UI consumers — *"is this entity / control currently a quest-guidance target?"* — without consumers inspecting mission IDs, objective prose, or drop tables. Every guidance consumer reads the same derived set via `deriveQuestGuidanceTargets(state.missions)`.

### Two semantic meanings

| Meaning | CSS treatment | What it signals |
| --- | --- | --- |
| **Quest available** | `.rs-quest-available` — blue/cyan (`--rs-quest-available-*`) | "There is a new quest here." An NPC's authored offer is currently available. |
| **Accepted quest progression** | `.rs-quest-guidance` — neon green (`--rs-quest-guidance-*`) | "This interaction advances the quest you accepted." The active objective's target (NPC, equipment affordance, or authored recommended action). |

Both are static treatments (no animation) and use a shared-class approach — no per-component green/blue classes. Tokens and classes live in `app/globals.css`. Consumers set `data-quest-guidance="available" | "active"`.

**Active green wins if something ever qualifies for both.** React priority (`hasActiveGuidance` over `hasAvailableGuidance`) ensures only one class is normally present; CSS also guarantees green wins when both classes coincide (`.rs-quest-available.rs-quest-guidance`).

### Available guidance (blue)

Derived in `game/domain/missions.ts` as `MissionGuidance.availableNpcIds`:

- For every mission where `state === "not_accepted"` and its prerequisite is satisfied and it is not completed, **every** offer whose `locationId` matches the player's current location contributes its `npcId`. No `offers[0]` shortcut — all authored offer locations are covered.
- Available guidance guides **NPC interactions only** (Talk affordances in `NpcInteractionPanel`).
- It does **not** depend on `availableObjective`. A mission may have offers in the world and still have `availableObjective === undefined` (§11).

### `availableObjective` is presentation copy only

`MissionDefinition.availableObjective` is optional copy shown while a mission is available but not yet accepted (e.g. Cut Your Teeth's "Speak with Tansy Rusk at The Jag to begin…"). It has no effect on availability itself, guidance derivation, or acceptance eligibility. Producers and consumers must not gate or infer guidance from it.

### Active guidance (green)

Derived from the **first unmet requirement in authored order** on each accepted-but-incomplete mission (`active` / `ready_for_completion`), or the turn-in NPC once every requirement holds:

| First-unmet kind | Guidance target |
| --- | --- |
| *(all satisfied)* | `npcId: turnIn.npcId` — the turn-in NPC is the target even while the character is busy (§7) |
| `equipped_item` | `equipmentItemId: requirement.itemId` — the equipment affordance / inventory tile for that item |
| `carried_stack` (with `recommendedActionId`) | `actionId: requirement.recommendedActionId` — the authored recommended gameplay action |

Each consumer answers "am I that target?":

- **NPC Talk** — `guidance.npcIds.has(npc.id)` (green) vs `guidance.availableNpcIds.has(npc.id)` (blue).
- **Cutter Inventory tile / Equipment "Equip in slot"** — `guidance.equipmentItemIds.has(itemId)` (the Cutter step).
- **Start Mining / Start Refining** — `guidance.actionIds.has(actionId)` while the action is currently relevant/available. An action highlights only when its `ActionId` is the authored `recommendedActionId` on the current unmet carried requirement.

### Teaching intent (`recommendedActionId`)

`recommendedActionId` on a `carried_stack` requirement expresses **teaching / recommendation intent** — which gameplay interaction this mission is intentionally guiding the player toward for acquisition. It is distinct from requirement truth (which observes carried quantity regardless of provenance) and is **validated against the action's authoritative output facts** (`getActionOutputItemIds` in `game/domain/action-outputs.ts`, which derives directly from the gameplay resolvers' award facts `miningAwardFacts` / `refiningAwardFacts`). Changing what an action authoritatively produces cannot leave quest-guidance validation stale, and the generic action registry is intentionally not widened beyond this narrow capability check.

Not every technically possible acquisition path should be highlighted. Only the authored `recommendedActionId` on the current unmet carried requirement is highlighted. Cut Your Teeth recommends `ferrite_shale_mining` — Scavenge also yields Ferrite Shale, but has no `ActionId` to author there and is never highlighted merely because it can produce the same item.

`QuestGuidanceTargets` is the union across all missions: `availableNpcIds`, `npcIds`, `equipmentItemIds`, `actionIds`.

## 11. Explorer-first behavior

**Walk It Off can simultaneously advertise both Wade (Crash Site) and Tansy (The Jag) as available quest interactions while still having `availableObjective === undefined`.**

This is intentional. The mission has two real offer routes (Wade at the Crash Site and Tansy at The Jag) so a player who walks straight to The Jag meets Tansy first without missing the starter quest. Availability guidance is derived from every currently relevant authored offer at the player's current location (§10) and does not depend on objective copy. Walk It Off deliberately omits `availableObjective` to keep explorer discovery — the player is not pointed at the quest giver by mission copy before they have found it.

Future authors must not re-couple availability highlighting to objective copy. Adding `availableObjective` to Walk It Off (or checking it in guidance consumers) would be a regression, not an improvement.

## 12. Server authority / generic commands

The browser submits only **narrow mission intent / identity** through the existing command boundary:

```ts
// game/schemas/gameplay.ts
type AcceptMissionRequest  = { characterId: string; missionId: string; npcId: string };
type CompleteMissionRequest = { characterId: string; missionId: string; npcId: string };
```

Wired as `acceptMissionAction` / `completeMissionAction` in `server/actions.ts` and executed as `acceptMission` / `completeMission` in `server/missions.ts`.

Every other rule is **re-read and revalidated server-side inside the character transaction**:

- unknown `missionId` / `npcId`;
- prerequisite completion;
- authored offer route for acceptance (`definition.offers.find(npcId)`);
- stationary presence at `offer.locationId` (acceptance) or `turnIn.locationId` (completion);
- NPC identity for turn-in;
- every authored requirement against live equipment/inventory (`at_location`, `equipped_item`, `carried_stack` with the authoritative carried quantity);
- for consumed carried requirements, an exact pure removal plan via the inventory planner without mutating rows (§6);
- for item rewards, a **post-consumption preflight**: plans are applied cumulatively to an in-memory candidate inventory and the reward's capacity is checked against that post-consumption candidate — consumption may legitimately free the slot or mass the reward needs;
- only after the complete plan is valid, consumption through the authoritative carried-stack boundary and the single declared reward and the guarded `completedAt` stamp commit in the same transaction; any failure (insufficient quantity, capacity still blocked, reward application error) leaves the whole transaction uncommitted;
- the character lock (`withResolvedOwnedCharacter` / `runMissionCommand`) plus the `completedAt` `isNull` guard make acceptance and completion — and therefore consumption and reward — exactly-once under retries and concurrent first completions.

Do not document or introduce client-authoritative shortcuts. The client never supplies required items, quantities, `consume` behavior, rewards, prerequisite status, or completion eligibility.

## 13. Authoring an ordinary new mission

An ordinary mission is one that uses already-supported semantics: authored content plus the generic projection / routing / guidance / generic commands (§2). It should not require server, wiring, or client routing changes to adopt.

### Checklist

An ordinary mission using existing semantics should generally require:

1. **Stable mission/dialogue IDs** — entries in `MISSION_IDS` / `DIALOGUE_IDS` (`game/config/foundations.ts`) plus any new item/NPC/location/action IDs it genuinely needs.
2. **One mission definition** — a single `MissionDefinition` in `game/content/missions.ts` with offers, ordered requirements, `turnIn`, reward, and `dialogue` mapping. Add it to `MISSIONS` in authored order (the chain order matters for newest-first routing).
3. **Authored dialogue sequences** — in `game/content/dialogue.ts`, plus any needed idle/continuation/capacity/completion beats referenced by the definition.
4. **Focused definition / projection / integration / E2E coverage** for the new behavior — balance-adjacent derivation, validation, and journey coverage appropriate to what the mission newly exercises. No need to retrofit unrelated docs.

### It should not normally require

- a new bespoke server completion transaction,
- a new mission-specific server command or request schema,
- edits to generic mission projection (`game/domain/missions.ts`) or the dialogue router (`game/content/dialogue.ts`),
- mission-ID branches in React (`features/…`),
- parsing objective or dialogue prose to determine gameplay rules,
- new quest-specific guidance CSS.

### Warning

> If an ordinary mission using already-supported semantics seems to require mission-ID checks in UI, a bespoke accept/complete transaction, or prose parsing, stop and inspect whether the framework is being bypassed.

That pattern is a signal that authored content (offers, requirements, turn-in, dialogue mapping, guidance targets) is not carrying the semantics it should, or that guidance/dialogue routing is being special-cased instead of consumed through `deriveQuestGuidanceTargets` / `resolveNpcMissionDialogue` / `MissionProjection.stage`.

When in doubt, favour adding or correcting authored mission content and reusing the existing semantic paths over introducing mission-specific code.

## 14. Current limitations

The framework currently models **one live-state phase** per mission. Requirements observe current authoritative state (§5) and no durable progress is persisted beyond `acceptedAt` / `completedAt`. This keeps ordinary missions simple, but the following progress shapes are **not yet modelled** and must earn an explicit framework extension when a real mission needs them:

- **Multi-location history** such as "visit A → visit B → return to A" when the visits leave no durable evidence in current state (e.g. two `at_location` steps that would both already be satisfied by the current location).
- **Remembered conversation steps** or arbitrary dialogue memory beyond the single generic accept/complete actions.
- **NPC relocation based on quest progression** — mission location semantics are intentionally authored on the definition, not derived from `npc.homeLocationId`, so a future NPC-movement feature does not inherit an accidental invariant, but movement itself is not yet implemented.
- **Arbitrary persistent per-step ledgers** (counts, flags, or provenance tracking like "shale mined since acceptance" — current carried-stack requirements intentionally count any carried quantity (§5–§6)).
- **Branching, repeatable, or timed quest systems.**

The current requirement/projection vocabulary was kept reusable so a future narrow phase wrapper (`mission → phase → same requirements / dialogue / guidance vocabulary`) can layer on top without rewriting the existing missions, and mission location semantics already avoid the `homeLocationId` derivation trap.

Future real requirements should extend the framework deliberately — a narrow, validated content + projection + guidance extension with focused coverage — rather than adding mission-specific hacks (bespoke transactions, ID branches, or prose parsing) around the current one-phase boundary.

## Examples

Short concrete examples that demonstrate the framework vocabulary. Do not copy mission-specific IDs as a pattern — the point is the vocabulary, not the IDs themselves.

### Walk It Off — travel-and-talk

- **Offers:** two authored routes (Crash Site + The Jag) so explorer-first remote acceptance just works (§4 / §11).
- **Requirements:** one `at_location: The Jag`. Walk away and the objective regresses — projection is live.
- **Turn-in:** `Tansy` at `The Jag`, stationary only. No duplicated `at_location: The Jag` requirement needed for eligibility (§7). `turnIn.objective: "Talk to Tansy Rusk"`.
- **Reward:** one `item` — the Salvage Cutter. Registry validates it is a unique item because the generic completion path executes only that shape (§8).
- **Dialogue:** offer sequences plus `completionPresentation` (`tansyAfterClaim`, which presents the already-granted Cutter via an `item` beat) and `capacitySlots` / `capacityMass` refusal branches that the server selects generically after a `capacity` refusal.
- **Guidance + explorer-first:** no `availableObjective` (§11). At Crash Site, blue targets Wade; at The Jag, blue targets Tansy — each derived from the matching authored offer at the current location, prerequisite-satisfied and not yet accepted.

### Cut Your Teeth — equip-and-collect

- **Prerequisite:** `walkItOff` must be `completed` before it can be offered or accepted.
- **Offer:** single `Tansy` at `The Jag` (`tansyCutYourTeethOffer`). Availability guidance stays dark until `walkItOff` completes, then blue on Tansy (§10).
- **Requirements (ordered):** `at_location: The Jag` → `equipped_item: salvageCutter` → `carried_stack: ferriteShale` with omitted `quantity` (full authoritative stack, currently `10`), `turnIn: "show"`, `recommendedActionId: ferrite_shale_mining`. The ordered progression is: return → equip → carry. Prior steps remain satisfied checks, and the carried objective renders as "Get a full stack of Ferrite Shale — 3 / 10" via `{carried} / {required}` substitution against live inventory. The stack is shown, never consumed (§6).
- **Teaching intent:** `recommendedActionId` highlights `Start Mining` while the carried step is the current objective (§10) — validated against `miningAwardFacts`. Scavenged shale still satisfies the requirement (§5).
- **Turn-in:** `Tansy` at `The Jag`, stationary only; `stage.turnInAvailable` distinguishes "I carry 10 but I'm still mining" (busy) from "ready to show" (§7). The turn-in dialogue (`SHOW SHALE`) carries `complete_mission`; the `skill_xp` reward (+100 Mining) and `item` beat are presentation only after the authoritative success.
- **Dialogue stage routing:** `equipmentReminder` vs `carriedReminder` vs `busy` vs `completionPresentation` vs `turnIn` selected semantically from `stage.nextObjectiveKind` / `requirementsSatisfied` / `turnInAvailable` — never from prose.
