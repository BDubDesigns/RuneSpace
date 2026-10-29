import type { CraftingCapacitySnapshot } from "@/game/domain/deterministic-crafting";
import type { ActiveAction } from "@/db/rune-space";
import { lapidaryRecipes, getItemDefinition } from "@/game/config/balance";
import { LAPIDARY_WORKBENCH } from "@/game/content/lapidary";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { craftingAffordableCycles, craftingStartCheck } from "@/game/domain/deterministic-crafting";
import { ticksToMilliseconds } from "@/game/domain/timing";
import { lapidaryActivity, loadLapidaryAccess } from "@/server/lapidary";
import type { DatabaseTransaction } from "@/server/action-resolution";

export async function projectLapidaryWorkbench(
  transaction: DatabaseTransaction,
  characterId: string,
  action: ActiveAction | undefined,
  capacity: CraftingCapacitySnapshot,
) {
  const [access, row] = await Promise.all([
    loadLapidaryAccess(transaction, characterId),
    lapidaryActivity.loadRow(transaction, characterId),
  ]);
  const recipes = lapidaryRecipes().map((recipe) => {
    const allowed =
      access.kind === "unrestricted" ||
      (access.kind === "supervised" && access.actionId === recipe.actionId);
    const check = craftingStartCheck(capacity, recipe);
    const affordable = craftingAffordableCycles(capacity, recipe);
    return {
      ...recipe,
      outputStackLimit:
        "outputItemId" in recipe
          ? (() => {
              const item = getItemDefinition(recipe.outputItemId);
              return item?.kind === "stack" ? item.stackLimit : undefined;
            })()
          : undefined,
      outputItemId: "outputItemId" in recipe ? recipe.outputItemId : undefined,
      outputQuantity: "outputQuantity" in recipe ? recipe.outputQuantity : undefined,
      authorized: allowed,
      canStart: allowed && check.ok,
      refusal: !allowed
        ? "Speak to Werner before using this recipe."
        : !check.ok
          ? check.reason === "insufficient_inputs"
            ? "Bring the required material."
            : check.reason === "recipe_locked"
              ? "Your Lapidary level is too low."
              : "Make room for the finished Cut Quartz."
          : undefined,
      affordableCycles: allowed
        ? access.kind === "supervised"
          ? Math.min(1, affordable)
          : affordable
        : 0,
      inputs: recipe.inputs.map((input) => ({
        ...input,
        name: resolveItemPresentation(input.itemId, input.itemId).displayName,
        stackLimit: (() => {
          const item = getItemDefinition(input.itemId);
          return item?.kind === "stack" ? item.stackLimit : undefined;
        })(),
        carried: capacity.stacks
          .filter((stack) => stack.itemId === input.itemId)
          .reduce((sum, stack) => sum + stack.quantity, 0),
      })),
    };
  });
  const active = recipes.find((recipe) => recipe.actionId === action?.actionId);
  return {
    access,
    recipes,
    run: lapidaryActivity.runStateFromRow(row),
    lastStopReason: row?.lastStopReason,
    instruction:
      access.kind === "locked"
        ? "Speak to Werner. His authorization is required to use the Lapidary Workbench."
        : access.kind === "supervised"
          ? "One supervised lesson is authorized. Return to Werner when it is finished."
          : "Werner has authorized unrestricted use of the workbench.",
    cycle:
      active && action
        ? {
            recipeActionId: active.actionId,
            startedAt: action.resolvedThroughAt.toISOString(),
            endsAt: new Date(
              action.resolvedThroughAt.getTime() + ticksToMilliseconds(active.durationTicks),
            ).toISOString(),
            finishCurrent: row?.finishCurrent ?? false,
          }
        : undefined,
    locationId: LAPIDARY_WORKBENCH.locationId,
    level: capacity.skillLevel,
  };
}
export type LapidaryWorkbenchProjection = Awaited<ReturnType<typeof projectLapidaryWorkbench>>;
