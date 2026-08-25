import type { MissionDefinition, MissionObjectiveStep } from "@/game/content/missions";
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
  /** Authoritative display name for the offering NPC (for available copy). */
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
    /** All authored objective steps currently hold against authoritative state. */
    requirementsSatisfied: boolean;
    /**
     * True only when the character is stationary at the mission location AND
     * requirements are satisfied — i.e. the turn-in is currently performable.
     * A busy character can have requirementsSatisfied true while this is false.
     */
    turnInAvailable: boolean;
    /**
     * The first unsatisfied step kind, if any, in authored order. Used only
     * to choose contextual dialogue (equip vs stack vs turn-in), never to
     * gate gameplay.
     */
    nextObjectiveKind?: "equip_item" | "carry_stack";
  };
};

/** Renders authored copy with authoritative names/numbers; no other rewriting. */
function renderObjectiveTemplate(
  template: string,
  step: MissionObjectiveStep,
  observation: MissionObservation,
): string {
  const itemName = observation.itemNames.get(step.itemId) ?? step.itemId;
  return template
    .replace("{item}", itemName)
    .replace(
      "{carried}",
      String(
        Math.min(
          observation.carriedQuantities.get(step.itemId) ?? 0,
          requiredQuantity(step, observation),
        ),
      ),
    )
    .replace("{required}", String(requiredQuantity(step, observation)));
}

/** Full-stack requirement resolves from the authoritative stack limit, not quest data. */
function requiredQuantity(step: MissionObjectiveStep, observation: MissionObservation): number {
  if (step.kind !== "carry_stack") return 1;
  if (step.quantity !== undefined) return step.quantity;
  return observation.stackLimits.get(step.itemId) ?? 1;
}

function stepSatisfied(
  step: MissionObjectiveStep,
  observation: MissionObservation | undefined,
): boolean {
  if (!observation) return false;
  if (step.kind === "equip_item") return observation.equippedItemIds.has(step.itemId);
  const required = requiredQuantity(step, observation);
  return (observation.carriedQuantities.get(step.itemId) ?? 0) >= required;
}

/**
 * True when the mission's authored objective steps ALL currently hold against
 * authoritative state. Location/stationary alone never makes a mission
 * completion-ready: the actual completion requirements (equipment, carried
 * quantities) must be satisfied too.
 */
function stepsSatisfied(
  definition: MissionDefinition,
  observation: MissionObservation | undefined,
): boolean {
  if (!definition.objectiveSteps?.length) return true;
  if (!observation) return false;
  return definition.objectiveSteps.every((step) => stepSatisfied(step, observation));
}

export function deriveMissionState(input: {
  mission: MissionRecordState | undefined;
  definition: MissionDefinition;
  relevantLocationId: string;
  currentLocationId: string;
  stationary: boolean;
  observation?: MissionObservation | undefined;
}): MissionState {
  if (!input.mission?.acceptedAt) return "not_accepted";
  if (input.mission.completedAt) return "completed";
  const atRelevantLocation = input.currentLocationId === input.relevantLocationId;
  const requirementsHold =
    input.stationary && atRelevantLocation && stepsSatisfied(input.definition, input.observation);
  if (requirementsHold) return "ready_for_completion";
  return "active";
}

/**
 * The first unsatisfied authored step wins; once every step holds at the
 * mission location, the completion objective shows. Copy stays authored while
 * all conditions are computed from authoritative state.
 */
function deriveCurrentObjective(
  definition: MissionDefinition,
  state: MissionState,
  currentLocationId: string,
  stationary: boolean,
  observation: MissionObservation | undefined,
): string | undefined {
  if (state === "completed") return undefined;
  if (!definition.objectiveSteps?.length || !observation) {
    // Walk It Off's proven shape: location-based travel/completion copy.
    if (state === "active") {
      return definition.relevantLocationId === currentLocationId
        ? definition.completionObjective
        : definition.travelObjective;
    }
    if (state === "ready_for_completion") return definition.completionObjective;
    return undefined;
  }
  if (state === "active") {
    if (definition.relevantLocationId !== currentLocationId) return definition.travelObjective;
    const step = definition.objectiveSteps.find(
      (candidate) => !stepSatisfied(candidate, observation),
    );
    // An unsatisfied step renders its own objective; when every step holds but
    // the character is busy (not stationary), the completion objective is the
    // accurate next instruction — they already have what the quest asked for.
    if (step) return renderObjectiveTemplate(step.template, step, observation);
    return definition.completionObjective;
  }
  if (state === "ready_for_completion") {
    const step = definition.objectiveSteps.find(
      (candidate) => !stepSatisfied(candidate, observation),
    );
    if (step) return renderObjectiveTemplate(step.template, step, observation);
    return definition.completionObjective;
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
    relevantLocationId: definition.relevantLocationId,
    currentLocationId,
    stationary,
    observation,
  });
  const firstUnsatisfied = definition.objectiveSteps?.find(
    (candidate) => !stepSatisfied(candidate, observation),
  );
  const requirementsSatisfied = stepsSatisfied(definition, observation);
  const offeringNpc = getNpc(definition.offeringNpcId);
  return {
    missionId: definition.id,
    title: definition.title,
    summary: definition.summary,
    state,
    currentObjective:
      state === "not_accepted"
        ? undefined
        : deriveCurrentObjective(definition, state, currentLocationId, stationary, observation),
    offeringNpcId: definition.offeringNpcId,
    offeringNpcName: offeringNpc?.displayName,
    completionNpcId: definition.completionNpcId,
    rewardItemId: definition.reward.kind === "item" ? definition.reward.itemId : undefined,
    prerequisiteSatisfied: !definition.prerequisiteMissionId || prerequisiteCompleted,
    availableObjective: definition.availableObjective,
    stage: {
      requirementsSatisfied,
      turnInAvailable: state === "ready_for_completion" && requirementsSatisfied,
      nextObjectiveKind: firstUnsatisfied?.kind,
    },
  };
}
