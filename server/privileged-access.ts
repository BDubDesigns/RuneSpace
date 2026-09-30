import { desc } from "drizzle-orm";
import { privilegedAccessLogs } from "@/db/rune-space";
import type { PrivilegedAccessKind } from "@/game/domain/moderation";
import type { DatabaseTransaction } from "@/server/action-resolution";

/**
 * Privileged access audit (issue #248).
 *
 * Every operator view of sensitive safety data — the moderation queue, a
 * case's reports and preserved evidence, retained public chat or Whispers, an
 * account's moderation history, and this log itself — calls
 * `recordPrivilegedAccess` inside the transaction that reads the data, BEFORE
 * the data is returned. If the audit row cannot be written the read fails, so
 * nothing sensitive is ever shown unaudited.
 *
 * The actor is always the server-derived admin identity from `requireAdmin`;
 * callers never pass a browser-supplied id. This module is the only writer,
 * and there is intentionally no update or delete path anywhere in the
 * application. Reads here are themselves privileged and audited by their
 * caller.
 */

export type PrivilegedAccessContext = Record<string, unknown>;

export async function recordPrivilegedAccess(
  transaction: Pick<DatabaseTransaction, "insert">,
  input: {
    adminUserId: string;
    kind: PrivilegedAccessKind;
    caseId?: string | null;
    targetPlayerAccountId?: string | null;
    targetCharacterId?: string | null;
    /** What exactly was viewed (filters, windows, ids) — never the data. */
    context: PrivilegedAccessContext;
  },
): Promise<void> {
  await transaction.insert(privilegedAccessLogs).values({
    adminUserId: input.adminUserId,
    accessKind: input.kind,
    caseId: input.caseId ?? null,
    targetPlayerAccountId: input.targetPlayerAccountId ?? null,
    targetCharacterId: input.targetCharacterId ?? null,
    context: input.context,
  });
}

/** The most recent privileged views, newest first. */
export async function loadPrivilegedAccessLog(
  transaction: Pick<DatabaseTransaction, "select">,
  limit: number,
): Promise<readonly (typeof privilegedAccessLogs.$inferSelect)[]> {
  return transaction
    .select()
    .from(privilegedAccessLogs)
    .orderBy(desc(privilegedAccessLogs.createdAt), desc(privilegedAccessLogs.id))
    .limit(Math.max(1, Math.min(limit, 500)));
}
