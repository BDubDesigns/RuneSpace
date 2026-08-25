import type { MissionDefinition, MissionObjectiveStep } from "@/game/content/missions";

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

function stepSatisfied(step: MissionObjectiveStep, observation: MissionObservation): boolean {
  if (step.kind === "equip_item") return observation.equippedItemIds.has(step.itemId);
  const required = requiredQuantity(step, observation);
  return (observation.carriedQuantities.get(step.itemId) ?? 0) >= required;
}

export function deriveMissionState(input: {
  mission: MissionRecordState | undefined;
  relevantLocationId: string;
  currentLocationId: string;
  stationary: boolean;
}): MissionState {
  if (!input.mission?.acceptedAt) return "not_accepted";
  if (input.mission.completedAt) return "completed";
  if (input.currentLocationId === input.relevantLocationId && input.stationary) {
    return "ready_for_completion";
  }
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
    if (step) return renderObjectiveTemplate(step.template, step, observation);
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
): MissionProjection {
  const state = deriveMissionState({
    mission,
    relevantLocationId: definition.relevantLocationId,
    currentLocationId,
    stationary,
  });
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
    completionNpcId: definition.completionNpcId,
    rewardItemId: definition.reward.kind === "item" ? definition.reward.itemId : undefined,
  };
}
