import { ITEM_IDS, MERCHANT_IDS, NPC_IDS } from "@/game/config/foundations";
import { MerchantDefinitionSchema, type MerchantDefinition } from "@/game/schemas/merchants";

/**
 * The authoritative merchant catalog (single source of truth).
 *
 * These are approved playtest balance values (#159). Prices live here, never in
 * JSX or command handlers: the Trade surface displays what this registry says
 * and the server charges what this registry says, so a client can never submit
 * an authoritative price or total.
 *
 * Bix's initial stock is deliberately one line deep. He sells Power Cells only,
 * and buys exactly the four approved materials — no rotating stock, no
 * simulated finite inventory, no merchant wallet, no dynamic pricing.
 */
const merchantDefinitions = [
  {
    id: MERCHANT_IDS.bixWeller,
    npcId: NPC_IDS.bixWeller,
    prices: [
      { itemId: ITEM_IDS.powerCell, buyPrice: 3, sellPrice: 8 },
      { itemId: ITEM_IDS.refinedFerrite, buyPrice: 10 },
      { itemId: ITEM_IDS.ferriteShale, buyPrice: 2 },
      { itemId: ITEM_IDS.slag, buyPrice: 1 },
    ],
  },
] as const satisfies readonly MerchantDefinition[];

export const MERCHANTS: readonly MerchantDefinition[] = merchantDefinitions.map((merchant) =>
  MerchantDefinitionSchema.parse(merchant),
);

const merchantById = new Map<string, MerchantDefinition>(
  MERCHANTS.map((merchant) => [merchant.id, merchant]),
);

/** Resolve a merchant from the authoritative registry by stable ID. */
export function getMerchant(merchantId: string): MerchantDefinition | undefined {
  return merchantById.get(merchantId);
}
