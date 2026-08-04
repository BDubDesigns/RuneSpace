import { randomInt } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  characterMiningState,
  characterPowerCellDailyClaims,
  characterSkillXp,
  characterStarterProvisioning,
  characters,
  characterTravelState,
  equippedItems,
  inventoryStacks,
  itemInstances,
} from "@/db/rune-space";
import { getEffectiveGameBalance, miningLevelThresholds } from "@/game/config/balance";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { isActionAvailableAtLocation } from "@/game/content/locations";
import { ACTION_IDS, ITEM_IDS, LOCATION_IDS, SKILL_IDS } from "@/game/config/foundations";
import { POWER_ANNEX_REWARD_SOURCE_ID, pacificResetDate } from "@/game/domain/power-annex";
import { powerAnnexNow } from "@/server/power-annex-clock";
import {
  carriedItemMassGrams,
  deriveEquipmentLoadout,
  isCompatibleEquipmentAssignment,
  type EquipmentLoadout,
  type EquipmentTarget,
} from "@/game/domain/equipment";
import { type StackState, deriveCarriedUniqueItems } from "@/game/domain/inventory";
import {
  miningSuccessChanceBps,
  miningPreflightStopReason,
  normalizeCutterCharge,
  boostedMiningAttemptDurationTicks,
  resolveCrashSiteMining,
  type MiningRandom,
  type MiningResolution,
  type MiningStopReason,
} from "@/game/domain/mining";
import { levelFromXp, skillLevelProgress } from "@/game/domain/progression";
import { adjacentWalkDurationTicks, planTravel } from "@/game/domain/travel";
import { ticksToMilliseconds } from "@/game/domain/timing";
import {
  type ActionResolver,
  type DatabaseTransaction,
  withResolvedOwnedCharacter,
} from "@/server/action-resolution";
import { createTravelResolver, type TravelResolution, type TravelSnapshot } from "@/server/travel";
import { grantCharacterSkillXp } from "@/server/progression";

const systemRandom: MiningRandom = {
  nextBasisPoints: () => randomInt(10_000),
  nextUnit: () => randomInt(2) / 2,
};

/**
 * CI-only deterministic source for the focused browser journey. It is selected
 * only by explicit CI configuration, never by a request or normal runtime user.
 */
function e2eMiningRandom(): MiningRandom {
  let attemptIndex = 0;
  return {
    nextBasisPoints: () => [0, 3_500][attemptIndex++ % 2]!,
    nextUnit: () => 0,
  };
}

export function defaultMiningRandom(): MiningRandom {
  const databaseHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : "";
  return process.env.CI === "true" &&
    process.env.RUNESPACE_E2E_MINING === "true" &&
    (databaseHost === "localhost" || databaseHost === "127.0.0.1")
    ? e2eMiningRandom()
    : systemRandom;
}

type MiningSnapshot = {
  miningLevel: number;
  hasCompatibleTool: boolean;
  existingStacks: readonly StackState<string>[];
  slotsAvailable: number;
  massAvailableGrams: number;
  slotsUsed: number;
  slotCapacity: number;
  equipmentLoadout: EquipmentLoadout;
  itemInstances: readonly {
    id: string;
    itemId: string;
    currentCharge: number | null;
    createdAt: Date;
  }[];
  equippedCutterInstanceId?: string;
  cutterCharge: number;
};

type PersistedMiningOutcome = MiningResolution<string> & {
  characterId: string;
  cutterInstanceId?: string;
  cutterChargeBefore: number;
  attemptResolvedAt: readonly string[];
};

export type MiningRunAttempt = {
  sequence: number;
  resolvedAt: string;
  success: boolean;
  rolledBasisPoints: number;
  thresholdBasisPoints: number;
  shaleAwarded: number;
  xpAwarded: number;
  boosted: boolean;
  durationTicks: number;
  chargeConsumed: boolean;
  remainingCharge: number;
};

type MiningRunState = {
  attempts: number;
  successes: number;
  failures: number;
  shaleGained: number;
  xpGained: number;
  recentAttempts: readonly MiningRunAttempt[];
};

export type MiningGameplayState = {
  characterId: string;
  activeAction?: {
    actionId: string;
    resolvedThroughAt: string;
    nextAttemptAt: string;
    progressStartedAt: string;
    nextAttemptBoosted: boolean;
    nextAttemptDurationTicks: number;
  };
  mining: { totalXp: number; level: number; xpToNextLevel?: number; xpIntoLevel: number };
  successChanceBps: number;
  ferriteShaleQuantity: number;
  inventory: {
    slotsUsed: number;
    slotsAvailable: number;
    massGrams: number;
    capacityGrams: number;
    stacks: readonly {
      id: string;
      itemId: string;
      name: string;
      quantity: number;
      stackLimit: number;
    }[];
    uniqueItems: readonly {
      id: string;
      itemId: string;
      name: string;
      massGrams: number;
      /** Present only for items with approved displayable persistent state. */
      currentCharge?: number;
    }[];
  };
  equipment: {
    aggregateContainerSlots: number;
    carriedPowerCellQuantity: number;
    salvageCutter?: {
      currentCharge: number;
      maximumCharge: number;
      boostedAttemptDurationTicks: number;
    };
    slots: readonly {
      target: EquipmentTarget;
      label: string;
      item?: { itemInstanceId: string; itemId: string; name: string; massGrams: number };
      eligibleItems: readonly {
        itemInstanceId: string;
        itemId: string;
        name: string;
        massGrams: number;
      }[];
    }[];
  };
  run: MiningRunState;
  recentResult: { successes: number; failures: number; awardedXp: number };
  stoppingReason?: MiningStopReason;
  commandError?: "another_action_active";
  /** Authoritative persistent current location (stable ID from the registry). */
  location: { currentLocationId: string };
  /** Present only while the character is in transit (server-authoritative). */
  travelState?: {
    originLocationId: string;
    destinationLocationId: string;
    startedAt: string;
    arrivesAt: string;
  };
  /** Current Pacific-day claim state, only when the character is at the Annex. */
  powerAnnex?: { resetDate: string; claimed: boolean };
  /** Set when a begin-travel command was refused by the authoritative rules. */
  travelError?:
    | "unknown_destination"
    | "same_location"
    | "not_adjacent"
    | "already_traveling"
    | "mining_unavailable_here";
};

export async function ensureStarterMiningState(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<void> {
  const balance = getEffectiveGameBalance();
  const marker = await transaction
    .insert(characterStarterProvisioning)
    .values({ characterId })
    .onConflictDoNothing({ target: characterStarterProvisioning.characterId })
    .returning({ characterId: characterStarterProvisioning.characterId });
  if (!marker[0]) return;

  await transaction
    .insert(characterSkillXp)
    .values([
      { characterId, skillId: SKILL_IDS.mining, totalXp: 0 },
      { characterId, skillId: SKILL_IDS.strength, totalXp: 0 },
    ])
    .onConflictDoNothing();
  await transaction
    .insert(characterMiningState)
    .values({ characterId })
    .onConflictDoNothing({ target: characterMiningState.characterId });
  const instances = await transaction
    .select()
    .from(itemInstances)
    .where(eq(itemInstances.characterId, characterId))
    .for("update");
  const assignments = await transaction
    .select()
    .from(equippedItems)
    .where(eq(equippedItems.characterId, characterId))
    .for("update");
  const equippedIds = new Set(assignments.map((assignment) => assignment.itemInstanceId));
  const hasCutter = assignments.some(
    (assignment) =>
      assignment.assignmentKind === "gear" &&
      instances.some(
        (instance) =>
          instance.id === assignment.itemInstanceId &&
          isCompatibleEquipmentAssignment(instance.itemId, assignment, balance),
      ),
  );
  if (
    !hasCutter &&
    !assignments.some(
      (assignment) =>
        assignment.assignmentKind === "gear" &&
        assignment.suitSlotId === balance.items.salvageCutter.suitSlotId,
    )
  ) {
    let cutter = instances.find(
      (instance) =>
        instance.itemId === balance.items.salvageCutter.itemId && !equippedIds.has(instance.id),
    );
    if (!cutter) {
      cutter = (
        await transaction
          .insert(itemInstances)
          .values({ characterId, itemId: balance.items.salvageCutter.itemId, currentCharge: 0 })
          .returning()
      )[0]!;
    }
    await transaction.insert(equippedItems).values({
      characterId,
      assignmentKind: "gear",
      suitSlotId: balance.items.salvageCutter.suitSlotId,
      itemInstanceId: cutter.id,
    });
  }
  const hasContainer = assignments.some((assignment) =>
    instances.some(
      (instance) =>
        instance.id === assignment.itemInstanceId &&
        isCompatibleEquipmentAssignment(instance.itemId, assignment, balance) &&
        assignment.assignmentKind === "container",
    ),
  );
  if (!hasContainer) {
    const availableSlot = balance.carrying.containerSuitSlotIds.find(
      (slot) =>
        !assignments.some(
          (assignment) =>
            assignment.assignmentKind === "container" && assignment.suitSlotId === slot,
        ),
    );
    if (availableSlot) {
      let container = instances.find(
        (instance) =>
          instance.itemId === balance.items.starterContainer.itemId &&
          !equippedIds.has(instance.id),
      );
      if (!container) {
        container = (
          await transaction
            .insert(itemInstances)
            .values({ characterId, itemId: balance.items.starterContainer.itemId })
            .returning()
        )[0]!;
      }
      await transaction.insert(equippedItems).values({
        characterId,
        assignmentKind: "container",
        suitSlotId: availableSlot,
        itemInstanceId: container.id,
      });
    }
  }
}

async function loadMiningSnapshot(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<MiningSnapshot> {
  const balance = getEffectiveGameBalance();
  const [xpRows, stacks, instances, assignments] = await Promise.all([
    transaction
      .select()
      .from(characterSkillXp)
      .where(eq(characterSkillXp.characterId, characterId))
      .for("update"),
    transaction
      .select()
      .from(inventoryStacks)
      .where(eq(inventoryStacks.characterId, characterId))
      .for("update"),
    transaction
      .select()
      .from(itemInstances)
      .where(eq(itemInstances.characterId, characterId))
      .for("update"),
    transaction
      .select()
      .from(equippedItems)
      .where(eq(equippedItems.characterId, characterId))
      .for("update"),
  ]);
  const miningXp = xpRows.find((row) => row.skillId === SKILL_IDS.mining)?.totalXp ?? 0;
  const equipmentLoadout = deriveEquipmentLoadout({
    assignments,
    instances,
    stacks,
    balance,
  });
  const cutterAssignment = assignments.find(
    (assignment) =>
      assignment.assignmentKind === "gear" &&
      assignment.suitSlotId === balance.items.salvageCutter.suitSlotId,
  );
  const cutter = cutterAssignment
    ? instances.find(
        (instance) =>
          instance.id === cutterAssignment.itemInstanceId &&
          instance.itemId === balance.items.salvageCutter.itemId,
      )
    : undefined;
  return {
    miningLevel: levelFromXp(miningXp, miningLevelThresholds(balance)),
    hasCompatibleTool: equipmentLoadout.hasCompatibleMiningTool,
    existingStacks: stacks,
    slotsAvailable: Math.max(
      0,
      equipmentLoadout.containerSlotCapacity - equipmentLoadout.inventorySlotsUsed,
    ),
    massAvailableGrams: Math.max(
      0,
      equipmentLoadout.maximumCarryCapacityGrams - equipmentLoadout.carriedMassGrams,
    ),
    slotsUsed: equipmentLoadout.inventorySlotsUsed,
    slotCapacity: equipmentLoadout.containerSlotCapacity,
    equipmentLoadout,
    itemInstances: instances,
    equippedCutterInstanceId: cutter?.id,
    cutterCharge: normalizeCutterCharge(cutter?.currentCharge, balance),
  };
}

export function createMiningResolver(
  random: MiningRandom,
  onOutcome?: (outcome: PersistedMiningOutcome) => void,
): ActionResolver<MiningSnapshot, PersistedMiningOutcome> {
  return {
    supports: (action) => action.actionId === ACTION_IDS.crashSiteMining,
    load: async (transaction, { character }) => loadMiningSnapshot(transaction, character.id),
    resolve: ({ action, snapshot, window }) => {
      const resolved = resolveCrashSiteMining({
        elapsedTicks: window.elapsedTicks,
        snapshot,
        balance: getEffectiveGameBalance(),
        random,
      });
      let cumulativeAttemptTicks = 0;
      const outcome: PersistedMiningOutcome = {
        characterId: action.characterId,
        ...resolved,
        cutterInstanceId: snapshot.equippedCutterInstanceId,
        cutterChargeBefore: snapshot.cutterCharge,
        attemptResolvedAt: resolved.attempts.map((_, index) =>
          new Date(
            window.startsAt.getTime() +
              ticksToMilliseconds(
                (cumulativeAttemptTicks += resolved.attempts[index]!.durationTicks),
              ),
          ).toISOString(),
        ),
      };
      return {
        outcome,
        transition: outcome.stopReason
          ? { kind: "stop", consumedTicks: outcome.consumedTicks }
          : { kind: "continue", consumedTicks: outcome.consumedTicks },
      };
    },
    persist: async (transaction, outcome) => {
      if (
        outcome.cutterInstanceId &&
        outcome.remainingCutterCharge !== outcome.cutterChargeBefore
      ) {
        await transaction
          .update(itemInstances)
          .set({ currentCharge: outcome.remainingCutterCharge, updatedAt: new Date() })
          .where(
            and(
              eq(itemInstances.id, outcome.cutterInstanceId),
              eq(itemInstances.characterId, outcome.characterId),
            ),
          );
      }
      if (outcome.awardedXp > 0)
        await grantCharacterSkillXp(transaction, {
          characterId: outcome.characterId,
          skillId: SKILL_IDS.mining,
          awardedXp: outcome.awardedXp,
          thresholds: miningLevelThresholds(),
        });
      for (const update of outcome.stackUpdates)
        await transaction
          .update(inventoryStacks)
          .set({ quantity: update.quantity, updatedAt: new Date() })
          .where(eq(inventoryStacks.id, update.id));
      if (outcome.createdStacks.length)
        await transaction.insert(inventoryStacks).values(
          outcome.createdStacks.map((stack) => ({
            characterId: outcome.characterId,
            itemId: stack.itemId,
            quantity: stack.quantity,
          })),
        );
      if (outcome.attempts.length) {
        const state = (
          await transaction
            .select()
            .from(characterMiningState)
            .where(eq(characterMiningState.characterId, outcome.characterId))
            .for("update")
        )[0];
        if (!state) throw new Error("Mining state must exist before resolution");
        const existing = state.recentAttempts as MiningRunAttempt[];
        const firstSequence = state.runAttempts + 1;
        const appended = outcome.attempts.map((attempt, index) => ({
          sequence: firstSequence + index,
          resolvedAt: outcome.attemptResolvedAt[index]!,
          ...attempt,
        }));
        const recentAttempts = [...existing, ...appended].slice(-10);
        await transaction
          .update(characterMiningState)
          .set({
            runAttempts: state.runAttempts + outcome.attempts.length,
            runSuccesses: state.runSuccesses + outcome.successes,
            runShaleGained:
              state.runShaleGained +
              appended.reduce((total, attempt) => total + attempt.shaleAwarded, 0),
            runXpGained: state.runXpGained + outcome.awardedXp,
            recentAttempts,
            updatedAt: new Date(),
          })
          .where(eq(characterMiningState.characterId, outcome.characterId));
      }
      if (outcome.stopReason)
        await transaction
          .insert(characterMiningState)
          .values({ characterId: outcome.characterId, lastStopReason: outcome.stopReason })
          .onConflictDoUpdate({
            target: characterMiningState.characterId,
            set: { lastStopReason: outcome.stopReason, updatedAt: new Date() },
          });
      onOutcome?.(outcome);
    },
  };
}

export function createPlayResolver(
  random: MiningRandom,
  onMiningOutcome?: (outcome: PersistedMiningOutcome) => void,
  onTravelArrival?: (outcome: TravelResolution) => void,
): ActionResolver<MiningSnapshot | TravelSnapshot, PersistedMiningOutcome | TravelResolution> {
  const mining = createMiningResolver(random, onMiningOutcome);
  const travel = createTravelResolver();
  return {
    supports: (action) =>
      (mining.supports?.(action) ?? true) || (travel.supports?.(action) ?? true),
    load: (transaction, input) => {
      if (travel.supports?.(input.action)) {
        return travel.load(transaction, input) as Promise<MiningSnapshot | TravelSnapshot>;
      }
      return mining.load(transaction, input) as Promise<MiningSnapshot | TravelSnapshot>;
    },
    resolve: (input) => {
      if (travel.supports?.(input.action)) {
        return travel.resolve(
          input as unknown as Parameters<typeof travel.resolve>[0],
        ) as unknown as ReturnType<typeof mining.resolve>;
      }
      return mining.resolve(
        input as unknown as Parameters<typeof mining.resolve>[0],
      ) as unknown as ReturnType<typeof mining.resolve>;
    },
    persist: (transaction, outcome, context) => {
      if ((outcome as TravelResolution).arrived !== undefined) {
        return travel.persist(transaction, outcome as TravelResolution, context);
      }
      return mining.persist(transaction, outcome as PersistedMiningOutcome);
    },
  };
}

export async function stateFromTransaction(
  transaction: DatabaseTransaction,
  characterId: string,
  recentResult: MiningGameplayState["recentResult"],
  stoppingReason?: MiningStopReason,
  commandError?: MiningGameplayState["commandError"],
  travelError?: MiningGameplayState["travelError"],
  characterRow?: { currentLocationId: string },
  now = new Date(),
): Promise<MiningGameplayState> {
  const balance = getEffectiveGameBalance();
  const snapshot = await loadMiningSnapshot(transaction, characterId);
  const resetDate = pacificResetDate(powerAnnexNow(now));
  const [xpRows, stacks, actionRows, miningStateRows, travelRows, claimRows, character] =
    await Promise.all([
      transaction
        .select()
        .from(characterSkillXp)
        .where(eq(characterSkillXp.characterId, characterId)),
      transaction
        .select()
        .from(inventoryStacks)
        .where(eq(inventoryStacks.characterId, characterId))
        .orderBy(asc(inventoryStacks.createdAt), asc(inventoryStacks.id)),
      transaction.select().from(activeActions).where(eq(activeActions.characterId, characterId)),
      transaction
        .select()
        .from(characterMiningState)
        .where(eq(characterMiningState.characterId, characterId)),
      transaction
        .select()
        .from(characterTravelState)
        .where(eq(characterTravelState.characterId, characterId)),
      transaction
        .select({ characterId: characterPowerCellDailyClaims.characterId })
        .from(characterPowerCellDailyClaims)
        .where(
          and(
            eq(characterPowerCellDailyClaims.characterId, characterId),
            eq(characterPowerCellDailyClaims.rewardSourceId, POWER_ANNEX_REWARD_SOURCE_ID),
            eq(characterPowerCellDailyClaims.resetDate, resetDate),
          ),
        ),
      characterRow
        ? Promise.resolve([characterRow])
        : transaction.select().from(characters).where(eq(characters.id, characterId)).limit(1),
    ]);
  const totalXp = xpRows.find((row) => row.skillId === SKILL_IDS.mining)?.totalXp ?? 0;
  const thresholds = miningLevelThresholds(balance);
  const miningProgress = skillLevelProgress(totalXp, thresholds);
  const action = actionRows[0];
  const miningState = miningStateRows[0];
  const travel = travelRows[0];
  const run: MiningRunState = {
    attempts: miningState?.runAttempts ?? 0,
    successes: miningState?.runSuccesses ?? 0,
    failures: (miningState?.runAttempts ?? 0) - (miningState?.runSuccesses ?? 0),
    shaleGained: miningState?.runShaleGained ?? 0,
    xpGained: miningState?.runXpGained ?? 0,
    recentAttempts: (miningState?.recentAttempts as MiningRunAttempt[] | undefined) ?? [],
  };
  const currentLocationId = character[0]?.currentLocationId ?? LOCATION_IDS.crashSite;
  const travelState =
    travel && action?.actionId === ACTION_IDS.travel
      ? {
          originLocationId: travel.originLocationId,
          destinationLocationId: travel.destinationLocationId,
          startedAt: action.startedAt.toISOString(),
          arrivesAt: new Date(
            action.startedAt.getTime() + ticksToMilliseconds(adjacentWalkDurationTicks()),
          ).toISOString(),
        }
      : undefined;
  const cutterCharge = snapshot.cutterCharge;
  const nextAttemptBoosted = cutterCharge > 0;
  const nextAttemptDurationTicks = nextAttemptBoosted
    ? boostedMiningAttemptDurationTicks(balance)
    : balance.mining.attemptDurationTicks;
  const carriedPowerCellQuantity = stacks
    .filter((stack) => stack.itemId === ITEM_IDS.powerCell)
    .reduce((total, stack) => total + stack.quantity, 0);
  return {
    characterId,
    location: { currentLocationId },
    travelState,
    powerAnnex:
      currentLocationId === LOCATION_IDS.emergencyPowerAnnex
        ? { resetDate, claimed: claimRows.length > 0 }
        : undefined,
    activeAction:
      action?.actionId === ACTION_IDS.crashSiteMining
        ? {
            actionId: action.actionId,
            resolvedThroughAt: action.resolvedThroughAt.toISOString(),
            progressStartedAt: action.resolvedThroughAt.toISOString(),
            nextAttemptAt: new Date(
              action.resolvedThroughAt.getTime() + ticksToMilliseconds(nextAttemptDurationTicks),
            ).toISOString(),
            nextAttemptBoosted,
            nextAttemptDurationTicks,
          }
        : undefined,
    mining: {
      totalXp,
      level: miningProgress.level,
      xpToNextLevel: miningProgress.xpToNextLevel,
      xpIntoLevel: miningProgress.xpIntoLevel,
    },
    successChanceBps: miningSuccessChanceBps(miningProgress.level, balance),
    ferriteShaleQuantity: stacks
      .filter((stack) => stack.itemId === ITEM_IDS.ferriteShale)
      .reduce((total, stack) => total + stack.quantity, 0),
    inventory: {
      slotsUsed: snapshot.slotsUsed,
      slotsAvailable: snapshot.slotsAvailable,
      massGrams: balance.carrying.startingCapacityGrams - snapshot.massAvailableGrams,
      capacityGrams: balance.carrying.startingCapacityGrams,
      stacks: stacks.map((stack) => ({
        id: stack.id,
        itemId: stack.itemId,
        name: resolveItemPresentation(stack.itemId, stack.itemId).displayName,
        quantity: stack.quantity,
        stackLimit:
          stack.itemId === balance.items.ferriteShale.itemId
            ? balance.items.ferriteShale.stackLimit
            : stack.itemId === balance.items.powerCell.itemId
              ? balance.items.powerCell.stackLimit
              : 1,
      })),
      uniqueItems: deriveCarriedUniqueItems(
        snapshot.itemInstances.map((instance) => ({
          id: instance.id,
          itemId: instance.itemId,
          createdAt: instance.createdAt.toISOString(),
        })),
        snapshot.equipmentLoadout.equippedItemInstanceIds,
      ).map((item) => ({
        id: item.id,
        itemId: item.itemId,
        name: resolveItemPresentation(item.itemId, item.itemId).displayName,
        massGrams: carriedItemMassGrams(item.itemId, balance),
        currentCharge:
          item.itemId === balance.items.salvageCutter.itemId
            ? normalizeCutterCharge(
                snapshot.itemInstances.find((instance) => instance.id === item.id)?.currentCharge,
                balance,
              )
            : undefined,
      })),
    },
    equipment: {
      aggregateContainerSlots: snapshot.equipmentLoadout.containerSlotCapacity,
      carriedPowerCellQuantity,
      salvageCutter: snapshot.equippedCutterInstanceId
        ? {
            currentCharge: cutterCharge,
            maximumCharge: balance.items.salvageCutter.maximumCharge,
            boostedAttemptDurationTicks: boostedMiningAttemptDurationTicks(balance),
          }
        : undefined,
      slots: [
        {
          target: {
            assignmentKind: "gear" as const,
            suitSlotId: balance.items.salvageCutter.suitSlotId,
          },
          label: "Mining tool",
        },
        ...balance.carrying.containerSuitSlotIds.map((suitSlotId, index) => ({
          target: { assignmentKind: "container" as const, suitSlotId },
          label: `Container attachment ${index + 1}`,
        })),
      ].map((slot) => {
        const assignment = snapshot.equipmentLoadout.assignments.find(
          (candidate) =>
            candidate.assignmentKind === slot.target.assignmentKind &&
            candidate.suitSlotId === slot.target.suitSlotId,
        );
        const item = assignment
          ? snapshot.itemInstances.find((instance) => instance.id === assignment.itemInstanceId)
          : undefined;
        const eligibleItems = snapshot.itemInstances
          .filter(
            (instance) =>
              !snapshot.equipmentLoadout.equippedItemInstanceIds.has(instance.id) &&
              isCompatibleEquipmentAssignment(instance.itemId, slot.target, balance),
          )
          .map((instance) => ({
            itemInstanceId: instance.id,
            itemId: instance.itemId,
            name: resolveItemPresentation(instance.itemId, instance.itemId).displayName,
            massGrams: carriedItemMassGrams(instance.itemId, balance),
          }));
        return {
          ...slot,
          item: item
            ? {
                itemInstanceId: item.id,
                itemId: item.itemId,
                name: resolveItemPresentation(item.itemId, item.itemId).displayName,
                massGrams: carriedItemMassGrams(item.itemId, balance),
              }
            : undefined,
          eligibleItems,
        };
      }),
    },
    run,
    recentResult,
    stoppingReason: action
      ? undefined
      : (stoppingReason ?? (miningState?.lastStopReason as MiningStopReason | null) ?? undefined),
    commandError,
    travelError,
  };
}

export async function getMiningGameplayState(
  userId: string,
  characterId: string,
  now = new Date(),
  random = defaultMiningRandom(),
): Promise<MiningGameplayState> {
  let outcome: PersistedMiningOutcome | undefined;
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random, (value) => {
      outcome = value;
    }),
    async (transaction, context) => {
      await ensureStarterMiningState(transaction, context.character.id);
      return stateFromTransaction(
        transaction,
        context.character.id,
        outcome
          ? {
              successes: outcome.successes,
              failures: outcome.failures,
              awardedXp: outcome.awardedXp,
            }
          : { successes: 0, failures: 0, awardedXp: 0 },
        outcome?.stopReason,
        context.action && context.action.actionId !== ACTION_IDS.crashSiteMining
          ? "another_action_active"
          : undefined,
        undefined,
        undefined,
        now,
      );
    },
    now,
  );
}

export async function startCrashSiteMining(
  userId: string,
  characterId: string,
  now = new Date(),
  random = defaultMiningRandom(),
): Promise<MiningGameplayState> {
  let outcome: PersistedMiningOutcome | undefined;
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random, (value) => {
      outcome = value;
    }),
    async (transaction, context) => {
      await ensureStarterMiningState(transaction, context.character.id);
      const unsupportedAction =
        context.action && context.action.actionId !== ACTION_IDS.crashSiteMining;
      // Reload the character after lazy resolution so location reflects any
      // travel arrival that just committed in this same transaction.
      const [reloaded] = await transaction
        .select()
        .from(characters)
        .where(eq(characters.id, context.character.id))
        .limit(1);
      const currentLocationId = reloaded?.currentLocationId ?? LOCATION_IDS.crashSite;
      const traveling = context.action?.actionId === ACTION_IDS.travel;
      // Mining may only start at the Crash Site while stationary.
      const miningBlockedHere = !isActionAvailableAtLocation(
        currentLocationId,
        ACTION_IDS.crashSiteMining,
      );
      const snapshot = await loadMiningSnapshot(transaction, context.character.id);
      const preflightStopReason =
        context.action || traveling || miningBlockedHere
          ? undefined
          : miningPreflightStopReason(snapshot, getEffectiveGameBalance());
      if (!context.action && !preflightStopReason && !miningBlockedHere) {
        await transaction.insert(activeActions).values({
          characterId: context.character.id,
          actionId: ACTION_IDS.crashSiteMining,
          startedAt: now,
          resolvedThroughAt: now,
        });
        await transaction
          .insert(characterMiningState)
          .values({
            characterId: context.character.id,
            runAttempts: 0,
            runSuccesses: 0,
            runShaleGained: 0,
            runXpGained: 0,
            recentAttempts: [],
            lastStopReason: null,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: characterMiningState.characterId,
            set: {
              runAttempts: 0,
              runSuccesses: 0,
              runShaleGained: 0,
              runXpGained: 0,
              recentAttempts: [],
              lastStopReason: null,
              updatedAt: now,
            },
          });
      }
      if (!unsupportedAction && !preflightStopReason)
        await transaction
          .insert(characterMiningState)
          .values({ characterId: context.character.id, lastStopReason: null })
          .onConflictDoUpdate({
            target: characterMiningState.characterId,
            set: { lastStopReason: null, updatedAt: now },
          });
      return stateFromTransaction(
        transaction,
        context.character.id,
        outcome
          ? {
              successes: outcome.successes,
              failures: outcome.failures,
              awardedXp: outcome.awardedXp,
            }
          : { successes: 0, failures: 0, awardedXp: 0 },
        preflightStopReason ?? outcome?.stopReason,
        unsupportedAction ? "another_action_active" : undefined,
        miningBlockedHere ? "mining_unavailable_here" : undefined,
        undefined,
        now,
      );
    },
    now,
  );
}

export async function stopMining(
  userId: string,
  characterId: string,
  now = new Date(),
  random = defaultMiningRandom(),
): Promise<MiningGameplayState> {
  let outcome: PersistedMiningOutcome | undefined;
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random, (value) => {
      outcome = value;
    }),
    async (transaction, context) => {
      await ensureStarterMiningState(transaction, context.character.id);
      const manuallyStopped = context.action?.actionId === ACTION_IDS.crashSiteMining;
      if (manuallyStopped)
        await transaction
          .delete(activeActions)
          .where(eq(activeActions.characterId, context.character.id));
      if (manuallyStopped)
        await transaction
          .insert(characterMiningState)
          .values({ characterId: context.character.id, lastStopReason: "manually_stopped" })
          .onConflictDoUpdate({
            target: characterMiningState.characterId,
            set: { lastStopReason: "manually_stopped", updatedAt: now },
          });
      return stateFromTransaction(
        transaction,
        context.character.id,
        outcome
          ? {
              successes: outcome.successes,
              failures: outcome.failures,
              awardedXp: outcome.awardedXp,
            }
          : { successes: 0, failures: 0, awardedXp: 0 },
        manuallyStopped ? "manually_stopped" : outcome?.stopReason,
        context.action && context.action.actionId !== ACTION_IDS.crashSiteMining
          ? "another_action_active"
          : undefined,
        undefined,
        context.character,
        now,
      );
    },
    now,
  );
}

export type LoadPowerCellStatus =
  | { status: "loaded"; remainingCharge: number }
  | { status: "already_loaded"; remainingCharge: number; message: string }
  | { status: "no_cutter" | "no_cell"; message: string };

export type LoadPowerCellResult = {
  state: MiningGameplayState;
  load: LoadPowerCellStatus;
};

/**
 * Load exactly one loose Power Cell into the equipped Cutter. The shared
 * character lock first resolves any due active action work, then this command
 * changes the Cutter and inventory in the same transaction. Loading is allowed
 * while idle, Mining, or another action is in progress; only due Mining work is
 * resolved by the supplied play resolver.
 */
export async function loadSalvageCutterPowerCell(
  userId: string,
  characterId: string,
  now = new Date(),
  random = defaultMiningRandom(),
): Promise<LoadPowerCellResult> {
  let outcome: PersistedMiningOutcome | undefined;
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random, (value) => {
      outcome = value;
    }),
    async (transaction, context) => {
      await ensureStarterMiningState(transaction, context.character.id);
      const balance = getEffectiveGameBalance();
      const [instances, assignments, stacks] = await Promise.all([
        transaction
          .select()
          .from(itemInstances)
          .where(eq(itemInstances.characterId, context.character.id))
          .for("update"),
        transaction
          .select()
          .from(equippedItems)
          .where(eq(equippedItems.characterId, context.character.id))
          .for("update"),
        transaction
          .select()
          .from(inventoryStacks)
          .where(eq(inventoryStacks.characterId, context.character.id))
          .orderBy(asc(inventoryStacks.createdAt), asc(inventoryStacks.id))
          .for("update"),
      ]);
      const cutterAssignment = assignments.find(
        (assignment) =>
          assignment.assignmentKind === "gear" &&
          assignment.suitSlotId === balance.items.salvageCutter.suitSlotId,
      );
      const cutter = cutterAssignment
        ? instances.find(
            (instance) =>
              instance.id === cutterAssignment.itemInstanceId &&
              instance.itemId === balance.items.salvageCutter.itemId &&
              isCompatibleEquipmentAssignment(instance.itemId, cutterAssignment, balance),
          )
        : undefined;

      if (!cutter) {
        return {
          state: await stateFromTransaction(
            transaction,
            context.character.id,
            recentFrom(outcome),
            outcome?.stopReason,
            undefined,
            undefined,
            undefined,
            now,
          ),
          load: {
            status: "no_cutter",
            message: "Equip a Salvage Cutter before loading a Power Cell.",
          },
        };
      }

      const currentCharge = normalizeCutterCharge(cutter.currentCharge, balance);
      if (currentCharge > 0) {
        return {
          state: await stateFromTransaction(
            transaction,
            context.character.id,
            recentFrom(outcome),
            outcome?.stopReason,
            undefined,
            undefined,
            undefined,
            now,
          ),
          load: {
            status: "already_loaded",
            remainingCharge: currentCharge,
            message: `Power Cell already loaded — ${currentCharge} boosted attempts remain.`,
          },
        };
      }

      const cellStack = stacks.find(
        (stack) => stack.itemId === balance.items.powerCell.itemId && stack.quantity > 0,
      );
      if (!cellStack) {
        return {
          state: await stateFromTransaction(
            transaction,
            context.character.id,
            recentFrom(outcome),
            outcome?.stopReason,
            undefined,
            undefined,
            undefined,
            now,
          ),
          load: { status: "no_cell", message: "No loose Power Cells are carried." },
        };
      }

      if (cellStack.quantity === 1) {
        await transaction.delete(inventoryStacks).where(eq(inventoryStacks.id, cellStack.id));
      } else {
        await transaction
          .update(inventoryStacks)
          .set({ quantity: cellStack.quantity - 1, updatedAt: now })
          .where(eq(inventoryStacks.id, cellStack.id));
      }
      await transaction
        .update(itemInstances)
        .set({ currentCharge: balance.items.salvageCutter.maximumCharge, updatedAt: now })
        .where(
          and(eq(itemInstances.id, cutter.id), eq(itemInstances.characterId, context.character.id)),
        );

      return {
        state: await stateFromTransaction(
          transaction,
          context.character.id,
          recentFrom(outcome),
          outcome?.stopReason,
          undefined,
          undefined,
          undefined,
          now,
        ),
        load: { status: "loaded", remainingCharge: balance.items.salvageCutter.maximumCharge },
      };
    },
    now,
  );
}

export async function beginTravel(
  userId: string,
  characterId: string,
  destinationLocationId: string,
  now = new Date(),
  random = defaultMiningRandom(),
): Promise<MiningGameplayState> {
  let miningOutcome: PersistedMiningOutcome | undefined;
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random, (value) => {
      miningOutcome = value;
    }),
    async (transaction, context) => {
      await ensureStarterMiningState(transaction, context.character.id);

      // Reload the character after lazy resolution so origin reflects any travel
      // arrival that committed earlier in this same transaction.
      const [reloaded] = await transaction
        .select()
        .from(characters)
        .where(eq(characters.id, context.character.id))
        .limit(1);
      const currentLocationId = reloaded?.currentLocationId ?? LOCATION_IDS.crashSite;
      const alreadyTraveling = context.action?.actionId === ACTION_IDS.travel;
      const travelRows = await transaction
        .select()
        .from(characterTravelState)
        .where(eq(characterTravelState.characterId, context.character.id))
        .for("update");
      const travel = travelRows[0];

      if (alreadyTraveling) {
        const sameDestination = travel?.destinationLocationId === destinationLocationId;
        if (sameDestination) {
          // Idempotent retry: the journey is already underway to this destination.
          return stateFromTransaction(
            transaction,
            context.character.id,
            recentFrom(miningOutcome),
            miningOutcome?.stopReason,
            undefined,
            undefined,
            undefined,
            now,
          );
        }
        return stateFromTransaction(
          transaction,
          context.character.id,
          recentFrom(miningOutcome),
          miningOutcome?.stopReason,
          undefined,
          "already_traveling",
          undefined,
          now,
        );
      }

      const plan = planTravel({
        currentLocationId,
        destinationLocationId,
        alreadyTraveling: false,
      });
      if (!plan.ok) {
        return stateFromTransaction(
          transaction,
          context.character.id,
          recentFrom(miningOutcome),
          miningOutcome?.stopReason,
          context.action && context.action.actionId !== ACTION_IDS.crashSiteMining
            ? "another_action_active"
            : undefined,
          plan.reason,
          undefined,
          now,
        );
      }

      // Only approved Crash Site Mining may be replaced atomically by Travel.
      // Unknown, unsupported, future, or malformed active actions block Travel
      // and must remain completely untouched.
      if (context.action && context.action.actionId !== ACTION_IDS.crashSiteMining) {
        return stateFromTransaction(
          transaction,
          context.character.id,
          recentFrom(miningOutcome),
          miningOutcome?.stopReason,
          "another_action_active",
          undefined,
          undefined,
          now,
        );
      }

      // Replace active Crash Site Mining atomically, resolving only
      // already-completed Mining work exactly once before Travel begins.
      if (context.action) {
        await transaction
          .delete(activeActions)
          .where(eq(activeActions.characterId, context.character.id));
        await transaction
          .insert(characterMiningState)
          .values({ characterId: context.character.id, lastStopReason: "action_replaced" })
          .onConflictDoUpdate({
            target: characterMiningState.characterId,
            set: { lastStopReason: "action_replaced", updatedAt: now },
          });
      }
      await transaction.insert(activeActions).values({
        characterId: context.character.id,
        actionId: ACTION_IDS.travel,
        startedAt: now,
        resolvedThroughAt: now,
      });
      await transaction.insert(characterTravelState).values({
        characterId: context.character.id,
        originLocationId: currentLocationId,
        destinationLocationId,
      });

      return stateFromTransaction(
        transaction,
        context.character.id,
        recentFrom(miningOutcome),
        miningOutcome?.stopReason,
        undefined,
        undefined,
        undefined,
        now,
      );
    },
    now,
  );
}

function recentFrom(
  outcome: PersistedMiningOutcome | undefined,
): MiningGameplayState["recentResult"] {
  return outcome
    ? { successes: outcome.successes, failures: outcome.failures, awardedXp: outcome.awardedXp }
    : { successes: 0, failures: 0, awardedXp: 0 };
}
