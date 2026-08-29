import { ACTION_IDS } from "@/game/config/foundations";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { miningAwardFacts } from "@/game/domain/mining";
import { refiningAwardFacts } from "@/game/domain/refining";

/**
 * The items an action authoritatively produces, derived DIRECTLY from the
 * gameplay resolvers' award facts — not from a parallel hand-maintained
 * output table. Mining and Refining encode what they produce exactly once
 * (their award facts); quest-guidance recommendation validation reads that
 * same source, so changing an action's authoritative output can never leave
 * guidance validation stale. Actions with no material output resolve to
 * undefined.
 */
export function getActionOutputItemIds(actionId: string): readonly string[] | undefined {
  const balance = getEffectiveGameBalance();
  switch (actionId) {
    case ACTION_IDS.ferriteShaleMining:
      return [miningAwardFacts(balance).itemId];
    case ACTION_IDS.refining:
      return refiningAwardFacts(balance).outputs.map((output) => output.itemId);
    default:
      return undefined;
  }
}
