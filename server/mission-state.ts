import { and, eq, isNotNull } from "drizzle-orm";
import {
  characterMissionProgress,
  characterMissions,
  equippedItems,
  inventoryStacks,
} from "@/db/rune-space";
import {
  getEffectiveGameBalance,
  getItemDefinition,
  getRepairTargetBalance,
} from "@/game/config/balance";
import { CONVERSATION_TOPICS } from "@/game/content/conversation-topics";
import { LOCAL_PLACES } from "@/game/content/local-places";
import { MISSIONS, type MissionDefinition } from "@/game/content/missions";
import { REPAIR_TARGETS } from "@/game/content/repair-targets";
import { validateRepairTargets } from "@/game/domain/repair-targets";
import { repairComplete, type RepairTargetState } from "@/game/domain/welding-repair";
import type { RepairTargetObservation } from "@/game/domain/missions";
import { validateConversationTopics } from "@/game/domain/conversation";
import { validateLocalPlaceAccess } from "@/game/domain/local-places";
import {
  projectMission,
  validateMissionDefinitions,
  type MissionObservation,
  type MissionProjection,
} from "@/game/domain/missions";
import type { DatabaseTransaction } from "@/server/action-resolution";
import { loadRepairTargetStates } from "@/server/welding";
import { loadOwnedItemInstances } from "@/server/carried-inventory";
import { resolveItemPresentation } from "@/game/content/item-presentation";

// Authored mission content is validated once at module load: unknown NPCs,
// locations, items, dialogues, prerequisites, reward skills, or a recommended
// acquisition action that does not authoritatively produce the required item
// all fail here, never at runtime inside a player transaction.
validateMissionDefinitions(MISSIONS);

// Authored conversation topics are validated on the same module-load boundary:
// unknown NPCs/dialogue, NPC mismatches, duplicate subjects, unknown Mission
// gates, and any attempt to reuse a Mission-owned sequence as a replayable
// social topic all fail here rather than inside a player conversation.
validateConversationTopics(CONVERSATION_TOPICS, MISSIONS);

// Local Place access that derives from Mission completion is validated on the
// same boundary: a place gating on a Mission that does not exist would stay
// locked forever rather than failing visibly.
validateLocalPlaceAccess(
  LOCAL_PLACES,
  new Set(MISSIONS.map((mission) => mission.id)),
  new Set(REPAIR_TARGETS.map((target) => target.id)),
);

// Authored repair targets are validated on the same module-load boundary: a
// target naming an unknown location, Local Place, or authorizing Mission would
// otherwise fail inside a player transaction rather than visibly at startup.
validateRepairTargets(REPAIR_TARGETS, new Set(MISSIONS.map((mission) => mission.id)));

/**
 * Authoritative mission projection for the play state. Persistence contains
 * accepted/completed timestamps plus narrow authored tracked-activity progress;
 * state and objective copy are derived from authored content, the current
 * location/action boundary, and live equipment/inventory observation.
 */
export async function loadMissionProjections(
  transaction: DatabaseTransaction,
  characterId: string,
  input: { currentLocationId: string; activeActionId?: string },
): Promise<readonly MissionProjection[]> {
  const [rows, progressRows, itemState, stackRows, assignmentRows, repairStates] =
    await Promise.all([
      transaction
        .select()
        .from(characterMissions)
        .where(eq(characterMissions.characterId, characterId)),
      transaction
        .select()
        .from(characterMissionProgress)
        .where(eq(characterMissionProgress.characterId, characterId)),
      loadOwnedItemInstances(transaction, characterId),
      transaction
        .select()
        .from(inventoryStacks)
        .where(eq(inventoryStacks.characterId, characterId))
        .for("update"),
      transaction
        .select()
        .from(equippedItems)
        .where(eq(equippedItems.characterId, characterId))
        .for("update"),
      loadRepairTargetStates(transaction, characterId),
    ]);
  const byMissionId = new Map(rows.map((row) => [row.missionId, row]));
  const progressByMissionId = new Map<string, Map<string, number>>();
  for (const row of progressRows) {
    const progress = progressByMissionId.get(row.missionId) ?? new Map<string, number>();
    progress.set(row.progressKey, row.progress);
    progressByMissionId.set(row.missionId, progress);
  }
  const stationary = input.activeActionId === undefined;
  const observation = buildObservation(
    assignmentRows,
    itemState.carriedInstances,
    stackRows,
    repairStates,
  );
  return MISSIONS.map((mission) => {
    const trackedProgress = progressByMissionId.get(mission.id);
    return projectMission(
      mission,
      byMissionId.get(mission.id),
      input.currentLocationId,
      stationary,
      trackedProgress ? { ...observation, trackedProgress } : observation,
      prerequisiteCompletedFor(mission, byMissionId),
    );
  });
}

/**
 * The Missions this character has completed, as the authoritative read for
 * derived world state (a Local Place that opens once a Mission is done).
 * Commands use this so access is revalidated server-side from the completion
 * record itself rather than trusted from the browser.
 */
export async function loadCompletedMissionIds(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<ReadonlySet<string>> {
  const rows = await transaction
    .select({ missionId: characterMissions.missionId })
    .from(characterMissions)
    .where(
      and(eq(characterMissions.characterId, characterId), isNotNull(characterMissions.completedAt)),
    );
  return new Set(rows.map((row) => row.missionId));
}

/**
 * True when the mission's authored prerequisite (if any) is completed for the
 * character. A mission with no prerequisite is always available.
 */
function prerequisiteCompletedFor(
  mission: MissionDefinition,
  byMissionId: ReadonlyMap<
    string,
    { missionId: string; acceptedAt: Date | null; completedAt: Date | null }
  >,
): boolean {
  if (!mission.prerequisiteMissionId) return true;
  const prerequisite = byMissionId.get(mission.prerequisiteMissionId);
  return Boolean(prerequisite?.completedAt);
}

/** Every item an authored equipped/carried requirement observes. */
function requirementItemIds(definitions: readonly MissionDefinition[]): readonly string[] {
  return definitions.flatMap((mission) =>
    mission.requirements
      .filter(
        (requirement): requirement is Extract<typeof requirement, { itemId: string }> =>
          requirement.kind === "equipped_item" || requirement.kind === "carried_stack",
      )
      .map((requirement) => requirement.itemId),
  );
}

/**
 * Resolves names and stack limits from authoritative content for exactly the
 * items this projection needs to describe — never a duplicated UI list.
 * Equipment counts only when the instance is genuinely carried (a stored
 * Cutter does not satisfy "equip the Cutter").
 *
 * Canonical items referenced by authored mission requirements are ALWAYS
 * included even when the character currently carries zero of them, so a
 * mission requirement (e.g. the Ferrite Shale full-stack limit) never changes
 * from 10 to 1 merely because the first item entered Inventory.
 */
function buildObservation(
  assignments: readonly { itemInstanceId: string }[],
  carriedInstances: readonly { id: string; itemId: string }[],
  stackRows: readonly { itemId: string; quantity: number }[],
  repairStates: ReadonlyMap<string, RepairTargetState>,
): MissionObservation {
  const balance = getEffectiveGameBalance();
  const carriedById = new Map(carriedInstances.map((instance) => [instance.id, instance.itemId]));
  const equippedCarriedIds = new Set(
    assignments
      .map((assignment) => carriedById.get(assignment.itemInstanceId))
      .filter((itemId): itemId is string => itemId !== undefined),
  );
  const carriedQuantities = new Map<string, number>();
  for (const stack of stackRows) {
    carriedQuantities.set(
      stack.itemId,
      (carriedQuantities.get(stack.itemId) ?? 0) + stack.quantity,
    );
  }
  const itemNames = new Map<string, string>();
  const stackLimits = new Map<string, number>();
  // Names must cover every observed item INCLUDING carried-but-unequipped
  // unique items (an unequipped Cutter still appears in objective copy), plus
  // every canonical item any authored requirement references (zero carried
  // Ferrite Shale must still resolve its authoritative stack limit).
  const repairTargets = repairTargetObservations(repairStates, balance);
  const observedItemIds = new Set<string>([
    ...equippedCarriedIds,
    ...carriedInstances.map((instance) => instance.itemId),
    ...carriedQuantities.keys(),
    ...requirementItemIds(MISSIONS),
    // Repair recipes name their own materials, and a repair objective must read
    // "Refined Ferrite" whether or not the player happens to be carrying any.
    ...repairMaterialItemIds(repairTargets),
  ]);
  for (const itemId of observedItemIds) {
    const displayName = resolveItemPresentation(itemId, itemId).displayName;
    if (displayName && displayName !== itemId) itemNames.set(itemId, displayName);
    const definition = getItemDefinition(itemId, balance);
    if (definition?.kind === "stack") stackLimits.set(itemId, definition.stackLimit);
  }
  return {
    equippedItemIds: equippedCarriedIds,
    carriedQuantities,
    stackLimits,
    itemNames,
    repairTargets,
  };
}

/** Every item any authored repair recipe consumes, for authoritative naming. */
export function repairMaterialItemIds(
  repairTargets: ReadonlyMap<string, RepairTargetObservation>,
): readonly string[] {
  return [...repairTargets.values()].flatMap((target) =>
    target.materials.map((material) => material.itemId),
  );
}

/**
 * Every authored repair target as the Mission projection may observe it: the
 * recipe from balance, the progress from the durable repair record (#172).
 *
 * A target with no row has never been worked on, which is zero progress rather
 * than a missing observation — so a Mission reads the same whether or not the
 * player has touched the job yet. Nothing here can report carried or stored
 * material as progress, because nothing here reads inventory.
 */
export function repairTargetObservations(
  repairStates: ReadonlyMap<string, RepairTargetState>,
  balance = getEffectiveGameBalance(),
): ReadonlyMap<string, RepairTargetObservation> {
  return new Map(
    REPAIR_TARGETS.map((target) => {
      const recipe = getRepairTargetBalance(target.id, balance);
      const repair = repairStates.get(target.id);
      return [
        target.id,
        {
          complete: repair ? repairComplete(repair) : false,
          materials: [
            {
              itemId: balance.items.refinedFerrite.itemId,
              contributed: repair?.refinedFerriteContributed ?? 0,
              required: recipe.refinedFerriteRequired,
            },
            {
              itemId: balance.items.slag.itemId,
              contributed: repair?.slagContributed ?? 0,
              required: recipe.slagRequired,
            },
          ].filter((material) => material.required > 0),
          welding: {
            completed: repair?.weldingProgress ?? 0,
            required: recipe.repairIncrements,
          },
        } satisfies RepairTargetObservation,
      ];
    }),
  );
}
