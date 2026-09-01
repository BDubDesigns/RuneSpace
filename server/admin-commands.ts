import { and, eq, inArray } from "drizzle-orm";
import {
  cargoHoldItemInstances,
  cargoHoldStacks,
  characterMissions,
  characterSkillXp,
  characters,
  equippedItems,
  inventoryStacks,
  itemInstances,
} from "@/db/rune-space";
import {
  getEffectiveGameBalance,
  getItemDefinition,
  getItemMaximumCharge,
  skillLevelThresholds,
} from "@/game/config/balance";
import { LOCATION_IDS } from "@/game/config/foundations";
import { getLocation } from "@/game/content/locations";
import { MISSIONS } from "@/game/content/missions";
import { missionChainResetScope } from "@/game/domain/missions";
import {
  planExactStackAddition,
  planExactStackRemoval,
  planUniqueItemAddition,
  type StackState,
} from "@/game/domain/inventory";
import { planEquipmentChange } from "@/game/domain/equipment";
import { levelFromXp } from "@/game/domain/progression";
import { runAdminCharacterCommandAs } from "@/server/admin-character";
import { requireAdmin } from "@/server/admin-auth";
import { recordOperatorAudit } from "@/server/admin-audit";
import { forceIdleResolvedAction } from "@/server/play-interrupt";
import {
  createPlayResolver,
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";
import {
  addStackableItem,
  loadOwnedItemInstances,
  removeFromSelectedStack,
} from "@/server/carried-inventory";
import type { DatabaseTransaction } from "@/server/action-resolution";

/**
 * Admin operator commands (Issue #113).
 *
 * Every command authenticates via `requireAdmin` and then reuses the shared
 * character lock + lazy reconcile boundary (`runAdminCharacterCommand` ->
 * `withResolvedCharacter`), so due activity work is reconciled exactly once
 * exactly like a player command. Interruption (STOP / teleport-over-Travel)
 * uses the Play-owned `forceIdleResolvedAction` and only cleans the remaining
 * POST-reconciliation action — it never re-resolves.
 *
 * A genuine operator mutation writes one immutable audit row atomically inside
 * the same transaction; failed/refused/no-op commands write nothing (correction
 * D6). Normal lazy reconciliation is never audited.
 */

export class AdminCommandError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "AdminCommandError";
  }
}

/**
 * Reload the character row inside the command transaction so the authoritative
 * `currentLocationId` reflects any Travel arrival that the reconcile step just
 * committed (mirrors beginTravel's post-reconcile reload).
 */
async function reloadCharacterLocation(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<string> {
  const rows = await transaction
    .select({ currentLocationId: characters.currentLocationId })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  return rows[0]?.currentLocationId ?? LOCATION_IDS.crashSite;
}

async function refreshedState(
  transaction: DatabaseTransaction,
  characterId: string,
  now: Date,
): Promise<PlayGameplayState> {
  return stateFromTransaction(
    transaction,
    characterId,
    { successes: 0, failures: 0, awardedXp: 0 },
    undefined,
    undefined,
    undefined,
    undefined,
    now,
  );
}

// ---------------------------------------------------------------------------
// STOP CURRENT ACTION
// ---------------------------------------------------------------------------

export type AdminStopOutcome = { kind: "interrupted"; actionId: string } | { kind: "already_idle" };

export type AdminStopResult = { state: PlayGameplayState; outcome: AdminStopOutcome };

export async function stopCurrentActionForAdmin(
  adminUserId: string,
  characterId: string,
  now: Date = new Date(),
): Promise<AdminStopResult> {
  return runAdminCharacterCommandAs(
    adminUserId,
    characterId,
    createPlayResolver(),
    async (transaction, { character, action, adminUserId: admin }) => {
      await ensurePlayProvisioning(transaction, character.id);
      const result = await forceIdleResolvedAction(transaction, { character, action, now });
      const state = await refreshedState(transaction, character.id, now);
      if (!result.interrupted) return { state, outcome: { kind: "already_idle" } };
      await recordOperatorAudit(transaction, {
        adminUserId: admin,
        characterId: character.id,
        operation: "stop_current_action",
        targetIdentity: result.interruptedActionId,
        details: { actionId: result.interruptedActionId },
      });
      return { state, outcome: { kind: "interrupted", actionId: result.interruptedActionId! } };
    },
    now,
  );
}

export async function stopCurrentAction(
  headers: Headers,
  characterId: string,
  now: Date = new Date(),
): Promise<AdminStopResult> {
  const admin = await requireAdmin(headers);
  return stopCurrentActionForAdmin(admin.id, characterId, now);
}

// ---------------------------------------------------------------------------
// TELEPORT / SET LOCATION
// ---------------------------------------------------------------------------

export type AdminTeleportOutcome =
  | {
      kind: "teleported";
      fromLocationId: string;
      toLocationId: string;
      interruptedActionId?: string;
    }
  | { kind: "no_change"; fromLocationId: string };

export type AdminTeleportResult = { state: PlayGameplayState; outcome: AdminTeleportOutcome };

export async function teleportCharacterForAdmin(
  adminUserId: string,
  characterId: string,
  destinationLocationId: string,
  now: Date = new Date(),
): Promise<AdminTeleportResult> {
  // Early canonical-location validation BEFORE any operator-specific
  // interruption: an invalid destination must not force-idle or relocate the
  // character or write audit. Re-validated server-side under the transaction.
  if (!getLocation(destinationLocationId)) {
    throw new AdminCommandError("Unknown destination location", 400);
  }
  return runAdminCharacterCommandAs(
    adminUserId,
    characterId,
    createPlayResolver(),
    async (transaction, { character, action, adminUserId: admin }) => {
      if (!getLocation(destinationLocationId)) {
        throw new AdminCommandError("Unknown destination location", 400);
      }
      await ensurePlayProvisioning(transaction, character.id);
      const fromLocationId = await reloadCharacterLocation(transaction, character.id);
      const interruption = await forceIdleResolvedAction(transaction, {
        character,
        action,
        now,
      });
      if (fromLocationId === destinationLocationId && !interruption.interrupted) {
        const state = await refreshedState(transaction, character.id, now);
        return { state, outcome: { kind: "no_change", fromLocationId } };
      }
      await transaction
        .update(characters)
        .set({ currentLocationId: destinationLocationId })
        .where(eq(characters.id, character.id));
      await recordOperatorAudit(transaction, {
        adminUserId: admin,
        characterId: character.id,
        operation: "teleport_character",
        targetIdentity: destinationLocationId,
        details: {
          fromLocationId,
          toLocationId: destinationLocationId,
          interruptedActionId: interruption.interruptedActionId ?? null,
        },
      });
      const state = await refreshedState(transaction, character.id, now);
      return {
        state,
        outcome: {
          kind: "teleported",
          fromLocationId,
          toLocationId: destinationLocationId,
          interruptedActionId: interruption.interruptedActionId,
        },
      };
    },
    now,
  );
}

export async function teleportCharacter(
  headers: Headers,
  characterId: string,
  destinationLocationId: string,
  now: Date = new Date(),
): Promise<AdminTeleportResult> {
  const admin = await requireAdmin(headers);
  return teleportCharacterForAdmin(admin.id, characterId, destinationLocationId, now);
}

// ---------------------------------------------------------------------------
// Carried / Cargo exact stack removal
// ---------------------------------------------------------------------------

export type AdminStackRemovalOutcome =
  | { kind: "removed"; source: "carried" | "cargo"; removedQuantity: number }
  | { kind: "stale"; message: string };

export type AdminStackRemovalResult = {
  state: PlayGameplayState;
  outcome: AdminStackRemovalOutcome;
};

/**
 * Exact carried-stack removal. Reuses the same selected-stack adapter as the
 * player discard path (`removeFromSelectedStack`), which locks by character +
 * stack identity and refuses a stale expected quantity without substituting
 * another stack.
 */
export async function removeCarriedStackQuantityForAdmin(
  adminUserId: string,
  characterId: string,
  stackId: string,
  mode: "one" | "stack",
  expectedQuantity: number,
  now: Date = new Date(),
): Promise<AdminStackRemovalResult> {
  return runAdminCharacterCommandAs(
    adminUserId,
    characterId,
    createPlayResolver(),
    async (transaction, { character, action, adminUserId: admin }) => {
      await ensurePlayProvisioning(transaction, character.id);
      const removal = await removeFromSelectedStack(transaction, {
        characterId: character.id,
        stackId,
        expectedQuantity,
        quantity: mode === "stack" ? expectedQuantity : 1,
        now,
      });
      const state = await refreshedState(transaction, character.id, now);
      if (!removal.ok)
        return { state, outcome: { kind: "stale", message: "Stack unavailable or changed" } };
      const removedQuantity = mode === "stack" ? expectedQuantity : 1;
      await recordOperatorAudit(transaction, {
        adminUserId: admin,
        characterId: character.id,
        operation: "removed_stack_quantity",
        targetIdentity: stackId,
        details: { source: "carried", mode, removedQuantity },
      });
      return { state, outcome: { kind: "removed", source: "carried", removedQuantity } };
    },
    now,
  );
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
  return removeCarriedStackQuantityForAdmin(
    admin.id,
    characterId,
    stackId,
    mode,
    expectedQuantity,
    now,
  );
}

/**
 * Exact Cargo-stack removal. Scoped to the Cargo-owned rows by identity and
 * verified expected quantity, so it never substitutes another stack.
 */
export async function removeCargoStackQuantityForAdmin(
  adminUserId: string,
  characterId: string,
  stackId: string,
  mode: "one" | "stack",
  expectedQuantity: number,
  now: Date = new Date(),
): Promise<AdminStackRemovalResult> {
  return runAdminCharacterCommandAs(
    adminUserId,
    characterId,
    createPlayResolver(),
    async (transaction, { character, action, adminUserId: admin }) => {
      await ensurePlayProvisioning(transaction, character.id);
      const rows = await transaction
        .select()
        .from(cargoHoldStacks)
        .where(aInventoryCargoStack(character.id, stackId))
        .for("update");
      const stack = rows[0];
      const state = await refreshedState(transaction, character.id, now);
      if (!stack || stack.quantity !== expectedQuantity)
        return { state, outcome: { kind: "stale", message: "Stack unavailable or changed" } };
      const quantity = mode === "stack" ? stack.quantity : 1;
      const plan = planExactStackRemoval([stack], stack.itemId, quantity);
      if (!plan.ok)
        return { state, outcome: { kind: "stale", message: "Stack unavailable or changed" } };
      await Promise.all(
        plan.deletedStackIds.map((id) =>
          transaction.delete(cargoHoldStacks).where(aInventoryCargoStack(character.id, id)),
        ),
      );
      await Promise.all(
        plan.updatedStacks.map((update) =>
          transaction
            .update(cargoHoldStacks)
            .set({ quantity: update.quantity, updatedAt: now })
            .where(aInventoryCargoStack(character.id, update.id)),
        ),
      );
      await recordOperatorAudit(transaction, {
        adminUserId: admin,
        characterId: character.id,
        operation: "removed_stack_quantity",
        targetIdentity: stackId,
        details: { source: "cargo", mode, removedQuantity: quantity },
      });
      return { state, outcome: { kind: "removed", source: "cargo", removedQuantity: quantity } };
    },
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
  return removeCargoStackQuantityForAdmin(
    admin.id,
    characterId,
    stackId,
    mode,
    expectedQuantity,
    now,
  );
}

/** Scopes every Cargo stack mutation to one character + exact stack id. */
function aInventoryCargoStack(characterId: string, stackId: string) {
  return and(eq(cargoHoldStacks.characterId, characterId), eq(cargoHoldStacks.id, stackId));
}

// ---------------------------------------------------------------------------
// Force Unequip
// ---------------------------------------------------------------------------

export type AdminForceUnequipOutcome =
  | {
      kind: "unequipped";
      itemInstanceId: string;
      slot: { assignmentKind: string; suitSlotId: string };
    }
  | { kind: "refused"; message: string };

export type AdminForceUnequipResult = {
  state: PlayGameplayState;
  outcome: AdminForceUnequipOutcome;
};

export async function forceUnequipItemForAdmin(
  adminUserId: string,
  characterId: string,
  itemInstanceId: string,
  now: Date = new Date(),
): Promise<AdminForceUnequipResult> {
  return runAdminCharacterCommandAs(
    adminUserId,
    characterId,
    createPlayResolver(),
    async (transaction, { character, action, adminUserId: admin }) => {
      await ensurePlayProvisioning(transaction, character.id);
      const [assignments, itemState, stacks] = await Promise.all([
        transaction
          .select()
          .from(equippedItems)
          .where(eq(equippedItems.characterId, character.id))
          .for("update"),
        loadOwnedItemInstances(transaction, character.id),
        transaction
          .select()
          .from(inventoryStacks)
          .where(eq(inventoryStacks.characterId, character.id))
          .for("update"),
      ]);
      const assignment = assignments.find((a) => a.itemInstanceId === itemInstanceId);
      const instance = itemState.allInstances.find((i) => i.id === itemInstanceId);
      const state = await refreshedState(transaction, character.id, now);
      if (!assignment || !instance)
        return { state, outcome: { kind: "refused", message: "Item is not equipped." } };
      const balance = getEffectiveGameBalance();
      try {
        planEquipmentChange({
          assignments,
          instances: itemState.carriedInstances,
          stacks,
          balance,
          change: {
            kind: "unequip",
            target: {
              assignmentKind: assignment.assignmentKind as "gear" | "container",
              suitSlotId: assignment.suitSlotId,
            },
          },
        });
      } catch {
        return {
          state,
          outcome: {
            kind: "refused",
            message: "Unequipping would violate capacity or leave no container.",
          },
        };
      }
      await transaction
        .delete(equippedItems)
        .where(
          and(
            eq(equippedItems.characterId, character.id),
            eq(equippedItems.itemInstanceId, itemInstanceId),
          ),
        );
      await recordOperatorAudit(transaction, {
        adminUserId: admin,
        characterId: character.id,
        operation: "force_unequipped_item",
        targetIdentity: itemInstanceId,
        details: {
          assignmentKind: assignment.assignmentKind,
          suitSlotId: assignment.suitSlotId,
        },
      });
      return {
        state,
        outcome: {
          kind: "unequipped",
          itemInstanceId,
          slot: { assignmentKind: assignment.assignmentKind, suitSlotId: assignment.suitSlotId },
        },
      };
    },
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
  return forceUnequipItemForAdmin(admin.id, characterId, itemInstanceId, now);
}

// ---------------------------------------------------------------------------
// Exact unique-item deletion (carried or Cargo)
// ---------------------------------------------------------------------------

export type AdminDeleteItemOutcome =
  | {
      kind: "deleted";
      itemInstanceId: string;
      source: "carried" | "cargo";
      itemId: string;
    }
  | { kind: "refused"; message: string };

export type AdminDeleteItemResult = { state: PlayGameplayState; outcome: AdminDeleteItemOutcome };

export async function deleteUniqueItemForAdmin(
  adminUserId: string,
  characterId: string,
  itemInstanceId: string,
  now: Date = new Date(),
): Promise<AdminDeleteItemResult> {
  return runAdminCharacterCommandAs(
    adminUserId,
    characterId,
    createPlayResolver(),
    async (transaction, { character, action, adminUserId: admin }) => {
      await ensurePlayProvisioning(transaction, character.id);
      const [instanceRows, cargoRows, assignments] = await Promise.all([
        transaction
          .select()
          .from(itemInstances)
          .where(
            and(eq(itemInstances.characterId, character.id), eq(itemInstances.id, itemInstanceId)),
          )
          .for("update"),
        transaction
          .select()
          .from(cargoHoldItemInstances)
          .where(
            and(
              eq(cargoHoldItemInstances.characterId, character.id),
              eq(cargoHoldItemInstances.itemInstanceId, itemInstanceId),
            ),
          )
          .for("update"),
        transaction
          .select()
          .from(equippedItems)
          .where(eq(equippedItems.characterId, character.id))
          .for("update"),
      ]);
      const instance = instanceRows[0];
      const cargo = cargoRows[0];
      const state = await refreshedState(transaction, character.id, now);
      if (!instance)
        return { state, outcome: { kind: "refused", message: "Item instance not found." } };
      const equipped = assignments.some((a) => a.itemInstanceId === itemInstanceId);
      if (equipped)
        return {
          state,
          outcome: {
            kind: "refused",
            message: "Item is equipped. Force Unequip it before deleting the unique item.",
          },
        };
      if (cargo) {
        await transaction
          .delete(cargoHoldItemInstances)
          .where(
            and(
              eq(cargoHoldItemInstances.characterId, character.id),
              eq(cargoHoldItemInstances.itemInstanceId, itemInstanceId),
            ),
          );
      }
      await transaction
        .delete(itemInstances)
        .where(
          and(eq(itemInstances.id, itemInstanceId), eq(itemInstances.characterId, character.id)),
        );
      await recordOperatorAudit(transaction, {
        adminUserId: admin,
        characterId: character.id,
        operation: "removed_unique_item",
        targetIdentity: itemInstanceId,
        details: { source: cargo ? "cargo" : "carried", itemId: instance.itemId },
      });
      return {
        state,
        outcome: {
          kind: "deleted",
          itemInstanceId,
          source: cargo ? "cargo" : "carried",
          itemId: instance.itemId,
        },
      };
    },
    now,
  );
}

export async function deleteUniqueItem(
  headers: Headers,
  characterId: string,
  itemInstanceId: string,
  now: Date = new Date(),
): Promise<AdminDeleteItemResult> {
  const admin = await requireAdmin(headers);
  return deleteUniqueItemForAdmin(admin.id, characterId, itemInstanceId, now);
}

// ---------------------------------------------------------------------------
// Canonical ADD ITEM (carried only in v1)
// ---------------------------------------------------------------------------

export type AdminAddItemOutcome =
  | { kind: "added"; itemId: string; quantity: number }
  | { kind: "refused"; message: string };

export type AdminAddItemResult = { state: PlayGameplayState; outcome: AdminAddItemOutcome };

export async function addItemForAdmin(
  adminUserId: string,
  characterId: string,
  itemId: string,
  quantity: number | undefined,
  now: Date = new Date(),
): Promise<AdminAddItemResult> {
  return runAdminCharacterCommandAs(
    adminUserId,
    characterId,
    createPlayResolver(),
    async (transaction, { character, action, adminUserId: admin }) => {
      await ensurePlayProvisioning(transaction, character.id);
      const balance = getEffectiveGameBalance();
      const definition = getItemDefinition(itemId, balance);
      const state = await refreshedState(transaction, character.id, now);
      if (!definition) return { state, outcome: { kind: "refused", message: "Unknown item." } };

      if (definition.kind === "stack") {
        const amount = quantity ?? 1;
        const planResult = planExactStackAddition(
          state.inventory.stacks as readonly StackState<string>[],
          definition.itemId,
          amount,
          definition.stackLimit,
          state.inventory.slotsAvailable,
          state.inventory.capacityGrams - state.inventory.massGrams,
          definition.massGrams,
        );
        if (!planResult.ok) {
          return {
            state,
            outcome: {
              kind: "refused",
              message:
                planResult.reason === "slots"
                  ? "No free carried slot."
                  : "Adding that quantity would exceed carried mass capacity.",
            },
          };
        }
        await addStackableItem(transaction, {
          characterId: character.id,
          plan: planResult.plan,
          now,
        });
        await recordOperatorAudit(transaction, {
          adminUserId: admin,
          characterId: character.id,
          operation: "added_stackable_item",
          targetIdentity: itemId,
          details: { quantity: amount },
        });
        const refreshed = await refreshedState(transaction, character.id, now);
        return { state: refreshed, outcome: { kind: "added", itemId, quantity: amount } };
      }

      // Unique item: capacity-preflight from the authoritative carried snapshot.
      const slotCapacity = state.inventory.slotsUsed + state.inventory.slotsAvailable;
      const addPlan = planUniqueItemAddition({
        inventorySlotsUsed: state.inventory.slotsUsed,
        slotCapacity,
        carriedMassGrams: state.inventory.massGrams,
        maximumCarryCapacityGrams: state.inventory.capacityGrams,
        itemMassGrams: definition.massGrams,
      });
      if (!addPlan.ok) {
        return {
          state,
          outcome: {
            kind: "refused",
            message:
              addPlan.reason === "slots"
                ? "No free carried slot."
                : "Would exceed carried mass capacity.",
          },
        };
      }
      const [inserted] = await transaction
        .insert(itemInstances)
        .values({
          characterId: character.id,
          itemId,
          currentCharge: getItemMaximumCharge(itemId) !== undefined ? 0 : null,
        })
        .returning();
      if (!inserted)
        return { state, outcome: { kind: "refused", message: "Could not create item." } };
      await recordOperatorAudit(transaction, {
        adminUserId: admin,
        characterId: character.id,
        operation: "added_unique_item",
        targetIdentity: inserted.id,
        details: { itemId, currentCharge: inserted.currentCharge },
      });
      const refreshed = await refreshedState(transaction, character.id, now);
      return { state: refreshed, outcome: { kind: "added", itemId, quantity: 1 } };
    },
    now,
  );
}

export async function addItem(
  headers: Headers,
  characterId: string,
  itemId: string,
  quantity: number | undefined,
  now: Date = new Date(),
): Promise<AdminAddItemResult> {
  const admin = await requireAdmin(headers);
  return addItemForAdmin(admin.id, characterId, itemId, quantity, now);
}

// ---------------------------------------------------------------------------
// Mission resets
// ---------------------------------------------------------------------------

export type AdminResetMissionOutcome =
  | { kind: "reset"; scope: readonly string[]; deleted: number }
  | { kind: "nothing_to_reset"; scope: readonly string[] };

export type AdminResetMissionResult = {
  state: PlayGameplayState;
  outcome: AdminResetMissionOutcome;
};

export async function resetMissionChainForAdmin(
  adminUserId: string,
  characterId: string,
  missionId: string,
  now: Date = new Date(),
): Promise<AdminResetMissionResult> {
  const scope = missionChainResetScope(
    missionId,
    MISSIONS.map((m) => ({ id: m.id, prerequisiteMissionId: m.prerequisiteMissionId })),
  );
  return runAdminCharacterCommandAs(
    adminUserId,
    characterId,
    createPlayResolver(),
    async (transaction, { character, action, adminUserId: admin }) => {
      await ensurePlayProvisioning(transaction, character.id);
      const deleted = await transaction
        .delete(characterMissions)
        .where(
          and(
            eq(characterMissions.characterId, character.id),
            inArray(characterMissions.missionId, scope),
          ),
        )
        .returning({ missionId: characterMissions.missionId });
      const state = await refreshedState(transaction, character.id, now);
      if (deleted.length === 0) return { state, outcome: { kind: "nothing_to_reset", scope } };
      await recordOperatorAudit(transaction, {
        adminUserId: admin,
        characterId: character.id,
        operation: "reset_mission_chain",
        targetIdentity: missionId,
        details: { scope, deletedMissionIds: deleted.map((d) => d.missionId) },
      });
      return { state, outcome: { kind: "reset", scope, deleted: deleted.length } };
    },
    now,
  );
}

export async function resetMissionChain(
  headers: Headers,
  characterId: string,
  missionId: string,
  now: Date = new Date(),
): Promise<AdminResetMissionResult> {
  const admin = await requireAdmin(headers);
  return resetMissionChainForAdmin(admin.id, characterId, missionId, now);
}

export async function resetAllMissionsForAdmin(
  adminUserId: string,
  characterId: string,
  now: Date = new Date(),
): Promise<AdminResetMissionResult> {
  return runAdminCharacterCommandAs(
    adminUserId,
    characterId,
    createPlayResolver(),
    async (transaction, { character, action, adminUserId: admin }) => {
      await ensurePlayProvisioning(transaction, character.id);
      const deleted = await transaction
        .delete(characterMissions)
        .where(eq(characterMissions.characterId, character.id))
        .returning({ missionId: characterMissions.missionId });
      const state = await refreshedState(transaction, character.id, now);
      if (deleted.length === 0) return { state, outcome: { kind: "nothing_to_reset", scope: [] } };
      await recordOperatorAudit(transaction, {
        adminUserId: admin,
        characterId: character.id,
        operation: "reset_all_missions",
        details: { deletedMissionIds: deleted.map((d) => d.missionId) },
      });
      return {
        state,
        outcome: { kind: "reset", scope: deleted.map((d) => d.missionId), deleted: deleted.length },
      };
    },
    now,
  );
}

export async function resetAllMissions(
  headers: Headers,
  characterId: string,
  now: Date = new Date(),
): Promise<AdminResetMissionResult> {
  const admin = await requireAdmin(headers);
  return resetAllMissionsForAdmin(admin.id, characterId, now);
}

// ---------------------------------------------------------------------------
// Set Total XP
// ---------------------------------------------------------------------------

export type AdminSetXpOutcome =
  | { kind: "set"; skillId: string; before: number; after: number; level: number }
  | { kind: "no_change"; skillId: string; totalXp: number }
  | { kind: "refused"; message: string };

export type AdminSetXpResult = { state: PlayGameplayState; outcome: AdminSetXpOutcome };

export async function setSkillTotalXpForAdmin(
  adminUserId: string,
  characterId: string,
  skillId: string,
  totalXp: number,
  now: Date = new Date(),
): Promise<AdminSetXpResult> {
  // Canonical skills with an approved progression curve only (correction D9).
  const thresholds = skillLevelThresholds(skillId);
  if (!thresholds) {
    throw new AdminCommandError("That skill has no approved progression curve", 400);
  }
  return runAdminCharacterCommandAs(
    adminUserId,
    characterId,
    createPlayResolver(),
    async (transaction, { character, action, adminUserId: admin }) => {
      await ensurePlayProvisioning(transaction, character.id);
      const rows = await transaction
        .select()
        .from(characterSkillXp)
        .where(
          and(
            eq(characterSkillXp.characterId, character.id),
            eq(characterSkillXp.skillId, skillId),
          ),
        )
        .for("update");
      const before = rows[0]?.totalXp ?? 0;
      if (before === totalXp) {
        const state = await refreshedState(transaction, character.id, now);
        return { state, outcome: { kind: "no_change", skillId, totalXp } };
      }
      await transaction
        .insert(characterSkillXp)
        .values({ characterId: character.id, skillId, totalXp })
        .onConflictDoUpdate({
          target: [characterSkillXp.characterId, characterSkillXp.skillId],
          set: { totalXp },
        });
      const state = await refreshedState(transaction, character.id, now);
      await recordOperatorAudit(transaction, {
        adminUserId: admin,
        characterId: character.id,
        operation: "set_skill_xp",
        targetIdentity: skillId,
        details: { skillId, before, after: totalXp },
      });
      const level = levelFromXp(totalXp, thresholds);
      return { state, outcome: { kind: "set", skillId, before, after: totalXp, level } };
    },
    now,
  );
}

export async function setSkillTotalXp(
  headers: Headers,
  characterId: string,
  skillId: string,
  totalXp: number,
  now: Date = new Date(),
): Promise<AdminSetXpResult> {
  const admin = await requireAdmin(headers);
  return setSkillTotalXpForAdmin(admin.id, characterId, skillId, totalXp, now);
}
