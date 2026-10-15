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
    /**
     * The Mission whose COMPLETION (accepted, finished and turned in) opens
     * trading with this merchant, when one does (#357).
     *
     * Last Leg Trading opens only for a character who has reported Thrust Issues
     * to Wade. It reads the same completed-Mission record Local Place access and
     * NPC relocation already read, so there is no second unlock flag and it is
     * per character. It gates both directions, on every server command, and is
     * independent of anything the player has read in conversation. A merchant
     * authors this or `authorizingMissionId`, never both.
     */
    requiredCompletedMissionId: ContentId.optional(),
    /** What the Trade surface tells a player while `requiredCompletedMissionId` is unmet. */
    lockedMessage: z.string().min(1).optional(),
    prices: z.array(MerchantPriceSchema).min(1),
  })
  .strict()
  .refine(
    (merchant) =>
      merchant.requiredCompletedMissionId === undefined ||
      merchant.authorizingMissionId === undefined,
    {
      message: "A merchant authors an accepted-Mission unlock or a completed-Mission one, not both",
    },
  )
  .refine(
    (merchant) =>
      (merchant.requiredCompletedMissionId === undefined) ===
      (merchant.lockedMessage === undefined),
    { message: "A completed-Mission unlock authors its locked message, and only it does" },
  )
  .refine(
    (merchant) =>
      new Set(merchant.prices.map((price) => price.itemId)).size === merchant.prices.length,
    { message: "A merchant must not author the same item twice" },
  );

export type MerchantPrice = z.infer<typeof MerchantPriceSchema>;
export type MerchantDefinition = z.infer<typeof MerchantDefinitionSchema>;
