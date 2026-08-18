import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { LOCATION_IDS, PORTRAIT_IDS } from "@/game/config/foundations";
import { normalizeCharacterName } from "@/game/domain/character-name";
import { SLOT_MIN } from "@/db/rune-space";

/**
 * Shared fixture lifecycle for the real-PostgreSQL integration suites.
 *
 * Each suite lazily imports the Drizzle and server modules inside `beforeAll`
 * so the fast CI job (no DATABASE_URL) skips cleanly; these helpers therefore
 * take those already-loaded modules as arguments instead of importing them at
 * module load. The user-creation signature matches what the suites need; the
 * character name and cleanup behavior are deliberately unified so one helper
 * proves FK-safe teardown instead of five near-identical copies.
 */

type Db = (typeof import("@/db"))["db"];
type AuthSchema = typeof import("@/db/auth-schema");
type Rune = typeof import("@/db/rune-space");
type Ownership = typeof import("@/server/ownership");
type Characters = typeof import("@/server/characters");

/** Creates one Better Auth user row and returns its id. */
export async function createTestUser(
  db: Db,
  authSchema: AuthSchema,
  displayName: string,
  email?: string,
): Promise<string> {
  const userId = randomUUID();
  await db.insert(authSchema.user).values({
    id: userId,
    name: displayName,
    email: email ?? `${userId}@example.com`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return userId;
}

/**
 * Ensures the player account for a user and creates one character through the
 * authoritative command. Portraits are required at the creation boundary
 * (issue #65), so suites that do not care about portraits get a stable default
 * starter ID; suites that need a deliberately chosen portrait pass one.
 */
export async function createCharacterForUser(
  db: Db,
  rune: Rune,
  ownership: Ownership,
  characters: Characters,
  userId: string,
  characterName: string,
  portraitId: string = PORTRAIT_IDS.evaSalvageWelder,
) {
  const account = await ownership.ensurePlayerAccount(userId);
  return characters.createCharacter(account.id, characterName, portraitId);
}

/**
 * Seeds a legacy (pre-portrait) character row with a NULL portrait directly,
 * bypassing the creation command — the way characters created before issue #65
 * exist. Such characters must remain playable and resolve to the neutral
 * placeholder until their owner chooses a portrait.
 */
export async function createLegacyCharacterForUser(
  db: Db,
  rune: Rune,
  ownership: Ownership,
  userId: string,
  characterName: string,
  slot: number = SLOT_MIN,
) {
  const account = await ownership.ensurePlayerAccount(userId);
  const row = await db
    .insert(rune.characters)
    .values({
      playerAccountId: account.id,
      slot,
      displayName: characterName,
      normalizedName: normalizeCharacterName(characterName),
      currentLocationId: LOCATION_IDS.crashSite,
      portraitId: null,
    })
    .returning();
  return row[0]!;
}

/**
 * FK-safe teardown for everything a fixture may have created for a user:
 * all character gameplay rows (daily claims, mining/travel/provisioning state,
 * equipment, actions, XP, inventory, item instances), then characters, player
 * accounts, and finally the Better Auth user. Deleting rows that were never
 * created is a harmless no-op, so every suite can share one cleanup.
 */
export async function cleanupTestUser(db: Db, authSchema: AuthSchema, rune: Rune, userId: string) {
  const accounts = await db
    .select({ id: rune.playerAccounts.id })
    .from(rune.playerAccounts)
    .where(eq(rune.playerAccounts.userId, userId));
  for (const account of accounts) {
    const characterRows = await db
      .select({ id: rune.characters.id })
      .from(rune.characters)
      .where(eq(rune.characters.playerAccountId, account.id));
    for (const character of characterRows) {
      await db
        .delete(rune.characterPowerCellDailyClaims)
        .where(eq(rune.characterPowerCellDailyClaims.characterId, character.id));
      await db
        .delete(rune.characterMiningState)
        .where(eq(rune.characterMiningState.characterId, character.id));
      await db
        .delete(rune.characterRefiningState)
        .where(eq(rune.characterRefiningState.characterId, character.id));
      await db
        .delete(rune.characterStarterProvisioning)
        .where(eq(rune.characterStarterProvisioning.characterId, character.id));
      await db
        .delete(rune.characterTravelState)
        .where(eq(rune.characterTravelState.characterId, character.id));
      await db.delete(rune.equippedItems).where(eq(rune.equippedItems.characterId, character.id));
      await db.delete(rune.activeActions).where(eq(rune.activeActions.characterId, character.id));
      await db
        .delete(rune.characterSkillXp)
        .where(eq(rune.characterSkillXp.characterId, character.id));
      await db
        .delete(rune.inventoryStacks)
        .where(eq(rune.inventoryStacks.characterId, character.id));
      await db.delete(rune.itemInstances).where(eq(rune.itemInstances.characterId, character.id));
    }
    await db.delete(rune.characters).where(eq(rune.characters.playerAccountId, account.id));
  }
  await db.delete(rune.playerAccounts).where(eq(rune.playerAccounts.userId, userId));
  await db.delete(authSchema.user).where(eq(authSchema.user.id, userId));
}
