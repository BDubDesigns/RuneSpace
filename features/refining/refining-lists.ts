import { GAME_TICK_MS } from "@/game/config/foundations";
import type { RefiningRecipeProjection } from "@/server/play";

/**
 * What the Refining console lists (#239), mirroring the Fabrication Station's
 * split: Refine answers "what can I refine right now?", Recipes answers "what
 * do I know?", and the public Wiki is the whole skill, future recipes
 * included. Presentation only — the server still authorizes every Start.
 */

/**
 * Refine: recipes the character's level unlocks and whose materials are
 * carried for one batch — plus any recipe a Mission is guiding, so guidance
 * never points at a hidden recipe; it stays visible with what it is missing.
 */
export function refineVisibleRecipes(
  recipes: readonly RefiningRecipeProjection[],
  guidedActionIds: ReadonlySet<string>,
): RefiningRecipeProjection[] {
  return recipes.filter(
    (recipe) => guidedActionIds.has(recipe.actionId) || (recipe.unlocked && recipe.inputsAvailable),
  );
}

/** Recipes: every recipe the character's level unlocks, carried materials or not. */
export function learnedRefiningRecipes(
  recipes: readonly RefiningRecipeProjection[],
): RefiningRecipeProjection[] {
  return recipes.filter((recipe) => recipe.unlocked);
}

/** One attempt as one line, e.g. "2 Ferrite Shale → 1 Refined Ferrite". */
export function refiningRecipeLine(recipe: RefiningRecipeProjection): string {
  return `${recipe.inputs.map((input) => `${input.quantity} ${input.name}`).join(" + ")} → ${recipe.outputQuantity} ${recipe.outputName}`;
}

/** Refining's duration format, as the run summary already writes it: "4.2s". */
export function refiningSeconds(ticks: number): string {
  return `${((ticks * GAME_TICK_MS) / 1000).toFixed(1)}s`;
}

/** "Certain" for a recipe that never rolls, else its current success chance. */
export function refiningChance(recipe: RefiningRecipeProjection): string {
  return recipe.deterministic ? "Certain" : `${(recipe.successChanceBps / 100).toFixed(2)}%`;
}

/** What still stands between the character and one attempt of a recipe. */
export function refiningUnmetRequirements(
  recipe: RefiningRecipeProjection,
  level: number,
): string[] {
  const unmet: string[] = [];
  if (!recipe.unlocked) unmet.push(`Requires Refining ${recipe.minimumLevel} (you are ${level})`);
  for (const input of recipe.inputs) {
    if (input.carried < input.quantity) {
      unmet.push(`Need ${input.quantity - input.carried} more ${input.name}`);
    }
  }
  return unmet;
}
