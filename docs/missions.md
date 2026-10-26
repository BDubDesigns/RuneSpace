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
| Tracked activity progress | `db/rune-space.ts` — `characterMissionProgress`; `server/mission-progress.ts` — row initialization, capped attempt consumption, the mandatory-conversation marker, and Fabrication outcomes with their reactive facts (`recordFabricationOutcomes`, #232) | One row per character, mission, and stable authored `progressKey`; only current progress is persisted. `tracked_activity` and `npc_conversation` requirements, and reactive facts (§9.3), share that one row shape and one progress-key space. There is no event history, provenance, lifetime counter, or acceptance-time slicing. Repair completion is observed separately from its authoritative `character_repair_targets` row and never creates mission progress. |
| Generic acceptance / completion boundary | `server/missions.ts` — `acceptMission`, `completeMission`, `acknowledgeMissionConversation` (+ `completeMissionWithDefinition` test seam); `server/actions.ts` — `acceptMissionAction` / `completeMissionAction` / `acknowledgeMissionConversationAction`; `game/schemas/gameplay.ts` — `AcceptMissionRequestSchema` / `CompleteMissionRequestSchema` / `AcknowledgeMissionConversationRequestSchema` | Shared `runMissionCommand` character lock / reconciliation wrapper. See §12. |
| Authored dialogue | `game/content/dialogue.ts` — `DIALOGUE_SEQUENCES` / `getDialogue` | Sequences are pure presentation content (no `action`). |
| NPC conversation resolution | `game/domain/conversation.ts` — `resolveNpcConversation`, `NpcConversationEntry`, `getMissionCapacityRefusalDialogue`, `getMissionCompletionPresentation`; authored topics in `game/content/conversation-topics.ts` | The one canonical conversation model (§9); see `docs/npc-conversations.md`. |
| Mission pinning (presentation preference, #325) | `db/rune-space.ts` — `characterMissionUnpins`; `server/mission-pins.ts` — `loadUnpinnedMissionIds`; `server/mission-pin-commands.ts` — `setMissionPinned`; `server/actions.ts` — `setMissionPinnedAction`; `game/schemas/gameplay.ts` — `MissionPinRequestSchema`; `features/missions/mission-pins.ts` — `guidanceMissions`, `isMissionPinned`, `pinnedGuidanceMissions`, `guidancePresentationMissions`, `derivePinnedGuidanceTargets`, `presentConversationEntries` | Absence means pinned; only an explicit unpin is stored, keyed by character and Mission and cascading with the Mission record. Surfaced as `state.unpinnedMissionIds`. Never read by projection, dialogue routing, completion, or rewards; read only by the presentation selection (`guidancePresentationMissions`, `derivePinnedGuidanceTargets`, `presentConversationEntries`) that decides which accepted Missions guide the Map and UI (#335). See §10, "Mission pinning". |
| Semantic guidance projection | `game/domain/missions.ts` — `MissionGuidance`, `MissionGuidanceTargets`, `deriveMissionGuidanceTargets`; `app/globals.css` — `--rs-mission-guidance-*` / `--rs-mission-available-*` and `.rs-mission-guidance` / `.rs-mission-available` | Guidance is a derived set consumed by `NpcInteractionPanel`, `MiningActivity`, `RefiningConsole`, `EquipmentPanel`, `InventoryPanel`, `CargoHoldPanel`. |
| Item-originated offer (#369) | `game/content/missions.ts` — `MissionItemOffer`, `MissionDefinition.itemOffer`; `game/domain/missions.ts` — `itemOfferAvailable`, `MissionProjection.itemOffer`, `MissionGuidance.availableItemIds`; `server/missions.ts` — `acceptItemOfferMission`; `server/actions.ts` — `acceptItemOfferAction`; `game/schemas/gameplay.ts` — `AcceptItemOfferRequestSchema`; `features/missions/item-offers.ts`, `features/missions/ItemOfferModal.tsx`, `features/inventory/InventoryPanel.tsx` | A carried item, not an NPC, offers the Mission. All copy is content; no client or server code names an item or a Mission. See §4.1. |
| Lead conversations and the deferred stage (#369) | `game/content/missions.ts` — `MissionConversationLeads`, the `deferred_stage` requirement; `game/domain/missions.ts` — `conversationLeadFollowed`, `leadContactLocationId`, `MissionGuidance.candidates`; `game/domain/conversation.ts` — `leadConversationFor`; `server/missions.ts` — `acknowledgeMissionConversation` | Optional conversations that narrow a multi-contact objective, and an honest unfinished end. See §5.2 and §5.3. |
| Planet-local conversations and in-person item offers (#389) | `game/content/missions.ts` — `npc_conversation.appliesOnPlanetId`, `MissionOffer.requiresCarriedOfferItem` / `subject` / `declineLabel`, the `conversation_acknowledged` reactive fact; `game/domain/missions.ts` — `requirementWaived`; `game/domain/conversation.ts` (offer gating, `MissionConversationAction.declineLabel`); `server/missions.ts` — `acceptMission` (carried-stack check), `completeMissionForDefinition` (waiver); `features/dialogue/DialoguePlayer.tsx` (decline control) | A conversation needed on one planet only, and the item offer made by an NPC. See §5.4 and §4.1. |

The shared play-state assembly projects `state.missions` through the generic play boundary (`server/play.ts` `stateFromTransaction`, surfaced by `PlayContext` / `usePlay` via `features/play/PlayConsole.tsx`). That play layer is the current host for projection and is not a mission-framework contract; do not depend on its module name to reason about missions.

## 3. MissionDefinition

Current terminology (`game/content/missions.ts`):

```ts
type MissionDefinition = {
  id: MissionId;                         // stable content ID
  title: string;
  summary: string;
  prerequisiteMissionId?: MissionId;     // absent for the first mission
  prerequisiteSkillLevels?: readonly MissionSkillPrerequisite[]; // optional authored skill-level gates, see below
  continuationMissionId?: MissionId;     // zero-or-one authored continuation, see §3.1
  offers: readonly MissionOffer[];       // ≥1, or [] for a linked continuation-only mission or an item-offered one
  itemOffer?: MissionItemOffer;          // a carried item offers the Mission instead of an NPC, see §4.1
  requirements: readonly MissionRequirement[]; // ordered live-state checks
  turnIn?: MissionTurnIn;                // authoritative completion interaction; absent exactly when autoCompletion is authored
  autoCompletion?: MissionAutoCompletion; // completed by a gameplay outcome instead, see §7.1
  reward?: MissionReward;                // at most one, see §8
  dialogue: MissionDialogue;             // semantic dialogue mapping
  reactiveFacts?: readonly MissionReactiveFact[]; // narrow Mission-local story facts, see §9.3
};
```

- **Stable ID** — `MISSION_IDS` in `game/config/foundations.ts`. Referenced by persistence (`characterMissions`), projection, and dialogue routing. Never rename without a migration.
- **`title` / `summary`** — player-facing names on the mission.
- **`prerequisiteMissionId`** — when present, the referenced mission must be `completed` before this one is offered or accepted. An eligibility rule only — never a reveal mechanism (see §10–§11). Validated at module load (unknown ID or self-cycle fails fast).
- **`prerequisiteSkillLevels`** (`readonly { skillId, level }[]`, #207, widened in #209) — an optional authored list of minimum skill levels, **every** one of which must currently be met before the mission is offered or accepted. Exactly like `prerequisiteMissionId`, this is an **eligibility rule only, never a reveal mechanism**: below any listed level the mission is not advertised anywhere and cannot be accepted, including at its own offer NPC — there is no partial preview of a gated offer. Generic projection (`MissionProjection.prerequisiteSatisfied`) and the authoritative acceptance command (`acceptMission`) derive the identical answer from the identical authored content through one exported helper pair — `unmetMissionSkillPrerequisite` names the first unmet entry so a refusal can say which skill is short, and `missionSkillPrerequisiteSatisfied` is defined in terms of it. No surface holds a level literal of its own, and no mission-specific check exists in a command. Registry validation rejects a skill that does not resolve to an approved progression curve (an unknown skill ID and a skill with no curve fail the same check), a level that is not a positive integer, a level beyond that skill's own maximum authored level, and the same skill listed twice. 10,001 Hours authored the first gate (Welding 5); Brace Yourself is the first mission to need two at once (Mining 5 **and** Welding 5) — which is why the field is a flat conjunction list rather than a second Deep-Jag-specific check (see the Examples section).
- **`continuationMissionId`** — zero-or-one explicitly authored automatic continuation (§3.1).
- **`offers[]`** — one or more authored offer routes (§4), except a continuation-only mission may use an empty array only when another authored mission points to it with `continuationMissionId`, and an item-offered mission only when it authors `itemOffer` (§4.1). An unlinked, item-less, offerless definition fails validation.
- **`requirements[]`** — ordered requirements (§5) evaluated against live authoritative state on every projection.
- **`turnIn`** — `npcId` + `locationId` + `requiresStationary: true` + objective copy + `dialogueId` (§7). Mission location semantics are authored here and **never** derived from an NPC's `homeLocationId`. Absent only for a Mission that authors `autoCompletion` (§7.1) or ends at a `deferred_stage` (§5.3); validation requires exactly one of the three.
- **`autoCompletion`** — the narrow, non-NPC completion capability (#358): the named gameplay outcome stamps the Mission complete in its own transaction (§7.1).
- **`reward`** — at most one narrow reward, and optional: a mission whose real outcome is world/social state authors none (§8).
- **`dialogue`** — semantic mappings (§9). Every lifecycle moment the Mission can reach is either authored or declared in `dialogue.omitted` (§9.4).

Registry validation (`validateMissionDefinitions`) runs at module load against content + authoritative balance (NPC/location/item/dialogue existence, prerequisite shape, skill-prerequisite shape, continuation shape/cycles, stackable checks, stack limits, reward skill curve, `recommendedActionId` capability, and lifecycle dialogue coverage, §9.4). An authoring mistake never reaches a player as a silent runtime refusal.

### 3.1 Authored mission continuation

A mission may declare **zero or one** automatic continuation via `continuationMissionId`. When the mission successfully completes, the generic completion boundary atomically accepts the continuation in the same transaction (reward + completion stamp + continuation acceptance commit together; retries stay exactly-once).

Rules:

- **Explicit authoring, never prerequisite inference.** A prerequisite only says the later mission cannot begin first — it does not imply discovery or a direct narrative continuation. The predecessor must name its continuation.
- **Singular only.** No arrays, fan-out, or branching continuation choices.
- **Validated narrowly:** unknown continuation IDs, self-continuations, and cycles fail fast. The target must have no prerequisite or require the predecessor — otherwise the auto-accept would contradict the target's own eligibility rule.
- **First production use:** Walk It Off continues into Cut Your Teeth, Cut Your Teeth continues into Waste Not, and Waste Not continues into Hold It Together. Completing a predecessor accepts its authored continuation immediately; the completion presentation flows into the next assignment with no second acceptance click. Waste Not and Hold It Together have no manual acceptance route.
- **A continuation hands over its offer's gift (#393).** When the continuation Mission authors an offer route at the predecessor's **turn-in NPC** with a `stack_item` `acceptEffect` (§8.1), the continuation gives that same gift — one authored definition (`continuationGiftOffer` in `game/domain/missions.ts`), never a copy on the predecessor. Inside the completion transaction, after the predecessor's reward is written, the gift is preflighted with the same all-or-nothing planner (`planAcceptanceItemGrant`) against the inventory the completion left. If it fits, the continuation row, its progress rows and the gift commit together. If it does not, **only the continuation is skipped**: the predecessor's completion, its reward and its stamp stand, nothing is granted and no pending gift is recorded; the receipt reports `continuation: { status: "capacity_refused", capacityReason }` and the continuation's ordinary prerequisite-gated offer serves the player on a deliberate return. A continuation already accepted or completed grants nothing. Validation rejects a continuation whose gift route authors anything but a `stack_item` (a Credits gift would need a receipt the continuation cannot present). The completion receipt's `continuation` is what the conversation presents after the completion scene (§9): the gift route's offer and accepted-continuation scenes when accepted (so the item beat appears only when the gift was given), or the continuation Mission's capacity refusal when not. First use: Seeker? I Hardly Know Her! → First Resonance Echo.

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

### 4.1 Item-originated offers (#369)

A Mission may be offered by a **carried item** instead of an NPC. `Not From Around Here` is the first: a carried Rune Fragment offers it.

```ts
type MissionItemOffer = {
  itemIds: readonly ItemId[]; // stackable items; a carried stack of ANY makes the same offer
  inspectLabel: string;       // the Item Details action that opens the offer
  description: string;        // the compact premise; must read right for any listed item
  acceptLabel: string;        // "Start mission"
  declineLabel: string;
};
```

- **Everything is content.** The Inventory, the modal, the projection and the server command name no item and no Mission. They read `itemOffer`, so a second item-offered Mission is authoring, not code. Registry validation requires at least one known **stackable** item (no repeats), complete copy, and at most **one Mission per item** (two offers from one item would leave Inspect without a single Mission to open), and permits `offers: []`.
- **Eligibility is the NPC rule, plus a carried stack.** The offer exists while the Mission is not accepted, its prerequisites hold (`itemOfferAvailable`, the same `prerequisiteSatisfied` an NPC offer uses) and the character carries at least one unit of **any** listed item (`MissionObservation.carriedQuantities`, the carried `inventory_stacks`). Not From Around Here lists both the Rune Fragment and the intact Runestone, so either starts the same Mission; a stack in the Cargo Hold or a site stash is not carried and offers nothing. It projects as `MissionProjection.itemOffer.itemIds` (the listed items currently carried) and as the blue `availableItemIds` guidance, local discovery only, exactly like `availableNpcIds`: never a Mission Log entry, a Map hex, a route or a Local Place, and never filtered by pinning (a Mission that is not accepted cannot be pinned).
- **The UI is ordinary Item Details.** A guided stack tile carries the shared blue `.rs-mission-available` treatment and `data-mission-guidance="available"`. Selecting the stack keeps the ordinary Item Details; the content-authored `inspectLabel` action opens a compact modal on the shared `Drawer` overlay (focus trap, Escape, scroll lock, mobile sheet, focus return to the action) headed **New mission** with the Mission's title, the item's own art, the authored premise, a generic line that the inspected item stays in Inventory, and explicit accept (`acceptLabel`, "Start mission") and decline controls. The wording is correct whichever listed item was inspected. Closing it by any route changes nothing. There is no new inventory screen. After acceptance the blue and the artwork's small double hop (below) are gone from **every** listed item, because nothing is offered; no item-objective guidance exists to reuse green, so the tiles are simply ordinary. Nothing tints it permanently.
- **Discoverability.** While offered, only the item **artwork inside the tile** does a short intermittent double hop with a pause (`[data-offer-hop]`, `rs-offer-hop` in `app/globals.css`); the frame, nameplate and plates stay still. It is driven by the same semantic `missionGuidance="available"` as the blue, so any future offering item gets it automatically, and it never runs under `prefers-reduced-motion`.
- **Mission Started.** After the server confirms acceptance (`accepted` or `already_accepted`; never a refusal or error), the same overlay becomes a compact **Mission Started** view with no second acceptance call: the Mission's real title and its **current objective read from the projection the command returned** (`currentObjective`, never authored or hardcoded in the overlay, so it works for any item-offered Mission). Two exits: **Show on Map** closes the Inventory and routes to the existing Map surface (`?surface=map`), where the Mission's ordinary pinned guidance is already lit, and **Return to Inventory** leaves a normal Inventory with no open details pane. Escape and the backdrop behave like Return to Inventory. The Inventory holds the offer session, so the overlay survives the state update that ends the offer.
- **In person (#389).** An NPC offer route may author `requiresCarriedOfferItem: true` (only on a Mission that authors `itemOffer`). That route is the same item offer made by a person: the hub lists it, and the NPC's Talk glows blue, exactly while `itemOfferAvailable` holds (the projection's `itemOffer`), and `acceptMission` rechecks, inside the lock, that THIS character's carried `inventory_stacks` hold a positive stack of one of `itemOffer.itemIds` — the Cargo Hold, a stash and another character's rows are simply not found. It consumes nothing and keeps every other NPC-offer rule (authored route, stationary at the offer location, prerequisites, exactly-once). The offer may author a hub `subject` and a `declineLabel` (`docs/npc-conversations.md` §4.3). The Wise Old Enby's **Show strange mineral** is the production use; Inventory Inspect is unchanged and still works anywhere.
- **Acceptance is the generic acceptance transaction.** `acceptItemOfferMission` names only `{ characterId, missionId, stackId }`. Inside the character lock it revalidates that the Mission authors an item offer; that the stack row belongs to **this character's carried inventory** and is a stack of one of the authored items (an absent, stale, foreign, wrong-item or Cargo-Hold-or-stash-only stack is simply not found and refused, writing nothing); and the ordinary prerequisite gate, shared with NPC acceptance (`acceptancePrerequisiteRefusal`). It stamps the one accepted row and initialises the Mission's progress rows. It **does not consume, reserve, tag or transform** the item, grants nothing, and has no stationary or location rule, because Inventory is available anywhere and the item makes the offer. Replays, double-clicks and concurrent requests converge on `already_accepted`. An NPC cannot accept an item-offered Mission (it authors no NPC offer) and the item route accepts nothing that authors no `itemOffer`.

## 5. Ordered requirement vocabulary

The currently supported live-state requirement kinds (`MissionRequirement`) are a **closed union**:

| Kind | Fields | What satisfies it |
| --- | --- | --- |
| `at_location` | `locationId`, `objective` | `currentLocationId === locationId` (current location alone) |
| `equipped_item` | `itemId`, `objective` | the item genuinely occupies its authoritative compatible slot (carried instance + `equippedItems` assignment; a stored instance does not count) |
| `tracked_activity` | `progressKey`, `activity`, `metric: "attempts" \| "completions"`, `actionId?`, `target`, `objective`, `recommendedActionId?`, `presentsOutputSources?` | current persisted progress for the stable key reaches the authored target; `attempts` count whether the activity succeeds or fails, `completions` (#232) count only successful units; `actionId` narrows a family activity to one authored action |
| `carried_stack` | `itemId`, `quantity?`, `turnIn`, `objective`, `recommendedActionId?` | current carried quantity for `itemId` ≥ resolved required quantity (§6) |
| `carried_unique_item` (#232) | `itemId`, `turnIn: "show" \| "consume_one"`, `objective` | `consume_one`: at least one instance of the unique `itemId` is carried and **unequipped**, so a hand-in can never take the tool in the player's hand; it hands one over at turn-in, least value first (an uncharged instance before a charged one, then the newest). `show` (#233) takes nothing, so an **equipped** instance counts too. Cargo Hold contents never count for either. No provenance: any instance satisfies it (`uniqueItemRequirementHolds`) |
| `repair_target_complete` | `targetId`, `objective` | that repair target's authoritative completion (`completed_at` is present in `character_repair_targets`); no mission-progress row is created. Hold It Together observes the Cargo Hold, Out of the Weather the Crew Stop. Phase copy and guidance are generated from the target's own recipe — see §5.1 |
| `ship_fuel` (#358 playtest) | `routeId`, `itemId`, `objective` (`{required}` = the route's approved fuel cost) | the ship's **live authoritative tank** covers that route's `fuelCostFuelUnits` (`ship.fuelUnits`, read from `character_ships` by the projection). A canister carried or stored never satisfies it: loading spends the canister, the launch spends the fuel, and only the tank is the truth. Once a flight on that route has started, the spent fuel still counts. `itemId` is projected **only while unmet**, so the Mission Log offers that item's Sources reference while fuelling is needed and not on a satisfied row. Absent ship state reads as the empty starting tank, never as fuelled |
| `ship_flight` (#358) | `routeId`, `objective` | **never satisfied by observation.** Nothing a player can arrange stands in for the flight, so this requirement is always unmet while the Mission is open and the Mission's `autoCompletion` completes it in the landing transaction (§7.1). Validation requires a matching `autoCompletion` on the same route, so the Mission could otherwise never finish |
| `npc_conversation` | `npcId`, `locationId`, `dialogueId`, `progressKey`, `objective`, `actionLabel?`, `leads?`, `appliesOnPlanetId?` | the durable marker for that authored key is set, which only the generic `acknowledgeMissionConversation` command does (§12.3). Trade, arrival, or reading prose never satisfy it. Optional `leads` (§5.2) add conversations elsewhere that point at this contact. Optional `appliesOnPlanetId` (§5.4) waives it on every other planet |
| `deferred_stage` (#369) | `objective` | **never satisfied.** A legitimately unfinished story stage: the Mission stays accepted and Active with this objective, projects no guidance, and cannot present a Turn In or a Completed state (§5.3). No production Mission uses it since #389 replaced Not From Around Here's; it stays validated framework vocabulary for the next unfinished stage |

**Ordering owns the objective.** The first unmet requirement in authored order becomes the current semantic objective / guidance step. `requirements` order is gameplay — changing it changes the player's progression and guidance.

For example, Cut Your Teeth authors:

1. `at_location: The Jag` → "Return to The Jag"
2. `equipped_item: salvageCutter` → "Equip the {item} from Inventory"
3. `tracked_activity: mining-attempts` (five attempts) → "Complete 5 Mining attempts — {current} / {target}"
4. `carried_stack: ferriteShale` (full stack, show) → "Get a full stack of {item} — {carried} / {required}"

If the character is away from The Jag, (1) is the current objective even though (2) and (3) are also unmet.

**The `tracked_activity` `activity` vocabulary is closed:** `"mining" | "refining" | "practice_welding" | "work_order" | "fabrication" | "tinkering" | "runeworking" | "echo_hunt"` — owned by `TRACKED_ACTIVITY_ACTION_IDS` and `TRACKED_ACTIVITY_METRICS` in `game/domain/missions.ts` (the `TrackedMissionActivity` union in `game/content/missions.ts`), which the persistence-layer `TrackedActivity` in `server/mission-progress.ts` reuses. Each activity has exactly one metric, and validation holds them together: `fabrication` and `tinkering` (#232) count `completions` — a Fabrication workpiece that produced its output, a completed Tinkering batch — never a start, a busted workpiece, or an item obtained any other way; `runeworking` (#391) counts `completions` too — a Resonance Rig cycle that consumed its Fragment and made its Seeker — credited only by the Rig's own resolution persistence (`server/runeworking.ts`) in the same transaction; `echo_hunt` (#393) counts `completions` — a server-resolved Beginner Echo discovery, never a wrong reading — credited only by the reading's own persistence (`server/echo-hunts.ts`) in the transaction that consumed the Seeker; every other activity counts `attempts`. `fabrication`, `tinkering` and `runeworking` are families (one action per authored recipe or target); a requirement may narrow to one member with `actionId`, and its `recommendedActionId` must then be that member. Both are credited only by their own resolution's persistence (`server/fabrication.ts`, `server/tinkering.ts`), in the same transaction. A new activity is a deliberate framework extension, never an authoring choice. `work_order` (#207) is credited **only** by the authoritative Work Order completion transaction (`completeActiveWorkOrder` in `server/work-orders.ts`) — never by opening the Work Orders terminal, accepting a job, committing its materials, starting Welding, completing one section, stopping or resuming the activity, or a board refill. It works identically whether that completion resolves while the character is actively welding or through the same shared lazy/offline reconciliation that already resolves Mining, Refining, and Practice Welding away from the keyboard — the generic action-resolver boundary (`ActionResolver` / `resolve` + `persist`), not a Work-Order-specific timer or a second credit path.

**Live-state observation, plus narrow current counters.** Location, equipment, and carried-stack requirements observe current authoritative state. Tracked activities use only the current capped progress value for their stable authored key; the framework does not create per-attempt timestamps, event history, provenance, or lifetime counters. Scavenged shale and mined shale are indistinguishable — carried `ferriteShale` counts regardless of how it was obtained. See §14 for what this boundary currently excludes.

### 5.2 Optional leads to a required contact (#369)

An `npc_conversation` requirement may author `leads`: conversations at **other** NPCs that point the player to this required contact.

```ts
type MissionConversationLeads = {
  progressKey: string;                              // the ONE shared durable fact any lead records
  conversations: readonly { npcId; dialogueId; actionLabel? }[];
  followedObjective: string;                        // the objective once a lead was followed
};
```

- **Only the required contact is required.** The requirement is satisfied by its own conversation alone, so a player who goes straight to the contact skips every lead. A lead never gates anything.
- **One fact, not a counter.** Any one lead's acknowledgement sets the single `leads.progressKey` row (an ordinary `character_mission_progress` row, idempotent, concurrency-safe). Visiting a second lead adds nothing. The row is initialised with the Mission and survives every later content extension.
- **It narrows everything at once.** Until a lead is followed the objective is the requirement's `objective`, the Log's requirement carries `detail: "Possible contacts: …"` naming every contact, and guidance targets **every** contact simultaneously: `MissionGuidance.candidates` (one entry per contact, each with the same World Location → Local Place → NPC handoff a single target has), which `deriveMissionGuidanceTargets` flattens into the ordinary target sets, so shared hexes deduplicate for free and the Map, edge arrows, Local Place entrances and NPC Talk need no new code. The moment the fact holds, the objective becomes `followedObjective` and guidance is the required contact alone.
- **Lead NPCs are placed per character.** A lead NPC's location is never authored on the Mission. Guidance and the acknowledgement command both resolve it through the NPC's own derived placement (`resolveNpcPlacement`, via `leadContactLocationId`), so an NPC who relocates after a completed Mission (Wade after Keep the Change, Tansy at Rusk Recovery during her Fabrication chapter) is guided to and met at their **actual** place for that character. The required contact keeps the Mission's authored `locationId`, as every conversation requirement does.
- **Routing.** A lead NPC's hub shows the lead scene as a one-time `acknowledge_conversation` entry, only while the requirement is unsatisfied **and** no lead has been followed. After either, it is gone; the NPC's other topics and Missions are untouched. `leadConversationFor` reads the projected requirement status (`leads.followed`, `satisfied`), never a Mission ID.
- **Validation.** Known lead NPCs, scenes authored for their own NPC, a unique lowercase-hyphenated `progressKey` in the Mission's key space, at least one lead, non-empty `followedObjective`, and no lead that is also a required contact, another lead, the turn-in NPC or an offer NPC.

### 5.3 The deferred stage (#369)

A Mission can honestly stop at a stage whose content does not exist yet, instead of faking a target or an artificial completion.

- `deferred_stage` is a requirement that **nothing satisfies**. It projects its `objective` as the Current objective and Log row, produces **no guidance of any kind** (no location, NPC, Local Place, action or Map pin), and its Mission authors **no `turnIn`, no `autoCompletion`, no `reward`, no continuation, no completed-story dialogue and no lifecycle dialogue**. So the Mission can never become `ready_for_completion`, present a Turn In control, appear Completed, or pay anything; `completeMission` refuses a forged hand-in.
- It must be the **last** requirement and appear **once**. Validation rejects every completion-shaped slot beside it, so the unfinished state cannot be mistaken for a finished one.
- **It is a seam, not multi-stage.** Persistence is unchanged: the Mission is one accepted row plus progress rows keyed by each requirement's stable key. The slice that ships the missing content **replaces the deferred stage with the real requirements and authors a completion** (a `turnIn` or `autoCompletion`) in `game/content/missions.ts`. Nothing about a character is reset, because acceptance and every earlier fact (`progressKey`s such as `toll-lead` and `toll-hint`) are keyed by the stable requirement identity, and an extended definition reads the same persisted rows. Rows for requirements the extension adds need no backfill: the readers treat a missing row as 0 and the writers upsert. See the `Not From Around Here` example.

### 5.4 A conversation needed on one planet only (#389)

An `npc_conversation` requirement may author `appliesOnPlanetId`: the planet it
is required on. It must be the planet of its own `locationId`, and the Mission's
turn-in must be on another planet (validation enforces both).

- **Waived elsewhere, never recorded.** While the character stands on any other
  planet the requirement is waived (`requirementWaived`): it is skipped by
  `firstUnsatisfiedRequirement` and `requirementsHold`, so it neither owns the
  objective nor guides, and the projection's `requirements` leaves it out, so the
  Mission Log lists it neither as done nor as outstanding. The server's turn-in
  check skips it the same way. Nothing is written by the waiver: travelling,
  pinning, opening a dialogue or talking to the turn-in NPC never sets its marker.
- **Back on its planet it is exactly as it was** — its marker, its leads and their
  candidates guidance are read from the same rows as before.
- **Its marker still counts.** A `conversation_acknowledged` reactive fact (§9.3)
  can read it, so the turn-in NPC can tell a player who was sent from one who came
  directly.
- **Lifecycle.** A requirement waived wherever the turn-in NPC stands is never the
  first unmet requirement in front of them, so it reaches no reminder moment
  (`missionLifecycleMoments`).
- **Cross-planet targets.** Guidance is unchanged in kind: when the turn-in is on
  another planet the target is that World Location, which no map of the current
  planet draws. Not From Around Here relies on this after Toll on Skatboll — the
  objective names the researcher on Stillreach and no Skatboll hex lights.

This is a narrow, content-authored alternative to a prior conversation, not a
branching engine: one optional field on one requirement kind.

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

### 7.1 Automatic completion (#358)

Move Along is the first Mission completed by a gameplay outcome — the Rivet's
landing — rather than a conversation. This is a deliberately narrow capability,
not an event bus and not "every satisfied requirement completes itself".

```ts
type MissionAutoCompletion = { kind: "ship_flight"; routeId: ShipRouteId };
```

- **One closed kind.** The flight's landing (`commitShipArrival` in
  `server/ship-state.ts`) stamps `completed_at` on each Mission whose
  `autoCompletion` names that exact route, if and only if the character has
  accepted it and it is not already complete. The stamp is the same exactly-once
  guard a turn-in uses (`completed_at IS NULL`), inside the same transaction that
  relocates the character, ship and Cargo Hold, so a retry or a concurrent read
  can never complete it twice. The stamp's timestamp is the flight's scheduled
  arrival instant.
- **No turn-in, no completion scene, no reward.** Registry validation rejects an
  automatic Mission that also authors a `turnIn`, a `reward`, or any turn-in
  lifecycle dialogue (`dialogue` must be empty), and requires the matching
  `ship_flight` requirement. `completeMission` refuses a forged hand-in for such a
  Mission. Offer acceptance, the offer NPC's active reminder
  (`MissionOffer.activeDialogueId`) and ordinary post-completion dialogue
  (`completedNpcDialogue`) work as for any Mission.
- **What does not complete it:** walking to the destination, the launch click, a
  countdown reaching zero on the client, and a failed or refused flight. Projection
  keeps the Mission `active` (never `ready_for_completion`) until the landing.
- **It starts with the Thrust Issues report and gates the flight.** Move Along
  has no offer and no accept button: Thrust Issues authors it as its
  `continuationMissionId`, so the ordinary continuation path accepts it in the
  same transaction as that report (existing accepted or completed records are
  left exactly as they are). The route authors `requiredAcceptedMissionId`, so
  the first Crash Site launch is still refused until the ordinary accepted
  record exists; once complete it gates nothing. There is no backfill or
  login-time repair.
- **The player is told durably.** The landing writes a `ship_arrival_notice`
  (`docs/gameplay-foundations.md`, "The arrival notice"); the Mission Log shows
  the normal completed card.

NPC turn-in Missions are unchanged.

## 8. Rewards and acceptance effects

The framework currently supports **at most one reward per mission, and only these four shapes** (`MissionReward`):

```ts
type MissionReward =
  | { kind: "item"; itemId: ItemId }                          // Walk It Off: Salvage Cutter
  | { kind: "skill_xp"; skillId: SkillId; amount: number }    // Cut Your Teeth: +100 Mining XP
  | { kind: "credits"; amount: number }                       // 10,000 Hours: 50 Credits
  | { kind: "stack_bundle"; items: readonly MissionRewardStackItem[] }; // 10,001 Hours: 10 Refined Ferrite + 5 Power Cells

type MissionRewardStackItem = { itemId: ItemId; quantity: number };
```

- **Item** — granted as **one new unique item instance** through the generic completion boundary (capacity-preflighted, guarded by the `completedAt` exactly-once stamp). Registry validation rejects stackable item rewards at definition time because there is no authorized execution path for them yet. Reward initialization derives from `getItemMaximumCharge`: chargeable items arrive depleted (`currentCharge: 0`), others get the schema's `null` — no silent claim of arbitrary charge semantics.
- **Skill XP** — granted through the authoritative progression boundary (`grantCharacterSkillXp`). `amount` must be a positive integer and `skillId` must have a progression curve (`skillLevelThresholds`).

Out of the Weather (#172) uses the skill-XP shape for the one thing it does pay:
**250 Welding XP** on turn-in, on top of the 500 the ten genuine Welding
increments already awarded through the ordinary Welding path. The Mission adds
no synthetic work XP of its own — the work pays for the work — and deliberately
adds no Credit payout, because the reward the Mission is actually about is that
the Crew Stop stays fixed and the crews will give the player a ride.

- **Credits** (#190) — paid by the same transaction that stamps the mission
  complete, incremented in SQL rather than from a read value. The stamp is
  guarded by `completedAt IS NULL` and an `already_completed` short-circuit, so
  the payout is exactly-once under retries and concurrency without a second
  mechanism. 10,000 Hours pays **50 Credits** and deliberately no Welding XP:
  the three genuine Practice welds already paid their own through the ordinary
  Welding path, and paying twice for one piece of work would be inventing
  progression the player did not earn.

- **Stack bundle** (#207) — several stackable items granted **together** as one
  all-or-nothing completion reward: 10,001 Hours pays 10 Refined Ferrite + 5
  Power Cells, the shop stock its own Work Order recipes will need next.
  Deliberately its own reward kind rather than an array of `item`/`skill_xp`
  rewards, because a bundle's whole point is that every entry lands in one
  transaction or none of it does.

  **Capacity is preflighted as ONE combined grant against an evolving
  hypothetical inventory**, via `planExactStackAdditions` — never
  `planPossibleAwardAdditions`. Each bundle entry is planned against whatever
  slots and mass the *previous* entries in the same bundle have already
  hypothetically placed, not against one shared starting snapshot. That
  distinction is the entire reason the new planner exists:
  `planPossibleAwardAdditions` proves several **mutually exclusive** outcomes
  could each fit independently from the identical starting inventory — correct
  for a roll that will produce exactly one of them — and reusing it for a
  bundle would wrongly accept two items that each fit alone but not together,
  because it never applies one branch's hypothetical placement before checking
  the next. A bundle is the opposite case: every entry lands, so each one must
  be planned against the state the ones before it left behind.

  **All-or-nothing, exactly like every other authored grant in this
  framework.** If the combined plan does not fit, nothing is inserted: no item
  lands, there is no partial bundle, `completedAt` is not stamped, and no other
  completion side effect (consumption, a different reward, the authored
  continuation) commits — the refusal returns before the write phase begins.
  The response distinguishes `capacityReason: "slots"` from `"mass"`, the same
  shape every other capacity refusal in the framework reports, so the
  mission's authored `capacitySlotsDialogueId` / `capacityMassDialogueId` beat
  can be selected correctly (§9). Making room and coming back runs the same
  clean preflight exactly once, from a clean state — there is no retry ledger,
  partial credit, or second mechanism.

**No reward is a valid authored choice.** `reward` is optional. A mission whose
real outcome is world or social state — Keep the Change opens HH B&B and pays
its budget up front — authors none, and the completion transaction then commits
only consumption, the completion stamp, and any continuation. Registry
validation skips reward checks for such a mission, and projection reports no
`earnedReward`. Do **not** invent a token payout merely because missions usually
have one.

**Not currently supported as a completion reward:** a stackable item via the
`item` kind (still unique-item-only — a stackable grant is a `stack_bundle`,
even a bundle of one), multi-reward missions that combine different reward
kinds, reputation, generic effects, or similar. A real mission that genuinely
needs one of these earns an explicit, narrow framework extension — do not add a
mission-specific transaction or widen the reward union speculatively.

### 8.1 Acceptance effects (`MissionOffer.acceptEffect`)

An offer route may author **one** effect applied when acceptance at that route
commits:

```ts
type MissionAcceptEffect =
  | { kind: "credits"; amount: number }
  | { kind: "stack_item"; itemId: ItemId; quantity: number };
```

This is what the person offering the job hands over so the work can start — a
different thing from a reward for finishing it. Wade hands his new apprentice 36
Credits for Keep the Change — the retail price of the three Power Cells the job
needs, derived from Bix's price line (#230) — and six Scrap Metal for 10,000 Hours, which is exactly the three
practice welds it asks for. Whatever the player does not spend stays theirs.
There is deliberately no reimbursement, no completion payout, and no provenance
tracking on what they buy or what they weld.

- Authored on the **offer**, not the mission, because the giver and the amount
  belong to that route.
- Applied inside the generic acceptance transaction, in the branch that has
  already proven this is a genuinely fresh acceptance, so the existing
  acceptance guard makes it exactly-once (§12.3). The balance is incremented in
  SQL rather than from a read value.
- Validated at module load: a positive integer amount, and for `stack_item` a
  known **stackable** item, because the acceptance boundary grants through the
  authoritative carried-stack path and has no execution path for a unique item.
- A `stack_item` grant is **all-or-nothing**, preflighted with
  `planExactStackAddition` against ordinary carrying capacity **before anything
  is written**. A player without room leaves with no items, no partial stack,
  no accepted Mission, and no progress rows — only the authored refusal — and
  the ordinary offer runs again cleanly once they have made room. The refusal
  reports `reason: "capacity"` with its `capacityReason`, the same shape the
  turn-in reward refusal already reports, so the conversation surface presents
  the mission's authored refusal beat through one path (§9). A mission may point
  both `capacitySlotsDialogueId` and `capacityMassDialogueId` at one shared
  sequence when the person refusing has nothing different to say about slots
  than about mass, as 10,000 Hours does.
- Deliberately a closed two-kind union — not a generic effect list. Another real
  need earns another explicit kind.

## 9. Conversations and dialogue

Since #164 every NPC uses **one canonical conversation model**: `Talk to <NPC>`
opens a conversation hub listing the currently relevant conversations, and the
player selects one. `docs/npc-conversations.md` is the authoritative contract for
that model, including replayable social topics and their availability, and
skill-level-dependent lines (`docs/npc-conversations.md` §8 — a Mission sequence
may invoke one, as First Runeworking Lesson's scene does). This section covers
only what Mission content owns.

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
| Active (turn-in NPC) | **Turn-in** | `MissionTurnIn.dialogueId` | `active` / `ready_for_completion` + every requirement holds (the stage turns the interaction into a completion attempt; busy is distinguished below). Also the fallback for a reminder or busy moment, but only one the Mission declares in `dialogue.omitted` (§9.4) |
| Active (turn-in NPC) | **Requirements satisfied but busy** | `MissionDialogue.busyDialogueId` | requirements hold but `turnInAvailable` is false because the character is still busy |
| Active (turn-in NPC) | **Equipment reminder** | `MissionDialogue.equipmentReminderDialogueId` | first unmet requirement `kind === "equipped_item"` |
| Active (turn-in NPC) | **Carried-item reminder** | `MissionDialogue.carriedReminderDialogueId` | first unmet requirement `kind === "carried_stack"` or `"carried_unique_item"` |
| Active (turn-in NPC) | **Reactive variant** (#232) | `MissionDialogue.reactive` | replaces the turn-in opening or the tracked-activity reminder when its Mission-local fact holds; first in authored order wins (§9.3) |
| Active (turn-in NPC) | **Tracked-activity reminder** | `MissionDialogue.trackedActivityReminderDialogueId` | first unmet requirement `kind === "tracked_activity"` |
| Active (turn-in NPC) | **Repair reminder** | `MissionDialogue.repairReminderDialogueId` | first unmet requirement `kind === "repair_target_complete"` |
| Active (turn-in NPC) | **Conversation reminder** | `MissionDialogue.conversationReminderDialogueId` | first unmet requirement `kind === "npc_conversation"` — e.g. Tansy telling the player to go and see Bix first |
| Active (conversation NPC) | **Mandatory conversation** | the `npc_conversation` requirement's own `dialogueId` | the requirement is authored for this NPC and is **not yet satisfied**; carries `acknowledge_conversation`. Once satisfied the entry disappears (§9.2) |
| Active (lead NPC) | **Lead conversation** (#369) | the `npc_conversation` requirement's `leads.conversations` entry for this NPC | the requirement is unsatisfied and no lead has been followed; carries `acknowledge_conversation` for the lead scene, and the entry disappears once any lead is followed or the contact is met (§5.2) |
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

#### 9.3 Reactive Mission facts (#232)

A Mission may remember a **small number of narrow story facts** so its NPC can
react to what the player actually did while it was active — the reactive
mission dialogue pattern. Each `MissionReactiveFact` is a boolean with an
authored `key` in the Mission's own progress-key space, set once by the one
authoritative outcome it observes (`observes`), and stored as an ordinary
`character_mission_progress` row — so it lives exactly as long as the Mission
row does and never outlives it. It is not a counter, a lifetime statistic, or
telemetry, and it never changes a requirement, a reward, or progression.

The observations are a closed union, grown only by a real need:

- `conversation_acknowledged` (#389) — one of the Mission's own
  `npc_conversation` requirements (named by `requirementProgressKey`) genuinely
  happened. It is derived from that requirement's existing marker and writes no
  row of its own, so it holds exactly when the scene was acknowledged and never
  because the requirement is waived (§5.4);
- `fabrication_override_bust` — a Manual Override push busted a workpiece of
  the named Fabrication recipe while the Mission was active;
- `fabrication_override_success` — the successful workpiece of the named recipe
  that **satisfied** the named tracked requirement had been pushed at least
  once.

`MissionProjection.facts` lists the keys that hold (accepted, incomplete
Missions only). `MissionDialogue.reactive` authors variants of two moments — the
turn-in opening and the tracked-activity reminder — as `{ factKey, moment,
dialogueId }`; authored order is the priority, and the first variant whose fact
holds replaces the ordinary sequence. A turn-in variant carries the same
completion command as the ordinary opening, and every variant rejoins the same
completion presentation: variants are openings, never branches. Validation
rejects an unknown or colliding key, an observation of anything but an authored
Fabrication recipe, a success fact that does not watch a tracked Fabrication
requirement for its recipe, and a variant reading an unauthored fact or owned by
anyone but the turn-in NPC.

Return the Favor is the first use: `override-bust` and `override-success`, with
the bust-aware opening outranking the approving one, and the bust-aware reminder
while the Cutter is still to be made.

#### 9.4 Lifecycle coverage is deliberate (#324)

A Mission that validates technically can still play nonsensically: a reminder
slot left empty used to present the turn-in opening, so a player who had not
finished the work heard dialogue written for handing it in. The framework now
makes every turn-in-NPC moment a deliberate choice.

- **Reachable moments derive from content** (`missionLifecycleMoments` in
  `game/domain/missions.ts`): one reminder per requirement kind the Mission
  authors (`equipped_item` → equipment, `carried_stack` / `carried_unique_item` →
  carried, `tracked_activity` → tracked activity, `repair_target_complete` →
  repair, `npc_conversation` → conversation), plus `busy` and
  `completion_presentation`, which every Mission reaches. `at_location` has no
  reminder, so validation requires it to name the turn-in location.
- **Each reachable moment authors its sequence or is declared omitted.**
  `MissionDialogue.omitted` lists `{ moment, reason }` entries; the reason is
  reviewer-facing content metadata, never shown to players. An omitted reminder
  or `busy` presents the turn-in opening (with its completion command, which the
  server refuses until the turn-in really is available); an omitted
  `completion_presentation` returns to the hub after success.
- **Not applicable is not the same as forgotten.** A slot or declaration for a
  moment no requirement can reach is dead content and fails validation, as do a
  declaration beside an authored sequence, a duplicate, and an empty reason.
- **The resolver agrees.** `resolveNpcConversationWith` falls back to the
  turn-in only for a declared moment; an undeclared gap yields no Mission entry
  at all rather than the wrong scene. Validation makes that unreachable for
  production content.
- **Objective checks only.** Turn-in-NPC sequences must belong to the turn-in
  NPC; a completion presentation must contain a beat for every reward grant (a
  `skill_xp` beat of the same skill and amount, an `item` beat per granted item
  and quantity; Credits come from the runtime receipt tile, §9.2). Prose is never
  inspected — pronouns, knowledge, timing and order are the narrative pass in
  §13.

Shipped omissions: Walk It Off's `busy` (nothing can keep a character busy at
The Jag before they hold the Cutter it grants), Curly Must-Stash's `busy` (its
approved design authors no busy beat), Not From Around Here's `busy` (the
Resonance Rig, Hilltop Workshop's only activity, opens only once it is
complete), First Runeworking Lesson's `busy` (the approved script authors no
busy beat; the server refuses the turn-in while the Rig runs), and First
Resonance Echo's `busy` (likewise; a reading in progress at Hilltop Workshop is
the only way to be busy there besides the Rig). Not From Around
Here's `completion_presentation` is no longer omitted since #391: it plays the
lesson's instruction scene. `tests/unit/mission-lifecycle-coverage.test.ts`
pins that list, so a new omission is visible in review.

## 9.1 Completion presentation is one-shot, not persistent idle

`MissionDialogue.completionPresentationDialogueId` is narrowly-scoped one-shot UI presentation shown immediately after the authoritative completion succeeds (via the transient open-conversation override in `features/npc/NpcConversation.tsx`). After that conversation closes, later talks route to ordinary completed-story dialogue (the newest authored `completedNpcDialogue`), not a replay of the reward beats. A refresh/reopen after completion likewise routes to ordinary story dialogue — no durable pending-presentation persistence exists. Ordinary future missions should author new post-completion dialogue instead of reusing the presentation as idle.

## 9.2 Credits payout receipts and the reward tile (#290)

A Mission that pays Credits presents the approved battered-chip **Credits reward tile** (`CREDITS` nameplate, `+<amount>` badge) from the same `DialogueScene` / `VisualTile` presentation as item and skill-XP rewards. Shipped payers: Keep the Change pays 36 Credits when **accepted** (`acceptEffect`), 10,000 Hours pays 50 and Cutting Costs pays 500 on **completion** (`reward`), and Curly Must-Stash (#292) pays 150 at each end. A new Credit-paying Mission earns the tile with no extra work, and `tests/unit/credits-presentation.test.ts` fails if the set of payers changes without its authored scene being reviewed.

- **Payment boundary.** The tile renders only from a receipt: `server/missions.ts` returns `creditsPaid` on `MissionAcceptance`/`MissionCompletion` exclusively for the call whose transaction actually committed the payment. `already_accepted`, `already_completed`, refusals, acknowledgements, free Missions, and Missions paid in other currencies carry none. The amount is the authored amount the transaction wrote, never a client value.
- **Runtime-only, not authorable.** The receipt beat (`features/dialogue/credits-receipt.ts`) is deliberately outside `DialogueBeat`: there is no authorable payout beat that could be mistaken for a transaction, and QC Studio (which previews authored beats) cannot express one. Authored dialogue that mentions a price or a payout is plain narration and never triggers a tile.
- **Sequencing.** `resolveMissionSuccessView` (`game/domain/conversation.ts`) decides the next view after a successful command. The tile leads an accepted continuation or the completion presentation (`leads`), and nothing authored is replaced, reordered, or skipped. A sequence whose speaker hands the money over in an opening line may author `creditsReceiptAfterBeats` to place a leading tile after that many beats (#292: Curly's "Here's the first hundred and fifty" and "There you go!"); it positions a confirmed tile and can never create one; when no authored scene follows the payment (Keep the Change's acceptance), the tile is the whole scene (`stands_alone`) against the background of the offer just played. The receipt lives only in the transient open-conversation state: reopening, replaying a topic, or returning to the hub never presents it, and Back/Next/Restart inside that view only step through the one confirmed receipt.

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
- An **item-offered** Mission (§4.1) advertises through `availableItemIds`: the carried item's tile glows blue and its Item Details offer the Inspect action. It is the same local-discovery meaning, tied to the item instead of an NPC, and produces no Map, route or Local Place guidance.
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
| `npc_conversation` | `npcId: requirement.npcId` — the person to go and meet, reusing the same NPC-boundary guidance (`npcBoundaryGuidance`) the turn-in NPC uses. While the character is elsewhere, `locationId: requirement.locationId` is the target instead; arriving hands off to the NPC. With `leads` still unfollowed (§5.2), **`candidates`**: one such target per contact (each lead NPC at its per-character placement), until the first lead narrows it to the required contact |
| `deferred_stage` (#369) | no guidance (§5.3) |
| `tracked_activity` (no `recommendedActionId`, #232) | `activity: requirement.activity` only — the activity itself is the target, with no invented action or destination. Break It Down's "any Tinkering batch" guides the Fabrication Station's Tinker control this way |
| `carried_unique_item` | no guidance (a Cutter may be carried, equipped, stored or bought — no single route) |
| `ship_fuel` / `ship_flight` (#358) | the ship's origin location while the character is elsewhere, exactly as the flight itself; once there, the Ship panel is the only affordance |
| *(carried requirement with no `recommendedActionId`)* | no guidance at all (see Ambiguous acquisition, below) |

**Generic World Location → Local Place → interaction handoff.** Guidance resolves in narrow steps, derived purely from authored data, never from mission IDs or prose:

1. **World Location elsewhere** (`guidance.locationId`) — an unsatisfied `at_location` requirement targets its own location; an unsatisfied `npc_conversation` requirement targets its authored location while the player is elsewhere; the turn-in targets `turnIn.locationId` while elsewhere; a `recommendedActionId` requirement targets the single World Location offering that action.
2. **Local Place entrance at the current location** (`guidance.localPlaceId`) — once the World Location step is resolved (or was never needed), if the NPC target (turn-in or `npc_conversation`) is the authored resident of a Local Place at the player's **current** World Location, that NPC does not appear on screen until the player steps inside, so the place's **Enter** control carries the guidance until then (`npcGuidance`). Derived purely from authored NPC placement — no mission IDs or prose — so any future Local Place resident works automatically.
3. **NPC / equipment / action** — once inside (or immediately, for a target with no Local Place), the NPC's own Talk control, the equipment affordance, or the authored action becomes the target.

Arriving at a step removes that step's guidance and hands off to the next; the player's current World Location, and a Local Place the player has already entered, never themselves carry a target once their handoff is complete. This handoff applies to accepted progression (green) and turn-in (blue) alike, and turn-in entrances are their **own** blue target (`turnInLocalPlaceIds`) — distinct from an active target's green entrance (`localPlaceIds`) even when it is the same physical door. Available (blue) offers never guide a door or a World Location — availability remains local discovery only (see above).

### The guidance rule: the next unambiguous actionable target

> Mission guidance points to the **next unambiguous actionable progression
> target**, not merely the eventual destination.

- One clear required NPC, location, control or action → guidance points there.
- A repair target the player carries useful material for → the repair site is
  actionable and is guided.
- A repair target still needing material the player carries none of → no
  guidance; the repair site is where the work ends, not what to do next (§5.1).
- Several legitimate acquisition paths (mine, refine, fabricate, buy, trade) →
  no invented route (below).
- With no waypoint, the objective and status copy still tell the player what to
  acquire or do: the requirement's objective, a repair's material rows, and the
  Mission strip's Still needed line.

The rule is applied by the generic projection from requirement kinds and
authored `recommendedActionId`s alone, never from prose, and a new Mission
cannot opt out of it.

### Ambiguous acquisition never invents guidance

A `carried_stack` requirement authored **without** a `recommendedActionId` gets no guidance at all when it is the first unmet requirement — not a location, not an action, nothing; a `tracked_activity` without one gets only its `activity` (above), never a location or an action. Several legitimate acquisition sources with no single authored route means the framework never picks one for the player. Keep the Change's Power Cell requirement is the proof case: once Bix's mandatory `npc_conversation` is satisfied, three Power Cells may still come from Inventory, the Annex, or Bix's shop — nothing glows anywhere until the player unambiguously carries the required quantity and only the turn-in remains.

### No new persistence

Guidance is derived entirely from existing Mission records and requirement progress (§2, §5) on every projection — no visited-location, reached-objective, or turn-in-readiness row is added anywhere. A World Location or Local Place target disappears the instant the character's authoritative current location/placement matches it, and the turn-in phase begins the instant `requirementsSatisfied` holds (§7); both are computed fresh on every read, never latched client- or server-side.

### Teaching intent (`recommendedActionId`)

`recommendedActionId` on a `carried_stack` or `tracked_activity` requirement expresses **teaching / recommendation intent** — which gameplay interaction this mission is intentionally guiding the player toward. Carried-item recommendations are distinct from requirement truth (which observes carried quantity regardless of provenance) and are **validated against the action's authoritative output facts** (`getActionOutputItemIds` in `game/domain/action-outputs.ts`, which derives directly from the gameplay resolvers' award facts `miningAwardFacts` / `refiningAwardFacts`). Tracked-activity recommendations are validated against the authored activity. Changing what an action authoritatively produces cannot leave mission-guidance validation stale, and the generic action registry is intentionally not widened beyond this narrow capability check.

Not every technically possible acquisition path should be highlighted. Only the authored `recommendedActionId` on the current unmet carried requirement is highlighted. Cut Your Teeth recommends `ferrite_shale_mining` — Scavenge also yields Ferrite Shale, but has no `ActionId` to author there and is never highlighted merely because it can produce the same item.

### Consumers

Each consumer answers "am I that target, and with which meaning?":

Every consumer reads targets through `derivePinnedGuidanceTargets(state)` (`features/missions/mission-pins.ts`), never `deriveMissionGuidanceTargets(state.missions)` directly: an unpinned accepted Mission is left out of the input (#335, see "Mission pinning").

- **NPC Talk** — `npcGuidanceMeaning(targets, npc.id)` resolves `"active"` (`guidance.npcIds`), `"turn_in"` (`guidance.turnInNpcIds`), or `"available"` (`guidance.availableNpcIds`), with active-over-turn-in-over-available precedence. Each Mission entry inside the conversation hub reuses the same projected guidance (`docs/npc-conversations.md` §4), so the control and the entry can never disagree.
- **Cutter Inventory tile / Equipment "Equip in slot"** — `guidance.equipmentItemIds.has(itemId)` (green only; the turn-in phase never targets equipment).
- **Start Mining / Start Refining** — `guidance.actionIds.has(actionId)` while the action is currently relevant/available (green only). An action highlights only when its `ActionId` is the authored `recommendedActionId` on the current unmet carried requirement.
- **Repair targets** — `guidance.repairTargetId` while an accepted mission's current objective observes that repair's completion (green only). The repair surface owns the repair/material/Welding substate and guides exactly one advancing affordance: CONTRIBUTE MATERIALS while materials are still needed (and a contribution is possible), START WELDING once materials are complete and Welding is idle. STOP WELDING is never guided — stopping does not advance the mission. A target inside a Local Place also guides that place's entrance until the player steps inside, exactly as an NPC resident does. Completed repair clears the target and the generic projection moves guidance to the turn-in handoff.
- **Inventory stack tiles** (#369) — `targets.availableItemIds.has(stack.itemId)` marks a carried stack blue (`available`); the Inspect action in its Item Details is the guided control. Available, so never filtered by pinning.
- **Local Place Enter** — `localPlaceGuidanceMeaning(targets, place.id)` resolves `"active"` (`guidance.localPlaceIds`) or `"turn_in"` (`guidance.turnInLocalPlaceIds`) on an open place's Enter control, via `MissionActionLink`.
- **Map hexes** (`features/travel/LocalMapPanel.tsx`) — a World Location hex in `guidance.locationIds` shows a green MISSION plate and ring; one in `guidance.turnInLocationIds` shows a blue TURN IN plate and ring; a hex in both shows both plate texts, with the ring following the same active-over-turn-in precedence. See `docs/travel-map-design.md` for the presentation contract; this document owns only the semantics.
- **Map edge arrows** (`features/travel/local-map-scroll-affordances.ts`, #240) — while one of those same guided hexes is scrolled out of view, the viewport edge arrow toward it turns green (active) or blue (turn-in), active winning a shared edge. It is a client-side projection of the hex targets onto the current viewport, not a second routing system, and it persists nothing.

`MissionGuidanceTargets` is the union across all missions: `availableNpcIds`, `availableItemIds`, `npcIds`, `turnInNpcIds`, `localPlaceIds`, `turnInLocalPlaceIds`, `locationIds`, `turnInLocationIds`, `equipmentItemIds`, `actionIds`, `cargoRepair`.

### Play Mission strips (Issue #174)

The in-Play Mission surface is a compact stack of strips rendered once, as the
first content under the Play header, by `features/missions/MissionGuidanceStrips.tsx`
from `PlayConsole` — so it leads Location, Local Place, Journey, and Map alike.
It is ordinary document flow (never sticky or fixed) and scrolls away normally.

- One strip per accepted, non-completed, **pinned** Mission (`active` /
  `ready_for_completion`, #325) in the authoritative Mission order;
  unaccepted, available, completed, and unpinned Missions never appear, and an
  empty stack renders nothing — no placeholder objective. There is no selected,
  tracked, or primary Mission.
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
- **Still needed (#322).** While the first unmet requirement is a multi-material
  `repair_target_complete` in its materials phase, the strip adds one subordinate
  line, `Still needed: 2 Wheel Assemblies · 2 Mounting Brackets · 1 Galvanic Wire
  Spool` (`data-mission-strip-needed`). It is `stillNeededMaterials(projection)`
  (`game/domain/missions.ts`): `required - installed - carried` per projected
  material row, clamped at zero, listing only what remains, and read from the
  existing projection with no Mission or repair-target branch. It answers "what
  do I still need to obtain?" — carried material is never treated as installed,
  and the objective, the durable progress and the Mission Log are unchanged (the
  Log keeps every authoritative row, covered or not). The line is absent once
  installed plus carried covers everything, and during Welding. Counts use the
  item's authored `pluralName` (`itemQuantityLabel`, `game/content/item-presentation.ts`).
  It is deliberately separate from map guidance: `repairTargetGuidance` still
  points toward a repair only while the player carries something that advances
  it, because where to *get* the material (mine, refine, fabricate, buy, trade)
  is the player's choice and is never invented.
- A strip is a status row, not an interaction target: it exposes
  `data-mission-phase="work" | "turn_in"` and never `data-mission-guidance`,
  which stays reserved for the controls and places a player acts on.
- Strips are informational: no click-to-track/select/open-Log, no collapse.
  Each carries exactly two possible controls: the pre-existing Open Equipment
  shortcut, inside the strip whose Mission currently targets equipment, and an
  **Unpin** control (#325, below).

### Mission pinning (Issue #325)

Pinning answers one question — *"show this Mission's objective strip and its Map/UI guidance?"* — and nothing else (#335 widened it from the strip alone). It is a per-character presentation
preference, never Mission progression.

- **Every newly accepted Mission starts pinned**, including one accepted
  automatically through `continuationMissionId`. Acceptance never asks.
- **Absence means pinned.** `character_mission_unpins` stores only an explicit
  unpin, one row per character and Mission, so acceptance (manual or
  continuation) writes nothing and needs no coupling to the preference. The row
  cascades with its `character_missions` record, so an admin Mission reset also
  resets the pin. A row may outlive the work (a Mission completed while
  unpinned keeps it); it is harmless, because only active Missions are ever
  asked about.
- **One write path.** `setMissionPinned` (`setMissionPinnedAction`) pins by
  deleting the row and unpins by inserting it; both are idempotent. It refuses
  an unknown, unaccepted, or completed Mission and touches nothing but the
  preference. Due work resolves first, as for every command.
- **One value, one selection boundary.** `state.unpinnedMissionIds` is read through
  `isMissionPinned` by Current Missions (strips and the desktop objectives
  region, via `pinnedGuidanceMissions`), the Mission Log, and the guidance
  selection below. Nothing keeps a client-side copy: a change appears when the
  authoritative state returns, and a refusal or failure keeps the previous state
  with ordinary feedback.
- **Pins control guidance (#335).** An unpinned accepted Mission contributes no
  green work or blue turn-in guidance anywhere: Map hexes and MISSION / TURN IN
  labels, edge arrows, Local Place entrances, NPC Talk (and the highlight on its
  conversation entry), repair, activity, equipment and Inventory controls.
  Every consumer calls `derivePinnedGuidanceTargets(state)`, which runs the
  unchanged `deriveMissionGuidanceTargets` over `guidancePresentationMissions`
  (every Mission except accepted-and-unpinned ones), so a target two pinned
  Missions share survives unpinning either. Blue *available* offers belong to
  Missions that are not accepted yet, are never filtered, and cannot be
  unpinned. The hidden control, NPC, conversation, destination and action remain
  fully usable; repinning restores the current stage's guidance immediately.
- **Unpinned changes no progression.** Requirements, the projection,
  dialogue routing, completion, rewards, the Missions turn-in badge, and world
  state behave exactly as if the Mission were pinned. Completed Missions never
  appear in Current Missions whatever their old preference. There is no pin
  limit, no exclusive "tracked" Mission, and no separate hidden-objective
  concept.
- **Controls.** Each strip has an `Unpin <Mission>` icon button (a pin, never
  an X, so it cannot read as abandon); unpinning moves focus to the next
  strip's Unpin, or with none left to the Missions entry point. Every active
  Mission Log card has a `Pin <Mission>` toggle (`aria-pressed`) in its header,
  so pinning and unpinning never need the card expanded. Completed cards have
  none.

### The Mission Log (Issue #325)

The Log (`features/missions/MissionLogPanel.tsx`) keeps active and completed
Missions in separate sections, Completed collapsed by default. An active card's
header carries the title, a small phase plate in the strips' own meanings —
**Active** (green work) or **Turn in** (blue handoff), from
`missionGuidancePhase` — the expand control, and the Pin toggle beside it,
never inside it. Expanded, the briefing reads first in secondary text, then a
**Current objective** block (the card's strongest content, always shown, even
when the checklist repeats it), then the requirement checklist under a quieter
**Progress** label: repair material rows, counters, carried context, and item
Sources all come from the generic projection unchanged. Active cards never
preview a reward; completed cards keep their completion date and the reward
actually earned. Presentation tokens live in `app/globals.css`
(`.rs-mission-card`, `.rs-mission-phase-plate`, `.rs-mission-objective-block`);
see `docs/design-system.md`.

### Item sources in the Mission Log (Issue #326)

A Mission says what it needs; the item says how it can be obtained. Where the
Mission Log shows an unmet item (a carried-stack requirement, or a repair
recipe's unfinished material row) it adds a **Sources** control that opens the
shared item-source details (`features/item-sources/`). It reads the `itemId` the
requirement projection already carries, so **nothing is authored on a
Mission**: no recipe hint, price, location or tradeability. Opening the details
is a read-only reference; it never changes Mission state, guidance, progress or
the strips, and the compact Current Missions strips carry no source detail.

**The rule for an authored item requirement.** A requirement that names an item
(`equipped_item`, `carried_stack`, `carried_unique_item`, and `ship_fuel` for the
Rivet's fuel) must project that item's canonical `itemId` on its status while it
is unmet, and drop it once satisfied. The generic projection does this for every
kind that carries an item; nothing about a particular Mission or activity is
hard-coded. Source methods stay owned by the item-source registry. A Mission
never names a favoured acquisition route, a price, or a recipe, and Sources is
never attached to an activity merely because it consumes an ingredient. The
test `item Sources on unmet requirements` (`tests/unit/move-along.test.ts`) audits
every authored Mission's item-bearing requirements, so a new one without its
`itemId` fails the suite. Repair material rows are covered by their own
projection.

**A crafted output beside a tracked craft (#391).** A `tracked_activity` that
counts completions of one craft may opt in with `presentsOutputSources: true`.
Its status then projects `sourcesItemId` — the item that craft makes, derived
from the requirement's `actionId` through the authored recipe registries
(`craftedOutputItemId` in `game/domain/missions.ts`), never authored on the
Mission — while unmet, and drops it once met. The Log shows the same
**Sources** control for it. It is presentation only: `itemId` stays absent, so
carrying the item satisfies nothing and guidance is unchanged. Validation
requires `metric: "completions"`, an `actionId`, and a recipe whose output
derives unambiguously. First Runeworking Lesson is the use: Sources for
Beginner Echo Seeker, which drills into Rune Fragment's own Sources through the
shared drawer, so no mining route is copied into the Mission.

Because a Mission never picks a production route, neither do the sources: all
discoverable methods are listed. The resolver and its rules are owned by
`docs/architecture.md` ("Item sources"). A repair with several materials names each on its own row; one with a single
material projects that material's `itemId` on the requirement while it is still
being installed, and both get the same control. Once the material is installed
the projection stops naming it, so the control disappears with it.

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
| materials | some authored material is short | one material: "Install Refined Ferrite at the Crew Stop — 10 / 20"; several: "Install repair materials at the Cargo Hold" plus one `materials` row per material | the repair target **only if the player carries a useful unit of an outstanding material**; otherwise none |
| welding | every material installed, welds outstanding | "Weld the Cargo Hold — 4 / 12 welds" | the repair target |
| complete | `completed_at` present | the requirement's authored `objective`; the Mission is in its turn-in phase | the turn-in NPC |

**The requirement authors nothing to get this.** `kind` and `targetId` are
enough: the copy is generated from the repair target's display name, its recipe,
and the item registry, so a Mission author cannot forget a flag and silently
ship the wrong repair semantics. There is deliberately no Mission-layer opt-in —
a repair that ever genuinely needs to behave differently belongs at the
repair-target boundary that makes it different, not in every Mission's
requirement.

A recipe with several materials is never aggregated. Refined Ferrite and Slag
are projected as one `materials` row each so both stay individually legible, and
no combined total ("11 / 21") is invented; neither is Slag hidden until Refined
Ferrite finishes.

`{contributed}` is **durably installed material**. Carried stacks, Cargo Hold
contents, and material the player could go and acquire are never counted: the
observation is built from the repair record, which has no access to inventory.
Carried quantity may appear as subordinate context — a `detail` line for a
one-material recipe, a per-row `carried` for a multi-material one — rendered
below the objective precisely so it can never read as progress or be added to
it. Cargo Hold storage is not carrying and appears nowhere.

The silent-guidance case follows the same principle as a carried requirement
with several legitimate sources: Refined Ferrite can be refined, bought, or
scavenged, so the framework refuses to invent one of them as a destination, and
the Mission Log's `{contributed} / {required}` carries the objective on its own.
Carrying even one useful unit of a material the recipe **still needs** makes the
repair target worth walking to again, and guidance returns. Material the recipe
no longer needs never counts: carrying spare Refined Ferrite while only Slag is
missing guides nothing.

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
sees the accepted row, so Wade's 36 Credits are granted once even under retries,
reloads, replayed dialogue, or parallel requests. Integration coverage asserts
this directly.

**Leads (#369).** The same command also accepts a **lead** conversation: it matches the NPC and the authored sequence against `requirement.leads.conversations` as strictly as it matches the required contact. A lead is met where the lead NPC stands for **this character** (`leadContactLocationId`, from the NPC's Mission-derived placement), records the one shared `leads.progressKey` fact, and converges on `already_acknowledged` for a replay, a concurrent request, the other lead, or a contact already met (nothing is written then). Opening, scrolling or backing out of a scene never records anything; only its terminal control does.

**Item-offer acceptance (#369)** is the sibling command `acceptItemOfferMission` (`acceptItemOfferAction`), described in §4.1. It shares the prerequisite gate with NPC acceptance and the same lock, so neither route can accept what the other would refuse.

Do not document or introduce client-authoritative shortcuts. The client never supplies required items, quantities, `consume` behavior, rewards, prerequisite status, or completion eligibility.

### 12.1 One-time Waste Not backfill

The Issue #141 maintenance script is separate from normal runtime acceptance. It is dry-run by default, emits a reviewed cohort report, and requires an explicit confirmation token plus an unchanged report for execution. The eligible cohort is stationary characters with completed Walk It Off and Cut Your Teeth rows and no Waste Not row. Characters with an active action are reported and skipped. Execution inserts Waste Not and its `refining-attempts` row at `0 / 5`, grants no historical credit, and is idempotent. Rerun it after skipped characters are stationary; no permanent legacy branch is added to mission runtime.

### 12.2 One-time Hold It Together continuation backfill

The Issue #148 maintenance script is separate from normal runtime continuation. It is dry-run by default, emits a reviewed cohort report, and requires an explicit confirmation token plus an unchanged report for execution. The eligible cohort is characters with completed Waste Not and no Hold It Together row. Execution inserts only an accepted Hold It Together row; it never completes the mission, creates a progress row, grants the mission reward, consumes materials, changes Welding or Cargo repair state, or alters storage. Population and character locks, a serializable transaction, an execution-time cohort recheck, post-commit verification, and `ON CONFLICT DO NOTHING` keep the repair narrow and idempotent. No permanent legacy branch is added to mission runtime.

## 13. Authoring an ordinary new mission

An ordinary mission is one that uses already-supported semantics: authored content plus the generic projection / routing / guidance / generic commands (§2). It should not require server, wiring, or client routing changes to adopt.

### New Mission authoring checklist

Follow this from fresh context before a Mission is handed off for implementation or review. It is a short pass to prevent omissions, not a form to fill in; skip what genuinely does not apply.

1. **Shape** — stable mission/dialogue IDs, title and summary; prerequisite versus explicit continuation; every offer route; ordered requirements; turn-in NPC, location and objective copy; at most one reward (or none, deliberately); capacity refusals when a grant can be refused. Add only genuinely needed item/NPC/location/action IDs.
2. **Lifecycle dialogue** — walk each moment and author it or declare it omitted (§9.4):
   1. offer;
   2. acceptance continuation, when the offer should flow straight on;
   3. an active reminder for every requirement kind, and every state that reminder can be read in (nothing done, part done, mid-activity);
   4. busy at the turn-in NPC;
   5. turn-in opening;
   6. one-shot completion presentation;
   7. reward presentation and its position in that scene;
   8. ordinary post-completion follow-up (`completedNpcDialogue`), when the NPC should acknowledge the finished work;
   9. contextual active dialogue (`activeNpcDialogue`) at other NPCs, only when one has a real reason to react.
3. **Narrative continuity pass** — read the whole chain in player order, scene after scene, not as isolated strings (canon from `docs/npc-canon.md`). Check that:
   - pronouns and referents are established before use;
   - the NPC only knows what they could know right now;
   - no line assumes travel or elapsed time that may not have happened;
   - location and background match the scene;
   - no line asks the player to answer when no response or choice exists;
   - scenes still make sense played immediately back to back;
   - completion dialogue and reward beats appear in the intended order;
   - post-completion dialogue still makes sense opened right after completion;
   - reminders assume no more progress than the player may have made.

   This is a human and product check; validation never inspects prose.
4. **Guidance** — for each requirement, confirm what the projection will guide and that it is the next unambiguous actionable target (§10); where nothing should glow, confirm the objective copy alone tells the player what to acquire or do.
5. **Completion and after** — the reward is exactly-once; any continuation, world change or unlock derives from the completion record; story dialogue that supersedes older dialogue cannot regress.
6. **Persistence rollout** — migration ownership, acceptance/continuation initialization, any existing-character backfill, and idempotence/rollback expectations.
7. **Focused tests** — registry validation (including §9.4 coverage), projection/guidance at each phase, active/completed routing, persistence/concurrency at the correct integration layer, and the player journey when the Mission changes it (`docs/testing-strategy.md`).
8. **Human playtest of the full chain** — offer → every reminder → busy → turn-in → completion → post-completion revisit, including refresh/reload, partial progress, success and failure attempts, stopped/restarted activity, and talking again immediately after each step.

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

## 15. Repeatable Wise Old Enby research assignments (#406)

Missions here are one-shot, so the Wise Old Enby's three repeatable jobs —
Research Courier, Geological Field Survey and Resonance Calibration — are **not**
Mission definitions. They share one narrow lifecycle of their own, and only their
*presentation* reuses the Mission vocabulary (the Log, the strips and guidance).
Do not add a fourth job, a daily job or a job board by extending this; a real
need earns its own deliberate extension.

| Concern | Home |
| --- | --- |
| Job content: copy, loan item, sites, dialogue ids | `game/content/research-jobs.ts` (`RESEARCH_JOBS`, `RESEARCH_GIVER`, `RESEARCH_COPY`) |
| Pure rules: stage, field-action availability, delivery rule, capacity, offer status, the Mission-shaped projection, validation | `game/domain/research-jobs.ts` |
| Persistence | `character_research_assignments` (the one held run), `character_research_jobs` (completion count + Calibration arrival receipt); migration `0051_research_jobs` |
| Reads, projection, field-action resolver | `server/research-jobs.ts` |
| Commands: accept, start a field action, deliver, collect payment, confirm passage, abandon, acknowledge arrival | `server/research-job-commands.ts`; `server/actions.ts` (`runResearchAction`) |
| UI | `features/research/`; the Research Jobs button in `features/npc/NpcConversation.tsx` |

- **One slot.** `character_research_assignments` has the character as its primary
  key, so a character holds at most one run across all three jobs, however many
  accepts race. A run is deleted on a paid turn-in, a confirmed passage or an
  abandonment. Each run has its own `id`; every command on a held run names it, so
  a stale client can never act on a later run of the same job. Story Missions are
  untouched.
- **A loan is one ordinary unique item**, minted in the transaction that records
  the run, after the slot and mass preflight (a free slot AND the full mass: the
  packet is 2 kg, the case and the sampler 0.1 kg). A refusal reports `slots`,
  `mass` or `slots_and_mass` and writes nothing. `isResearchLoanItem` (derived from
  the registry) makes it untradable (`isItemTransferable`), and Cargo Hold and
  stash deposits refuse it (`loaned_item`). There is no Inventory Use, no exempt
  slot and no mass bypass.
- **Stages are derived, never stored.** `field` until the work is done (Courier
  delivered, Survey three of three, Calibration recorded), then `ready`: only the
  return to the Enby remains. The Survey keeps its collected sites as a list on the
  run row (no per-site items); the case's mass never changes.
- **Field actions** are `ACTION_IDS.researchSurfaceSample` and
  `researchResonanceRecording`: one stationary, whole-tick action of 8 ticks (4.8 s
  at the 600 ms tick), resolved lazily by `createResearchFieldResolver` exactly like
  an Echo reading. The progress is written in the transaction that resolves it,
  guarded by the run id and by the site (or recording) not already being stored, and
  only if the run and the original carried item still hold. Travel and other
  activities refuse while one runs. No ore, XP or other reward exists.
- **Courier delivery** is allowed only at the Stillreach FedHex (`canDeliverPacket`):
  one guarded write sets `delivered_at` and clears the item reference, and the
  packet instance is deleted. FedHex pays nothing. Skatboll's FedHex never accepts it.
- **Payment** (`completeResearchJob`) deletes the run (the exactly-once stamp),
  reclaims the Survey's case and adds the Credits in SQL (25 and 75; 0 XP).
- **The Calibration passage** (`teleportResearchJob`) deletes the run, reclaims the
  sampler and moves **only the character** to the Crash Site in one transaction.
  The Rivet, its fuel and the Cargo Hold are keyed to the ship and are not
  touched. Declining is simply sending no command: nothing is banked. The
  durable arrival receipt is `character_research_jobs.last_completed_at` of the
  Calibration row newer than `arrival_acknowledged_at`; acknowledging it is
  presentation only.
- **Abandon Assignment** (`abandonResearchJob`) works from anywhere at any stage. It
  forfeits progress, the loan and any payout or passage, cancels a pending field
  action, counts nothing and frees the slot.
- **Presentation.** The held run is appended to `state.missions` as a Mission-shaped
  projection (`projectResearchAssignment`, `MissionProjection.research`) and
  `state.research` carries the offers, the run and the arrival receipt. Guidance
  uses the ordinary vocabulary: the Survey's several sites are `guidance.locationIds`.
  A run has no Pin: it is always in Current Missions. The conversation resolver
  ignores it (it is not a Mission definition), so story conversations stay on the
  Enby's top level and the jobs live under Research Jobs
  (`docs/npc-conversations.md` §4.4).

## 14. Current limitations

The framework currently models **one live-state phase** per mission. Requirements observe current authoritative state (§5), while tracked activity requirements persist only a capped current value keyed by character, mission, and authored `progressKey`. This keeps ordinary missions simple, but the following progress shapes are **not yet modelled** and must earn an explicit framework extension when a real mission needs them:

- **Multi-location history** such as "visit A → visit B → return to A" when the visits leave no durable evidence in current state (e.g. two `at_location` steps that would both already be satisfied by the current location).
- **Arbitrary dialogue memory.** Two narrow shapes are now modelled: reactive
  Mission-local facts (§9.3), and a single authored
  mandatory conversation per NPC, marked durably by the `npc_conversation`
  requirement (§5, §9.2, §12.3). That is a concrete gameplay requirement, not
  conversation history — nothing records which optional topics were read, in
  what order, or how often. Branching dialogue, remembered answers, and
  multi-step conversation chains remain unmodelled.
- **NPC schedules or movement beyond story placement** — an NPC's placement *is* Mission-derived (#190, #231: ordered `relocations` in `game/content/npcs.ts`, see `docs/npc-conversations.md`), but nothing moves anybody by time, shift, pathing, or chance. Mission location semantics remain intentionally authored on each definition rather than derived from NPC placement, so moving an NPC never silently moves where a Mission can be accepted or turned in.
- **Arbitrary persistent per-step ledgers** beyond the narrow tracked-attempt contract (timestamps, event history, flags, provenance, or lifetime counters like "shale mined since acceptance" — current carried-stack requirements intentionally count any carried quantity (§5–§6)).
- **Branching, repeatable, or timed mission systems.** The Wise Old Enby's three research jobs (§15) are a deliberately separate, narrow lifecycle, not a general repeatable-Mission framework.
- **Persistent multi-stage missions.** (`deferred_stage` (§5.3) is not this: it is a placeholder objective that a later slice replaces, not a stage history.) A mission surface shows all requirements of the **current stage/leg** but never future-stage objectives. The current production framework is one stage, so authored requirements form the current simultaneous requirement set. A future mission with genuinely sequential legs (e.g. deliver one material set, then receive a new objective elsewhere) earns a deliberate multi-stage extension then — not speculatively now.

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
- **Dialogue:** offer sequences plus `completionPresentation` (`tansyAfterClaim`, which presents the already-granted Cutter via an `item` beat) and `capacitySlots` / `capacityMass` refusal branches that the server selects generically after a `capacity` refusal. `busy` is declared omitted (§9.4): nothing can keep a character busy at The Jag before they hold the Cutter. The Cutter claim's `Claim Cutter` control copy is authored on `turnIn.actionLabel`, not on the sequence.
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
- **Acceptance effect:** `acceptEffect: { kind: "credits", amount: KEEP_THE_CHANGE_BUDGET_CREDITS }` (§8.1) — the retail price of three Power Cells from Bix, `KEEP_THE_CHANGE_CELL_COUNT × merchantRetailPrice(bix, powerCell)`, so 36 Credits at the 12-Credit price #230 set; a Cell price change moves it with no second number to update. Granted exactly once with the acceptance stamp. Unspent Credits are never reclaimed and nothing is reimbursed.
- **Requirements (ordered):** `npc_conversation` with Bix at Holo Hollow → `carried_stack: powerCell` (`quantity: 3`, `turnIn: "consume_required_quantity"`). Meeting Bix stays first even for a player already carrying Cells, because the introduction is the point; buying is never required, and the Cells may come from inventory, the Annex, or the shop — carried quantity is observed regardless of provenance (§5–§6). No `recommendedActionId`: no gameplay action authoritatively produces Power Cells.
- **Reward:** none (§8). The outcome is world/social state — HH B&B becomes enterable because the Mission is completed, derived from that record rather than a second persisted unlock flag (`docs/gameplay-foundations.md`, Local Places).
- **Dialogue:** Wade's offer scene carries the post-repair beat and the apprenticeship itself, with Tansy interrupting over comms from the seam (per-beat `speakerNpcId` + `presentationMode: "comms"`); Bix's required scene hosts Mara as an authored guest speaker in his own sequence; Tansy authors `conversationReminder` → `carriedReminder` → `busy` → turn-in → completion presentation.
- **One-time encounter:** the Bix/Mara scene disappears from Bix's hub once the requirement holds and is never replayable (§9.2), while Bix's ordinary topics continue as normal.

### Out of the Weather — the first optional side Mission

- **Acceptance:** `prerequisiteMissionId: holdItTogether`, the same prerequisite Keep the Change has, so the two branch in parallel. One offer route: Renn Calder at Holo Hollow, `actionLabel: "PITCH IN"`. It names no continuation, nothing continues into it, and nothing lists it as a prerequisite — so it is **never** on any main-story path and completing or ignoring it changes nothing upstream (§3.1, §11).
- **Optionality is structural, not documented.** Availability is local discovery through Renn only (§10), and the Mission Log renders accepted/completed Missions, so a satisfied prerequisite alone puts nothing in front of the player. No framework change was needed for any of that.
- **Acceptance effect:** none. This Mission costs the player rather than funding them.
- **Requirement:** one `repair_target_complete` observing the Crew Stop (§5), authoring nothing but its target. The generic phases (§5.1) read "Install Refined Ferrite at the Crew Stop — 10 / 20", then "Weld the Crew Stop — 3 / 10 welds". Guidance runs Holo Hollow → the Crew Stop's Local Place entrance → the repair surface once the player carries useful Refined Ferrite, stays silent while they carry none, and hands off to Renn's turn-in the moment the repair completes.
- **Reward:** `{ kind: "skill_xp", skillId: welding, amount: 250 }` (§8), on top of the 500 Welding XP the ten genuine increments already paid through the ordinary Welding path. No synthetic work XP and no Credit payout: the durable reward is the repaired shelter and the Crew Hauler ride it earns (`docs/gameplay-foundations.md`, travel modes).
- **Dialogue:** Renn authors the offer, the repair reminder, busy, the turn-in, the completion presentation (which carries the authored skill-XP beat), and post-completion story dialogue. The player stays silent throughout.

### 10,000 Hours — Wade's yard, Wade's offer, and acceptance as the unlock

- **The handoff is not the assignment.** Keep the Change's completion beat ends with Tansy calling Wade over comms (per-beat `speakerNpcId` + `presentationMode: "comms"`, against his own yard's background) and Wade telling the player to come by Rusk Recovery. That is the whole of the guidance: availability stays local discovery only (§10), Rusk Recovery has been on the map since the beginning, and nothing reveals a destination before acceptance.
- **Acceptance:** `prerequisiteMissionId: keepTheChange`; one offer route, **Wade at Rusk Recovery**, `actionLabel: "PICK UP THE TORCH"`. No `continuationMissionId` anywhere in the chain reaches it, so it is never auto-accepted. It is his business, his apprentice, his training, his Scrap, and his future client work — Tansy neither offers it nor turns it in.
- **Acceptance effect:** `acceptEffect: { kind: "stack_item", itemId: scrapMetal, quantity: 6 }` (§8.1) — exactly three welds' worth, all-or-nothing against ordinary carrying capacity. A player without room for all six leaves with nothing at all and hears Wade's one shared "make room and come back" refusal, authored at both `capacitySlotsDialogueId` and `capacityMassDialogueId`.
- **The offer conversation IS the onboarding.** It establishes his actual shop, the Workbench, and that he will not yet let the player touch a client's property. There is deliberately **no** `npc_conversation` requirement: a requirement whose only purpose would be meeting a man the player is standing in front of is not a requirement, and everything it would have committed commits with the ordinary acceptance instead.
- **Requirement:** one `tracked_activity` — `practice_welding`, `target: 3`, `progressKey: "practice-welds"`, `recommendedActionId: practiceWelding`. It observes real completed Practice welds through the generic path (§6): any genuine weld counts whatever Scrap paid for it, welds resolved lazily while the player was away count, and losing the free Scrap dead-ends nothing because Wade sells more.
- **Reward:** `{ kind: "credits", amount: 50 }` (§8) and deliberately no Welding XP — the three welds already paid their own.
- **One accepted record, two things opened.** The Workbench and Wade's Trade counter both derive from that acceptance and stay open after completion; there is no `practice_unlocked` or `trade_unlocked` flag. See `docs/gameplay-foundations.md` (Practice Welding, World Location merchants).
- **Completion reveals the Work Orders terminal** as a real but empty surface; this slice ships zero playable Work Orders, and future ones will need Welding level 5 as well.

### 10,001 Hours — the first skill gate, acceptance as authorization, and a two-item bundle

- **The first authored skill gate.** `prerequisiteSkillLevel: { skillId: welding, level: 5 }` (§3) sits alongside the ordinary `prerequisiteMissionId: tenThousandHours`. Below Welding 5 the mission is not offered anywhere, including at Wade himself — exactly the "not advertised, not acceptable" eligibility an unmet `prerequisiteMissionId` already gives, derived from the same authored field by the one exported `missionSkillPrerequisiteSatisfied` helper that both projection and the acceptance command call. It is a rule about the work — Wade will not put a customer's property in front of an under-trained apprentice — never a rule that hides content from the player.
- **Acceptance is the unlock, again.** As with 10,000 Hours' Workbench and Trade counter, the Work Orders board's permanent, standing availability derives from this mission's own accepted row, not a second `board_unlocked` flag. One offer route, Wade at Rusk Recovery, `actionLabel: "TAKE THE WORK"`. **Turning the mission in is Wade looking at the finished job, not a second gate:** the board is already fully usable, with the single requirement sitting at 1/1, from the moment acceptance commits.
- **Acceptance effect:** none. Unlike 10,000 Hours' free Scrap, the player buys their own material for a paying client job through the ordinary Work Order recipe — that the job pays for itself up front is the point.
- **Requirement:** one `tracked_activity` — `work_order`, `progressKey: "work-orders-completed"`, `target: 1`, `recommendedActionId: workOrderWelding`. It is credited only by the authoritative Work Order completion transaction (§5) — opening the terminal, accepting a job, committing its materials, and every individual Welding section leave it untouched.
- **Reward:** one `stack_bundle` (§8) — 10 Refined Ferrite + 5 Power Cells — deliberately not Credits: the job already paid those, and this reward solves the apprentice having to stop working mid-shift to go shopping for their own next batch of shop material.
- **Two capacity-refusal beats, not one.** Unlike 10,000 Hours' single Scrap grant, small enough that slots and mass are practically the same problem and share one authored beat, ten Refined Ferrite and five Power Cells are large enough that the two failures are genuinely different situations, so Wade gets a separate line for each: `capacitySlotsDialogueId` ("Where exactly were you planning to put it?") and `capacityMassDialogueId` ("You can barely stand up as it is.") are two distinct sequences, not one shared refusal.
- **Dialogue and tone:** Wade's offer keeps his ordinary register — a compliment arrives ("Hm. You're getting decent with that torch.") and is undercut in the very next line ("Decent. Don't write it down anywhere."), the real reason is stated plainly (the terminal is outpacing him, not that trust has been earned), and the scene ends on a flat instruction that asks for the first finished job back for inspection without gating the second ("Bring the first one back here when it's done. My name's on the work, so I'll want a look at it.") — the board is his apprentice's from the moment this is accepted, so his dialogue must not imply otherwise. No exclamation marks, no ceremony, and the pride — as always with Wade — arrives as a shorter sentence, not a warmer one.

### Return the Favor — a deliberate pickup, a fabricated Cutter, any Cutter handed in, and two reactive facts

- **Acceptance:** `prerequisiteMissionId: tenThousandHours`; one offer route, **Tansy at Rusk Recovery** (her Mission-derived relocation puts her there once 10,000 Hours is complete — `docs/npc-conversations.md`), `actionLabel: "TAKE THE JOB"`. 10,000 Hours has no `continuationMissionId`: learning a new skill is choosing new work, never an objective that silently appears. Accepting it is what opens the Fabrication Station (`RUSK_RECOVERY_CONTENT.fabricationAuthorizingMissionId`).
- **Requirements:** a `tracked_activity` — `fabrication`, `metric: "completions"`, `actionId: salvageCutterFabrication`, `target: 1` — so only a Salvage Cutter the player genuinely fabricates while the Mission is active counts; one bought, given, or already owned cannot, and a busted workpiece is not a Cutter. Then a `carried_unique_item` for the Salvage Cutter with `consume_one`: any unequipped carried Cutter will do, with no provenance, and the starter Cutter is never singled out.
- **Reactive facts (§9.3):** `override-bust` and `override-success`, choosing among three turn-in openings — bust-aware, approving, ordinary — that all rejoin one completion; the bust-aware reminder plays while the Cutter is still to be made.
- **Completion:** Tansy inspects the handed-in Cutter and takes it apart as the Tinkering demonstration. The Scrap her demonstration shows is illustrative teaching only — nothing is granted. Completing the Mission opens Tinkering (`tinkeringAuthorizingMissionId`), pays `{ kind: "skill_xp", skillId: fabrication, amount: 100 }`, and **automatically continues** into Break It Down, because that is the next beat of the same lesson.

### Break It Down — one Tinkering batch, and Tansy goes home

- **Continuation-only:** `offers: []`, `prerequisiteMissionId: returnTheFavor`.
- **Requirement:** one `tracked_activity` — `tinkering`, `metric: "completions"`, `target: 1`, no `actionId` — any genuinely completed Tinkering batch of anything eligible. With no single recommended action, its guidance names the activity (`MissionGuidance.activity`), which the station's Tinker control reads.
- **Turn-in:** Tansy at Rusk Recovery; **reward** `{ kind: "skill_xp", skillId: fabrication, amount: 250 }`.
- **Completion** closes the teaching chapter. Tansy's second authored relocation takes her home to The Jag, and Brace Yourself becomes the next story gate. Her closing conversation stays open while she leaves, so the scene plays to the end (`docs/npc-conversations.md`).

### Brace Yourself — two skill gates at once, and a repair that changes the world

- **Two authored gates, one shared model.** `prerequisiteSkillLevels: [{ mining, 5 }, { welding, 5 }]` (§3) alongside `prerequisiteMissionId: breakItDown` (10,000 Hours until #232 put Tansy's Fabrication chapter first). Tansy's reasoning is the gate: she has known about the cave-in for years, and it was not worth attempting until the player had proven themselves with both a pick and a torch. Widening the existing field from one entry to a list is the whole of the framework change — there is no Deep-Jag-specific eligibility check anywhere, and the acceptance command reads every named skill before judging so its refusal can name the one that is short.
- **Accepted before #232.** A character who already held Brace Yourself when the gate moved keeps it — prerequisites are judged at acceptance only. Tansy's move to Rusk Recovery follows 10,000 Hours alone, so that character finds her at the yard rather than at The Jag, where Brace Yourself turns in; the chapter is still offered, and completing Break It Down sends her home to an untouched turn-in. This is a detour, never a dead end, and is covered by the chapter's PostgreSQL integration test. Its guidance still names The Jag while she is away — a known rough edge left as it is rather than widening #231's completed-Missions-only relocation model.
- **It does not require 10,001 Hours.** Work Orders and Deep Jag are sibling branches, not a chain; 10,001 Hours hangs off 10,000 Hours and nothing in the Fabrication chapter touches it.
- **Acceptance effect:** none. Tansy supplies the brace and the jack as story hardware; the player hauls the ordinary stock. No carried "brace" item was invented to represent equipment the fiction already gives her.
- **Requirement:** one `repair_target_complete` observing the Deep Jag cave-in (§5), authoring nothing but its target. The generic phases (§5.1) read "Install Refined Ferrite at Deep Jag — 10 / 25", then "Weld Deep Jag — 3 / 15 welds".
- **The repair, not the turn-in, opens the world.** The fifteenth welded section completes the repair, and Deep Jag's authored state variant resolves from that one durable fact: the scene becomes the opened passage, the map status becomes **MINING**, and Galvanite Mining is available immediately, without a trip back to Tansy and without a second `deep_jag_open` flag to drift (`docs/gameplay-foundations.md`, state-dependent World Locations).
- **Offered and turned in at The Jag,** while the work itself is at Deep Jag — the first Mission whose repair location and turn-in location differ, which the generic guidance and phase projection already handled.
- **Reward:** `{ kind: "skill_xp", skillId: welding, amount: 250 }` (§8), on top of the 750 Welding XP the fifteen genuine sections already paid, for a clean 1,000 across the journey.
- **Dialogue:** Tansy authors the offer, the repair reminder, busy, the turn-in, the completion presentation (carrying the authored skill-XP beat), and post-completion story dialogue, all within her established expression set.

### A Cut Above — a Fabrication-level gate, a Cutter shown, and nothing taken

- **Acceptance:** `prerequisiteMissionId: braceYourself` and `prerequisiteSkillLevels: [{ fabrication, 5 }]` (§3); one offer route, **Tansy at The Jag**, `actionLabel: "TAKE THE JOB"`. There is no Refining requirement — Fabrication and Refining are separate professions — and no acceptance effect.
- **It teaches a rule, not a recipe.** The Loadsteel Cutter recipe is Fabrication 5 on its own (`docs/gameplay-foundations.md`); it is open whether or not A Cut Above was ever offered or accepted, and accepting it unlocks nothing. Return the Favor already proved the player can fabricate a Cutter, so this Mission does not ask for another fabrication.
- **Requirement:** one `carried_unique_item` for the Loadsteel Cutter with `turnIn: "show"` (§5) — "Show Tansy a Loadsteel Cutter". Any Loadsteel Cutter with the character counts, carried or **equipped**, whatever its source or charge; one owned before accepting satisfies the objective at once. One only in the Cargo Hold is not with the character and does not. No provenance is recorded.
- **Turn-in:** Tansy at The Jag, `actionLabel: "SHOW HER THE CUTTER"`. Showing consumes nothing: the player keeps the tool.
- **Reward:** `{ kind: "skill_xp", skillId: fabrication, amount: 500 }`, paid once by the ordinary completion stamp.
- **Dialogue:** the locked offer, turn-in and completion scenes. The design authors no separate reminder or busy scene, so the reminder repeats the offer's own closing instruction ("Get your hands on one." / "Bring it by when you've got it…") and busy reuses Tansy's ordinary Jag "finish it first" beat (`tansy_rusk_brace_yourself_busy`) rather than inventing prose.

### Cutting Costs — an optional purchase with no provenance

- **Acceptance:** `prerequisiteMissionId: braceYourself` only — **no** Fabrication level and **no** A Cut Above, because Renn wants the Cutter, not proof of who made it. One offer route, **Renn at Holo Hollow**, `actionLabel: "TAKE THE JOB"`.
- **Requirement:** one `carried_unique_item` for the Loadsteel Cutter with `consume_one` (§5) — Return the Favor's reusable unique-item turn-in. Any carried, unequipped Loadsteel Cutter satisfies it — self-crafted, traded, gifted or otherwise legitimately held — least value first; an equipped Cutter and one in the Cargo Hold never count, so the tool in the player's hand cannot be handed over. No provenance is recorded for it.
- **Turn-in:** Renn at Holo Hollow, `actionLabel: "HAND OVER THE CUTTER"`. The turn-in consumes one Cutter because Renn is buying it.
- **Reward:** `{ kind: "credits", amount: 500 }` (§8), paid by the same exactly-once transaction that stamps completion.
- **Dialogue:** the locked offer, active reminder, turn-in (with the Cutter shown as an item beat) and completion (Renn taking it, as an item beat). Busy reuses Renn's ordinary "Finish it. I'll be here." beat. The player stays silent throughout.

### Curly Must-Stash — an optional paid commission in two halves

- **Acceptance:** `prerequisiteMissionId: keepTheChange` and `prerequisiteSkillLevels: [{ welding, 1 }]`; one offer route, **Curly at Holo Hollow** (a resident of HH B&B), `actionLabel: "TAKE THE JOB"`, with an `acceptedContinuation` that plays as soon as the job is taken. There is no Decline: leaving the offer is ordinary Back/Close. It names no continuation and nothing requires it.
- **Two exactly-once payments, no third:** `acceptEffect: { kind: "credits", amount: 150 }` and `reward: { kind: "credits", amount: 150 }` — 300 in total, with no separate materials allowance. Each is shown as the shared Credits tile only from its own confirmed receipt (§9.2), placed after Curly's line that hands it over (`creditsReceiptAfterBeats: 1`).
- **Requirement:** one `repair_target_complete` observing Curly's mount (`curly_stash_mount`), a Mission-authorized target inside HH B&B with exactly The Jag Tier-1 mount's recipe — 6 Refined Ferrite + 3 Slag, six sections, 300 Welding XP paid by the work itself, ordinary Clean Pass. The Mission adds no XP.
- **The mount is Curly's.** It is never a site stash, never storage the player can open, and never an item the player receives. The B&B's **Build Stash Mount** activity appears only while the repair is authorized and unfinished and disappears the moment the last section lands; guidance then hands off to Curly, and his room's art is already the finished one before he pays.
- **Turn-in:** Curly at Holo Hollow, `actionLabel: "COLLECT PAYMENT"`. **Dialogue:** offer, accepted continuation, repair reminder (identical for no, partial, or complete materials), turn-in, completion presentation, post-completion follow-up, and the topics **Seeing the Worlds** (always) and **Back Home** (after completion). No busy beat is authored, declared as a `busy` omission (§9.4), so a busy character hears the turn-in itself.

### Wheel Be Right Back — a manual offer, a ship repair, and parts from anywhere

- **Acceptance:** `prerequisiteMissionId: braceYourself` and **nothing else** — no `prerequisiteSkillLevels`, no A Cut Above, no personal Fabrication or Refining level. Brace Yourself's own ancestry already proves the Cargo Hold chapter, so it is not restated. One offer route, **Wade at Rusk Recovery**, `actionLabel: "TAKE THE JOB"`. It is deliberately **not** Brace Yourself's continuation: the player finishes that Mission, later talks to Wade, and accepts by hand. There is no acceptance effect and no `acceptedContinuation`, because the offer already ends on the shopping list.
- **Requirement:** one `repair_target_complete` observing the **Landing Gear** (`landing_gear`), a Mission-authorized target at the Crash Site — "Repair the Landing Gear at the Crash Site". Its recipe is balance (`repairTargets.landingGear`): 2 Wheel Assemblies + 2 Mounting Brackets + 1 Galvanic Wire Spool, twelve sections, ordinary Welding cadence, XP and Clean Pass. Because it consumes finished components by item ID with no provenance, a character who fabricated them and one who bought or traded for them are indistinguishable.
- **Turn-in:** Wade at **Rusk Recovery** (not the Crash Site, where the work is), `actionLabel: "REPORT REPAIR"`. **Reward:** `{ kind: "skill_xp", skillId: welding, amount: 250 }`, paid once by the ordinary completion stamp — 600 from the sections plus 250 is 850 ordinary Welding XP before Clean Pass.
- **Nothing opens.** Finishing it unlocks no flight, route, fuel or Propulsion Mission and starts nothing. The target authors `completedStatus`, which the shared ship-system panel (`docs/gameplay-foundations.md`) shows — "Landing gear restored." (#330 removed the "Propulsion offline" clause so this line never has to change again) — read from the repair's own completion. That panel is on the Crash Site from the start as a damaged system and expands into the standard repair presentation only once this Mission is accepted. There is no second flag and no ship-art change: the Crash Site keeps showing the crashed ship until Thrust Issues' Propulsion System is repaired.
- **Dialogue:** the locked offer and active reminder, plus the beats the design did not define, authored in Wade's voice (`docs/npc-canon.md`): a busy beat, the turn-in opening, the completion (the 250 Welding XP tile and the two locked lines) and a post-completion follow-up. Wade is at Rusk Recovery by this point, so every beat is authored against the yard. He has three portraits — neutral, concerned and scowl — and the expression carries what the words do not: neutral is his flat working default, scowl is the gruff deflection he reaches for when something sounds like a kindness or a hand-off, and concerned is for the job being the ship itself. The reminder is one beat for every unfinished state (nothing installed, part installed, mid-weld), so it assumes none of them.

### Thrust Issues — a Welding-8 job, a repair that restores the ship, and a report that pays nothing

- **Acceptance:** `prerequisiteMissionId: wheelBeRightBack` and `prerequisiteSkillLevels: [{ welding, 8 }]` (§3) and **nothing else** — no personal Refining or Fabrication level, no A Cut Above, no repeated Cargo Hold prerequisite, and no component provenance. One offer route, **Wade at Rusk Recovery**, `actionLabel: "FIX THE DRIVE"`. It is deliberately **not** Wheel Be Right Back's continuation: the player finishes that Mission, reaches Welding 8, later talks to Wade and accepts by hand. Below Welding 8 the Mission is not advertised at all (§3), and the acceptance command refuses a forged request. There is no acceptance effect and no `acceptedContinuation`, because the offer already ends on the shopping list.
- **Requirement:** one `repair_target_complete` observing the **Propulsion System** (`propulsion_system`), a Mission-authorized target at the Crash Site — "Repair the Propulsion System at the Crash Site". Its recipe is balance (`repairTargets.propulsion`): 2 Drive Mounts + 1 Galvaferrite + 2 Mounting Brackets + 1 Galvanic Wire Spool, sixteen sections, ordinary Welding cadence, XP and Clean Pass. The target's authorization sets `requiresMissionWeldingLevel`, so the repair controls and commands need personal Welding 8 as well as the accepted Mission, through the same access predicate. The level is read from this Mission's own `prerequisiteSkillLevels`, so Welding 8 is authored in exactly one place.
- **Turn-in:** Wade at **Rusk Recovery**, `actionLabel: "REPORT REPAIR"`. **Reward: none.** The 16 sections already paid 800 ordinary Welding XP, and the report adds no XP, Credits or item, which is why the Mission authors no `reward` and its completion presentation has no reward beat.
- **Two facts, not one.** Finishing the repair is the *physical* fact: the Crash Site immediately shows the approved repaired ship and the Propulsion System reads "Propulsion restored. Report to Wade." Turning in to Wade is the separate *narrative* fact, after which the status reads "Propulsion restored. Ship flight-ready." Neither is duplicated into a stored flag. Neither opens a flight control, route, fuel or reserve; first flight, the next world and fuel are separate follow-on slices that can read these two existing facts.
- **Dialogue:** the locked offer, active reminder and completion lines, verbatim, in Wade's own expressions (neutral, concerned, neutral, scowl for the offer; neutral then scowl for the completion). Three beats the design did not define are authored in his register from what the repair itself already says — a busy beat, a one-line turn-in opening ("Mounts seated. Frame welded. Good.") and a one-line follow-up that restates only the locked verdict, so it never goes stale and promises no flight or fuel. The deferred fuel warning and first-flight prompt are deliberately absent.


### Not From Around Here — an item offers it, three contacts on Skatboll, and the Wise Old Enby on Stillreach (#369, #389)

- **Acceptance:** an `itemOffer` listing the **Rune Fragment and the intact Runestone** (§4.1): a carried stack of either glows blue (artwork hopping), Inspect opens the compact **New mission** offer, and "Start mission" is the generic acceptance transaction and **consumes neither item**. On Stillreach the **Wise Old Enby** at Hilltop Workshop makes the same offer in person — one NPC offer with `requiresCarriedOfferItem`, `subject: "Show strange mineral"`, `actionLabel: "Start mission"`, `declineLabel: "Not now"` — to a visitor carrying either stone; accepting returns to the Enby's hub, which now lists the revelation. Both lose the offer once the one Mission is accepted. No prerequisite, no skill gate, no quest-only item and no acquisition provenance. A stack kept in the Cargo Hold or a stash does not offer it.
- **Requirement:** one `npc_conversation` with **Tolliver Kade** at Holo Hollow Landing (`progressKey: "toll-lead"`, `actionLabel: "NOTED"`) carrying `leads` for **Wade Rusk** and **Tansy Rusk** (`progressKey: "toll-hint"`, `actionLabel: "WORTH ASKING"`), with `appliesOnPlanetId: skatboll` (§5.4).
- **Turn-in:** the Wise Old Enby at Hilltop Workshop, stationary, objective "Find the researcher at Hilltop Workshop on Stillreach", `actionLabel: "I UNDERSTAND"`. No reward, no consumption, no completed-story dialogue. Lifecycle: `busy` is declared omitted; since #391 the completion presentation is the First Runeworking Lesson scene and the continuation accepts that lesson (below). Back at the Enby's hub, **About RuneSpace** and **Where to Find Fragments** (`mission_completed` topics) now appear.
- **Skatboll guidance:** before Toll, the objective "Find someone who might recognize the unusual fragment", with the Log naming all three contacts and their three World Locations lit at once — Wade and Tansy wherever they stand for this character, Toll at the Landing; a shared hex is one hex. A Wade or Tansy hint narrows everything to Toll ("Ask Tolliver Kade at Last Leg Trading about the fragment"). After Toll the Toll row is done and the objective is the turn-in's; the only target is Hilltop Workshop, which Skatboll's map does not draw, so no Skatboll hex lights.
- **Stillreach guidance:** the Toll requirement is waived, so whether or not Toll (or a hint) happened the objective is the turn-in's, the Log lists no rows, Hilltop Workshop is the one TURN IN hex and, on arrival, the Enby's Talk is the target. No Skatboll contact is pinned. Flying back restores the unfinished Skatboll investigation exactly. Nothing about Toll is ever recorded except by Toll's own scene.
- **Openings:** a `conversation_acknowledged` reactive fact (`toll-sent`, reading `toll-lead`) chooses the Toll opening ("Toll sent you, did they?…"); otherwise the direct opening ("You've come looking for someone who understands unusual minerals…"). Both continue into the same eight-beat explanation, written out in each sequence so QC Studio can edit them, and both carry the one completion command. The stone does not have to be carried at completion.
- **Progress is recorded only by terminal controls.** Opening Talk, starting or scrolling a scene, Back, Restart, unrelated topics or visiting a hex record nothing; the completion stamp is written only by I UNDERSTAND through the generic `completeMission`, under the character lock and the `completed_at IS NULL` guard, so retries, double-clicks and concurrent clients converge on one completion.
- **Persistence and migration.** Reuses `character_missions` and `character_mission_progress` only; no schema change and no database migration. Existing accepted saves keep their `toll-lead` / `toll-hint` rows and read them through the new definition: a character parked at the old deferred stage (Toll acknowledged) is simply in the turn-in phase now, and nothing is reset or backfilled.
- **The continuation (#391).** Not From Around Here now authors `continuationMissionId: firstRuneworkingLesson`, so a completion from now on accepts the lesson in the same transaction, and `completionPresentationDialogueId: wiseOldEnbyFirstLesson` plays the lesson's instruction scene right after I UNDERSTAND. A character who completed it before the lesson shipped gets the same lesson through the Enby's ordinary prerequisite-gated offer (below). That is an authoring pattern, not reconciliation: no login scan, SQL repair or backfill. Completing it also opens the Resonance Rig at Hilltop Workshop, read from the completion stamp (`HILLTOP_WORKSHOP_CONTENT`), whether or not the lesson is ever accepted. The Mission itself still pays nothing.

### First Runeworking Lesson — two routes to one lesson, three real attunements, and the Enby's turn-in (#391)

- **Acceptance:** either Not From Around Here's continuation (above) or, for a character who finished the mystery earlier, the Wise Old Enby's NPC offer at Hilltop Workshop — `prerequisiteMissionId: notFromAroundHere`, `actionLabel: "Begin Lesson"`, `declineLabel: "Not Now"`, `acceptedContinuation` the lesson scene. Once accepted by either route the offer is gone, so the lesson can never be offered twice. Nothing about the Rig needs the conversation: it opens with the mystery's completion.
- **Requirement:** one `tracked_activity` — `runeworking`, `metric: "completions"`, `actionId: beginnerEchoSeekerRuneworking`, `target: 3`, `progressKey: "seekers-attuned"`, `recommendedActionId` the same action, `presentsOutputSources: true` (§10, Item sources). Only Seekers attuned after acceptance count, across runs, Max, Finish Current, reconnects and sessions, capped at 3/3; Seekers made before acceptance (the approved pre-alpha tradeoff), held, traded or received count for nothing.
- **Turn-in:** the Wise Old Enby at Hilltop Workshop, stationary, objective "Return to the Wise Old Enby at Hilltop Workshop", `actionLabel: "Complete First Runeworking Lesson"`. Never automatic: 3/3 hands off to the blue turn-in, and a running attunement (busy) refuses it. Nothing is consumed; the Seekers stay the player's.
- **Reward:** `skill_xp` 150 Runeworking once, presented by the completion scene's `skill_xp` beat. Three attunements pay 75 more on their own, 225 toward Level 2 in all.
- **Dialogue:** offer, lesson scene (accepted continuation and Not From Around Here's completion presentation), tracked-activity reminder, turn-in and completion presentation, all verbatim. The lesson scene ends with the Enby's skill-level-dependent Fragment advice (`docs/npc-conversations.md` §8). `busy` is declared omitted (no approved line), so a busy character hears the turn-in opening without its control. Topics **First lesson** (`mission_accepted`), **Where to Find Fragments** (after the mystery) and **About the Seekers** (after the lesson) replay with no command.
- **Continuation (#393).** `continuationMissionId: firstResonanceEcho`. Completing the lesson always pays its 150 RW XP; First Resonance Echo is accepted in the same transaction only when its two-Seeker gift fits (§3.1).
- **Persistence and migration.** The Mission reuses `character_missions`, `character_mission_progress` and `character_skill_xp`. The Rig's run state is a new table, `character_runeworking_state` (migration `0047_runeworking_state`).

### First Resonance Echo — a gift that must fit, one Echo on either planet, and the Enby's debrief (#393)

- **Acceptance:** the lesson's continuation (§3.1) or the Wise Old Enby's NPC offer at Hilltop Workshop — `prerequisiteMissionId: firstRuneworkingLesson`, `actionLabel: "Take the Seekers"`, `declineLabel: "Not Now"`, `acceptEffect: { kind: "stack_item", itemId: beginnerEchoSeeker, quantity: 2 }`, `acceptedContinuation` the gift-and-instructions scene. Both routes give the same two Seekers from that one authored effect, all-or-nothing against carried slots and mass; three kept from the lesson become a stack of five. A lesson turn-in without room completes the lesson and skips this Mission; the offer then serves that player (and anyone who finished the lesson before this shipped). Once accepted by either route the offer is gone: the gift is exactly-once and never a top-up.
- **Requirement:** one `tracked_activity` — `echo_hunt`, `metric: "completions"`, `target: 1`, `progressKey: "echoes-found"`, `recommendedActionId: beginnerEchoReading` (the Seeker's Use control glows green). Only a discovery the server resolves after acceptance counts, on either planet; wrong readings, Seekers carried, conversations and pre-acceptance finds never do. The objective copy carries the planet and Inventory-room advice.
- **Turn-in:** the Wise Old Enby at Hilltop Workshop, stationary, objective "Return to the Wise Old Enby at Hilltop Workshop", `actionLabel: "Complete First Resonance Echo"`. Never automatic on discovery.
- **Reward:** `skill_xp` 300 Runeworking once, presented by the completion scene's `skill_xp` beat. Each discovery already paid its own 50; a fresh character's baseline is 3 × 25 + 150 + 50 + 300 = 575 RW XP (Level 2). Repeat hunts pay 50 only.
- **Dialogue (verbatim, owner-approved):** offer (the first gift line), the gift-and-instructions scene (the remaining gift lines with the +2 Seeker item beat, then how to listen), the capacity refusal (shared by slots and mass), the tracked-activity reminder, the debrief turn-in and the completion presentation. `busy` is declared omitted. Topics **How to Listen** (`mission_accepted`) and **About Resonance Echoes** (`mission_completed`) replay with no command; the Stillreach topic gained the Enby's three personal beats before its unchanged closing line.
- **Persistence and migration.** The Mission reuses `character_missions`, `character_mission_progress` and `character_skill_xp`. Hunts and reading results are `character_echo_hunts` and `echo_reading_notices` (migration `0048_echo_hunts`, additive, no backfill).

### Move Along — the first flight, started by the Thrust Issues report and completed by the landing (#358)

- **Start:** `prerequisiteMissionId: thrustIssues`, no offers (`offers: []`). Thrust Issues' `continuationMissionId` is Move Along, so reporting to Wade at Rusk Recovery accepts it in the same transaction through the normal mission acceptance path (`onConflictDoNothing`, skipped if already complete). Welding the ship alone does not start it. Wade's reminder is Move Along's `activeNpcDialogue`.
- **Requirements (two, in order):** (1) `ship_fuel` on `crash_site_to_holo_hollow_landing`, `itemId: fullSmallFuelCanister` — "Fuel the Rivet for the trip ({required} FU).", satisfied by the ship's live tank covering the route's 10 FU. A canister is never the proof; the tank is, and fuel spent by the launch still counts in the air. (2) `ship_flight` on the same route — "Fly the Rivet from the Crash Site to Holo Hollow Landing.", which only the landing satisfies. The Mission's `autoCompletion` completes it on the landing (§7.1). The Current objective is the first unmet row, so it reads Fuel, then Fly. Sources for the canister is offered only while the tank is short.
- **No turn-in, no reward, no completion scene.** No XP, Credits, item or free fuel, and no report back to Wade. The landing shows a compact "Flight complete — Arrived at Holo Hollow Landing" / "Mission Complete: Move Along" notice (a durable, dismissible receipt, not a toast) and the Mission Log carries the normal completed card.
- **Gating the first flight.** The route authors `requiredAcceptedMissionId: move_along`, so the first Crash Site launch is refused until the ordinary accepted record exists, even with the ship repaired and fuel loaded; the Ship panel says "Report Thrust Issues to Wade at Rusk Recovery to start Move Along." Once the Mission is complete this gates nothing.
- **Dialogue (locked copy, verbatim):** the approved send-off is the last three beats of Wade's Thrust Issues completion scene ("Hm. Still here?" … "Fly it over. Land it. And for once, don't make me come look at it."; there is no separate offer), a one-beat reminder ("Crash Site to Holo Hollow Landing. Ten fuel units. Fuel the Rivet, fly it over, land it. In that order.") and a two-beat idle line once the Rivet has landed ("Heard the Rivet made the Landing." / "Nobody's asked me to tow it back yet. Good."). The idle line replaces the post-Thrust Issues one only once Move Along is actually complete (the hub scans completed Missions newest-first). Wade's Thrust Issues completion lines are unchanged; only the offer's closing jab, which wrongly put the wreck on his front lawn, now says "Fix it, and you're on your own. I'm done holding your hand."
- **Reset.** Resetting a chain from an operator console clears the Mission records (Move Along follows Thrust Issues in the reset scope) but not the ship row: where the ship is berthed is physical state, not Mission state.
