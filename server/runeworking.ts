import { characterRuneworkingState } from "@/db/rune-space";
import { runeworkingRecipes } from "@/game/config/balance";
import { SKILL_IDS } from "@/game/config/foundations";
import {
  RUNEWORKING_STATIONS,
  getRuneworkingStation,
  type RuneworkingStation,
} from "@/game/content/resonance-rig";
import { createCraftingActivity } from "@/server/deterministic-crafting";
import { isMissionCompleted } from "@/server/mission-state";
import { isRepairTargetComplete } from "@/server/welding";
import type { DatabaseTransaction } from "@/server/action-resolution";
export type {
  CraftingRunCycle as RuneworkingRunCycle,
  CraftingRunState as RuneworkingRunState,
  PersistedCraftingOutcome as PersistedRuneworkingOutcome,
} from "@/server/deterministic-crafting";
async function stationUnlocked(
  transaction: DatabaseTransaction,
  characterId: string,
  station: RuneworkingStation,
): Promise<boolean> {
  return station.unlock.kind === "mission_completed"
    ? isMissionCompleted(transaction, characterId, station.unlock.missionId)
    : isRepairTargetComplete(transaction, characterId, station.unlock.targetId);
}

/**
 * Whether the Resonance Rig at one location is this character's to use (#391,
 * #441): Hilltop Workshop's opens with Not From Around Here, and a personal Rig
 * at the Crash Site with that character's own finished Rig repair. With no
 * location it asks whether ANY station is open, which is all an in-flight cycle
 * resolved away from the keyboard needs: it was started at an open station, and
 * nothing here ever closes again.
 */
export async function loadResonanceRigUnlocked(
  transaction: DatabaseTransaction,
  characterId: string,
  locationId?: string,
): Promise<boolean> {
  if (locationId !== undefined) {
    const station = getRuneworkingStation(locationId);
    return station ? stationUnlocked(transaction, characterId, station) : false;
  }
  for (const station of RUNEWORKING_STATIONS) {
    if (await stationUnlocked(transaction, characterId, station)) return true;
  }
  return false;
}
export const runeworkingActivity = createCraftingActivity({
  table: characterRuneworkingState,
  skillId: SKILL_IDS.runeworking,
  activity: "runeworking",
  recipes: runeworkingRecipes,
  loadAccess: async (transaction, id, locationId) =>
    (await loadResonanceRigUnlocked(transaction, id, locationId))
      ? { kind: "unrestricted" }
      : { kind: "locked" },
});
export const {
  runStateFromRow: runeworkingRunStateFromRow,
  ensureState: ensureRuneworkingState,
  loadRow: loadRuneworkingRow,
  isAction: isRuneworkingAction,
  persistOutcome: persistRuneworkingOutcome,
  createResolver: createRuneworkingResolver,
  resetRun: resetRuneworkingRun,
  clearCycle: clearRuneworkingCycle,
} = runeworkingActivity;
export async function loadRuneworkingCapacity(transaction: DatabaseTransaction, id: string) {
  const capacity = await runeworkingActivity.loadCapacity(transaction, id);
  return { ...capacity, runeworkingLevel: capacity.skillLevel };
}
export async function loadRuneworkingSnapshot(transaction: DatabaseTransaction, id: string) {
  const snapshot = await runeworkingActivity.loadSnapshot(transaction, id);
  return { ...snapshot, runeworkingLevel: snapshot.skillLevel };
}
