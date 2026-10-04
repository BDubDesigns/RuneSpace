"use client";

import { RecipeTile } from "@/features/shared/RecipeTile";
import {
  learnedRefiningRecipes,
  refiningChance,
  refiningRecipeLine,
  refiningSeconds,
  refiningUnmetRequirements,
} from "@/features/refining/refining-lists";
import type { RefiningRecipeProjection } from "@/server/play";
import { XpAmount } from "@/components/ui/XpAmount";
import { SKILL_IDS } from "@/game/config/foundations";

/**
 * Recipes (#239): the character's learned Refining recipes — every one their
 * level unlocks, whether or not the materials are carried — as a read-only
 * reference, the Refining counterpart of the Fabrication Station's catalog.
 * Nothing above the character's level appears; the public Wiki is the whole
 * skill's reference. Refine stays the place to start a run.
 */
export function RefiningRecipesCatalog({
  level,
  recipes,
}: {
  level: number;
  recipes: readonly RefiningRecipeProjection[];
}) {
  return (
    <div className="space-y-3" data-refining-recipes-catalog>
      <p className="text-sm text-[color:var(--rs-text-secondary)]">
        Every recipe you know at Refining {level}. Refine lists the ones your carried materials
        cover right now.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {learnedRefiningRecipes(recipes).map((recipe) => (
          <RecipeTile
            data-refining-catalog-entry={recipe.actionId}
            itemId={recipe.outputItemId}
            key={recipe.actionId}
            name={recipe.outputName}
            quantity={recipe.outputQuantity}
            recipe={
              <>
                {`${refiningRecipeLine(recipe)} · ${refiningSeconds(recipe.attemptDurationTicks)} · ${refiningChance(recipe)} · `}
                <XpAmount amount={recipe.successXp} prefix="+" skillId={SKILL_IDS.refining} />
              </>
            }
            requirements={refiningUnmetRequirements(recipe, level)}
            {...(recipe.outputStackLimit !== undefined
              ? { stackLimit: recipe.outputStackLimit }
              : {})}
            tileLabel={`${recipe.outputName}: ${refiningRecipeLine(recipe)}`}
          />
        ))}
      </div>
    </div>
  );
}
