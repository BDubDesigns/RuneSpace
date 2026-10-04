"use client";

import { RecipeTile } from "@/features/shared/RecipeTile";
import { recipeLine, seconds, unmetRequirements } from "@/features/fabrication/station-copy";
import { learnedRecipes } from "@/features/fabrication/station-lists";
import { usePlay } from "@/features/play/PlayContext";
import { GAME_TICK_MS } from "@/game/config/foundations";
import { XpAmount } from "@/components/ui/XpAmount";
import { SKILL_IDS } from "@/game/config/foundations";

/**
 * Recipes (#232 human-preview reconciliation): the character's learned
 * Fabrication recipes — every one their level unlocks, whether or not the
 * materials are carried — as a read-only reference. Nothing above the
 * character's level appears; the public Wiki is the whole skill's reference.
 * Fabricate stays the place to make something.
 */
export function RecipesCatalog() {
  const { state } = usePlay();
  const recipes = learnedRecipes(state.fabricationStation.recipes);
  return (
    <div className="space-y-3" data-fabrication-recipes-catalog>
      <p className="text-sm text-[color:var(--rs-text-secondary)]">
        Every recipe you know at Fabrication {state.fabrication.level}. Fabricate lists the ones
        your carried materials cover right now.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {recipes.map((recipe) => (
          <RecipeTile
            data-recipes-catalog-entry={recipe.actionId}
            itemId={recipe.outputItemId}
            key={recipe.actionId}
            name={recipe.outputName}
            quantity={recipe.outputQuantity}
            recipe={
              <>
                {`${recipeLine(recipe)} · ${seconds(recipe.durationTicks, GAME_TICK_MS)} · `}
                <XpAmount amount={recipe.baseXp} skillId={SKILL_IDS.fabrication} />
              </>
            }
            requirements={unmetRequirements(recipe, state.fabrication.level)}
            {...(recipe.outputStackLimit !== undefined
              ? { stackLimit: recipe.outputStackLimit }
              : {})}
            tileLabel={`${recipe.outputName}: ${recipeLine(recipe)}`}
          />
        ))}
      </div>
    </div>
  );
}
