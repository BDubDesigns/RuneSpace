import { eq } from "drizzle-orm";
import { characters } from "@/db/rune-space";
import type { DatabaseTransaction } from "@/server/action-resolution";

/**
 * The character-wide Auto-discard Slag preference (#256).
 *
 * Practice Welding and Refining both read this one value, so it has one
 * durable home on the character rather than in either activity's state. It is
 * a preference, not progression: changing it never touches a run, a partial
 * weld, or an action.
 *
 * Callers read it inside the owned-character transaction that already holds the
 * character row lock, so what a resolution sees is what the player last set.
 * A character that has never changed it is Off.
 */
export async function loadAutoDiscardSlag(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<boolean> {
  const rows = await transaction
    .select({ autoDiscardSlag: characters.autoDiscardSlag })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  return rows[0]?.autoDiscardSlag ?? false;
}
