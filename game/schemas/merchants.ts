import { z } from "zod";
import { ContentId } from "./ids";

/**
 * One authored merchant price line.
 *
 * `buyPrice` is what the merchant pays the player per unit; `sellPrice` is what
 * the player pays the merchant per unit. Either may be absent: an item the
 * merchant only buys has no sell price, and vice versa. Prices are whole
 * Credits and always positive — a free or negative line is a content error, not
 * a runtime case to handle.
 *
 * `dailySellLimit` (#230), when authored, is how many units the merchant sells
 * each character per RuneSpace Pacific reset date. It limits units bought from
 * this line that day — not how many the character owns — and selling back
 * never restores it. Only a line the player can buy from may author one.
 */
export const MerchantPriceSchema = z
  .object({
    itemId: ContentId,
    buyPrice: z.number().int().positive().optional(),
    sellPrice: z.number().int().positive().optional(),
    dailySellLimit: z.number().int().positive().optional(),
  })
  .strict()
  .refine((price) => price.buyPrice !== undefined || price.sellPrice !== undefined, {
    message: "A merchant price line must author at least one direction",
  })
  .refine((price) => price.dailySellLimit === undefined || price.sellPrice !== undefined, {
    message: "A daily sell limit needs a sell price to limit",
  });

export const MerchantDefinitionSchema = z
  .object({
    id: ContentId,
    /** The resident who fronts this merchant, for player-facing presentation. */
    npcId: ContentId,
    /**
     * The Mission whose ACCEPTANCE opens this merchant, when one does (#190).
     *
     * Wade sells practice stock only once he has taken the player on at the
     * bench; Bix sells to anyone who walks in and authors nothing here. The
     * same accepted-Mission record that opens the Workbench opens this, so
     * there is no second trade-unlock flag, and it stays true after the Mission
     * completes.
     */
    authorizingMissionId: ContentId.optional(),
    prices: z.array(MerchantPriceSchema).min(1),
  })
  .strict()
  .refine(
    (merchant) =>
      new Set(merchant.prices.map((price) => price.itemId)).size === merchant.prices.length,
    { message: "A merchant must not author the same item twice" },
  );

export type MerchantPrice = z.infer<typeof MerchantPriceSchema>;
export type MerchantDefinition = z.infer<typeof MerchantDefinitionSchema>;
