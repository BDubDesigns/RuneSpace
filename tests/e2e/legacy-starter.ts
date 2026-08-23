import { db } from "@/db";
import { equippedItems, itemInstances } from "@/db/rune-space";
import { getEffectiveGameBalance } from "@/game/config/balance";

/**
 * Compatibility fixture for pre-#102 Mining E2E scenarios. This is test data,
 * not starter provisioning: the production path intentionally waits for the
 * Walk It Off reward before creating a first Cutter.
 */
export async function seedLegacyStarterCutter(characterId: string) {
  const balance = getEffectiveGameBalance();
  const [cutter] = await db
    .insert(itemInstances)
    .values({ characterId, itemId: balance.items.salvageCutter.itemId, currentCharge: 0 })
    .returning();
  if (!cutter) throw new Error("Legacy E2E Cutter fixture was not created");
  await db.insert(equippedItems).values({
    characterId,
    assignmentKind: "gear",
    suitSlotId: balance.items.salvageCutter.suitSlotId,
    itemInstanceId: cutter.id,
  });
  return cutter;
}
