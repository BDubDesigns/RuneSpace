import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { characters, type Character } from "@/db/rune-space";
import { validateCharacterName } from "@/game/domain/character-name";
import type { CharacterTarget } from "@/game/schemas/whispers";

type Executor = Pick<typeof db, "select">;

/** The one refusal for any character a social command cannot address. */
export const CHARACTER_TARGET_NOT_FOUND = "Character not found.";

/**
 * Resolve the other character named by a character-facing surface (#247): by
 * stable id from a chat sender or Whisper, or by public name from the
 * same-location profile and Nearby Players list. A name resolves only to a
 * character at the viewer's current location — the same boundary as the
 * profile it came from — so names are never a game-wide player lookup.
 * Undefined for anything else; callers answer with one generic refusal so a
 * guess reveals nothing.
 */
export async function resolveCharacterTarget(
  target: CharacterTarget,
  viewer: Pick<Character, "currentLocationId">,
  executor: Executor = db,
): Promise<Character | undefined> {
  if ("characterId" in target) {
    const [row] = await executor
      .select()
      .from(characters)
      .where(eq(characters.id, target.characterId))
      .limit(1);
    return row;
  }
  const validation = validateCharacterName(target.name);
  if (!validation.ok) return undefined;
  const [row] = await executor
    .select()
    .from(characters)
    .where(
      and(
        eq(characters.normalizedName, validation.normalized),
        eq(characters.currentLocationId, viewer.currentLocationId),
      ),
    )
    .limit(1);
  return row;
}
