import { and, eq, sql } from "drizzle-orm";
import { characterMerchantDailyPurchases } from "@/db/rune-space";
import type { DatabaseTransaction } from "@/server/action-resolution";

/**
 * The merchant daily purchase ledger (#230): Wade's Scrap and Bix's Power
 * Cells, each limited per character per Pacific reset date.
 *
 * Its own small module because the purchase command writes it and the play
 * state reads it, and `server/trade.ts` already depends on `server/play.ts`.
 */

/** Every merchant line this character has bought from on one reset date. */
export async function loadMerchantDailyPurchases(
  transaction: DatabaseTransaction,
  input: { characterId: string; resetDate: string },
): Promise<{ merchantId: string; itemId: string; quantityPurchased: number }[]> {
  return transaction
    .select({
      merchantId: characterMerchantDailyPurchases.merchantId,
      itemId: characterMerchantDailyPurchases.itemId,
      quantityPurchased: characterMerchantDailyPurchases.quantityPurchased,
    })
    .from(characterMerchantDailyPurchases)
    .where(
      and(
        eq(characterMerchantDailyPurchases.characterId, input.characterId),
        eq(characterMerchantDailyPurchases.resetDate, input.resetDate),
      ),
    );
}

/**
 * Consume `quantity` of one line's allowance for one reset date, or nothing.
 *
 * Called inside the purchase transaction, after every other refusal has had its
 * chance and before Credits or inventory change, so the allowance is spent by
 * exactly the purchase that commits — a refusal or rollback spends none.
 *
 * The caller already holds the character row lock, which serializes every
 * trade this character makes. This statement is still guarded on its own:
 * the increment is conditional on the new total staying within the limit, so
 * no interleaving, retry, or stale read can take a line past it. `false`
 * means the allowance could not cover the purchase and nothing was written.
 */
export async function consumeMerchantDailyAllowance(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    merchantId: string;
    itemId: string;
    resetDate: string;
    quantity: number;
    limit: number;
    now: Date;
  },
): Promise<boolean> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new RangeError("A purchase consumes a positive whole allowance");
  }
  if (input.quantity > input.limit) return false;
  const table = characterMerchantDailyPurchases;
  const recorded = await transaction
    .insert(table)
    .values({
      characterId: input.characterId,
      merchantId: input.merchantId,
      itemId: input.itemId,
      resetDate: input.resetDate,
      quantityPurchased: input.quantity,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: [table.characterId, table.merchantId, table.itemId, table.resetDate],
      set: {
        quantityPurchased: sql`${table.quantityPurchased} + excluded.quantity_purchased`,
        updatedAt: input.now,
      },
      setWhere: sql`${table.quantityPurchased} + excluded.quantity_purchased <= ${input.limit}`,
    })
    .returning({ quantityPurchased: table.quantityPurchased });
  return recorded.length > 0;
}
