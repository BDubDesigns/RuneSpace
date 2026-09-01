import { withResolvedCharacter } from "@/server/action-resolution";
import type { ActionResolver, DatabaseTransaction } from "@/server/action-resolution";
import { requireAdmin } from "@/server/admin-auth";
import type { ActiveAction, Character } from "@/db/rune-space";

/**
 * Admin-authorized character command runner (Issue #113).
 *
 * Admin commands reuse the EXACT shared character lock + lazy reconcile
 * implementation used by player commands (`withResolvedOwnedCharacter`) via the
 * shared `withResolvedCharacter` boundary in `server/action-resolution.ts`. The
 * only differences from the player path are:
 * - authorization is `requireAdmin` instead of character-ownership;
 * - the resolved admin user is captured for the atomic operator audit entry.
 *
 * The caller supplies a `command` body that operates on the already-reconciled
 * post-action (`context.action`), performs force-idle/interruption cleanup when
 * required, applies the operator mutation, writes its audit row, and returns the
 * refreshed authoritative state. Reconcile happens EXACTLY ONCE — force-idle
 * helpers must never re-reconcile.
 */

/**
 * Internal seam shared by the headers-authorized wrapper and integration tests:
 * run a command through the shared lock + reconcile boundary with an already
 * established (test-resolved or headers-resolved) admin user id. This is NOT a
 * server action and is not reachable from the browser; it exists so the command
 * semantics (reconcile/interrupt/audit) can be exercised against a real
 * PostgreSQL database without a live HTTP session.
 */
export async function runAdminCharacterCommandAs<Snapshot, Outcome, Result>(
  adminUserId: string,
  characterId: string,
  resolver: ActionResolver<Snapshot, Outcome>,
  command: (
    transaction: DatabaseTransaction,
    context: { character: Character; action: ActiveAction | undefined; adminUserId: string },
  ) => Promise<Result>,
  now: Date = new Date(),
): Promise<Result> {
  return withResolvedCharacter(
    characterId,
    resolver,
    (transaction, context) => command(transaction, { ...context, adminUserId }),
    now,
  );
}

export async function runAdminCharacterCommand<Snapshot, Outcome, Result>(
  headers: Headers,
  characterId: string,
  resolver: ActionResolver<Snapshot, Outcome>,
  command: (
    transaction: DatabaseTransaction,
    context: { character: Character; action: ActiveAction | undefined; adminUserId: string },
  ) => Promise<Result>,
  now: Date = new Date(),
): Promise<Result> {
  const admin = await requireAdmin(headers);
  return runAdminCharacterCommandAs(admin.id, characterId, resolver, command, now);
}
