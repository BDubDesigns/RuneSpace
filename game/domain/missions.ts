import { getItemDefinition, skillLevelThresholds } from "@/game/config/balance";
import { getActionOutputItemIds } from "@/game/domain/action-outputs";
import { getDialogue } from "@/game/content/dialogue";
import { getLocation } from "@/game/content/locations";
import type {
  MissionDefinition,
  MissionRequirement,
  MissionRequirementKind,
} from "@/game/content/missions";
import { getNpc } from "@/game/content/npcs";

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
 * Semantic quest-guidance targets projected from mission state. UI consumers
 * answer one common question — "is this entity/control currently a
 * quest-guidance target?" — without inspecting mission IDs, objective prose,
 * or drop tables.
 */
export type MissionGuidance = {
  /** The NPC whose interaction the current objective requires. */
  npcId?: string;
  /** The item whose equipped state is the first unmet requirement. */
  equipmentItemId?: string;
  /** The authored recommended acquisition action for the first unmet carried requirement. */
  actionId?: string;
};

export type MissionProjection = {
  missionId: string;
  title: string;
  summary: string;
  state: MissionState;
  currentObjective?: string;
  offeringNpcId: string;
  completionNpcId: string;
  rewardItemId?: string;
  /**
   * True only when this mission's authored prerequisite (if any) is currently
   * completed for the character. Used to present a not-yet-accepted mission as
   * available instead of hiding it.
   */
  prerequisiteSatisfied: boolean;
  /** Authoritative display name for the primary offering NPC (for available copy). */
  offeringNpcName?: string;
  /**
   * Player-facing copy shown while the mission is available but not yet
   * accepted, pointing the player at the quest giver.
   */
  availableObjective?: string;
  /**
   * Semantic mission-stage data for routing, independent of player-facing
   * copy. Objective copy is presentational and must never be parsed to drive
   * quest/dialogue routing.
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

/** Full-stack requirement resolves from the authoritative stack limit, not quest data. */
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
 */
function deriveGuidance(
  definition: MissionDefinition,
  state: MissionState,
  prerequisiteSatisfied: boolean,
  currentLocationId: string,
  observation: MissionObservation | undefined,
): MissionGuidance | undefined {
  if (state === "completed") return undefined;
  if (state === "not_accepted") {
    // Only missions that deliberately author an available-state presentation
    // guide the player toward their quest giver (explorer-first missions like
    // Walk It Off author none).
    if (!definition.availableObjective || !prerequisiteSatisfied) return undefined;
    const offer = definition.offers[0];
    return offer ? { npcId: offer.npcId } : undefined;
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
  const offeringNpc = getNpc(definition.offers[0]?.npcId ?? "");
  return {
    missionId: definition.id,
    title: definition.title,
    summary: definition.summary,
    state,
    currentObjective:
      state === "not_accepted" || state === "completed"
        ? undefined
        : deriveCurrentObjective(definition, currentLocationId, observation),
    offeringNpcId: definition.offers[0]?.npcId ?? "",
    offeringNpcName: offeringNpc?.displayName,
    completionNpcId: definition.turnIn.npcId,
    rewardItemId: definition.reward.kind === "item" ? definition.reward.itemId : undefined,
    prerequisiteSatisfied,
    availableObjective: definition.availableObjective,
    stage: {
      requirementsSatisfied,
      turnInAvailable: state === "ready_for_completion" && requirementsSatisfied,
      nextObjectiveKind: firstUnsatisfied?.kind,
    },
    guidance: deriveGuidance(
      definition,
      state,
      prerequisiteSatisfied,
      currentLocationId,
      observation,
    ),
  };
}

/**
 * The union of currently projected quest-guidance targets across all missions.
 * UI surfaces consume this single derived set instead of inspecting mission
 * state themselves.
 */
export type QuestGuidanceTargets = {
  npcIds: ReadonlySet<string>;
  equipmentItemIds: ReadonlySet<string>;
  actionIds: ReadonlySet<string>;
};

export function deriveQuestGuidanceTargets(
  projections: readonly MissionProjection[],
): QuestGuidanceTargets {
  const npcIds = new Set<string>();
  const equipmentItemIds = new Set<string>();
  const actionIds = new Set<string>();
  for (const projection of projections) {
    if (projection.guidance?.npcId) npcIds.add(projection.guidance.npcId);
    if (projection.guidance?.equipmentItemId)
      equipmentItemIds.add(projection.guidance.equipmentItemId);
    if (projection.guidance?.actionId) actionIds.add(projection.guidance.actionId);
  }
  return { npcIds, equipmentItemIds, actionIds };
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
      if (offer.idleDialogueId) assertDialogue(definition.id, offer.idleDialogueId, "idle");
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
}

function assertDialogue(missionId: string, dialogueId: string, role: string): void {
  if (!getDialogue(dialogueId)) {
    throw new Error(`Mission "${missionId}" ${role} references unknown dialogue "${dialogueId}".`);
  }
}
