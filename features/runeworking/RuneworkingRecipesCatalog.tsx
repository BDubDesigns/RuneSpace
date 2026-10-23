"use client";

import { XpAmount } from "@/components/ui/XpAmount";
import { usePlay } from "@/features/play/PlayContext";
import {
  runeworkingRecipeLine,
  runeworkingUnmetRequirements,
} from "@/features/runeworking/rig-copy";
import { seconds } from "@/features/shared/duration-copy";
import { RecipeTile } from "@/features/shared/RecipeTile";
import { GAME_TICK_MS, SKILL_IDS } from "@/game/config/foundations";

/**
 * Recipes (#391): the character's learned Runeworking recipes — every one their
 * level unlocks, whether or not the materials are carried — as a read-only
 * reference. Nothing above the character's level appears; the public Wiki is
 * the whole skill's reference. Attune stays the place to make something.
 */
export function RuneworkingRecipesCatalog() {
  const { state } = usePlay();
  const recipes = state.resonanceRig.recipes.filter((recipe) => recipe.unlocked);
  return (
    <div className="space-y-3" data-rig-recipes-catalog>
      <p className="text-sm text-[color:var(--rs-text-secondary)]">
        Every recipe you know at Runeworking {state.runeworking.level}. Runeworking never fails:
        every attunement makes its piece.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {recipes.map((recipe) => (
          <RecipeTile
            data-rig-recipes-entry={recipe.actionId}
            itemId={recipe.outputItemId}
            key={recipe.actionId}
            name={recipe.outputName}
            quantity={recipe.outputQuantity}
            recipe={
              <>
                {`${runeworkingRecipeLine(recipe)} · ${seconds(recipe.durationTicks, GAME_TICK_MS)} · `}
                <XpAmount amount={recipe.baseXp} skillId={SKILL_IDS.runeworking} />
              </>
            }
            requirements={runeworkingUnmetRequirements(recipe, state.runeworking.level)}
            stackLimit={recipe.outputStackLimit}
            tileLabel={`${recipe.outputName}: ${runeworkingRecipeLine(recipe)}`}
          />
        ))}
      </div>
    </div>
  );
}
