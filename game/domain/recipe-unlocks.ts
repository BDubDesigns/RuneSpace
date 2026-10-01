import {
  fabricationRecipes,
  getEffectiveGameBalance,
  refiningRecipes,
  type EffectiveGameBalance,
} from "@/game/config/balance";

/**
 * Recipe-unlock derivation (issue #274): which authored recipes a level
 * crossing newly unlocks, read straight from the canonical recipe registries.
 *
 * There is deliberately no unlock list of its own. A recipe is discovered by
 * its registry's skill and its authored `minimumLevel`, so authoring a recipe
 * normally is all a future recipe needs. The level transition is the state
 * boundary: a crossing from `previousLevel` to `level` unlocks exactly the
 * recipes whose `minimumLevel` lies in `(previousLevel, level]`, so a skipped
 * level never skips a recipe and a later award above the threshold never
 * repeats it.
 */

/** The authored facts unlock derivation and its notice need from a recipe. */
export type UnlockableRecipe = {
  actionId: string;
  outputItemId: string;
  minimumLevel: number;
  inputs: readonly { itemId: string; quantity: number }[];
};

/**
 * Every authored recipe gated by one skill, in authored order. Each
 * level-gated recipe registry names its own skill; a skill with no registry
 * has no recipes.
 */
export function skillRecipes(
  skillId: string,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): readonly UnlockableRecipe[] {
  const registries: readonly { skillId: string; recipes: readonly UnlockableRecipe[] }[] = [
    { skillId: balance.refining.skillId, recipes: refiningRecipes(balance) },
    { skillId: balance.fabrication.skillId, recipes: fabricationRecipes(balance) },
  ];
  return registries
    .filter((registry) => registry.skillId === skillId)
    .flatMap((registry) => registry.recipes);
}

/**
 * The recipes a crossing from `previousLevel` to `level` newly unlocks,
 * lowest unlock level first and otherwise in authored order. Empty when the
 * level did not rise.
 */
export function recipesUnlockedBetween(
  skillId: string,
  previousLevel: number,
  level: number,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): UnlockableRecipe[] {
  if (level <= previousLevel) return [];
  return skillRecipes(skillId, balance)
    .filter((recipe) => recipe.minimumLevel > previousLevel && recipe.minimumLevel <= level)
    .sort((a, b) => a.minimumLevel - b.minimumLevel);
}

/**
 * A recipe's player-facing name in an unlock notice: its output's name, plus
 * its inputs when another recipe of the same skill makes the same output
 * ("Slag from Galvanite"), so two unlocks never read identically. Names come
 * from the caller's item presentation; nothing here restates them.
 */
export function recipeUnlockName(
  recipe: UnlockableRecipe,
  sameSkillRecipes: readonly UnlockableRecipe[],
  nameOf: (itemId: string) => string,
): string {
  const output = nameOf(recipe.outputItemId);
  const shared = sameSkillRecipes.some(
    (other) => other.actionId !== recipe.actionId && other.outputItemId === recipe.outputItemId,
  );
  if (!shared) return output;
  return `${output} from ${recipe.inputs.map((input) => nameOf(input.itemId)).join(" + ")}`;
}

/** The grouped notice text for one progression event. */
export function recipeUnlockNoticeBody(input: {
  skillName: string;
  level: number;
  recipeNames: readonly string[];
}): string {
  const heading = input.recipeNames.length === 1 ? "New recipe unlocked:" : "New recipes unlocked:";
  return [
    `${input.skillName} Level ${input.level} reached.`,
    heading,
    ...input.recipeNames.map((name) => `- ${name}`),
  ].join("\n");
}
