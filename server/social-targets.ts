import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { characters, type Character } from "@/db/rune-space";
import { validateCharacterName } from "@/game/domain/character-name";
import type { CharacterTarget } from "@/game/schemas/whispers";

type Executor = Pick<Parameters<Parameters<typeof db.transaction>[0]>[0], "select">;

/** The one refusal for any character a social command cannot address. */
export const CHARACTER_TARGET_NOT_FOUND = "Character not found.";

/**
 * Where a public name may resolve. `same-location` is the same-location
 * profile and Nearby Players boundary, used for Block and Report by name;
 * `anywhere` is the Whispers tab's exact-name start, which reaches any
 * character by its current (globally unique) name, online or not.
 */
export type NameScope = "same-location" | "anywhere";

/**
 * Resolve the other character named by a social surface (#247): by stable id
 * from a chat sender or Whisper, or by exact current name. Names match the
 * folded unique key characters are stored under — never a prefix or a search
 * — and, unless `names` is `anywhere`, only at the viewer's current location.
 * Undefined for anything else; callers answer with one generic refusal so a
 * guess reveals nothing beyond whether that exact name exists. A caller inside
 * a transaction passes it as `executor`, so the read never waits on a second
 * pooled connection while the transaction holds locks.
 */
export async function resolveCharacterTarget(
  target: CharacterTarget,
  viewer: Pick<Character, "currentLocationId">,
  { names = "same-location", executor = db }: { names?: NameScope; executor?: Executor } = {},
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
        names === "anywhere"
          ? undefined
          : eq(characters.currentLocationId, viewer.currentLocationId),
      ),
    )
    .limit(1);
  return row;
}
