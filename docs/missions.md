# Mission framework

Authoritative authoring contract for the declarative single-phase mission system introduced by #124 / #125.

The document describes the mission framework's own contracts. It is intentionally narrow: it does not document the shared play-state assembly that hosts projection as permanent framework architecture — see §2. Since #127 that host is the generic play boundary (`server/play.ts` / `PlayContext`), not a Mining concern; this document remains valid across it.

Base your work on the current PR #125 implementation (`game/content/missions.ts`, `game/domain/missions.ts`, `game/domain/action-outputs.ts`, `game/content/dialogue.ts`, `server/missions.ts`, `server/mission-state.ts`, `game/schemas/gameplay.ts`, `server/actions.ts`, `app/globals.css`). The original #114 proposal is superseded where implementation refined details (most notably, availability guidance).

## 1. Purpose and boundary

RuneSpace currently supports **ordinary single-phase, server-authoritative missions expressed primarily through authored mission definitions**.

- A mission is a small declarative definition (offers, ordered requirements, turn-in, one reward, dialogue mapping) plus authored dialogue sequences. Its conversations are surfaced through the one canonical NPC conversation model (`docs/npc-conversations.md`).
- Generic projection derives live state (`not_accepted` / `active` / `ready_for_completion` / `completed`), objective copy, and semantic guidance from authoritative character state on every command.
- Generic server commands handle acceptance and completion for all missions.

The framework deliberately does not attempt to support every future mission shape. If a real new mission needs a novel requirement kind, reward shape, or persistent phase history, extend the framework deliberately (§13–§14) rather than adding a mission-specific transaction or UI branch.

## 2. Authoritative homes

| Concern | Current home(s) | Notes |
| --- | --- | --- |
| Mission definitions / content | `game/content/missions.ts` — `MissionDefinition`, `MissionOffer`, `MissionRequirement`, `MissionTurnIn`, `MissionDialogue`, `MissionReward`, `MissionAcceptEffect`, `MISSIONS` registry, `WALK_IT_OFF` / `CUT_YOUR_TEETH` / `WASTE_NOT` / `HOLD_IT_TOGETHER` / `KEEP_THE_CHANGE` | `getMission(id)` is the content accessor. |
| Generic mission projection | `game/domain/missions.ts` — `projectMission`, `deriveMissionState`, `deriveMissionGuidanceTargets`, `validateMissionDefinitions`; `server/mission-state.ts` — `loadMissionProjections` | Projection combines live authoritative state with current generic tracked progress; targets and activity definitions remain content-owned. |
| Tracked activity progress | `db/rune-space.ts` — `characterMissionProgress`; `server/mission-progress.ts` — row initialization, capped attempt consumption, and the mandatory-conversation marker | One row per character, mission, and stable authored `progressKey`; only current progress is persisted. `tracked_activity` and `npc_conversation` requirements share that one row shape and one progress-key space. There is no event history, provenance, lifetime counter, or acceptance-time slicing. Repair completion is observed separately from its authoritative `character_repair_targets` row and never creates mission progress. |
| Generic acceptance / completion boundary | `server/missions.ts` — `acceptMission`, `completeMission`, `acknowledgeMissionConversation` (+ `completeMissionWithDefinition` test seam); `server/actions.ts` — `acceptMissionAction` / `completeMissionAction` / `acknowledgeMissionConversationAction`; `game/schemas/gameplay.ts` — `AcceptMissionRequestSchema` / `CompleteMissionRequestSchema` / `AcknowledgeMissionConversationRequestSchema` | Shared `runMissionCommand` character lock / reconciliation wrapper. See §12. |
| Authored dialogue | `game/content/dialogue.ts` — `DIALOGUE_SEQUENCES` / `getDialogue` | Sequences are pure presentation content (no `action`). |
| NPC conversation resolution | `game/domain/conversation.ts` — `resolveNpcConversation`, `NpcConversationEntry`, `getMissionCapacityRefusalDialogue`, `getMissionCompletionPresentation`; authored topics in `game/content/conversation-topics.ts` | The one canonical conversation model (§9); see `docs/npc-conversations.md`. |
| Semantic guidance projection | `game/domain/missions.ts` — `MissionGuidance`, `MissionGuidanceTargets`, `deriveMissionGuidanceTargets`; `app/globals.css` — `--rs-mission-guidance-*` / `--rs-mission-available-*` and `.rs-mission-guidance` / `.rs-mission-available` | Guidance is a derived set consumed by `NpcInteractionPanel`, `MiningActivity`, `RefiningConsole`, `EquipmentPanel`, `InventoryPanel`, `CargoHoldPanel`. |

The shared play-state assembly projects `state.missions` through the generic play boundary (`server/play.ts` `stateFromTransaction`, surfaced by `PlayContext` / `usePlay` via `features/play/PlayConsole.tsx`). That play layer is the current host for projection and is not a mission-framework contract; do not depend on its module name to reason about missions.

## 3. MissionDefinition

Current terminology (`game/content/missions.ts`):

```ts
type MissionDefinition = {
  id: MissionId;                         // stable content ID
  title: string;
  summary: string;
  prerequisiteMissionId?: MissionId;     // absent for the first mission
  continuationMissionId?: MissionId;     // zero-or-one authored continuation, see §3.1
  offers: readonly MissionOffer[];       // ≥1, or [] for a linked continuation-only mission
  requirements: readonly MissionRequirement[]; // ordered live-state checks
  turnIn: MissionTurnIn;                 // authoritative completion interaction
  reward?: MissionReward;                // at most one, see §8
  dialogue: MissionDialogue;             // semantic dialogue mapping
};
```

- **Stable ID** — `MISSION_IDS` in `game/config/foundations.ts`. Referenced by persistence (`characterMissions`), projection, and dialogue routing. Never rename without a migration.
- **`title` / `summary`** — player-facing names on the mission.
- **`prerequisiteMissionId`** — when present, the referenced mission must be `completed` before this one is offered or accepted. An eligibility rule only — never a reveal mechanism (see §10–§11). Validated at module load (unknown ID or self-cycle fails fast).
- **`continuationMissionId`** — zero-or-one explicitly authored automatic continuation (§3.1).
- **`offers[]`** — one or more authored offer routes (§4), except a continuation-only mission may use an empty array only when another authored mission points to it with `continuationMissionId`. An unlinked offerless definition fails validation.
- **`requirements[]`** — ordered requirements (§5) evaluated against live authoritative state on every projection.
- **`turnIn`** — `npcId` + `locationId` + `requiresStationary: true` + objective copy + `dialogueId` (§7). Mission location semantics are authored here and **never** derived from an NPC's `homeLocationId`.
- **`reward`** — at most one narrow reward, and optional: a mission whose real outcome is world/social state authors none (§8).
- **`dialogue`** — optional semantic mappings (§9).

Registry validation (`validateMissionDefinitions`) runs at module load against content + authoritative balance (NPC/location/item/dialogue existence, prerequisite shape, continuation shape/cycles, stackable checks, stack limits, reward skill curve, and `recommendedActionId` capability). An authoring mistake never reaches a player as a silent runtime refusal.

### 3.1 Authored mission continuation

A mission may declare **zero or one** automatic continuation via `continuationMissionId`. When the mission successfully completes, the generic completion boundary atomically accepts the continuation in the same transaction (reward + completion stamp + continuation acceptance commit together; retries stay exactly-once).

Rules:

- **Explicit authoring, never prerequisite inference.** A prerequisite only says the later mission cannot begin first — it does not imply discovery or a direct narrative continuation. The predecessor must name its continuation.
- **Singular only.** No arrays, fan-out, or branching continuation choices.
- **Validated narrowly:** unknown continuation IDs, self-continuations, and cycles fail fast. The target must have no prerequisite or require the predecessor — otherwise the auto-accept would contradict the target's own eligibility rule.
- **First production use:** Walk It Off continues into Cut Your Teeth, Cut Your Teeth continues into Waste Not, and Waste Not continues into Hold It Together. Completing a predecessor accepts its authored continuation immediately; the completion presentation flows into the next assignment with no second acceptance click. Waste Not and Hold It Together have no manual acceptance route.

## 4. Mission offers

A mission may have **multiple authored offer routes**. Offer NPC / location / dialogue are authored data; UI must never infer these rules from NPC names or prose.

**Useful example — Walk It Off** (`WALK_IT_OFF.offers`):

- **Route A:** `Wade` at `Crash Site` — `dialogueId: wadeOffer`, `activeDialogueId` while the mission is active; ordinary completed story via `completedNpcDialogue` (Wade) after completion.
- **Route B:** `Tansy` at `The Jag` — `dialogueId: tansyBeforeMission`, `acceptedContinuation: { dialogueId: tansyAfterRemoteAcceptance, completesMission: true }`. Tansy is Walk It Off's turn-in NPC, so the continuation walks straight into the authored Cutter claim; validation rejects `completesMission` at an NPC who does not own the turn-in.

Both routes are real. The second exists so a player who walks straight to The Jag can meet Tansy first and immediately receive the same mission — the framework calls this *explorer-first remote acceptance*. Offer location/dialogue semantics are authored explicitly in `MissionOffer`:

```ts
type MissionOffer = {
  npcId: NpcId;
  locationId: LocationId;
  dialogueId: DialogueId;
  actionLabel?: string;                        // authored acceptance control copy
  acceptedContinuation?: {                     // shown right after accept at this offer
    dialogueId: DialogueId;
    completesMission?: true;                   // the continuation presents this mission's turn-in
  };
  activeDialogueId?: DialogueId;               // active follow-up at this offer NPC
};

// Ordinary post-completion story dialogue authored per completed mission, including
// NPCs who were not that mission's offer/turn-in participant. Newest completed mission
// that authors dialogue for the NPC wins — how story state advances globally.
type MissionNpcDialogue = { npcId: NpcId; dialogueId: DialogueId };
```

A mission may also author `completedNpcDialogue: readonly MissionNpcDialogue[]` on `MissionDefinition` so a later mission can advance story dialogue for NPCs outside its offer/turn-in set (e.g. Cut Your Teeth advancing Wade after Tansy's turn-in).

An active mission may author `activeNpcDialogue: readonly MissionNpcDialogue[]` for contextual dialogue at relevant NPCs who are neither offer nor turn-in NPCs. The mapping is optional and additive; the turn-in NPC's stage-aware dialogue and an offer NPC's `activeDialogueId` remain their existing owners. Validation rejects unknown or duplicate NPC mappings, NPC/dialogue mismatches, and attempts to override an offer or turn-in route.

### Optional contextual NPC dialogue

A mission may author `activeNpcDialogue` for NPCs who are not the offer or turn-in NPC when it makes narrative sense for them to react to the player's current work.

These branches are optional world-reactivity and exploration rewards. They may provide characterization, commentary, or nonessential hints, but must never contain information required to discover, progress, or complete the mission.

Do not author every NPC for every mission. Use this selectively where the NPC's relationship, expertise, location, or story connection makes the reaction feel natural.

Keep this within the existing semantic mission routing system; never implement these reactions as UI-side mission-ID or prose checks.

Concrete example: Hold It Together authors `activeNpcDialogue` for Tansy (`tansy_rusk_hold_it_together_active`) — she acknowledges Wade put the player on the Cargo Hold repair with practical mechanic flavor ("Don't get cute with the welds. Clean seams, steady heat, and let the Ferrite do its job."), without naming the repair recipe, the Cargo UI mechanics, or becoming an objective, turn-in, or alternate progression path.

Consumers never read `offers[0]` as "the" offer and never infer location from an NPC record.

## 5. Ordered requirement vocabulary

The currently supported live-state requirement kinds (`MissionRequirement`) are a **closed union**:

| Kind | Fields | What satisfies it |
| --- | --- | --- |
| `at_location` | `locationId`, `objective` | `currentLocationId === locationId` (current location alone) |
| `equipped_item` | `itemId`, `objective` | the item genuinely occupies its authoritative compatible slot (carried instance + `equippedItems` assignment; a stored instance does not count) |
| `tracked_activity` | `progressKey`, `activity`, `metric: "attempts"`, `target`, `objective`, `recommendedActionId?` | current persisted progress for the stable key reaches the authored target; resolved attempts count whether the activity succeeds or fails |
| `carried_stack` | `itemId`, `quantity?`, `turnIn`, `objective`, `recommendedActionId?` | current carried quantity for `itemId` ≥ resolved required quantity (§6) |
| `repair_target_complete` | `targetId`, `objective`, optional `materialObjective` / `weldingObjective` | that repair target's authoritative completion (`completed_at` is present in `character_repair_targets`); no mission-progress row is created. Hold It Together observes the Cargo Hold, Out of the Weather the Crew Stop. The optional phase copy renders the live phase — see §5.1 |
| `npc_conversation` | `npcId`, `locationId`, `dialogueId`, `progressKey`, `objective`, `actionLabel?` | the durable marker for that authored key is set, which only the generic `acknowledgeMissionConversation` command does (§12.3). Trade, arrival, or reading prose never satisfy it |

**Ordering owns the objective.** The first unmet requirement in authored order becomes the current semantic objective / guidance step. `requirements` order is gameplay — changing it changes the player's progression and guidance.

For example, Cut Your Teeth authors:

1. `at_location: The Jag` → "Return to The Jag"
2. `equipped_item: salvageCutter` → "Equip the {item} from Inventory"
3. `tracked_activity: mining-attempts` (five attempts) → "Complete 5 Mining attempts — {current} / {target}"
4. `carried_stack: ferriteShale` (full stack, show) → "Get a full stack of {item} — {carried} / {required}"

If the character is away from The Jag, (1) is the current objective even though (2) and (3) are also unmet.

**Live-state observation, plus narrow current counters.** Location, equipment, and carried-stack requirements observe current authoritative state. Tracked activities use only the current capped progress value for their stable authored key; the framework does not create per-attempt timestamps, event history, provenance, or lifetime counters. Scavenged shale and mined shale are indistinguishable — carried `ferriteShale` counts regardless of how it was obtained. See §14 for what this boundary currently excludes.

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
  dialogueId: DialogueId;        // the turn-in conversation
  actionLabel?: string;          // authored completion control copy ("Claim Cutter", "SHOW SHALE", ...)
};
```

Key rules:

- **All requirements may be satisfied while turn-in is still unavailable.** `deriveMissionState` and `MissionProjection.stage` distinguish `requirementsSatisfied` (every authored requirement holds) from `turnInAvailable` (requirements hold **and** the character is stationary **at** `turnIn.locationId`). `ready_for_completion` requires all three together. While busy, the objective already advances to the turn-in copy and guidance already targets the turn-in NPC, but the turn-in is merely not performable yet.
- **Mission guidance's turn-in phase follows `requirementsSatisfied`, not `turnInAvailable`.** `deriveGuidance` (§10) enters the blue TURN IN state the moment every authored requirement holds, independent of whether the character has reached `turnIn.locationId` or is stationary there.
- **`turnIn.locationId` is an independent eligibility constraint.** It is checked separately from the requirement list — in `deriveMissionState` for projection and again in `completeMissionForDefinition` for server authority.
- **`requiresStationary` is independent.** `activeActionId !== undefined` refuses the turn-in regardless of requirements.
- **Authors must not duplicate the turn-in location as an `at_location` requirement merely to make eligibility correct.** `at_location` requirements exist for objective progression when the mission actually requires that location *state* (e.g. Walk It Off's "Travel to The Jag" progression, Cut Your Teeth's "Return to The Jag" step). The turn-in constraint itself does not need a duplicated requirement to stay correct.

## 8. Rewards and acceptance effects

The framework currently supports **at most one reward per mission, and only these two shapes** (`MissionReward`):

```ts
type MissionReward =
  | { kind: "item"; itemId: ItemId }                 // Walk It Off: Salvage Cutter
  | { kind: "skill_xp"; skillId: SkillId; amount: number }; // Cut Your Teeth: +100 Mining XP
```

- **Item** — granted as **one new unique item instance** through the generic completion boundary (capacity-preflighted, guarded by the `completedAt` exactly-once stamp). Registry validation rejects stackable item rewards at definition time because there is no authorized execution path for them yet. Reward initialization derives from `getItemMaximumCharge`: chargeable items arrive depleted (`currentCharge: 0`), others get the schema's `null` — no silent claim of arbitrary charge semantics.
- **Skill XP** — granted through the authoritative progression boundary (`grantCharacterSkillXp`). `amount` must be a positive integer and `skillId` must have a progression curve (`skillLevelThresholds`).

Out of the Weather (#172) uses the skill-XP shape for the one thing it does pay:
**250 Welding XP** on turn-in, on top of the 500 the ten genuine Welding
increments already awarded through the ordinary Welding path. The Mission adds
no synthetic work XP of its own — the work pays for the work — and deliberately
adds no Credit payout, because the reward the Mission is actually about is that
the Crew Stop stays fixed and the crews will give the player a ride.

**No reward is a valid authored choice.** `reward` is optional. A mission whose
real outcome is world or social state — Keep the Change opens HH B&B and pays
its budget up front — authors none, and the completion transaction then commits
only consumption, the completion stamp, and any continuation. Registry
validation skips reward checks for such a mission, and projection reports no
`earnedReward`. Do **not** invent a token payout merely because missions usually
have one.

**Not currently supported as a completion reward:** stackable item rewards,
bundles, multi-reward missions, credits, reputation, generic effects, or
similar. A real mission that genuinely needs one of these earns an explicit,
narrow framework extension — do not add a mission-specific transaction or widen
the reward union speculatively.

### 8.1 Acceptance effects (`MissionOffer.acceptEffect`)

An offer route may author **one** effect applied when acceptance at that route
commits:

```ts
type MissionAcceptEffect = { kind: "credits"; amount: number };
```

This exists for an **up-front job budget**, which is a different thing from a
reward: Wade hands his new apprentice 24 Credits — the retail price of the three
Power Cells the job needs — before any work happens, and whatever the player
does not spend stays theirs. There is deliberately no reimbursement, no
completion payout, and no provenance tracking on what they buy.

- Authored on the **offer**, not the mission, because the giver and the amount
  belong to that route.
- Applied inside the generic acceptance transaction, in the branch that has
  already proven this is a genuinely fresh acceptance, so the existing
  acceptance guard makes it exactly-once (§12.3). The balance is incremented in
  SQL rather than from a read value.
- Validated as a positive integer at module load.
- Deliberately a closed one-kind union — not a generic effect list. Another real
  need earns another explicit kind.

## 9. Conversations and dialogue

Since #164 every NPC uses **one canonical conversation model**: `Talk to <NPC>`
opens a conversation hub listing the currently relevant conversations, and the
player selects one. `docs/npc-conversations.md` is the authoritative contract for
that model, including replayable social topics and their availability. This
section covers only what Mission content owns.

Dialogue remains **authored content** while semantic mission state **selects**
the appropriate sequence. Server and UI code must not parse dialogue or objective
prose to determine gameplay rules.

### Authored dialogue homes

- **Sequences** — `game/content/dialogue.ts` (`DialogueSequence`, `DIALOGUE_SEQUENCES`, `getDialogue`). A sequence is `{ id, npcId, beats }` and nothing else. Beats are presentation only (`npc` / `item` / `skill_xp`); item and skill-XP beats never mutate state.
- **Semantic mapping** — `MissionOffer` (`dialogueId`, `actionLabel`, `acceptedContinuation`, `activeDialogueId`) plus `MissionDefinition.activeNpcDialogue` (contextual active dialogue for relevant off-path NPCs), `MissionDefinition.completedNpcDialogue` (ordinary post-completion story dialogue per NPC), and `MissionDialogue` for turn-in-stage branches, capacity, and the one-shot completion presentation.

### Mission action semantics are Mission-owned

A sequence carries **no** `action` and **no** `actionLabel`. The Mission command
a conversation may run — and the authored copy on its control — is resolved from
Mission content into the conversation entry:

| Conversation | Command | Label source |
| --- | --- | --- |
| Offer | `accept_mission` | `MissionOffer.actionLabel`, else `Accept mission` |
| Turn-in | `complete_mission` | `MissionTurnIn.actionLabel`, else `Turn in` |
| Acceptance continuation with `completesMission` | `complete_mission` | the same `MissionTurnIn.actionLabel` |
| Mandatory conversation (`npc_conversation`) | `acknowledge_conversation` | the requirement's `actionLabel`, else `Got it` |
| Reminder / busy / contextual / completed-story / capacity refusal / completion presentation | *(none)* | — |

So dialogue prose can never determine gameplay truth, and a social topic can
never accidentally carry a Mission command.

### Currently supported semantic dialogue routing

All routed through the single generic resolver
`resolveNpcConversation(npcId, projections)` in `game/domain/conversation.ts`,
which consumes `NpcConversationProjection` (`missionId`, `state`,
`prerequisiteSatisfied`, `stage`, `guidance`) — structurally satisfied by
`MissionProjection`, so the client passes `state.missions` directly. Resolution
scans newest-first: accepted missions, then available offers, then (only when
neither exists for that NPC) the single latest completed-story follow-up, then
replayable topics. It is driven exclusively by semantic state, never by
mission-ID chains in UI code. Within an accepted mission, turn-in stage routing
owns the turn-in NPC, while `activeNpcDialogue` and an offer's
`activeDialogueId` own other NPCs. `completionPresentationDialogueId` is **not**
persistent idle dialogue — it is immediate one-shot presentation after success
(§9.1).

| Routing tier | Kind | Source | When it is selected |
| --- | --- | --- | --- |
| Offer | **Offer** | `MissionOffer.dialogueId` | `not_accepted` + prerequisite satisfied + this NPC authors an offer |
| Offer | **Authored acceptance continuation** | `MissionOffer.acceptedContinuation` | returned alongside the offer entry; the UI presents it immediately after a successful `accept_mission` at that offer (Tansy remote acceptance → Cutter claim) |
| Active (turn-in NPC) | **Turn-in** | `MissionTurnIn.dialogueId` | `active` / `ready_for_completion` + every requirement holds (the stage turns the interaction into a completion attempt; busy is distinguished below) |
| Active (turn-in NPC) | **Requirements satisfied but busy** | `MissionDialogue.busyDialogueId` | requirements hold but `turnInAvailable` is false because the character is still busy |
| Active (turn-in NPC) | **Equipment reminder** | `MissionDialogue.equipmentReminderDialogueId` | first unmet requirement `kind === "equipped_item"` |
| Active (turn-in NPC) | **Carried-item reminder** | `MissionDialogue.carriedReminderDialogueId` | first unmet requirement `kind === "carried_stack"` |
| Active (turn-in NPC) | **Tracked-activity reminder** | `MissionDialogue.trackedActivityReminderDialogueId` | first unmet requirement `kind === "tracked_activity"` |
| Active (turn-in NPC) | **Repair reminder** | `MissionDialogue.repairReminderDialogueId` | first unmet requirement `kind === "repair_target_complete"` |
| Active (turn-in NPC) | **Conversation reminder** | `MissionDialogue.conversationReminderDialogueId` | first unmet requirement `kind === "npc_conversation"` — e.g. Tansy telling the player to go and see Bix first |
| Active (conversation NPC) | **Mandatory conversation** | the `npc_conversation` requirement's own `dialogueId` | the requirement is authored for this NPC and is **not yet satisfied**; carries `acknowledge_conversation`. Once satisfied the entry disappears (§9.2) |
| Active (other offer NPC) | **Active follow-up** | `MissionOffer.activeDialogueId` | the offer NPC while the mission is active — e.g. Wade while Walk It Off is active |
| Active (relevant off-path NPC) | **Active contextual dialogue** | `MissionDefinition.activeNpcDialogue` | an authored active mission mapping for an NPC who is neither an offer nor turn-in NPC |
| Completion | **Capacity refusal — slots** | `MissionDialogue.capacitySlotsDialogueId` | item reward preflight failed on `slots` (selected generically from the mission's mapping after a `capacity` refusal) |
| Completion | **Capacity refusal — mass** | `MissionDialogue.capacityMassDialogueId` | item reward preflight failed on `mass` |
| Completed story | **Ordinary post-completion dialogue** | `MissionDefinition.completedNpcDialogue` | newest completed mission that authors ordinary dialogue for this NPC, and only when that NPC has no current mission conversation; one-shot completion presentation is **not** reused here |
| Completion presentation (one-shot) | **Completion presentation** | `MissionDialogue.completionPresentationDialogueId` (`getMissionCompletionPresentation`) | presentation-only beats (`item` / `skill_xp`) shown immediately after the authoritative success via the transient override in `NpcConversation`; subsequent conversations route to the completed-story dialogue above |

Capacity and completion beats are presentation only — the authoritative
completion stamp, consumption, and reward already committed when they become
visible.

#### 9.2 A mandatory conversation is a one-time story event

An `npc_conversation` requirement is **not** idle dialogue and **not** a
replayable topic. It is a specific occurrence: Mara walks into Bix's shop,
meets the player, and the reason HH B&B later opens is established there.

The routing consequence is deliberate:

- While the requirement is unsatisfied, that NPC's hub offers the scene, with
  the authored terminal control (`acknowledge_conversation`).
- Backing out — Back, Finish, Close, Escape, or a refresh — records nothing, so
  the scene can be entered again. The event has not authoritatively happened.
- Once the command succeeds, the entry is **gone from the hub for good**. It
  does not move into `Talk about`, and no other route replays it. That NPC's
  ordinary replayable topics are unaffected.

Satisfaction is read from the projected requirement statuses (the same
authoritative mission state everything else uses), not from any
viewed-conversation flag — RuneSpace still persists nothing about conversations
themselves (`docs/npc-conversations.md` §6). The authored sequence keeps its
stable ID in content for identity and history even though normal play can no
longer reach it.

## 9.1 Completion presentation is one-shot, not persistent idle

`MissionDialogue.completionPresentationDialogueId` is narrowly-scoped one-shot UI presentation shown immediately after the authoritative completion succeeds (via the transient open-conversation override in `features/npc/NpcConversation.tsx`). After that conversation closes, later talks route to ordinary completed-story dialogue (the newest authored `completedNpcDialogue`), not a replay of the reward beats. A refresh/reopen after completion likewise routes to ordinary story dialogue — no durable pending-presentation persistence exists. Ordinary future missions should author new post-completion dialogue instead of reusing the presentation as idle.

## 10. Mission guidance

Mission guidance answers one question for UI consumers — *"is this entity / control currently a mission-guidance target?"* — without consumers inspecting mission IDs, objective prose, or drop tables. Every guidance consumer reads the same derived set via `deriveMissionGuidanceTargets(state.missions)`. This section is the one authoritative semantic model for Mission guidance across NPC interaction, Local Place entrances, and the Map; other docs (`docs/travel-map-design.md`, `docs/design-system.md`) point back here rather than repeat it.

The Issue #145 Play split does not change these semantics: the primary
Location/Journey composition consumes the existing semantic guidance targets
through the Mission Objective panel and feature-owned affordances. The
dedicated Map (Issue #143) additionally renders explicit MISSION / TURN IN
markers for the same World Location targets — see the Map hexes consumer
below and `docs/travel-map-design.md`.

### Three semantic meanings

| Meaning | Value / CSS treatment | What it signals |
| --- | --- | --- |
| **Mission available** | `"available"` — `.rs-mission-available`, blue/cyan (`--rs-mission-available-*`) | "There is a new mission here." An NPC's authored offer is currently available. Local discovery only. |
| **Accepted mission progression** | `"active"` — `.rs-mission-guidance`, neon green (`--rs-mission-guidance-*`) | "This interaction advances the mission you accepted." The active objective's target (a remote World Location, a Local Place entrance, an NPC, an equipment affordance, or an authored recommended action). |
| **Mission turn-in** | `"turn_in"` — shares `.rs-mission-available`'s blue presentation, own `mission-turn-in` halo tone, `data-mission-guidance="turn_in"` | "The work is done — hand it in." Every authored requirement holds and only the final handoff remains, wherever it is currently authored to happen. |

Available and turn-in share blue presentation but stay distinct semantic domain values (`MissionGuidanceMeaning = "active" | "turn_in" | "available"`); **presentation colour never defines domain state.** `data-mission-guidance` always names the real value, both on beveled controls and on Map hexes.

Every meaning is a static treatment (no animation) and uses a shared-class approach — no per-component green/blue classes. Tokens and classes live in `app/globals.css`. Consumers set `data-mission-guidance="available" | "active" | "turn_in"`.

Beveled controls cannot paint their own exterior glow (`.rs-bevel`'s clip-path clips it), so a guided `ActionButton` is always a `components/ui/MissionActionButton` and a guided `ActionLink` a `MissionActionLink`: the control keeps the ordinary dark control surface with Mission-coloured text and a 2px inset edge ring (never a tinted interior), and the shared unclipped `MissionGuidanceHalo` wrapper paints the exterior halo from the same tokens (`data-halo="mission-active" | "mission-turn-in" | "mission-available"`). Non-beveled surfaces such as hub Mission entries apply the classes directly. See `docs/design-system.md`.

**Deterministic precedence when a control could carry more than one meaning.** Active green wins over turn-in blue, which wins over available blue (`npcGuidanceMeaning`, `localPlaceGuidanceMeaning` in `game/domain/missions.ts`) — accepted work first, then an accepted Mission's own handoff, then a new offer. Precedence only resolves which single meaning one control presents; every underlying fact stays in `MissionGuidanceTargets` (below). CSS also guarantees green wins when `.rs-mission-available` and `.rs-mission-guidance` coincide on the same element.

### Available guidance (blue, `"available"`)

Derived in `game/domain/missions.ts` (`deriveGuidance`) as `MissionGuidance.availableNpcIds`:

- A mission advertises when it is `not_accepted`, not completed, and its prerequisite (if any) is **satisfied**: **every** offer whose `locationId` matches the player's current location contributes its `npcId`. No `offers[0]` shortcut — all authored offer locations are covered. This is exactly the condition under which the conversation hub lists the offer, so the NPC's Talk control and the hub's AVAILABLE entry always agree.
- An **unsatisfied** prerequisite means no offer and no availability anywhere. A prerequisite is an eligibility rule, not a reveal mechanism.
- Availability is **local discovery only** — "this person has work for you." It lights the offering NPC's Talk control and that NPC's Mission entry in the hub, and nothing else: an available mission does **not** appear in the Mission Log or HUD objective, and contributes **no** map, hex, route, or destination guidance — never a World Location, never a Local Place entrance. Those handoff surfaces derive from accepted (active or turn-in) state only.
- Continuation missions are unaffected: they arrive already accepted via their predecessor's authored `continuationMissionId` (§3.1), so in normal play they are never in the available state.

**Keep the three meanings separate.** "Wade has work for you" is local discovery (blue `available`, unaccepted, offering NPC only) and never becomes a World Location, Local Place, or map target. "Go to The Jag" is active progression (green `active`). "Take this to Tansy" is the turn-in handoff (blue `turn_in`), which begins the instant every requirement holds — not when the turn-in command becomes executable (§7). They must not share semantics merely because two of the three happen to share a colour.

### Active and turn-in guidance (green work, blue handoff)

Derived from the **first unmet requirement in authored order** on each accepted-but-incomplete mission (`active` / `ready_for_completion`), or from the authored turn-in once every requirement holds:

| First-unmet kind | Guidance target |
| --- | --- |
| *(all requirements satisfied — turn-in phase)* | `npcId: turnIn.npcId`, flagged `turnIn: true` — the turn-in NPC is the target even while the character is busy (§7). While the character is still elsewhere, `locationId: turnIn.locationId` (also flagged `turnIn: true`) is the target instead; arriving hands off to the NPC (and its Local Place entrance, if any) |
| `at_location` | `locationId: requirement.locationId` — unsatisfied means the player is elsewhere, so the location itself is the target; once satisfied it stops being a target anywhere |
| `equipped_item` | `equipmentItemId: requirement.itemId` — the equipment affordance / inventory tile for that item |
| `tracked_activity` / `carried_stack` (with `recommendedActionId`) | `actionId: requirement.recommendedActionId`, plus `locationId` naming the single World Location offering that action (`actionDestination`) when it cannot currently be done — none when the current location already offers it, none when zero or several World Locations do |
| `repair_target_complete` | `repairTargetId` — that repair surface is the current target, plus the World Location while the player is elsewhere and then the Local Place entrance hosting it, if it has one. The repair surface selects the advancing affordance (contribute materials vs start Welding) from authoritative repair/material/Welding substate. **Exception:** while the recipe still needs material the player carries none of, there is no guidance at all — see §5.1 |
| `npc_conversation` | `npcId: requirement.npcId` — the person to go and meet, reusing the same NPC-boundary guidance (`npcBoundaryGuidance`) the turn-in NPC uses. While the character is elsewhere, `locationId: requirement.locationId` is the target instead; arriving hands off to the NPC |
| *(carried requirement with no `recommendedActionId`)* | no guidance at all (see Ambiguous acquisition, below) |

**Generic World Location → Local Place → interaction handoff.** Guidance resolves in narrow steps, derived purely from authored data, never from mission IDs or prose:

1. **World Location elsewhere** (`guidance.locationId`) — an unsatisfied `at_location` requirement targets its own location; an unsatisfied `npc_conversation` requirement targets its authored location while the player is elsewhere; the turn-in targets `turnIn.locationId` while elsewhere; a `recommendedActionId` requirement targets the single World Location offering that action.
2. **Local Place entrance at the current location** (`guidance.localPlaceId`) — once the World Location step is resolved (or was never needed), if the NPC target (turn-in or `npc_conversation`) is the authored resident of a Local Place at the player's **current** World Location, that NPC does not appear on screen until the player steps inside, so the place's **Enter** control carries the guidance until then (`npcGuidance`). Derived purely from authored NPC placement — no mission IDs or prose — so any future Local Place resident works automatically.
3. **NPC / equipment / action** — once inside (or immediately, for a target with no Local Place), the NPC's own Talk control, the equipment affordance, or the authored action becomes the target.

Arriving at a step removes that step's guidance and hands off to the next; the player's current World Location, and a Local Place the player has already entered, never themselves carry a target once their handoff is complete. This handoff applies to accepted progression (green) and turn-in (blue) alike, and turn-in entrances are their **own** blue target (`turnInLocalPlaceIds`) — distinct from an active target's green entrance (`localPlaceIds`) even when it is the same physical door. Available (blue) offers never guide a door or a World Location — availability remains local discovery only (see above).

### Ambiguous acquisition never invents guidance

A `carried_stack` or `tracked_activity` requirement authored **without** a `recommendedActionId` gets no guidance at all when it is the first unmet requirement — not a location, not an action, nothing. Several legitimate acquisition sources with no single authored route means the framework never picks one for the player. Keep the Change's Power Cell requirement is the proof case: once Bix's mandatory `npc_conversation` is satisfied, three Power Cells may still come from Inventory, the Annex, or Bix's shop — nothing glows anywhere until the player unambiguously carries the required quantity and only the turn-in remains.

### No new persistence

Guidance is derived entirely from existing Mission records and requirement progress (§2, §5) on every projection — no visited-location, reached-objective, or turn-in-readiness row is added anywhere. A World Location or Local Place target disappears the instant the character's authoritative current location/placement matches it, and the turn-in phase begins the instant `requirementsSatisfied` holds (§7); both are computed fresh on every read, never latched client- or server-side.

### Teaching intent (`recommendedActionId`)

`recommendedActionId` on a `carried_stack` or `tracked_activity` requirement expresses **teaching / recommendation intent** — which gameplay interaction this mission is intentionally guiding the player toward. Carried-item recommendations are distinct from requirement truth (which observes carried quantity regardless of provenance) and are **validated against the action's authoritative output facts** (`getActionOutputItemIds` in `game/domain/action-outputs.ts`, which derives directly from the gameplay resolvers' award facts `miningAwardFacts` / `refiningAwardFacts`). Tracked-activity recommendations are validated against the authored activity. Changing what an action authoritatively produces cannot leave mission-guidance validation stale, and the generic action registry is intentionally not widened beyond this narrow capability check.

Not every technically possible acquisition path should be highlighted. Only the authored `recommendedActionId` on the current unmet carried requirement is highlighted. Cut Your Teeth recommends `ferrite_shale_mining` — Scavenge also yields Ferrite Shale, but has no `ActionId` to author there and is never highlighted merely because it can produce the same item.

### Consumers

Each consumer answers "am I that target, and with which meaning?":

- **NPC Talk** — `npcGuidanceMeaning(targets, npc.id)` resolves `"active"` (`guidance.npcIds`), `"turn_in"` (`guidance.turnInNpcIds`), or `"available"` (`guidance.availableNpcIds`), with active-over-turn-in-over-available precedence. Each Mission entry inside the conversation hub reuses the same projected guidance (`docs/npc-conversations.md` §4), so the control and the entry can never disagree.
- **Cutter Inventory tile / Equipment "Equip in slot"** — `guidance.equipmentItemIds.has(itemId)` (green only; the turn-in phase never targets equipment).
- **Start Mining / Start Refining** — `guidance.actionIds.has(actionId)` while the action is currently relevant/available (green only). An action highlights only when its `ActionId` is the authored `recommendedActionId` on the current unmet carried requirement.
- **Repair targets** — `guidance.repairTargetId` while an accepted mission's current objective observes that repair's completion (green only). The repair surface owns the repair/material/Welding substate and guides exactly one advancing affordance: CONTRIBUTE MATERIALS while materials are still needed (and a contribution is possible), START WELDING once materials are complete and Welding is idle. STOP WELDING is never guided — stopping does not advance the mission. A target inside a Local Place also guides that place's entrance until the player steps inside, exactly as an NPC resident does. Completed repair clears the target and the generic projection moves guidance to the turn-in handoff.
- **Local Place Enter** — `localPlaceGuidanceMeaning(targets, place.id)` resolves `"active"` (`guidance.localPlaceIds`) or `"turn_in"` (`guidance.turnInLocalPlaceIds`) on an open place's Enter control, via `MissionActionLink`.
- **Map hexes** (`features/travel/LocalMapPanel.tsx`) — a World Location hex in `guidance.locationIds` shows a green MISSION plate and ring; one in `guidance.turnInLocationIds` shows a blue TURN IN plate and ring; a hex in both shows both plate texts, with the ring following the same active-over-turn-in precedence. See `docs/travel-map-design.md` for the presentation contract; this document owns only the semantics.

`MissionGuidanceTargets` is the union across all missions: `availableNpcIds`, `npcIds`, `turnInNpcIds`, `localPlaceIds`, `turnInLocalPlaceIds`, `locationIds`, `turnInLocationIds`, `equipmentItemIds`, `actionIds`, `cargoRepair`.

### Play Mission strips (Issue #174)

The in-Play Mission surface is a compact stack of strips rendered once, as the
first content under the Play header, by `features/missions/MissionGuidanceStrips.tsx`
from `PlayConsole` — so it leads Location, Local Place, Journey, and Map alike.
It is ordinary document flow (never sticky or fixed) and scrolls away normally.

- One strip per accepted, non-completed Mission (`active` /
  `ready_for_completion`) in the authoritative Mission order; unaccepted,
  available, and completed Missions never appear, and an empty stack renders
  nothing. There is no selected, tracked, or primary Mission.
- Each strip's colour is its semantic phase, `missionGuidancePhase(projection)`
  (`game/domain/missions.ts`): `work` (green, `.rs-mission-guidance`) while an
  authored requirement remains, `turn_in` (blue, the shared blue treatment)
  once every requirement holds — the same fact as `guidance.turnIn`, so the
  strip stays blue while the player is remote, busy, or has arrived. A text
  phase label (Active / Turn in) keeps colour from being the only signal.
- Content comes from the projection only: title, the current objective, and
  any other still-unmet requirement with numeric progress (so simultaneous
  requirements such as Mining attempts and a Ferrite Shale stack stay visible).
  It is not the Mission Log, which keeps the full checklist.
- A strip is a status row, not an interaction target: it exposes
  `data-mission-phase="work" | "turn_in"` and never `data-mission-guidance`,
  which stays reserved for the controls and places a player acts on.
- Strips are informational: no click-to-track/select/open-Log, no collapse.
  The pre-existing Open Equipment shortcut stays inside the strip whose Mission
  currently targets equipment.

## 11. Explorer-first behavior

**Walk It Off can simultaneously advertise both Wade (Crash Site) and Tansy (The Jag) as available mission interactions.**

This is intentional. The mission authors no prerequisite and two real offer routes (Wade at the Crash Site and Tansy at The Jag) so a player who walks straight to The Jag meets Tansy first without missing the starter mission. Availability guidance is derived from every currently relevant authored offer at the player's current location (§10).

Cut Your Teeth authors a prerequisite but is never advertised in normal play — it arrives as Walk It Off's authored continuation (§3.1), already accepted, with its live objectives projected immediately.

Keep the Change shows the third shape: prerequisite-gated **and** manually
accepted. Hold It Together names no continuation, so nothing auto-accepts it.
Once Hold It Together is completed, Wade advertises it **locally**: standing at
the Crash Site, his Talk control and the KEEP THE CHANGE — AVAILABLE entry in
his hub glow blue. Nothing advertises it anywhere else — no Mission Log entry,
no map or route guidance toward Wade — so the player discovers it by going back
to the person who would plausibly hand it out, not by a global reveal.
Accepting it removes the blue and hands off to green progression (meet Bix).

## 12. Server authority / generic commands

The browser submits only **narrow mission intent / identity** through the existing command boundary:

```ts
// game/schemas/gameplay.ts
type AcceptMissionRequest  = { characterId: string; missionId: string; npcId: string };
type CompleteMissionRequest = { characterId: string; missionId: string; npcId: string };
type AcknowledgeMissionConversationRequest = {
  characterId: string; missionId: string; npcId: string; dialogueId: string;
};
```

Wired as `acceptMissionAction` / `completeMissionAction` / `acknowledgeMissionConversationAction` in `server/actions.ts` and executed as `acceptMission` / `completeMission` / `acknowledgeMissionConversation` in `server/missions.ts`.

Every other rule is **re-read and revalidated server-side inside the character transaction**:

- unknown `missionId` / `npcId`;
- prerequisite completion;
- authored offer route for acceptance (`definition.offers.find(npcId)`);
- stationary presence at `offer.locationId` (acceptance) or `turnIn.locationId` (completion);
- NPC identity for turn-in;
- every authored requirement against live state (`at_location`, `equipped_item`, `tracked_activity` current progress, and `carried_stack` with the authoritative carried quantity);
- for consumed carried requirements, an exact pure removal plan via the inventory planner without mutating rows (§6);
- for item rewards, a **post-consumption preflight**: plans are applied cumulatively to an in-memory candidate inventory and the reward's capacity is checked against that post-consumption candidate — consumption may legitimately free the slot or mass the reward needs;
- only after the complete plan is valid, consumption through the authoritative carried-stack boundary, the single declared reward, the guarded `completedAt` stamp, and the authored continuation acceptance (if any, idempotent via `onConflictDoNothing`) commit in the same transaction; any failure (insufficient quantity, capacity still blocked, reward application error) leaves the whole transaction uncommitted;
- resolved Mining and Refining attempts are handed from the activity resolver to generic mission progress in the same transaction, after activity persistence and before the action cursor advances. Attempts before acceptance reconcile while no mission progress row is active and receive no credit; no per-attempt timestamp or event ledger is added;
### 5.1 Repair phases (issue #172)

A repair job has real stages, and the generic requirement projects the one the
player is actually in, from the authoritative repair record and the target's
authored recipe — never from the Mission's identity:

| Phase | Condition | Objective | Guidance |
| --- | --- | --- | --- |
| materials | some authored material is short | `materialObjective`, with `{item}` / `{contributed}` / `{required}` | the repair target **only if the player carries a useful unit of an outstanding material**; otherwise none |
| welding | every material installed, welds outstanding | `weldingObjective`, with `{current}` / `{target}` | the repair target |
| complete | `completed_at` present | the requirement holds; the Mission is in its turn-in phase | the turn-in NPC |

`{contributed}` is **durably installed material**. Carried stacks, Cargo Hold
contents, and material the player could go and acquire are never counted: the
observation is built from the repair record, which has no access to inventory.
Carried quantity may appear as a `detail` line ("Carrying: 6 Refined Ferrite")
— rendered subordinate to the objective precisely so it can never read as
progress or be added to it.

The silent-guidance case follows the same principle as a carried requirement
with several legitimate sources: Refined Ferrite can be refined, bought, or
scavenged, so the framework refuses to invent one of them as a destination, and
the Mission Log's `{contributed} / {required}` carries the objective on its own.
Carrying even one useful unit makes the repair target worth walking to again,
and guidance returns.

A Mission that authors no phase copy — Hold It Together — renders its plain
`objective` in every phase, exactly as before.

- Repair completion is read from `character_repair_targets.completed_at` for `repair_target_complete`; the mission framework does not consume repair materials, advance Welding, or maintain a second repair-progress representation;
- the durable conversation marker is read for `npc_conversation`; the completion command never satisfies it as a side effect;
- the character lock (`withResolvedOwnedCharacter` / `runMissionCommand`) plus the `completedAt` `isNull` guard make acceptance and completion — and therefore consumption, reward, acceptance effect, and continuation — exactly-once under retries and concurrent first completions.

### 12.3 The mandatory-conversation command

`acknowledgeMissionConversation` runs on the same lock/reconciliation wrapper as
acceptance and completion. The browser reports only which mission, NPC, and
authored sequence it just played; the command revalidates everything else:

- the mission exists, is accepted, and is not already completed;
- the definition genuinely authors an `npc_conversation` requirement for
  **exactly that NPC and that dialogue** — so credit can never be claimed for
  another person, another scene, or a social topic;
- the character is stationary at the requirement's **authored** `locationId`
  (never the NPC's `homeLocationId`), so the introduction has to actually
  happen in person;
- the marker is then set to its capped value. A replayed scene, a retried
  request, and concurrent requests all converge on the one satisfied row
  (`already_acknowledged`), so the event cannot happen twice.

**Acceptance effects are exactly-once by the same construction.** The mission
rows are locked and an existing accepted/completed row short-circuits before the
insert, so `MissionOffer.acceptEffect` (§8.1) is applied only in the branch that
creates the acceptance stamp. A concurrent duplicate blocks on that lock and then
sees the accepted row, so Wade's 24 Credits are granted once even under retries,
reloads, replayed dialogue, or parallel requests. Integration coverage asserts
this directly.

Do not document or introduce client-authoritative shortcuts. The client never supplies required items, quantities, `consume` behavior, rewards, prerequisite status, or completion eligibility.

### 12.1 One-time Waste Not backfill

The Issue #141 maintenance script is separate from normal runtime acceptance. It is dry-run by default, emits a reviewed cohort report, and requires an explicit confirmation token plus an unchanged report for execution. The eligible cohort is stationary characters with completed Walk It Off and Cut Your Teeth rows and no Waste Not row. Characters with an active action are reported and skipped. Execution inserts Waste Not and its `refining-attempts` row at `0 / 5`, grants no historical credit, and is idempotent. Rerun it after skipped characters are stationary; no permanent legacy branch is added to mission runtime.

### 12.2 One-time Hold It Together continuation backfill

The Issue #148 maintenance script is separate from normal runtime continuation. It is dry-run by default, emits a reviewed cohort report, and requires an explicit confirmation token plus an unchanged report for execution. The eligible cohort is characters with completed Waste Not and no Hold It Together row. Execution inserts only an accepted Hold It Together row; it never completes the mission, creates a progress row, grants the mission reward, consumes materials, changes Welding or Cargo repair state, or alters storage. Population and character locks, a serializable transaction, an execution-time cohort recheck, post-commit verification, and `ON CONFLICT DO NOTHING` keep the repair narrow and idempotent. No permanent legacy branch is added to mission runtime.

## 13. Authoring an ordinary new mission

An ordinary mission is one that uses already-supported semantics: authored content plus the generic projection / routing / guidance / generic commands (§2). It should not require server, wiring, or client routing changes to adopt.

### Checklist

An ordinary mission using existing semantics should generally require:

1. **Identity and presentation** — stable mission/dialogue IDs, title, and summary; add only genuinely needed item/NPC/location/action IDs.
2. **Discovery semantics** — prerequisite versus explicit continuation, whether the mission is manually discoverable, and every authored offer route or immediate post-acceptance continuation.
3. **Ordered requirements and guidance** — requirement order, live-state versus tracked-activity semantics, stable tracked key/positive target where applicable, and recommended action guidance.
4. **Turn-in semantics** — NPC, location, stationary requirement, objective copy, and whether the turn-in is distinct from any requirement location.
5. **Reward and presentation** — exactly-once reward shape, capacity/refusal behavior where applicable, and the one-shot completion presentation.
6. **Active dialogue ownership** — offer-NPC active follow-up, turn-in reminders/busy dialogue, and `activeNpcDialogue` for relevant off-path/revisit NPCs who need contextual state while the mission is active.
7. **Persistent story state** — `completedNpcDialogue` for every relevant NPC, including which later mission should supersede that dialogue so completed story state cannot regress.
8. **Persistence rollout** — migration ownership, acceptance/continuation initialization, existing-character migration or backfill behavior, and idempotence/rollback expectations.
9. **Manual preview checks** — refresh/reload, partial progress, success and failure attempts, stopped/restarted activity, turn-in gating, exactly-once reward, completion presentation close, and post-completion revisits to relevant NPCs.
10. **Focused automated coverage** — definition validation, projection/guidance precedence, active/completed routing, persistence/concurrency at the correct integration layer, and the complete player journey when a new mission changes it.

### It should not normally require

- a new bespoke server completion transaction,
- a new mission-specific server command or request schema,
- edits to generic mission projection (`game/domain/missions.ts`) or the NPC conversation resolver (`game/domain/conversation.ts`),
- mission-ID branches in React (`features/…`),
- parsing objective or dialogue prose to determine gameplay rules,
- new mission-specific guidance CSS.

### Warning

> If an ordinary mission using already-supported semantics seems to require mission-ID checks in UI, a bespoke accept/complete transaction, or prose parsing, stop and inspect whether the framework is being bypassed.

That pattern is a signal that authored content (offers, requirements, turn-in, dialogue mapping, guidance targets) is not carrying the semantics it should, or that guidance/conversation routing is being special-cased instead of consumed through `deriveMissionGuidanceTargets` / `resolveNpcConversation` / `MissionProjection.stage`.

When in doubt, favour adding or correcting authored mission content and reusing the existing semantic paths over introducing mission-specific code.

## 14. Current limitations

The framework currently models **one live-state phase** per mission. Requirements observe current authoritative state (§5), while tracked activity requirements persist only a capped current value keyed by character, mission, and authored `progressKey`. This keeps ordinary missions simple, but the following progress shapes are **not yet modelled** and must earn an explicit framework extension when a real mission needs them:

- **Multi-location history** such as "visit A → visit B → return to A" when the visits leave no durable evidence in current state (e.g. two `at_location` steps that would both already be satisfied by the current location).
- **Arbitrary dialogue memory.** One shape is now modelled: a single authored
  mandatory conversation per NPC, marked durably by the `npc_conversation`
  requirement (§5, §9.2, §12.3). That is a concrete gameplay requirement, not
  conversation history — nothing records which optional topics were read, in
  what order, or how often. Branching dialogue, remembered answers, and
  multi-step conversation chains remain unmodelled.
- **NPC relocation based on mission progression** — mission location semantics are intentionally authored on the definition, not derived from `npc.homeLocationId`, so a future NPC-movement feature does not inherit an accidental invariant, but movement itself is not yet implemented.
- **Arbitrary persistent per-step ledgers** beyond the narrow tracked-attempt contract (timestamps, event history, flags, provenance, or lifetime counters like "shale mined since acceptance" — current carried-stack requirements intentionally count any carried quantity (§5–§6)).
- **Branching, repeatable, or timed mission systems.**
- **Persistent multi-stage missions.** A mission surface shows all requirements of the **current stage/leg** but never future-stage objectives. The current production framework is one stage, so authored requirements form the current simultaneous requirement set. A future mission with genuinely sequential legs (e.g. deliver one material set, then receive a new objective elsewhere) earns a deliberate multi-stage extension then — not speculatively now.

The current requirement/projection vocabulary was kept reusable so a future narrow phase wrapper (`mission → phase → same requirements / dialogue / guidance vocabulary`) can layer on top without rewriting the existing missions, and mission location semantics already avoid the `homeLocationId` derivation trap.

Future real requirements should extend the framework deliberately — a narrow, validated content + projection + guidance extension with focused coverage — rather than adding mission-specific hacks (bespoke transactions, ID branches, or prose parsing) around the current one-phase boundary.

## Examples

Short concrete examples that demonstrate the framework vocabulary. Do not copy mission-specific IDs as a pattern — the point is the vocabulary, not the IDs themselves.

### Walk It Off — travel-and-talk

- **Offers:** two authored routes (Crash Site + The Jag) so explorer-first remote acceptance just works (§4 / §11).
- **Requirements:** one `at_location: The Jag`. Walk away and the objective regresses — projection is live.
- **Turn-in:** `Tansy` at `The Jag`, stationary only. No duplicated `at_location: The Jag` requirement needed for eligibility (§7). `turnIn.objective: "Talk to Tansy Rusk"`.
- **Reward:** one `item` — the Salvage Cutter. Registry validates it is a unique item because the generic completion path executes only that shape (§8).
- **Continuation:** `continuationMissionId: cutYourTeeth` (§3.1). Completing Walk It Off atomically accepts Cut Your Teeth — no second acceptance click.
- **Dialogue:** offer sequences plus `completionPresentation` (`tansyAfterClaim`, which presents the already-granted Cutter via an `item` beat) and `capacitySlots` / `capacityMass` refusal branches that the server selects generically after a `capacity` refusal. The Cutter claim's `Claim Cutter` control copy is authored on `turnIn.actionLabel`, not on the sequence.
- **Guidance + explorer-first:** no prerequisite, so at Crash Site blue targets Wade and at The Jag blue targets Tansy — each derived from the matching authored offer at the current location while not yet accepted.

### Cut Your Teeth — equip-and-collect

- **Prerequisite:** `walkItOff` must be `completed` before it can be accepted. Not advertised in normal play: it arrives already accepted via Walk It Off's continuation (§3.1).
- **Offer:** single `Tansy` at `The Jag` (`tansyCutYourTeethOffer`) remains for eligibility/acceptance validation. Normal play never shows it as Available; if it is ever unaccepted with Walk It Off completed (e.g. after an operator reset), Tansy advertises it locally like any eligible offer (§10). Unaccepted Cut Your Teeth never appears in the Mission Log or HUD.
- **Requirements (ordered, shown simultaneously):** `at_location: The Jag` → `equipped_item: salvageCutter` → `tracked_activity: mining-attempts` for five attempts → `carried_stack: ferriteShale` with omitted `quantity` (full authoritative stack, currently `10`), `turnIn: "show"`, `recommendedActionId: ferrite_shale_mining`. Player-facing surfaces render all four together with live satisfaction/progress (e.g. "✓ At The Jag / ✓ Equip Salvage Cutter / Mining attempts — 3 / 5 / Ferrite Shale — 4 / 10"), while `stage.nextObjectiveKind` keeps the first-unmet ordering for dialogue/guidance precedence. The stack is shown, never consumed (§6).
- **Teaching intent:** the tracked requirement highlights `Start Mining` while it is the current objective (§10), and the carried step retains the same recommendation if attempts are complete but the stack is not. Mining success and failure both count; Scavenged shale still satisfies the carried requirement (§5).
- **Turn-in:** `Tansy` at `The Jag`, stationary only; `stage.turnInAvailable` distinguishes "I carry 10 but I'm still mining" (busy) from "ready to show" (§7). The turn-in conversation carries `complete_mission` with the authored `SHOW SHALE` copy; the `skill_xp` reward (+100 Mining) and `item` beat are presentation only after the authoritative success.
- **Dialogue stage routing:** `equipmentReminder` vs `carriedReminder` vs `busy` vs `completionPresentation` vs `turnIn` selected semantically from `stage.nextObjectiveKind` / `requirementsSatisfied` / `turnInAvailable` — never from prose.

### Waste Not — continuation-only tracked activity

- **Acceptance:** `offers: []` is valid because Cut Your Teeth authors `continuationMissionId: wasteNot`; there is no manual acceptance route or mission-ID branch in acceptance logic.
- **Requirement:** one generic `tracked_activity` requirement with stable `progressKey: "refining-attempts"`, `activity: "refining"`, `metric: "attempts"`, target `5`, and a recommended Refining action. Successes and failures both count, and no live Processing Yard requirement is added to the mission.
- **Turn-in / reward:** five current attempts make the mission ready only at the stationary Crash Site turn-in with Wade. Completion grants +100 Refining XP; Refining's existing output, Shale consumption, and inventory behavior remain unchanged.
- **Persistence:** acceptance and continuation initialize the current progress row at zero. The resolver hands authoritative resolved-attempt counts to the generic mission progress boundary in the same transaction. Target/activity definitions remain authored content, not persistence data.

### Hold It Together — continuation-only Cargo repair

- **Acceptance:** `offers: []` is valid because Waste Not authors `continuationMissionId: holdItTogether`; completion of Waste Not accepts Hold It Together atomically with no second acceptance click. The Issue #148 pre-beta repair accepts the same mission row only for characters with completed Waste Not and no existing Hold It Together row.
- **Requirement:** one generic `repair_target_complete` requirement observes the Cargo Hold's `character_repair_targets.completed_at`. It has no `characterMissionProgress` row, Welding counter, material requirement, provenance rule, or historical backfill.
- **Repair boundary:** an accepted Hold It Together unlocks incomplete repair contribution and Welding start. Completed Cargo Holds remain usable regardless of mission state, while Cargo storage still requires authoritative repair completion. Cargo owns the 15 Refined Ferrite + 6 Slag recipe, consumption, Welding timing, per-increment XP, and capacity.
- **Turn-in / reward:** the repaired Hold makes the mission ready for Wade at the stationary Crash Site turn-in. Completion grants a separate +100 Welding XP exactly once; existing repair XP is never replayed.

### Keep the Change — apprenticeship, a paid-up-front budget, and a required introduction

- **Acceptance:** the first mission that is neither open discovery nor a continuation. `prerequisiteMissionId: holdItTogether` gates eligibility and Hold It Together names no continuation, so the player must go back to Wade and take the job (§3.1, §11). One offer route: Wade at the Crash Site, `actionLabel: "TAKE THE JOB"`.
- **Acceptance effect:** `acceptEffect: { kind: "credits", amount: 24 }` (§8.1) — the retail price of three Power Cells from Bix, granted exactly once with the acceptance stamp. Unspent Credits are never reclaimed and nothing is reimbursed.
- **Requirements (ordered):** `npc_conversation` with Bix at Holo Hollow → `carried_stack: powerCell` (`quantity: 3`, `turnIn: "consume_required_quantity"`). Meeting Bix stays first even for a player already carrying Cells, because the introduction is the point; buying is never required, and the Cells may come from inventory, the Annex, or the shop — carried quantity is observed regardless of provenance (§5–§6). No `recommendedActionId`: no gameplay action authoritatively produces Power Cells.
- **Reward:** none (§8). The outcome is world/social state — HH B&B becomes enterable because the Mission is completed, derived from that record rather than a second persisted unlock flag (`docs/gameplay-foundations.md`, Local Places).
- **Dialogue:** Wade's offer scene carries the post-repair beat and the apprenticeship itself, with Tansy interrupting over comms from the seam (per-beat `speakerNpcId` + `presentationMode: "comms"`); Bix's required scene hosts Mara as an authored guest speaker in his own sequence; Tansy authors `conversationReminder` → `carriedReminder` → `busy` → turn-in → completion presentation.
- **One-time encounter:** the Bix/Mara scene disappears from Bix's hub once the requirement holds and is never replayable (§9.2), while Bix's ordinary topics continue as normal.

### Out of the Weather — the first optional side Mission

- **Acceptance:** `prerequisiteMissionId: holdItTogether`, the same prerequisite Keep the Change has, so the two branch in parallel. One offer route: Renn Calder at Holo Hollow, `actionLabel: "I'LL FIX IT"`. It names no continuation, nothing continues into it, and nothing lists it as a prerequisite — so it is **never** on any main-story path and completing or ignoring it changes nothing upstream (§3.1, §11).
- **Optionality is structural, not documented.** Availability is local discovery through Renn only (§10), and the Mission Log renders accepted/completed Missions, so a satisfied prerequisite alone puts nothing in front of the player. No framework change was needed for any of that.
- **Acceptance effect:** none. This Mission costs the player rather than funding them.
- **Requirement:** one `repair_target_complete` observing the Crew Stop (§5), with authored phase copy (§5.1): "Install Refined Ferrite at the Crew Stop — {contributed} / {required}", then "Weld the Crew Stop — {current} / {target} welds". Guidance runs Holo Hollow → the Crew Stop's Local Place entrance → the repair surface once the player carries useful Refined Ferrite, stays silent while they carry none, and hands off to Renn's turn-in the moment the repair completes.
- **Reward:** `{ kind: "skill_xp", skillId: welding, amount: 250 }` (§8), on top of the 500 Welding XP the ten genuine increments already paid through the ordinary Welding path. No synthetic work XP and no Credit payout: the durable reward is the repaired shelter and the Crew Hauler ride it earns (`docs/gameplay-foundations.md`, travel modes).
- **Dialogue:** Renn authors the offer, the repair reminder, busy, the turn-in, the completion presentation (which carries the authored skill-XP beat), and post-completion story dialogue. The player stays silent throughout.
