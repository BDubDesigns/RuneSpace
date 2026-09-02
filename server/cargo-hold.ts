import { and, asc, eq } from "drizzle-orm";
import {
  activeActions,
  cargoHoldItemInstances,
  cargoHoldStacks,
  characterCargoHoldRepair,
  characters,
  equippedItems,
  inventoryStacks,
  itemInstances,
} from "@/db/rune-space";
import { getEffectiveGameBalance, getItemDefinition } from "@/game/config/balance";
import { ACTION_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { isActionAvailableAtLocation } from "@/game/content/locations";
import {
  cargoHoldMaterialsComplete,
  cargoHoldRepairComplete,
  planCargoHoldMaterialContribution,
  type CargoHoldRepairState,
} from "@/game/domain/cargo-hold";
import {
  deriveEquipmentLoadout,
  type EquipmentAssignmentState,
  type EquipmentItemInstance,
} from "@/game/domain/equipment";
import { planExactStackAddition, type StackState } from "@/game/domain/inventory";
import type { MiningRandom } from "@/game/domain/mining";
import { type DatabaseTransaction, withResolvedOwnedCharacter } from "@/server/action-resolution";
import {
  addStackableItem,
  consumeStackableItem,
  loadOwnedItemInstances,
  removeFromSelectedStack,
} from "@/server/carried-inventory";
import {
  createPlayResolver,
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";

export type CargoHoldMaterialContributionRequest = {
  expectedRefinedFerrite: number;
  expectedSlag: number;
};

export type CargoHoldStackTransferRequest = {
  stackId: string;
  mode: "one" | "stack";
  expectedQuantity: number;
};

export type CargoHoldUniqueTransferRequest = {
  itemInstanceId: string;
};

export type CargoHoldRefusalReason =
  | "not_at_crash_site"
  | "in_transit"
  | "repair_incomplete"
  | "materials_changed"
  | "nothing_to_contribute"
  | "stack_changed"
  | "stack_not_found"
  | "unsupported_stack"
  | "cargo_capacity"
  | "carried_capacity"
  | "item_not_found"
  | "equipped_item"
  | "item_already_stored"
  | "item_not_stored";

export type CargoHoldRefusal = {
  status: "refused";
  reason: CargoHoldRefusalReason;
  message: string;
};

export type CargoHoldContributionStatus =
  | {
      status: "committed";
      refinedFerrite: number;
      slag: number;
    }
  | CargoHoldRefusal;

export type CargoHoldTransferStatus =
  | {
      status: "transferred";
      quantity?: number;
      itemInstanceId?: string;
    }
  | CargoHoldRefusal;

export type CargoHoldStateResult<T> = {
  state: PlayGameplayState;
  cargo: T;
};

const EMPTY_RECENT_RESULT = { successes: 0, failures: 0, awardedXp: 0 } as const;

function repairState(row: typeof characterCargoHoldRepair.$inferSelect): CargoHoldRepairState {
  return {
    refinedFerriteContributed: row.refinedFerriteContributed,
    slagContributed: row.slagContributed,
    weldingProgress: row.weldingProgress,
    completedAt: row.completedAt,
  };
}

async function loadRepair(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<typeof characterCargoHoldRepair.$inferSelect> {
  const rows = await transaction
    .select()
    .from(characterCargoHoldRepair)
    .where(eq(characterCargoHoldRepair.characterId, characterId))
    .for("update");
  const row = rows[0];
  if (!row) throw new Error("Cargo Hold repair state must exist before a Cargo command");
  return row;
}

async function accessRefusal(
  transaction: DatabaseTransaction,
  characterId: string,
  action: { actionId: string } | undefined,
  repair: typeof characterCargoHoldRepair.$inferSelect,
  requireRestoredHold = true,
): Promise<CargoHoldRefusal | undefined> {
  if (action?.actionId === ACTION_IDS.travel) {
    return {
      status: "refused",
      reason: "in_transit",
      message: "Cargo Hold access is unavailable while traveling.",
    };
  }
  if (action) {
    return {
      status: "refused",
      reason: "in_transit",
      message: "Finish the active activity before accessing the Cargo Hold.",
    };
  }
  const charactersAtLocation = await transaction
    .select({ currentLocationId: characters.currentLocationId })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  if (charactersAtLocation[0]?.currentLocationId !== LOCATION_IDS.crashSite) {
    return {
      status: "refused",
      reason: "not_at_crash_site",
      message: "Cargo Hold access is only available while stationary at Crash Site.",
    };
  }
  if (
    requireRestoredHold &&
    !cargoHoldRepairComplete(repairState(repair), getEffectiveGameBalance())
  ) {
    return {
      status: "refused",
      reason: "repair_incomplete",
      message: "Restore the Cargo Hold before using its storage.",
    };
  }
  return undefined;
}

async function stateAfterCargoCommand(
  transaction: DatabaseTransaction,
  characterId: string,
  now: Date,
): Promise<PlayGameplayState> {
  return stateFromTransaction(
    transaction,
    characterId,
    EMPTY_RECENT_RESULT,
    undefined,
    undefined,
    undefined,
    undefined,
    now,
  );
}

async function loadCarriedCapacity(
  transaction: DatabaseTransaction,
  characterId: string,
  now: Date,
) {
  const balance = getEffectiveGameBalance();
  const [stacks, itemState, assignments] = await Promise.all([
    transaction
      .select()
      .from(inventoryStacks)
      .where(eq(inventoryStacks.characterId, characterId))
      .orderBy(asc(inventoryStacks.createdAt), asc(inventoryStacks.id))
      .for("update"),
    loadOwnedItemInstances(transaction, characterId),
    transaction
      .select()
      .from(equippedItems)
      .where(eq(equippedItems.characterId, characterId))
      .for("update"),
  ]);
  const loadout = deriveEquipmentLoadout({
    assignments: assignments as EquipmentAssignmentState[],
    instances: itemState.carriedInstances as EquipmentItemInstance[],
    stacks,
    balance,
  });
  void now;
  return {
    stacks,
    availableSlots: Math.max(0, loadout.containerSlotCapacity - loadout.inventorySlotsUsed),
    availableMassGrams: Math.max(0, loadout.maximumCarryCapacityGrams - loadout.carriedMassGrams),
  };
}

export async function contributeCargoHoldMaterials(
  userId: string,
  characterId: string,
  request: CargoHoldMaterialContributionRequest,
  now = new Date(),
  random: MiningRandom = {
    nextBasisPoints: () => 0,
    nextUnit: () => 0,
  },
): Promise<CargoHoldStateResult<CargoHoldContributionStatus>> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      const balance = getEffectiveGameBalance();
      const repair = await loadRepair(transaction, context.character.id);
      const access = await accessRefusal(
        transaction,
        context.character.id,
        context.action,
        repair,
        false,
      );
      if (access) {
        return {
          state: await stateAfterCargoCommand(transaction, context.character.id, now),
          cargo: access,
        };
      }
      const stacks = await transaction
        .select()
        .from(inventoryStacks)
        .where(eq(inventoryStacks.characterId, context.character.id))
        .orderBy(asc(inventoryStacks.createdAt), asc(inventoryStacks.id))
        .for("update");
      const carriedRefinedFerrite = stacks
        .filter((stack) => stack.itemId === balance.items.refinedFerrite.itemId)
        .reduce((total, stack) => total + stack.quantity, 0);
      const carriedSlag = stacks
        .filter((stack) => stack.itemId === balance.items.slag.itemId)
        .reduce((total, stack) => total + stack.quantity, 0);
      const useful = planCargoHoldMaterialContribution({
        repair: repairState(repair),
        carriedRefinedFerrite,
        carriedSlag,
        balance,
      });
      if (
        useful.refinedFerrite !== request.expectedRefinedFerrite ||
        useful.slag !== request.expectedSlag
      ) {
        return {
          state: await stateAfterCargoCommand(transaction, context.character.id, now),
          cargo: {
            status: "refused",
            reason: "materials_changed",
            message: "Repair materials changed. Review the useful quantities and try again.",
          },
        };
      }
      if (useful.refinedFerrite === 0 && useful.slag === 0) {
        return {
          state: await stateAfterCargoCommand(transaction, context.character.id, now),
          cargo: {
            status: "refused",
            reason: "nothing_to_contribute",
            message: "No carried Refined Ferrite or Slag is still needed for this repair.",
          },
        };
      }

      const refinedResult = await consumeStackableItem(transaction, {
        characterId: context.character.id,
        itemId: balance.items.refinedFerrite.itemId,
        quantity: useful.refinedFerrite,
        now,
      });
      const slagResult = await consumeStackableItem(transaction, {
        characterId: context.character.id,
        itemId: balance.items.slag.itemId,
        quantity: useful.slag,
        now,
      });
      if (!refinedResult.ok || !slagResult.ok)
        throw new Error("Contribution removal became invalid");
      await transaction
        .update(characterCargoHoldRepair)
        .set({
          refinedFerriteContributed: repair.refinedFerriteContributed + useful.refinedFerrite,
          slagContributed: repair.slagContributed + useful.slag,
          updatedAt: now,
        })
        .where(eq(characterCargoHoldRepair.characterId, context.character.id));
      return {
        state: await stateAfterCargoCommand(transaction, context.character.id, now),
        cargo: { status: "committed", ...useful },
      };
    },
    now,
  );
}

async function cargoStackAccess(
  transaction: DatabaseTransaction,
  characterId: string,
  action: { actionId: string } | undefined,
) {
  const repair = await loadRepair(transaction, characterId);
  const access = await accessRefusal(transaction, characterId, action, repair);
  return { repair, access };
}

export async function depositCargoStack(
  userId: string,
  characterId: string,
  request: CargoHoldStackTransferRequest,
  now = new Date(),
  random: MiningRandom = {
    nextBasisPoints: () => 0,
    nextUnit: () => 0,
  },
): Promise<CargoHoldStateResult<CargoHoldTransferStatus>> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      const { access } = await cargoStackAccess(transaction, context.character.id, context.action);
      if (access)
        return {
          state: await stateAfterCargoCommand(transaction, context.character.id, now),
          cargo: access,
        };
      const [sourceRows, cargoRows, cargoItems] = await Promise.all([
        transaction
          .select()
          .from(inventoryStacks)
          .where(
            and(
              eq(inventoryStacks.characterId, context.character.id),
              eq(inventoryStacks.id, request.stackId),
            ),
          )
          .for("update"),
        transaction
          .select()
          .from(cargoHoldStacks)
          .where(eq(cargoHoldStacks.characterId, context.character.id))
          .orderBy(asc(cargoHoldStacks.createdAt), asc(cargoHoldStacks.id))
          .for("update"),
        transaction
          .select()
          .from(cargoHoldItemInstances)
          .where(eq(cargoHoldItemInstances.characterId, context.character.id))
          .for("update"),
      ]);
      const source = sourceRows[0];
      const refusal = async (reason: CargoHoldRefusalReason, message: string) => ({
        state: await stateAfterCargoCommand(transaction, context.character.id, now),
        cargo: { status: "refused" as const, reason, message },
      });
      if (!source) return refusal("stack_not_found", "That carried stack is no longer available.");
      if (source.quantity !== request.expectedQuantity)
        return refusal("stack_changed", "Inventory changed. Review the stack and try again.");
      const definition = getItemDefinition(source.itemId);
      if (!definition || definition.kind !== "stack")
        return refusal("unsupported_stack", "That item cannot be stored as a Cargo stack.");
      const quantity = request.mode === "one" ? 1 : source.quantity;
      const availableSlots =
        getEffectiveGameBalance().cargoHold.capacitySlots - cargoRows.length - cargoItems.length;
      const additionResult = planExactStackAddition(
        cargoRows as StackState<string>[],
        definition.itemId,
        quantity,
        definition.stackLimit,
        Math.max(0, availableSlots),
        Number.POSITIVE_INFINITY,
        0,
      );
      if (!additionResult.ok)
        return refusal("cargo_capacity", "Cargo Hold has no room for that complete transfer.");
      const addition = additionResult.plan;
      const removal = await removeFromSelectedStack(transaction, {
        characterId: context.character.id,
        stackId: request.stackId,
        expectedQuantity: request.expectedQuantity,
        expectedItemId: definition.itemId,
        quantity,
        now,
      });
      if (!removal.ok)
        return refusal("stack_changed", "Inventory changed. Review the stack and try again.");
      await Promise.all(
        addition.updatedStacks.map((update) =>
          transaction
            .update(cargoHoldStacks)
            .set({ quantity: update.quantity, updatedAt: now })
            .where(
              and(
                eq(cargoHoldStacks.id, update.id),
                eq(cargoHoldStacks.characterId, context.character.id),
              ),
            ),
        ),
      );
      if (addition.createdStacks.length)
        await transaction.insert(cargoHoldStacks).values(
          addition.createdStacks.map((stack) => ({
            characterId: context.character.id,
            itemId: stack.itemId,
            quantity: stack.quantity,
          })),
        );
      return {
        state: await stateAfterCargoCommand(transaction, context.character.id, now),
        cargo: { status: "transferred", quantity },
      };
    },
    now,
  );
}

export async function withdrawCargoStack(
  userId: string,
  characterId: string,
  request: CargoHoldStackTransferRequest,
  now = new Date(),
  random: MiningRandom = {
    nextBasisPoints: () => 0,
    nextUnit: () => 0,
  },
): Promise<CargoHoldStateResult<CargoHoldTransferStatus>> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      const { access } = await cargoStackAccess(transaction, context.character.id, context.action);
      if (access)
        return {
          state: await stateAfterCargoCommand(transaction, context.character.id, now),
          cargo: access,
        };
      const sourceRows = await transaction
        .select()
        .from(cargoHoldStacks)
        .where(
          and(
            eq(cargoHoldStacks.characterId, context.character.id),
            eq(cargoHoldStacks.id, request.stackId),
          ),
        )
        .for("update");
      const source = sourceRows[0];
      const refusal = async (reason: CargoHoldRefusalReason, message: string) => ({
        state: await stateAfterCargoCommand(transaction, context.character.id, now),
        cargo: { status: "refused" as const, reason, message },
      });
      if (!source) return refusal("stack_not_found", "That Cargo stack is no longer available.");
      if (source.quantity !== request.expectedQuantity)
        return refusal("stack_changed", "Cargo changed. Review the stack and try again.");
      const definition = getItemDefinition(source.itemId);
      if (!definition || definition.kind !== "stack")
        return refusal("unsupported_stack", "That Cargo item cannot be withdrawn as a stack.");
      const quantity = request.mode === "one" ? 1 : source.quantity;
      const carry = await loadCarriedCapacity(transaction, context.character.id, now);
      const additionResult = planExactStackAddition(
        carry.stacks as StackState<string>[],
        definition.itemId,
        quantity,
        definition.stackLimit,
        carry.availableSlots,
        carry.availableMassGrams,
        definition.massGrams,
      );
      if (!additionResult.ok)
        return refusal(
          "carried_capacity",
          "The requested transfer does not fit in carried Inventory.",
        );
      const addition = additionResult.plan;
      if (source.quantity === quantity)
        await transaction
          .delete(cargoHoldStacks)
          .where(
            and(
              eq(cargoHoldStacks.id, source.id),
              eq(cargoHoldStacks.characterId, context.character.id),
            ),
          );
      else
        await transaction
          .update(cargoHoldStacks)
          .set({ quantity: source.quantity - quantity, updatedAt: now })
          .where(
            and(
              eq(cargoHoldStacks.id, source.id),
              eq(cargoHoldStacks.characterId, context.character.id),
            ),
          );
      await addStackableItem(transaction, {
        characterId: context.character.id,
        plan: addition,
        now,
      });
      return {
        state: await stateAfterCargoCommand(transaction, context.character.id, now),
        cargo: { status: "transferred", quantity },
      };
    },
    now,
  );
}

/**
 * Authoritative Cargo-hold stack removal (operator console, Issue #113).
 *
 * This is the Cargo-owned mutation boundary for removing quantity from a
 * carried-adjacent Cargo stack: the exact `cargoHoldStacks` row (by
 * characterId + stackId) is locked, the caller's `expectedQuantity` is verified
 * (mismatch ⇒ `stack_changed` refusal, so a reported stack identity can never
 * mutate a changed stack), and exactly `mode === "one" ? 1 : source.quantity`
 * is removed. It operates inside an already-authorised transaction (the shared
 * lock + reconcile boundary); it intentionally performs no player-ownership and
 * no carry/deposit transfer — it only removes Cargo quantity.
 */
export async function removeCargoStack(
  transaction: import("@/server/action-resolution").DatabaseTransaction,
  input: {
    characterId: string;
    stackId: string;
    mode: "one" | "stack";
    expectedQuantity: number;
    now: Date;
  },
): Promise<
  | { status: "removed"; removedQuantity: number; itemId: string }
  | { status: "refused"; reason: CargoHoldRefusalReason; message: string }
> {
  const sourceRows = await transaction
    .select()
    .from(cargoHoldStacks)
    .where(
      and(
        eq(cargoHoldStacks.characterId, input.characterId),
        eq(cargoHoldStacks.id, input.stackId),
      ),
    )
    .for("update");
  const source = sourceRows[0];
  if (!source)
    return {
      status: "refused",
      reason: "stack_not_found",
      message: "That Cargo stack is no longer available.",
    };
  if (source.quantity !== input.expectedQuantity)
    return {
      status: "refused",
      reason: "stack_changed",
      message: "Cargo changed. Review the stack and try again.",
    };
  const definition = getItemDefinition(source.itemId);
  if (!definition || definition.kind !== "stack")
    return {
      status: "refused",
      reason: "unsupported_stack",
      message: "That Cargo item is not a removable stack.",
    };
  const quantity = input.mode === "one" ? 1 : source.quantity;
  if (source.quantity === quantity) {
    await transaction
      .delete(cargoHoldStacks)
      .where(
        and(eq(cargoHoldStacks.id, source.id), eq(cargoHoldStacks.characterId, input.characterId)),
      );
  } else {
    await transaction
      .update(cargoHoldStacks)
      .set({ quantity: source.quantity - quantity, updatedAt: input.now })
      .where(
        and(eq(cargoHoldStacks.id, source.id), eq(cargoHoldStacks.characterId, input.characterId)),
      );
  }
  // The removed stack's canonical item id travels with the result so callers
  // (the operator audit seam) can record exactly what was removed without a
  // second read; the row is deleted or decremented above under its lock.
  return { status: "removed", removedQuantity: quantity, itemId: source.itemId };
}

export async function depositCargoUniqueItem(
  userId: string,
  characterId: string,
  request: CargoHoldUniqueTransferRequest,
  now = new Date(),
  random: MiningRandom = {
    nextBasisPoints: () => 0,
    nextUnit: () => 0,
  },
): Promise<CargoHoldStateResult<CargoHoldTransferStatus>> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      const { access } = await cargoStackAccess(transaction, context.character.id, context.action);
      if (access)
        return {
          state: await stateAfterCargoCommand(transaction, context.character.id, now),
          cargo: access,
        };
      const [instanceRows, assignmentRows, cargoRows, cargoStackRows] = await Promise.all([
        transaction
          .select()
          .from(itemInstances)
          .where(
            and(
              eq(itemInstances.characterId, context.character.id),
              eq(itemInstances.id, request.itemInstanceId),
            ),
          )
          .for("update"),
        transaction
          .select()
          .from(equippedItems)
          .where(eq(equippedItems.characterId, context.character.id))
          .for("update"),
        transaction
          .select()
          .from(cargoHoldItemInstances)
          .where(eq(cargoHoldItemInstances.characterId, context.character.id))
          .for("update"),
        transaction
          .select()
          .from(cargoHoldStacks)
          .where(eq(cargoHoldStacks.characterId, context.character.id))
          .for("update"),
      ]);
      const instance = instanceRows[0];
      const refusal = async (reason: CargoHoldRefusalReason, message: string) => ({
        state: await stateAfterCargoCommand(transaction, context.character.id, now),
        cargo: { status: "refused" as const, reason, message },
      });
      if (!instance) return refusal("item_not_found", "That carried item is no longer available.");
      const definition = getItemDefinition(instance.itemId);
      if (!definition || definition.kind !== "unique")
        return refusal("item_not_found", "That item is not a transferable unique item.");
      if (assignmentRows.some((assignment) => assignment.itemInstanceId === instance.id))
        return refusal("equipped_item", "Unequip that item before depositing it in Cargo Hold.");
      if (cargoRows.some((row) => row.itemInstanceId === instance.id))
        return refusal("item_already_stored", "That item is already in Cargo Hold.");
      if (
        cargoRows.length + cargoStackRows.length >=
        getEffectiveGameBalance().cargoHold.capacitySlots
      )
        return refusal("cargo_capacity", "Cargo Hold has no free occupied-item slots.");
      await transaction.insert(cargoHoldItemInstances).values({
        characterId: context.character.id,
        itemInstanceId: instance.id,
        storedAt: now,
      });
      return {
        state: await stateAfterCargoCommand(transaction, context.character.id, now),
        cargo: { status: "transferred", itemInstanceId: instance.id },
      };
    },
    now,
  );
}

export async function withdrawCargoUniqueItem(
  userId: string,
  characterId: string,
  request: CargoHoldUniqueTransferRequest,
  now = new Date(),
  random: MiningRandom = {
    nextBasisPoints: () => 0,
    nextUnit: () => 0,
  },
): Promise<CargoHoldStateResult<CargoHoldTransferStatus>> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      const { access } = await cargoStackAccess(transaction, context.character.id, context.action);
      if (access)
        return {
          state: await stateAfterCargoCommand(transaction, context.character.id, now),
          cargo: access,
        };
      const [cargoRows, instanceRows] = await Promise.all([
        transaction
          .select()
          .from(cargoHoldItemInstances)
          .where(
            and(
              eq(cargoHoldItemInstances.characterId, context.character.id),
              eq(cargoHoldItemInstances.itemInstanceId, request.itemInstanceId),
            ),
          )
          .for("update"),
        transaction
          .select()
          .from(itemInstances)
          .where(
            and(
              eq(itemInstances.characterId, context.character.id),
              eq(itemInstances.id, request.itemInstanceId),
            ),
          )
          .for("update"),
      ]);
      const cargoRow = cargoRows[0];
      const instance = instanceRows[0];
      const refusal = async (reason: CargoHoldRefusalReason, message: string) => ({
        state: await stateAfterCargoCommand(transaction, context.character.id, now),
        cargo: { status: "refused" as const, reason, message },
      });
      if (!cargoRow || !instance)
        return refusal("item_not_stored", "That Cargo item is no longer available.");
      const definition = getItemDefinition(instance.itemId);
      if (!definition || definition.kind !== "unique")
        return refusal("item_not_stored", "That Cargo item is not transferable.");
      const carry = await loadCarriedCapacity(transaction, context.character.id, now);
      if (carry.availableSlots < 1)
        return refusal("carried_capacity", "Carried Inventory has no free occupied-item slot.");
      if (carry.availableMassGrams < definition.massGrams)
        return refusal("carried_capacity", "That item would exceed carried mass capacity.");
      await transaction
        .delete(cargoHoldItemInstances)
        .where(
          and(
            eq(cargoHoldItemInstances.characterId, context.character.id),
            eq(cargoHoldItemInstances.itemInstanceId, instance.id),
          ),
        );
      return {
        state: await stateAfterCargoCommand(transaction, context.character.id, now),
        cargo: { status: "transferred", itemInstanceId: instance.id },
      };
    },
    now,
  );
}

export async function startCargoHoldWelding(
  userId: string,
  characterId: string,
  now = new Date(),
  random: MiningRandom = {
    nextBasisPoints: () => 0,
    nextUnit: () => 0,
  },
): Promise<PlayGameplayState> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      const balance = getEffectiveGameBalance();
      const repair = await loadRepair(transaction, context.character.id);
      if (context.action?.actionId === ACTION_IDS.cargoHoldWelding) {
        return stateAfterCargoCommand(transaction, context.character.id, now);
      }
      if (context.action) {
        return stateFromTransaction(
          transaction,
          context.character.id,
          EMPTY_RECENT_RESULT,
          undefined,
          "another_action_active",
          undefined,
          undefined,
          now,
        );
      }
      const characterRows = await transaction
        .select({ currentLocationId: characters.currentLocationId })
        .from(characters)
        .where(eq(characters.id, context.character.id))
        .limit(1);
      if (
        !isActionAvailableAtLocation(
          characterRows[0]?.currentLocationId ?? "",
          ACTION_IDS.cargoHoldWelding,
        )
      ) {
        return stateFromTransaction(
          transaction,
          context.character.id,
          EMPTY_RECENT_RESULT,
          undefined,
          undefined,
          undefined,
          undefined,
          now,
          EMPTY_RECENT_RESULT,
          undefined,
          undefined,
          "welding_unavailable_here",
        );
      }
      const repairProjection = repairState(repair);
      if (cargoHoldRepairComplete(repairProjection, balance)) {
        return stateFromTransaction(
          transaction,
          context.character.id,
          EMPTY_RECENT_RESULT,
          undefined,
          undefined,
          undefined,
          undefined,
          now,
          EMPTY_RECENT_RESULT,
          undefined,
          undefined,
          "repair_complete",
        );
      }
      if (!cargoHoldMaterialsComplete(repairProjection, balance)) {
        return stateFromTransaction(
          transaction,
          context.character.id,
          EMPTY_RECENT_RESULT,
          undefined,
          undefined,
          undefined,
          undefined,
          now,
          EMPTY_RECENT_RESULT,
          undefined,
          undefined,
          "welding_locked",
        );
      }
      await transaction.insert(activeActions).values({
        characterId: context.character.id,
        actionId: ACTION_IDS.cargoHoldWelding,
        startedAt: now,
        resolvedThroughAt: now,
      });
      return stateAfterCargoCommand(transaction, context.character.id, now);
    },
    now,
  );
}

export async function stopCargoHoldWelding(
  userId: string,
  characterId: string,
  now = new Date(),
  random: MiningRandom = {
    nextBasisPoints: () => 0,
    nextUnit: () => 0,
  },
): Promise<PlayGameplayState> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      if (context.action?.actionId === ACTION_IDS.cargoHoldWelding) {
        await transaction
          .delete(activeActions)
          .where(eq(activeActions.characterId, context.character.id));
        return stateAfterCargoCommand(transaction, context.character.id, now);
      }
      return stateFromTransaction(
        transaction,
        context.character.id,
        EMPTY_RECENT_RESULT,
        undefined,
        context.action ? "another_action_active" : undefined,
        undefined,
        undefined,
        now,
      );
    },
    now,
  );
}
