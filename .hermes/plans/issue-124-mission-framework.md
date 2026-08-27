# Issue #124 — Authoritative Mission Framework (implementation notes)

Branch: `feat/issue-124-mission-framework` from `origin/main` @ `afbf834`.
Contract: issue #124 (canonical handoff of the approved Checkpoint 0 design from #114),
`docs/audits/pre-mission-framework-architecture-audit.md` (#121/#122), AGENTS.md.

## Checkpoint 0 outcome (already approved — not re-litigated)

Migrate Walk It Off + Cut Your Teeth onto one small server-authoritative mission
boundary: authored definitions + closed requirement vocabulary + generic
accept/complete commands + semantic dialogue routing + projected quest guidance.
No persistent phases, no scripting, no reward bundles, no mission #3.

## Surviving architecture (as implemented)

### Content (`game/content/missions.ts`)

- `MissionOffer` — npcId + locationId + dialogueId, optional authored
  accepted-continuation and idle sequences. Walk It Off keeps BOTH real routes
  (Wade @ Crash Site; Tansy @ The Jag for explorer-first remote acceptance).
- `MissionRequirement` — closed union:
  `at_location` (location alone satisfies; stationary is a turn-in constraint),
  `equipped_item` (compatibility from the equipment SSOT, never duplicated),
  `carried_stack` (quantity optional → canonical stackLimit; explicit
  `turnIn: "show" | "consume_required_quantity"`; optional validated
  `recommendedActionId`).
- `MissionTurnIn` — npcId + authored locationId + `requiresStationary: true` +
  objective copy + dialogueId. Mission location semantics NEVER derive from
  `npc.homeLocationId` (future moving-NPC features can't break an accidental
  home-equals-location invariant).
- `MissionDialogue` — authored semantic mapping: equipmentReminder /
  carriedReminder / busy / completionPresentation / capacitySlots / capacityMass.
- Registry validation (`validateMissionDefinitions`, domain layer) at module
  load: offers present, prerequisite known + no self-cycle, NPC/location/item
  exist, carried requirements target stackable items within the authoritative
  stack limit, `recommendedActionId` validated against the authoritative
  action-output SSOT (`getActionOutputItemIds` in balance.ts — no duplicated
  drop tables; Scavenge has no ActionId so it can never be authored), reward
  item/skill valid (skill requires an approved progression curve).

### Projection (`game/domain/missions.ts`)

Every ordinary mission uses the SAME ordered projection path — no "no steps
means travel mission" special case:
- 4-valued state unchanged (not_accepted / active / ready_for_completion / completed);
- first unmet requirement in authored order owns the objective copy; all-satisfied
  → authored turn-in objective;
- `stage`: `requirementsSatisfied` / `turnInAvailable` (busy ⇒ satisfied but not
  turn-in-available) / `nextObjectiveKind` (`at_location | equipped_item |
  carried_stack`);
- `guidance`: `npcId` (turn-in NPC once requirements hold; offer NPC for an
  authored available-not-accepted mission), `equipmentItemId` (first unmet equip),
  `actionId` (first unmet carried requirement's validated recommendation);
- `deriveQuestGuidanceTargets(projections)` → one union of targets for all UI
  consumers; no prose parsing anywhere.

### Commands (`server/missions.ts`)

`acceptMission(userId, characterId, missionId, npcId)` and
`completeMission(userId, characterId, missionId, npcId)` replace all four
bespoke commands. Schemas (`AcceptMissionRequestSchema` /
`CompleteMissionRequestSchema`) carry ONLY characterId + missionId + npcId —
items, quantities, consume flags, rewards, prerequisite status, and completion
eligibility are never accepted from the client and are revalidated inside the
character lock.

Completion transaction order:
1. resolve due gameplay work (resolver boundary unchanged);
2. lock/re-read mission rows → accepted? completed? prerequisite re-check;
3. exact turn-in NPC + authored turn-in location + stationary;
4. re-read equipment/inventory `FOR UPDATE`, re-evaluate EVERY requirement in
   authored order (refusal precedence preserved: at_location → equipment →
   insufficient items);
5. for each `consume_required_quantity` requirement: exact PURE removal plan via
   `planExactStackRemoval` (no mutation), plans applied cumulatively to an
   in-memory candidate inventory;
6. item-reward preflight against the POST-consumPTION candidate
   (`deriveEquipmentLoadout` over candidate stacks) — consumption may
   legitimately free slots/mass;
7. only when the whole plan is valid: apply removals via the #112 boundary
   (`applyStackRemovalPlan`), apply the single declared reward
   (`itemInstances` insert | `grantCharacterSkillXp` via canonical
   `skillLevelThresholds(skillId)`), stamp `completedAt` under the `isNull`
   guard. Any failure rolls everything back; exactly-once via character lock +
   guard.

`completeMissionWithDefinition` is the framework-level test seam (synthetic
definitions; production always resolves through the registry).

### Dialogue routing (`game/content/dialogue.ts`)

`resolveNpcMissionDialogue(npcId, projections)` — ONE generic router over
registry reverse order: offers (not_accepted + prerequisiteSatisfied) → active
(turn-in NPC stage branches: turnIn / busy / equipmentReminder / carriedReminder;
other offer NPCs get authored idle) → completed (turn-in NPC →
completionPresentation; others → idle). Removed `getWalkItOffDialogue`,
`getCutYourTeethActiveDialogue`, `getCutYourTeethCompletion`,
`CUT_YOUR_TEETH_DIALOGUE`, and all mission-ID chains from `NpcInteractionPanel`
(`structural features test proves zero mission-ID literals in features/`).
Capacity refusal + completion presentation resolve from the mission's authored
`dialogue` mapping (`getMissionCapacityRefusalDialogue` /
`getMissionCompletionPresentation`).

### Quest guidance visual

`--rs-quest-guidance-color` (#3dff9e) tokens + `.rs-quest-guidance` treatment
(neon-green border + outline + restrained glow, static — reduced-motion safe) in
globals.css, with a `.rs-bevel` inset-ring variant (clip-path eats outlines).
Consumers: NPC Talk button (NpcInteractionPanel), Cutter Inventory tile,
Equipment "Equip in slot" affordance, Start Mining, Start Refining — every one
reads the single derived target set and sets `data-quest-guidance`; none branch
on mission IDs, prose, or drop tables.

## Milestones (all four)

1. ✅ M1 — framework expresses/projects both missions (types, registry, ordered
   projection, validation).
2. ✅ M2 — generic atomic accept/complete: show/consume, post-consumption
   preflight, exactly-once, rollback.
3. ✅ M3 — guidance projection + neon-green consumers (Talk, Cutter tile,
   Equip, Start Mining, Start Refining).
4. ✅ M4 — bespoke paths removed; tests migrated + framework tests
   (`tests/unit/mission-framework.test.ts` registry validation / schema
   forged-input immunity / structural consumer check;
   `tests/integration/mission-framework.test.ts` synthetic consume proofs:
   exact consumption, insufficiency refusal without writes, post-consumption
   capacity success + refusal, mid-transaction rollback, concurrent exactly-once
   XP, wrong-NPC refusal, show-zero); E2E guidance assertions added to both
   mission journeys.

## Mission-specific paths removed / retained

Removed: `acceptWalkItOff`, `completeWalkItOff`, `acceptCutYourTeeth`,
`completeCutYourTeeth`, their four server actions + schemas, two dialogue
routing helpers + CYT dialogue table, and the `NpcInteractionPanel`
mission-ID dispatch chain.

Retained (justified): authored dialogue SEQUENCES (content), the
`tansyAfterRemoteAcceptance` accepted-continuation (genuine unique
presentation behavior), capacity refusal + completion presentation dialogues
(authored presentation), and `Claim Cutter` / `SHOW SHALE` action labels
(authored copy). The `completeMissionWithDefinition` seam is test-only.

## Deliberately not generalized

Phases/moving NPCs (requirement vocabulary kept reusable for a future phase
wrapper), reward bundles, scripting, per-step ledgers, Quest Log redesign,
admin #113, mission #3.
