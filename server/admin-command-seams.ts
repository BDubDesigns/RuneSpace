import { and, eq, inArray } from "drizzle-orm";
import {
  cargoHoldItemInstances,
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
import { MISSIONS, getMission } from "@/game/content/missions";
import { missionChainResetScope } from "@/game/domain/missions";
import {
  planExactStackAddition,
  planUniqueItemAddition,
  type StackState,
} from "@/game/domain/inventory";
import { planEquipmentChange } from "@/game/domain/equipment";
import { levelFromXp } from "@/game/domain/progression";
import { withResolvedCharacter } from "@/server/action-resolution";
import type { ActionResolver, DatabaseTransaction } from "@/server/action-resolution";
import { recordOperatorAudit } from "@/server/admin-audit";
import { forceIdleResolvedAction } from "@/server/play-interrupt";
import { invalidateMiningActionForChangedTool } from "@/server/equipment";
import { removeCargoStack } from "@/server/cargo-hold";
import { defaultMiningRandom } from "@/server/mining";
import type { MiningRandom } from "@/game/domain/mining";
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
import type { ActiveAction, Character } from "@/db/rune-space";

/**
 * INTERNAL admin command seams (Issue #113).
 *
 * WARNING: this module is NOT a production admin entrypoint. Every exported
 * function here operates on an EXPLICITLY passed admin user id and assumes the
 * caller has ALREADY established admin authorization (normally via
 * `requireAdmin(headers)`). It exists so the DB-backed command semantics
 * (shared lock + reconcile + force-interrupt + atomic audit) can be exercised
 * against a real PostgreSQL database without a live HTTP session, and so the
 * production entrypoints in `server/admin-commands.ts` can delegate to a single
 * authoritative implementation.
 *
 * Do NOT reach for these from browser-facing server actions. The production
 * surface in `server/admin-commands.ts` is safe-by-construction: each public
 * function calls `requireAdmin(headers)` and then delegates here.
 */

// ---------------------------------------------------------------------------
// shared refreshed-state helper
// ---------------------------------------------------------------------------

/**
 * Internal runner shared by every seam below: run a command through the shared
 * character lock + lazy-reconcile boundary with an EXPLICIT admin user id. This
 * is NOT a production entrypoint — it assumes authorization was already
 * established (normally by `requireAdmin`). It lives here (an INTERNAL module)
 * so it is not part of the production command surface.
 */
async function runAdminCharacterCommandAs<Snapshot, Outcome, Result>(
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

export async function stopCurrentActionAsAdmin(
  adminUserId: string,
  characterId: string,
  now: Date = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<AdminStopResult> {
  return runAdminCharacterCommandAs(
    adminUserId,
    characterId,
    createPlayResolver(random),
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

/**
 * Reload the character row's authoritative location inside the transaction so
 * it reflects any Travel arrival committed by the reconcile step (mirrors
 * beginTravel's post-reconcile reload).
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

export async function teleportCharacterAsAdmin(
  adminUserId: string,
  characterId: string,
  destinationLocationId: string,
  now: Date = new Date(),
  random: MiningRandom = defaultMiningRandom(),
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
    createPlayResolver(random),
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

/** Exact carried-stack removal (player discard semantics). */
export async function removeCarriedStackQuantityAsAdmin(
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
    async (transaction, { character, adminUserId: admin }) => {
      await ensurePlayProvisioning(transaction, character.id);
      const removal = await removeFromSelectedStack(transaction, {
        characterId: character.id,
        stackId,
        expectedQuantity,
        quantity: mode === "stack" ? expectedQuantity : 1,
        now,
      });
      // Reload AFTER the mutation so the returned state is authoritative.
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

/**
 * Exact Cargo-stack removal. The Cargo mutation itself is delegated to the
 * Cargo-owned server boundary (`removeCargoStack`), which locks the exact
 * `cargoHoldStacks` row and rejects a stale expected quantity. State is
 * reloaded AFTER the mutation.
 */
export async function removeCargoStackQuantityAsAdmin(
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
    async (transaction, { character, adminUserId: admin }) => {
      await ensurePlayProvisioning(transaction, character.id);
      const removal = await removeCargoStack(transaction, {
        characterId: character.id,
        stackId,
        mode,
        expectedQuantity,
        now,
      });
      const state = await refreshedState(transaction, character.id, now);
      if (removal.status !== "removed") {
        return { state, outcome: { kind: "stale", message: removal.message } };
      }
      await recordOperatorAudit(transaction, {
        adminUserId: admin,
        characterId: character.id,
        operation: "removed_stack_quantity",
        targetIdentity: stackId,
        details: { source: "cargo", mode, removedQuantity: removal.removedQuantity },
      });
      return {
        state,
        outcome: {
          kind: "removed",
          source: "cargo",
          removedQuantity: removal.removedQuantity,
        },
      };
    },
    now,
  );
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

export async function forceUnequipItemAsAdmin(
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
      if (!assignment || !instance)
        return {
          state: await refreshedState(transaction, character.id, now),
          outcome: { kind: "refused", message: "Item is not equipped." },
        };
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
          state: await refreshedState(transaction, character.id, now),
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

      // If the Mining tool slot was just vacated while an active Mining action
      // is live, apply the shared authoritative Mining-loadout invalidation so
      // an active `ferrite_shale_mining` action can never be committed with a
      // missing tool.
      const miningToolSlotId = balance.items.salvageCutter.suitSlotId;
      if (assignment.assignmentKind === "gear" && assignment.suitSlotId === miningToolSlotId) {
        await invalidateMiningActionForChangedTool(transaction, {
          characterId: character.id,
          action,
          previousToolItemInstanceId: itemInstanceId,
          currentToolItemInstanceId: undefined,
          now,
        });
      }

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
        state: await refreshedState(transaction, character.id, now),
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

export async function deleteUniqueItemAsAdmin(
  adminUserId: string,
  characterId: string,
  itemInstanceId: string,
  now: Date = new Date(),
): Promise<AdminDeleteItemResult> {
  return runAdminCharacterCommandAs(
    adminUserId,
    characterId,
    createPlayResolver(),
    async (transaction, { character, adminUserId: admin }) => {
      await ensurePlayProvisioning(transaction, character.id);
      const [instanceRows, cargoRows, assignmentRows] = await Promise.all([
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
      if (!instance)
        return {
          state: await refreshedState(transaction, character.id, now),
          outcome: { kind: "refused", message: "Item instance not found." },
        };
      const equipped = assignmentRows.some((a) => a.itemInstanceId === itemInstanceId);
      if (equipped)
        return {
          state: await refreshedState(transaction, character.id, now),
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
        state: await refreshedState(transaction, character.id, now),
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

// ---------------------------------------------------------------------------
// Canonical ADD ITEM (carried only in v1)
// ---------------------------------------------------------------------------

export type AdminAddItemOutcome =
  | { kind: "added"; itemId: string; quantity: number }
  | { kind: "refused"; message: string };

export type AdminAddItemResult = { state: PlayGameplayState; outcome: AdminAddItemOutcome };

export async function addItemAsAdmin(
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
    async (transaction, { character, adminUserId: admin }) => {
      await ensurePlayProvisioning(transaction, character.id);
      const balance = getEffectiveGameBalance();
      const definition = getItemDefinition(itemId, balance);
      const state = await refreshedState(transaction, character.id, now);
      if (!definition) return { state, outcome: { kind: "refused", message: "Unknown item." } };

      if (definition.kind === "stack") {
        const amount = quantity ?? 1;
        // Fail closed on a nonsensical stack quantity: an omitted quantity means
        // "add one", but an explicit 0, negative, or non-integer must never
        // silently become a different successful mutation.
        if (!Number.isInteger(amount) || amount < 1) {
          return {
            state,
            outcome: {
              kind: "refused",
              message: "Stackable quantity must be a positive whole number.",
            },
          };
        }
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
      // Quantities do not apply to unique items; an EXPLICIT quantity is
      // nonsensical and must fail closed rather than be silently ignored.
      if (quantity !== undefined) {
        return {
          state,
          outcome: {
            kind: "refused",
            message: "Unique items are added exactly one per command; a quantity is not valid.",
          },
        };
      }
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

// ---------------------------------------------------------------------------
// Mission resets (authored-content-driven)
// ---------------------------------------------------------------------------

export type AdminResetMissionOutcome =
  | { kind: "reset"; scope: readonly string[]; deleted: number }
  | { kind: "nothing_to_reset"; scope: readonly string[] };

export type AdminResetMissionResult = {
  state: PlayGameplayState;
  outcome: AdminResetMissionOutcome;
};

/**
 * RESET FROM THIS MISSION. The scope is derived from authored
 * `prerequisiteMissionId` edges AND the mission id is validated against the
 * authored `MISSIONS` registry: an unknown/non-authored mission id is rejected
 * server-side (it cannot be part of an authored chain, so there is nothing
 * meaningful to reset).
 */
export async function resetMissionChainAsAdmin(
  adminUserId: string,
  characterId: string,
  missionId: string,
  now: Date = new Date(),
): Promise<AdminResetMissionResult> {
  if (!getMission(missionId)) {
    throw new AdminCommandError(`No authored mission "${missionId}"`, 400);
  }
  const scope = missionChainResetScope(
    missionId,
    MISSIONS.map((m) => ({ id: m.id, prerequisiteMissionId: m.prerequisiteMissionId })),
  );
  return runAdminCharacterCommandAs(
    adminUserId,
    characterId,
    createPlayResolver(),
    async (transaction, { character, adminUserId: admin }) => {
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

/**
 * RESET ALL MISSIONS. Deletes ONLY the currently authored mission ids for the
 * selected character — never arbitrary persisted rows. If an authored mission
 * was later removed from `MISSIONS`, its persisted row (from before removal)
 * is intentionally left alone, because the operator console must not clear rows
 * it cannot name against current authored content.
 */
export async function resetAllMissionsAsAdmin(
  adminUserId: string,
  characterId: string,
  now: Date = new Date(),
): Promise<AdminResetMissionResult> {
  const authoredIds = MISSIONS.map((m) => m.id);
  return runAdminCharacterCommandAs(
    adminUserId,
    characterId,
    createPlayResolver(),
    async (transaction, { character, adminUserId: admin }) => {
      await ensurePlayProvisioning(transaction, character.id);
      const deleted = await transaction
        .delete(characterMissions)
        .where(
          and(
            eq(characterMissions.characterId, character.id),
            inArray(characterMissions.missionId, authoredIds),
          ),
        )
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

// ---------------------------------------------------------------------------
// Set Total XP
// ---------------------------------------------------------------------------

export type AdminSetXpOutcome =
  | { kind: "set"; skillId: string; before: number; after: number; level: number }
  | { kind: "no_change"; skillId: string; totalXp: number }
  | { kind: "refused"; message: string };

export type AdminSetXpResult = { state: PlayGameplayState; outcome: AdminSetXpOutcome };

export async function setSkillTotalXpAsAdmin(
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
    async (transaction, { character, adminUserId: admin }) => {
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

/** Minimal error carrier so seams can reject without importing the public class. */
export class AdminCommandError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "AdminCommandError";
  }
}
