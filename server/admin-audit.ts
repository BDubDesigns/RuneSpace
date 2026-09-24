import { and, desc, eq } from "drizzle-orm";
import { operatorAuditLogs, type NewOperatorAuditLog } from "@/db/rune-space";
import type { DatabaseTransaction } from "@/server/action-resolution";

/**
 * Operator audit history (Issue #113; target generalization Issue #223).
 *
 * The smallest relational append-only record of successful operator mutations.
 * Writes happen ONLY from `recordOperatorAudit`, called INSIDE the same
 * transaction that commits each operator mutation, so a success and its audit
 * row commit or roll back together. Refused/failed/no-op commands and normal
 * lazy gameplay reconciliation never write here.
 *
 * One successful mutation targets exactly one of:
 * - a `character` (the #113 console commands),
 * - a `player_account` (account-level Early Access), or
 * - the RuneSpace `system` (the global public-gameplay switch).
 *
 * This is explicitly not event-sourcing, a generic observability store, or the
 * economy provenance ledger: one row per successful operator action,
 * immutable, no replay.
 */

/** Stable operation kinds currently emitted by the admin console, by target kind. */
export const OPERATOR_OPERATION_TARGET_KINDS = {
  stop_current_action: "character",
  teleport_character: "character",
  removed_stack_quantity: "character",
  removed_unique_item: "character",
  force_unequipped_item: "character",
  added_stackable_item: "character",
  added_unique_item: "character",
  reset_mission_chain: "character",
  reset_all_missions: "character",
  set_skill_xp: "character",
  grant_early_access: "player_account",
  revoke_early_access: "player_account",
  open_public_gameplay: "system",
  close_public_gameplay: "system",
} as const;

export type OperatorOperation = keyof typeof OPERATOR_OPERATION_TARGET_KINDS;
export const OPERATOR_OPERATIONS = Object.keys(
  OPERATOR_OPERATION_TARGET_KINDS,
) as readonly OperatorOperation[];

export type OperatorAuditTarget =
  | { kind: "character"; characterId: string }
  | { kind: "player_account"; playerAccountId: string }
  | { kind: "system" };

export type OperatorAuditTargetKind = OperatorAuditTarget["kind"];

/** Concise structured before/after or operation description. Never secrets/tokens. */
export type OperatorAuditDetails = Record<string, unknown>;

/**
 * Pure mapping from an audit target to its database columns. Refuses an
 * operation recorded against the wrong target kind (the database CHECK
 * enforces the column shape; this keeps each operation on its one scope).
 */
export function operatorAuditTargetColumns(
  operation: OperatorOperation,
  target: OperatorAuditTarget,
): Pick<NewOperatorAuditLog, "targetKind" | "characterId" | "playerAccountId"> {
  const expected = OPERATOR_OPERATION_TARGET_KINDS[operation];
  if (target.kind !== expected) {
    throw new Error(`Operator operation ${operation} must target ${expected}, not ${target.kind}`);
  }
  switch (target.kind) {
    case "character":
      return { targetKind: "character", characterId: target.characterId, playerAccountId: null };
    case "player_account":
      return {
        targetKind: "player_account",
        characterId: null,
        playerAccountId: target.playerAccountId,
      };
    case "system":
      return { targetKind: "system", characterId: null, playerAccountId: null };
  }
}

/**
 * Write ONE immutable audit row atomically inside the caller's transaction.
 * `details` must be JSON-serializable and contain no secrets or session data.
 */
export async function recordOperatorAudit(
  transaction: DatabaseTransaction,
  input: {
    adminUserId: string;
    target: OperatorAuditTarget;
    operation: OperatorOperation;
    targetIdentity?: string;
    details: OperatorAuditDetails;
  },
): Promise<void> {
  const row: NewOperatorAuditLog = {
    adminUserId: input.adminUserId,
    ...operatorAuditTargetColumns(input.operation, input.target),
    operation: input.operation,
    targetIdentity: input.targetIdentity ?? null,
    details: input.details,
  };
  await transaction.insert(operatorAuditLogs).values(row);
}

function boundedLimit(limit: number): number {
  return Math.max(1, Math.min(limit, 200));
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
    .where(
      and(
        eq(operatorAuditLogs.targetKind, "character"),
        eq(operatorAuditLogs.characterId, characterId),
      ),
    )
    .orderBy(desc(operatorAuditLogs.createdAt), desc(operatorAuditLogs.id))
    .limit(boundedLimit(limit));
}

/** Compact append-only history for one player account, most recent first. */
export async function loadPlayerAccountAuditLog(
  transaction: DatabaseTransaction,
  playerAccountId: string,
  limit: number = 25,
): Promise<readonly (typeof operatorAuditLogs.$inferSelect)[]> {
  return transaction
    .select()
    .from(operatorAuditLogs)
    .where(
      and(
        eq(operatorAuditLogs.targetKind, "player_account"),
        eq(operatorAuditLogs.playerAccountId, playerAccountId),
      ),
    )
    .orderBy(desc(operatorAuditLogs.createdAt), desc(operatorAuditLogs.id))
    .limit(boundedLimit(limit));
}

/** Compact append-only history of RuneSpace system-state changes, most recent first. */
export async function loadSystemAuditLog(
  transaction: DatabaseTransaction,
  limit: number = 25,
): Promise<readonly (typeof operatorAuditLogs.$inferSelect)[]> {
  return transaction
    .select()
    .from(operatorAuditLogs)
    .where(eq(operatorAuditLogs.targetKind, "system"))
    .orderBy(desc(operatorAuditLogs.createdAt), desc(operatorAuditLogs.id))
    .limit(boundedLimit(limit));
}
