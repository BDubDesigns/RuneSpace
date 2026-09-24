import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { operatorAuditLogs, playerAccounts, runespaceAccessState } from "@/db/rune-space";
import type { DatabaseTransaction } from "@/server/action-resolution";
import { AdminError, requireAdmin } from "@/server/admin-auth";
import { loadPlayerAccountAuditLog, loadSystemAuditLog } from "@/server/admin-audit";

/**
 * Operator Console reads of account and global access state (issue #223).
 *
 * The loaders take the caller's transaction and perform no authorization;
 * the internal command seams reuse them to return refreshed views, and the
 * inspector calls `loadAccountAccessView` after `requireAdmin`. The only
 * production entrypoint here, `loadPublicGameplayControlState`, calls
 * `requireAdmin` itself. Reading never mutates access state.
 */

type AdminAuditRow = typeof operatorAuditLogs.$inferSelect;

/** The selected character's owning account, as the inspector's Account access panel shows it. */
export type AdminAccountAccessView = {
  playerAccountId: string;
  emailVerified: boolean;
  publicGameplayOpen: boolean;
  earlyAccess: { grantedAt: Date; grantedByAdminUserId: string } | null;
  audit: readonly AdminAuditRow[];
};

/** The Operator Console home's global PUBLIC GAMEPLAY panel. */
export type AdminPublicGameplayView = {
  publicGameplayOpen: boolean;
  /** Fixed presentation target; never written by any command. */
  launchTargetAt: Date;
  updatedAt: Date;
  /** Null only for the migration-seeded row. */
  updatedByAdminUserId: string | null;
  /** Server reference time for the shared countdown presentation. */
  serverNow: Date;
  audit: readonly AdminAuditRow[];
};

export type AdminAccessCommandResult<View> = { changed: boolean; view: View };

export async function loadAccountAccessView(
  executor: DatabaseTransaction,
  playerAccountId: string,
): Promise<AdminAccountAccessView> {
  const rows = await executor
    .select({
      playerAccountId: playerAccounts.id,
      emailVerified: user.emailVerified,
      earlyAccessGrantedAt: playerAccounts.earlyAccessGrantedAt,
      earlyAccessGrantedByAdminUserId: playerAccounts.earlyAccessGrantedByAdminUserId,
      publicGameplayOpen: runespaceAccessState.publicGameplayOpen,
    })
    .from(playerAccounts)
    .innerJoin(user, eq(user.id, playerAccounts.userId))
    .leftJoin(runespaceAccessState, eq(runespaceAccessState.id, 1))
    .where(eq(playerAccounts.id, playerAccountId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AdminError("Player account not found", 404);
  return {
    playerAccountId: row.playerAccountId,
    emailVerified: row.emailVerified,
    publicGameplayOpen: row.publicGameplayOpen === true,
    earlyAccess:
      row.earlyAccessGrantedAt && row.earlyAccessGrantedByAdminUserId
        ? {
            grantedAt: row.earlyAccessGrantedAt,
            grantedByAdminUserId: row.earlyAccessGrantedByAdminUserId,
          }
        : null,
    audit: await loadPlayerAccountAuditLog(executor, playerAccountId),
  };
}

export async function loadPublicGameplayView(
  executor: DatabaseTransaction,
  now: Date,
): Promise<AdminPublicGameplayView> {
  const rows = await executor
    .select()
    .from(runespaceAccessState)
    .where(eq(runespaceAccessState.id, 1))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AdminError("RuneSpace access state is missing", 500);
  return {
    publicGameplayOpen: row.publicGameplayOpen,
    launchTargetAt: row.softAlphaLaunchTargetAt,
    updatedAt: row.updatedAt,
    updatedByAdminUserId: row.updatedByAdminUserId,
    serverNow: now,
    audit: await loadSystemAuditLog(executor, 10),
  };
}

/** Operator Console home: the global PUBLIC GAMEPLAY panel state (admin-only). */
export async function loadPublicGameplayControlState(
  headers: Headers,
  now: Date = new Date(),
): Promise<AdminPublicGameplayView> {
  await requireAdmin(headers);
  return db.transaction((transaction) => loadPublicGameplayView(transaction, now));
}
