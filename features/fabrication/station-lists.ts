import type { FabricationRecipeProjection, TinkeringTargetProjection } from "@/server/play";

/**
 * What the Fabrication Station lists (#232 human-preview reconciliation). The
 * station answers "what can I do now?"; the Recipes surface answers "what do
 * I know how to make?"; the public Wiki is the whole skill, future recipes
 * included.
 */

/**
 * Fabricate: recipes the character's level unlocks and whose materials are
 * carried for one batch — plus any recipe a Mission is guiding, so guidance
 * never points at a hidden recipe; it stays visible with what it is missing.
 */
export function fabricateVisibleRecipes(
  recipes: readonly FabricationRecipeProjection[],
  guidedActionIds: ReadonlySet<string>,
): FabricationRecipeProjection[] {
  return recipes.filter(
    (recipe) => guidedActionIds.has(recipe.actionId) || (recipe.unlocked && recipe.inputsAvailable),
  );
}

/** Recipes: every recipe the character's level unlocks, carried materials or not. */
export function learnedRecipes(
  recipes: readonly FabricationRecipeProjection[],
): FabricationRecipeProjection[] {
  return recipes.filter((recipe) => recipe.unlocked);
}

/**
 * Tinker: level-unlocked targets the character carries a complete batch of.
 * A carried Cutter stopped only by the last-Cutter guard stays, so the item
 * does not silently vanish; its tile shows the safety reason instead.
 */
export function tinkerVisibleTargets(
  targets: readonly TinkeringTargetProjection[],
): TinkeringTargetProjection[] {
  return targets.filter(
    (target) => target.unlocked && (target.affordableBatches > 0 || target.lastCutterBlocked),
  );
}
