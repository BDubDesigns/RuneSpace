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
 *
 * SECURITY: This module exports only the headers-authorized entrypoint
 * `runAdminCharacterCommand`, which is safe-by-construction through
 * `requireAdmin`. The raw, admin-user-id-passing runner that skips header
 * authorization lives in `server/admin-command-seams.ts` (an INTERNAL module,
 * not a production surface) so a server caller cannot reach it through this
 * module.
 */
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
  return withResolvedCharacter(
    characterId,
    resolver,
    (transaction, context) => command(transaction, { ...context, adminUserId: admin.id }),
    now,
  );
}
