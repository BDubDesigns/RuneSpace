import { and, asc, eq } from "drizzle-orm";
import {
  activeActions,
  characterRepairTargets,
  characters,
  inventoryStacks,
} from "@/db/rune-space";
import { getEffectiveGameBalance, getRepairTargetBalance } from "@/game/config/balance";
import { ACTION_IDS, type RepairTargetId } from "@/game/config/foundations";
import { getLocalPlaceInLocation } from "@/game/content/local-places";
import { getRepairTarget } from "@/game/content/repair-targets";
import {
  applyRepairMaterialContribution,
  contributionIsEmpty,
  planRepairMaterialContribution,
  repairMaterialsComplete,
} from "@/game/domain/welding-repair";
import type { MiningRandom } from "@/game/domain/mining";
import { type DatabaseTransaction, withResolvedOwnedCharacter } from "@/server/action-resolution";
import { consumeStackableItem } from "@/server/carried-inventory";
import {
  createPlayResolver,
  ensurePlayProvisioning,
  stateFromTransaction,
  type PlayGameplayState,
} from "@/server/play";
import { loadRepairAccess } from "@/server/repair-access";
import {
  ensureRepairCleanPassRoll,
  ensureRepairTargetState,
  loadRepairTargetRow,
  missOpenRepairCleanPass,
  repairStateFromRow,
} from "@/server/welding";

export type RepairMaterialContributionRequest = {
  targetId: RepairTargetId;
  /** Expected useful quantity per item ID; any mismatch refuses (#209). */
  expectedMaterials: Readonly<Record<string, number>>;
};

export type RepairRefusalReason =
  | "unknown_target"
  | "wrong_location"
  | "in_transit"
  | "repair_locked"
  | "repair_complete"
  | "materials_changed"
  | "nothing_to_contribute";

export type RepairRefusal = {
  status: "refused";
  reason: RepairRefusalReason;
  message: string;
};

export type RepairContributionStatus =
  | { status: "committed"; materials: Readonly<Record<string, number>> }
  | RepairRefusal;

export type RepairStateResult<T> = {
  state: PlayGameplayState;
  repair: T;
};

const EMPTY_RECENT_RESULT = { successes: 0, failures: 0, awardedXp: 0 } as const;

const SILENT_RANDOM: MiningRandom = {
  nextBasisPoints: () => 0,
  nextUnit: () => 0,
};

async function stateAfterRepairCommand(
  transaction: DatabaseTransaction,
  characterId: string,
  now: Date,
  weldingError?: PlayGameplayState["weldingError"],
  commandError?: PlayGameplayState["commandError"],
): Promise<PlayGameplayState> {
  return stateFromTransaction(
    transaction,
    characterId,
    EMPTY_RECENT_RESULT,
    undefined,
    commandError,
    undefined,
    undefined,
    now,
    EMPTY_RECENT_RESULT,
    undefined,
    undefined,
    weldingError,
  );
}

/**
 * The shared authoritative preflight for every repair-work command.
 *
 * Position, busy-state, and Mission authorization are all revalidated from the
 * locked character row rather than trusted from the request. A target that
 * lives inside a Local Place additionally verifies that the place genuinely
 * belongs to the character's current World Location, exactly the way Trade
 * does, so a requested place can never be honored from the wrong position.
 */
async function repairPreflight(
  transaction: DatabaseTransaction,
  characterId: string,
  targetId: RepairTargetId,
  action: { actionId: string } | undefined,
): Promise<RepairRefusal | undefined> {
  const definition = getRepairTarget(targetId);
  if (!definition) {
    return {
      status: "refused",
      reason: "unknown_target",
      message: "That is not something you can repair.",
    };
  }
  if (action?.actionId === ACTION_IDS.travel) {
    return {
      status: "refused",
      reason: "in_transit",
      message: `${definition.displayName} repair is unavailable while traveling.`,
    };
  }
  if (action) {
    return {
      status: "refused",
      reason: "in_transit",
      message: "Finish the active activity first.",
    };
  }
  const rows = await transaction
    .select({ currentLocationId: characters.currentLocationId })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  const currentLocationId = rows[0]?.currentLocationId;
  if (currentLocationId !== definition.locationId) {
    return {
      status: "refused",
      reason: "wrong_location",
      message: `${definition.displayName} repair is only available while you are there.`,
    };
  }
  if (
    definition.localPlaceId &&
    !getLocalPlaceInLocation(currentLocationId, definition.localPlaceId)
  ) {
    return {
      status: "refused",
      reason: "wrong_location",
      message: `${definition.displayName} repair is only available while you are there.`,
    };
  }
  return undefined;
}

/**
 * Contribute carried materials toward one repair target.
 *
 * Contribution is partial and incremental by design: whatever is carried, up
 * to what the recipe still needs, is consumed through the canonical carried
 * stack boundary in the same transaction that records it. The client supplies
 * only what it believed the useful quantities were, and a mismatch refuses
 * rather than silently consuming a different amount.
 */
export async function contributeRepairMaterials(
  userId: string,
  characterId: string,
  request: RepairMaterialContributionRequest,
  now = new Date(),
  random: MiningRandom = SILENT_RANDOM,
): Promise<RepairStateResult<RepairContributionStatus>> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      const balance = getEffectiveGameBalance();
      const refused = async (
        refusal: RepairRefusal,
      ): Promise<RepairStateResult<RepairRefusal>> => ({
        state: await stateAfterRepairCommand(transaction, context.character.id, now),
        repair: refusal,
      });

      const preflight = await repairPreflight(
        transaction,
        context.character.id,
        request.targetId,
        context.action,
      );
      if (preflight) return refused(preflight);

      // Reading never creates: a target nobody has legitimately worked on stays
      // an absent row, so a refusal here leaves persistence exactly as it found
      // it. The row is created below, in the same transaction as the first
      // contribution that earns it.
      const row = await loadRepairTargetRow(transaction, context.character.id, request.targetId);
      const repair = repairStateFromRow(row);
      const access = await loadRepairAccess(
        transaction,
        context.character.id,
        request.targetId,
        repair,
      );
      if (!access.repairAvailable) {
        return refused({
          status: "refused",
          reason: "repair_locked",
          message: "You have no reason to work on that yet.",
        });
      }
      if (access.complete) {
        return refused({
          status: "refused",
          reason: "repair_complete",
          message: "That repair is already finished.",
        });
      }

      const target = getRepairTargetBalance(request.targetId, balance);
      const stacks = await transaction
        .select()
        .from(inventoryStacks)
        .where(eq(inventoryStacks.characterId, context.character.id))
        .orderBy(asc(inventoryStacks.createdAt), asc(inventoryStacks.id))
        .for("update");
      // One carried tally covers whatever this recipe wants, so a Power Cell
      // requirement needs no second special-cased count (#209).
      const carried: Record<string, number> = {};
      for (const stack of stacks) {
        carried[stack.itemId] = (carried[stack.itemId] ?? 0) + stack.quantity;
      }
      const useful = planRepairMaterialContribution({ repair, carried, target });
      // The client's belief must match the recomputed plan exactly, in both
      // directions, so a stale surface can never commit a different amount.
      const expected = request.expectedMaterials;
      const expectedKeys = Object.keys(expected).filter((itemId) => (expected[itemId] ?? 0) > 0);
      const usefulKeys = Object.keys(useful);
      const matches =
        expectedKeys.length === usefulKeys.length &&
        usefulKeys.every((itemId) => expected[itemId] === useful[itemId]);
      if (!matches) {
        return refused({
          status: "refused",
          reason: "materials_changed",
          message: "Repair materials changed. Review the useful quantities and try again.",
        });
      }
      if (contributionIsEmpty(useful)) {
        return refused({
          status: "refused",
          reason: "nothing_to_contribute",
          message: "Nothing you are carrying is still needed for this repair.",
        });
      }

      await ensureRepairTargetState(transaction, context.character.id, request.targetId);
      for (const [itemId, quantity] of Object.entries(useful)) {
        const removal = await consumeStackableItem(transaction, {
          characterId: context.character.id,
          itemId,
          quantity,
          now,
        });
        if (!removal.ok) throw new Error("Contribution removal became invalid");
      }
      // One atomic row update for the whole contribution. The row was selected
      // FOR UPDATE above, so a retried or concurrent contribution serializes
      // behind this write rather than double-removing carried items.
      await transaction
        .update(characterRepairTargets)
        .set({
          materials: applyRepairMaterialContribution(repair, useful),
          updatedAt: now,
        })
        .where(
          and(
            eq(characterRepairTargets.characterId, context.character.id),
            eq(characterRepairTargets.targetId, request.targetId),
          ),
        );
      return {
        state: await stateAfterRepairCommand(transaction, context.character.id, now),
        repair: { status: "committed" as const, materials: useful },
      };
    },
    now,
  );
}

/** Begin Welding on one repair target. Idempotent for the same target. */
export async function startWelding(
  userId: string,
  characterId: string,
  targetId: RepairTargetId,
  now = new Date(),
  random: MiningRandom = SILENT_RANDOM,
): Promise<PlayGameplayState> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      const balance = getEffectiveGameBalance();
      const target = getRepairTargetBalance(targetId, balance);
      if (context.action?.actionId === target.actionId) {
        return stateAfterRepairCommand(transaction, context.character.id, now);
      }
      if (context.action) {
        return stateAfterRepairCommand(
          transaction,
          context.character.id,
          now,
          undefined,
          "another_action_active",
        );
      }
      const preflight = await repairPreflight(
        transaction,
        context.character.id,
        targetId,
        undefined,
      );
      if (preflight) {
        return stateAfterRepairCommand(
          transaction,
          context.character.id,
          now,
          "welding_unavailable_here",
        );
      }

      // As with contribution: a refused start must not leave a row behind, so
      // the state is read without being created and only materialized once the
      // work is genuinely starting. Welding cannot begin before the materials
      // are in, so a target with no row always refuses here anyway.
      const row = await loadRepairTargetRow(transaction, context.character.id, targetId);
      const repair = repairStateFromRow(row);
      const access = await loadRepairAccess(transaction, context.character.id, targetId, repair);
      if (access.complete) {
        return stateAfterRepairCommand(transaction, context.character.id, now, "repair_complete");
      }
      if (!access.repairAvailable || !repairMaterialsComplete(repair, target)) {
        return stateAfterRepairCommand(transaction, context.character.id, now, "welding_locked");
      }
      // The Welding resolver requires the row, so it exists before the action.
      await ensureRepairTargetState(transaction, context.character.id, targetId);
      // This repair's two Clean Pass opportunities are rolled the first time
      // anybody welds on it, and never again (#190).
      await ensureRepairCleanPassRoll(transaction, {
        characterId: context.character.id,
        targetId,
        random,
        now,
      });
      await transaction.insert(activeActions).values({
        characterId: context.character.id,
        actionId: target.actionId,
        startedAt: now,
        resolvedThroughAt: now,
      });
      return stateAfterRepairCommand(transaction, context.character.id, now);
    },
    now,
  );
}

/** Stop Welding on one repair target. Resolved work is already committed. */
export async function stopWelding(
  userId: string,
  characterId: string,
  targetId: RepairTargetId,
  now = new Date(),
  random: MiningRandom = SILENT_RANDOM,
): Promise<PlayGameplayState> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      const target = getRepairTargetBalance(targetId);
      if (context.action?.actionId === target.actionId) {
        // An open Clean Pass window is spent by stopping, so resuming this same
        // repair later cannot resurrect it (#190).
        await missOpenRepairCleanPass(transaction, {
          characterId: context.character.id,
          targetId,
          now,
        });
        await transaction
          .delete(activeActions)
          .where(eq(activeActions.characterId, context.character.id));
        return stateAfterRepairCommand(transaction, context.character.id, now);
      }
      return stateAfterRepairCommand(
        transaction,
        context.character.id,
        now,
        undefined,
        context.action ? "another_action_active" : undefined,
      );
    },
    now,
  );
}
