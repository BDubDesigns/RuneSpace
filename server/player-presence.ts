import { sql } from "drizzle-orm";
import { db } from "@/db";
import { playerPresence } from "@/db/rune-space";
import { requirePlayableOwnedCharacter } from "@/server/gameplay-access";

/** Presence is one row per account; neither the browser nor a character supplies an account ID. */
export async function checkInPlayer(userId: string, characterId: string): Promise<boolean> {
  const character = await requirePlayableOwnedCharacter(userId, characterId);
  const rows = await db
    .insert(playerPresence)
    .values({ playerAccountId: character.playerAccountId, lastCheckInAt: sql`clock_timestamp()` })
    .onConflictDoUpdate({
      target: playerPresence.playerAccountId,
      set: { lastCheckInAt: sql`clock_timestamp()` },
      // Multiple tabs share a row and cannot multiply writes. Never move time backwards.
      setWhere: sql`${playerPresence.lastCheckInAt} < clock_timestamp() - interval '15 seconds'`,
    })
    .returning({ playerAccountId: playerPresence.playerAccountId });
  return rows.length > 0;
}

/** Only the aggregate leaves the server. Exactly two minutes old has expired. */
export async function getPlayersOnline(): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(playerPresence)
    .where(sql`${playerPresence.lastCheckInAt} > clock_timestamp() - interval '2 minutes'`);
  return rows[0]?.count ?? 0;
}
