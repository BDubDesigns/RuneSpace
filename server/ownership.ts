import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auth } from "@/server/auth";
import { playerAccounts, characters, type PlayerAccount, type Character } from "@/db/rune-space";

/**
 * Server-authoritative ownership boundaries (single source of truth for
 * "who is this request, and do they own this character?").
 *
 * Every helper here authenticates the session and resolves RuneSpace ownership
 * server-side. Client-supplied character IDs or payloads can NEVER reveal
 * another user's data, because we always re-load through the authenticated
 * user's player account and verify the FK matches.
 *
 * Responsibilities (one authoritative implementation each):
 * - `requireCurrentUser`  — authenticate session, return Better Auth user.
 * - `ensurePlayerAccount`  — idempotently create the 1:1 account for a user.
 * - `requirePlayerAccount` — load the account, throwing if missing.
 * - `requireOwnedCharacter`— load a character and verify it belongs to the
 *                           authenticated user's account.
 */

export class OwnershipError extends Error {
  constructor(
    message: string,
    readonly status: number = 401,
  ) {
    super(message);
    this.name = "OwnershipError";
  }
}

/** Authenticate the request via Better Auth and return the current user. */
export async function requireCurrentUser(
  headers: Headers,
): Promise<{ id: string; email: string; name: string }> {
  const session = await auth.api.getSession({ headers });
  if (!session?.user) {
    throw new OwnershipError("Authentication required", 401);
  }
  return session.user;
}

/**
 * Idempotently create (or fetch) the single RuneSpace player account for a
 * Better Auth user.
 *
 * Concurrency-safe: the unique `user_id` constraint plus
 * `ON CONFLICT DO NOTHING` means concurrent calls cannot create duplicates;
 * we then SELECT the row that exists.
 */
export async function ensurePlayerAccount(userId: string): Promise<PlayerAccount> {
  return db.transaction(async (tx) => {
    await tx
      .insert(playerAccounts)
      .values({ userId })
      .onConflictDoNothing({ target: playerAccounts.userId });

    const existing = await tx
      .select()
      .from(playerAccounts)
      .where(eq(playerAccounts.userId, userId))
      .limit(1);

    const row = existing[0];
    if (!row) {
      // Should be impossible given the insert above, but stay defensive.
      throw new OwnershipError("Failed to resolve player account", 500);
    }
    return row;
  });
}

/** Load the player account for a user, throwing if it does not exist. */
export async function requirePlayerAccount(userId: string): Promise<PlayerAccount> {
  const rows = await db
    .select()
    .from(playerAccounts)
    .where(eq(playerAccounts.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new OwnershipError("Player account not found", 404);
  }
  return row;
}

/**
 * Load a character by ID and verify it belongs to the authenticated user's
 * player account. Returns the character, or throws if not found / not owned.
 *
 * This is the authoritative guard for every protected character route. Even if a
 * caller forges another user's character ID, the FK join through the
 * authenticated account rejects it.
 */
export async function requireOwnedCharacter(
  userId: string,
  characterId: string,
): Promise<Character> {
  const account = await requirePlayerAccount(userId);

  const rows = await db.select().from(characters).where(eq(characters.id, characterId)).limit(1);
  const character = rows[0];

  if (!character) {
    throw new OwnershipError("Character not found", 404);
  }
  if (character.playerAccountId !== account.id) {
    // Forged/foreign character ID: do not reveal existence details.
    throw new OwnershipError("Character not found", 404);
  }
  return character;
}
