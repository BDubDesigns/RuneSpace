import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  cargoHoldItemInstances,
  cargoHoldStacks,
  characterCargoHoldRepair,
  characterMiningState,
  characterPowerCellDailyClaims,
  characterRefiningState,
  characterScavengeReveals,
  characterSkillXp,
  characterStarterProvisioning,
  characters,
  characterTravelState,
  equippedItems,
  inventoryStacks,
  itemInstances,
} from "@/db/rune-space";
import {
  getEffectiveGameBalance,
  getItemDefinition,
  miningLevelThresholds,
  standardSkillLevelThresholds,
} from "@/game/config/balance";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { ACTION_IDS, ITEM_IDS, LOCATION_IDS, SKILL_IDS } from "@/game/config/foundations";
import { isTravelReplaceableAction } from "@/game/domain/travel-replacement";
import {
  cargoHoldMaterialsComplete,
  cargoHoldRepairComplete,
  planCargoHoldMaterialContribution,
} from "@/game/domain/cargo-hold";
import { POWER_ANNEX_REWARD_SOURCE_ID, pacificResetDate } from "@/game/domain/power-annex";
import { powerAnnexNow } from "@/server/power-annex-clock";
import {
  carriedItemMassGrams,
  isCompatibleEquipmentAssignment,
  type EquipmentTarget,
} from "@/game/domain/equipment";
import {
  deriveCarriedUniqueItems,
  planExactStackAddition,
  planPossibleAwardAdditions,
} from "@/game/domain/inventory";
import {
  miningSuccessChanceBps,
  normalizeCutterCharge,
  boostedMiningAttemptDurationTicks,
  type MiningRandom,
  type MiningStopReason,
} from "@/game/domain/mining";
import { refiningSuccessChanceBps, type RefiningStopReason } from "@/game/domain/refining";
import { skillLevelProgress } from "@/game/domain/progression";
import { adjacentWalkDurationTicks, planTravel } from "@/game/domain/travel";
import {
  resolveScavengeOutcome,
  resolvedScavengeOutcome,
  scavengeAwardCapacitySpec,
  scavengeOpportunityStartTick,
  scavengePossibleAwardSpecs,
  scavengeWindowAt,
} from "@/game/domain/scavenge";
import { ticksToMilliseconds } from "@/game/domain/timing";
import {
  type ActionResolver,
  type DatabaseTransaction,
  withLockedOwnedCharacter,
  withResolvedOwnedCharacter,
} from "@/server/action-resolution";
import { addStackableItem, loadOwnedItemInstances } from "@/server/carried-inventory";
import { createTravelResolver, type TravelResolution, type TravelSnapshot } from "@/server/travel";
import {
  createRefiningResolver,
  e2eRefiningRandom,
  type PersistedRefiningOutcome,
  type RefiningRunAttempt,
  type RefiningRunState,
} from "@/server/refining";
import {
  createWeldingResolver,
  ensureCargoHoldRepairState,
  type PersistedWeldingOutcome,
  type WeldingSnapshot,
} from "@/server/welding";
import {
  createMiningResolver,
  defaultMiningRandom,
  type MiningRunAttempt,
  type MiningRunState,
  type PersistedMiningOutcome,
} from "@/server/mining";
import { loadMissionProjections } from "@/server/mission-state";
import type { MissionProjection } from "@/game/domain/missions";
import { loadPlaySnapshot } from "@/server/play-state";

function itemStackLimit(itemId: string, balance = getEffectiveGameBalance()): number {
  const definition = getItemDefinition(itemId, balance);
  return definition?.kind === "stack" ? definition.stackLimit : 1;
}

export type CargoHoldStackState = {
  id: string;
  itemId: string;
  name: string;
  quantity: number;
  stackLimit: number;
};

export type CargoHoldUniqueItemState = {
  id: string;
  itemId: string;
  name: string;
  massGrams: number;
  currentCharge?: number;
};

export type CargoHoldState = {
  repair: {
    refinedFerriteContributed: number;
    refinedFerriteRequired: number;
    slagContributed: number;
    slagRequired: number;
    weldingProgress: number;
    weldingIncrements: number;
    materialComplete: boolean;
    complete: boolean;
    completedAt?: string;
    availableContribution: { refinedFerrite: number; slag: number };
  };
  stacks: readonly CargoHoldStackState[];
  uniqueItems: readonly CargoHoldUniqueItemState[];
  slotsUsed: number;
  capacitySlots: number;
};

export type ActivityStop =
  | { actionId: typeof ACTION_IDS.ferriteShaleMining; reason: MiningStopReason }
  | { actionId: typeof ACTION_IDS.refining; reason: RefiningStopReason };

export type ScavengeResolvedOutcome = {
  outcomeId: import("@/game/content/scavenge").ScavengeOutcomeId;
  label: string;
  itemId?: string;
  quantity: number;
};

export type ScavengeClaimStatus =
  | { status: "claimed"; outcome: ScavengeResolvedOutcome }
  | {
      status: "refused";
      reason: "no_travel" | "not_open" | "missed" | "already_claimed" | "capacity_blocked";
      message: string;
    };

export type ScavengeClaimResult = {
  state: PlayGameplayState;
  scavenge: ScavengeClaimStatus;
};

export type ScavengeReveal = ScavengeResolvedOutcome & {
  revealId: string;
  claimedAt: string;
};

export type ScavengeAcknowledgmentResult = {
  state: PlayGameplayState;
  acknowledged: boolean;
};

/**
 * The authoritative application-wide play state assembled by the generic play
 * orchestration layer. This is the shared shell the play UI consumes — it is
 * not a Mining-owned shape even though Mining was the first vertical.
 */
export type PlayGameplayState = {
  characterId: string;
  missions: readonly MissionProjection[];
  activeAction?: {
    actionId: string;
    resolvedThroughAt: string;
    nextAttemptAt: string;
    progressStartedAt: string;
    nextAttemptBoosted: boolean;
    nextAttemptDurationTicks: number;
  };
  mining: { totalXp: number; level: number; xpToNextLevel?: number; xpIntoLevel: number };
  refining: { totalXp: number; level: number; xpToNextLevel?: number; xpIntoLevel: number };
  welding: { totalXp: number; level: number; xpToNextLevel?: number; xpIntoLevel: number };
  successChanceBps: number;
  refiningSuccessChanceBps: number;
  ferriteShaleQuantity: number;
  refinedFerriteQuantity: number;
  slagQuantity: number;
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
      massGrams: number;
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
  refiningRun: RefiningRunState;
  cargoHold: CargoHoldState;
  recentResult: { successes: number; failures: number; awardedXp: number };
  refiningRecentResult: { successes: number; failures: number; awardedXp: number };
  /**
   * One current stop event — which action stopped, and why. Never two
   * parallel channels; Mining-only reasons cannot leak into Refining UI.
   */
  stop?: ActivityStop;
  commandError?: "another_action_active";
  /** Authoritative persistent current location (stable ID from the registry). */
  location: { currentLocationId: string };
  /** Present only while the character is in transit (server-authoritative). */
  travelState?: {
    originLocationId: string;
    destinationLocationId: string;
    startedAt: string;
    arrivesAt: string;
    scavenge: {
      opportunityStartTick: number;
      opensAt: string;
      expiresAt: string;
      outcome?: ScavengeResolvedOutcome;
    };
  };
  /** Committed Scavenge outcomes awaiting presentation acknowledgment. */
  scavengeReveals: readonly ScavengeReveal[];
  /** Current Pacific-day claim state, only when the character is at the Annex. */
  powerAnnex?: { resetDate: string; claimed: boolean };
  /** Set when a begin-travel command was refused by the authoritative rules. */
  travelError?:
    | "unknown_destination"
    | "same_location"
    | "not_adjacent"
    | "already_traveling"
    | "mining_unavailable_here";
  /** Set when a Start Refining command was refused outside the Processing Yard. */
  refiningError?: "refining_unavailable_here";
  /** Set when the finite Crash Site Welding command cannot begin. */
  weldingError?: "welding_unavailable_here" | "welding_locked" | "repair_complete";
};

type PlayResolver = ActionResolver<unknown, unknown>;

type PlayResolverEntry = {
  resolver: PlayResolver;
  actionId: string;
};

/**
 * Compose the activity resolvers into one owned-character play resolver.
 *
 * Dispatch is always by the ORIGINAL action id supplied in the persist context
 * (`withResolvedOwnedCharacter` always passes it — action-resolution.ts). The
 * composed resolver refuses a persist call whose context is missing rather than
 * discriminating outcomes by shape. The only casts are the boundary where each
 * typed activity resolver enters this heterogeneous registry.
 */
export function composePlayResolvers(entries: readonly PlayResolverEntry[]): PlayResolver {
  const byActionId = new Map(entries.map((entry) => [entry.actionId, entry]));
  return {
    supports: (action) => byActionId.has(action.actionId),
    load: (transaction, input) => {
      const entry = byActionId.get(input.action.actionId);
      if (!entry) throw new Error(`No resolver owns action ${input.action.actionId}`);
      return entry.resolver.load(transaction, input);
    },
    resolve: (input) => {
      const entry = byActionId.get(input.action.actionId);
      if (!entry) throw new Error(`No resolver owns action ${input.action.actionId}`);
      return entry.resolver.resolve(input);
    },
    persist: (transaction, outcome, context) => {
      // withResolvedOwnedCharacter always supplies the original action context;
      // a persist without it cannot be dispatched by outcome shape.
      if (!context) throw new Error("Cannot persist without the original action context");
      const entry = byActionId.get(context.action.actionId);
      if (!entry) throw new Error(`No resolver owns action ${context.action.actionId}`);
      return entry.resolver.persist(transaction, outcome, context);
    },
  };
}

function isCanonicalE2EMiningOverride(): boolean {
  const databaseHost = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : "";
  return (
    process.env.CI === "true" &&
    process.env.RUNESPACE_E2E_MINING === "true" &&
    (databaseHost === "localhost" || databaseHost === "127.0.0.1")
  );
}

/**
 * Create the application-wide play resolver composing Mining, Refining, Travel,
 * and Welding. Default random wiring is owned here so generic callers do not
 * need to import Mining just to obtain a random source.
 *
 * RNG behavior (preserved exactly from pre-#127):
 * - Outside the canonical-E2E override, the caller-supplied `random` (or the
 *   default) feeds BOTH Mining and Refining.
 * - Under `CI && RUNESPACE_E2E_MINING && localhost`, Refining uses its
 *   deterministic E2E sequence (`e2eRefiningRandom`) so both success and
 *   failure branches are proven.
 */
export function createPlayResolver(
  random: MiningRandom = defaultMiningRandom(),
  onMiningOutcome?: (outcome: PersistedMiningOutcome) => void,
  onTravelArrival?: (outcome: TravelResolution) => void,
  onRefiningOutcome?: (outcome: PersistedRefiningOutcome) => void,
  onWeldingOutcome?: (outcome: PersistedWeldingOutcome) => void,
): PlayResolver {
  const refiningRandom = isCanonicalE2EMiningOverride()
    ? e2eRefiningRandom()
    : (random as import("@/game/domain/refining").RefiningRandom);
  const entries: PlayResolverEntry[] = [
    {
      actionId: ACTION_IDS.ferriteShaleMining,
      resolver: createMiningResolver(random, onMiningOutcome) as PlayResolver,
    },
    {
      actionId: ACTION_IDS.refining,
      resolver: createRefiningResolver(refiningRandom, onRefiningOutcome) as PlayResolver,
    },
    {
      actionId: ACTION_IDS.travel,
      resolver: createTravelResolver() as PlayResolver,
    },
    {
      actionId: ACTION_IDS.cargoHoldWelding,
      resolver: createWeldingResolver(onWeldingOutcome) as PlayResolver,
    },
  ];
  return composePlayResolvers(entries);
}

/**
 * Provisions the full shared play state for a character on first play: skill
 * rows (Mining/Refining/Welding/Strength), Mining/Refining persistence rows,
 * Cargo Hold repair state, and the starter container/equipment assignment.
 *
 * This is application-level play provisioning, not a Mining concern — Mining
 * was simply the first vertical to need it.
 */
export async function ensurePlayProvisioning(
  transaction: DatabaseTransaction,
  characterId: string,
): Promise<void> {
  const balance = getEffectiveGameBalance();
  const marker = await transaction
    .insert(characterStarterProvisioning)
    .values({ characterId })
    .onConflictDoNothing({ target: characterStarterProvisioning.characterId })
    .returning({ characterId: characterStarterProvisioning.characterId });

  // Existing characters already have their original starter marker. Add only
  // the issue #89 state that did not exist when that marker was created; do
  // not re-create an older Refining row that the legacy migration contract
  // deliberately provisions lazily when Refining is first used.
  if (!marker[0]) {
    await transaction
      .insert(characterSkillXp)
      .values({ characterId, skillId: SKILL_IDS.welding, totalXp: 0 })
      .onConflictDoNothing();
    await ensureCargoHoldRepairState(transaction, characterId);
    return;
  }

  await transaction
    .insert(characterSkillXp)
    .values([
      { characterId, skillId: SKILL_IDS.mining, totalXp: 0 },
      { characterId, skillId: SKILL_IDS.refining, totalXp: 0 },
      { characterId, skillId: SKILL_IDS.welding, totalXp: 0 },
      { characterId, skillId: SKILL_IDS.strength, totalXp: 0 },
    ])
    .onConflictDoNothing();
  await transaction
    .insert(characterRefiningState)
    .values({ characterId })
    .onConflictDoNothing({ target: characterRefiningState.characterId });
  await ensureCargoHoldRepairState(transaction, characterId);
  await transaction
    .insert(characterMiningState)
    .values({ characterId })
    .onConflictDoNothing({ target: characterMiningState.characterId });
  const { carriedInstances } = await loadOwnedItemInstances(transaction, characterId);
  const assignments = await transaction
    .select()
    .from(equippedItems)
    .where(eq(equippedItems.characterId, characterId))
    .for("update");
  // Issue #102 changes only the new-character starter rule: the first Cutter
  // is now the authoritative Walk It Off reward. Existing item instances are
  // never deleted or unequipped here; beta-character cleanup remains an
  // external operator task.
  const equippedIds = new Set(assignments.map((assignment) => assignment.itemInstanceId));
  const hasContainer = assignments.some((assignment) =>
    carriedInstances.some(
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
      let container = carriedInstances.find(
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

function serializeScavengeOutcome(
  outcome: ReturnType<typeof resolvedScavengeOutcome>,
): ScavengeResolvedOutcome {
  return {
    outcomeId: outcome.outcomeId,
    label: outcome.label,
    itemId: outcome.itemId,
    quantity: outcome.quantity,
  };
}

function refiningRecentFrom(
  outcome: PersistedRefiningOutcome | undefined,
): PlayGameplayState["refiningRecentResult"] {
  return outcome
    ? { successes: outcome.successes, failures: outcome.failures, awardedXp: outcome.awardedXp }
    : { successes: 0, failures: 0, awardedXp: 0 };
}

function recentFrom(
  outcome: PersistedMiningOutcome | undefined,
): PlayGameplayState["recentResult"] {
  return outcome
    ? { successes: outcome.successes, failures: outcome.failures, awardedXp: outcome.awardedXp }
    : { successes: 0, failures: 0, awardedXp: 0 };
}

/**
 * Assemble the authoritative application-wide play state from the shared
 * owned-character transaction. This is the generic state assembly — no
 * activity owns it.
 */
export async function stateFromTransaction(
  transaction: DatabaseTransaction,
  characterId: string,
  recentResult: PlayGameplayState["recentResult"],
  miningStopReason?: MiningStopReason,
  commandError?: PlayGameplayState["commandError"],
  travelError?: PlayGameplayState["travelError"],
  characterRow?: { currentLocationId: string },
  now = new Date(),
  refiningRecentResult: PlayGameplayState["refiningRecentResult"] = {
    successes: 0,
    failures: 0,
    awardedXp: 0,
  },
  refiningStopReason?: RefiningStopReason | null,
  refiningError?: PlayGameplayState["refiningError"],
  weldingError?: PlayGameplayState["weldingError"],
): Promise<PlayGameplayState> {
  const balance = getEffectiveGameBalance();
  const snapshot = await loadPlaySnapshot(transaction, characterId);
  const resetDate = pacificResetDate(powerAnnexNow(now));
  const [
    xpRows,
    stacks,
    actionRows,
    miningStateRows,
    refiningStateRows,
    cargoRepairRows,
    cargoStackRows,
    cargoItemRows,
    travelRows,
    scavengeRevealRows,
    claimRows,
    character,
  ] = await Promise.all([
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
      .from(characterRefiningState)
      .where(eq(characterRefiningState.characterId, characterId)),
    transaction
      .select()
      .from(characterCargoHoldRepair)
      .where(eq(characterCargoHoldRepair.characterId, characterId)),
    transaction
      .select()
      .from(cargoHoldStacks)
      .where(eq(cargoHoldStacks.characterId, characterId))
      .orderBy(asc(cargoHoldStacks.createdAt), asc(cargoHoldStacks.id)),
    transaction
      .select()
      .from(cargoHoldItemInstances)
      .where(eq(cargoHoldItemInstances.characterId, characterId))
      .orderBy(asc(cargoHoldItemInstances.storedAt), asc(cargoHoldItemInstances.itemInstanceId)),
    transaction
      .select()
      .from(characterTravelState)
      .where(eq(characterTravelState.characterId, characterId)),
    transaction
      .select()
      .from(characterScavengeReveals)
      .where(eq(characterScavengeReveals.characterId, characterId))
      .orderBy(asc(characterScavengeReveals.claimedAt), asc(characterScavengeReveals.id)),
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
  const refiningTotalXp = xpRows.find((row) => row.skillId === SKILL_IDS.refining)?.totalXp ?? 0;
  const weldingTotalXp = xpRows.find((row) => row.skillId === SKILL_IDS.welding)?.totalXp ?? 0;
  const thresholds = miningLevelThresholds(balance);
  const refiningThresholds = standardSkillLevelThresholds(balance);
  const weldingThresholds = standardSkillLevelThresholds(balance);
  const miningProgress = skillLevelProgress(totalXp, thresholds);
  const refiningProgress = skillLevelProgress(refiningTotalXp, refiningThresholds);
  const weldingProgress = skillLevelProgress(weldingTotalXp, weldingThresholds);
  const action = actionRows[0];
  const miningState = miningStateRows[0];
  const travel = travelRows[0];
  const scavengeReveals: ScavengeReveal[] = scavengeRevealRows.map((row) => {
    const outcome = resolvedScavengeOutcome({
      outcomeId: row.outcomeId,
      quantity: row.awardQuantity,
    });
    return {
      revealId: row.id,
      claimedAt: row.claimedAt.toISOString(),
      ...serializeScavengeOutcome(outcome),
    };
  });
  const run: MiningRunState = {
    attempts: miningState?.runAttempts ?? 0,
    successes: miningState?.runSuccesses ?? 0,
    failures: (miningState?.runAttempts ?? 0) - (miningState?.runSuccesses ?? 0),
    shaleGained: miningState?.runShaleGained ?? 0,
    xpGained: miningState?.runXpGained ?? 0,
    recentAttempts: (miningState?.recentAttempts as MiningRunAttempt[] | undefined) ?? [],
  };
  const refiningState = refiningStateRows[0];
  const refiningRun: RefiningRunState = {
    attempts: refiningState?.runAttempts ?? 0,
    successes: refiningState?.runSuccesses ?? 0,
    failures: (refiningState?.runAttempts ?? 0) - (refiningState?.runSuccesses ?? 0),
    ferriteGained: refiningState?.runFerriteGained ?? 0,
    slagGained: refiningState?.runSlagGained ?? 0,
    shaleConsumed: refiningState?.runShaleConsumed ?? 0,
    xpGained: refiningState?.runXpGained ?? 0,
    recentAttempts: (refiningState?.recentAttempts as RefiningRunAttempt[] | undefined) ?? [],
  };
  const cargoRepair = cargoRepairRows[0];
  const repairState = {
    refinedFerriteContributed: cargoRepair?.refinedFerriteContributed ?? 0,
    slagContributed: cargoRepair?.slagContributed ?? 0,
    weldingProgress: cargoRepair?.weldingProgress ?? 0,
    completedAt: cargoRepair?.completedAt ?? null,
  };
  const materialComplete = cargoHoldMaterialsComplete(repairState, balance);
  const repairComplete = cargoHoldRepairComplete(repairState, balance);
  const carriedRefinedFerrite = stacks
    .filter((stack) => stack.itemId === ITEM_IDS.refinedFerrite)
    .reduce((total, stack) => total + stack.quantity, 0);
  const carriedSlag = stacks
    .filter((stack) => stack.itemId === ITEM_IDS.slag)
    .reduce((total, stack) => total + stack.quantity, 0);
  const availableContribution = planCargoHoldMaterialContribution({
    repair: repairState,
    carriedRefinedFerrite,
    carriedSlag,
    balance,
  });
  const cargoUniqueItems = cargoItemRows
    .map((row) => snapshot.allItemInstances.find((instance) => instance.id === row.itemInstanceId))
    .filter((instance): instance is (typeof snapshot.allItemInstances)[number] => Boolean(instance))
    .map((instance) => ({
      id: instance.id,
      itemId: instance.itemId,
      name: resolveItemPresentation(instance.itemId, instance.itemId).displayName,
      massGrams: carriedItemMassGrams(instance.itemId, balance),
      currentCharge:
        instance.itemId === balance.items.salvageCutter.itemId
          ? normalizeCutterCharge(instance.currentCharge, balance)
          : undefined,
    }));
  const currentLocationId = character[0]?.currentLocationId ?? LOCATION_IDS.crashSite;
  const missions = await loadMissionProjections(transaction, characterId, {
    currentLocationId,
    activeActionId: action?.actionId,
  });
  const travelState =
    travel && action?.actionId === ACTION_IDS.travel
      ? {
          originLocationId: travel.originLocationId,
          destinationLocationId: travel.destinationLocationId,
          startedAt: action.startedAt.toISOString(),
          arrivesAt: new Date(
            action.startedAt.getTime() + ticksToMilliseconds(adjacentWalkDurationTicks()),
          ).toISOString(),
          scavenge: (() => {
            const timing = scavengeWindowAt({
              travelStartedAt: action.startedAt,
              opportunityStartTick: travel.scavengeOpportunityStartTick,
              now,
              claimed: travel.scavengeOutcomeId !== null,
            });
            const outcome = travel.scavengeOutcomeId
              ? resolvedScavengeOutcome({
                  outcomeId: travel.scavengeOutcomeId,
                  quantity: travel.scavengeAwardQuantity,
                })
              : undefined;
            return {
              opportunityStartTick: travel.scavengeOpportunityStartTick,
              opensAt: timing.opensAt.toISOString(),
              expiresAt: timing.expiresAt.toISOString(),
              outcome: outcome
                ? {
                    outcomeId: outcome.outcomeId,
                    label: outcome.label,
                    itemId: outcome.itemId,
                    quantity: outcome.quantity,
                  }
                : undefined,
            };
          })(),
        }
      : undefined;
  const cutterAssignment = snapshot.equipmentLoadout.assignments.find(
    (assignment) =>
      assignment.assignmentKind === "gear" &&
      assignment.suitSlotId === balance.items.salvageCutter.suitSlotId,
  );
  const cutterInstance = cutterAssignment
    ? snapshot.carriedInstances.find((instance) => instance.id === cutterAssignment.itemInstanceId)
    : undefined;
  const cutterCharge = normalizeCutterCharge(cutterInstance?.currentCharge, balance);
  const isMiningAction = action?.actionId === ACTION_IDS.ferriteShaleMining;
  const isRefiningAction = action?.actionId === ACTION_IDS.refining;
  const isWeldingAction = action?.actionId === ACTION_IDS.cargoHoldWelding;
  const nextAttemptBoosted = isMiningAction && cutterCharge > 0;
  const nextAttemptDurationTicks = isWeldingAction
    ? balance.welding.attemptDurationTicks
    : isRefiningAction
      ? balance.refining.attemptDurationTicks
      : nextAttemptBoosted
        ? boostedMiningAttemptDurationTicks(balance)
        : balance.mining.attemptDurationTicks;
  const carriedPowerCellQuantity = stacks
    .filter((stack) => stack.itemId === ITEM_IDS.powerCell)
    .reduce((total, stack) => total + stack.quantity, 0);
  return {
    characterId,
    missions,
    location: { currentLocationId },
    scavengeReveals,
    travelState,
    powerAnnex:
      currentLocationId === LOCATION_IDS.emergencyPowerAnnex
        ? { resetDate, claimed: claimRows.length > 0 }
        : undefined,
    activeAction:
      action?.actionId === ACTION_IDS.ferriteShaleMining ||
      action?.actionId === ACTION_IDS.refining ||
      action?.actionId === ACTION_IDS.cargoHoldWelding
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
    refining: {
      totalXp: refiningTotalXp,
      level: refiningProgress.level,
      xpToNextLevel: refiningProgress.xpToNextLevel,
      xpIntoLevel: refiningProgress.xpIntoLevel,
    },
    welding: {
      totalXp: weldingTotalXp,
      level: weldingProgress.level,
      xpToNextLevel: weldingProgress.xpToNextLevel,
      xpIntoLevel: weldingProgress.xpIntoLevel,
    },
    successChanceBps: miningSuccessChanceBps(miningProgress.level, balance),
    refiningSuccessChanceBps: refiningSuccessChanceBps(refiningProgress.level, balance),
    ferriteShaleQuantity: stacks
      .filter((stack) => stack.itemId === ITEM_IDS.ferriteShale)
      .reduce((total, stack) => total + stack.quantity, 0),
    refinedFerriteQuantity: stacks
      .filter((stack) => stack.itemId === ITEM_IDS.refinedFerrite)
      .reduce((total, stack) => total + stack.quantity, 0),
    slagQuantity: stacks
      .filter((stack) => stack.itemId === ITEM_IDS.slag)
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
        stackLimit: itemStackLimit(stack.itemId, balance),
        massGrams: carriedItemMassGrams(stack.itemId, balance),
      })),
      uniqueItems: deriveCarriedUniqueItems(
        snapshot.carriedInstances.map((instance) => ({
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
                snapshot.carriedInstances.find((instance) => instance.id === item.id)
                  ?.currentCharge,
                balance,
              )
            : undefined,
      })),
    },
    equipment: {
      aggregateContainerSlots: snapshot.equipmentLoadout.containerSlotCapacity,
      carriedPowerCellQuantity,
      salvageCutter: cutterAssignment
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
          ? snapshot.carriedInstances.find((instance) => instance.id === assignment.itemInstanceId)
          : undefined;
        const eligibleItems = snapshot.carriedInstances
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
    refiningRun,
    cargoHold: {
      repair: {
        refinedFerriteContributed: repairState.refinedFerriteContributed,
        refinedFerriteRequired: balance.cargoHold.refinedFerriteRequired,
        slagContributed: repairState.slagContributed,
        slagRequired: balance.cargoHold.slagRequired,
        weldingProgress: repairState.weldingProgress,
        weldingIncrements: balance.welding.repairIncrements,
        materialComplete,
        complete: repairComplete,
        completedAt: repairState.completedAt?.toISOString(),
        availableContribution,
      },
      stacks: cargoStackRows.map((stack) => ({
        id: stack.id,
        itemId: stack.itemId,
        name: resolveItemPresentation(stack.itemId, stack.itemId).displayName,
        quantity: stack.quantity,
        stackLimit: itemStackLimit(stack.itemId, balance),
      })),
      uniqueItems: cargoUniqueItems,
      slotsUsed: cargoStackRows.length + cargoUniqueItems.length,
      capacitySlots: balance.cargoHold.capacitySlots,
    },
    recentResult,
    refiningRecentResult,
    stop: (() => {
      if (refiningStopReason)
        return { actionId: ACTION_IDS.refining, reason: refiningStopReason } as ActivityStop;
      if (miningStopReason)
        return {
          actionId: ACTION_IDS.ferriteShaleMining,
          reason: miningStopReason,
        } as ActivityStop;
      if (action) return undefined;
      const miningPersisted = miningState?.lastStopReason as MiningStopReason | null | undefined;
      const refiningPersisted = refiningState?.lastStopReason as
        | RefiningStopReason
        | null
        | undefined;
      if (miningPersisted && refiningPersisted) {
        const miningUpdated = miningState?.updatedAt
          ? new Date(miningState.updatedAt as unknown as string | Date).getTime()
          : 0;
        const refiningUpdated = refiningState?.updatedAt
          ? new Date(refiningState.updatedAt as unknown as string | Date).getTime()
          : 0;
        if (refiningUpdated >= miningUpdated)
          return { actionId: ACTION_IDS.refining, reason: refiningPersisted } as ActivityStop;
        return {
          actionId: ACTION_IDS.ferriteShaleMining,
          reason: miningPersisted,
        } as ActivityStop;
      }
      if (refiningPersisted)
        return { actionId: ACTION_IDS.refining, reason: refiningPersisted } as ActivityStop;
      if (miningPersisted)
        return { actionId: ACTION_IDS.ferriteShaleMining, reason: miningPersisted } as ActivityStop;
      return undefined;
    })(),
    commandError,
    travelError,
    refiningError,
    weldingError,
  };
}

/**
 * Load the authoritative play state, resolving any due active action work in
 * the same transaction (the shared lazy-resolution boundary).
 */
export async function getPlayGameplayState(
  userId: string,
  characterId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<PlayGameplayState> {
  let miningOutcome: PersistedMiningOutcome | undefined;
  let refiningOutcome: PersistedRefiningOutcome | undefined;
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(
      random,
      (value) => {
        miningOutcome = value;
      },
      undefined,
      (value) => {
        refiningOutcome = value;
      },
    ),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      return stateFromTransaction(
        transaction,
        context.character.id,
        miningOutcome
          ? {
              successes: miningOutcome.successes,
              failures: miningOutcome.failures,
              awardedXp: miningOutcome.awardedXp,
            }
          : { successes: 0, failures: 0, awardedXp: 0 },
        miningOutcome?.stopReason,
        context.action &&
          !isTravelReplaceableAction(context.action.actionId) &&
          context.action.actionId !== ACTION_IDS.travel
          ? "another_action_active"
          : undefined,
        undefined,
        undefined,
        now,
        refiningOutcome
          ? {
              successes: refiningOutcome.successes,
              failures: refiningOutcome.failures,
              awardedXp: refiningOutcome.awardedXp,
            }
          : { successes: 0, failures: 0, awardedXp: 0 },
        refiningOutcome?.stopReason,
      );
    },
    now,
  );
}

/** Begin a walk between two adjacent locations, atomically replacing any travel-replaceable active work. */
export async function beginTravel(
  userId: string,
  characterId: string,
  destinationLocationId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<PlayGameplayState> {
  let miningOutcome: PersistedMiningOutcome | undefined;
  let refiningOutcome: PersistedRefiningOutcome | undefined;
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(
      random,
      (value) => {
        miningOutcome = value;
      },
      undefined,
      (value) => {
        refiningOutcome = value;
      },
    ),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);

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
          context.action && context.action.actionId !== ACTION_IDS.ferriteShaleMining
            ? "another_action_active"
            : undefined,
          plan.reason,
          undefined,
          now,
        );
      }

      // Only approved travel-replaceable work actions may be replaced atomically by Travel.
      // Unknown, unsupported, future, or malformed active actions block Travel
      // and must remain completely untouched.
      if (context.action && !isTravelReplaceableAction(context.action.actionId)) {
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

      // Replace active travel-replaceable work action atomically, resolving only
      // already-completed work exactly once before Travel begins.
      if (context.action) {
        await transaction
          .delete(activeActions)
          .where(eq(activeActions.characterId, context.character.id));
        if (context.action.actionId === ACTION_IDS.ferriteShaleMining) {
          await transaction
            .insert(characterMiningState)
            .values({ characterId: context.character.id, lastStopReason: "action_replaced" })
            .onConflictDoUpdate({
              target: characterMiningState.characterId,
              set: { lastStopReason: "action_replaced", updatedAt: now },
            });
        } else if (context.action.actionId === ACTION_IDS.refining) {
          await transaction
            .insert(characterRefiningState)
            .values({ characterId: context.character.id, lastStopReason: "action_replaced" })
            .onConflictDoUpdate({
              target: characterRefiningState.characterId,
              set: { lastStopReason: "action_replaced", updatedAt: now },
            });
        }
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
        scavengeOpportunityStartTick: scavengeOpportunityStartTick(random.nextBasisPoints()),
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
        refiningRecentFrom(refiningOutcome),
        refiningOutcome?.stopReason,
      );
    },
    now,
  );
}

/** Claim the single optional Scavenge window attached to the active Travel row. */
export async function claimScavenge(
  userId: string,
  characterId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<ScavengeClaimResult> {
  let miningOutcome: PersistedMiningOutcome | undefined;
  let refiningOutcome: PersistedRefiningOutcome | undefined;
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(
      random,
      (value) => {
        miningOutcome = value;
      },
      undefined,
      (value) => {
        refiningOutcome = value;
      },
    ),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);
      const travelRows = await transaction
        .select()
        .from(characterTravelState)
        .where(eq(characterTravelState.characterId, context.character.id))
        .for("update");
      const travel = travelRows[0];

      const stateFor = async (scavenge: ScavengeClaimStatus): Promise<ScavengeClaimResult> => ({
        state: await stateFromTransaction(
          transaction,
          context.character.id,
          recentFrom(miningOutcome),
          miningOutcome?.stopReason,
          undefined,
          undefined,
          undefined,
          now,
          refiningRecentFrom(refiningOutcome),
          refiningOutcome?.stopReason,
        ),
        scavenge,
      });

      if (context.action?.actionId !== ACTION_IDS.travel || !travel) {
        return stateFor({
          status: "refused",
          reason: "no_travel",
          message: "Scavenge is only available during an active walk.",
        });
      }

      if (travel.scavengeOutcomeId !== null) {
        return stateFor({
          status: "refused",
          reason: "already_claimed",
          message: "This Travel leg's Scavenge opportunity has already been claimed.",
        });
      }

      const balance = getEffectiveGameBalance();
      const timing = scavengeWindowAt({
        travelStartedAt: context.action.startedAt,
        opportunityStartTick: travel.scavengeOpportunityStartTick,
        now,
        claimed: false,
      });
      if (timing.lifecycle === "waiting") {
        return stateFor({
          status: "refused",
          reason: "not_open",
          message: "There is nothing to Scavenge yet.",
        });
      }
      const claimGraceExpiresAt = timing.expiresAt.getTime() + balance.travel.scavenge.claimGraceMs;
      if (timing.lifecycle === "missed" && now.getTime() >= claimGraceExpiresAt) {
        return stateFor({
          status: "refused",
          reason: "missed",
          message: "The Scavenge window has expired for this Travel leg.",
        });
      }

      const playSnapshot = await loadPlaySnapshot(transaction, context.character.id);
      const snapshot = {
        existingStacks: playSnapshot.stacks,
        slotsAvailable: playSnapshot.slotsAvailable,
        massAvailableGrams: playSnapshot.massAvailableGrams,
      };
      const capacity = planPossibleAwardAdditions(
        snapshot.existingStacks,
        scavengePossibleAwardSpecs(balance),
        snapshot.slotsAvailable,
        snapshot.massAvailableGrams,
      );
      if (!capacity.ok) {
        return stateFor({
          status: "refused",
          reason: "capacity_blocked",
          message:
            capacity.reason === "mass"
              ? "Scavenge needs more carried-mass capacity for every possible find."
              : "Scavenge needs a free inventory slot for every possible find.",
        });
      }

      const outcome = resolveScavengeOutcome(random.nextBasisPoints());
      if (outcome.itemId) {
        const item = scavengeAwardCapacitySpec(outcome.itemId, outcome.quantity, balance);
        const plan = planExactStackAddition(
          snapshot.existingStacks,
          item.itemId,
          item.quantity,
          item.stackLimit,
          snapshot.slotsAvailable,
          snapshot.massAvailableGrams,
          item.itemWeight,
        );
        if (!plan.ok) throw new Error("Scavenge award no longer fits after capacity preflight");
        await addStackableItem(transaction, {
          characterId: context.character.id,
          plan: plan.plan,
          now,
        });
      }

      await transaction.insert(characterScavengeReveals).values({
        characterId: context.character.id,
        outcomeId: outcome.id,
        awardQuantity: outcome.quantity,
        claimedAt: now,
      });

      await transaction
        .update(characterTravelState)
        .set({ scavengeOutcomeId: outcome.id, scavengeAwardQuantity: outcome.quantity })
        .where(
          and(
            eq(characterTravelState.characterId, context.character.id),
            isNull(characterTravelState.scavengeOutcomeId),
          ),
        );

      return stateFor({
        status: "claimed",
        outcome: serializeScavengeOutcome({ ...outcome, outcomeId: outcome.id }),
      });
    },
    now,
  );
}

/** Presentation-only, idempotent dismissal of one committed Scavenge reveal. */
export async function acknowledgeScavengeReveal(
  userId: string,
  characterId: string,
  revealId: string,
  now = new Date(),
): Promise<ScavengeAcknowledgmentResult> {
  return withLockedOwnedCharacter(userId, characterId, async (transaction, context) => {
    const deleted = await transaction
      .delete(characterScavengeReveals)
      .where(
        and(
          eq(characterScavengeReveals.id, revealId),
          eq(characterScavengeReveals.characterId, context.character.id),
        ),
      )
      .returning({ id: characterScavengeReveals.id });
    return {
      state: await stateFromTransaction(
        transaction,
        context.character.id,
        { successes: 0, failures: 0, awardedXp: 0 },
        undefined,
        undefined,
        undefined,
        context.character,
        now,
      ),
      acknowledged: deleted.length > 0,
    };
  });
}
