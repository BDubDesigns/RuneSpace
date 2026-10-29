import { characterRuneworkingState } from "@/db/rune-space";
import { runeworkingRecipes } from "@/game/config/balance";
import { SKILL_IDS } from "@/game/config/foundations";
import { HILLTOP_WORKSHOP_CONTENT } from "@/game/content/hilltop-workshop";
import { createCraftingActivity } from "@/server/deterministic-crafting";
import { isMissionCompleted } from "@/server/mission-state";
import type { DatabaseTransaction } from "@/server/action-resolution";
export type {
  CraftingRunCycle as RuneworkingRunCycle,
  CraftingRunState as RuneworkingRunState,
  PersistedCraftingOutcome as PersistedRuneworkingOutcome,
} from "@/server/deterministic-crafting";
export async function loadResonanceRigUnlocked(
  transaction: DatabaseTransaction,
  characterId: string,
) {
  return isMissionCompleted(
    transaction,
    characterId,
    HILLTOP_WORKSHOP_CONTENT.resonanceRigUnlockMissionId,
  );
}
export const runeworkingActivity = createCraftingActivity({
  table: characterRuneworkingState,
  skillId: SKILL_IDS.runeworking,
  activity: "runeworking",
  recipes: runeworkingRecipes,
  loadAccess: async (transaction, id) =>
    (await loadResonanceRigUnlocked(transaction, id))
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
