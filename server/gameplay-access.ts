import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { characters, playerAccounts, runespaceAccessState, type Character } from "@/db/rune-space";
import {
  decideGameplayAccess,
  GAMEPLAY_ACCESS_REQUIRED_CODE,
  type GameplayAccessDecision,
} from "@/game/domain/gameplay-access";
import { OwnershipError } from "@/server/ownership";

/**
 * The authoritative gameplay-access boundary (issue #223).
 *
 * `decideGameplayAccess` (`game/domain/gameplay-access.ts`) is the one rule;
 * this module is the one place that loads its inputs. Every load is a single
 * fresh query per request — the account row, `user.email_verified` read from
 * the database (never the session payload), and the global access singleton —
 * so revoking Early Access or closing public gameplay takes effect on the very
 * next authoritative request. Nothing here caches entitlement.
 *
 * Enforcement seams (the only two; see the inventory in docs/admin-console.md):
 * - `requireGameplayAccess` runs inside the shared owned-character lock
 *   boundaries (`server/action-resolution.ts`) BEFORE the character row is
 *   locked or reconciled, covering every player gameplay command and the
 *   initial/refresh Play state load.
 * - `requirePlayableOwnedCharacter` covers the unlocked gameplay reads: the Play
 *   page and the location-population / character-profile route handlers.
 *
 * A missing singleton row fails closed. The Operator Console's admin boundary
 * (`withResolvedCharacter`) never passes through here, so operator repair
 * works on gated characters while the admin allowlist grants no gameplay.
 */

export const GAMEPLAY_ACCESS_REQUIRED_MESSAGE = "Gameplay is not open for this account yet.";

/**
 * Refusal from the gameplay-access gate. It is an `OwnershipError` (403) so
 * every existing ownership handler refuses it safely even without the
 * recovery path; server actions and routes recognize it to send the browser
 * back to Characters.
 */
export class GameplayAccessError extends OwnershipError {
  readonly code = GAMEPLAY_ACCESS_REQUIRED_CODE;
  constructor(readonly reason: "email_unverified" | "gameplay_closed") {
    super(GAMEPLAY_ACCESS_REQUIRED_MESSAGE, 403);
    this.name = "GameplayAccessError";
  }
}

type Executor = Pick<typeof db, "select">;

export type AccountGameplayAccess = {
  playerAccountId: string;
  emailVerified: boolean;
  earlyAccessGrantedAt: Date | null;
  earlyAccessGrantedByAdminUserId: string | null;
  publicGameplayOpen: boolean;
  /** Presentation only; null only if the singleton row is missing. */
  launchTargetAt: Date | null;
  decision: GameplayAccessDecision;
};

/** Load one account's authoritative access inputs and decision in one query. */
export async function loadAccountGameplayAccess(
  executor: Executor,
  userId: string,
): Promise<AccountGameplayAccess> {
  const rows = await executor
    .select({
      playerAccountId: playerAccounts.id,
      emailVerified: user.emailVerified,
      earlyAccessGrantedAt: playerAccounts.earlyAccessGrantedAt,
      earlyAccessGrantedByAdminUserId: playerAccounts.earlyAccessGrantedByAdminUserId,
      publicGameplayOpen: runespaceAccessState.publicGameplayOpen,
      launchTargetAt: runespaceAccessState.softAlphaLaunchTargetAt,
    })
    .from(playerAccounts)
    .innerJoin(user, eq(user.id, playerAccounts.userId))
    .leftJoin(runespaceAccessState, eq(runespaceAccessState.id, 1))
    .where(eq(playerAccounts.userId, userId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new OwnershipError("Player account not found", 404);
  // Fail closed: only an explicit persisted `true` opens public gameplay.
  const publicGameplayOpen = row.publicGameplayOpen === true;
  return {
    playerAccountId: row.playerAccountId,
    emailVerified: row.emailVerified,
    earlyAccessGrantedAt: row.earlyAccessGrantedAt,
    earlyAccessGrantedByAdminUserId: row.earlyAccessGrantedByAdminUserId,
    publicGameplayOpen,
    launchTargetAt: row.launchTargetAt,
    decision: decideGameplayAccess({
      emailVerified: row.emailVerified,
      earlyAccessGranted: row.earlyAccessGrantedAt !== null,
      publicGameplayOpen,
    }),
  };
}

/**
 * Require gameplay access for a user and return their player account id.
 * Throws `GameplayAccessError` (403) when the account may not enter gameplay.
 */
export async function requireGameplayAccess(executor: Executor, userId: string): Promise<string> {
  const access = await loadAccountGameplayAccess(executor, userId);
  if (!access.decision.allowed) throw new GameplayAccessError(access.decision.reason);
  return access.playerAccountId;
}

/**
 * Gameplay-read guard: require gameplay access, then load a character and
 * verify it belongs to the authenticated user's account. A forged or foreign
 * character id yields the safe 404 without revealing another player's data.
 */
export async function requirePlayableOwnedCharacter(
  userId: string,
  characterId: string,
): Promise<Character> {
  const playerAccountId = await requireGameplayAccess(db, userId);
  const rows = await db.select().from(characters).where(eq(characters.id, characterId)).limit(1);
  const character = rows[0];
  if (!character || character.playerAccountId !== playerAccountId) {
    throw new OwnershipError("Character not found", 404);
  }
  return character;
}

export type RuneSpaceLaunchState = {
  publicGameplayOpen: boolean;
  /** Presentation only; null only if the singleton row is missing. */
  launchTargetAt: Date | null;
};

/** Public, unauthenticated read of the global launch state (landing page). */
export async function loadRuneSpaceLaunchState(
  executor: Executor = db,
): Promise<RuneSpaceLaunchState> {
  const rows = await executor
    .select({
      publicGameplayOpen: runespaceAccessState.publicGameplayOpen,
      launchTargetAt: runespaceAccessState.softAlphaLaunchTargetAt,
    })
    .from(runespaceAccessState)
    .where(eq(runespaceAccessState.id, 1))
    .limit(1);
  const row = rows[0];
  return {
    publicGameplayOpen: row?.publicGameplayOpen === true,
    launchTargetAt: row?.launchTargetAt ?? null,
  };
}
