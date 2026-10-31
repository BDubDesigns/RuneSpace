import { and, desc, eq, isNull } from "drizzle-orm";
import { characterRuneTeleports } from "@/db/rune-space";
import { TELEPORT_RUNES, teleportDestinationPresentation } from "@/game/content/rune-teleports";
import type { RuneTeleportProjection } from "@/game/domain/rune-teleport";
import { loadLocationStateFacts } from "@/server/location-state";
import type { DatabaseTransaction } from "@/server/action-resolution";

/** The projection: each rune's labelled destination and the arrival still owed, if any. */
export async function loadRuneTeleportProjection(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<RuneTeleportProjection> {
  // The destination reads as this character's own place once their Rig stands there (#441).
  const facts = await loadLocationStateFacts(transaction, characterId);
  const [owed] = await transaction
    .select()
    .from(characterRuneTeleports)
    .where(
      and(
        eq(characterRuneTeleports.characterId, characterId),
        isNull(characterRuneTeleports.arrivalAcknowledgedAt),
      ),
    )
    .orderBy(desc(characterRuneTeleports.teleportedAt))
    .limit(1);
  return {
    runes: Object.fromEntries(
      Object.entries(TELEPORT_RUNES).map(([itemId, rune]) => [
        itemId,
        teleportDestinationPresentation(rune.destinationLocationId, facts),
      ]),
    ),
    ...(owed
      ? {
          arrival: {
            ...teleportDestinationPresentation(owed.destinationLocationId, facts),
            intentId: owed.intentId,
            itemId: owed.itemId,
            arrivedAt: owed.teleportedAt.toISOString(),
          },
        }
      : {}),
  };
}
