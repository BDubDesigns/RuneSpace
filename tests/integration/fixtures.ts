import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { LOCATION_IDS, PORTRAIT_IDS } from "@/game/config/foundations";
import { normalizeCharacterName } from "@/game/domain/character-name";
import { SLOT_MIN } from "@/db/rune-space";
import { getEffectiveGameBalance } from "@/game/config/balance";

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

/**
 * The explicit Player identity of a fixture account (issue #221).
 * `displayUsername` is the readable Player name tests assert on; the unique
 * `username` key is synthetic (`fixture:<userId>`) — `:` can never appear in a
 * real Player name — so parallel suites may reuse readable names without
 * colliding, and fixture accounts are never mistaken for pre-cutover accounts
 * (which have no username at all).
 */
export function testPlayerIdentity(userId: string, displayName: string) {
  return { name: displayName, username: `fixture:${userId}`, displayUsername: displayName };
}

/**
 * Creates one Better Auth user row and returns its id. Fixture accounts are
 * explicitly verified, like every account allowed to reserve characters;
 * suites proving the verification gate itself pass `emailVerified: false`.
 */
export async function createTestUser(
  db: Db,
  authSchema: AuthSchema,
  displayName: string,
  email?: string,
  options: { emailVerified?: boolean } = {},
): Promise<string> {
  const userId = randomUUID();
  await db.insert(authSchema.user).values({
    id: userId,
    ...testPlayerIdentity(userId, displayName),
    email: email ?? `${userId}@example.com`,
    emailVerified: options.emailVerified ?? true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return userId;
}

/**
 * The `granted_by` value of fixture Early Access grants (issue #223). Test
 * accounts that exercise gameplay need gameplay access exactly like real
 * accounts; fixtures grant it directly (never through a runtime path) so
 * gameplay suites stay independent of the global public-gameplay switch. It is
 * deliberately not a real operator id.
 */
export const FIXTURE_EARLY_ACCESS_GRANTOR = "fixture:early-access";

/**
 * Grants account-level Early Access to a fixture account. Idempotent: an
 * account that already has a grant keeps it unchanged.
 */
export async function grantFixtureEarlyAccess(db: Db, rune: Rune, playerAccountId: string) {
  await db
    .update(rune.playerAccounts)
    .set({
      earlyAccessGrantedAt: new Date(),
      earlyAccessGrantedByAdminUserId: FIXTURE_EARLY_ACCESS_GRANTOR,
    })
    .where(
      and(
        eq(rune.playerAccounts.id, playerAccountId),
        isNull(rune.playerAccounts.earlyAccessGrantedAt),
      ),
    );
}

/**
 * Ensures the player account for a user and creates one character through the
 * authoritative command. Portraits are required at the creation boundary
 * (issue #65), so suites that do not care about portraits get a stable default
 * starter ID; suites that need a deliberately chosen portrait pass one.
 * The account receives fixture Early Access (issue #223) so gameplay suites can
 * play; suites proving the gameplay gate pass `gameplayAccess: false`.
 */
export async function createCharacterForUser(
  db: Db,
  rune: Rune,
  ownership: Ownership,
  characters: Characters,
  userId: string,
  characterName: string,
  portraitId: string = PORTRAIT_IDS.evaSalvageWelder,
  options: { seedLegacyStarterCutter?: boolean; gameplayAccess?: boolean } = {
    seedLegacyStarterCutter: true,
  },
) {
  const account = await ownership.ensurePlayerAccount(userId);
  if (options.gameplayAccess !== false) await grantFixtureEarlyAccess(db, rune, account.id);
  const character = await characters.createCharacter(account.id, characterName, portraitId);
  if (options.seedLegacyStarterCutter !== false) {
    await seedLegacyStarterCutter(db, rune, character.id);
  }
  return character;
}

/** Explicit compatibility fixture for older gameplay suites; production provisioning no longer does this. */
export async function seedLegacyStarterCutter(db: Db, rune: Rune, characterId: string) {
  const balance = getEffectiveGameBalance();
  const [instance] = await db
    .insert(rune.itemInstances)
    .values({ characterId, itemId: balance.items.salvageCutter.itemId })
    .returning();
  if (!instance) throw new Error("Legacy starter Cutter fixture was not created");
  await db.insert(rune.equippedItems).values({
    characterId,
    assignmentKind: "gear",
    suitSlotId: balance.items.salvageCutter.suitSlotId,
    itemInstanceId: instance.id,
  });
  return instance;
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
  options: { gameplayAccess?: boolean } = {},
) {
  const account = await ownership.ensurePlayerAccount(userId);
  if (options.gameplayAccess !== false) await grantFixtureEarlyAccess(db, rune, account.id);
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
      await cleanupTestCharacter(db, rune, character.id);
    }
    await db.delete(rune.characters).where(eq(rune.characters.playerAccountId, account.id));
    await db
      .delete(rune.playerPortraitUnlocks)
      .where(eq(rune.playerPortraitUnlocks.playerAccountId, account.id));
    // Account-scoped operator audit rows (issue #223) reference the account.
    await db
      .delete(rune.operatorAuditLogs)
      .where(eq(rune.operatorAuditLogs.playerAccountId, account.id));
  }
  await db.delete(rune.playerAccounts).where(eq(rune.playerAccounts.userId, userId));
  await db.delete(authSchema.user).where(eq(authSchema.user.id, userId));
}

/**
 * Removes one disposable E2E character without invalidating its worker's
 * Better Auth account. The order mirrors the FK-safe user teardown above.
 */
export async function cleanupTestCharacter(db: Db, rune: Rune, characterId: string) {
  await db.transaction(async (tx) => {
    // Page polling can lazily create character-scoped state. Hold the parent
    // row until every child is removed so no late request can recreate a child
    // between the FK-safe deletes and the final character delete.
    await tx
      .select({ id: rune.characters.id })
      .from(rune.characters)
      .where(eq(rune.characters.id, characterId))
      .for("update");
    await tx
      .delete(rune.characterPowerCellDailyClaims)
      .where(eq(rune.characterPowerCellDailyClaims.characterId, characterId));
    await tx
      .delete(rune.characterMiningState)
      .where(eq(rune.characterMiningState.characterId, characterId));
    await tx
      .delete(rune.characterRefiningState)
      .where(eq(rune.characterRefiningState.characterId, characterId));
    await tx
      .delete(rune.characterRepairTargets)
      .where(eq(rune.characterRepairTargets.characterId, characterId));
    await tx
      .delete(rune.characterPracticeWelds)
      .where(eq(rune.characterPracticeWelds.characterId, characterId));
    await tx
      .delete(rune.characterWorkOrderPostings)
      .where(eq(rune.characterWorkOrderPostings.characterId, characterId));
    await tx
      .delete(rune.characterWorkOrderBoardRefreshes)
      .where(eq(rune.characterWorkOrderBoardRefreshes.characterId, characterId));
    await tx
      .delete(rune.cargoHoldItemInstances)
      .where(eq(rune.cargoHoldItemInstances.characterId, characterId));
    await tx.delete(rune.cargoHoldStacks).where(eq(rune.cargoHoldStacks.characterId, characterId));
    await tx
      .delete(rune.characterStarterProvisioning)
      .where(eq(rune.characterStarterProvisioning.characterId, characterId));
    await tx
      .delete(rune.characterMissions)
      .where(eq(rune.characterMissions.characterId, characterId));
    await tx
      .delete(rune.characterScavengeReveals)
      .where(eq(rune.characterScavengeReveals.characterId, characterId));
    await tx
      .delete(rune.characterTravelState)
      .where(eq(rune.characterTravelState.characterId, characterId));
    await tx.delete(rune.equippedItems).where(eq(rune.equippedItems.characterId, characterId));
    await tx.delete(rune.activeActions).where(eq(rune.activeActions.characterId, characterId));
    await tx
      .delete(rune.characterSkillXp)
      .where(eq(rune.characterSkillXp.characterId, characterId));
    await tx.delete(rune.inventoryStacks).where(eq(rune.inventoryStacks.characterId, characterId));
    await tx
      .delete(rune.operatorAuditLogs)
      .where(eq(rune.operatorAuditLogs.characterId, characterId));
    await tx.delete(rune.itemInstances).where(eq(rune.itemInstances.characterId, characterId));
    await tx.delete(rune.characters).where(eq(rune.characters.id, characterId));
  });
}

/**
 * Seed one repair target's durable state for a character (#172).
 *
 * Repair rows are created lazily by the repair commands, so a suite that wants
 * a character to already be mid-repair (or finished) inserts the row rather
 * than updating a row that provisioning no longer creates.
 */
export async function seedRepairTarget(
  db: Db,
  rune: Rune,
  characterId: string,
  targetId: string,
  values: {
    /** Installed material as `{ itemId: quantity }`; see `installedMaterials`. */
    materials?: Readonly<Record<string, number>>;
    weldingProgress?: number;
    completedAt?: Date | null;
    updatedAt?: Date;
  },
): Promise<void> {
  const row = {
    materials: values.materials ?? {},
    weldingProgress: values.weldingProgress ?? 0,
    completedAt: values.completedAt ?? null,
    updatedAt: values.updatedAt ?? new Date(),
  };
  await db
    .insert(rune.characterRepairTargets)
    .values({ characterId, targetId, ...row })
    .onConflictDoUpdate({
      target: [rune.characterRepairTargets.characterId, rune.characterRepairTargets.targetId],
      set: row,
    });
}

/**
 * The `materials` JSON for a repair row, built from the target's authored
 * recipe (#209).
 *
 * Suites that need a repair already paid for used to name the two columns the
 * old schema had. A recipe is now an authored list, so they name the recipe
 * instead and override only the quantity the test is actually about:
 *
 * ```ts
 * materials: installedMaterials(crewStop)                                 // all of it
 * materials: installedMaterials(crewStop, { [ITEM_IDS.refinedFerrite]: 19 }) // one short
 * ```
 */
export function installedMaterials(
  recipe: { materials: readonly { itemId: string; quantity: number }[] },
  overrides: Readonly<Record<string, number>> = {},
): Record<string, number> {
  return Object.fromEntries(
    recipe.materials.map((requirement) => [
      requirement.itemId,
      overrides[requirement.itemId] ?? requirement.quantity,
    ]),
  );
}

/** One authored material's required quantity, by item ID. */
export function requiredQuantity(
  recipe: { materials: readonly { itemId: string; quantity: number }[] },
  itemId: string,
): number {
  const requirement = recipe.materials.find((candidate) => candidate.itemId === itemId);
  if (!requirement) throw new Error(`Repair recipe authors no "${itemId}" requirement`);
  return requirement.quantity;
}
