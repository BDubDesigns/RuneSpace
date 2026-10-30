import {
  activeMissionStage,
  missionAtStage,
  stageProgress,
  allMissionRequirements,
} from "@/game/domain/mission-stages";
import {
  fabricationActionIds,
  fabricationRecipeForActionId,
  getEffectiveGameBalance,
  getItemDefinition,
  getShipFlightBalance,
  lapidaryActionIds,
  lapidaryRecipeForActionId,
  runeworkingActionIds,
  runeworkingRecipeForActionId,
  skillLevelThresholds,
  tinkeringActionIds,
} from "@/game/config/balance";
import { ACTION_IDS, type DialogueId, type ShipRouteId } from "@/game/config/foundations";
import { getActionOutputItemIds } from "@/game/domain/action-outputs";
import { getDialogue } from "@/game/content/dialogue";
import { getLocalPlaceInLocation } from "@/game/content/local-places";
import {
  getLocation,
  getLocationPlanetId,
  isActionAvailableAtLocation,
  LOCATIONS,
} from "@/game/content/locations";
import { getNpc, resolveNpcPlacement } from "@/game/content/npcs";
import { getRepairTarget } from "@/game/content/repair-targets";
import { getShipRoute } from "@/game/content/ship-routes";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { getSkillPresentation } from "@/game/content/skill-presentation";
import type {
  MissionDefinition,
  MissionDialogue,
  MissionLifecycleMoment,
  MissionOffer,
  MissionReactiveFact,
  MissionRequirement,
  MissionRequirementKind,
  MissionSkillPrerequisite,
  TrackedMissionActivity,
} from "@/game/content/missions";

/**
 * The authoritative actions each tracked activity is performed through. Mission
 * guidance may only recommend an action that genuinely produces the tracked
 * fact, so a new activity adds one entry here rather than a new conditional.
 *
 * The original activities each name their one taught action. Fabrication and
 * Tinkering (#232) are families — one action per authored recipe or target —
 * and a requirement may narrow to one member with `actionId`.
 */
const TRACKED_ACTIVITY_ACTION_IDS: Record<TrackedMissionActivity, () => readonly string[]> = {
  mining: () => [ACTION_IDS.ferriteShaleMining],
  refining: () => [ACTION_IDS.refining],
  practice_welding: () => [ACTION_IDS.practiceWelding],
  // A Work Order completion is observed through the same generic path (#207).
  // The recommended action is the Welding a customer job actually takes, so
  // guidance points at the bench and the terminal that feeds it rather than
  // inventing a Work-Order-shaped guidance kind.
  work_order: () => [ACTION_IDS.workOrderWelding],
  fabrication: () => fabricationActionIds(),
  tinkering: () => tinkeringActionIds(),
  // A family like Fabrication (#391): one action per authored recipe.
  runeworking: () => runeworkingActionIds(),
  lapidary: () => lapidaryActionIds(),
  // A Beginner Echo discovery (#393), made only by reading a Seeker.
  echo_hunt: () => [getEffectiveGameBalance().echoHunts.beginner.readingActionId],
};

/**
 * Each activity's one honest metric. Fabrication and Tinkering count
 * `completions`, because they have a unit that can be started and then not
 * succeed — a busted workpiece is never a fabricated item (#232). Runeworking
 * (#391) counts `completions` too: a cycle is credited only once it has
 * actually made its output, never at its start.
 */
const TRACKED_ACTIVITY_METRICS: Record<TrackedMissionActivity, "attempts" | "completions"> = {
  mining: "attempts",
  refining: "attempts",
  practice_welding: "attempts",
  work_order: "attempts",
  fabrication: "completions",
  tinkering: "completions",
  runeworking: "completions",
  lapidary: "completions",
  // Only a discovery the server resolved counts; a wrong reading is not one.
  echo_hunt: "completions",
};

export type MissionState = "not_accepted" | "active" | "ready_for_completion" | "completed";

export type MissionRecordState = {
  completedStageIds?: readonly string[];
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
  /**
   * Carried, UNEQUIPPED unique instances by item ID (#232). Equipped gear and
   * Cargo Hold contents are never here, so a unique-item turn-in can never
   * reach the tool in the player's hand.
   */
  carriedUniqueItems?: ReadonlyMap<string, number>;
  /** Authoritative stack limit by item ID (from item definitions). */
  stackLimits: ReadonlyMap<string, number>;
  /** Authoritative display names by item ID for authored copy. */
  itemNames: ReadonlyMap<string, string>;
  /** Durable current progress by authored tracked-requirement key. */
  trackedProgress?: ReadonlyMap<string, number>;
  /** Authoritative repair state by repair-target ID (#172). */
  repairTargets?: ReadonlyMap<string, RepairTargetObservation>;
  /**
   * Current authoritative level by skill ID, for `prerequisiteSkillLevel`
   * (#207). Absent means "no level information", which reads as unmet — a
   * projection that cannot see the level must not advertise the offer.
   */
  skillLevels?: ReadonlyMap<string, number>;
  /**
   * The character's ship as the Mission projection may see it (#358): the live
   * tank, and the route of a flight already under way. Absent means no ship
   * information, which reads as an empty tank, never as fuelled.
   */
  ship?: { fuelUnits: number; flightRouteId?: string };
  /**
   * The Missions this character has completed (#369). Read only to resolve
   * where a lead NPC stands for THIS character, because an authored relocation
   * (`resolveNpcPlacement`) is itself derived from completed Missions. Absent
   * resolves the pre-story placement.
   */
  completedMissionIds?: ReadonlySet<string>;
};

/** The approved fuel cost of one authored route, from balance and never a literal. */
function shipFuelRequired(routeId: ShipRouteId): number {
  return getShipFlightBalance(routeId).fuelCostFuelUnits;
}

/**
 * One repair target exactly as the Mission projection is allowed to see it
 * (#172): its authored recipe and its durable progress against that recipe.
 *
 * A repair job has real phases — install the materials, then weld — and the
 * Mission Log should say which one the player is in without any Mission ever
 * being special-cased. That is derived from these numbers alone, so the
 * generic requirement works for the Cargo Hold, the Crew Stop, and whatever
 * comes next.
 *
 * `contributed` is **durably installed** material and nothing else. Carried
 * material is not progress, Cargo Hold contents are not progress, and material
 * the player could go and get is certainly not progress: the observation is
 * built from the repair record, so there is nowhere for those to leak in.
 */
export type RepairTargetObservation = {
  complete: boolean;
  /** Each authored material: how much is installed, and how much the recipe needs. */
  materials: readonly { itemId: string; contributed: number; required: number }[];
  /** Whole Welding increments resolved, against the recipe's total. */
  welding: { completed: number; required: number };
};

/** Which phase of a repair job the player is actually in. */
export type RepairPhase = "materials" | "welding" | "complete";

export function repairPhase(target: RepairTargetObservation | undefined): RepairPhase {
  if (!target) return "materials";
  if (target.complete) return "complete";
  return target.materials.some((material) => material.contributed < material.required)
    ? "materials"
    : "welding";
}

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
  /**
   * Several World Locations that each advance the current objective at once
   * (#406): the Geological Field Survey's remaining sample sites, in any order.
   * They are alternatives of one objective, like `candidates` for contacts, and
   * contribute to the same location target sets as a singular `locationId`.
   */
  locationIds?: readonly string[];
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
  /** A carried item's own action is the next Mission step (distinct from an offer). */
  actionItemId?: string;
  /** The authored recommended acquisition action for the first unmet carried requirement. */
  actionId?: string;
  /**
   * The tracked activity the current objective counts (#232), whether or not
   * it recommends one action: Break It Down counts any Tinkering batch, so the
   * Tinker mode itself — not one recipe — is where the player is guided.
   */
  activity?: TrackedMissionActivity;
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
  /**
   * The carried item(s) whose Item Details offer a Mission the character has
   * not accepted yet (#369): blue "there is a new mission here", local
   * discovery only, exactly like `availableNpcIds`.
   */
  availableItemIds?: readonly string[];
  /**
   * Several equally valid targets for the current objective (#369): a Mission
   * with optional leads points at every contact at once until the first lead is
   * followed. Each candidate carries the same World Location -> Local Place ->
   * NPC handoff a single target does. Absent for an objective with one target,
   * which uses the singular fields above instead.
   */
  candidates?: readonly MissionGuidanceCandidate[];
};

/** One candidate target of a multi-target objective; see `MissionGuidance.candidates`. */
export type MissionGuidanceCandidate = {
  npcId: string;
  locationId?: string;
  localPlaceId?: string;
};

/**
 * One player-facing current-stage requirement with live satisfaction and
 * progress. UI surfaces render this generically — they never parse mission
 * definitions or objective prose themselves, and balance values stay
 * authoritative (names/stack limits resolve through the observation).
 */
export type MissionRequirementStatus = {
  /**
   * The requirement's kind. `research_step` (#406) is a step of a Wise Old Enby
   * research assignment: those are projected from the assignment row, not from a
   * Mission definition.
   */
  kind: MissionRequirementKind | "research_step";
  /** Rendered objective copy with authoritative names/numbers substituted. */
  objective: string;
  /** Whether this requirement currently holds against authoritative state. */
  satisfied: boolean;
  /**
   * Generic numeric progress for carried-stack and tracked-activity
   * requirements; both values are clamped to the authored target.
   */
  progress?: { current: number; target: number };
  /**
   * The item this requirement observes, when it observes one: an item
   * requirement's item, or a repair's single material while that material is
   * still being installed. A repair with several materials names each on its
   * `materials` row instead.
   */
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
  /** The tracked activity this requirement counts, when it counts one (#232). */
  activity?: TrackedMissionActivity;
  /**
   * What a tracked craft's recipe makes, while it is unmet, when the Mission
   * offers that item's Sources beside the objective (#391,
   * `presentsOutputSources`). A presentation reference only: unlike `itemId`
   * the requirement does not observe this item, and holding it satisfies
   * nothing.
   */
  sourcesItemId?: string;
  /**
   * The optional leads of a conversation requirement (#369): the NPCs whose
   * lead conversation points at this requirement's contact, and whether one has
   * been followed. Conversation routing reads it so a lead entry is offered only
   * until the shared fact holds, without inspecting Mission IDs.
   */
  leads?: { npcIds: readonly string[]; followed: boolean };
  /**
   * Secondary context for this objective, rendered as its own subordinate
   * line. Never progress and never part of `progress` — it exists so a player
   * can see what they are carrying without that quantity ever appearing to
   * advance a durable objective.
   */
  detail?: string;
  /**
   * One row per authored material of a repair recipe, during its material
   * phase (#172). Present only when the recipe has more than one material, so
   * unlike materials are never aggregated into a single fake total: the Cargo
   * Hold reports Refined Ferrite and Slag as two legible requirements the
   * player can read at once. `current` is durably installed material; `carried`
   * is subordinate context and is never added to it.
   */
  materials?: readonly {
    itemId: string;
    label: string;
    current: number;
    target: number;
    /** Installed material already covers the requirement (the repair's own rule). */
    satisfied: boolean;
    carried?: number;
  }[];
};

/**
 * The reward that was actually earned by a completed mission. Projected only
 * for completed missions — active missions never preview rewards.
 */
export type MissionEarnedReward =
  | { kind: "item"; itemId: string; itemName: string }
  | { kind: "skill_xp"; skillId: string; skillName: string; amount: number }
  | { kind: "credits"; amount: number }
  | {
      kind: "stack_bundle";
      items: readonly { itemId: string; itemName: string; quantity: number }[];
    };

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
    id?: string;
    title?: string;
    final?: boolean;
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
  /**
   * Present only on a Wise Old Enby research assignment (#406), which is
   * projected from its assignment row rather than a Mission definition. It
   * names the run, so the Mission Log can offer Abandon Assignment for exactly
   * this run, and marks the projection as not pinnable or conversational.
   */
  research?: { assignmentId: string };
  /**
   * Present only while a carried item currently offers this Mission (#369): the
   * Mission is not accepted, its prerequisites hold, and the character carries a
   * stack of any authored item. `itemIds` are the authored items currently
   * carried. The copy is content (`itemOffer`), never state.
   */
  itemOffer?: { itemIds: readonly string[] };
  /**
   * The Mission-local reactive facts that currently hold (#232), by authored
   * key, for accepted incomplete Missions only. Read by conversation routing
   * to choose an authored variant; never by progression.
   */
  facts?: readonly string[];
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
  if (requirement.kind === "repair_target_complete") {
    return renderRepairObjective(requirement, observation);
  }
  if (requirement.kind === "skill_level") {
    const current = Math.min(
      observation?.skillLevels?.get(requirement.skillId) ?? 1,
      requirement.level,
    );
    return requirement.objective
      .replace("{current}", String(current))
      .replace("{target}", String(requirement.level));
  }
  if (requirement.kind === "npc_conversation") {
    // Once a lead has been followed the required contact is the only thing left
    // to do, and the objective says so (#369).
    return conversationLeadFollowed(requirement, observation)
      ? requirement.leads!.followedObjective
      : requirement.objective;
  }
  if (requirement.kind === "ship_flight" || requirement.kind === "deferred_stage") {
    return requirement.objective;
  }
  if (requirement.kind === "ship_fuel") {
    return requirement.objective.replace(
      "{required}",
      String(shipFuelRequired(requirement.routeId)),
    );
  }
  const itemName = observation?.itemNames.get(requirement.itemId) ?? requirement.itemId;
  if (requirement.kind === "equipped_item" || requirement.kind === "carried_unique_item") {
    return requirement.objective.replace("{item}", itemName);
  }
  const required = requiredCarriedQuantity(requirement, observation);
  const carried = Math.min(observation?.carriedQuantities.get(requirement.itemId) ?? 0, required);
  return requirement.objective
    .replace("{item}", itemName)
    .replace("{carried}", String(carried))
    .replace("{required}", String(required));
}

/**
 * Whether one lead of a conversation requirement has been followed (#369): the
 * single shared durable fact its leads record. A requirement without leads has
 * none to follow.
 */
export function conversationLeadFollowed(
  requirement: Extract<MissionRequirement, { kind: "npc_conversation" }>,
  observation: Pick<MissionObservation, "trackedProgress"> | undefined,
): boolean {
  return (
    requirement.leads !== undefined &&
    (observation?.trackedProgress?.get(requirement.leads.progressKey) ?? 0) >= 1
  );
}

/**
 * The repair objective for the phase the player is actually in (#172).
 *
 * Generated from the repair target's own authored identity and recipe, so a
 * requirement that supplies nothing but `kind` and `targetId` still reads
 * correctly through every phase. A Mission author cannot forget to opt in,
 * because there is nothing to opt into: the phase comes from the repair
 * record, the names from the item and repair-target registries.
 *
 * A recipe with one material states it inline ("Install Refined Ferrite at the
 * Crew Stop — 10 / 20"). A recipe with several never invents a combined total:
 * the line names the job and `materials` carries one legible row per material.
 */
function renderRepairObjective(
  requirement: Extract<MissionRequirement, { kind: "repair_target_complete" }>,
  observation: MissionObservation | undefined,
): string {
  const definition = getRepairTarget(requirement.targetId);
  const target = observation?.repairTargets?.get(requirement.targetId);
  const phase = repairPhase(target);
  if (!definition || !target) return requirement.objective;
  if (phase === "materials") {
    const [only] = target.materials;
    if (target.materials.length === 1 && only) {
      const name = observation?.itemNames.get(only.itemId) ?? only.itemId;
      return `Install ${name} at the ${definition.displayName} — ${only.contributed} / ${only.required}`;
    }
    return `Install repair materials at the ${definition.displayName}`;
  }
  if (phase === "welding") {
    const welds = Math.min(target.welding.completed, target.welding.required);
    return `Weld the ${definition.displayName} — ${welds} / ${target.welding.required} welds`;
  }
  return requirement.objective;
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
    case "carried_unique_item":
      return uniqueItemRequirementHolds(requirement, observation);
    case "tracked_activity":
      return (
        (observation?.trackedProgress?.get(requirement.progressKey) ?? 0) >= requirement.target
      );
    case "repair_target_complete":
      return observation?.repairTargets?.get(requirement.targetId)?.complete === true;
    case "skill_level":
      return (observation?.skillLevels?.get(requirement.skillId) ?? 0) >= requirement.level;
    case "npc_conversation":
      // The durable mission-progress row for this authored key is the only
      // evidence; the conversation itself is never replayed as proof.
      return (observation?.trackedProgress?.get(requirement.progressKey) ?? 0) >= 1;
    case "ship_fuel":
      // Whatever the flight has already spent still counts: launching takes the
      // fuel before the ship lands, and this must not revert in the air.
      if (observation?.ship?.flightRouteId === requirement.routeId) return true;
      return (observation?.ship?.fuelUnits ?? 0) >= shipFuelRequired(requirement.routeId);
    case "ship_flight":
      // Only the flight's own landing can satisfy this, and it does so by
      // completing the Mission in the same transaction (#358). No observable
      // state a player can arrange stands in for the flight.
      return false;
    case "deferred_stage":
      // A later slice replaces this stage; until then nothing can satisfy it.
      return false;
  }
}

/**
 * Whether a unique-item requirement holds (#232, #233). A carried, unequipped
 * instance always does. Showing takes nothing, so for `show` an equipped
 * instance counts as well — it is physically with the character — while a
 * hand-in (`consume_one`) still never reaches the tool in the player's hand.
 * The Cargo Hold never counts: equipped gear is always carried.
 */
export function uniqueItemRequirementHolds(
  requirement: Extract<MissionRequirement, { kind: "carried_unique_item" }>,
  observation: Pick<MissionObservation, "carriedUniqueItems" | "equippedItemIds"> | undefined,
): boolean {
  if ((observation?.carriedUniqueItems?.get(requirement.itemId) ?? 0) >= 1) return true;
  return (
    requirement.turnIn === "show" && (observation?.equippedItemIds.has(requirement.itemId) ?? false)
  );
}

/**
 * Whether a requirement is waived where the character stands (#389): it applies
 * on one authored planet only, and the character is on another. A waived
 * requirement neither gates nor guides, and nothing is recorded by the waiver —
 * its own progress, if any, is untouched and still read where it is read
 * (reactive facts). The server's turn-in check asks the same question.
 */
export function requirementWaived(
  requirement: MissionRequirement,
  currentLocationId: string,
): boolean {
  if (requirement.kind !== "npc_conversation" || !requirement.appliesOnPlanetId) return false;
  return getLocationPlanetId(currentLocationId) !== requirement.appliesOnPlanetId;
}

/** The requirements that apply where the character stands, in authored order. */
function applicableRequirements(
  definition: MissionDefinition,
  currentLocationId: string,
): readonly MissionRequirement[] {
  return definition.requirements.filter(
    (requirement) => !requirementWaived(requirement, currentLocationId),
  );
}

function firstUnsatisfiedRequirement(
  definition: MissionDefinition,
  currentLocationId: string,
  observation: MissionObservation | undefined,
): MissionRequirement | undefined {
  return applicableRequirements(definition, currentLocationId).find(
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
  return applicableRequirements(definition, currentLocationId).every((requirement) =>
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
  if (input.definition.stages) {
    const stage = activeMissionStage(input.definition, input.mission);
    if (stage !== input.definition.stages.at(-1)) return "active";
    input = {
      ...input,
      definition: { ...missionAtStage(input.definition, stage), stages: undefined },
      observation: input.observation
        ? {
            ...input.observation,
            trackedProgress: stageProgress(stage, input.observation.trackedProgress),
          }
        : undefined,
    };
  }
  // Turn-in eligibility requires stationary presence AT the authored turn-in
  // location, independently of the requirement list: `at_location`
  // requirements control objective progression, while `turnIn.locationId` is
  // its own authoritative turn-in constraint. Authors never need to
  // duplicate the turn-in location as a requirement to keep eligibility
  // correct.
  // A Mission completed by a gameplay outcome has no turn-in to become ready
  // for (#358): it stays active until that outcome completes it.
  if (!input.definition.turnIn) return "active";
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
  return definition.turnIn?.objective ?? definition.summary;
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
    // An in-person item offer (#389) is available exactly when the carried item
    // would offer the Mission in Inventory.
    const carriesOfferItem = itemOfferAvailable(
      definition,
      state,
      prerequisiteSatisfied,
      observation,
    );
    const availableNpcIds = definition.offers
      .filter((offer) => offer.locationId === currentLocationId)
      .filter((offer) => !offer.requiresCarriedOfferItem || carriesOfferItem)
      .map((offer) => offer.npcId);
    // A carried item offers its Mission wherever the player is (#369): the blue
    // affordance sits on the item itself, so no location is involved.
    const availableItemIds = itemOfferAvailable(
      definition,
      state,
      prerequisiteSatisfied,
      observation,
    )
      ? carriedOfferItemIds(definition.itemOffer!, observation)
      : [];
    if (availableNpcIds.length === 0 && availableItemIds.length === 0) return undefined;
    return {
      ...(availableNpcIds.length > 0 ? { availableNpcIds } : {}),
      ...(availableItemIds.length > 0 ? { availableItemIds } : {}),
    };
  }
  const firstUnsatisfied = firstUnsatisfiedRequirement(definition, currentLocationId, observation);
  if (!firstUnsatisfied) {
    // A Mission with no turn-in has no handoff to point at (#358).
    if (!definition.turnIn) return undefined;
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
      ...(firstUnsatisfied.kind === "tracked_activity" && firstUnsatisfied.recommendedItemId
        ? { actionItemId: firstUnsatisfied.recommendedItemId }
        : {}),
      ...actionDestination(firstUnsatisfied.recommendedActionId, currentLocationId),
    };
  }
  if (firstUnsatisfied.kind === "tracked_activity") {
    // No single recommended action (Break It Down counts any Tinkering batch):
    // the activity is the target, and nothing more specific is invented.
    return { activity: firstUnsatisfied.activity };
  }
  if (firstUnsatisfied.kind === "repair_target_complete") {
    const guidance = repairTargetGuidance(firstUnsatisfied, currentLocationId, observation);
    // Nothing to point at is absence of guidance, not empty guidance.
    return Object.keys(guidance).length > 0 ? guidance : undefined;
  }
  if (firstUnsatisfied.kind === "ship_fuel" || firstUnsatisfied.kind === "ship_flight") {
    // The ship departs from one authored place; away from it, that place is the
    // target. Once there, the Ship panel is the only affordance and it needs no
    // semantic halo of its own.
    const origin = getShipRoute(firstUnsatisfied.routeId)?.originLocationId;
    return origin && origin !== currentLocationId ? { locationId: origin } : undefined;
  }
  if (firstUnsatisfied.kind === "npc_conversation") {
    // The person to go and meet is the target, exactly as the turn-in NPC is
    // once every requirement holds. With optional leads still unfollowed, every
    // contact is a target at once (#369).
    return conversationGuidance(firstUnsatisfied, currentLocationId, observation);
  }
  // A deferred stage has nothing to point at yet (#369), and a carried
  // requirement with no authored route (several legitimate
  // sources) gets no guidance: the framework never picks one for the player.
  return undefined;
}

/**
 * Guidance toward one repair target: its World Location while the player is
 * elsewhere, then — once they have arrived — the Local Place entrance hosting
 * it, if it lives inside one, and finally the repair surface itself. Derived
 * purely from the authored repair-target registry.
 *
 * While the recipe still needs material the player carries none of, there is
 * no guidance at all — the same principle a carried requirement with several
 * legitimate sources already follows (#172). Going to the repair target
 * accomplishes nothing then, and the framework has no business inventing
 * where to get the material: Refined Ferrite can be refined, bought, or
 * scavenged, and the Mission Log's own numbers say what is missing. Carry one
 * useful unit, or finish the materials, and the target is worth walking to
 * again. This is ordinary repair behavior, not an authored opt-in.
 */
function repairTargetGuidance(
  requirement: Extract<MissionRequirement, { kind: "repair_target_complete" }>,
  currentLocationId: string,
  observation: MissionObservation | undefined,
): MissionGuidance {
  const targetId = requirement.targetId;
  const target = getRepairTarget(targetId);
  if (!target) return {};
  const observed = observation?.repairTargets?.get(targetId);
  if (
    repairPhase(observed) === "materials" &&
    !carriesUsefulRepairMaterial(observed, observation)
  ) {
    return {};
  }
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
 * Whether the player carries anything that would immediately advance this
 * repair — carried quantity capped by what the recipe still needs, so a
 * satchel full of an already-complete material counts for nothing.
 */
function carriesUsefulRepairMaterial(
  target: RepairTargetObservation | undefined,
  observation: MissionObservation | undefined,
): boolean {
  return (target?.materials ?? []).some((material) => {
    const outstanding = material.required - material.contributed;
    if (outstanding <= 0) return false;
    return (observation?.carriedQuantities.get(material.itemId) ?? 0) > 0;
  });
}

/**
 * Whether a carried item currently offers this Mission (#369): not accepted,
 * prerequisites held, and a stack of the authored item genuinely carried. The
 * server's item-offer acceptance revalidates the same three facts against the
 * locked inventory, so this projection is never the authority.
 */
export function itemOfferAvailable(
  definition: Pick<MissionDefinition, "itemOffer">,
  state: MissionState,
  prerequisiteSatisfied: boolean,
  observation: Pick<MissionObservation, "carriedQuantities"> | undefined,
): boolean {
  if (!definition.itemOffer || state !== "not_accepted" || !prerequisiteSatisfied) return false;
  return carriedOfferItemIds(definition.itemOffer, observation).length > 0;
}

/** The authored offering items the character currently carries at least one of. */
function carriedOfferItemIds(
  offer: NonNullable<MissionDefinition["itemOffer"]>,
  observation: Pick<MissionObservation, "carriedQuantities"> | undefined,
): readonly string[] {
  return offer.itemIds.filter((itemId) => (observation?.carriedQuantities.get(itemId) ?? 0) >= 1);
}

/**
 * Guidance toward a conversation requirement's contact (#369). The required
 * contact is authored at its Mission location; each lead NPC stands wherever
 * `resolveNpcPlacement` puts them for THIS character, so a relocated lead is
 * guided to their actual hex. Once a lead has been followed only the required
 * contact remains. Candidates that share a World Location deduplicate in the
 * target sets, not here.
 */
function conversationGuidance(
  requirement: Extract<MissionRequirement, { kind: "npc_conversation" }>,
  currentLocationId: string,
  observation: MissionObservation | undefined,
): MissionGuidance {
  const required = npcBoundaryGuidance(
    requirement.npcId,
    requirement.locationId,
    currentLocationId,
  );
  if (!requirement.leads || conversationLeadFollowed(requirement, observation)) return required;
  const completed = observation?.completedMissionIds ?? new Set<string>();
  return {
    candidates: [
      ...requirement.leads.conversations.map((lead) =>
        placedNpcGuidance(lead.npcId, currentLocationId, completed),
      ),
      toCandidate(requirement.npcId, required),
    ],
  };
}

function toCandidate(npcId: string, guidance: MissionGuidance): MissionGuidanceCandidate {
  return {
    npcId,
    ...(guidance.locationId ? { locationId: guidance.locationId } : {}),
    ...(guidance.localPlaceId ? { localPlaceId: guidance.localPlaceId } : {}),
  };
}

/**
 * The World Location where a lead NPC stands for this character right now (#369):
 * the NPC's own derived placement, never an authored copy of it. The one answer
 * guidance and the acknowledgement command both give.
 */
export function leadContactLocationId(
  npcId: string,
  completedMissionIds: ReadonlySet<string>,
): string | undefined {
  const npc = getNpc(npcId);
  return npc ? resolveNpcPlacement(npc, completedMissionIds).locationId : undefined;
}

/** Guidance toward one NPC wherever they currently stand for this character. */
function placedNpcGuidance(
  npcId: string,
  currentLocationId: string,
  completedMissionIds: ReadonlySet<string>,
): MissionGuidanceCandidate {
  const npc = getNpc(npcId);
  if (!npc) return { npcId };
  const placement = resolveNpcPlacement(npc, completedMissionIds);
  if (placement.locationId !== currentLocationId) {
    return { npcId, locationId: placement.locationId };
  }
  const place = placement.localPlaceId
    ? getLocalPlaceInLocation(currentLocationId, placement.localPlaceId)
    : undefined;
  return place ? { npcId, localPlaceId: place.id } : { npcId };
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

/**
 * The first authored skill-level prerequisite that does NOT currently hold, in
 * authored order, or `undefined` when every one of them does (#207, #209).
 *
 * Exported alongside the boolean because a refusal has to be able to name the
 * skill the player is short on, and the first unmet one in authored order is
 * the answer both the projection and the acceptance command give — never two
 * different skills for the same state.
 */
export function unmetMissionSkillPrerequisite(
  definition: MissionDefinition,
  skillLevels: ReadonlyMap<string, number> | undefined,
): MissionSkillPrerequisite | undefined {
  return (definition.prerequisiteSkillLevels ?? []).find(
    (prerequisite) => (skillLevels?.get(prerequisite.skillId) ?? 0) < prerequisite.level,
  );
}

/**
 * The level a Mission's authored prerequisites require of one skill, or
 * `undefined` when it names none (#330). Lets other rules, such as a repair that
 * needs the Welding level its Mission required, read the level from the one
 * place it is authored instead of restating it.
 */
export function missionSkillPrerequisiteLevel(
  definition: MissionDefinition,
  skillId: string,
): number | undefined {
  return definition.prerequisiteSkillLevels?.find((entry) => entry.skillId === skillId)?.level;
}

/**
 * The level one skill must reach for a Mission's work (#441): the offer
 * prerequisite when it authors one, otherwise its live `skill_level` objective.
 * A repair that "requires its Mission's level" reads this, so a level has exactly
 * one home whichever way the Mission asks for it.
 */
export function missionRequiredSkillLevel(
  definition: Pick<MissionDefinition, "prerequisiteSkillLevels" | "requirements">,
  skillId: string,
): number | undefined {
  const prerequisite = definition.prerequisiteSkillLevels?.find(
    (entry) => entry.skillId === skillId,
  )?.level;
  if (prerequisite !== undefined) return prerequisite;
  for (const requirement of definition.requirements) {
    if (requirement.kind === "skill_level" && requirement.skillId === skillId)
      return requirement.level;
  }
  return undefined;
}

/**
 * Whether every authored skill-level prerequisite currently holds (#207, #209).
 *
 * Exported because projection and the authoritative acceptance command must
 * derive the identical answer from the identical authored content: a UI-only
 * check would be bypassable, and a second server-side check would be a rule
 * with two homes. A Mission naming several skills is satisfied only when all
 * of them hold — Brace Yourself is not offered to someone who can weld but
 * has never mined.
 */
export function missionSkillPrerequisiteSatisfied(
  definition: MissionDefinition,
  skillLevels: ReadonlyMap<string, number> | undefined,
): boolean {
  return unmetMissionSkillPrerequisite(definition, skillLevels) === undefined;
}

export function projectMission(
  definition: MissionDefinition,
  mission: MissionRecordState | undefined,
  currentLocationId: string,
  stationary: boolean,
  observation?: MissionObservation,
  prerequisiteCompleted = false,
): MissionProjection {
  const authored = definition;
  const activeStage = activeMissionStage(definition, mission);
  const finalStage = !definition.stages || activeStage === definition.stages.at(-1);
  const state = deriveMissionState({
    mission,
    definition,
    currentLocationId,
    stationary,
    observation,
  });
  definition = missionAtStage(definition, activeStage);
  if (activeStage && observation)
    observation = {
      ...observation,
      trackedProgress: stageProgress(activeStage, observation.trackedProgress),
    };
  const firstUnsatisfied = firstUnsatisfiedRequirement(definition, currentLocationId, observation);
  const requirementsSatisfied =
    finalStage && requirementsHold(definition, currentLocationId, observation);
  // One eligibility answer for both authored prerequisite kinds, so every
  // consumer of `prerequisiteSatisfied` — the conversation hub, availability
  // guidance, the acceptance command — treats a missing level exactly as it
  // already treats an unfinished predecessor Mission.
  const prerequisiteSatisfied =
    (!definition.prerequisiteMissionId || prerequisiteCompleted) &&
    missionSkillPrerequisiteSatisfied(definition, observation?.skillLevels);
  const active = state === "active" || state === "ready_for_completion";
  return {
    missionId: definition.id,
    title: definition.title,
    summary: definition.summary,
    state,
    currentObjective: active
      ? deriveCurrentObjective(definition, currentLocationId, observation)
      : undefined,
    // A requirement waived on this planet (#389) is not part of the work here,
    // so the Log does not list it — not as done, and not as outstanding.
    requirements: active
      ? applicableRequirements(definition, currentLocationId).map((requirement) =>
          projectRequirement(requirement, currentLocationId, observation),
        )
      : undefined,
    completedAt: state === "completed" ? (mission?.completedAt ?? null) : undefined,
    earnedReward: state === "completed" ? projectEarnedReward(definition) : undefined,
    prerequisiteSatisfied,
    stage: {
      ...(authored.stages && activeStage
        ? { id: activeStage.id, title: activeStage.title, final: finalStage }
        : {}),
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
    ...(itemOfferAvailable(definition, state, prerequisiteSatisfied, observation)
      ? { itemOffer: { itemIds: carriedOfferItemIds(definition.itemOffer!, observation) } }
      : {}),
    ...(active && definition.reactiveFacts
      ? {
          facts: definition.reactiveFacts
            .filter((fact) => reactiveFactHolds(fact, observation))
            .map((fact) => fact.key),
        }
      : {}),
  };
}

/**
 * Whether one reactive fact holds (#232). A recorded fact reads its own row; a
 * conversation fact (#389) reads the marker of the conversation it names, so it
 * holds only when that scene genuinely happened.
 */
function reactiveFactHolds(
  fact: MissionReactiveFact,
  observation: MissionObservation | undefined,
): boolean {
  const key =
    fact.observes.kind === "conversation_acknowledged"
      ? fact.observes.requirementProgressKey
      : fact.key;
  return (observation?.trackedProgress?.get(key) ?? 0) >= 1;
}

/**
 * The one item an authored crafting recipe makes, by its action ID (#391): a
 * Fabrication or Runeworking recipe. Undefined for any other action, so a
 * tracked requirement can only point at the output of a real recipe.
 */
export function craftedOutputItemId(actionId: string): string | undefined {
  const recipe =
    fabricationRecipeForActionId(actionId) ??
    runeworkingRecipeForActionId(actionId) ??
    lapidaryRecipeForActionId(actionId);
  return recipe && "outputItemId" in recipe ? recipe.outputItemId : undefined;
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
    const sourcesItemId =
      requirement.presentsOutputSources && requirement.actionId && !satisfied
        ? craftedOutputItemId(requirement.actionId)
        : undefined;
    return {
      kind: requirement.kind,
      objective: renderRequirementObjective(requirement, observation),
      satisfied,
      progress: { current, target: requirement.target },
      activity: requirement.activity,
      ...(sourcesItemId ? { sourcesItemId } : {}),
    };
  }
  if (requirement.kind === "carried_unique_item") {
    return {
      kind: requirement.kind,
      objective: renderRequirementObjective(requirement, observation),
      satisfied,
      itemId: requirement.itemId,
    };
  }
  if (requirement.kind === "skill_level") {
    return {
      kind: requirement.kind,
      objective: renderRequirementObjective(requirement, observation),
      satisfied,
      progress: {
        current: Math.min(
          observation?.skillLevels?.get(requirement.skillId) ?? 1,
          requirement.level,
        ),
        target: requirement.level,
      },
    };
  }
  if (requirement.kind === "repair_target_complete") {
    const target = observation?.repairTargets?.get(requirement.targetId);
    const phase = repairPhase(target);
    const materials = target?.materials ?? [];
    const [only] = materials;
    const carriedOf = (itemId: string) => observation?.carriedQuantities.get(itemId) ?? 0;
    const nameOf = (itemId: string) => observation?.itemNames.get(itemId) ?? itemId;
    return {
      kind: requirement.kind,
      objective: renderRequirementObjective(requirement, observation),
      satisfied,
      repairTargetId: requirement.targetId,
      ...(phase === "welding" && target
        ? {
            progress: {
              current: Math.min(target.welding.completed, target.welding.required),
              target: target.welding.required,
            },
          }
        : {}),
      // One material states itself on the objective line; several get a row
      // each, because adding Refined Ferrite to Slag would be a number that
      // means nothing. Either way the value is installed material alone —
      // carried stacks and stored cargo never reach it.
      ...(phase === "materials" && materials.length === 1 && only
        ? {
            progress: { current: only.contributed, target: only.required },
            // The one material is still the repair's own item; present only
            // while it is still being installed, exactly like its progress.
            itemId: only.itemId,
            ...(carriedOf(only.itemId) > 0
              ? { detail: `Carrying: ${carriedOf(only.itemId)} ${nameOf(only.itemId)}` }
              : {}),
          }
        : {}),
      ...(phase === "materials" && materials.length > 1
        ? {
            materials: materials.map((material) => ({
              itemId: material.itemId,
              label: nameOf(material.itemId),
              current: material.contributed,
              target: material.required,
              satisfied: material.contributed >= material.required,
              ...(carriedOf(material.itemId) > 0 && material.contributed < material.required
                ? { carried: carriedOf(material.itemId) }
                : {}),
            })),
          }
        : {}),
    };
  }
  if (requirement.kind === "npc_conversation") {
    const leads = requirement.leads;
    const followed = conversationLeadFollowed(requirement, observation);
    return {
      kind: requirement.kind,
      // A requirement that already holds keeps its authored copy; only the open
      // objective narrows once a lead has been followed (#369).
      objective: satisfied
        ? requirement.objective
        : renderRequirementObjective(requirement, observation),
      satisfied,
      npcId: requirement.npcId,
      ...(leads
        ? { leads: { npcIds: leads.conversations.map((lead) => lead.npcId), followed } }
        : {}),
      // Until a lead is followed the Log names every possible contact.
      ...(leads && !followed && !satisfied
        ? {
            detail: `Possible contacts: ${[
              ...leads.conversations.map((lead) => lead.npcId),
              requirement.npcId,
            ]
              .map((npcId) => getNpc(npcId)?.displayName ?? npcId)
              .join(", ")}`,
          }
        : {}),
    };
  }
  if (requirement.kind === "deferred_stage") {
    return { kind: requirement.kind, objective: requirement.objective, satisfied };
  }
  if (requirement.kind === "ship_fuel") {
    const required = shipFuelRequired(requirement.routeId);
    const tank = observation?.ship?.fuelUnits ?? 0;
    return {
      kind: requirement.kind,
      objective: renderRequirementObjective(requirement, observation),
      satisfied,
      progress: {
        current: satisfied ? required : Math.min(tank, required),
        target: required,
      },
      // The canister is the way to fuel the ship, so its Sources reference is
      // offered only while the tank is still short of the trip.
      ...(satisfied ? {} : { itemId: requirement.itemId }),
    };
  }
  if (requirement.kind === "ship_flight") {
    return { kind: requirement.kind, objective: requirement.objective, satisfied };
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
  if (definition.reward.kind === "credits") {
    return { kind: "credits", amount: definition.reward.amount };
  }
  if (definition.reward.kind === "stack_bundle") {
    return {
      kind: "stack_bundle",
      items: definition.reward.items.map((entry) => ({
        itemId: entry.itemId,
        itemName: resolveItemPresentation(entry.itemId, entry.itemId).displayName,
        quantity: entry.quantity,
      })),
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
  /** Carried item(s) whose Item Details currently offer an unaccepted Mission (#369). */
  availableItemIds: ReadonlySet<string>;
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
  /** Carried items whose own action advances active pinned Mission work. */
  actionItemIds: ReadonlySet<string>;
  actionIds: ReadonlySet<string>;
  /** Tracked activities an accepted Mission's current objective counts (#232). */
  activities: ReadonlySet<string>;
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
 * The player-facing word for where a Mission stands, shared by every surface
 * that names it in text — the Current Missions strips, the Mission Log, and
 * the conversation hub's Mission entries — so colour is never the only signal
 * and no two surfaces word it differently.
 */
export const MISSION_STANDING_LABELS: Record<MissionGuidancePhase | "completed", string> = {
  work: "Active",
  turn_in: "Turn in",
  completed: "Completed",
};

/** One repair material the player still has to obtain. */
export type StillNeededMaterial = { itemId: string; label: string; remaining: number };

/**
 * What a multi-material repair Mission still needs the player to GET (#322), for
 * the compact Mission strip's acquisition line.
 *
 * It answers "what do I still need to obtain?", so a carried unit covers a unit
 * of need: `remaining = required - installed - carried`, clamped at zero, and
 * only materials with something remaining are listed. That is a reading of the
 * projection, not a change to it — carried material is still never installed
 * material, and the Mission Log keeps showing every authoritative row.
 *
 * Only the first unmet requirement is read, and only while it is a repair in
 * its materials phase (the only time the projection carries material rows), so
 * it is empty during Welding, once every material is covered, and for every
 * other kind of objective. Nothing here names a Mission or a repair target.
 */
export function stillNeededMaterials(
  projection: Pick<MissionProjection, "requirements">,
): readonly StillNeededMaterial[] {
  const first = projection.requirements?.find((requirement) => !requirement.satisfied);
  return (first?.materials ?? []).flatMap((material) => {
    const remaining = Math.max(0, material.target - material.current - (material.carried ?? 0));
    return remaining > 0 ? [{ itemId: material.itemId, label: material.label, remaining }] : [];
  });
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

/**
 * The Missions the character has accepted, which stays true once they complete.
 *
 * What an accepted Mission opens up — repair work, Wade's Workbench, Wade's
 * Trade — stays open afterwards, so "accepted" is every state except
 * not-accepted. Surfaces derive this instead of persisting a second unlock flag
 * (#190).
 */
export function deriveAcceptedMissionIds(
  projections: readonly { missionId: string; state: MissionState }[],
): ReadonlySet<string> {
  return new Set(
    projections
      .filter((projection) => projection.state !== "not_accepted")
      .map((projection) => projection.missionId),
  );
}

export function deriveMissionGuidanceTargets(
  projections: readonly MissionProjection[],
): MissionGuidanceTargets {
  const availableNpcIds = new Set<string>();
  const availableItemIds = new Set<string>();
  const npcIds = new Set<string>();
  const turnInNpcIds = new Set<string>();
  const localPlaceIds = new Set<string>();
  const turnInLocalPlaceIds = new Set<string>();
  const locationIds = new Set<string>();
  const turnInLocationIds = new Set<string>();
  const equipmentItemIds = new Set<string>();
  const actionItemIds = new Set<string>();
  const actionIds = new Set<string>();
  const activities = new Set<string>();
  const repairTargetIds = new Set<string>();
  for (const projection of projections) {
    const guidance = projection.guidance;
    if (!guidance) continue;
    if (guidance.availableNpcIds) {
      for (const id of guidance.availableNpcIds) availableNpcIds.add(id);
    }
    if (guidance.availableItemIds) {
      for (const id of guidance.availableItemIds) availableItemIds.add(id);
    }
    const turnIn = guidance.turnIn === true;
    // A multi-target objective (#369) contributes every candidate exactly as a
    // single target would; the sets deduplicate shared hexes and places.
    for (const target of [guidance, ...(guidance.candidates ?? [])]) {
      if (target.npcId) (turnIn ? turnInNpcIds : npcIds).add(target.npcId);
      if (target.localPlaceId) {
        (turnIn ? turnInLocalPlaceIds : localPlaceIds).add(target.localPlaceId);
      }
      if (target.locationId) (turnIn ? turnInLocationIds : locationIds).add(target.locationId);
    }
    for (const id of guidance.locationIds ?? []) (turnIn ? turnInLocationIds : locationIds).add(id);
    if (guidance.equipmentItemId) equipmentItemIds.add(guidance.equipmentItemId);
    if (guidance.actionItemId) actionItemIds.add(guidance.actionItemId);
    if (guidance.actionId) actionIds.add(guidance.actionId);
    if (guidance.activity) activities.add(guidance.activity);
    if (guidance.repairTargetId) repairTargetIds.add(guidance.repairTargetId);
  }
  return {
    availableNpcIds,
    availableItemIds,
    npcIds,
    turnInNpcIds,
    localPlaceIds,
    turnInLocalPlaceIds,
    locationIds,
    turnInLocationIds,
    equipmentItemIds,
    actionItemIds,
    actionIds,
    activities,
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
    const authoredRequirements = allMissionRequirements(definition);
    if (definition.stages) assertMissionStages(definition);
    if (
      definition.offers.length === 0 &&
      !continuationTargets.has(definition.id) &&
      !definition.itemOffer
    ) {
      throw new Error(`${where} must author at least one offer interaction.`);
    }
    if (definition.itemOffer) assertItemOffer(definition, definitions);
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
    const prerequisiteSkillIds = new Set<string>();
    for (const { skillId, level } of definition.prerequisiteSkillLevels ?? []) {
      // The same standard the skill-XP reward is held to: a level is only
      // meaningful against a skill that has an approved progression curve, so a
      // typo becomes a module-load failure rather than a prerequisite that can
      // never be met.
      if (!skillLevelThresholds(skillId)) {
        throw new Error(
          `${where} requires skill "${skillId}" without an approved progression curve.`,
        );
      }
      // Two entries for one skill would make the eligibility answer depend on
      // authored order, so the conjunction stays one requirement per skill.
      if (prerequisiteSkillIds.has(skillId)) {
        throw new Error(`${where} names skill "${skillId}" more than once as a prerequisite.`);
      }
      prerequisiteSkillIds.add(skillId);
      if (!Number.isInteger(level) || level <= 0) {
        throw new Error(`${where} skill prerequisite level must be a positive integer.`);
      }
      const maximumLevel = skillLevelThresholds(skillId)?.at(-1)?.level ?? 0;
      if (level > maximumLevel) {
        throw new Error(
          `${where} requires ${skillId} level ${level}, beyond that skill's maximum of ${maximumLevel}.`,
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
          definition.turnIn?.npcId !== offer.npcId
        ) {
          throw new Error(
            `${where} accepted continuation at NPC "${offer.npcId}" cannot present a turn-in owned by "${definition.turnIn?.npcId ?? "no one"}".`,
          );
        }
      }
      if (offer.activeDialogueId) {
        assertDialogue(definition.id, offer.activeDialogueId, "active");
        assertDialogueNpc(definition.id, offer.activeDialogueId, offer.npcId, "active");
      }
      if (offer.acceptEffect?.kind === "credits") {
        if (!Number.isInteger(offer.acceptEffect.amount) || offer.acceptEffect.amount <= 0) {
          throw new Error(`${where} offer Credit grant must be a positive integer.`);
        }
      } else if (offer.acceptEffect?.kind === "stack_item") {
        if (!Number.isInteger(offer.acceptEffect.quantity) || offer.acceptEffect.quantity <= 0) {
          throw new Error(`${where} offer item grant quantity must be a positive integer.`);
        }
        const grantDefinition = getItemDefinition(offer.acceptEffect.itemId);
        if (!grantDefinition) {
          throw new Error(
            `${where} offer grant references unknown item "${offer.acceptEffect.itemId}".`,
          );
        }
        // Definition validation and runtime capability must agree, exactly as
        // they do for item rewards: the acceptance boundary grants through the
        // authoritative carried-stack path, which only executes stack items.
        if (grantDefinition.kind !== "stack") {
          throw new Error(
            `${where} offer grant item "${offer.acceptEffect.itemId}" must be a stackable item; the acceptance boundary does not execute unique item grants.`,
          );
        }
      } else if (offer.acceptEffect) {
        throw new Error(`${where} offer references an unsupported acceptance effect.`);
      }
      if (offer.requiresCarriedOfferItem && !definition.itemOffer) {
        // The in-person item offer reads the authored item list; without one
        // there is nothing for the carried check to find (#389).
        throw new Error(`${where} offer requires a carried offer item but authors no item offer.`);
      }
      if (offer.subject !== undefined && offer.subject.trim().length === 0) {
        throw new Error(`${where} offer subject must not be empty.`);
      }
      if (offer.declineLabel !== undefined && offer.declineLabel.trim().length === 0) {
        throw new Error(`${where} offer decline label must not be empty.`);
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
        if (entry.npcId === definition.turnIn?.npcId) {
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
    for (const requirement of authoredRequirements) {
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
        if (!(requirement.activity in TRACKED_ACTIVITY_ACTION_IDS)) {
          throw new Error(`${where} references unsupported tracked activity.`);
        }
        if (requirement.metric !== TRACKED_ACTIVITY_METRICS[requirement.activity]) {
          throw new Error(`${where} references unsupported tracked activity metric.`);
        }
        if (!Number.isInteger(requirement.target) || requirement.target <= 0) {
          throw new Error(`${where} tracked activity target must be a positive integer.`);
        }
        const activityActionIds = TRACKED_ACTIVITY_ACTION_IDS[requirement.activity]();
        if (requirement.actionId && !activityActionIds.includes(requirement.actionId)) {
          throw new Error(`${where} tracked activity names an action outside its activity.`);
        }
        if (
          requirement.presentsOutputSources &&
          (requirement.metric !== "completions" ||
            !requirement.actionId ||
            !craftedOutputItemId(requirement.actionId))
        ) {
          throw new Error(
            `${where} presents output Sources but does not count one crafting recipe's completions.`,
          );
        }
        if (requirement.recommendedActionId) {
          if (
            !activityActionIds.includes(requirement.recommendedActionId) ||
            (requirement.actionId !== undefined &&
              requirement.recommendedActionId !== requirement.actionId)
          ) {
            throw new Error(
              `${where} tracked activity guidance must target its authoritative activity action.`,
            );
          }
        }
        if (requirement.recommendedItemId) {
          const guidedItem = getItemDefinition(requirement.recommendedItemId);
          if (!requirement.recommendedActionId || !guidedItem || guidedItem.kind !== "stack") {
            throw new Error(
              `${where} tracked activity item guidance needs a real stack item and recommended action.`,
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
      if (requirement.kind === "ship_fuel") {
        if (!getShipRoute(requirement.routeId)) {
          throw new Error(
            `${where} fuel requirement references unknown ship route "${requirement.routeId}".`,
          );
        }
        continue;
      }
      if (requirement.kind === "ship_flight") {
        if (!getShipRoute(requirement.routeId)) {
          throw new Error(
            `${where} flight requirement references unknown ship route "${requirement.routeId}".`,
          );
        }
        if (
          definition.autoCompletion?.kind !== "ship_flight" ||
          definition.autoCompletion.routeId !== requirement.routeId
        ) {
          // Nothing else could ever satisfy a flight requirement, so without the
          // matching completion the Mission could never finish (#358).
          throw new Error(
            `${where} flight requirement on "${requirement.routeId}" needs a matching ship-flight auto-completion.`,
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
        if (!definition.stages && requirement.npcId === definition.turnIn?.npcId) {
          throw new Error(
            `${where} conversation requirement cannot target its own turn-in NPC "${requirement.npcId}".`,
          );
        }
        if (
          !definition.stages &&
          definition.offers.some((offer) => offer.npcId === requirement.npcId)
        ) {
          throw new Error(
            `${where} conversation requirement cannot target offer NPC "${requirement.npcId}".`,
          );
        }
        if (
          authoredRequirements.filter(
            (candidate) =>
              candidate.kind === "npc_conversation" &&
              candidate.npcId === requirement.npcId &&
              (!definition.stages || candidate.dialogueId === requirement.dialogueId),
          ).length > 1
        ) {
          throw new Error(
            `${where} duplicates a conversation requirement for NPC "${requirement.npcId}".`,
          );
        }
        if (requirement.leads) {
          assertConversationLeads(definition, requirement, requirement.leads, progressKeys);
        }
        if (requirement.appliesOnPlanetId) {
          // A planet-local conversation (#389) is met on its own planet and
          // waived only on the turn-in's, so both ends must be where the
          // waiver can make sense.
          if (getLocationPlanetId(requirement.locationId) !== requirement.appliesOnPlanetId) {
            throw new Error(
              `${where} conversation requirement applies on planet "${requirement.appliesOnPlanetId}" but is met on another.`,
            );
          }
          if (
            !definition.turnIn ||
            getLocationPlanetId(definition.turnIn.locationId) === requirement.appliesOnPlanetId
          ) {
            throw new Error(
              `${where} planet-local conversation requirement needs a turn-in on another planet.`,
            );
          }
        }
        continue;
      }
      if (requirement.kind === "deferred_stage") {
        if (requirement.objective.trim().length === 0) {
          throw new Error(`${where} deferred stage must author its objective copy.`);
        }
        continue;
      }
      if (requirement.kind === "skill_level") {
        const maximumLevel = skillLevelThresholds(requirement.skillId)?.at(-1)?.level;
        if (maximumLevel === undefined) {
          throw new Error(
            `${where} skill-level requirement names skill "${requirement.skillId}", which has no approved progression curve.`,
          );
        }
        if (
          !Number.isInteger(requirement.level) ||
          requirement.level < 1 ||
          requirement.level > maximumLevel
        ) {
          throw new Error(
            `${where} skill-level requirement level ${requirement.level} is not a level on that skill's curve.`,
          );
        }
        if (requirement.objective.trim().length === 0) {
          throw new Error(`${where} skill-level requirement must author its objective copy.`);
        }
        continue;
      }
      const itemDefinition = getItemDefinition(requirement.itemId);
      if (!itemDefinition) {
        throw new Error(`${where} requirement references unknown item "${requirement.itemId}".`);
      }
      if (requirement.kind === "carried_unique_item") {
        if (itemDefinition.kind !== "unique") {
          throw new Error(`${where} unique-item requirement must target a unique item.`);
        }
        continue;
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
    if (authoredRequirements.some((requirement) => requirement.kind === "deferred_stage")) {
      // A deliberately unfinished story stage (#369). It has no way to finish
      // yet, so every completion-shaped slot is an authoring mistake: a false
      // Turn In, an automatic completion or a reward for work that cannot happen.
      const deferredStages = authoredRequirements.filter(
        (requirement) => requirement.kind === "deferred_stage",
      );
      if (deferredStages.length > 1) {
        throw new Error(`${where} can author at most one deferred stage.`);
      }
      if (authoredRequirements.at(-1)?.kind !== "deferred_stage") {
        throw new Error(`${where} deferred stage must be its last requirement.`);
      }
      if (definition.turnIn || definition.autoCompletion || definition.reward) {
        throw new Error(
          `${where} has a deferred stage and cannot author a turn-in, an auto-completion or a reward.`,
        );
      }
      if (definition.continuationMissionId || definition.completedNpcDialogue) {
        throw new Error(`${where} cannot complete yet, so it cannot continue or author a finish.`);
      }
      assertLifecycleCoverage(definition);
      continue;
    }
    if (definition.autoCompletion) {
      // The one other way to finish (#358): a gameplay outcome, never an NPC.
      // A Mission that completes itself has nobody to hand in to and nothing to
      // hand over, so every turn-in-shaped slot is an authoring mistake.
      if (definition.turnIn) {
        throw new Error(`${where} cannot author both a turn-in and an auto-completion.`);
      }
      if (definition.reward) {
        throw new Error(`${where} completes automatically and cannot author a reward.`);
      }
      if (!getShipRoute(definition.autoCompletion.routeId)) {
        throw new Error(
          `${where} auto-completes on unknown ship route "${definition.autoCompletion.routeId}".`,
        );
      }
      if (
        !authoredRequirements.some(
          (requirement) =>
            requirement.kind === "ship_flight" &&
            requirement.routeId === definition.autoCompletion?.routeId,
        )
      ) {
        throw new Error(`${where} auto-completes on a flight it does not require.`);
      }
      assertLifecycleCoverage(definition);
      continue;
    }
    if (!definition.turnIn) {
      throw new Error(`${where} must author a turn-in or an auto-completion.`);
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
    if (dialogue.skillLevelReminderDialogueId)
      assertDialogue(definition.id, dialogue.skillLevelReminderDialogueId, "skill level reminder");
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
    assertReactiveContent(definition, progressKeys);
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
    } else if (definition.reward.kind === "credits") {
      if (!Number.isInteger(definition.reward.amount) || definition.reward.amount <= 0) {
        throw new Error(`${where} reward Credit amount must be a positive integer.`);
      }
    } else if (definition.reward.kind === "stack_bundle") {
      // The mirror image of the unique-item rule above: the bundle path grants
      // through the authoritative carried-stack boundary, which has no
      // execution path for a unique item.
      if (definition.reward.items.length === 0) {
        throw new Error(`${where} reward bundle must contain at least one item.`);
      }
      const bundleItemIds = new Set<string>();
      for (const entry of definition.reward.items) {
        if (bundleItemIds.has(entry.itemId)) {
          throw new Error(`${where} reward bundle names item "${entry.itemId}" twice.`);
        }
        bundleItemIds.add(entry.itemId);
        const bundleItem = getItemDefinition(entry.itemId);
        if (!bundleItem) {
          throw new Error(`${where} reward bundle references unknown item "${entry.itemId}".`);
        }
        if (bundleItem.kind !== "stack") {
          throw new Error(
            `${where} reward bundle item "${entry.itemId}" must be stackable; the generic completion boundary grants a bundle through the carried-stack path.`,
          );
        }
        if (!Number.isInteger(entry.quantity) || entry.quantity <= 0) {
          throw new Error(
            `${where} reward bundle quantity for "${entry.itemId}" must be a positive integer.`,
          );
        }
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
    assertLifecycleCoverage(definition);
  }
  assertContinuationGraph(definitions);
}

/** The `MissionDialogue` slot that authors each turn-in-NPC lifecycle moment. */
const LIFECYCLE_DIALOGUE_SLOTS = {
  equipment_reminder: "equipmentReminderDialogueId",
  carried_reminder: "carriedReminderDialogueId",
  tracked_activity_reminder: "trackedActivityReminderDialogueId",
  skill_level_reminder: "skillLevelReminderDialogueId",
  repair_reminder: "repairReminderDialogueId",
  conversation_reminder: "conversationReminderDialogueId",
  busy: "busyDialogueId",
  completion_presentation: "completionPresentationDialogueId",
} as const satisfies Record<MissionLifecycleMoment, keyof MissionDialogue>;

/**
 * The reminder each requirement kind needs at the turn-in NPC while it is the
 * first unmet requirement. `at_location` has none: validation requires it to
 * name the turn-in location, so the turn-in NPC is never reached while it is
 * unmet (#324).
 */
const REQUIREMENT_REMINDER_MOMENTS: Record<
  MissionRequirementKind,
  MissionLifecycleMoment | undefined
> = {
  at_location: undefined,
  equipped_item: "equipment_reminder",
  carried_stack: "carried_reminder",
  carried_unique_item: "carried_reminder",
  tracked_activity: "tracked_activity_reminder",
  skill_level: "skill_level_reminder",
  repair_target_complete: "repair_reminder",
  npc_conversation: "conversation_reminder",
  // The turn-in NPC never meets a Mission this requirement belongs to (#358).
  ship_fuel: undefined,
  ship_flight: undefined,
  // A deferred stage has no turn-in NPC either (#369).
  deferred_stage: undefined,
};

/**
 * Every turn-in-NPC lifecycle moment this Mission can reach (#324): one
 * reminder per requirement kind it authors, plus `busy` and the one-shot
 * completion presentation, which every Mission reaches. Derived from authored
 * requirement kinds only — never from a Mission ID or prose.
 */
export function missionLifecycleMoments(
  definition: Pick<MissionDefinition, "requirements" | "turnIn" | "stages">,
): readonly MissionLifecycleMoment[] {
  // A Mission with no turn-in has no turn-in-NPC conversation to be in any
  // moment of (#358).
  if (!definition.turnIn) return [];
  const moments = new Set<MissionLifecycleMoment>();
  // A requirement waived wherever the turn-in NPC stands (#389) is never the
  // first unmet one in front of them, so it reaches no reminder there.
  const turnInLocationId = definition.turnIn.locationId;
  for (const requirement of allMissionRequirements(definition)) {
    if (requirementWaived(requirement, turnInLocationId)) continue;
    const moment = reminderMomentFor(requirement.kind);
    if (moment) moments.add(moment);
  }
  moments.add("busy");
  moments.add("completion_presentation");
  return [...moments];
}

/** The reminder moment a first-unmet requirement of `kind` presents, if any. */
export function reminderMomentFor(
  kind: MissionRequirementKind,
): MissionLifecycleMoment | undefined {
  return REQUIREMENT_REMINDER_MOMENTS[kind];
}

/** The sequence this Mission authors for `moment`, if any. */
export function lifecycleDialogueId(
  definition: Pick<MissionDefinition, "dialogue">,
  moment: MissionLifecycleMoment,
): DialogueId | undefined {
  return definition.dialogue[LIFECYCLE_DIALOGUE_SLOTS[moment]];
}

/** Whether the Mission explicitly declares `moment` as intentionally unauthored. */
export function missionOmitsMoment(
  definition: Pick<MissionDefinition, "dialogue">,
  moment: MissionLifecycleMoment,
): boolean {
  return (definition.dialogue.omitted ?? []).some((omission) => omission.moment === moment);
}

/**
 * The lifecycle-coverage contract (#324). Every reachable moment authors its
 * sequence or is declared in `dialogue.omitted` with a reason; a slot or a
 * declaration for a moment the Mission cannot reach is dead content and fails.
 * Turn-in-NPC sequences must belong to that NPC, a completion presentation
 * must present every authored reward grant. Prose is never inspected.
 */
function assertLifecycleCoverage(definition: MissionDefinition): void {
  if (definition.stages) {
    for (const stage of definition.stages) {
      const effective = { ...missionAtStage(definition, stage), stages: undefined };
      const reachable = new Set(missionLifecycleMoments(effective));
      const dialogue = { ...effective.dialogue };
      for (const [moment, slot] of Object.entries(LIFECYCLE_DIALOGUE_SLOTS) as [
        MissionLifecycleMoment,
        (typeof LIFECYCLE_DIALOGUE_SLOTS)[MissionLifecycleMoment],
      ][])
        if (!reachable.has(moment)) delete dialogue[slot];
      if (dialogue.omitted)
        dialogue.omitted = dialogue.omitted.filter((entry) => reachable.has(entry.moment));
      assertLifecycleCoverage({ ...effective, dialogue });
    }
    return;
  }

  const where = `Mission "${definition.id}"`;
  const dialogue = definition.dialogue;
  if (!definition.turnIn) {
    // No turn-in NPC, so no lifecycle moment exists to author or omit (#358, #369).
    if (Object.keys(dialogue).length > 0) {
      throw new Error(`${where} has no turn-in and cannot author turn-in dialogue.`);
    }
    return;
  }
  const turnInNpcId = definition.turnIn.npcId;
  for (const requirement of allMissionRequirements(definition)) {
    if (
      requirement.kind === "at_location" &&
      requirement.locationId !== definition.turnIn.locationId
    ) {
      throw new Error(
        `${where} at_location requirement "${requirement.locationId}" differs from its turn-in location; no location reminder exists, so the turn-in NPC would present the turn-in instead.`,
      );
    }
  }
  assertDialogueNpc(definition.id, definition.turnIn.dialogueId, turnInNpcId, "turn-in");

  const reachable = new Set(missionLifecycleMoments(definition));
  const declared = new Set<MissionLifecycleMoment>();
  for (const omission of dialogue.omitted ?? []) {
    if (declared.has(omission.moment)) {
      throw new Error(`${where} declares the omitted moment "${omission.moment}" twice.`);
    }
    declared.add(omission.moment);
    if (omission.reason.trim().length === 0) {
      throw new Error(`${where} must give a reason for omitting "${omission.moment}".`);
    }
  }
  for (const [moment, slot] of Object.entries(LIFECYCLE_DIALOGUE_SLOTS) as [
    MissionLifecycleMoment,
    (typeof LIFECYCLE_DIALOGUE_SLOTS)[MissionLifecycleMoment],
  ][]) {
    const dialogueId = dialogue[slot];
    if (!reachable.has(moment)) {
      if (dialogueId || declared.has(moment)) {
        throw new Error(
          `${where} authors the "${moment}" moment, which none of its requirements can reach.`,
        );
      }
      continue;
    }
    if (dialogueId && declared.has(moment)) {
      throw new Error(`${where} both authors and omits the "${moment}" moment.`);
    }
    if (!dialogueId && !declared.has(moment)) {
      throw new Error(
        `${where} can reach the "${moment}" moment but neither authors "${slot}" nor declares it in dialogue.omitted.`,
      );
    }
    if (dialogueId) assertDialogueNpc(definition.id, dialogueId, turnInNpcId, moment);
  }

  const presentation = dialogue.completionPresentationDialogueId
    ? getDialogue(dialogue.completionPresentationDialogueId)
    : undefined;
  if (presentation) {
    for (const grant of rewardPresentationGrants(definition)) {
      const presented = presentation.beats.some((beat) =>
        grant.kind === "skill_xp"
          ? beat.kind === "skill_xp" &&
            beat.skillId === grant.skillId &&
            beat.amount === grant.amount
          : beat.kind === "item" &&
            beat.itemId === grant.itemId &&
            beat.quantity === grant.quantity,
      );
      if (!presented) {
        throw new Error(
          `${where} completion presentation does not present its ${grant.kind === "skill_xp" ? `${grant.amount} ${grant.skillId} XP` : `${grant.quantity} × ${grant.itemId}`} reward.`,
        );
      }
    }
  }
}

/**
 * The beats an authored completion presentation must contain for the reward:
 * a skill-XP beat for skill XP, an item beat per granted item. Credits are
 * presented by the runtime receipt tile, never an authored beat (#290).
 */
function rewardPresentationGrants(
  definition: MissionDefinition,
): readonly (
  | { kind: "skill_xp"; skillId: string; amount: number }
  | { kind: "item"; itemId: string; quantity: number }
)[] {
  const reward = definition.reward;
  if (!reward || reward.kind === "credits") return [];
  if (reward.kind === "skill_xp") {
    return [{ kind: "skill_xp", skillId: reward.skillId, amount: reward.amount }];
  }
  if (reward.kind === "item") return [{ kind: "item", itemId: reward.itemId, quantity: 1 }];
  return reward.items.map((entry) => ({
    kind: "item" as const,
    itemId: entry.itemId,
    quantity: entry.quantity,
  }));
}

/**
 * The reactive-fact contract (#232): lowercase hyphenated keys that share the
 * Mission's progress-key space without colliding with it, observations of a
 * real Fabrication recipe, a success fact that names the tracked Fabrication
 * requirement it watches, and variants that belong to the turn-in NPC and read
 * a fact the Mission actually authors.
 */
function assertReactiveContent(
  definition: MissionDefinition,
  progressKeys: ReadonlySet<string>,
): void {
  const where = `Mission "${definition.id}"`;
  const factKeys = new Set<string>();
  for (const fact of definition.reactiveFacts ?? []) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fact.key)) {
      throw new Error(`${where} reactive fact key must be lowercase hyphenated text.`);
    }
    if (factKeys.has(fact.key) || progressKeys.has(fact.key)) {
      throw new Error(`${where} reactive fact key "${fact.key}" is not unique.`);
    }
    factKeys.add(fact.key);
    if (fact.observes.kind === "conversation_acknowledged") {
      const watched = fact.observes;
      if (
        !definition.requirements.some(
          (candidate) =>
            candidate.kind === "npc_conversation" &&
            candidate.progressKey === watched.requirementProgressKey,
        )
      ) {
        throw new Error(
          `${where} reactive conversation fact must name one of its own conversation requirements.`,
        );
      }
      continue;
    }
    if (!fabricationActionIds().includes(fact.observes.actionId)) {
      throw new Error(`${where} reactive fact must observe an authored Fabrication recipe.`);
    }
    if (fact.observes.kind === "fabrication_override_success") {
      const watched = fact.observes;
      const requirement = definition.requirements.find(
        (candidate) =>
          candidate.kind === "tracked_activity" &&
          candidate.progressKey === watched.requirementProgressKey,
      );
      if (
        requirement?.kind !== "tracked_activity" ||
        requirement.activity !== "fabrication" ||
        requirement.actionId !== watched.actionId
      ) {
        throw new Error(
          `${where} reactive success fact must watch a tracked Fabrication requirement for its recipe.`,
        );
      }
    }
  }
  for (const variant of definition.dialogue.reactive ?? []) {
    if (!factKeys.has(variant.factKey)) {
      throw new Error(`${where} reactive dialogue reads unknown fact "${variant.factKey}".`);
    }
    assertDialogue(definition.id, variant.dialogueId, "reactive dialogue");
    if (!definition.turnIn) {
      throw new Error(`${where} reactive dialogue needs a turn-in NPC to react.`);
    }
    assertDialogueNpc(
      definition.id,
      variant.dialogueId,
      definition.turnIn.npcId,
      "reactive dialogue",
    );
  }
}

/**
 * The offer route whose authored item gift an automatic continuation hands over
 * (#393): the continuation Mission's own offer made by the person the
 * predecessor is turned in to, when that offer grants something. It is the same
 * gift, from the same person, that accepting the offer in person would give —
 * one authored definition, never a second copy on the predecessor. Validation
 * allows only a `stack_item` gift here.
 */
export function continuationGiftOffer(
  predecessor: Pick<MissionDefinition, "turnIn">,
  continuation: Pick<MissionDefinition, "offers">,
): MissionOffer | undefined {
  const npcId = predecessor.turnIn?.npcId;
  if (!npcId) return undefined;
  return continuation.offers.find(
    (offer) => offer.npcId === npcId && offer.acceptEffect?.kind === "stack_item",
  );
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
    // The continuation hands over the gift of the target's offer at this
    // Mission's turn-in NPC (#393). Only an item grant has a capacity-safe
    // continuation path; a Credits gift would need a receipt it cannot show.
    const giftRoute = target?.offers.find(
      (offer) => offer.npcId === definition.turnIn?.npcId && offer.acceptEffect !== undefined,
    );
    if (giftRoute && giftRoute.acceptEffect?.kind !== "stack_item") {
      throw new Error(
        `${where} continues into "${target!.id}", whose offer at the turn-in NPC grants something a continuation cannot hand over.`,
      );
    }
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

/**
 * The item-offer contract (#369): one or more stackable items (a carried stack of
 * any is what makes the offer), complete copy, and at most one Mission offered by any one
 * item — two offers from one item would leave the Item Details action without a
 * single Mission to open.
 */
function assertItemOffer(
  definition: MissionDefinition,
  definitions: readonly MissionDefinition[],
): void {
  const where = `Mission "${definition.id}"`;
  const offer = definition.itemOffer!;
  if (offer.itemIds.length === 0) {
    throw new Error(`${where} item offer must name at least one item.`);
  }
  if (new Set(offer.itemIds).size !== offer.itemIds.length) {
    throw new Error(`${where} item offer names an item more than once.`);
  }
  for (const itemId of offer.itemIds) {
    const item = getItemDefinition(itemId);
    if (!item) throw new Error(`${where} item offer references unknown item "${itemId}".`);
    if (item.kind !== "stack") {
      throw new Error(
        `${where} item offer must target stackable items; a carried stack offers it.`,
      );
    }
    const duplicate = definitions.find(
      (other) => other.id !== definition.id && other.itemOffer?.itemIds.includes(itemId),
    );
    if (duplicate) {
      throw new Error(
        `${where} item offer for "${itemId}" duplicates Mission "${duplicate.id}"; one item offers one Mission.`,
      );
    }
  }
  for (const [field, copy] of Object.entries({
    inspectLabel: offer.inspectLabel,
    description: offer.description,
    acceptLabel: offer.acceptLabel,
    declineLabel: offer.declineLabel,
  })) {
    if (copy.trim().length === 0) throw new Error(`${where} item offer must author ${field}.`);
  }
}

/**
 * The lead contract (#369): lead NPCs and their scenes exist and belong together,
 * the shared fact has its own progress key, and no lead can be the required
 * contact, another lead, or an NPC another Mission slot already routes — a lead
 * that doubled as an offer or turn-in NPC would fight that owner for one hub entry.
 */
function assertConversationLeads(
  definition: MissionDefinition,
  requirement: Extract<MissionRequirement, { kind: "npc_conversation" }>,
  leads: NonNullable<Extract<MissionRequirement, { kind: "npc_conversation" }>["leads"]>,
  progressKeys: Set<string>,
): void {
  const where = `Mission "${definition.id}"`;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(leads.progressKey)) {
    throw new Error(`${where} lead progress key must be lowercase hyphenated text.`);
  }
  if (progressKeys.has(leads.progressKey)) {
    throw new Error(`${where} duplicates progress key "${leads.progressKey}".`);
  }
  progressKeys.add(leads.progressKey);
  if (leads.conversations.length === 0) {
    throw new Error(`${where} conversation leads must author at least one lead.`);
  }
  if (leads.followedObjective.trim().length === 0) {
    throw new Error(`${where} conversation leads must author the followed objective.`);
  }
  const conversationNpcIds = new Set(
    definition.requirements.flatMap((candidate) =>
      candidate.kind === "npc_conversation" ? [candidate.npcId] : [],
    ),
  );
  const seen = new Set<string>();
  for (const lead of leads.conversations) {
    if (!getNpc(lead.npcId)) {
      throw new Error(`${where} lead references unknown NPC "${lead.npcId}".`);
    }
    assertDialogue(definition.id, lead.dialogueId, "lead");
    assertDialogueNpc(definition.id, lead.dialogueId, lead.npcId, "lead");
    if (seen.has(lead.npcId)) {
      throw new Error(`${where} authors NPC "${lead.npcId}" as a lead more than once.`);
    }
    seen.add(lead.npcId);
    if (lead.npcId === requirement.npcId || conversationNpcIds.has(lead.npcId)) {
      throw new Error(`${where} lead NPC "${lead.npcId}" is also a required contact.`);
    }
    if (lead.npcId === definition.turnIn?.npcId) {
      throw new Error(`${where} lead NPC "${lead.npcId}" cannot be its turn-in NPC.`);
    }
    if (definition.offers.some((offer) => offer.npcId === lead.npcId)) {
      throw new Error(`${where} lead NPC "${lead.npcId}" cannot be an offer NPC.`);
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

function assertMissionStages(definition: MissionDefinition): void {
  const stages = definition.stages!;
  if (definition.reactiveFacts?.length || definition.dialogue.reactive?.length)
    throw new Error(`Mission "${definition.id}" stages do not support reactive facts yet`);
  const fail = (reason: string): never => {
    throw new Error(`Mission "${definition.id}" stages: ${reason}`);
  };
  if (stages.length === 0 || definition.requirements.length !== 0)
    fail("author a nonempty stage list instead of top-level requirements");
  if (!definition.turnIn || definition.autoCompletion) fail("need one final NPC turn-in");
  const seen = new Set<string>();
  for (const [index, stage] of stages.entries()) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(stage.id) || seen.has(stage.id))
      fail("stage IDs must be stable, unique lowercase hyphenated text");
    seen.add(stage.id);
    if (!stage.title.trim()) fail("stage needs a title");
    const conversations = stage.requirements.filter(
      (req): req is Extract<MissionRequirement, { kind: "npc_conversation" }> =>
        req.kind === "npc_conversation",
    );
    if (new Set(conversations.map((req) => req.npcId)).size !== conversations.length)
      fail("each stage may have only one mandatory conversation per NPC");
    const final = index === stages.length - 1;
    if (!final && stage.requirements.length === 0) fail("intermediate stages need requirements");
    for (const req of stage.requirements) {
      if (req.kind === "npc_conversation" && req.appliesOnPlanetId)
        fail("planet-waived conversations within stages are unsupported");
      if (req.kind === "ship_flight" || req.kind === "ship_fuel" || req.kind === "deferred_stage")
        fail("unsupported stage requirement");
      if (
        !final &&
        ((req.kind === "carried_stack" && req.turnIn !== "show") ||
          (req.kind === "carried_unique_item" && req.turnIn !== "show"))
      )
        fail("intermediate item consumption is unsupported");
    }
    for (const id of Object.values(stage.dialogue ?? {})) {
      assertDialogue(definition.id, id, "stage reminder");
      assertDialogueNpc(definition.id, id, definition.turnIn!.npcId, "stage reminder");
    }
    if (stage.onAdvance) {
      if (
        final ||
        stage.requirements.length !== 1 ||
        stage.requirements[0]?.kind !== "npc_conversation"
      )
        fail("a stage grant needs one explicit intermediate NPC acknowledgement");
      const grant = stage.onAdvance;
      const npc = (
        stage.requirements[0] as Extract<MissionRequirement, { kind: "npc_conversation" }>
      ).npcId;
      if (
        !definition.dialogue.capacitySlotsDialogueId ||
        !definition.dialogue.capacityMassDialogueId
      )
        fail("stage gifts need retryable capacity refusal dialogue");
      for (const id of [
        definition.dialogue.capacitySlotsDialogueId,
        definition.dialogue.capacityMassDialogueId,
      ])
        assertDialogueNpc(definition.id, id!, npc, "stage capacity refusal");
      const item = getItemDefinition(grant.itemId);
      if (
        item?.kind !== "stack" ||
        !Number.isInteger(grant.quantity) ||
        grant.quantity < 1 ||
        grant.quantity > item.stackLimit
      )
        fail("invalid stage stack grant");
      const dialogue = getDialogue(grant.presentationDialogueId);
      if (
        !dialogue ||
        dialogue.npcId !==
          (stage.requirements[0] as Extract<MissionRequirement, { kind: "npc_conversation" }>)
            .npcId ||
        !dialogue.beats.some(
          (beat) =>
            beat.kind === "item" &&
            beat.itemId === grant.itemId &&
            beat.quantity === grant.quantity,
        )
      )
        fail("stage grant must have a matching receipt-only item presentation");
    }
  }
}
