import { and, desc, eq, isNull } from "drizzle-orm";
import { characterRuneTeleports } from "@/db/rune-space";
import { TELEPORT_RUNES, teleportDestinationPresentation } from "@/game/content/rune-teleports";
import type { RuneTeleportProjection } from "@/game/domain/rune-teleport";
import type { DatabaseTransaction } from "@/server/action-resolution";

/** The projection: each rune's labelled destination and the arrival still owed, if any. */
export async function loadRuneTeleportProjection(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<RuneTeleportProjection> {
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
        teleportDestinationPresentation(rune.destinationLocationId),
      ]),
    ),
    ...(owed
      ? {
          arrival: {
            ...teleportDestinationPresentation(owed.destinationLocationId),
            intentId: owed.intentId,
            itemId: owed.itemId,
            arrivedAt: owed.teleportedAt.toISOString(),
          },
        }
      : {}),
  };
}
