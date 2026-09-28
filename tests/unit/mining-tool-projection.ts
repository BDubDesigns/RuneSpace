import { getEffectiveGameBalance, getMiningToolDefinition } from "@/game/config/balance";
import { ITEM_IDS } from "@/game/config/foundations";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { miningAttemptDurationTicks } from "@/game/domain/mining";
import type { EquippedMiningToolProjection } from "@/server/play";

/**
 * An equipped Mining tool exactly as the play state projects it (#233), built
 * from the tool's own authored definition at The Jag's Ferrite Shale — so a
 * client test never hand-writes a charge ceiling or duration of its own.
 */
export function miningToolProjection(
  itemId: string,
  currentCharge: number,
  miningLevel = 1,
): EquippedMiningToolProjection {
  const balance = getEffectiveGameBalance();
  const tool = getMiningToolDefinition(itemId, balance)!;
  const source = balance.mining.sources.ferriteShale;
  return {
    itemId,
    name: resolveItemPresentation(itemId, itemId).displayName,
    currentCharge,
    maximumCharge: tool.maximumCharge,
    requiredMiningLevel: tool.requiredMiningLevel,
    usable: miningLevel >= tool.requiredMiningLevel,
    baseDurationMultiplierBps: tool.baseDurationMultiplierBps,
    chargedEffect: tool.chargedEffect,
    attemptDurationTicks: miningAttemptDurationTicks(balance, source, tool, false),
    boostedAttemptDurationTicks: miningAttemptDurationTicks(balance, source, tool, true),
  };
}

export function salvageCutterProjection(currentCharge: number): EquippedMiningToolProjection {
  return miningToolProjection(ITEM_IDS.salvageCutter, currentCharge);
}
