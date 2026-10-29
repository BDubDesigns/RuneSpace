import { resolveItemPresentation } from "@/game/content/item-presentation";
import type { LapidaryWorkbenchProjection } from "@/server/lapidary-state";

export type LapidaryTechnique = LapidaryWorkbenchProjection["recipes"][number];

/** Level knowledge is reference information, separate from permission to work. */
export function learnedLapidaryTechniques(recipes: readonly LapidaryTechnique[], level: number) {
  return recipes.filter((recipe) => recipe.minimumLevel <= level);
}

/** Presentation only: every Start still uses the server's canStart/access checks. */
export function workLapidaryTechniques(
  bench: Pick<LapidaryWorkbenchProjection, "recipes" | "level" | "access">,
  guidedActionIds: ReadonlySet<string>,
) {
  return learnedLapidaryTechniques(bench.recipes, bench.level).filter(
    (recipe) =>
      recipe.authorized &&
      (recipe.inputs.every((input) => input.carried >= input.quantity) ||
        guidedActionIds.has(recipe.actionId) ||
        // An authorized supervised lesson remains visible even if unpinned.
        bench.access.kind === "supervised"),
  );
}

export function lapidaryTechniqueItem(recipe: LapidaryTechnique) {
  const input = recipe.inputs[0]!;
  const itemId = recipe.outputItemId ?? input.itemId;
  return {
    itemId,
    name: resolveItemPresentation(itemId, itemId).displayName,
    quantity: recipe.outputItemId ? (recipe.outputQuantity ?? 1) : input.quantity,
    stackLimit: recipe.outputItemId ? recipe.outputStackLimit : input.stackLimit,
  };
}

export function lapidaryRecipeLine(recipe: LapidaryTechnique): string {
  const inputs = recipe.inputs.map((input) => `${input.quantity} ${input.name}`).join(" + ");
  return recipe.outputItemId
    ? `${inputs} → ${recipe.outputQuantity} ${lapidaryTechniqueItem(recipe).name}`
    : `${inputs} → consumed for practice; produces nothing (no output)`;
}

export function lapidaryUnmetRequirements(recipe: LapidaryTechnique): string[] {
  const missing = recipe.inputs
    .filter((input) => input.carried < input.quantity)
    .map((input) => `Need ${input.quantity - input.carried} more ${input.name}`);
  if (recipe.refusal && (!recipe.authorized || missing.length === 0)) missing.push(recipe.refusal);
  return missing;
}
