import {
  runeworkingRecipes,
  getEffectiveGameBalance,
  type EffectiveGameBalance,
} from "@/game/config/balance";
import {
  craftingStartCheck,
  craftingAffordableCycles,
  resolveCrafting,
  validateCraftingRecipes,
  type CraftingCapacitySnapshot,
  type CraftingRunSnapshot,
} from "@/game/domain/deterministic-crafting";
export {
  checkCraftingCycle as checkRuneworkingCycle,
  craftingRecipeUnlocked as runeworkingRecipeUnlocked,
  nextCraftingCycle as nextRuneworkingCycle,
} from "@/game/domain/deterministic-crafting";
export type {
  CraftingStopReason as RuneworkingStopReason,
  CraftingCycleCheck as RuneworkingCycleCheck,
  CraftingResolution as RuneworkingResolution,
  CraftingResolvedCycle as RuneworkingResolvedCycle,
} from "@/game/domain/deterministic-crafting";
export type RuneworkingCapacitySnapshot = Omit<CraftingCapacitySnapshot, "skillLevel"> & {
  runeworkingLevel: number;
};
export type RuneworkingRunSnapshot = RuneworkingCapacitySnapshot &
  Omit<CraftingRunSnapshot, keyof CraftingCapacitySnapshot>;
export const runeworkingStartCheck = (
  snapshot: RuneworkingCapacitySnapshot,
  ...args: Parameters<typeof craftingStartCheck> extends [unknown, ...infer R] ? R : never
) => craftingStartCheck({ ...snapshot, skillLevel: snapshot.runeworkingLevel }, ...args);
export const runeworkingAffordableCycles = (
  snapshot: Pick<RuneworkingCapacitySnapshot, "runeworkingLevel" | "stacks">,
  recipe: Parameters<typeof craftingAffordableCycles>[1],
) => craftingAffordableCycles({ ...snapshot, skillLevel: snapshot.runeworkingLevel }, recipe);
export const resolveRuneworking = (
  input: Omit<Parameters<typeof resolveCrafting>[0], "snapshot"> & {
    snapshot: RuneworkingRunSnapshot;
  },
) =>
  resolveCrafting({
    ...input,
    snapshot: { ...input.snapshot, skillLevel: input.snapshot.runeworkingLevel },
  });
export const validateRuneworkingRecipes = (
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
) => validateCraftingRecipes(runeworkingRecipes(balance), balance);
