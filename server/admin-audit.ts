import { desc, eq } from "drizzle-orm";
import { operatorAuditLogs, type NewOperatorAuditLog } from "@/db/rune-space";
import type { DatabaseTransaction } from "@/server/action-resolution";

/**
 * Operator audit history (Issue #113).
 *
 * The smallest relational append-only record of successful operator mutations.
 * Writes happen ONLY from `recordOperatorAudit`, called INSIDE the same
 * transaction that commits each operator mutation, so a success and its audit
 * row commit or roll back together. Refused/failed/no-op commands and normal
 * lazy gameplay reconciliation never write here.
 *
 * This is explicitly not event-sourcing or a generic observability store: one
 * row per successful operator action, immutable, no replay.
 */

/** Stable operation kinds currently emitted by the admin console. */
export const OPERATOR_OPERATIONS = [
  "stop_current_action",
  "teleport_character",
  "removed_stack_quantity",
  "removed_unique_item",
  "force_unequipped_item",
  "added_stackable_item",
  "added_unique_item",
  "reset_mission_chain",
  "reset_all_missions",
  "set_skill_xp",
] as const;

export type OperatorOperation = (typeof OPERATOR_OPERATIONS)[number];

/** Concise structured before/after or operation description. Never secrets/tokens. */
export type OperatorAuditDetails = Record<string, unknown>;

/**
 * Write ONE immutable audit row atomically inside the caller's transaction.
 * `details` must be JSON-serializable and contain no secrets or session data.
 */
export async function recordOperatorAudit(
  transaction: DatabaseTransaction,
  input: {
    adminUserId: string;
    characterId: string;
    operation: OperatorOperation;
    targetIdentity?: string;
    details: OperatorAuditDetails;
  },
): Promise<void> {
  const row: NewOperatorAuditLog = {
    adminUserId: input.adminUserId,
    characterId: input.characterId,
    operation: input.operation,
    targetIdentity: input.targetIdentity ?? null,
    details: input.details,
  };
  await transaction.insert(operatorAuditLogs).values(row);
}

/** Compact append-only history for one character, most recent first. */
export async function loadCharacterAuditLog(
  transaction: DatabaseTransaction,
  characterId: string,
  limit: number = 25,
): Promise<readonly (typeof operatorAuditLogs.$inferSelect)[]> {
  return transaction
    .select()
    .from(operatorAuditLogs)
    .where(eq(operatorAuditLogs.characterId, characterId))
    .orderBy(desc(operatorAuditLogs.createdAt), desc(operatorAuditLogs.id))
    .limit(Math.max(1, Math.min(limit, 200)));
}
