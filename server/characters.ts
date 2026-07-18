import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { characters, playerAccounts, SLOT_MIN, SLOT_MAX, type Character } from "@/db/rune-space";
import { validateCharacterName } from "@/game/domain/character-name";

/** Postgres unique-violation error code. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown, constraintName?: string): boolean {
  if (typeof err !== "object" || err === null) return false;
  const pgErr = err as { code?: string; constraint?: string };
  if (pgErr.code !== UNIQUE_VIOLATION) return false;
  // When a constraint name is supplied, only match that specific unique index.
  // This prevents future unique constraints on `characters` from being
  // misattributed as "name already taken" (SSOT: characters_normalized_name_unique
  // is the global-name backstop).
  if (constraintName && pgErr.constraint !== constraintName) return false;
  return true;
}

/** The single global-name uniqueness backstop (see db/rune-space.ts). */
const GLOBAL_NAME_UNIQUE = "characters_normalized_name_unique";

/**
 * Server-authoritative character operations.
 *
 * All creation logic lives here (never in the UI). Character names are validated
 * and normalized through the single implementation in
 * `game/domain/character-name.ts`, and the three-slot rule is enforced
 * structurally (CHECK + unique index) and defensively in this transaction.
 */

export class CharacterError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "CharacterError";
  }
}

/** List a player account's characters, ordered by slot. */
export async function listCharacters(playerAccountId: string): Promise<Character[]> {
  return db
    .select()
    .from(characters)
    .where(eq(characters.playerAccountId, playerAccountId))
    .orderBy(characters.slot);
}

/** Return the set of occupied slot numbers for an account. */
export async function occupiedSlots(playerAccountId: string): Promise<Set<number>> {
  const rows = await db
    .select({ slot: characters.slot })
    .from(characters)
    .where(eq(characters.playerAccountId, playerAccountId));
  return new Set(rows.map((r) => r.slot));
}

/**
 * Create a character in the lowest free slot for the given player account.
 *
 * Concurrency-safe:
 * 1. Lock the player_accounts row with `FOR UPDATE` so concurrent creations
 *    serialize on the account.
 * 2. Compute the lowest free slot (1..3); reject if none.
 * 3. Insert; the unique (player_account_id, slot) index is a backstop that
 *    makes a duplicate insert a no-op rather than an error.
 */
export async function createCharacter(
  playerAccountId: string,
  rawName: string,
): Promise<Character> {
  const validation = validateCharacterName(rawName);
  if (!validation.ok) {
    throw new CharacterError(validation.error, 400);
  }

  return db.transaction(async (tx) => {
    // Lock the owning account row for the duration of this transaction.
    const locked = await tx
      .select({ id: playerAccounts.id })
      .from(playerAccounts)
      .where(eq(playerAccounts.id, playerAccountId))
      .for("update");
    if (!locked[0]) {
      throw new CharacterError("Player account not found", 404);
    }

    const used = await tx
      .select({ slot: characters.slot })
      .from(characters)
      .where(eq(characters.playerAccountId, playerAccountId));
    const usedSlots = new Set(used.map((r) => r.slot));

    let freeSlot: number | null = null;
    for (let slot = SLOT_MIN; slot <= SLOT_MAX; slot++) {
      if (!usedSlots.has(slot)) {
        freeSlot = slot;
        break;
      }
    }
    if (freeSlot === null) {
      throw new CharacterError("All character slots are full", 409);
    }

    const normalized = validation.normalized;

    // Friendly pre-check for a globally duplicate name. The DB unique index is
    // the authoritative backstop; this gives a clear message in the common case.
    const clash = await tx
      .select({ id: characters.id })
      .from(characters)
      .where(eq(characters.normalizedName, normalized))
      .limit(1);
    if (clash[0]) {
      throw new CharacterError("That character name is already taken", 409);
    }

    try {
      // Plain insert: the (player_account_id, slot) unique index cannot be hit
      // here because the FOR UPDATE lock serialized all creations for this
      // account. The only unique violation that can occur is the global
      // characters_normalized_name_unique index, caught below.
      await tx.insert(characters).values({
        playerAccountId,
        slot: freeSlot,
        displayName: validation.display,
        normalizedName: normalized,
      });
    } catch (err) {
      // The normalized_name unique index can still reject a concurrent clash.
      if (isUniqueViolation(err, GLOBAL_NAME_UNIQUE)) {
        throw new CharacterError("That character name is already taken", 409);
      }
      throw err;
    }

    const created = await tx
      .select()
      .from(characters)
      .where(and(eq(characters.playerAccountId, playerAccountId), eq(characters.slot, freeSlot)))
      .limit(1);

    const row = created[0];
    if (!row) {
      // Lost the slot to a concurrent insert despite the lock; treat as full.
      throw new CharacterError("All character slots are full", 409);
    }
    return row;
  });
}
