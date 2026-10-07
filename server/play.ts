import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activeActions,
  cargoHoldItemInstances,
  cargoHoldStacks,
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
  siteStashContainers,
  siteStashItemInstances,
  siteStashStacks,
} from "@/db/rune-space";
import {
  getEffectiveGameBalance,
  getEquipmentDefinition,
  getItemDefinition,
  getMiningToolDefinition,
  getRepairTargetBalance,
  type MiningToolChargedEffect,
  fabricationRecipeForActionId,
  fabricationRecipes,
  miningActionIds,
  miningLevelThresholds,
  miningSourceForActionId,
  miningSources,
  refiningActionIds,
  refiningRecipeForActionId,
  refiningRecipeIsDeterministic,
  refiningRecipes,
  repairTargetBalances,
  repairTargetForActionId,
  skillLevelThresholds,
  standardSkillLevelThresholds,
  tinkeringTargetForActionId,
  tinkeringTargets,
  weldingActionIds,
  weldingCadenceActionIds,
  workOrderSectionXp,
  type EffectiveGameBalance,
} from "@/game/config/balance";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import { getSkillPresentation } from "@/game/content/skill-presentation";
import {
  ACTION_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  REPAIR_TARGET_IDS,
  SKILL_IDS,
  type RepairTargetId,
  type TravelMode,
} from "@/game/config/foundations";
import { isTravelReplaceableAction } from "@/game/domain/travel-replacement";
import {
  contributionIsEmpty,
  deriveCompletedRepairTargetIds,
  planRepairMaterialContribution,
  repairComplete,
  repairMaterialProgress,
  repairMaterialsComplete,
  type RepairTargetState,
} from "@/game/domain/welding-repair";
import { resolveLocationState, type LocationStateFacts } from "@/game/domain/location-state";
import { LOCATIONS } from "@/game/content/locations";
import { getSiteStash } from "@/game/content/site-stashes";
import { getRepairTarget } from "@/game/content/repair-targets";
import { loadLocationStateFacts } from "@/server/location-state";
import { POWER_ANNEX_REWARD_SOURCE_ID, pacificResetDate } from "@/game/domain/power-annex";
import { powerAnnexNow } from "@/server/power-annex-clock";
import { MERCHANTS } from "@/game/content/merchants";
import { merchantDailyAllowances, type DailyPurchaseAllowance } from "@/game/domain/trade";
import { loadMerchantDailyPurchases } from "@/server/merchant-daily-purchases";
import {
  carriedItemMassGrams,
  isCompatibleEquipmentAssignment,
  unmetEquipRequirement,
  type EquipmentTarget,
} from "@/game/domain/equipment";
import {
  planSiteStashRemoval,
  planSiteStashSwap,
  siteStashSlotCapacity,
} from "@/game/domain/site-stash";
import {
  deriveCarriedUniqueItems,
  planExactStackAddition,
  planPossibleAwardAdditions,
} from "@/game/domain/inventory";
import {
  miningAttemptDurationTicks,
  miningSecondaryFindFacts,
  miningSuccessChanceBps,
  miningToolUsable,
  miningYieldRange,
  normalizeCutterCharge,
  type MiningRandom,
  type MiningStopReason,
} from "@/game/domain/mining";
import {
  refiningAwardFacts,
  refiningRecipeUnlocked,
  refiningAffordableBatches,
  refiningSuccessChanceBps,
  type RefiningStopReason,
} from "@/game/domain/refining";
import { skillLevelProgress } from "@/game/domain/progression";
import {
  projectCharacterProgression,
  type CharacterProgression,
} from "@/game/domain/character-progression";
import {
  planTransportTravel,
  planTravel,
  travelDurationTicks,
  travelOffersScavenge,
} from "@/game/domain/travel";
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
import { loadAutoDiscardSlag } from "@/server/character-preferences";
import { loadUnpinnedMissionIds } from "@/server/mission-pins";
import {
  createRefiningResolver,
  e2eRefiningRandom,
  type PersistedRefiningOutcome,
  type RefiningRunState,
} from "@/server/refining";
import {
  createWeldingResolver,
  loadRepairTargetStates,
  UNSTARTED_REPAIR,
  type PersistedWeldingOutcome,
  type WeldingSnapshot,
} from "@/server/welding";
import {
  createMiningResolver,
  defaultMiningRandom,
  type MiningRunState,
  type PersistedMiningOutcome,
} from "@/server/mining";
import {
  normalizePersistedMiningAttempts,
  normalizePersistedRefiningAttempts,
} from "@/server/run-history";
import { loadCompletedMissionIds, loadMissionProjections } from "@/server/mission-state";
import { missOpenRepairCleanPass } from "@/server/welding";
import {
  createPracticeWeldingResolver,
  interruptPracticeWelding,
  loadPracticeRow,
  loadPracticeUnlocked,
  practiceRunStateFromRow,
  practiceStateFromRow,
  type PersistedPracticeOutcome,
  type PracticeRunState,
} from "@/server/practice-welding";
import { RUSK_RECOVERY_CONTENT } from "@/game/content/rusk-recovery";
import {
  cleanPassOpportunities,
  type CleanPassRandom,
  type CleanPassState,
} from "@/game/domain/clean-pass";
import { getWorkOrder } from "@/game/content/work-orders";
import { deriveWorkbenchOccupancy } from "@/game/domain/workbench";
import { practiceAffordableWelds, type PracticeWeldState } from "@/game/domain/practice-welding";
import {
  BOUNDED_RUN_DEFAULT_QUANTITY,
  boundedRunSelectionFromColumn,
} from "@/game/domain/bounded-run";
import { isMissionAccepted } from "@/server/mission-state";
import {
  createWorkOrderWeldingResolver,
  ensureWorkOrderBoard,
  loadWorkOrderBoard,
  loadWorkOrderRefreshState,
  missOpenWorkOrderCleanPass,
  takeWorkOrderCompletion,
} from "@/server/work-orders";
import { loadRepairAccess } from "@/server/repair-access";
import { recordTrackedActivity, type TrackedActivity } from "@/server/mission-progress";
import type { MissionProjection } from "@/game/domain/missions";
import { loadPlaySnapshot, type PlaySnapshot } from "@/server/play-state";
import {
  createFabricationResolver,
  defaultOverrideRandom,
  fabricationRunStateFromRow,
  isFabricationAction,
  loadFabricationRow,
  loadFabricationUnlocked,
  overrideFromRow,
  type FabricationRunState,
} from "@/server/fabrication";
import type { FabricationCommandError } from "@/server/fabrication-commands";
import {
  createTinkeringResolver,
  isTinkeringAction,
  loadTinkeringRow,
  loadTinkeringUnlocked,
  tinkeringCycleFromRow,
  tinkeringRunStateFromRow,
  type TinkeringRunState,
} from "@/server/tinkering";
import type { TinkeringCommandError } from "@/server/tinkering-commands";
import {
  fabricationAffordableBatches,
  fabricationRecipeUnlocked,
  type FabricationStopReason,
} from "@/game/domain/fabrication";
import {
  manualOverrideMultiplierLabel,
  manualOverrideXp,
  overrideCanPush,
  overridePushes,
  overrideSafeRange,
  type OverrideRandom,
  type OverrideTrend,
} from "@/game/domain/manual-override";
import {
  isUsableMiningCutter,
  tinkeringAffordableBatches,
  tinkeringDurationTicks,
  tinkeringScrapYield,
  tinkeringUnlocked,
  tinkeringXp,
  usableMiningCutterCount,
  type TinkeringStopReason,
} from "@/game/domain/tinkering";

function itemStackLimit(itemId: string, balance = getEffectiveGameBalance()): number {
  const definition = getItemDefinition(itemId, balance);
  return definition?.kind === "stack" ? definition.stackLimit : 1;
}

/**
 * A unique instance's displayable charge (#233): present for any authored
 * Mining tool, validated against that tool's own maximum, and absent for
 * everything else.
 */
function chargeOf(
  instance: { itemId: string; currentCharge: number | null },
  balance: EffectiveGameBalance,
): number | undefined {
  const tool = getMiningToolDefinition(instance.itemId, balance);
  return tool ? normalizeCutterCharge(instance.currentCharge, tool) : undefined;
}

/** One instance as an equipment slot presents it, from its equipment definition (#233). */
function slotItemProjection(
  instance: { id: string; itemId: string },
  miningLevel: number,
  balance: EffectiveGameBalance,
): EquipmentSlotItemProjection {
  const definition = getEquipmentDefinition(instance.itemId, balance);
  const unmet = unmetEquipRequirement(instance.itemId, miningLevel, balance);
  return {
    itemInstanceId: instance.id,
    itemId: instance.itemId,
    name: resolveItemPresentation(instance.itemId, instance.itemId).displayName,
    massGrams: carriedItemMassGrams(instance.itemId, balance),
    ...(definition?.kind === "container" ? { slotCapacity: definition.slotCapacity } : {}),
    ...(unmet ? { requiredMiningLevel: unmet.requiredMiningLevel } : {}),
  };
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
  /** Present only for a Mining tool, against its own authored maximum (#233). */
  currentCharge?: number;
};

/**
 * One repair target's authoritative projection (#172).
 *
 * Identical for every target: the Crash Site Cargo Hold and Holo Hollow's Crew
 * Stop are the same shape with different recipes, so a repair surface renders
 * from this rather than from its own bespoke state.
 */
/**
 * The Clean Pass opportunities of the Welding work unit currently in progress
 * (#190).
 *
 * Present only while that work unit's Welding action is the active action.
 * `sectionsCompleted + 1` is the section being welded right now, so a surface
 * knows a window is open when an unresolved opportunity names that section —
 * the same positional truth the authoritative claim is validated against. The
 * live countdown is the ordinary `activeAction.nextAttemptAt` every Welding
 * surface already renders, so there is no second timing channel to drift.
 */
export type CleanPassProjection = {
  opportunities: readonly { section: number; outcome: "claimed" | "missed" | null }[];
  sectionsCompleted: number;
};

/**
 * The Work Orders terminal at Rusk Recovery (#190).
 *
 * Scenery until 10,000 Hours is turned in, and this slice ships zero playable
 * Work Orders — so the revealed surface is a real but empty one. The reveal is
 * derived here from the Mission record and the required level is authored
 * balance, which keeps the surface free of Mission IDs and level literals.
 */
/** One posting on the board, exactly as the terminal renders it. */
export type WorkOrderPostingProjection = {
  slotIndex: number;
  workOrderId: string;
  title: string;
  clientName: string;
  description: string;
  requiredWeldingLevel: number;
  /** The additional Refining floor this job authors, when it authors one (#217). */
  requiredRefiningLevel?: number;
  materials: readonly { itemId: string; itemName: string; quantity: number; carried: number }[];
  sections: number;
  payoutCredits: number;
  /** This posting is the character's active job. */
  inProgress: boolean;
  /** Every authoritative acceptance condition currently holds. */
  acceptable: boolean;
  /**
   * Why acceptance would be refused right now, so the surface can say so in
   * words instead of presenting a disabled control with no explanation.
   */
  blockedReason?:
    | "welding_level"
    | "refining_level"
    | "materials"
    | "workbench_occupied"
    | "work_order_active"
    | "not_here";
};

/**
 * ForceSales' daily full-board refresh (#217).
 *
 * `unlocked` is the board's own unlock AND Refining 5 — a single authoritative
 * fact the surface, and the optional Wade topic gated on the same thing, both
 * read rather than re-deriving from a Mission ID and a level literal.
 */
export type WorkOrderRefreshProjection = {
  unlocked: boolean;
  requiredRefiningLevel: number;
  meetsRefiningLevel: boolean;
  /** One refresh is available for today's RuneSpace Pacific reset date. */
  availableToday: boolean;
  /**
   * This character has never completed a successful refresh. Persists across
   * refresh, reconnect, and login until the first one commits — derived from
   * durable refresh history, never a standalone tutorial-seen flag.
   */
  firstUnlock: boolean;
  resetDate: string;
};

/** The accepted job on the bench, and its durable Welding progress. */
export type ActiveWorkOrderProjection = {
  workOrderId: string;
  title: string;
  clientName: string;
  sections: number;
  sectionsCompleted: number;
  payoutCredits: number;
  xpPerSection: number;
  /** The Work Order Welding action is the character's current active action. */
  active: boolean;
  cleanPass?: CleanPassProjection;
};

export type WorkOrdersProjection = {
  revealed: boolean;
  requiredWeldingLevel: number;
  /** Whether the player meets the level real client work will require. */
  meetsWeldingLevel: boolean;
  /**
   * 10,001 Hours is accepted, so the board is the player's — permanently, and
   * regardless of whether that Mission has been turned in yet (#207).
   */
  unlocked: boolean;
  /** The Mission is offerable right now, so the terminal can point at Wade. */
  missionAvailable: boolean;
  postings: readonly WorkOrderPostingProjection[];
  active?: ActiveWorkOrderProjection;
  refresh: WorkOrderRefreshProjection;
  /**
   * A job that genuinely completed during THIS request's reconciliation, and
   * what it paid (#207).
   *
   * Transient by design and present exactly once: on the response that
   * discovered the completion, whether the player watched the last section
   * resolve or the shared lazy path resolved it for them on their first load
   * after being away. The surface must not infer a completion from the job
   * disappearing — an operator Mission reset does that too, and a receipt for a
   * payout that never happened is worse than no receipt at all.
   */
  recentCompletion?: {
    workOrderId: string;
    title: string;
    clientName: string;
    payoutCredits: number;
  };
};

/** Repeatable Practice Welding at Wade's Workbench (#190). */
export type PracticeProjection = {
  /**
   * The Workbench is the player's to use: 10,000 Hours is accepted, which stays
   * true after it completes. Before that the bench is scenery — no control, no
   * disabled state, no teaser.
   */
  unlocked: boolean;
  /** The Practice action is the character's current active action. */
  active: boolean;
  /** Whole sections resolved for the weld in progress. */
  sectionsCompleted: number;
  sectionsPerWeld: number;
  /** A partial weld whose two Scrap are already spent, waiting to be resumed. */
  cycleActive: boolean;
  /** Loose carried Scrap Metal available for the NEXT fresh weld. */
  scrapAvailable: number;
  scrapPerWeld: number;
  /**
   * How many complete welds the Scrap carried right now pays for, a paid
   * partial weld counting as the first (#229): the largest number the run
   * selector offers, and what Start revalidates a number against. Not what Max
   * does — Max runs until the Scrap cannot pay for another weld.
   */
  affordableWelds: number;
  /**
   * The durable "finish this weld, then stop" intent (#207 follow-up). The
   * authoritative armed state for "Stop After Current Weld" — the UI reads
   * this rather than faking the toggle with local React state, since the
   * intent survives a reload exactly as the partial weld itself does.
   */
  finishCurrentWeld: boolean;
  /** Why the last run stopped on its own, for the ordinary run presentation. */
  lastStopReason?: string;
  run: PracticeRunState;
  cleanPass?: CleanPassProjection;
};

/**
 * One material row of a repair, derived generically from the authored recipe
 * (#209). `name` is resolved here so no repair surface has to know which items
 * a particular target wants.
 */
export type RepairMaterialProjection = {
  itemId: string;
  name: string;
  required: number;
  contributed: number;
  remaining: number;
  /** How much of this material the character could hand over right now. */
  availableContribution: number;
  /** The target's authored flavour for this row, when it authors one. */
  note?: string;
};

export type RepairProjection = {
  targetId: string;
  /** The recipe's material rows, in authored order. */
  materials: readonly RepairMaterialProjection[];
  weldingProgress: number;
  weldingIncrements: number;
  materialComplete: boolean;
  complete: boolean;
  repairAvailable: boolean;
  /** Present only while this repair's Welding action is active (#190). */
  cleanPass?: CleanPassProjection;
  completedAt?: string;
  /** True when at least one material row could receive something right now. */
  canContribute: boolean;
};

/**
 * The Mining source a location currently offers (#209).
 *
 * Exactly one source is reachable at a time — The Jag's Ferrite Shale, or an
 * opened Deep Jag's Galvanite — so the Mining surface reads this instead of a
 * single global `successChanceBps` that silently meant Ferrite.
 */
export type MiningSourceProjection = {
  actionId: string;
  itemId: string;
  itemName: string;
  /**
   * The items this source can turn up as Secondary Finds (#308), from its
   * authored table. The run summary labels these "found"; it never infers them.
   */
  secondaryFindItemIds: readonly string[];
  /** An uncharged attempt here with the Mining tool actually equipped (#233). */
  attemptDurationTicks: number;
  /** A charged attempt here with the Mining tool actually equipped (#233). */
  boostedAttemptDurationTicks: number;
  successChanceBps: number;
  successXp: number;
  yieldMinimum: number;
  yieldMaximum: number;
  /** A charged success's yield with the equipped tool: its ordinary range plus any extra ore (#233). */
  chargedYieldMinimum: number;
  chargedYieldMaximum: number;
};

/** The equipped Mining tool as Equipment and Mining present it (#233). */
export type EquippedMiningToolProjection = {
  itemId: string;
  name: string;
  currentCharge: number;
  maximumCharge: number;
  requiredMiningLevel: number;
  /** The character's Mining level meets the tool's own requirement. */
  usable: boolean;
  /** Permanent base-duration multiplier, in basis points (10,000 is 1.00×). */
  baseDurationMultiplierBps: number;
  /** What a loaded Power Cell does for this tool: speed, or extra ore per success. */
  chargedEffect: MiningToolChargedEffect;
  /** Uncharged and charged attempts at the source in reach, or its baseline source. */
  attemptDurationTicks: number;
  boostedAttemptDurationTicks: number;
};

/** An item in, or eligible for, one equipment slot (#233: from its equipment definition). */
export type EquipmentSlotItemProjection = {
  itemInstanceId: string;
  itemId: string;
  name: string;
  massGrams: number;
  /** A container's Inventory slot contribution. */
  slotCapacity?: number;
  /** Present only while the character's Mining level is below the item's requirement. */
  requiredMiningLevel?: number;
};

/** One authored Refining recipe as the console presents it (#209). */
export type RefiningRecipeProjection = {
  actionId: string;
  outputItemId: string;
  outputName: string;
  /** Per-batch output: the recipe tile's badge, never the selected run's total. */
  outputQuantity: number;
  /** Stack limit for a stackable output's tile (#239); absent for a unique item. */
  outputStackLimit?: number;
  minimumLevel: number;
  /** Whether the character's Refining level authorizes starting it. */
  unlocked: boolean;
  attemptDurationTicks: number;
  successChanceBps: number;
  successXp: number;
  /** Zero for a deterministic recipe, which has no failure (#229). */
  failureXp: number;
  /** Always succeeds and never rolls (#229): the intentional Slag recipes. */
  deterministic: boolean;
  /**
   * How many batches of this recipe the inputs carried right now pay for
   * (#229): the largest number the run selector offers, and what Start
   * revalidates a number against. Not a prediction and not what Max does —
   * Max runs until the ordinary preflight refuses the next attempt, however
   * many that turns out to be. Zero when the recipe is locked.
   */
  affordableBatches: number;
  inputs: readonly { itemId: string; name: string; quantity: number; carried: number }[];
  /** Every mutually exclusive thing a failure can produce, already named. */
  failureOutcomes: readonly (readonly { itemId: string; name: string; quantity: number }[])[];
  /** True when the character is carrying enough of every input right now. */
  inputsAvailable: boolean;
};

/** One authored Fabrication recipe as the Fabricate mode presents it (#232). */
export type FabricationRecipeProjection = {
  actionId: string;
  outputItemId: string;
  outputName: string;
  /** Per-batch output: the tile's badge, never the selected run's total. */
  outputQuantity: number;
  /** Stack limit for a stackable output's tile; absent for a unique item. */
  outputStackLimit?: number;
  minimumLevel: number;
  /** The character's Fabrication level authorizes it. */
  unlocked: boolean;
  durationTicks: number;
  baseXp: number;
  inputs: readonly { itemId: string; name: string; quantity: number; carried: number }[];
  /** Enough of every input is carried for one batch right now. */
  inputsAvailable: boolean;
  /**
   * How many batches the inputs carried right now pay for (#229): the most a
   * number may ask for, and what Start revalidates against. Not a prediction
   * and not what Max does.
   */
  affordableBatches: number;
};

/** The Manual Override machine on the current workpiece, as the live panel shows it. */
export type ManualOverrideProjection = {
  load: number;
  trend: OverrideTrend;
  pushes: number;
  maximumPushes: number;
  locked: boolean;
  canPush: boolean;
  multiplierLabel: string;
  /** What this workpiece would pay if it resolved now at the multiplier earned. */
  xpIfLockedIn: number;
  lastPush?: {
    feed: number;
    load: number;
    outcome: "safe" | "exact";
    safeRange: { minimum: number; maximum: number };
  };
  dial: { minimum: number; maximum: number };
};

/** The Fabrication Station's Fabricate side (#232). */
export type FabricationProjection = {
  /** Return the Favor is accepted: the station is the player's to use. */
  unlocked: boolean;
  recipes: readonly FabricationRecipeProjection[];
  /** The station's Manual Override toggle. */
  manualOverrideEnabled: boolean;
  /** The workpiece on the machine, when there is one. */
  workpiece?: {
    recipeActionId: string;
    /** The run's number for this workpiece, which Push and Lock In echo back. */
    sequence: number;
    startedAt: string;
    endsAt: string;
    /** The Stop request: finish this workpiece, then start no other. */
    finishCurrent: boolean;
    override?: ManualOverrideProjection;
  };
  run: FabricationRunState;
  lastStopReason?: FabricationStopReason;
};

/** One Tinkering target as the Tinker mode presents it (#232). */
export type TinkeringTargetProjection = {
  actionId: string;
  itemId: string;
  name: string;
  /** One complete authored output batch — the tile's badge. */
  batchQuantity: number;
  stackLimit?: number;
  minimumLevel: number;
  unlocked: boolean;
  durationTicks: number;
  xp: number;
  scrap: number;
  /** Complete batches carried, before the last-Cutter guard. */
  carriedBatches: number;
  /** Complete batches that may begin — the most a number may ask for (#229). */
  affordableBatches: number;
  /** Carried batches exist, but the last-Cutter guard forbids every one of them. */
  lastCutterBlocked: boolean;
};

/** The Fabrication Station's Tinker side (#232). */
export type TinkeringProjection = {
  /** Tansy's Return the Favor demonstration has happened. */
  unlocked: boolean;
  active: boolean;
  autoDiscardScrap: boolean;
  finishCurrent: boolean;
  /** A committed cycle — its batch already destroyed — waiting or running. */
  cycle?: { targetActionId: string; ticksCompleted: number; durationTicks: number };
  targets: readonly TinkeringTargetProjection[];
  run: TinkeringRunState;
  lastStopReason?: TinkeringStopReason;
};

/**
 * One World Location's derived player-facing state (#209), resolved through
 * `game/domain/location-state` rather than by any surface's own conditionals.
 */
export type LocationStateProjection = {
  locationId: string;
  variantId?: string;
  description: string;
  travelable: boolean;
  mapStatus?: string;
  availableActionIds: readonly string[];
  scene: {
    asset: string;
    width: number;
    height: number;
    alt: string;
    focal?: { x: number; y: number };
  };
};

export type CargoHoldState = {
  repair: RepairProjection;
  stacks: readonly CargoHoldStackState[];
  uniqueItems: readonly CargoHoldUniqueItemState[];
  slotsUsed: number;
  capacitySlots: number;
};

/** One ordinary container a stash could take, as the stash surface presents it (#284). */
export type SiteStashContainerState = {
  itemInstanceId: string;
  itemId: string;
  name: string;
  slotCapacity: number;
  massGrams: number;
};

/**
 * The character's stash at the site they are standing in (#284).
 *
 * Present only when that site is an authored stash site AND the stash is
 * already meaningful to this character: its Welding gate is met (and any
 * prerequisite repair is done), or the mount is already built. A character who
 * has not earned it sees no panel, no teaser and no disabled control, because
 * there is no `siteStash` for the browser to render one from. (The generic
 * `repairs` map still carries every repair target's public recipe, as it does
 * for every target; nothing renders a hidden mount from it.)
 *
 * Everything an affordance needs is decided here from the same pure rules the
 * commands enforce; the browser derives nothing it could get wrong.
 */
export type SiteStashState = {
  locationId: string;
  /** The mount's construction, projected exactly like every other repair target. */
  repair: RepairProjection;
  mountBuilt: boolean;
  container?: SiteStashContainerState;
  stacks: readonly CargoHoldStackState[];
  uniqueItems: readonly CargoHoldUniqueItemState[];
  slotsUsed: number;
  /** The installed container's authored slot capacity; 0 until one is installed. */
  capacitySlots: number;
  /** Carried, unequipped containers: the candidates for Install or Swap. */
  carriedContainers: readonly SiteStashContainerState[];
  /** The subset the server would accept as a swap replacement right now. */
  swappableContainerInstanceIds: readonly string[];
  /**
   * Why Remove Container would be refused right now, from the same pure rule
   * the command enforces: the stash is not empty, or the returned container
   * would not fit carried Inventory. Absent means it can be removed (or there
   * is no container).
   */
  removeBlockedReason?: "not_empty" | "carried_capacity";
};

/**
 * Why an activity stopped on its own, for the surface that owns it (#209).
 *
 * Discriminated by the activity rather than by one hard-coded action ID: a run
 * that stopped was a Mining run or a Refining run, and which source or recipe
 * it was is the run state's business. The durable stop reason is stored per
 * activity, so there is nothing here that could name the specific source
 * honestly anyway — and pretending a Galvanite stop was a Ferrite Shale stop is
 * exactly the lie this replaces.
 */
export type ActivityStop =
  | { activity: "mining"; reason: MiningStopReason }
  | { activity: "refining"; reason: RefiningStopReason };

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
      reason:
        | "no_travel"
        | "no_scavenge_on_this_journey"
        | "not_open"
        | "missed"
        | "already_claimed"
        | "capacity_blocked"
        /** A walk begun while Scavenge is suppressed after a Turn Back (#312). */
        | "scavenge_suppressed";
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
  /**
   * The active character's canonical Character Level and every skill the game
   * defines, projected through the shared cross-skill boundary the
   * same-location player inspector uses (#213). The Character surface reads
   * this rather than a screen-specific skill list, so a future skill appears
   * there the moment the game defines it.
   */
  progression: CharacterProgression;
  /**
   * The character's persisted total XP keyed by stable skill ID; an absent
   * skill is authoritative zero. The projection above deliberately omits IDs,
   * so the operator console reads per-skill totals here (#242).
   */
  skillTotalXp: Readonly<Record<string, number>>;
  mining: { totalXp: number; level: number; xpToNextLevel?: number; xpIntoLevel: number };
  refining: { totalXp: number; level: number; xpToNextLevel?: number; xpIntoLevel: number };
  welding: { totalXp: number; level: number; xpToNextLevel?: number; xpIntoLevel: number };
  fabrication: { totalXp: number; level: number; xpToNextLevel?: number; xpIntoLevel: number };
  /** The Fabrication Station's Fabricate side (#232). */
  fabricationStation: FabricationProjection;
  /** The Fabrication Station's Tinker side (#232). */
  tinkering: TinkeringProjection;
  /** One current Fabrication refusal, for the Fabricate surface (#232). */
  fabricationError?: FabricationCommandError;
  /** One current Tinkering refusal, for the Tinker surface (#232). */
  tinkeringError?: TinkeringCommandError;
  /**
   * The Mining source reachable where the character is standing, or undefined
   * where none is (#209). Replaces the old global `successChanceBps`, which
   * could only ever describe Ferrite Shale.
   */
  miningSource?: MiningSourceProjection;
  /** Every authored Refining recipe, locked ones included (#209). */
  refiningRecipes: readonly RefiningRecipeProjection[];
  /**
   * Every World Location's derived state, keyed by location ID (#209). The Map
   * and the Location surface read this rather than re-deriving scene, status,
   * or reachability from Mission and repair rows themselves.
   */
  locationStates: Readonly<Record<string, LocationStateProjection>>;
  /**
   * Everything the character is carrying, keyed by item ID (#209).
   *
   * Replaces the per-item `refinedFerriteQuantity` / `slagQuantity` tallies. A
   * new material used to mean a new field on this state and a new line in every
   * surface that read it; now a surface asks for the item it cares about, which
   * is what lets the Mining panel show Galvanite at Deep Jag without knowing
   * that Galvanite exists.
   */
  carriedByItemId: Readonly<Record<string, number>>;
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
    /**
     * Whichever authored Mining tool is equipped (#233) — its own identity,
     * charge against its own maximum, and its own effects at the source in
     * reach. Never "the Salvage Cutter" by assumption.
     */
    miningTool?: EquippedMiningToolProjection;
    slots: readonly {
      target: EquipmentTarget;
      label: string;
      item?: EquipmentSlotItemProjection;
      eligibleItems: readonly EquipmentSlotItemProjection[];
    }[];
  };
  run: MiningRunState;
  refiningRun: RefiningRunState;
  /**
   * Every repair target's authoritative projection, keyed by target ID (#172).
   * A repair surface reads its own entry here; nothing reconstructs recipes,
   * progress, or availability on the client.
   */
  repairs: Readonly<Record<string, RepairProjection>>;
  /** Repeatable Practice Welding state (#190). */
  practice: PracticeProjection;
  /**
   * The character-wide Auto-discard Slag preference (#256). One value that both
   * Practice Welding and Refining read and both toggles write; neither
   * projection carries its own copy.
   */
  autoDiscardSlag: boolean;
  /**
   * The Missions this character has unpinned (#325). Absence means pinned, so
   * this lists only explicit overrides. A presentation preference that decides
   * which active Missions Current Missions shows, and nothing else: `missions`
   * and every guidance target are projected without it.
   */
  unpinnedMissionIds: readonly string[];
  /** The Work Orders terminal's authoritative visibility and state (#190). */
  workOrders: WorkOrdersProjection;
  cargoHold: CargoHoldState;
  /** The stash at the character's current site, when one is theirs to see (#284). */
  siteStash?: SiteStashState;
  recentResult: { successes: number; failures: number; awardedXp: number };
  refiningRecentResult: { successes: number; failures: number; awardedXp: number };
  /**
   * One current stop event — which action stopped, and why. Never two
   * parallel channels; Mining-only reasons cannot leak into Refining UI.
   */
  stop?: ActivityStop;
  commandError?: "another_action_active";
  /** One current Practice Welding refusal, for the Workbench surface (#190). */
  practiceError?:
    | "practice_unavailable_here"
    | "practice_locked"
    | "insufficient_scrap"
    /** The one bench already holds an unfinished customer Work Order (#207). */
    | "workbench_occupied"
    /** "Finish current weld and stop" was asked for with nothing on the bench. */
    | "no_weld_in_progress"
    /** The selected weld count exceeds what the Scrap now pays for (#229); choose again. */
    | "practice_quantity_unavailable";
  /** Authoritative persistent current location (stable ID from the registry). */
  location: { currentLocationId: string };
  /**
   * Authoritative character-scoped Credit balance (issue #159). This is the
   * only balance any surface may display; the client never computes, caches, or
   * submits a balance of its own.
   */
  credits: number;
  /** Present only while the character is in transit (server-authoritative). */
  travelState?: {
    originLocationId: string;
    destinationLocationId: string;
    /** How this Journey is being made; a ride is never a walk (#172). */
    mode: TravelMode;
    startedAt: string;
    arrivesAt: string;
    /**
     * True for a walk begun while Scavenge is suppressed after a Turn Back
     * (#312): the Journey has no window at all, and says so. Always false for
     * a ride, which never had one to suppress.
     */
    scavengeSuppressed: boolean;
    /** Present only for an ordinary, unsuppressed walk. A paid ride offers nothing to scavenge. */
    scavenge?: {
      opportunityStartTick: number;
      opensAt: string;
      expiresAt: string;
      outcome?: ScavengeResolvedOutcome;
    };
  };
  /**
   * True while a Turn Back from a walk is still suppressing walking Scavenge
   * (#312). Durable and server-owned: it survives reload and only a completed
   * walking Journey clears it.
   */
  scavengeSuppressed: boolean;
  /** Committed Scavenge outcomes awaiting presentation acknowledgment. */
  scavengeReveals: readonly ScavengeReveal[];
  /** Current Pacific-day claim state, only when the character is at the Annex. */
  powerAnnex?: { resetDate: string; claimed: boolean };
  /**
   * Today's allowance on every daily-limited merchant line (#230), keyed by
   * merchant then item — Wade's Scrap and Bix's Power Cells. The Trade surface
   * reads its merchant's entry; the purchase command re-reads the ledger under
   * the character lock and alone decides.
   */
  merchantDailyPurchases: Readonly<
    Record<string, Readonly<Record<string, DailyPurchaseAllowance>>>
  >;
  /** Set when a begin-travel command was refused by the authoritative rules. */
  travelError?:
    | "route_blocked"
    | "unknown_destination"
    | "same_location"
    | "not_adjacent"
    | "already_traveling"
    | "mining_unavailable_here"
    | "unknown_route"
    | "route_locked"
    | "insufficient_credits";
  /** Set when a Start Refining command was refused outside the Processing Yard. */
  /**
   * Why a Refining start was refused. `refining_recipe_locked` is the
   * server-authoritative answer for a recipe whose minimum Refining level the
   * character has not reached (#209).
   */
  refiningError?:
    | "refining_unavailable_here"
    | "refining_recipe_locked"
    /** The selected batch count exceeds what the inputs now pay for (#229); choose again. */
    | "refining_quantity_unavailable";
  /** Set when the finite Crash Site Welding command cannot begin. */
  weldingError?: "welding_unavailable_here" | "welding_locked" | "repair_complete";
};

type PlayResolver = ActionResolver<unknown, unknown>;

type PlayResolverEntry = {
  resolver: PlayResolver;
  actionId: string;
};

function withTrackedActivityProgress<Snapshot, Outcome extends { characterId: string }>(
  resolver: ActionResolver<Snapshot, Outcome>,
  activity: TrackedActivity,
  attemptCount: (outcome: Outcome) => number,
): ActionResolver<Snapshot, Outcome> {
  return {
    ...resolver,
    persist: async (transaction, outcome, context) => {
      await resolver.persist(transaction, outcome, context);
      await recordTrackedActivity(transaction, {
        characterId: outcome.characterId,
        activity,
        metric: "attempts",
        attemptCount: attemptCount(outcome),
      });
    },
  };
}

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
  onPracticeOutcome?: (outcome: PersistedPracticeOutcome) => void,
  overrideRandom: OverrideRandom = defaultOverrideRandom(),
): PlayResolver {
  const refiningRandom = isCanonicalE2EMiningOverride()
    ? e2eRefiningRandom()
    : (random as import("@/game/domain/refining").RefiningRandom);
  const entries: PlayResolverEntry[] = [
    // One resolver per authored Mining source and per authored Refining recipe
    // (#209). The resolver itself is generic — it reads the source or recipe
    // back from the action ID it was invoked under — so a second ore and two
    // more recipes add registry entries rather than branches.
    ...miningActionIds().map((actionId) => ({
      actionId,
      resolver: withTrackedActivityProgress(
        createMiningResolver(random, onMiningOutcome),
        "mining",
        (outcome) => outcome.attempts.length,
      ) as PlayResolver,
    })),
    ...refiningActionIds().map((actionId) => ({
      actionId,
      resolver: withTrackedActivityProgress(
        createRefiningResolver(refiningRandom, onRefiningOutcome),
        "refining",
        (outcome) => outcome.resolvedAttempts.length,
      ) as PlayResolver,
    })),
    {
      actionId: ACTION_IDS.travel,
      resolver: createTravelResolver() as PlayResolver,
    },
    // One Welding resolver, registered under every repair target's own action
    // ID. The resolver reads the target from that ID, so `active_actions` keeps
    // its narrow shape and a new repair target adds no new resolution logic.
    ...weldingActionIds().map((actionId) => ({
      actionId,
      resolver: createWeldingResolver(onWeldingOutcome) as PlayResolver,
    })),
    {
      // A customer Work Order credits its Mission from its own authoritative
      // completion transaction rather than from resolved sections, so it is
      // deliberately NOT wrapped in `withTrackedActivityProgress`: a section is
      // not a completed job, and only finishing the job counts (#207).
      actionId: ACTION_IDS.workOrderWelding,
      resolver: createWorkOrderWeldingResolver(random) as PlayResolver,
    },
    {
      // Practice Welding counts COMPLETED welds through the same generic
      // tracked-activity path Mining and Refining use — never sections, never
      // starts, and with no Practice-specific Mission bookkeeping (#190).
      actionId: ACTION_IDS.practiceWelding,
      resolver: withTrackedActivityProgress(
        createPracticeWeldingResolver(random, onPracticeOutcome),
        "practice_welding",
        (outcome) => outcome.completedWelds,
      ) as PlayResolver,
    },
    // One Fabrication resolver under every authored recipe's action, and one
    // Tinkering resolver under every target's (#232). Each credits Missions
    // from its own persistence — successful workpieces and completed batches
    // only — rather than through `withTrackedActivityProgress`, because a
    // busted workpiece is a resolved unit that must count for nothing.
    ...fabricationRecipes().map((recipe) => ({
      actionId: recipe.actionId,
      resolver: createFabricationResolver(overrideRandom) as PlayResolver,
    })),
    ...tinkeringTargets().map((target) => ({
      actionId: target.actionId,
      resolver: createTinkeringResolver() as PlayResolver,
    })),
  ];
  return composePlayResolvers(entries);
}

/**
 * Provisions the full shared play state for a character on first play: skill
 * rows (Mining/Refining/Welding/Strength), Mining/Refining persistence rows,
 * and the starter container/equipment assignment.
 *
 * Repair-target state is deliberately NOT provisioned here (#172): an untouched
 * repair target is simply an absent row, so a character who has never welded
 * anything is already in its correct state and a new repair target needs no
 * backfill for existing characters.
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
/**
 * Project one repair target from its authoritative state plus the character's
 * carried materials. Recipe values are read from the target's balance spec, so
 * no surface ever hardcodes a second copy of them.
 */
/**
 * The Clean Pass projection for the work unit currently being welded (#190).
 *
 * Absent unless that unit's Welding action is active: an opportunity belongs to
 * work in progress, and a surface must never show one for work nobody is doing.
 */
function projectCleanPass(
  cleanPass: CleanPassState,
  sectionsCompleted: number,
  weldingActive: boolean,
): CleanPassProjection | undefined {
  if (!weldingActive) return undefined;
  const opportunities = cleanPassOpportunities(cleanPass).map((opportunity) => ({
    section: opportunity.section,
    outcome: opportunity.outcome,
  }));
  if (opportunities.length === 0) return undefined;
  return { opportunities, sectionsCompleted };
}

/**
 * Project the Work Orders terminal (#207).
 *
 * The board is seeded here, on the first authoritative touch after 10,001 Hours
 * is accepted, rather than as a side effect of that Mission's acceptance — the
 * generic Mission command has no business knowing that one Mission opens a
 * board. This runs inside the same locked transaction every command already
 * holds, and the insert is idempotent, so a refresh can never draw a second
 * board and two requests can never half-seed one.
 *
 * Every refusal reason is derived here as well, so the terminal can explain
 * itself in words rather than presenting three disabled controls.
 */
async function projectWorkOrders(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    weldingLevel: number;
    refiningLevel: number;
    currentLocationId: string;
    action: { actionId: string } | undefined;
    practice: PracticeWeldState;
    stacks: readonly { itemId: string; quantity: number }[];
    balance: EffectiveGameBalance;
    random: CleanPassRandom;
    resetDate: string;
    now: Date;
  },
): Promise<WorkOrdersProjection> {
  const { balance } = input;
  const revealed = (await loadCompletedMissionIds(transaction, input.characterId)).has(
    RUSK_RECOVERY_CONTENT.workOrdersRevealMissionId,
  );
  const unlocked = await isMissionAccepted(
    transaction,
    input.characterId,
    RUSK_RECOVERY_CONTENT.workOrdersMissionId,
  );
  const meetsWeldingLevel = input.weldingLevel >= balance.workOrders.requiredWeldingLevel;

  const base = {
    revealed,
    requiredWeldingLevel: balance.workOrders.requiredWeldingLevel,
    meetsWeldingLevel,
    unlocked,
    // At Welding 5 with the Mission not yet accepted, the terminal's honest
    // message is "go and talk to Wade" — never an empty board, which would say
    // there is no work when there is.
    missionAvailable: meetsWeldingLevel && !unlocked,
  };
  await ensureWorkOrderBoard(transaction, {
    characterId: input.characterId,
    unlocked,
    weldingLevel: input.weldingLevel,
    refiningLevel: input.refiningLevel,
    random: input.random,
    now: input.now,
  });
  const board = await loadWorkOrderBoard(transaction, input.characterId);

  // ForceSales (#217): the same board unlock, plus Refining 5, exposes one
  // manual full-board refresh per RuneSpace Pacific reset date.
  const requiredRefreshRefiningLevel = balance.workOrders.refresh.requiredRefiningLevel;
  const meetsRefreshRefiningLevel = input.refiningLevel >= requiredRefreshRefiningLevel;
  const refreshState = await loadWorkOrderRefreshState(transaction, {
    characterId: input.characterId,
    resetDate: input.resetDate,
  });
  const refresh: WorkOrderRefreshProjection = {
    unlocked: unlocked && meetsRefreshRefiningLevel,
    requiredRefiningLevel: requiredRefreshRefiningLevel,
    meetsRefiningLevel: meetsRefreshRefiningLevel,
    availableToday: unlocked && meetsRefreshRefiningLevel && !refreshState.refreshedToday,
    firstUnlock: !refreshState.everRefreshed,
    resetDate: input.resetDate,
  };

  const carried = new Map<string, number>();
  for (const stack of input.stacks) {
    carried.set(stack.itemId, (carried.get(stack.itemId) ?? 0) + stack.quantity);
  }
  const benchOccupancy = deriveWorkbenchOccupancy({
    practice: input.practice,
    activeWorkOrder: board.active,
  });
  // The terminal only renders in the yard, so an active action here is always
  // work at the bench — which the bench-occupancy reason below explains better
  // than a generic "you are not standing still" ever could.
  const atTheYard = input.currentLocationId === RUSK_RECOVERY_CONTENT.locationId;
  const benchBusy = input.action !== undefined;

  // The BOARD is gated on the unlock; a job already on the bench is not. It was
  // paid for out of the player's own pocket, so it stays visible and finishable
  // however the Mission that opened the board ends up — otherwise an operator
  // reset would strand a customer's job on the one bench forever (#207).
  const postings = (unlocked ? board.postings : []).flatMap(
    (posting): WorkOrderPostingProjection[] => {
      const definition = getWorkOrder(posting.workOrderId);
      if (!definition) return [];
      const materials = definition.materials.map((material) => ({
        itemId: material.itemId,
        itemName: resolveItemPresentation(material.itemId, material.itemId).displayName,
        quantity: material.quantity,
        carried: carried.get(material.itemId) ?? 0,
      }));
      const inProgress = posting.acceptedAt !== null;
      // Ordered most-actionable-last so the reason shown is the one the player
      // can actually do something about first.
      const blockedReason = inProgress
        ? undefined
        : !atTheYard
          ? ("not_here" as const)
          : input.weldingLevel < definition.requiredWeldingLevel
            ? ("welding_level" as const)
            : definition.requiredRefiningLevel !== undefined &&
                input.refiningLevel < definition.requiredRefiningLevel
              ? ("refining_level" as const)
              : board.active
                ? ("work_order_active" as const)
                : benchOccupancy.kind !== "clear" || benchBusy
                  ? ("workbench_occupied" as const)
                  : materials.some((material) => material.carried < material.quantity)
                    ? ("materials" as const)
                    : undefined;
      return [
        {
          slotIndex: posting.slotIndex,
          workOrderId: definition.id,
          title: definition.title,
          clientName: definition.clientName,
          description: definition.description,
          requiredWeldingLevel: definition.requiredWeldingLevel,
          ...(definition.requiredRefiningLevel !== undefined
            ? { requiredRefiningLevel: definition.requiredRefiningLevel }
            : {}),
          materials,
          sections: definition.sections,
          payoutCredits: definition.payoutCredits,
          inProgress,
          acceptable: !inProgress && blockedReason === undefined,
          ...(blockedReason ? { blockedReason } : {}),
        },
      ];
    },
  );

  // Consumed once per transaction, so a completion is reported by the response
  // that committed it and never repeated by the next refresh.
  const completion = takeWorkOrderCompletion(transaction);
  const withCompletion = completion ? { recentCompletion: completion } : {};

  const activeDefinition = board.active ? getWorkOrder(board.active.workOrderId) : undefined;
  if (!board.active || !activeDefinition) {
    return { ...base, ...withCompletion, postings, refresh };
  }

  const workOrderActive = input.action?.actionId === ACTION_IDS.workOrderWelding;
  const cleanPass = projectCleanPass(
    board.active.cleanPass,
    board.active.sectionsCompleted,
    workOrderActive,
  );
  return {
    ...base,
    ...withCompletion,
    postings,
    refresh,
    active: {
      workOrderId: activeDefinition.id,
      title: activeDefinition.title,
      clientName: activeDefinition.clientName,
      sections: activeDefinition.sections,
      sectionsCompleted: board.active.sectionsCompleted,
      payoutCredits: activeDefinition.payoutCredits,
      xpPerSection: workOrderSectionXp(balance),
      active: workOrderActive,
      ...(cleanPass ? { cleanPass } : {}),
    },
  };
}

/**
 * Project the stash at the character's current site (#284).
 *
 * Returns nothing unless the site is an authored stash site and the stash is
 * already theirs to see; see `SiteStashState`. Reads are unlocked, like the
 * Cargo projection: every command re-proves everything under its own locks.
 */
async function projectSiteStash(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    currentLocationId: string;
    repairs: Readonly<Record<string, RepairProjection>>;
    snapshot: PlaySnapshot;
    balance: EffectiveGameBalance;
  },
): Promise<SiteStashState | undefined> {
  const site = getSiteStash(input.currentLocationId);
  if (!site) return undefined;
  const repair = input.repairs[site.mountTargetId];
  // `repairAvailable` is true exactly when the Welding gate (and any
  // prerequisite repair) is met or the mount is already built.
  if (!repair || !repair.repairAvailable) return undefined;
  const [containerRows, stackRows, itemRows] = await Promise.all([
    transaction
      .select()
      .from(siteStashContainers)
      .where(
        and(
          eq(siteStashContainers.characterId, input.characterId),
          eq(siteStashContainers.locationId, site.locationId),
        ),
      ),
    transaction
      .select()
      .from(siteStashStacks)
      .where(
        and(
          eq(siteStashStacks.characterId, input.characterId),
          eq(siteStashStacks.locationId, site.locationId),
        ),
      )
      .orderBy(asc(siteStashStacks.createdAt), asc(siteStashStacks.id)),
    transaction
      .select()
      .from(siteStashItemInstances)
      .where(
        and(
          eq(siteStashItemInstances.characterId, input.characterId),
          eq(siteStashItemInstances.locationId, site.locationId),
        ),
      )
      .orderBy(asc(siteStashItemInstances.storedAt), asc(siteStashItemInstances.itemInstanceId)),
  ]);
  const containerOption = (instance: {
    id: string;
    itemId: string;
  }): SiteStashContainerState | undefined => {
    const slotCapacity = siteStashSlotCapacity(instance.itemId);
    if (slotCapacity === undefined) return undefined;
    return {
      itemInstanceId: instance.id,
      itemId: instance.itemId,
      name: resolveItemPresentation(instance.itemId, instance.itemId).displayName,
      slotCapacity,
      massGrams: carriedItemMassGrams(instance.itemId, input.balance),
    };
  };
  const installedInstance = containerRows[0]
    ? input.snapshot.allItemInstances.find(
        (instance) => instance.id === containerRows[0]!.itemInstanceId,
      )
    : undefined;
  const container = installedInstance ? containerOption(installedInstance) : undefined;
  const uniqueItems = itemRows
    .map((row) =>
      input.snapshot.allItemInstances.find((instance) => instance.id === row.itemInstanceId),
    )
    .filter((instance): instance is (typeof input.snapshot.allItemInstances)[number] =>
      Boolean(instance),
    )
    .map((instance) => ({
      id: instance.id,
      itemId: instance.itemId,
      name: resolveItemPresentation(instance.itemId, instance.itemId).displayName,
      massGrams: carriedItemMassGrams(instance.itemId, input.balance),
      currentCharge: chargeOf(instance, input.balance),
    }));
  const slotsUsed = stackRows.length + uniqueItems.length;
  const carriedContainers = input.snapshot.carriedInstances
    .filter((instance) => !input.snapshot.equipmentLoadout.equippedItemInstanceIds.has(instance.id))
    .map(containerOption)
    .filter((option): option is SiteStashContainerState => option !== undefined);
  const carriedRoom = {
    inventorySlotsUsed: input.snapshot.slotsUsed,
    slotCapacity: input.snapshot.slotCapacity,
    carriedMassGrams: input.snapshot.carriedMassGrams,
    maximumCarryCapacityGrams: input.snapshot.maximumCarryCapacityGrams,
  };
  const swappableContainerInstanceIds = container
    ? carriedContainers
        .filter(
          (option) =>
            planSiteStashSwap({
              installedItemId: container.itemId,
              replacementItemId: option.itemId,
              occupiedSlots: slotsUsed,
              carried: carriedRoom,
            }).ok,
        )
        .map((option) => option.itemInstanceId)
    : [];
  const removal = container
    ? planSiteStashRemoval({
        occupiedSlots: slotsUsed,
        installedItemId: container.itemId,
        carried: carriedRoom,
      })
    : undefined;
  const removeBlockedReason = removal && !removal.ok ? removal.reason : undefined;
  return {
    locationId: site.locationId,
    repair,
    mountBuilt: repair.complete,
    ...(container ? { container } : {}),
    stacks: stackRows.map((stack) => ({
      id: stack.id,
      itemId: stack.itemId,
      name: resolveItemPresentation(stack.itemId, stack.itemId).displayName,
      quantity: stack.quantity,
      stackLimit: itemStackLimit(stack.itemId, input.balance),
    })),
    uniqueItems,
    slotsUsed,
    capacitySlots: container?.slotCapacity ?? 0,
    carriedContainers,
    swappableContainerInstanceIds,
    ...(removeBlockedReason ? { removeBlockedReason } : {}),
  };
}

async function projectRepairTarget(
  transaction: DatabaseTransaction,
  characterId: string,
  targetId: RepairTargetId,
  repair: RepairTargetState,
  carried: Readonly<Record<string, number>>,
  weldingActive = false,
): Promise<RepairProjection> {
  const target = getRepairTargetBalance(targetId);
  const access = await loadRepairAccess(transaction, characterId, targetId, repair);
  const cleanPass = projectCleanPass(repair.cleanPass, repair.weldingProgress, weldingActive);
  const contribution = planRepairMaterialContribution({ repair, carried, target });
  const notes = getRepairTarget(targetId)?.materialNotes ?? {};
  const materials = repairMaterialProgress(repair, target).map((row) => ({
    ...row,
    name: resolveItemPresentation(row.itemId, row.itemId).displayName,
    availableContribution: contribution[row.itemId] ?? 0,
    ...(notes[row.itemId] ? { note: notes[row.itemId] } : {}),
  }));
  return {
    ...(cleanPass ? { cleanPass } : {}),
    targetId,
    materials,
    weldingProgress: repair.weldingProgress,
    weldingIncrements: target.repairIncrements,
    materialComplete: repairMaterialsComplete(repair, target),
    complete: repairComplete(repair),
    repairAvailable: access.repairAvailable,
    completedAt: repair.completedAt?.toISOString(),
    canContribute: !contributionIsEmpty(contribution),
  };
}

/**
 * The Fabricate side of the station (#232): every authored recipe with its
 * unmet requirements, the Override toggle, and the workpiece on the machine.
 * Everything a surface shows is decided here or in the domain; the browser
 * derives nothing it could be wrong about.
 */
async function projectFabricationStation(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    action: typeof activeActions.$inferSelect | undefined;
    level: number;
    stacks: readonly (typeof inventoryStacks.$inferSelect)[];
    carriedByItemId: Readonly<Record<string, number>>;
    balance: EffectiveGameBalance;
  },
): Promise<FabricationProjection> {
  const { balance } = input;
  const row = await loadFabricationRow(transaction, input.characterId);
  const activeRecipe =
    input.action && isFabricationAction(input.action.actionId)
      ? fabricationRecipeForActionId(input.action.actionId, balance)
      : undefined;
  const override = activeRecipe ? overrideFromRow(row) : undefined;
  const rules = balance.fabrication.manualOverride;
  const lastPush = override?.lastPush;
  return {
    unlocked: await loadFabricationUnlocked(transaction, input.characterId),
    manualOverrideEnabled: row?.manualOverrideEnabled ?? false,
    recipes: fabricationRecipes(balance).map((recipe) => {
      const output = getItemDefinition(recipe.outputItemId, balance);
      return {
        actionId: recipe.actionId,
        outputItemId: recipe.outputItemId,
        outputName: resolveItemPresentation(recipe.outputItemId, recipe.outputItemId).displayName,
        outputQuantity: recipe.outputQuantity,
        ...(output?.kind === "stack" ? { outputStackLimit: output.stackLimit } : {}),
        minimumLevel: recipe.minimumLevel,
        unlocked: fabricationRecipeUnlocked(input.level, recipe),
        durationTicks: recipe.durationTicks,
        baseXp: recipe.baseXp,
        inputs: recipe.inputs.map((each) => ({
          itemId: each.itemId,
          name: resolveItemPresentation(each.itemId, each.itemId).displayName,
          quantity: each.quantity,
          carried: input.carriedByItemId[each.itemId] ?? 0,
        })),
        inputsAvailable: recipe.inputs.every(
          (each) => (input.carriedByItemId[each.itemId] ?? 0) >= each.quantity,
        ),
        affordableBatches: fabricationAffordableBatches(
          { fabricationLevel: input.level, stacks: input.stacks },
          recipe,
        ),
      };
    }),
    ...(activeRecipe && input.action
      ? {
          workpiece: {
            recipeActionId: activeRecipe.actionId,
            sequence: (row?.runBatches ?? 0) + 1,
            startedAt: input.action.resolvedThroughAt.toISOString(),
            endsAt: new Date(
              input.action.resolvedThroughAt.getTime() +
                ticksToMilliseconds(activeRecipe.durationTicks),
            ).toISOString(),
            finishCurrent: row?.finishCurrent ?? false,
            ...(override
              ? {
                  override: {
                    load: override.load,
                    trend: override.trend,
                    pushes: overridePushes(override),
                    maximumPushes: rules.maximumPushes,
                    locked: override.locked,
                    canPush: overrideCanPush(override, balance),
                    multiplierLabel: manualOverrideMultiplierLabel(override, balance),
                    xpIfLockedIn: manualOverrideXp(activeRecipe.baseXp, override, balance),
                    ...(lastPush
                      ? {
                          lastPush: {
                            ...lastPush,
                            safeRange: overrideSafeRange(lastPush.load, balance),
                          },
                        }
                      : {}),
                    dial: { minimum: rules.loadMinimum, maximum: rules.loadMaximum },
                  },
                }
              : {}),
          },
        }
      : {}),
    run: fabricationRunStateFromRow(row),
    ...(row?.lastStopReason ? { lastStopReason: row.lastStopReason as FabricationStopReason } : {}),
  };
}

/** The Tinker side of the station (#232), with the last-Cutter guard already applied. */
async function projectTinkering(
  transaction: DatabaseTransaction,
  input: {
    characterId: string;
    action: typeof activeActions.$inferSelect | undefined;
    level: number;
    miningLevel: number;
    snapshot: Awaited<ReturnType<typeof loadPlaySnapshot>>;
    carriedByItemId: Readonly<Record<string, number>>;
    balance: EffectiveGameBalance;
  },
): Promise<TinkeringProjection> {
  const { balance, snapshot } = input;
  const row = await loadTinkeringRow(transaction, input.characterId);
  const cycle = tinkeringCycleFromRow(row);
  const cycleTarget = cycle ? tinkeringTargetForActionId(cycle.targetActionId, balance) : undefined;
  const equipped = snapshot.equipmentLoadout.equippedItemInstanceIds;
  const carriedUniqueItems = snapshot.carriedInstances
    .filter((instance) => !equipped.has(instance.id))
    .map((instance) => ({
      id: instance.id,
      itemId: instance.itemId,
      currentCharge: instance.currentCharge,
      createdAt: instance.createdAt.toISOString(),
    }));
  const usableMiningCutters = usableMiningCutterCount(
    snapshot.allItemInstances,
    input.miningLevel,
    balance,
  );
  return {
    unlocked: await loadTinkeringUnlocked(transaction, input.characterId),
    active: isTinkeringAction(input.action?.actionId),
    autoDiscardScrap: row?.autoDiscardScrap ?? false,
    finishCurrent: row?.finishCurrent ?? false,
    ...(cycle && cycleTarget
      ? {
          cycle: {
            targetActionId: cycle.targetActionId,
            ticksCompleted: cycle.ticksCompleted,
            durationTicks: tinkeringDurationTicks(cycleTarget.recipe, balance),
          },
        }
      : {}),
    targets: tinkeringTargets(balance).map((target) => {
      const { recipe } = target;
      const output = getItemDefinition(recipe.outputItemId, balance);
      const carried =
        output?.kind === "stack"
          ? (input.carriedByItemId[recipe.outputItemId] ?? 0)
          : carriedUniqueItems.filter((instance) => instance.itemId === recipe.outputItemId).length;
      const carriedBatches = Math.floor(carried / recipe.outputQuantity);
      const affordableBatches = tinkeringAffordableBatches(
        {
          fabricationLevel: input.level,
          miningLevel: input.miningLevel,
          stacks: snapshot.stacks,
          carriedUniqueItems,
          usableMiningCutters,
        },
        target,
        balance,
      );
      return {
        actionId: target.actionId,
        itemId: recipe.outputItemId,
        name: resolveItemPresentation(recipe.outputItemId, recipe.outputItemId).displayName,
        batchQuantity: recipe.outputQuantity,
        ...(output?.kind === "stack" ? { stackLimit: output.stackLimit } : {}),
        minimumLevel: recipe.minimumLevel,
        unlocked: tinkeringUnlocked(input.level, recipe),
        durationTicks: tinkeringDurationTicks(recipe, balance),
        xp: tinkeringXp(recipe),
        scrap: tinkeringScrapYield(recipe, balance),
        carriedBatches,
        affordableBatches,
        lastCutterBlocked:
          isUsableMiningCutter(recipe.outputItemId, input.miningLevel, balance) &&
          carriedBatches > 0 &&
          affordableBatches === 0,
      };
    }),
    run: tinkeringRunStateFromRow(row),
    ...(row?.lastStopReason ? { lastStopReason: row.lastStopReason as TinkeringStopReason } : {}),
  };
}

export async function stateFromTransaction(
  transaction: DatabaseTransaction,
  characterId: string,
  recentResult: PlayGameplayState["recentResult"],
  miningStopReason?: MiningStopReason,
  commandError?: PlayGameplayState["commandError"],
  travelError?: PlayGameplayState["travelError"],
  characterRow?: { currentLocationId: string; credits: number; scavengeSuppressed: boolean },
  now = new Date(),
  refiningRecentResult: PlayGameplayState["refiningRecentResult"] = {
    successes: 0,
    failures: 0,
    awardedXp: 0,
  },
  refiningStopReason?: RefiningStopReason | null,
  refiningError?: PlayGameplayState["refiningError"],
  weldingError?: PlayGameplayState["weldingError"],
  practiceError?: PlayGameplayState["practiceError"],
  stationErrors?: Pick<PlayGameplayState, "fabricationError" | "tinkeringError">,
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
    repairStates,
    cargoStackRows,
    cargoItemRows,
    travelRows,
    scavengeRevealRows,
    claimRows,
    merchantPurchaseRows,
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
    loadRepairTargetStates(transaction, characterId),
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
    loadMerchantDailyPurchases(transaction, { characterId, resetDate }),
    characterRow
      ? Promise.resolve([characterRow])
      : transaction.select().from(characters).where(eq(characters.id, characterId)).limit(1),
  ]);
  const totalXp = xpRows.find((row) => row.skillId === SKILL_IDS.mining)?.totalXp ?? 0;
  const refiningTotalXp = xpRows.find((row) => row.skillId === SKILL_IDS.refining)?.totalXp ?? 0;
  const weldingTotalXp = xpRows.find((row) => row.skillId === SKILL_IDS.welding)?.totalXp ?? 0;
  const fabricationTotalXp =
    xpRows.find((row) => row.skillId === SKILL_IDS.fabrication)?.totalXp ?? 0;
  const thresholds = miningLevelThresholds(balance);
  const refiningThresholds = standardSkillLevelThresholds(balance);
  const weldingThresholds = standardSkillLevelThresholds(balance);
  // Canonical cross-skill progression for the Character surface (#213): every
  // skill the game defines, the same rule the player inspector projects. The
  // per-skill fields below stay as they are — each activity surface reads its
  // own skill's live run state, not a profile list.
  const progression = projectCharacterProgression({
    skillXp: xpRows.map((row) => ({ skillId: row.skillId, totalXp: row.totalXp })),
    levelThresholds: skillLevelThresholds,
    skillDisplayName: (skillId) => getSkillPresentation(skillId)?.displayName,
    skillAccentTone: (skillId) => getSkillPresentation(skillId)?.accentTone,
  });
  const miningProgress = skillLevelProgress(totalXp, thresholds);
  const refiningProgress = skillLevelProgress(refiningTotalXp, refiningThresholds);
  const weldingProgress = skillLevelProgress(weldingTotalXp, weldingThresholds);
  const fabricationProgress = skillLevelProgress(
    fabricationTotalXp,
    standardSkillLevelThresholds(balance),
  );
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
    itemsGained: (miningState?.runItemsGained as Record<string, number> | undefined) ?? {},
    xpGained: miningState?.runXpGained ?? 0,
    recentAttempts: normalizePersistedMiningAttempts(miningState?.recentAttempts, balance),
  };
  const refiningState = refiningStateRows[0];
  const refiningRun: RefiningRunState = {
    // NULL is Max, so a missing row (no run yet) is told apart from it.
    selection: refiningState
      ? boundedRunSelectionFromColumn(refiningState.runSelectedAttempts)
      : BOUNDED_RUN_DEFAULT_QUANTITY,
    attempts: refiningState?.runAttempts ?? 0,
    successes: refiningState?.runSuccesses ?? 0,
    failures: (refiningState?.runAttempts ?? 0) - (refiningState?.runSuccesses ?? 0),
    outputsGained: (refiningState?.runOutputsGained as Record<string, number> | undefined) ?? {},
    outputsDiscarded:
      (refiningState?.runOutputsDiscarded as Record<string, number> | undefined) ?? {},
    inputsConsumed: (refiningState?.runInputsConsumed as Record<string, number> | undefined) ?? {},
    xpGained: refiningState?.runXpGained ?? 0,
    recentAttempts: normalizePersistedRefiningAttempts(refiningState?.recentAttempts, balance),
  };
  // One carried-quantity map covers every authored repair material, so a
  // recipe that wants Power Cells needs no new tally here (#209).
  const carriedByItemId: Record<string, number> = {};
  for (const stack of stacks) {
    carriedByItemId[stack.itemId] = (carriedByItemId[stack.itemId] ?? 0) + stack.quantity;
  }
  // Every repair target projects identically; only its recipe differs.
  const repairs: Record<string, RepairProjection> = {};
  for (const target of repairTargetBalances(balance)) {
    repairs[target.targetId] = await projectRepairTarget(
      transaction,
      characterId,
      target.targetId,
      repairStates.get(target.targetId) ?? UNSTARTED_REPAIR,
      carriedByItemId,
      action?.actionId === target.actionId,
    );
  }
  // Practice Welding (#190). The bench is the player's to use from the moment
  // 10,000 Hours is accepted, and stays so forever after — there is no second
  // unlock flag, only that Mission record.
  const practiceRow = await loadPracticeRow(transaction, characterId);
  const practiceState = practiceStateFromRow(practiceRow);
  const practiceActive = action?.actionId === ACTION_IDS.practiceWelding;
  const practiceCleanPass = projectCleanPass(
    practiceState.cleanPass,
    practiceState.sectionsCompleted,
    practiceActive,
  );
  const practice: PracticeProjection = {
    unlocked: await loadPracticeUnlocked(transaction, characterId),
    active: practiceActive,
    sectionsCompleted: practiceState.sectionsCompleted,
    sectionsPerWeld: balance.practiceWelding.sectionsPerWeld,
    cycleActive: practiceState.cycleActive,
    scrapAvailable: stacks
      .filter((stack) => stack.itemId === ITEM_IDS.scrapMetal)
      .reduce((total, stack) => total + stack.quantity, 0),
    scrapPerWeld: balance.practiceWelding.scrapPerWeld,
    affordableWelds: practiceAffordableWelds(
      {
        practice: practiceState,
        scrapStackQuantities: stacks
          .filter((stack) => stack.itemId === ITEM_IDS.scrapMetal)
          .map((stack) => stack.quantity),
      },
      balance,
    ),
    finishCurrentWeld: practiceRow?.finishCurrentWeld ?? false,
    ...(practiceRow?.lastStopReason ? { lastStopReason: practiceRow.lastStopReason } : {}),
    run: practiceRunStateFromRow(practiceRow),
    ...(practiceCleanPass ? { cleanPass: practiceCleanPass } : {}),
  };
  const fabricationStation = await projectFabricationStation(transaction, {
    characterId,
    action,
    level: fabricationProgress.level,
    stacks: snapshot.stacks,
    carriedByItemId,
    balance,
  });
  const tinkering = await projectTinkering(transaction, {
    characterId,
    action,
    level: fabricationProgress.level,
    miningLevel: miningProgress.level,
    snapshot,
    carriedByItemId,
    balance,
  });
  const cargoRepairProjection = repairs[REPAIR_TARGET_IDS.cargoHold]!;
  const cargoUniqueItems = cargoItemRows
    .map((row) => snapshot.allItemInstances.find((instance) => instance.id === row.itemInstanceId))
    .filter((instance): instance is (typeof snapshot.allItemInstances)[number] => Boolean(instance))
    .map((instance) => ({
      id: instance.id,
      itemId: instance.itemId,
      name: resolveItemPresentation(instance.itemId, instance.itemId).displayName,
      massGrams: carriedItemMassGrams(instance.itemId, balance),
      currentCharge: chargeOf(instance, balance),
    }));
  const currentLocationId = character[0]?.currentLocationId ?? LOCATION_IDS.crashSite;
  const siteStash = await projectSiteStash(transaction, {
    characterId,
    currentLocationId,
    repairs,
    snapshot,
    balance,
  });
  // Work Orders (#207). Projected after the character's location is known,
  // because every posting's acceptability depends on the player genuinely
  // standing in Wade's yard.
  const workOrders = await projectWorkOrders(transaction, {
    characterId,
    weldingLevel: weldingProgress.level,
    refiningLevel: refiningProgress.level,
    currentLocationId,
    action,
    practice: practiceState,
    stacks,
    balance,
    random: defaultMiningRandom(),
    resetDate,
    now,
  });
  const credits = character[0]?.credits ?? 0;
  const missions = await loadMissionProjections(transaction, characterId, {
    currentLocationId,
    activeActionId: action?.actionId,
  });
  const travelMode = (travel?.mode ?? "walk") as TravelMode;
  const travelState =
    travel && action?.actionId === ACTION_IDS.travel
      ? {
          originLocationId: travel.originLocationId,
          destinationLocationId: travel.destinationLocationId,
          mode: travelMode,
          startedAt: action.startedAt.toISOString(),
          arrivesAt: new Date(
            action.startedAt.getTime() + ticksToMilliseconds(travelDurationTicks(travelMode)),
          ).toISOString(),
          scavengeSuppressed:
            travelOffersScavenge(travelMode) && travel.scavengeOpportunityStartTick === null,
          // A paid ride offers no Scavenge opportunity at all, so the Journey
          // exposes none rather than a window nobody may claim. A suppressed
          // walk (#312) has none either, by the same representation.
          scavenge:
            travelOffersScavenge(travelMode) && travel.scavengeOpportunityStartTick !== null
              ? (() => {
                  const opportunityStartTick = travel.scavengeOpportunityStartTick;
                  const timing = scavengeWindowAt({
                    travelStartedAt: action.startedAt,
                    opportunityStartTick,
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
                    opportunityStartTick,
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
                })()
              : undefined,
        }
      : undefined;
  // Whichever authored Mining tool is equipped (#233); its own definition
  // decides its charge ceiling, its durations and its yield.
  const equippedTool = snapshot.equipmentLoadout.miningTool;
  const cutterInstance = equippedTool
    ? snapshot.carriedInstances.find((instance) => instance.id === equippedTool.itemInstanceId)
    : undefined;
  const cutterCharge = equippedTool
    ? normalizeCutterCharge(cutterInstance?.currentCharge, equippedTool.definition)
    : 0;
  // Which ore or recipe is actually running, resolved from the durable action
  // row rather than from a single hardcoded Ferrite/Refining identity (#209).
  const activeMiningSource = action ? miningSourceForActionId(action.actionId, balance) : undefined;
  const activeRefiningRecipe = action
    ? refiningRecipeForActionId(action.actionId, balance)
    : undefined;
  // Every kind of Welding ticks the same way — an authored repair, a Practice
  // weld, and a customer Work Order — so one classification covers all three.
  // Enumerating them here is how a Work Order came to weld with no live
  // section timing at all: the projection knew the job was running, and this
  // boundary did not (#207).
  const isWeldingCadenceAction =
    action !== undefined && weldingCadenceActionIds(balance).includes(action.actionId);
  const nextAttemptBoosted = activeMiningSource !== undefined && cutterCharge > 0;
  const activeFabricationRecipe = action
    ? fabricationRecipeForActionId(action.actionId, balance)
    : undefined;
  const activeTinkeringTarget = action
    ? tinkeringTargetForActionId(action.actionId, balance)
    : undefined;
  const nextAttemptDurationTicks = isWeldingCadenceAction
    ? balance.welding.attemptDurationTicks
    : activeRefiningRecipe
      ? activeRefiningRecipe.attemptDurationTicks
      : activeFabricationRecipe
        ? activeFabricationRecipe.durationTicks
        : activeTinkeringTarget
          ? tinkeringDurationTicks(activeTinkeringTarget.recipe, balance)
          : activeMiningSource
            ? miningAttemptDurationTicks(
                balance,
                activeMiningSource,
                equippedTool?.definition,
                nextAttemptBoosted,
              )
            : balance.welding.attemptDurationTicks;
  // A workpiece's timer runs from the cursor, which always stands at its start.
  // A Tinkering cycle's cursor moves with every resolution, so its timer runs
  // from the ticks it has already had.
  const progressStartedAtMs = action
    ? action.resolvedThroughAt.getTime() -
      (activeTinkeringTarget ? ticksToMilliseconds(tinkering.cycle?.ticksCompleted ?? 0) : 0)
    : 0;
  const carriedPowerCellQuantity = stacks
    .filter((stack) => stack.itemId === ITEM_IDS.powerCell)
    .reduce((total, stack) => total + stack.quantity, 0);
  // The two authoritative facts the location-state boundary derives from.
  // Neither is a flag of its own: acceptance lives on the Mission row and
  // completion lives on the repair row (#209).
  const locationStateFacts: LocationStateFacts = {
    acceptedMissionIds: new Set(
      missions
        .filter((mission) => mission.state !== "not_accepted")
        .map((mission) => mission.missionId),
    ),
    completedRepairTargetIds: deriveCompletedRepairTargetIds(
      Object.values(repairs).map((projection) => ({
        targetId: projection.targetId,
        complete: projection.complete,
      })),
    ),
  };
  const locationStates: Record<string, LocationStateProjection> = {};
  for (const location of LOCATIONS) {
    const resolved = resolveLocationState(location, locationStateFacts);
    locationStates[location.id] = {
      locationId: resolved.locationId,
      ...(resolved.variantId ? { variantId: resolved.variantId } : {}),
      description: resolved.description,
      travelable: resolved.travelable,
      ...(resolved.mapStatus ? { mapStatus: resolved.mapStatus } : {}),
      availableActionIds: resolved.availableActionIds,
      scene: resolved.scene,
    };
  }
  // Exactly one Mining source is reachable where the character is standing.
  const locationMiningSource = miningSources(balance).find((source) =>
    locationStates[currentLocationId]?.availableActionIds.includes(source.actionId),
  );
  return {
    characterId,
    missions,
    location: { currentLocationId },
    credits,
    scavengeSuppressed: character[0]?.scavengeSuppressed ?? false,
    scavengeReveals,
    travelState,
    powerAnnex:
      currentLocationId === LOCATION_IDS.emergencyPowerAnnex
        ? { resetDate, claimed: claimRows.length > 0 }
        : undefined,
    merchantDailyPurchases: merchantDailyAllowances(MERCHANTS, merchantPurchaseRows),
    activeAction:
      action &&
      (activeMiningSource !== undefined ||
        activeRefiningRecipe !== undefined ||
        activeFabricationRecipe !== undefined ||
        activeTinkeringTarget !== undefined ||
        isWeldingCadenceAction)
        ? {
            actionId: action.actionId,
            resolvedThroughAt: action.resolvedThroughAt.toISOString(),
            progressStartedAt: new Date(progressStartedAtMs).toISOString(),
            nextAttemptAt: new Date(
              progressStartedAtMs + ticksToMilliseconds(nextAttemptDurationTicks),
            ).toISOString(),
            nextAttemptBoosted,
            nextAttemptDurationTicks,
          }
        : undefined,
    progression,
    skillTotalXp: Object.fromEntries(xpRows.map((row) => [row.skillId, row.totalXp])),
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
    fabrication: {
      totalXp: fabricationTotalXp,
      level: fabricationProgress.level,
      xpToNextLevel: fabricationProgress.xpToNextLevel,
      xpIntoLevel: fabricationProgress.xpIntoLevel,
    },
    fabricationStation,
    tinkering,
    ...(stationErrors?.fabricationError
      ? { fabricationError: stationErrors.fabricationError }
      : {}),
    ...(stationErrors?.tinkeringError ? { tinkeringError: stationErrors.tinkeringError } : {}),
    miningSource: locationMiningSource
      ? {
          actionId: locationMiningSource.actionId,
          itemId: locationMiningSource.itemId,
          itemName: resolveItemPresentation(
            locationMiningSource.itemId,
            locationMiningSource.itemId,
          ).displayName,
          secondaryFindItemIds: miningSecondaryFindFacts(balance, locationMiningSource).map(
            (find) => find.itemId,
          ),
          attemptDurationTicks: miningAttemptDurationTicks(
            balance,
            locationMiningSource,
            equippedTool?.definition,
            false,
          ),
          boostedAttemptDurationTicks: miningAttemptDurationTicks(
            balance,
            locationMiningSource,
            equippedTool?.definition,
            true,
          ),
          successChanceBps: miningSuccessChanceBps(miningProgress.level, locationMiningSource),
          successXp: locationMiningSource.successXp,
          yieldMinimum: locationMiningSource.yieldMinimum,
          yieldMaximum: locationMiningSource.yieldMaximum,
          ...(() => {
            const charged = miningYieldRange(locationMiningSource, equippedTool?.definition, true);
            return { chargedYieldMinimum: charged.minimum, chargedYieldMaximum: charged.maximum };
          })(),
        }
      : undefined,
    refiningRecipes: refiningRecipes(balance).map((recipe) => {
      const award = refiningAwardFacts(balance, recipe);
      const output = getItemDefinition(recipe.outputItemId, balance);
      return {
        actionId: recipe.actionId,
        outputItemId: recipe.outputItemId,
        outputName: resolveItemPresentation(recipe.outputItemId, recipe.outputItemId).displayName,
        outputQuantity: recipe.outputQuantity,
        ...(output?.kind === "stack" ? { outputStackLimit: output.stackLimit } : {}),
        minimumLevel: recipe.minimumLevel,
        unlocked: refiningRecipeUnlocked(refiningProgress.level, recipe),
        attemptDurationTicks: recipe.attemptDurationTicks,
        successChanceBps: refiningSuccessChanceBps(refiningProgress.level, recipe),
        successXp: recipe.successXp,
        failureXp: refiningRecipeIsDeterministic(recipe) ? 0 : recipe.failureXp,
        deterministic: refiningRecipeIsDeterministic(recipe),
        affordableBatches: refiningAffordableBatches(
          { refiningLevel: refiningProgress.level, existingStacks: snapshot.stacks },
          balance,
          recipe,
        ),
        inputs: award.inputs.map((input) => ({
          itemId: input.itemId,
          name: resolveItemPresentation(input.itemId, input.itemId).displayName,
          quantity: input.quantity,
          carried: carriedByItemId[input.itemId] ?? 0,
        })),
        failureOutcomes: award.failureOutcomes.map((outcome) =>
          outcome.map((output) => ({
            itemId: output.itemId,
            name: resolveItemPresentation(output.itemId, output.itemId).displayName,
            quantity: output.quantity,
          })),
        ),
        inputsAvailable: award.inputs.every(
          (input) => (carriedByItemId[input.itemId] ?? 0) >= input.quantity,
        ),
      };
    }),
    locationStates,
    carriedByItemId,
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
        currentCharge: chargeOf(
          {
            itemId: item.itemId,
            currentCharge:
              snapshot.carriedInstances.find((instance) => instance.id === item.id)
                ?.currentCharge ?? null,
          },
          balance,
        ),
      })),
    },
    equipment: {
      aggregateContainerSlots: snapshot.equipmentLoadout.containerSlotCapacity,
      carriedPowerCellQuantity,
      miningTool: equippedTool
        ? (() => {
            const tool = equippedTool.definition;
            // Describes the source the character can actually mine right now;
            // with none in reach, the Cutter's own baseline source (#209).
            const source = locationMiningSource ?? balance.mining.sources.ferriteShale;
            return {
              itemId: equippedTool.itemId,
              name: resolveItemPresentation(equippedTool.itemId, equippedTool.itemId).displayName,
              currentCharge: cutterCharge,
              maximumCharge: tool.maximumCharge,
              requiredMiningLevel: tool.requiredMiningLevel,
              usable: miningToolUsable(tool, miningProgress.level),
              baseDurationMultiplierBps: tool.baseDurationMultiplierBps,
              chargedEffect: tool.chargedEffect,
              attemptDurationTicks: miningAttemptDurationTicks(balance, source, tool, false),
              boostedAttemptDurationTicks: miningAttemptDurationTicks(balance, source, tool, true),
            };
          })()
        : undefined,
      slots: [
        {
          target: {
            assignmentKind: "gear" as const,
            suitSlotId: balance.carrying.miningToolSuitSlotId,
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
          .map((instance) => slotItemProjection(instance, miningProgress.level, balance));
        return {
          ...slot,
          item: item ? slotItemProjection(item, miningProgress.level, balance) : undefined,
          eligibleItems,
        };
      }),
    },
    run,
    refiningRun,
    repairs,
    practice,
    autoDiscardSlag: await loadAutoDiscardSlag(transaction, characterId),
    unpinnedMissionIds: await loadUnpinnedMissionIds(transaction, characterId),
    workOrders,
    practiceError,
    cargoHold: {
      // The Cargo Hold keeps its own presentation identity while reading the
      // same generic repair projection every target does.
      repair: cargoRepairProjection,
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
    ...(siteStash ? { siteStash } : {}),
    recentResult,
    refiningRecentResult,
    stop: (() => {
      if (refiningStopReason)
        return { activity: "refining", reason: refiningStopReason } as ActivityStop;
      if (miningStopReason) return { activity: "mining", reason: miningStopReason } as ActivityStop;
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
          return { activity: "refining", reason: refiningPersisted } as ActivityStop;
        return { activity: "mining", reason: miningPersisted } as ActivityStop;
      }
      if (refiningPersisted)
        return { activity: "refining", reason: refiningPersisted } as ActivityStop;
      if (miningPersisted) return { activity: "mining", reason: miningPersisted } as ActivityStop;
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
    // A read: a trade-engaged character still loads and refreshes Play (#266).
    { allowDuringTrade: true },
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

      // The destination's current state is authoritative here, not merely in
      // the Map's presentation: a forged request for a collapsed Deep Jag is
      // refused server-side with `route_blocked` (#209).
      const plan = planTravel({
        currentLocationId,
        destinationLocationId,
        alreadyTraveling: false,
        locationStateFacts: await loadLocationStateFacts(transaction, context.character.id),
      });
      if (!plan.ok) {
        return stateFromTransaction(
          transaction,
          context.character.id,
          recentFrom(miningOutcome),
          miningOutcome?.stopReason,
          context.action && !miningActionIds().includes(context.action.actionId)
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
        // Welding leaves the yard mid-bead: an open Clean Pass window is spent
        // by walking away, through the SAME interruption the player's own Stop
        // uses, so the two can never disagree (#190).
        const replacedWeldingTargetId = repairTargetForActionId(context.action.actionId);
        if (replacedWeldingTargetId) {
          await missOpenRepairCleanPass(transaction, {
            characterId: context.character.id,
            targetId: replacedWeldingTargetId,
            now,
          });
        } else if (context.action.actionId === ACTION_IDS.practiceWelding) {
          await interruptPracticeWelding(transaction, context.character.id, now);
        } else if (context.action.actionId === ACTION_IDS.workOrderWelding) {
          // Leaving Rusk Recovery interrupts a customer job exactly as it
          // interrupts Practice: the job and every resolved section stay
          // durable on the bench, an open window is spent, and time spent
          // elsewhere welds nothing (#207).
          await missOpenWorkOrderCleanPass(transaction, {
            characterId: context.character.id,
            now,
          });
        }
        await transaction
          .delete(activeActions)
          .where(eq(activeActions.characterId, context.character.id));
        if (miningActionIds().includes(context.action.actionId)) {
          await transaction
            .insert(characterMiningState)
            .values({ characterId: context.character.id, lastStopReason: "action_replaced" })
            .onConflictDoUpdate({
              target: characterMiningState.characterId,
              set: { lastStopReason: "action_replaced", updatedAt: now },
            });
        } else if (refiningActionIds().includes(context.action.actionId)) {
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
        mode: "walk",
        // While Scavenge is suppressed after a Turn Back (#312) the walk gets no
        // window at all, and no random roll is spent deciding where one would
        // have been. Only a completed walk lifts the suppression.
        scavengeOpportunityStartTick: reloaded?.scavengeSuppressed
          ? null
          : scavengeOpportunityStartTick(random.nextBasisPoints()),
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

/**
 * Begin a paid Crew Hauler ride along an authored transport route (#172).
 *
 * The browser supplies only a destination. The route, its mode, its duration,
 * its fare, and the Mission that unlocks it are all resolved server-side from
 * authored content and this character's own authoritative state.
 *
 * Exactly-once fare: `withResolvedOwnedCharacter` takes the character row FOR
 * UPDATE before anything else runs, so the Credit debit, the Travel action, and
 * the travel row all commit together in one transaction, and any concurrent or
 * retried request blocks on that lock and then finds the ride already underway.
 * A repeat of the same in-flight ride is idempotent and charges nothing; every
 * refusal returns before any mutation at all.
 */
export async function beginTransportTravel(
  userId: string,
  characterId: string,
  destinationLocationId: string,
  now = new Date(),
  random: MiningRandom = defaultMiningRandom(),
): Promise<PlayGameplayState> {
  return withResolvedOwnedCharacter(
    userId,
    characterId,
    createPlayResolver(random),
    async (transaction, context) => {
      await ensurePlayProvisioning(transaction, context.character.id);

      // Reload after lazy resolution so origin reflects an arrival that may
      // have committed earlier in this same transaction.
      const [reloaded] = await transaction
        .select()
        .from(characters)
        .where(eq(characters.id, context.character.id))
        .limit(1);
      const currentLocationId = reloaded?.currentLocationId ?? LOCATION_IDS.crashSite;
      const credits = reloaded?.credits ?? 0;

      const refuse = async (
        travelError: PlayGameplayState["travelError"],
        commandError?: PlayGameplayState["commandError"],
      ): Promise<PlayGameplayState> =>
        stateFromTransaction(
          transaction,
          context.character.id,
          { successes: 0, failures: 0, awardedXp: 0 },
          undefined,
          commandError,
          travelError,
          undefined,
          now,
        );

      const travelRows = await transaction
        .select()
        .from(characterTravelState)
        .where(eq(characterTravelState.characterId, context.character.id))
        .for("update");
      const travel = travelRows[0];

      if (context.action?.actionId === ACTION_IDS.travel) {
        // Idempotent retry of the ride already underway: never a second fare.
        return travel?.destinationLocationId === destinationLocationId
          ? stateFromTransaction(
              transaction,
              context.character.id,
              { successes: 0, failures: 0, awardedXp: 0 },
              undefined,
              undefined,
              undefined,
              undefined,
              now,
            )
          : refuse("already_traveling");
      }

      // A ride is boarded, not begun mid-task: unlike walking it never replaces
      // an active work action.
      if (context.action) return refuse(undefined, "another_action_active");

      const plan = planTransportTravel({
        currentLocationId,
        destinationLocationId,
        alreadyTraveling: false,
        completedMissionIds: await loadCompletedMissionIds(transaction, context.character.id),
        credits,
      });
      if (!plan.ok) {
        return refuse(plan.reason === "route_locked" ? "route_locked" : plan.reason);
      }

      // The fare and the Journey commit together. The balance is decremented in
      // SQL from the locked row rather than written from a read value.
      await transaction
        .update(characters)
        .set({ credits: sql`${characters.credits} - ${plan.fareCredits}` })
        .where(eq(characters.id, context.character.id));
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
        mode: plan.mode,
        // A ride has no Scavenge window at all, not an unused one.
        scavengeOpportunityStartTick: null,
      });

      return stateFromTransaction(
        transaction,
        context.character.id,
        { successes: 0, failures: 0, awardedXp: 0 },
        undefined,
        undefined,
        undefined,
        undefined,
        now,
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

      // Riding offers nothing to scavenge. This is the authoritative refusal:
      // a forged claim during a paid ride is rejected here regardless of what
      // the client believes it can see.
      if (!travelOffersScavenge(travel.mode as TravelMode)) {
        return stateFor({
          status: "refused",
          reason: "no_scavenge_on_this_journey",
          message: "There is nothing to scavenge from the back of a hauler.",
        });
      }
      // A walk with no window is a suppressed one (#312): the same authoritative
      // refusal, whatever the client believes it can see.
      if (travel.scavengeOpportunityStartTick === null) {
        return stateFor({
          status: "refused",
          reason: "scavenge_suppressed",
          message: "Scavenge is unavailable until you complete a walk.",
        });
      }
      const opportunityStartTick = travel.scavengeOpportunityStartTick;

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
        opportunityStartTick,
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
  return withLockedOwnedCharacter(
    userId,
    characterId,
    async (transaction, context) => {
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
    },
    // Presentation only: dismissing a reveal changes no trade-relevant state (#266).
    { allowDuringTrade: true, now },
  );
}
