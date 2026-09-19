import { getEffectiveGameBalance } from "@/game/config/balance";
import type { MiningRunAttempt } from "@/server/mining";
import type { RefiningRunAttempt } from "@/server/refining";

/**
 * Reading a character's persisted run history back safely (#211 review).
 *
 * This lives apart from `server/mining` and `server/refining` because it is the
 * one thing about those tables that must be exercisable without a database: it
 * is pure translation, and the bug it fixes is a client crash, not a
 * persistence fault.
 */

/**
 * One persisted attempt, read back from `character_mining_state.recent_attempts`
 * and made safe to render (#211 review).
 *
 * That column is a bounded *display* history, not authoritative state, and it
 * was written in an older shape before Mining became source-driven: a single
 * `shaleAwarded` count, from the era when Ferrite Shale was the only thing a
 * Mining attempt could award. Nothing rewrites those rows when a character's
 * aggregates are migrated, so an upgraded character's own history would reach
 * the client missing `itemId` entirely and take the whole Play terminal down
 * with it. A history is never worth that, so a legacy row is translated to the
 * shape it would have been written in today, and a row that cannot be read at
 * all is dropped rather than rendered.
 */
export function normalizePersistedMiningAttempts(
  persisted: unknown,
  balance = getEffectiveGameBalance(),
): readonly MiningRunAttempt[] {
  if (!Array.isArray(persisted)) return [];
  return persisted.flatMap((entry): MiningRunAttempt[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const attempt = entry as Record<string, unknown>;
    if (typeof attempt.itemId === "string" && typeof attempt.quantityAwarded === "number") {
      return [attempt as unknown as MiningRunAttempt];
    }
    // The only source that existed when `shaleAwarded` was written.
    if (typeof attempt.shaleAwarded !== "number") return [];
    const { shaleAwarded, ...rest } = attempt;
    return [
      {
        ...rest,
        itemId: balance.items.ferriteShale.itemId,
        quantityAwarded: shaleAwarded,
      } as unknown as MiningRunAttempt,
    ];
  });
}

/**
 * One persisted attempt, read back from `character_refining_state.recent_attempts`
 * and made safe to render (#211 review).
 *
 * The same problem as Mining's history, and for the same reason: these rows
 * were written as `ferriteAwarded` / `slagAwarded` / `shaleConsumed` when the
 * Processing Yard had exactly one recipe, and no migration rewrites them. A
 * legacy row reaching the console without `awarded` or `consumed` crashes the
 * Play terminal for that character, so it is translated into the lists the
 * single Ferrite recipe would write today, and an unreadable row is dropped.
 */
export function normalizePersistedRefiningAttempts(
  persisted: unknown,
  balance = getEffectiveGameBalance(),
): readonly RefiningRunAttempt[] {
  if (!Array.isArray(persisted)) return [];
  const quantities = (entries: readonly [string, unknown][]) =>
    entries
      .filter(([, quantity]) => typeof quantity === "number" && quantity > 0)
      .map(([itemId, quantity]) => ({ itemId, quantity: quantity as number }));
  return persisted.flatMap((entry): RefiningRunAttempt[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const attempt = entry as Record<string, unknown>;
    if (Array.isArray(attempt.awarded) && Array.isArray(attempt.consumed)) {
      return [attempt as unknown as RefiningRunAttempt];
    }
    const { ferriteAwarded, slagAwarded, shaleConsumed, ...rest } = attempt;
    if (
      typeof ferriteAwarded !== "number" &&
      typeof slagAwarded !== "number" &&
      typeof shaleConsumed !== "number"
    ) {
      return [];
    }
    return [
      {
        ...rest,
        consumed: quantities([[balance.items.ferriteShale.itemId, shaleConsumed]]),
        awarded: quantities([
          [balance.items.refinedFerrite.itemId, ferriteAwarded],
          [balance.items.slag.itemId, slagAwarded],
        ]),
      } as unknown as RefiningRunAttempt,
    ];
  });
}
