import { getEffectiveGameBalance } from "@/game/config/balance";
import { miningSourceForActionId, refiningRecipeForActionId } from "@/game/config/balance";
import { miningAwardFacts } from "@/game/domain/mining";
import { refiningAwardFacts } from "@/game/domain/refining";

/**
 * The items an action authoritatively produces, derived DIRECTLY from the
 * gameplay resolvers' award facts — not from a parallel hand-maintained
 * output table. Mining and Refining encode what they produce exactly once
 * (their award facts); mission-guidance recommendation validation reads that
 * same source, so changing an action's authoritative output can never leave
 * guidance validation stale. Actions with no material output resolve to
 * undefined.
 *
 * Resolution is by action ID against the authored Mining source and Refining
 * recipe registries (#209), so a second ore and a second recipe need no new
 * case here.
 */
export function getActionOutputItemIds(actionId: string): readonly string[] | undefined {
  const balance = getEffectiveGameBalance();

  const source = miningSourceForActionId(actionId, balance);
  if (source) return [miningAwardFacts(balance, source).itemId];

  const recipe = refiningRecipeForActionId(actionId, balance);
  if (recipe) {
    const award = refiningAwardFacts(balance, recipe);
    const itemIds = new Set<string>();
    for (const output of award.successOutputs) itemIds.add(output.itemId);
    for (const outcome of award.failureOutcomes) {
      for (const output of outcome) itemIds.add(output.itemId);
    }
    return [...itemIds];
  }

  return undefined;
}
