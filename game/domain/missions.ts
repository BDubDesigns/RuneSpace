import { getItemDefinition, skillLevelThresholds } from "@/game/config/balance";
import { ACTION_IDS } from "@/game/config/foundations";
import { getActionOutputItemIds } from "@/game/domain/action-outputs";
import { getDialogue } from "@/game/content/dialogue";
import { getLocalPlaceInLocation } from "@/game/content/local-places";
import { getLocation, isActionAvailableAtLocation, LOCATIONS } from "@/game/content/locations";
import { getNpc } from "@/game/content/npcs";
import { getRepairTarget } from "@/game/content/repair-targets";
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
  /** Durable current progress by authored tracked-requirement key. */
  trackedProgress?: ReadonlyMap<string, number>;
  /** Authoritative completion state by repair-target ID (#172). */
  completedRepairTargetIds?: ReadonlySet<string>;
};

/**
 * Semantic mission-guidance targets projected from mission state. UI consumers
 * answer one common question — "is this entity/control currently a
 * mission-guidance target?" — without inspecting mission IDs, objective prose,
 * or drop tables.
 */
export type MissionGuidance = {
  /**
   * The targets below are the Mission's final handoff: every authored
   * requirement holds and only the turn-in remains. This is the turn-in
   * phase, derived from the same requirement check as
   * `stage.requirementsSatisfied` — not "the turn-in command is executable
   * right now" (`stage.turnInAvailable`), so it holds while the player is
   * still somewhere else or busy. Absent while authored work remains.
   */
  turnIn?: true;
  /**
   * The World Location where the next Mission boundary is, when that is not
   * the player's current location. Resolved only from authored data (an
   * `at_location` or `npc_conversation` requirement's location, the turn-in
   * location, or the one location offering a recommended action) and never
   * invented: with several legitimate places and no authored route, there is
   * no destination. Arriving there ends it and hands off to the local
   * boundary below.
   */
  locationId?: string;
  /** The NPC whose interaction the current objective requires. */
  npcId?: string;
  /**
   * The Local Place at the player's current World Location where that `npcId`
   * target lives. A Local Place resident is not on screen until the player
   * steps inside, so the place's entrance carries the guidance until then.
   * Derived from authored NPC placement for accepted Missions only — never
   * from availability, and never the World Location itself.
   */
  localPlaceId?: string;
  /** The item whose equipped state is the first unmet requirement. */
  equipmentItemId?: string;
  /** The authored recommended acquisition action for the first unmet carried requirement. */
  actionId?: string;
  /**
   * The repair surface that is the current progression target: the first unmet
   * requirement observes authoritative completion of this repair target. That
   * surface owns the repair/material/Welding substate and selects the advancing
   * affordance (contribute materials vs start Welding) from this single
   * semantic ID — never from a mission ID or objective prose.
   */
  repairTargetId?: string;
  /**
   * The NPC(s) whose authored offer interaction is currently a local
   * mission-availability target: every offer at the player's current location
   * for a mission that is not accepted, not completed, and whose prerequisite
   * (if any) is satisfied. This is local discovery through the offering NPC
   * only — "this person has work for you" — and never a global signal: it
   * reveals nothing in the Mission Log and contributes no map, route, or
   * destination guidance. Progression after acceptance is separate (`npcId`,
   * `equipmentItemId`, `actionId`, `repairTargetId`).
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
   * Generic numeric progress for carried-stack and tracked-activity
   * requirements; both values are clamped to the authored target.
   */
  progress?: { current: number; target: number };
  /** The item this requirement observes, when it observes one. */
  itemId?: string;
  /** The location this requirement observes, when it observes one. */
  locationId?: string;
  /**
   * The NPC this requirement observes, when it observes one. Conversation
   * routing reads this so a satisfied mandatory conversation can stop being
   * offered without inspecting mission IDs.
   */
  npcId?: string;
  /** The repair target this requirement observes, when it observes one. */
  repairTargetId?: string;
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
  if (requirement.kind === "tracked_activity") {
    const current = Math.min(
      observation?.trackedProgress?.get(requirement.progressKey) ?? 0,
      requirement.target,
    );
    return requirement.objective
      .replace("{current}", String(current))
      .replace("{target}", String(requirement.target));
  }
  if (requirement.kind === "repair_target_complete") return requirement.objective;
  if (requirement.kind === "npc_conversation") return requirement.objective;
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
    case "tracked_activity":
      return (
        (observation?.trackedProgress?.get(requirement.progressKey) ?? 0) >= requirement.target
      );
    case "repair_target_complete":
      return observation?.completedRepairTargetIds?.has(requirement.targetId) === true;
    case "npc_conversation":
      // The durable mission-progress row for this authored key is the only
      // evidence; the conversation itself is never replayed as proof.
      return (observation?.trackedProgress?.get(requirement.progressKey) ?? 0) >= 1;
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
 * Availability is LOCAL discovery only: a mission that is not accepted, whose
 * prerequisite (if any) is satisfied, advertises through the NPC(s) authoring
 * an offer at the player's current location — exactly the offers the
 * conversation hub surfaces, so the Talk control and the hub entry share one
 * answer. It never produces an objective, a progression target, a Local Place
 * entrance, or anything a global surface (Mission Log, map, route) reads.
 *
 * Accepted guidance follows the next authored boundary: a World Location
 * elsewhere (`locationId`), then — once there — the Local Place entrance, NPC,
 * equipment, or action. Once every requirement holds the same handoff chain
 * points at the authored turn-in, flagged `turnIn`.
 */
function deriveGuidance(
  definition: MissionDefinition,
  state: MissionState,
  currentLocationId: string,
  observation: MissionObservation | undefined,
  prerequisiteSatisfied: boolean,
): MissionGuidance | undefined {
  if (state === "completed") return undefined;
  if (state === "not_accepted") {
    if (!prerequisiteSatisfied) return undefined;
    const availableNpcIds = definition.offers
      .filter((offer) => offer.locationId === currentLocationId)
      .map((offer) => offer.npcId);
    if (availableNpcIds.length === 0) return undefined;
    return { availableNpcIds };
  }
  const firstUnsatisfied = firstUnsatisfiedRequirement(definition, currentLocationId, observation);
  if (!firstUnsatisfied) {
    // Every requirement holds: the Mission is in its turn-in phase, and the
    // authored handoff is the target wherever the player is and even while
    // they are busy (the turn-in is merely not performable yet).
    return {
      ...npcBoundaryGuidance(
        definition.turnIn.npcId,
        definition.turnIn.locationId,
        currentLocationId,
      ),
      turnIn: true as const,
    };
  }
  if (firstUnsatisfied.kind === "at_location") {
    // Unsatisfied means the player is elsewhere: the location is the target.
    return { locationId: firstUnsatisfied.locationId };
  }
  if (firstUnsatisfied.kind === "equipped_item") {
    return { equipmentItemId: firstUnsatisfied.itemId };
  }
  if (
    (firstUnsatisfied.kind === "carried_stack" || firstUnsatisfied.kind === "tracked_activity") &&
    firstUnsatisfied.recommendedActionId
  ) {
    return {
      actionId: firstUnsatisfied.recommendedActionId,
      ...actionDestination(firstUnsatisfied.recommendedActionId, currentLocationId),
    };
  }
  if (firstUnsatisfied.kind === "repair_target_complete") {
    return repairTargetGuidance(firstUnsatisfied.targetId, currentLocationId);
  }
  if (firstUnsatisfied.kind === "npc_conversation") {
    // The person to go and meet is the target, exactly as the turn-in NPC is
    // once every requirement holds.
    return npcBoundaryGuidance(
      firstUnsatisfied.npcId,
      firstUnsatisfied.locationId,
      currentLocationId,
    );
  }
  // A carried requirement with no authored route (several legitimate
  // sources) gets no guidance: the framework never picks one for the player.
  return undefined;
}

/**
 * Guidance toward one repair target: its World Location while the player is
 * elsewhere, then — once they have arrived — the Local Place entrance hosting
 * it, if it lives inside one, and finally the repair surface itself. Derived
 * purely from the authored repair-target registry.
 */
function repairTargetGuidance(targetId: string, currentLocationId: string): MissionGuidance {
  const target = getRepairTarget(targetId);
  if (!target) return {};
  if (target.locationId !== currentLocationId) {
    return { repairTargetId: targetId, locationId: target.locationId };
  }
  const place = target.localPlaceId
    ? getLocalPlaceInLocation(currentLocationId, target.localPlaceId)
    : undefined;
  return place
    ? { repairTargetId: targetId, localPlaceId: place.id }
    : { repairTargetId: targetId };
}

/**
 * Guidance toward one NPC at an authored World Location: that location while
 * the player is elsewhere, then the NPC (and its Local Place entrance, if any)
 * once the player has arrived.
 */
function npcBoundaryGuidance(
  npcId: string,
  locationId: string,
  currentLocationId: string,
): MissionGuidance {
  if (locationId !== currentLocationId) return { npcId, locationId };
  return npcGuidance(npcId, currentLocationId);
}

/**
 * Where an authored recommended action can be done, when it cannot be done
 * here: the one World Location that offers it. Several (or none) means there is
 * no single authored destination, so none is invented.
 */
function actionDestination(actionId: string, currentLocationId: string): MissionGuidance {
  if (isActionAvailableAtLocation(currentLocationId, actionId)) return {};
  const offering = LOCATIONS.filter((location) =>
    (location.availableActionIds as readonly string[]).includes(actionId),
  );
  const [only, ...others] = offering;
  return only && others.length === 0 ? { locationId: only.id } : {};
}

/**
 * Guidance toward one NPC at the player's current World Location. When that NPC
 * is the resident of a Local Place here, they only appear once the player steps
 * inside, so the place is carried too and its entrance becomes the target until
 * then. Derived purely from authored NPC placement.
 */
function npcGuidance(npcId: string, currentLocationId: string): MissionGuidance {
  const residentPlaceId = getNpc(npcId)?.localPlaceId;
  const place = residentPlaceId
    ? getLocalPlaceInLocation(currentLocationId, residentPlaceId)
    : undefined;
  return place ? { npcId, localPlaceId: place.id } : { npcId };
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
    guidance: deriveGuidance(
      definition,
      state,
      currentLocationId,
      observation,
      prerequisiteSatisfied,
    ),
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
  if (requirement.kind === "equipped_item") {
    const itemName = observation?.itemNames.get(requirement.itemId) ?? requirement.itemId;
    return {
      kind: requirement.kind,
      objective: requirement.objective.replace("{item}", itemName),
      satisfied,
      itemId: requirement.itemId,
    };
  }
  if (requirement.kind === "tracked_activity") {
    const current = Math.min(
      observation?.trackedProgress?.get(requirement.progressKey) ?? 0,
      requirement.target,
    );
    return {
      kind: requirement.kind,
      objective: renderRequirementObjective(requirement, observation),
      satisfied,
      progress: { current, target: requirement.target },
    };
  }
  if (requirement.kind === "repair_target_complete") {
    return {
      kind: requirement.kind,
      objective: requirement.objective,
      satisfied,
      repairTargetId: requirement.targetId,
    };
  }
  if (requirement.kind === "npc_conversation") {
    return {
      kind: requirement.kind,
      objective: requirement.objective,
      satisfied,
      npcId: requirement.npcId,
    };
  }
  const required = requiredCarriedQuantity(requirement, observation);
  const rawCarried = observation?.carriedQuantities.get(requirement.itemId) ?? 0;
  return {
    kind: requirement.kind,
    objective: renderRequirementObjective(requirement, observation),
    satisfied,
    progress: { current: Math.min(rawCarried, required), target: required },
    itemId: requirement.itemId,
  };
}

/**
 * Projects the actually-earned reward for a completed mission, or nothing when
 * the mission authored no completion reward.
 */
function projectEarnedReward(definition: MissionDefinition): MissionEarnedReward | undefined {
  if (!definition.reward) return undefined;
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
 * state themselves. Three meanings stay semantically distinct even though two
 * share blue presentation: `availableNpcIds` ("this person has work for you",
 * local discovery only), the active sets ("this advances the Mission you
 * accepted", green), and the `turnIn*` sets ("the work is done — hand it in",
 * blue). A consumer never infers one from another, from Mission state,
 * dialogue IDs, or colours.
 */
export type MissionGuidanceTargets = {
  /** NPC(s) whose authored offer is currently a mission-availability target. */
  availableNpcIds: ReadonlySet<string>;
  /** NPC(s) whose interaction advances an accepted Mission's remaining work. */
  npcIds: ReadonlySet<string>;
  /** NPC(s) who are the final handoff of a Mission in its turn-in phase. */
  turnInNpcIds: ReadonlySet<string>;
  /**
   * Local Place(s) at the current World Location whose entrance leads to an
   * accepted Mission's active NPC target (see `MissionGuidance.localPlaceId`).
   */
  localPlaceIds: ReadonlySet<string>;
  /** Local Place(s) here whose entrance leads to a turn-in NPC. */
  turnInLocalPlaceIds: ReadonlySet<string>;
  /** World Location(s) elsewhere where an accepted Mission's next work is (MISSION). */
  locationIds: ReadonlySet<string>;
  /** World Location(s) elsewhere where a Mission's final handoff is (TURN IN). */
  turnInLocationIds: ReadonlySet<string>;
  equipmentItemIds: ReadonlySet<string>;
  actionIds: ReadonlySet<string>;
  /** Repair target(s) whose surface is an accepted Mission's current work (#172). */
  repairTargetIds: ReadonlySet<string>;
};

/** The one Mission meaning a guided control presents. */
export type MissionGuidanceMeaning = "active" | "turn_in" | "available";

/**
 * Where an accepted Mission stands: authored work remains (`work`, green) or
 * every authored requirement holds and only the final handoff remains
 * (`turn_in`, blue) — wherever the player currently is. This is the same fact
 * `guidance.turnIn` carries; it is not "the turn-in is executable right now"
 * (`stage.turnInAvailable`).
 */
export type MissionGuidancePhase = "work" | "turn_in";

export function missionGuidancePhase(
  projection: Pick<MissionProjection, "stage">,
): MissionGuidancePhase {
  return projection.stage?.requirementsSatisfied ? "turn_in" : "work";
}

/**
 * The meaning an NPC's controls present when several Missions target them.
 * Deterministic precedence: active green (work remains) over turn-in blue over
 * available blue — accepted work first, and an accepted Mission's handoff
 * before a new offer. Every underlying fact stays in the target sets.
 */
export function npcGuidanceMeaning(
  targets: MissionGuidanceTargets,
  npcId: string,
): MissionGuidanceMeaning | undefined {
  if (targets.npcIds.has(npcId)) return "active";
  if (targets.turnInNpcIds.has(npcId)) return "turn_in";
  if (targets.availableNpcIds.has(npcId)) return "available";
  return undefined;
}

/** The meaning a Local Place entrance presents; same precedence as NPCs. */
export function localPlaceGuidanceMeaning(
  targets: MissionGuidanceTargets,
  localPlaceId: string,
): Exclude<MissionGuidanceMeaning, "available"> | undefined {
  if (targets.localPlaceIds.has(localPlaceId)) return "active";
  if (targets.turnInLocalPlaceIds.has(localPlaceId)) return "turn_in";
  return undefined;
}

/**
 * The Missions the character has completed.
 *
 * Derived world state (such as a Local Place that opens once a Mission is done)
 * reads this instead of persisting a second unlock flag that could drift from
 * the authoritative completion record.
 */
export function deriveCompletedMissionIds(
  projections: readonly { missionId: string; state: MissionState }[],
): ReadonlySet<string> {
  return new Set(
    projections
      .filter((projection) => projection.state === "completed")
      .map((projection) => projection.missionId),
  );
}

export function deriveMissionGuidanceTargets(
  projections: readonly MissionProjection[],
): MissionGuidanceTargets {
  const availableNpcIds = new Set<string>();
  const npcIds = new Set<string>();
  const turnInNpcIds = new Set<string>();
  const localPlaceIds = new Set<string>();
  const turnInLocalPlaceIds = new Set<string>();
  const locationIds = new Set<string>();
  const turnInLocationIds = new Set<string>();
  const equipmentItemIds = new Set<string>();
  const actionIds = new Set<string>();
  const repairTargetIds = new Set<string>();
  for (const projection of projections) {
    const guidance = projection.guidance;
    if (!guidance) continue;
    if (guidance.availableNpcIds) {
      for (const id of guidance.availableNpcIds) availableNpcIds.add(id);
    }
    const turnIn = guidance.turnIn === true;
    if (guidance.npcId) (turnIn ? turnInNpcIds : npcIds).add(guidance.npcId);
    if (guidance.localPlaceId) {
      (turnIn ? turnInLocalPlaceIds : localPlaceIds).add(guidance.localPlaceId);
    }
    if (guidance.locationId) (turnIn ? turnInLocationIds : locationIds).add(guidance.locationId);
    if (guidance.equipmentItemId) equipmentItemIds.add(guidance.equipmentItemId);
    if (guidance.actionId) actionIds.add(guidance.actionId);
    if (guidance.repairTargetId) repairTargetIds.add(guidance.repairTargetId);
  }
  return {
    availableNpcIds,
    npcIds,
    turnInNpcIds,
    localPlaceIds,
    turnInLocalPlaceIds,
    locationIds,
    turnInLocationIds,
    equipmentItemIds,
    actionIds,
    repairTargetIds,
  };
}

/**
 * Startup validation for authored mission content. Fails fast (module load)
 * on any definition the framework cannot interpret safely, so an authoring
 * mistake never reaches a player as a silent runtime refusal.
 */
export function validateMissionDefinitions(definitions: readonly MissionDefinition[]): void {
  const knownIds = new Set(definitions.map((definition) => definition.id));
  const continuationTargets = new Set(
    definitions
      .map((definition) => definition.continuationMissionId)
      .filter((missionId): missionId is string => missionId !== undefined),
  );
  for (const definition of definitions) {
    const where = `Mission "${definition.id}"`;
    if (definition.offers.length === 0 && !continuationTargets.has(definition.id)) {
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
      if (offer.acceptedContinuation) {
        assertDialogue(
          definition.id,
          offer.acceptedContinuation.dialogueId,
          "accepted continuation",
        );
        if (
          offer.acceptedContinuation.completesMission &&
          definition.turnIn.npcId !== offer.npcId
        ) {
          throw new Error(
            `${where} accepted continuation at NPC "${offer.npcId}" cannot present a turn-in owned by "${definition.turnIn.npcId}".`,
          );
        }
      }
      if (offer.activeDialogueId) {
        assertDialogue(definition.id, offer.activeDialogueId, "active");
        assertDialogueNpc(definition.id, offer.activeDialogueId, offer.npcId, "active");
      }
      if (offer.acceptEffect) {
        if (offer.acceptEffect.kind !== "credits") {
          throw new Error(`${where} offer references an unsupported acceptance effect.`);
        }
        if (!Number.isInteger(offer.acceptEffect.amount) || offer.acceptEffect.amount <= 0) {
          throw new Error(`${where} offer Credit grant must be a positive integer.`);
        }
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
    if (definition.activeNpcDialogue) {
      const offerNpcIds = new Set(definition.offers.map((offer) => offer.npcId));
      const seen = new Set<string>();
      for (const entry of definition.activeNpcDialogue) {
        if (!getNpc(entry.npcId))
          throw new Error(`${where} active dialogue references unknown NPC "${entry.npcId}".`);
        assertDialogue(definition.id, entry.dialogueId, "active NPC dialogue");
        assertDialogueNpc(definition.id, entry.dialogueId, entry.npcId, "active NPC dialogue");
        if (entry.npcId === definition.turnIn.npcId) {
          throw new Error(
            `${where} active NPC dialogue cannot override turn-in dialogue for NPC "${entry.npcId}".`,
          );
        }
        if (offerNpcIds.has(entry.npcId)) {
          throw new Error(
            `${where} active NPC dialogue cannot override an offer NPC for NPC "${entry.npcId}".`,
          );
        }
        if (seen.has(entry.npcId))
          throw new Error(`${where} duplicates active dialogue for NPC "${entry.npcId}".`);
        seen.add(entry.npcId);
      }
    }
    const progressKeys = new Set<string>();
    for (const requirement of definition.requirements) {
      if (requirement.kind === "at_location") {
        if (!getLocation(requirement.locationId)) {
          throw new Error(
            `${where} requirement references unknown location "${requirement.locationId}".`,
          );
        }
        continue;
      }
      if (requirement.kind === "tracked_activity") {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requirement.progressKey)) {
          throw new Error(
            `${where} tracked activity progress key must be lowercase hyphenated text.`,
          );
        }
        if (progressKeys.has(requirement.progressKey)) {
          throw new Error(
            `${where} duplicates tracked activity progress key "${requirement.progressKey}".`,
          );
        }
        progressKeys.add(requirement.progressKey);
        if (requirement.activity !== "mining" && requirement.activity !== "refining") {
          throw new Error(`${where} references unsupported tracked activity.`);
        }
        if (requirement.metric !== "attempts") {
          throw new Error(`${where} references unsupported tracked activity metric.`);
        }
        if (!Number.isInteger(requirement.target) || requirement.target <= 0) {
          throw new Error(`${where} tracked activity target must be a positive integer.`);
        }
        if (requirement.recommendedActionId) {
          const expectedActionId =
            requirement.activity === "mining" ? ACTION_IDS.ferriteShaleMining : ACTION_IDS.refining;
          if (requirement.recommendedActionId !== expectedActionId) {
            throw new Error(
              `${where} tracked activity guidance must target its authoritative activity action.`,
            );
          }
        }
        continue;
      }
      if (requirement.kind === "repair_target_complete") {
        if (!getRepairTarget(requirement.targetId)) {
          throw new Error(
            `${where} repair requirement references unknown repair target "${requirement.targetId}".`,
          );
        }
        continue;
      }
      if (requirement.kind === "npc_conversation") {
        if (!getNpc(requirement.npcId)) {
          throw new Error(
            `${where} conversation requirement references unknown NPC "${requirement.npcId}".`,
          );
        }
        if (!getLocation(requirement.locationId)) {
          throw new Error(
            `${where} conversation requirement references unknown location "${requirement.locationId}".`,
          );
        }
        assertDialogue(definition.id, requirement.dialogueId, "conversation requirement");
        assertDialogueNpc(
          definition.id,
          requirement.dialogueId,
          requirement.npcId,
          "conversation requirement",
        );
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requirement.progressKey)) {
          throw new Error(
            `${where} conversation requirement progress key must be lowercase hyphenated text.`,
          );
        }
        if (progressKeys.has(requirement.progressKey)) {
          throw new Error(`${where} duplicates progress key "${requirement.progressKey}".`);
        }
        progressKeys.add(requirement.progressKey);
        // Routing at the turn-in NPC is stage-owned and an offer NPC owns its
        // own active follow-up, so a mandatory conversation at either would
        // fight an existing owner for the same hub entry.
        if (requirement.npcId === definition.turnIn.npcId) {
          throw new Error(
            `${where} conversation requirement cannot target its own turn-in NPC "${requirement.npcId}".`,
          );
        }
        if (definition.offers.some((offer) => offer.npcId === requirement.npcId)) {
          throw new Error(
            `${where} conversation requirement cannot target offer NPC "${requirement.npcId}".`,
          );
        }
        if (
          definition.requirements.filter(
            (candidate) =>
              candidate.kind === "npc_conversation" && candidate.npcId === requirement.npcId,
          ).length > 1
        ) {
          throw new Error(
            `${where} duplicates a conversation requirement for NPC "${requirement.npcId}".`,
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
    if (dialogue.trackedActivityReminderDialogueId)
      assertDialogue(
        definition.id,
        dialogue.trackedActivityReminderDialogueId,
        "tracked activity reminder",
      );
    if (dialogue.repairReminderDialogueId)
      assertDialogue(definition.id, dialogue.repairReminderDialogueId, "repair reminder");
    if (dialogue.conversationReminderDialogueId) {
      assertDialogue(
        definition.id,
        dialogue.conversationReminderDialogueId,
        "conversation reminder",
      );
    }
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
    if (!definition.reward) {
      // A mission may deliberately author no completion reward when its real
      // outcome is world/social state (Keep the Change pays up front instead).
    } else if (definition.reward.kind === "item") {
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
