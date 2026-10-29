"use client";

import { XpAmount } from "@/components/ui/XpAmount";
import { RecipeTile } from "@/features/shared/RecipeTile";
import { seconds } from "@/features/shared/duration-copy";
import {
  learnedLapidaryTechniques,
  lapidaryRecipeLine,
  lapidaryTechniqueItem,
  lapidaryUnmetRequirements,
  type LapidaryTechnique,
} from "@/features/lapidary/technique-presentation";
import { GAME_TICK_MS, SKILL_IDS } from "@/game/config/foundations";

/** Read-only level knowledge. Authorization and carried materials belong to Work. */
export function LapidaryTechniquesCatalog({
  recipes,
  level,
}: {
  recipes: readonly LapidaryTechnique[];
  level: number;
}) {
  return (
    <div className="space-y-3" data-lapidary-techniques-catalog>
      <p className="text-sm text-[color:var(--rs-text-secondary)]">
        Techniques shows what you’ve learned at Lapidary {level}. Work shows what you can practice
        with what you’re carrying and Werner’s authorization.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {learnedLapidaryTechniques(recipes, level).map((recipe) => (
          <RecipeTile
            data-lapidary-catalog-entry={recipe.actionId}
            key={recipe.actionId}
            {...lapidaryTechniqueItem(recipe)}
            recipe={
              <>
                {`${lapidaryRecipeLine(recipe)} · ${seconds(recipe.durationTicks, GAME_TICK_MS)} · Always succeeds · `}
                <XpAmount amount={recipe.baseXp} prefix="+" skillId={SKILL_IDS.lapidary} />
              </>
            }
            requirements={lapidaryUnmetRequirements(recipe)}
            tileLabel={`${recipe.displayName}: ${lapidaryRecipeLine(recipe)}`}
          />
        ))}
      </div>
    </div>
  );
}
