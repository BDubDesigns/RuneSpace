import { requireAdmin } from "@/server/admin-auth";
import {
  stopCurrentActionAsAdmin,
  teleportCharacterAsAdmin,
  removeCarriedStackQuantityAsAdmin,
  removeCargoStackQuantityAsAdmin,
  forceUnequipItemAsAdmin,
  deleteUniqueItemAsAdmin,
  addItemAsAdmin,
  resetMissionChainAsAdmin,
  resetAllMissionsAsAdmin,
  setSkillTotalXpAsAdmin,
  type AdminStopOutcome,
  type AdminStopResult,
  type AdminTeleportOutcome,
  type AdminTeleportResult,
  type AdminStackRemovalOutcome,
  type AdminStackRemovalResult,
  type AdminForceUnequipOutcome,
  type AdminForceUnequipResult,
  type AdminDeleteItemOutcome,
  type AdminDeleteItemResult,
  type AdminAddItemOutcome,
  type AdminAddItemResult,
  type AdminResetMissionOutcome,
  type AdminResetMissionResult,
  type AdminSetXpOutcome,
  type AdminSetXpResult,
  AdminCommandError,
} from "@/server/admin-command-seams";

/**
 * Admin operator commands (Issue #113) — PRODUCTION ENTRYPOINTS.
 *
 * Security stance: these are the ONLY admin command entrypoints available to
 * browser-facing server actions. Every one of them is safe-by-construction:
 * it calls `requireAdmin(headers)` and only then delegates to the matching
 * internal seam in `server/admin-command-seams.ts`, which performs the shared
 * character lock + lazy reconcile + force-interrupt + atomic-audit work.
 *
 * The raw `*AsAdmin` seams and `runAdminCharacterCommandAs` runner are NOT
 * re-exported here; they live in `server/admin-command-seams.ts` / the internal
 * runner so a server caller cannot reach a privileged, skip-authorization
 * command through this module's surface.
 *
 * Every command authenticates via `requireAdmin` and reuses the shared
 * character lock + lazy reconcile boundary, so due activity work is reconciled
 * exactly once exactly like a player command. Interruption (STOP /
 * teleport-over-Travel / Mining-tool-loadout invalidation) reuses the
 * authoritative Play-owned helpers; it never invents a parallel rule. A genuine
 * operator mutation writes one immutable audit row atomically inside the same
 * transaction; failed/refused/no-op commands write nothing (correction D6).
 */

/**
 * The single error class shared with the internal command seams, so a seam
 * rejection (`unknown mission`, `no progression curve`) surfaces as
 * `AdminCommandError` and is caught by `server/admin-actions.ts`'s boundary
 * instead of escaping as a 500.
 */
export { AdminCommandError };

export type {
  AdminStopOutcome,
  AdminStopResult,
  AdminTeleportOutcome,
  AdminTeleportResult,
  AdminStackRemovalOutcome,
  AdminStackRemovalResult,
  AdminForceUnequipOutcome,
  AdminForceUnequipResult,
  AdminDeleteItemOutcome,
  AdminDeleteItemResult,
  AdminAddItemOutcome,
  AdminAddItemResult,
  AdminResetMissionOutcome,
  AdminResetMissionResult,
  AdminSetXpOutcome,
  AdminSetXpResult,
};

export async function stopCurrentAction(
  headers: Headers,
  characterId: string,
  now: Date = new Date(),
): Promise<AdminStopResult> {
  const admin = await requireAdmin(headers);
  return stopCurrentActionAsAdmin(admin.id, characterId, now);
}

export async function teleportCharacter(
  headers: Headers,
  characterId: string,
  destinationLocationId: string,
  now: Date = new Date(),
): Promise<AdminTeleportResult> {
  const admin = await requireAdmin(headers);
  return teleportCharacterAsAdmin(admin.id, characterId, destinationLocationId, now);
}

export async function removeCarriedStackQuantity(
  headers: Headers,
  characterId: string,
  stackId: string,
  mode: "one" | "stack",
  expectedQuantity: number,
  now: Date = new Date(),
): Promise<AdminStackRemovalResult> {
  const admin = await requireAdmin(headers);
  return removeCarriedStackQuantityAsAdmin(
    admin.id,
    characterId,
    stackId,
    mode,
    expectedQuantity,
    now,
  );
}

export async function removeCargoStackQuantity(
  headers: Headers,
  characterId: string,
  stackId: string,
  mode: "one" | "stack",
  expectedQuantity: number,
  now: Date = new Date(),
): Promise<AdminStackRemovalResult> {
  const admin = await requireAdmin(headers);
  return removeCargoStackQuantityAsAdmin(
    admin.id,
    characterId,
    stackId,
    mode,
    expectedQuantity,
    now,
  );
}

export async function forceUnequipItem(
  headers: Headers,
  characterId: string,
  itemInstanceId: string,
  now: Date = new Date(),
): Promise<AdminForceUnequipResult> {
  const admin = await requireAdmin(headers);
  return forceUnequipItemAsAdmin(admin.id, characterId, itemInstanceId, now);
}

export async function deleteUniqueItem(
  headers: Headers,
  characterId: string,
  itemInstanceId: string,
  now: Date = new Date(),
): Promise<AdminDeleteItemResult> {
  const admin = await requireAdmin(headers);
  return deleteUniqueItemAsAdmin(admin.id, characterId, itemInstanceId, now);
}

export async function addItem(
  headers: Headers,
  characterId: string,
  itemId: string,
  quantity: number | undefined,
  now: Date = new Date(),
): Promise<AdminAddItemResult> {
  const admin = await requireAdmin(headers);
  return addItemAsAdmin(admin.id, characterId, itemId, quantity, now);
}

export async function resetMissionChain(
  headers: Headers,
  characterId: string,
  missionId: string,
  now: Date = new Date(),
): Promise<AdminResetMissionResult> {
  const admin = await requireAdmin(headers);
  return resetMissionChainAsAdmin(admin.id, characterId, missionId, now);
}

export async function resetAllMissions(
  headers: Headers,
  characterId: string,
  now: Date = new Date(),
): Promise<AdminResetMissionResult> {
  const admin = await requireAdmin(headers);
  return resetAllMissionsAsAdmin(admin.id, characterId, now);
}

export async function setSkillTotalXp(
  headers: Headers,
  characterId: string,
  skillId: string,
  totalXp: number,
  now: Date = new Date(),
): Promise<AdminSetXpResult> {
  const admin = await requireAdmin(headers);
  return setSkillTotalXpAsAdmin(admin.id, characterId, skillId, totalXp, now);
}
