import { ITEM_IDS, MERCHANT_IDS, MISSION_IDS, NPC_IDS } from "@/game/config/foundations";
import { MerchantDefinitionSchema, type MerchantDefinition } from "@/game/schemas/merchants";
import { getLocation } from "@/game/content/locations";

/**
 * The authoritative merchant catalog (single source of truth).
 *
 * These are approved playtest balance values (#159). Prices live here, never in
 * JSX or command handlers: the Trade surface displays what this registry says
 * and the server charges what this registry says, so a client can never submit
 * an authoritative price or total.
 *
 * Bix's initial stock is deliberately one line deep. He sells Power Cells only,
 * and buys exactly the approved materials — no rotating stock, no simulated
 * finite inventory, no merchant wallet, no dynamic pricing.
 *
 * Wade sells practice stock out of his own yard (#190) — the same shape, at a
 * World Location rather than inside a Local Place.
 *
 * Ahead of Fabrication (#230), both lines that sell to the player carry a
 * per-character daily limit: Wade sells at most twelve Scrap and Bix at most
 * twelve Power Cells per character per Pacific reset date. There is still no
 * stock row or restock timer — the limit is this character's allowance from
 * that line today, recorded by the purchase itself.
 */
const merchantDefinitions = [
  {
    id: MERCHANT_IDS.bixWeller,
    npcId: NPC_IDS.bixWeller,
    prices: [
      { itemId: ITEM_IDS.powerCell, buyPrice: 4, sellPrice: 12, dailySellLimit: 12 },
      { itemId: ITEM_IDS.refinedFerrite, buyPrice: 10 },
      { itemId: ITEM_IDS.ferriteShale, buyPrice: 2 },
      { itemId: ITEM_IDS.slag, buyPrice: 1 },
      // Deep Jag materials (#209). Bix takes raw ore and rough stock; the
      // finished alloy is Wade's trade, not his.
      { itemId: ITEM_IDS.galvanite, buyPrice: 4 },
      { itemId: ITEM_IDS.galvanicStock, buyPrice: 18 },
      // Mining Secondary Finds (#308). Bix buys all three rough gems; Wade does not.
      { itemId: ITEM_IDS.uncutQuartz, buyPrice: 8 },
      { itemId: ITEM_IDS.uncutTopaz, buyPrice: 18 },
      { itemId: ITEM_IDS.uncutSapphire, buyPrice: 35 },
    ],
  },
  {
    // Last Leg Trading (#357): the business, so a future affiliated Stillreach
    // outlet names this same merchant and shares the per-character daily
    // allowances the ledger keys on its ID. That outlet is not built here.
    id: MERCHANT_IDS.lastLegTrading,
    npcId: NPC_IDS.tollKade,
    // Open only to a character who has reported Thrust Issues to Wade (#357). The
    // server revalidates this on every buy and sell, so it never depends on the
    // Trade button, on any conversation, or on the ship having flown.
    requiredCompletedMissionId: MISSION_IDS.thrustIssues,
    lockedMessage:
      "Trading unlocks after you report the completed Thrust Issues repair to Wade at Rusk Recovery.",
    // First-pass balance (#357). Toll sells Full and Empty canisters up to five a
    // character a Pacific day each, buys them back for less, and buys Oil Shale
    // without selling it.
    prices: [
      {
        itemId: ITEM_IDS.fullSmallFuelCanister,
        buyPrice: 160,
        sellPrice: 225,
        dailySellLimit: 5,
      },
      {
        itemId: ITEM_IDS.emptySmallFuelCanister,
        buyPrice: 25,
        sellPrice: 40,
        dailySellLimit: 5,
      },
      { itemId: ITEM_IDS.oilShale, buyPrice: 6 },
    ],
  },
  {
    id: MERCHANT_IDS.wadeRusk,
    npcId: NPC_IDS.wadeRusk,
    authorizingMissionId: MISSION_IDS.tenThousandHours,
    // Four Credits a piece, the same as he would charge anybody, and he takes
    // spare Scrap back at one (#230). He does not buy Slag back: Bix already
    // does, and one buyer for it is the economy.
    prices: [
      { itemId: ITEM_IDS.scrapMetal, buyPrice: 1, sellPrice: 4, dailySellLimit: 12 },
      // Wade starts buying structural material once the player is working at
      // Deep Jag depth (#209). No specialist differential yet: where he and
      // Bix both buy an item, the approved starting price is the same.
      { itemId: ITEM_IDS.refinedFerrite, buyPrice: 10 },
      { itemId: ITEM_IDS.galvanicStock, buyPrice: 18 },
      { itemId: ITEM_IDS.galvaferrite, buyPrice: 45 },
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

function authoredPriceLine(merchantId: string, itemId: string) {
  const line = getMerchant(merchantId)?.prices.find((price) => price.itemId === itemId);
  if (!line) throw new Error(`${merchantId} authors no price line for ${itemId}`);
  return line;
}

/**
 * What the player pays this merchant for one unit, for content that quotes it.
 *
 * Mission budgets and dialogue that state a shop price read it from here
 * (#230) rather than restating it, so a price change cannot leave a stale
 * number behind. A line that does not sell is a content error, not zero.
 */
export function merchantRetailPrice(merchantId: string, itemId: string): number {
  const { sellPrice } = authoredPriceLine(merchantId, itemId);
  if (sellPrice === undefined) throw new Error(`${merchantId} does not sell ${itemId}`);
  return sellPrice;
}

/** What this merchant pays the player for one unit, for content that quotes it. */
export function merchantBuybackPrice(merchantId: string, itemId: string): number {
  const { buyPrice } = authoredPriceLine(merchantId, itemId);
  if (buyPrice === undefined) throw new Error(`${merchantId} does not buy ${itemId}`);
  return buyPrice;
}

/**
 * The merchant a World Location itself hosts, when it hosts one (#190).
 *
 * A Local Place merchant is resolved through that place; this is the same
 * relationship one level up, for a yard that is a World Location in its own
 * right rather than a room in a town.
 */
export function getLocationMerchant(locationId: string): MerchantDefinition | undefined {
  const merchantId = getLocation(locationId)?.merchantId;
  return merchantId ? getMerchant(merchantId) : undefined;
}

/**
 * Whether this merchant is currently open to the character, given the Missions
 * they have accepted and completed. A merchant that authors no unlock is open
 * to anybody; one authors either an accepted Mission (Wade, #190) or a
 * completed one (Last Leg Trading, #357).
 */
export function isMerchantOpen(
  merchant: MerchantDefinition,
  facts: {
    acceptedMissionIds: ReadonlySet<string>;
    completedMissionIds: ReadonlySet<string>;
  },
): boolean {
  return (
    (merchant.authorizingMissionId === undefined ||
      facts.acceptedMissionIds.has(merchant.authorizingMissionId)) &&
    (merchant.requiredCompletedMissionId === undefined ||
      facts.completedMissionIds.has(merchant.requiredCompletedMissionId))
  );
}
