import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auth } from "@/server/auth";
import { playerAccounts, type PlayerAccount } from "@/db/rune-space";

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
 *
 * Gameplay reads of an owned character go through
 * `requirePlayableOwnedCharacter` in `server/gameplay-access.ts`, which also
 * enforces the issue #223 gameplay-access gate.
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

export type CurrentUser = { id: string; email: string; emailVerified: boolean };

/** Authenticate the request via Better Auth and return the current user. */
export async function requireCurrentUser(headers: Headers): Promise<CurrentUser> {
  const session = await auth.api.getSession({ headers });
  if (!session?.user) {
    throw new OwnershipError("Authentication required", 401);
  }
  const { id, email, emailVerified } = session.user;
  return { id, email, emailVerified };
}

export const EMAIL_VERIFICATION_REQUIRED_MESSAGE =
  "Verify your email address before creating characters.";

/**
 * Authenticate the request and require a verified email address (issue #221).
 * The one server-side gate for character reservation: every character-creation
 * route and action calls it, so a forged request from an unverified session is
 * refused even though the UI never offers the action.
 */
export async function requireVerifiedUser(headers: Headers): Promise<CurrentUser> {
  const user = await requireCurrentUser(headers);
  if (!user.emailVerified) {
    throw new OwnershipError(EMAIL_VERIFICATION_REQUIRED_MESSAGE, 403);
  }
  return user;
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
