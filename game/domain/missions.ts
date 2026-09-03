import { getItemDefinition, skillLevelThresholds } from "@/game/config/balance";
import { getActionOutputItemIds } from "@/game/domain/action-outputs";
import { getDialogue } from "@/game/content/dialogue";
import { getLocation } from "@/game/content/locations";
import { getNpc } from "@/game/content/npcs";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { getSkillPresentation } from "@/game/content/skill-presentation";
import type {
  MissionDefinition,
  MissionRequirement,
  MissionRequirementKind,
} from "@/game/content/missions";

export type MissionState = "not_accepted" | "active" | "ready_for_completion" | "completed";

export type MissionRecordState = {
  acceptedAt?: Date | null;
  completedAt?: Date | null;
};

/**
 * Inputs observed from authoritative character state. The projection never
 * reads React or browser state; persistence supplies these on every command.
 */
export type MissionObservation = {
  /** The item currently occupies its compatible equipment slot. */
  equippedItemIds: ReadonlySet<string>;
  /** Current carried quantity by item ID (inventory is the durable state). */
  carriedQuantities: ReadonlyMap<string, number>;
  /** Authoritative stack limit by item ID (from item definitions). */
  stackLimits: ReadonlyMap<string, number>;
  /** Authoritative display names by item ID for authored copy. */
  itemNames: ReadonlyMap<string, string>;
};

/**
 * Semantic mission-guidance targets projected from mission state. UI consumers
 * answer one common question — "is this entity/control currently a
 * mission-guidance target?" — without inspecting mission IDs, objective prose,
 * or drop tables.
 */
export type MissionGuidance = {
  /** The NPC whose interaction the current objective requires. */
  npcId?: string;
  /** The item whose equipped state is the first unmet requirement. */
  equipmentItemId?: string;
  /** The authored recommended acquisition action for the first unmet carried requirement. */
  actionId?: string;
  /**
   * The NPC(s) whose authored offer interaction is currently a
   * mission-availability target. Only missions with NO prerequisite author
   * open discovery: every offer whose location matches the player's current
   * location for a mission that is not yet accepted and not completed.
   * Prerequisite-gated missions never advertise — a prerequisite is an
   * eligibility rule, not a reveal mechanism. Availability guides NPC
   * interactions only; advancement after acceptance guides NPC/equipment/
   * action progression.
   */
  availableNpcIds?: readonly string[];
};

/**
 * One player-facing current-stage requirement with live satisfaction and
 * progress. UI surfaces render this generically — they never parse mission
 * definitions or objective prose themselves, and balance values stay
 * authoritative (names/stack limits resolve through the observation).
 */
export type MissionRequirementStatus = {
  kind: MissionRequirementKind;
  /** Rendered objective copy with authoritative names/numbers substituted. */
  objective: string;
  /** Whether this requirement currently holds against authoritative state. */
  satisfied: boolean;
  /**
   * Live quantity progress for carried-stack requirements
   * (`carried` clamps at `required`); absent for other kinds.
   */
  progress?: { carried: number; required: number };
  /** The item this requirement observes, when it observes one. */
  itemId?: string;
  /** The location this requirement observes, when it observes one. */
  locationId?: string;
};

/**
 * The reward that was actually earned by a completed mission. Projected only
 * for completed missions — active missions never preview rewards.
 */
export type MissionEarnedReward =
  | { kind: "item"; itemId: string; itemName: string }
  | { kind: "skill_xp"; skillId: string; skillName: string; amount: number };

export type MissionProjection = {
  missionId: string;
  title: string;
  summary: string;
  state: MissionState;
  currentObjective?: string;
  /**
   * The simultaneous current-stage requirement set: every authored
   * requirement with live satisfaction/progress. Present for accepted,
   * incomplete missions; absent otherwise.
   */
  requirements?: readonly MissionRequirementStatus[];
  /**
   * Completion timestamp for completed missions, when the record supplies
   * one. Never fabricated — absent when unrecorded.
   */
  completedAt?: Date | null;
  /** The reward actually earned; projected only for completed missions. */
  earnedReward?: MissionEarnedReward;
  /**
   * True only when this mission's authored prerequisite (if any) is currently
   * completed for the character. An eligibility rule for acceptance — never
   * a discovery/reveal mechanism.
   */
  prerequisiteSatisfied: boolean;
  /**
   * Semantic mission-stage data for routing, independent of player-facing
   * copy. Objective copy is presentational and must never be parsed to drive
   * mission/dialogue routing.
   */
  stage?: {
    /** All authored requirements currently hold against authoritative state. */
    requirementsSatisfied: boolean;
    /**
     * True only when the character is stationary at the turn-in location AND
     * every requirement is satisfied — i.e. the turn-in is currently
     * performable. A busy character can have requirementsSatisfied true while
     * this is false.
     */
    turnInAvailable: boolean;
    /**
     * The first unsatisfied requirement kind, if any, in authored order. Used
     * only to choose contextual dialogue and guidance, never to gate gameplay.
     */
    nextObjectiveKind?: MissionRequirementKind;
  };
  /** Projected semantic guidance targets (empty when nothing needs guidance). */
  guidance?: MissionGuidance;
};

/** Renders authored copy with authoritative names/numbers; no other rewriting. */
function renderRequirementObjective(
  requirement: MissionRequirement,
  observation: MissionObservation | undefined,
): string {
  if (requirement.kind === "at_location") return requirement.objective;
  const itemName = observation?.itemNames.get(requirement.itemId) ?? requirement.itemId;
  if (requirement.kind === "equipped_item") {
    return requirement.objective.replace("{item}", itemName);
  }
  const required = requiredCarriedQuantity(requirement, observation);
  const carried = Math.min(observation?.carriedQuantities.get(requirement.itemId) ?? 0, required);
  return requirement.objective
    .replace("{item}", itemName)
    .replace("{carried}", String(carried))
    .replace("{required}", String(required));
}

/** Full-stack requirement resolves from the authoritative stack limit, not mission data. */
function requiredCarriedQuantity(
  requirement: Extract<MissionRequirement, { kind: "carried_stack" }>,
  observation: MissionObservation | undefined,
): number {
  if (requirement.quantity !== undefined) return requirement.quantity;
  return observation?.stackLimits.get(requirement.itemId) ?? 1;
}

function requirementSatisfied(
  requirement: MissionRequirement,
  currentLocationId: string,
  observation: MissionObservation | undefined,
): boolean {
  switch (requirement.kind) {
    case "at_location":
      return currentLocationId === requirement.locationId;
    case "equipped_item":
      return observation?.equippedItemIds.has(requirement.itemId) ?? false;
    case "carried_stack": {
      const carried = observation?.carriedQuantities.get(requirement.itemId) ?? 0;
      return carried >= requiredCarriedQuantity(requirement, observation);
    }
  }
}

function firstUnsatisfiedRequirement(
  definition: MissionDefinition,
  currentLocationId: string,
  observation: MissionObservation | undefined,
): MissionRequirement | undefined {
  return definition.requirements.find(
    (requirement) => !requirementSatisfied(requirement, currentLocationId, observation),
  );
}

/**
 * True when every authored requirement currently holds against authoritative
 * state. Location/stationary alone never makes a mission completion-ready:
 * the actual authored requirements (location, equipment, carried quantities)
 * must all be satisfied too.
 */
function requirementsHold(
  definition: MissionDefinition,
  currentLocationId: string,
  observation: MissionObservation | undefined,
): boolean {
  return definition.requirements.every((requirement) =>
    requirementSatisfied(requirement, currentLocationId, observation),
  );
}

export function deriveMissionState(input: {
  mission: MissionRecordState | undefined;
  definition: MissionDefinition;
  currentLocationId: string;
  stationary: boolean;
  observation?: MissionObservation | undefined;
}): MissionState {
  if (!input.mission?.acceptedAt) return "not_accepted";
  if (input.mission.completedAt) return "completed";
  // Turn-in eligibility requires stationary presence AT the authored turn-in
  // location, independently of the requirement list: `at_location`
  // requirements control objective progression, while `turnIn.locationId` is
  // its own authoritative turn-in constraint. Authors never need to
  // duplicate the turn-in location as a requirement to keep eligibility
  // correct.
  const holds =
    input.stationary &&
    input.currentLocationId === input.definition.turnIn.locationId &&
    requirementsHold(input.definition, input.currentLocationId, input.observation);
  if (holds) return "ready_for_completion";
  return "active";
}

/**
 * Ordered objective projection: the first unmet requirement in authored order
 * owns the current objective copy; once every requirement holds, the authored
 * turn-in objective shows. Every ordinary mission uses this same path.
 */
function deriveCurrentObjective(
  definition: MissionDefinition,
  currentLocationId: string,
  observation: MissionObservation | undefined,
): string {
  const firstUnsatisfied = firstUnsatisfiedRequirement(definition, currentLocationId, observation);
  if (firstUnsatisfied) return renderRequirementObjective(firstUnsatisfied, observation);
  return definition.turnIn.objective;
}

/**
 * Projects semantic guidance targets from mission state. Guidance answers
 * "what should the player interact with next" without consumers inspecting
 * mission definitions, objective prose, or drop tables.
 *
 * Availability is intentionally narrow: only prerequisite-free missions
 * advertise open discovery. Prerequisite-gated missions never appear merely
 * because their prerequisite is satisfied — the continuation mechanism (or
 * world discovery) owns that transition.
 */
function deriveGuidance(
  definition: MissionDefinition,
  state: MissionState,
  currentLocationId: string,
  observation: MissionObservation | undefined,
): MissionGuidance | undefined {
  if (state === "completed") return undefined;
  if (state === "not_accepted") {
    if (definition.prerequisiteMissionId) return undefined;
    const availableNpcIds = definition.offers
      .filter((offer) => offer.locationId === currentLocationId)
      .map((offer) => offer.npcId);
    if (availableNpcIds.length === 0) return undefined;
    return { availableNpcIds };
  }
  const firstUnsatisfied = firstUnsatisfiedRequirement(definition, currentLocationId, observation);
  if (!firstUnsatisfied) {
    // Every requirement holds: the turn-in NPC is the interaction target even
    // while the character is still busy (turn-in merely not performable yet).
    return { npcId: definition.turnIn.npcId };
  }
  if (firstUnsatisfied.kind === "equipped_item") {
    return { equipmentItemId: firstUnsatisfied.itemId };
  }
  if (firstUnsatisfied.kind === "carried_stack" && firstUnsatisfied.recommendedActionId) {
    return { actionId: firstUnsatisfied.recommendedActionId };
  }
  return undefined;
}

export function projectMission(
  definition: MissionDefinition,
  mission: MissionRecordState | undefined,
  currentLocationId: string,
  stationary: boolean,
  observation?: MissionObservation,
  prerequisiteCompleted = false,
): MissionProjection {
  const state = deriveMissionState({
    mission,
    definition,
    currentLocationId,
    stationary,
    observation,
  });
  const firstUnsatisfied = firstUnsatisfiedRequirement(definition, currentLocationId, observation);
  const requirementsSatisfied = requirementsHold(definition, currentLocationId, observation);
  const prerequisiteSatisfied = !definition.prerequisiteMissionId || prerequisiteCompleted;
  const active = state === "active" || state === "ready_for_completion";
  return {
    missionId: definition.id,
    title: definition.title,
    summary: definition.summary,
    state,
    currentObjective: active
      ? deriveCurrentObjective(definition, currentLocationId, observation)
      : undefined,
    requirements: active
      ? definition.requirements.map((requirement) =>
          projectRequirement(requirement, currentLocationId, observation),
        )
      : undefined,
    completedAt: state === "completed" ? (mission?.completedAt ?? null) : undefined,
    earnedReward: state === "completed" ? projectEarnedReward(definition) : undefined,
    prerequisiteSatisfied,
    stage: {
      requirementsSatisfied,
      turnInAvailable: state === "ready_for_completion" && requirementsSatisfied,
      nextObjectiveKind: firstUnsatisfied?.kind,
    },
    guidance: deriveGuidance(definition, state, currentLocationId, observation),
  };
}

/** Projects one authored requirement with live satisfaction/progress. */
function projectRequirement(
  requirement: MissionRequirement,
  currentLocationId: string,
  observation: MissionObservation | undefined,
): MissionRequirementStatus {
  const satisfied = requirementSatisfied(requirement, currentLocationId, observation);
  if (requirement.kind === "at_location") {
    return {
      kind: requirement.kind,
      objective: requirement.objective,
      satisfied,
      locationId: requirement.locationId,
    };
  }
  const itemName = observation?.itemNames.get(requirement.itemId) ?? requirement.itemId;
  if (requirement.kind === "equipped_item") {
    return {
      kind: requirement.kind,
      objective: requirement.objective.replace("{item}", itemName),
      satisfied,
      itemId: requirement.itemId,
    };
  }
  const required = requiredCarriedQuantity(requirement, observation);
  const rawCarried = observation?.carriedQuantities.get(requirement.itemId) ?? 0;
  return {
    kind: requirement.kind,
    objective: renderRequirementObjective(requirement, observation),
    satisfied,
    progress: { carried: Math.min(rawCarried, required), required },
    itemId: requirement.itemId,
  };
}

/** Projects the actually-earned reward for a completed mission. */
function projectEarnedReward(definition: MissionDefinition): MissionEarnedReward {
  if (definition.reward.kind === "item") {
    return {
      kind: "item",
      itemId: definition.reward.itemId,
      itemName: resolveItemPresentation(definition.reward.itemId, definition.reward.itemId)
        .displayName,
    };
  }
  return {
    kind: "skill_xp",
    skillId: definition.reward.skillId,
    skillName:
      getSkillPresentation(definition.reward.skillId)?.displayName ?? definition.reward.skillId,
    amount: definition.reward.amount,
  };
}

/**
 * The union of currently projected mission-guidance targets across all missions.
 * UI surfaces consume this single derived set instead of inspecting mission
 * state themselves. `availableNpcIds` (blue) and `npcIds` (green) are
 * semantically distinct: a consumer can tell "new mission here" from "this
 * interaction advances the mission you accepted" without inferring intent
 * from mission state, dialogue IDs, or colours.
 */
export type MissionGuidanceTargets = {
  /** NPC(s) whose authored offer is currently a mission-availability target. */
  availableNpcIds: ReadonlySet<string>;
  /** NPC(s) whose interaction advances/completes an accepted mission. */
  npcIds: ReadonlySet<string>;
  equipmentItemIds: ReadonlySet<string>;
  actionIds: ReadonlySet<string>;
};

export function deriveMissionGuidanceTargets(
  projections: readonly MissionProjection[],
): MissionGuidanceTargets {
  const availableNpcIds = new Set<string>();
  const npcIds = new Set<string>();
  const equipmentItemIds = new Set<string>();
  const actionIds = new Set<string>();
  for (const projection of projections) {
    if (projection.guidance?.availableNpcIds) {
      for (const id of projection.guidance.availableNpcIds) availableNpcIds.add(id);
    }
    if (projection.guidance?.npcId) npcIds.add(projection.guidance.npcId);
    if (projection.guidance?.equipmentItemId)
      equipmentItemIds.add(projection.guidance.equipmentItemId);
    if (projection.guidance?.actionId) actionIds.add(projection.guidance.actionId);
  }
  return { availableNpcIds, npcIds, equipmentItemIds, actionIds };
}

/**
 * Startup validation for authored mission content. Fails fast (module load)
 * on any definition the framework cannot interpret safely, so an authoring
 * mistake never reaches a player as a silent runtime refusal.
 */
export function validateMissionDefinitions(definitions: readonly MissionDefinition[]): void {
  const knownIds = new Set(definitions.map((definition) => definition.id));
  for (const definition of definitions) {
    const where = `Mission "${definition.id}"`;
    if (definition.offers.length === 0) {
      throw new Error(`${where} must author at least one offer interaction.`);
    }
    if (definition.prerequisiteMissionId !== undefined) {
      if (definition.prerequisiteMissionId === definition.id) {
        throw new Error(`${where} cannot be its own prerequisite.`);
      }
      if (!knownIds.has(definition.prerequisiteMissionId)) {
        throw new Error(
          `${where} references unknown prerequisite "${definition.prerequisiteMissionId}".`,
        );
      }
    }
    if (definition.continuationMissionId !== undefined) {
      if (definition.continuationMissionId === definition.id) {
        throw new Error(`${where} cannot continue into itself.`);
      }
      if (!knownIds.has(definition.continuationMissionId)) {
        throw new Error(
          `${where} references unknown continuation mission "${definition.continuationMissionId}".`,
        );
      }
    }
    for (const offer of definition.offers) {
      if (!getNpc(offer.npcId))
        throw new Error(`${where} offer references unknown NPC "${offer.npcId}".`);
      if (!getLocation(offer.locationId)) {
        throw new Error(`${where} offer references unknown location "${offer.locationId}".`);
      }
      assertDialogue(definition.id, offer.dialogueId, "offer");
      if (offer.acceptedContinuationDialogueId) {
        assertDialogue(
          definition.id,
          offer.acceptedContinuationDialogueId,
          "accepted continuation",
        );
      }
      if (offer.activeDialogueId) {
        assertDialogue(definition.id, offer.activeDialogueId, "active");
        assertDialogueNpc(definition.id, offer.activeDialogueId, offer.npcId, "active");
      }
    }
    if (definition.completedNpcDialogue) {
      const seen = new Set<string>();
      for (const entry of definition.completedNpcDialogue) {
        if (!getNpc(entry.npcId))
          throw new Error(`${where} completed dialogue references unknown NPC "${entry.npcId}".`);
        assertDialogue(definition.id, entry.dialogueId, "completed NPC dialogue");
        assertDialogueNpc(definition.id, entry.dialogueId, entry.npcId, "completed NPC dialogue");
        if (seen.has(entry.npcId))
          throw new Error(`${where} duplicates completed dialogue for NPC "${entry.npcId}".`);
        seen.add(entry.npcId);
      }
    }
    for (const requirement of definition.requirements) {
      if (requirement.kind === "at_location") {
        if (!getLocation(requirement.locationId)) {
          throw new Error(
            `${where} requirement references unknown location "${requirement.locationId}".`,
          );
        }
        continue;
      }
      const itemDefinition = getItemDefinition(requirement.itemId);
      if (!itemDefinition) {
        throw new Error(`${where} requirement references unknown item "${requirement.itemId}".`);
      }
      if (requirement.kind === "carried_stack") {
        if (itemDefinition.kind !== "stack") {
          throw new Error(`${where} carried requirement must target a stackable item.`);
        }
        if (
          requirement.quantity !== undefined &&
          (!Number.isInteger(requirement.quantity) || requirement.quantity <= 0)
        ) {
          throw new Error(`${where} carried requirement quantity must be a positive integer.`);
        }
        const resolvedQuantity = requirement.quantity ?? itemDefinition.stackLimit;
        if (resolvedQuantity > itemDefinition.stackLimit) {
          throw new Error(`${where} carried requirement exceeds the authoritative stack limit.`);
        }
        if (requirement.recommendedActionId) {
          const outputs = getActionOutputItemIds(requirement.recommendedActionId);
          if (!outputs || !outputs.includes(requirement.itemId)) {
            throw new Error(
              `${where} recommends action "${requirement.recommendedActionId}" which does not authoritatively produce "${requirement.itemId}".`,
            );
          }
        }
      }
    }
    if (!getNpc(definition.turnIn.npcId)) {
      throw new Error(`${where} turn-in references unknown NPC "${definition.turnIn.npcId}".`);
    }
    if (!getLocation(definition.turnIn.locationId)) {
      throw new Error(
        `${where} turn-in references unknown location "${definition.turnIn.locationId}".`,
      );
    }
    assertDialogue(definition.id, definition.turnIn.dialogueId, "turn-in");
    const dialogue = definition.dialogue;
    if (dialogue.equipmentReminderDialogueId)
      assertDialogue(definition.id, dialogue.equipmentReminderDialogueId, "equipment reminder");
    if (dialogue.carriedReminderDialogueId)
      assertDialogue(definition.id, dialogue.carriedReminderDialogueId, "carried reminder");
    if (dialogue.busyDialogueId) assertDialogue(definition.id, dialogue.busyDialogueId, "busy");
    if (dialogue.completionPresentationDialogueId) {
      assertDialogue(
        definition.id,
        dialogue.completionPresentationDialogueId,
        "completion presentation",
      );
    }
    if (dialogue.capacitySlotsDialogueId)
      assertDialogue(definition.id, dialogue.capacitySlotsDialogueId, "capacity slots");
    if (dialogue.capacityMassDialogueId)
      assertDialogue(definition.id, dialogue.capacityMassDialogueId, "capacity mass");
    if (definition.reward.kind === "item") {
      const rewardDefinition = getItemDefinition(definition.reward.itemId);
      if (!rewardDefinition) {
        throw new Error(`${where} reward references unknown item "${definition.reward.itemId}".`);
      }
      // Definition validation and runtime capability must agree: the generic
      // completion boundary grants item rewards by inserting ONE new unique
      // instance (capacity-preflighted). A stackable item reward has no
      // authorized execution path yet, so it fails fast here instead of
      // passing validation and throwing at runtime. A real mission that needs
      // one earns that path deliberately.
      if (rewardDefinition.kind !== "unique") {
        throw new Error(
          `${where} reward item "${definition.reward.itemId}" must be a unique item; the generic completion boundary does not execute stackable item rewards.`,
        );
      }
    } else {
      if (!Number.isInteger(definition.reward.amount) || definition.reward.amount <= 0) {
        throw new Error(`${where} reward XP amount must be a positive integer.`);
      }
      if (!skillLevelThresholds(definition.reward.skillId)) {
        throw new Error(
          `${where} reward references skill "${definition.reward.skillId}" without an approved progression curve.`,
        );
      }
    }
  }
  assertContinuationGraph(definitions);
}

/**
 * Validates the authored continuation graph across all definitions: no
 * cycles, and no continuation that contradicts the target's prerequisite
 * semantics. A continuation auto-accepts its target, so the target must be
 * acceptable immediately after the predecessor completes — either it has no
 * prerequisite, or its prerequisite IS the predecessor.
 */
function assertContinuationGraph(definitions: readonly MissionDefinition[]): void {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  for (const definition of definitions) {
    if (!definition.continuationMissionId) continue;
    const where = `Mission "${definition.id}"`;
    const target = byId.get(definition.continuationMissionId);
    if (
      target?.prerequisiteMissionId !== undefined &&
      target.prerequisiteMissionId !== definition.id
    ) {
      throw new Error(
        `${where} continues into "${target.id}" but that mission requires prerequisite "${target.prerequisiteMissionId}"; a continuation must target a mission with no prerequisite or one requiring this mission.`,
      );
    }
    const chain = [definition.id];
    let current = target;
    while (current?.continuationMissionId !== undefined) {
      chain.push(current.id);
      if (chain.includes(current.continuationMissionId)) {
        throw new Error(
          `${where} continuation forms a cycle: ${[...chain, current.continuationMissionId].join(" -> ")}.`,
        );
      }
      current = byId.get(current.continuationMissionId);
      if (!current) break;
    }
  }
}

function assertDialogueNpc(
  missionId: string,
  dialogueId: string,
  npcId: string,
  role: string,
): void {
  const sequence = getDialogue(dialogueId);
  if (!sequence) return;
  if (sequence.npcId !== npcId) {
    throw new Error(
      `Mission "${missionId}" ${role} dialogue "${dialogueId}" belongs to NPC "${sequence.npcId}" but is mapped to NPC "${npcId}".`,
    );
  }
}

function assertDialogue(missionId: string, dialogueId: string, role: string): void {
  if (!getDialogue(dialogueId)) {
    throw new Error(`Mission "${missionId}" ${role} references unknown dialogue "${dialogueId}".`);
  }
}

/**
 * The reset scope for "RESET FROM THIS MISSION": the selected mission plus every
 * authored descendant that (directly or transitively) requires it as a
 * prerequisite. Derived purely from the authored `prerequisiteMissionId` edges,
 * never hardcoded to a two-mission list, so a future authored chain is handled
 * automatically.
 *
 * Returns an insertion-ordered list of mission ids to reset, always including
 * the selected mission. A mission that is not in the supplied definitions
 * yields only itself (an unknown id cannot be expanded into a chain).
 */
export function missionChainResetScope(
  missionId: string,
  definitions: readonly { id: string; prerequisiteMissionId?: string }[],
): readonly string[] {
  const children = new Map<string, string[]>();
  for (const definition of definitions) {
    if (definition.prerequisiteMissionId) {
      const list = children.get(definition.prerequisiteMissionId) ?? [];
      list.push(definition.id);
      children.set(definition.prerequisiteMissionId, list);
    }
  }
  const scope: string[] = [];
  const visited = new Set<string>();
  const add = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    scope.push(id);
    for (const child of children.get(id) ?? []) add(child);
  };
  add(missionId);
  return scope;
}
