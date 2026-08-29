import { and, eq, isNull } from "drizzle-orm";
import type { DatabaseTransaction, ResolvedCharacterContext } from "@/server/action-resolution";
import {
  characterMissions,
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
import {
  getMission,
  MISSIONS,
  type MissionDefinition,
  type MissionRequirement,
} from "@/game/content/missions";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { getNpc } from "@/game/content/npcs";
import { deriveEquipmentLoadout, isCompatibleEquipmentAssignment } from "@/game/domain/equipment";
import {
  planExactStackRemoval,
  planUniqueItemAddition,
  type ExactStackRemovalPlan,
} from "@/game/domain/inventory";
import type { MissionObservation } from "@/game/domain/missions";
import type { MiningRandom } from "@/game/domain/mining";
import { withResolvedOwnedCharacter } from "@/server/action-resolution";
import {
  createPlayResolver,
  defaultMiningRandom,
  ensureStarterMiningState,
  stateFromTransaction,
  type MiningGameplayState,
} from "@/server/mining";
import { grantCharacterSkillXp } from "@/server/progression";
import { applyStackRemovalPlan, loadOwnedItemInstances } from "@/server/carried-inventory";

export type MissionAcceptance =
  | { status: "accepted" | "already_accepted" | "already_completed" }
  | { status: "refused"; message: string };

export type MissionCompletion =
  | {
      status: "completed" | "already_completed";
      reward?: { itemId: string; quantity: 1; itemInstanceId?: string };
    }
  | {
      status: "refused";
      reason:
        | "not_accepted"
        | "not_stationary"
        | "wrong_npc"
        | "prerequisite"
        | "equipment"
        | "insufficient_items"
        | "capacity";
      capacityReason?: "slots" | "mass";
      message: string;
    };

export type MissionAcceptanceResult = {
  state: MiningGameplayState;
  mission: MissionAcceptance;
};

export type MissionCompletionResult = {
  state: MiningGameplayState;
  mission: MissionCompletion;
};

type CommandOutcome = { successes: number; failures: number; awardedXp: number };

function locationName(locationId: string): string {
  return getLocation(locationId)?.displayName ?? "the required location";
}

async function currentLocation(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<string> {
  const row = (
    await transaction
      .select({ currentLocationId: characters.currentLocationId })
      .from(characters)
      .where(eq(characters.id, characterId))
      .limit(1)
  )[0];
  return row?.currentLocationId ?? LOCATION_IDS.crashSite;
}

type MissionRows = readonly (typeof characterMissions.$inferSelect)[];

function missionRow(rows: MissionRows, missionId: string) {
  return rows.find((row) => row.missionId === missionId);
}

/**
 * Runs one mission command through the shared character lock/reconciliation
 * boundary and hands the command a `stateFor` factory that projects the full
 * play state from the transaction, including any Mining/Refining work that
 * was resolved inside the same transaction.
 */
async function runMissionCommand<Mission extends MissionAcceptance | MissionCompletion>(
  userId: string,
  characterId: string,
  now: Date,
  random: MiningRandom,
  command: (input: {
    transaction: DatabaseTransaction;
    context: ResolvedCharacterContext;
    stateFor: (mission: Mission) => Promise<{ state: MiningGameplayState; mission: Mission }>;
  }) => Promise<{ state: MiningGameplayState; mission: Mission }>,
): Promise<{ state: MiningGameplayState; mission: Mission }> {
  let miningOutcome: CommandOutcome | undefined;
  let refiningOutcome: CommandOutcome | undefined;
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(
      random,
      (outcome) => {
        miningOutcome = outcome;
      },
      undefined,
      (outcome) => {
        refiningOutcome = outcome;
      },
    ),
    async (transaction, context) =>
      command({
        transaction,
        context,
        stateFor: async (mission) => ({
          state: await stateFromTransaction(
            transaction,
            context.character.id,
            miningOutcome ?? { successes: 0, failures: 0, awardedXp: 0 },
            undefined,
            undefined,
            undefined,
            undefined,
            now,
            refiningOutcome ?? { successes: 0, failures: 0, awardedXp: 0 },
          ),
          mission,
        }),
      }),
    now,
  );
}

/**
 * Generic mission acceptance. The browser supplies only narrow command
 * identity/intent (character, mission, NPC); every rule is revalidated
 * server-side inside the character lock from the authored definition:
 * prerequisite, authored offer route, and stationary presence at that offer's
 * location. Acceptance is idempotent.
 */
export async function acceptMission(
  userId: string,
  characterId: string,
  missionId: string,
  npcId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<MissionAcceptanceResult> {
  return runMissionCommand<MissionAcceptance>(
    userId,
    characterId,
    now,
    random,
    async ({ transaction, context, stateFor }) => {
      await ensureStarterMiningState(transaction, context.character.id);
      const definition = getMission(missionId);
      if (!definition) {
        return stateFor({ status: "refused", message: "Unknown mission." });
      }
      const rows = await transaction
        .select()
        .from(characterMissions)
        .where(eq(characterMissions.characterId, context.character.id))
        .for("update");
      const existing = missionRow(rows, definition.id);
      if (existing?.completedAt) return stateFor({ status: "already_completed" });
      if (existing?.acceptedAt) return stateFor({ status: "already_accepted" });

      // Hard prerequisite, rechecked inside the authoritative command.
      if (definition.prerequisiteMissionId) {
        const prerequisite = missionRow(rows, definition.prerequisiteMissionId);
        if (!prerequisite?.completedAt) {
          const prerequisiteDefinition = getMission(definition.prerequisiteMissionId);
          return stateFor({
            status: "refused",
            message: `Complete ${prerequisiteDefinition?.title ?? "the prerequisite mission"} before this mission can begin.`,
          });
        }
      }

      const offer = definition.offers.find((candidate) => candidate.npcId === npcId);
      if (!offer) {
        return stateFor({
          status: "refused",
          message: `${definition.title} cannot be accepted from that person.`,
        });
      }
      const locationId = await currentLocation(transaction, context.character.id);
      if (context.action || locationId !== offer.locationId) {
        return stateFor({
          status: "refused",
          message: `${definition.title} can only be accepted while you are stationary at ${locationName(offer.locationId)}.`,
        });
      }

      await transaction
        .insert(characterMissions)
        .values({
          characterId: context.character.id,
          missionId: definition.id,
          acceptedAt: now,
        })
        .onConflictDoNothing();
      return stateFor({ status: "accepted" });
    },
  );
}

/**
 * Generic authoritative mission completion. Inside the established character
 * transaction/lock boundary this command:
 *
 * 1. re-reads the mission record and validates acceptance/prerequisite;
 * 2. validates the exact turn-in NPC, authored turn-in location, and stationary state;
 * 3. re-reads equipment/inventory and re-evaluates EVERY authored requirement;
 * 4. for each consume_required_quantity carried-stack requirement, builds an
 *    exact pure removal plan through the inventory planner WITHOUT mutating rows;
 * 5. applies those plans cumulatively to an in-memory candidate inventory and
 *    preflights any item reward against the POST-consumPTION candidate
 *    (consumption may legitimately free the slots or mass the reward needs);
 * 6. only after the complete plan is valid, applies removals through the
 *    authoritative carried-stack boundary and applies the single declared
 *    reward and the guarded completion stamp in the same transaction.
 *
 * Shown items (turn-in "show") are inspected, never consumed. The character
 * lock plus the completedAt guard make completion — and therefore consumption
 * and reward — exactly-once under retries and concurrent first completions.
 */
export async function completeMission(
  userId: string,
  characterId: string,
  missionId: string,
  npcId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<MissionCompletionResult> {
  return runMissionCommand<MissionCompletion>(
    userId,
    characterId,
    now,
    random,
    async ({ transaction, context, stateFor }) => {
      await ensureStarterMiningState(transaction, context.character.id);
      const definition = getMission(missionId);
      if (!definition) {
        return stateFor({ status: "refused", reason: "not_accepted", message: "Unknown mission." });
      }
      return completeMissionForDefinition({
        transaction,
        context,
        stateFor,
        definition,
        npcId,
        now,
      });
    },
  );
}

/**
 * Framework-level test seam: runs the EXACT generic completion transaction for
 * an injected definition. Production callers always resolve the definition
 * from the canonical registry via `completeMission`; this entry exists only
 * so integration tests can prove consumed-item semantics (show vs consume,
 * post-consumption reward preflight, rollback) without adding a fake
 * player-visible production quest.
 */
export async function completeMissionWithDefinition(
  userId: string,
  characterId: string,
  definition: MissionDefinition,
  npcId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<MissionCompletionResult> {
  return runMissionCommand<MissionCompletion>(
    userId,
    characterId,
    now,
    random,
    async ({ transaction, context, stateFor }) => {
      await ensureStarterMiningState(transaction, context.character.id);
      return completeMissionForDefinition({
        transaction,
        context,
        stateFor,
        definition,
        npcId,
        now,
      });
    },
  );
}

async function completeMissionForDefinition(input: {
  transaction: DatabaseTransaction;
  context: ResolvedCharacterContext;
  stateFor: (mission: MissionCompletion) => Promise<MissionCompletionResult>;
  definition: MissionDefinition;
  npcId: string;
  now: Date;
}): Promise<MissionCompletionResult> {
  const { transaction, context, stateFor, definition, npcId, now } = input;
  const rows = await transaction
    .select()
    .from(characterMissions)
    .where(eq(characterMissions.characterId, context.character.id))
    .for("update");
  const existing = missionRow(rows, definition.id);
  if (!existing?.acceptedAt) {
    return stateFor({
      status: "refused",
      reason: "not_accepted",
      message: `Accept ${definition.title} first.`,
    });
  }
  if (existing.completedAt) return stateFor({ status: "already_completed" });

  if (definition.prerequisiteMissionId) {
    const prerequisite = missionRow(rows, definition.prerequisiteMissionId);
    if (!prerequisite?.acceptedAt || !prerequisite.completedAt) {
      const prerequisiteDefinition = getMission(definition.prerequisiteMissionId);
      return stateFor({
        status: "refused",
        reason: "prerequisite",
        message: `Complete ${prerequisiteDefinition?.title ?? "the prerequisite mission"} before claiming this reward.`,
      });
    }
  }

  if (npcId !== definition.turnIn.npcId) {
    return stateFor({
      status: "refused",
      reason: "wrong_npc",
      message: `${definition.title} must be completed with ${getNpc(definition.turnIn.npcId)?.displayName ?? "its turn-in contact"}.`,
    });
  }
  const locationId = await currentLocation(transaction, context.character.id);
  if (context.action || locationId !== definition.turnIn.locationId) {
    return stateFor({
      status: "refused",
      reason: "not_stationary",
      message: `${definition.title} can only be completed while you are stationary at ${locationName(definition.turnIn.locationId)}.`,
    });
  }

  const balance = getEffectiveGameBalance();
  const [itemState, assignments, stacks] = await Promise.all([
    loadOwnedItemInstances(transaction, context.character.id),
    transaction
      .select()
      .from(equippedItems)
      .where(eq(equippedItems.characterId, context.character.id))
      .for("update"),
    transaction
      .select()
      .from(inventoryStacks)
      .where(eq(inventoryStacks.characterId, context.character.id))
      .for("update"),
  ]);
  const carriedById = new Map(itemState.carriedInstances.map((i) => [i.id, i.itemId]));
  const observation = buildCompletionObservation(
    assignmentCarriedItemIds(assignments, carriedById),
    stacks,
  );

  // Re-evaluate every authored requirement against live authoritative
  // state, in authored order, so refusals follow objective precedence.
  for (const requirement of definition.requirements) {
    if (requirement.kind === "at_location") {
      if (locationId !== requirement.locationId) {
        return stateFor({
          status: "refused",
          reason: "not_stationary",
          message: `Objective not met: ${requirement.objective}.`,
        });
      }
      continue;
    }
    if (requirement.kind === "equipped_item") {
      if (!equipmentRequirementHolds(requirement, assignments, carriedById)) {
        return stateFor({
          status: "refused",
          reason: "equipment",
          message: `Objective not met: ${renderRequirementCopy(requirement, observation)}.`,
        });
      }
      continue;
    }
    const carried = observation.carriedQuantities.get(requirement.itemId) ?? 0;
    if (carried < resolveRequiredQuantity(requirement, observation)) {
      return stateFor({
        status: "refused",
        reason: "insufficient_items",
        message: `Objective not met: ${renderRequirementCopy(requirement, observation)}.`,
      });
    }
  }

  // Build exact pure removal plans for every consumed carried requirement
  // BEFORE any mutation, applying them cumulatively to an in-memory
  // candidate inventory so the reward preflight sees post-consumption
  // capacity. The candidate preserves stack creation metadata so planning
  // keeps #112's deterministic ordering: quantity, then creation time, then
  // ID.
  const consumptionPlans: Array<Extract<ExactStackRemovalPlan<string>, { ok: true }>> = [];
  let candidateStacks: Array<{
    id: string;
    itemId: string;
    quantity: number;
    createdAt: Date;
  }> = stacks.map((stack) => ({
    id: stack.id,
    itemId: stack.itemId,
    quantity: stack.quantity,
    createdAt: stack.createdAt,
  }));
  for (const requirement of definition.requirements) {
    if (requirement.kind !== "carried_stack") continue;
    if (requirement.turnIn !== "consume_required_quantity") continue;
    const required = resolveRequiredQuantity(requirement, observation);
    const plan = planExactStackRemoval(candidateStacks, requirement.itemId, required);
    if (!plan.ok) {
      return stateFor({
        status: "refused",
        reason: "insufficient_items",
        message: `Objective not met: ${renderRequirementCopy(requirement, observation)}.`,
      });
    }
    consumptionPlans.push(plan);
    candidateStacks = applyRemovalPlanToCandidate(candidateStacks, plan);
  }

  // Preflight the declared reward against the post-consumption candidate
  // inventory. Consumption may legitimately free the slot or mass the
  // reward needs, so the original pre-consumption snapshot must not gate it.
  if (definition.reward.kind === "item") {
    const itemDefinition = getItemDefinition(definition.reward.itemId, balance);
    if (!itemDefinition || itemDefinition.kind !== "unique") {
      throw new Error(`${definition.id} reward is not a unique item definition`);
    }
    const loadout = deriveEquipmentLoadout({
      assignments,
      instances: itemState.carriedInstances,
      stacks: candidateStacks,
      balance,
    });
    const capacity = planUniqueItemAddition({
      inventorySlotsUsed: loadout.inventorySlotsUsed,
      slotCapacity: loadout.containerSlotCapacity,
      carriedMassGrams: loadout.carriedMassGrams,
      maximumCarryCapacityGrams: loadout.maximumCarryCapacityGrams,
      itemMassGrams: itemDefinition.massGrams,
    });
    if (!capacity.ok) {
      const rewardName =
        resolveItemPresentation(definition.reward.itemId, definition.reward.itemId).displayName ??
        definition.reward.itemId;
      return stateFor({
        status: "refused",
        reason: "capacity",
        capacityReason: capacity.reason,
        message:
          capacity.reason === "slots"
            ? `${rewardName} needs one free carried Inventory slot. Free capacity and try again.`
            : `${rewardName} is too heavy for your current carried-mass capacity. Free capacity and try again.`,
      });
    }
  }

  // The complete plan is valid — apply consumption through the
  // authoritative carried-stack boundary, then the reward, then the
  // guarded completion stamp, all inside this transaction. Any failure
  // rolls the entire transaction back.
  for (const plan of consumptionPlans) {
    await applyStackRemovalPlan(transaction, {
      characterId: context.character.id,
      plan,
      now,
    });
  }

  let rewardInfo: { itemId: string; quantity: 1; itemInstanceId?: string } | undefined;
  if (definition.reward.kind === "item") {
    // Initial charge derives from the item's authored charge capacity —
    // chargeable items are granted depleted (charge is earned through the
    // Power Cell gameplay), items without a charge state get the schema's
    // null representation. The boundary never silently asserts charge
    // semantics for a future unique item that authors none.
    const maximumCharge = getItemMaximumCharge(definition.reward.itemId);
    const created = await transaction
      .insert(itemInstances)
      .values({
        characterId: context.character.id,
        itemId: definition.reward.itemId,
        currentCharge: maximumCharge === undefined ? null : 0,
      })
      .returning({ id: itemInstances.id });
    const instance = created[0];
    if (!instance) throw new Error(`${definition.id} item reward was not created`);
    rewardInfo = { itemId: definition.reward.itemId, quantity: 1, itemInstanceId: instance.id };
  } else {
    const thresholds = skillLevelThresholds(definition.reward.skillId);
    if (!thresholds) {
      throw new Error(`${definition.id} reward skill has no approved progression curve`);
    }
    await grantCharacterSkillXp(transaction, {
      characterId: context.character.id,
      skillId: definition.reward.skillId,
      awardedXp: definition.reward.amount,
      thresholds,
    });
  }

  await transaction
    .update(characterMissions)
    .set({ completedAt: now })
    .where(
      and(
        eq(characterMissions.characterId, context.character.id),
        eq(characterMissions.missionId, definition.id),
        isNull(characterMissions.completedAt),
      ),
    );
  return stateFor({ status: "completed", reward: rewardInfo });
}

/**
 * Resolves the authoritative required quantity for a carried requirement:
 * explicit authored quantity, or the canonical full-stack limit from the item
 * definition (never quest-duplicated balance).
 */
function resolveRequiredQuantity(
  requirement: Extract<MissionRequirement, { kind: "carried_stack" }>,
  observation: MissionObservation,
): number {
  if (requirement.quantity !== undefined) return requirement.quantity;
  return observation.stackLimits.get(requirement.itemId) ?? 1;
}

function renderRequirementCopy(
  requirement: MissionRequirement,
  observation: MissionObservation,
): string {
  if (requirement.kind === "at_location") return requirement.objective;
  const itemName = observation.itemNames.get(requirement.itemId) ?? requirement.itemId;
  if (requirement.kind === "equipped_item") {
    return requirement.objective.replace("{item}", itemName);
  }
  const required = resolveRequiredQuantity(requirement, observation);
  const carried = Math.min(observation.carriedQuantities.get(requirement.itemId) ?? 0, required);
  return requirement.objective
    .replace("{item}", itemName)
    .replace("{carried}", String(carried))
    .replace("{required}", String(required));
}

/**
 * Authoritative equipment check through the equipment SSOT: the item must
 * genuinely occupy an approved compatible assignment slot on a carried
 * instance. Compatibility data is never duplicated in mission content.
 */
function equipmentRequirementHolds(
  requirement: Extract<MissionRequirement, { kind: "equipped_item" }>,
  assignments: readonly {
    assignmentKind: string;
    suitSlotId: string;
    itemInstanceId: string;
  }[],
  carriedItemByInstanceId: ReadonlyMap<string, string>,
): boolean {
  const balance = getEffectiveGameBalance();
  return assignments.some(
    (assignment) =>
      carriedItemByInstanceId.get(assignment.itemInstanceId) === requirement.itemId &&
      isCompatibleEquipmentAssignment(
        requirement.itemId,
        {
          assignmentKind: assignment.assignmentKind as "gear" | "container",
          suitSlotId: assignment.suitSlotId,
        },
        balance,
      ),
  );
}

function assignmentCarriedItemIds(
  assignments: readonly { itemInstanceId: string }[],
  carriedById: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  return new Set(
    assignments
      .map((assignment) => carriedById.get(assignment.itemInstanceId))
      .filter((itemId): itemId is string => itemId !== undefined),
  );
}

/** Completion-time observation built from the freshly locked inventory state. */
function buildCompletionObservation(
  equippedCarriedIds: ReadonlySet<string>,
  stacks: readonly { itemId: string; quantity: number }[],
): MissionObservation {
  const balance = getEffectiveGameBalance();
  const carriedQuantities = new Map<string, number>();
  for (const stack of stacks) {
    carriedQuantities.set(
      stack.itemId,
      (carriedQuantities.get(stack.itemId) ?? 0) + stack.quantity,
    );
  }
  const stackLimits = new Map<string, number>();
  const itemNames = new Map<string, string>();
  const observedItemIds = new Set<string>([
    ...equippedCarriedIds,
    ...carriedQuantities.keys(),
    ...MISSIONS.flatMap((mission) =>
      mission.requirements
        .filter(
          (requirement): requirement is Extract<MissionRequirement, { itemId: string }> =>
            requirement.kind !== "at_location",
        )
        .map((requirement) => requirement.itemId),
    ),
  ]);
  for (const itemId of observedItemIds) {
    const displayName = resolveItemPresentation(itemId, itemId).displayName;
    if (displayName && displayName !== itemId) itemNames.set(itemId, displayName);
    const definition = getItemDefinition(itemId, balance);
    if (definition?.kind === "stack") stackLimits.set(itemId, definition.stackLimit);
  }
  return { equippedItemIds: equippedCarriedIds, carriedQuantities, stackLimits, itemNames };
}

/** Applies one pure removal plan to an in-memory candidate stack list. */
function applyRemovalPlanToCandidate<
  Stack extends { id: string; itemId: string; quantity: number },
>(candidateStacks: Stack[], plan: Extract<ExactStackRemovalPlan<string>, { ok: true }>): Stack[] {
  const deleted = new Set(plan.deletedStackIds);
  const updates = new Map(plan.updatedStacks.map((update) => [update.id, update.quantity]));
  return candidateStacks
    .filter((stack) => !deleted.has(stack.id))
    .map((stack) =>
      updates.has(stack.id) ? { ...stack, quantity: updates.get(stack.id)! } : stack,
    );
}
