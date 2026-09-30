import { and, eq, inArray } from "drizzle-orm";
import { moderationCases } from "@/db/rune-space";
import { ACTIVE_CASE_STATUSES } from "@/game/domain/moderation";
import type { DatabaseTransaction } from "@/server/action-resolution";

/**
 * How reports become reviewable (issue #248). Each report joins the reported
 * account's one open-or-reviewed moderation case, or opens a new one when that
 * account has none — so an operator reviews one account's recent reports
 * together, and a report after a case closes starts a fresh case rather than
 * reopening a decided one. Joining a case never changes its status; it only
 * marks the case as having new activity.
 */

type Transaction = Pick<DatabaseTransaction, "select" | "insert" | "update">;

async function activeCaseId(tx: Transaction, subjectPlayerAccountId: string) {
  const [row] = await tx
    .select({ id: moderationCases.id })
    .from(moderationCases)
    .where(
      and(
        eq(moderationCases.subjectPlayerAccountId, subjectPlayerAccountId),
        inArray(moderationCases.status, [...ACTIVE_CASE_STATUSES]),
      ),
    )
    .limit(1)
    .for("update");
  return row?.id ?? null;
}

/**
 * The case a new report against `subjectPlayerAccountId` belongs to, inside
 * the report's transaction. Concurrent first reports race safely: the partial
 * unique index admits one active case, the loser's insert does nothing, and
 * its re-read finds the winner's case.
 */
export async function caseForNewReport(
  tx: Transaction,
  subjectPlayerAccountId: string,
  now: Date,
): Promise<{ caseId: string; created: boolean }> {
  const existing = await activeCaseId(tx, subjectPlayerAccountId);
  if (existing) {
    await tx
      .update(moderationCases)
      .set({ updatedAt: now })
      .where(eq(moderationCases.id, existing));
    return { caseId: existing, created: false };
  }
  const inserted = await tx
    .insert(moderationCases)
    .values({
      subjectPlayerAccountId,
      status: "open",
      openedBy: "report",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: moderationCases.id });
  if (inserted[0]) return { caseId: inserted[0].id, created: true };
  const raced = await activeCaseId(tx, subjectPlayerAccountId);
  if (!raced) throw new Error("A moderation case could not be opened for this report");
  return { caseId: raced, created: false };
}
