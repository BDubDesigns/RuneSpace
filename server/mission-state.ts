import { eq } from "drizzle-orm";
import { characterMissions, equippedItems, inventoryStacks } from "@/db/rune-space";
import { getEffectiveGameBalance, getItemDefinition } from "@/game/config/balance";
import { MISSIONS, type MissionDefinition } from "@/game/content/missions";
import {
  projectMission,
  validateMissionDefinitions,
  type MissionObservation,
  type MissionProjection,
} from "@/game/domain/missions";
import type { DatabaseTransaction } from "@/server/action-resolution";
import { loadOwnedItemInstances } from "@/server/carried-inventory";
import { resolveItemPresentation } from "@/game/content/item-presentation";

// Authored mission content is validated once at module load: unknown NPCs,
// locations, items, dialogues, prerequisites, reward skills, or a recommended
// acquisition action that does not authoritatively produce the required item
// all fail here, never at runtime inside a player transaction.
validateMissionDefinitions(MISSIONS);

/**
 * Authoritative mission projection for the play state. Persistence contains
 * only accepted/completed timestamps; state and objective copy are derived
 * from authored content plus the current location/action boundary and a live
 * observation of equipment/inventory. No quest progress is ever persisted.
 */
export async function loadMissionProjections(
  transaction: DatabaseTransaction,
  characterId: string,
  input: { currentLocationId: string; activeActionId?: string },
): Promise<readonly MissionProjection[]> {
  const [rows, itemState, stackRows, assignmentRows] = await Promise.all([
    transaction
      .select()
      .from(characterMissions)
      .where(eq(characterMissions.characterId, characterId)),
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
  ]);
  const byMissionId = new Map(rows.map((row) => [row.missionId, row]));
  const stationary = input.activeActionId === undefined;
  const observation = buildObservation(assignmentRows, itemState.carriedInstances, stackRows);
  return MISSIONS.map((mission) =>
    projectMission(
      mission,
      byMissionId.get(mission.id),
      input.currentLocationId,
      stationary,
      observation,
      prerequisiteCompletedFor(mission, byMissionId),
    ),
  );
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
  const observedItemIds = new Set<string>([
    ...equippedCarriedIds,
    ...carriedInstances.map((instance) => instance.itemId),
    ...carriedQuantities.keys(),
    ...requirementItemIds(MISSIONS),
  ]);
  for (const itemId of observedItemIds) {
    const displayName = resolveItemPresentation(itemId, itemId).displayName;
    if (displayName && displayName !== itemId) itemNames.set(itemId, displayName);
    const definition = getItemDefinition(itemId, balance);
    if (definition?.kind === "stack") stackLimits.set(itemId, definition.stackLimit);
  }
  return { equippedItemIds: equippedCarriedIds, carriedQuantities, stackLimits, itemNames };
}
