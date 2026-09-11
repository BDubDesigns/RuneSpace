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
 */
export const MerchantPriceSchema = z
  .object({
    itemId: ContentId,
    buyPrice: z.number().int().positive().optional(),
    sellPrice: z.number().int().positive().optional(),
  })
  .strict()
  .refine((price) => price.buyPrice !== undefined || price.sellPrice !== undefined, {
    message: "A merchant price line must author at least one direction",
  });

export const MerchantDefinitionSchema = z
  .object({
    id: ContentId,
    /** The resident who fronts this merchant, for player-facing presentation. */
    npcId: ContentId,
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
