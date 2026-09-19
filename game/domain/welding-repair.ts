import type {
  EffectiveGameBalance,
  RepairMaterialRequirement,
  RepairTargetBalance,
} from "@/game/config/balance";
import { UNROLLED_CLEAN_PASS, type CleanPassState } from "@/game/domain/clean-pass";

/**
 * The durable state of one repair target for one character (#172).
 *
 * Every Welding job in RuneSpace — the Crash Site Cargo Hold, Holo Hollow's
 * Crew Stop, Deep Jag's cave-in, and any later one — is this same shape: how
 * much of each material has been contributed, how many whole Welding
 * increments have resolved, and whether the job is finished. The numbers a
 * particular target needs are its authored recipe (`getRepairTargetBalance`),
 * never values baked into this module or duplicated by a caller.
 *
 * `materials` is keyed by item ID rather than carrying one field per material
 * (#209). Deep Jag needs Refined Ferrite and Power Cells where the first two
 * targets needed Refined Ferrite and Slag, so a fixed field pair would have
 * meant a third specialized column for every future recipe. An item absent
 * from the map has contributed nothing.
 */
export type RepairTargetState = {
  materials: Readonly<Record<string, number>>;
  weldingProgress: number;
  /**
   * This repair's two Clean Pass opportunities (#190). A repair is ONE Welding
   * work unit, so they are rolled once when Welding first starts on it and are
   * never rerolled by Stop or Resume.
   */
  cleanPass: CleanPassState;
  completedAt?: Date | null;
};

/** A repair nobody has welded yet has no opportunities rolled. */
export const UNROLLED_REPAIR_CLEAN_PASS: CleanPassState = UNROLLED_CLEAN_PASS;

/**
 * A planned contribution, keyed by item ID. Only materials the recipe actually
 * authors ever appear, and only with a positive quantity.
 */
export type RepairMaterialContribution = Readonly<Record<string, number>>;

/** How much of one authored material has been contributed so far. */
export function contributedQuantity(repair: RepairTargetState, itemId: string): number {
  return repair.materials[itemId] ?? 0;
}

/** How much of one authored material the recipe still wants. */
export function remainingQuantity(
  repair: RepairTargetState,
  requirement: RepairMaterialRequirement,
): number {
  return Math.max(0, requirement.quantity - contributedQuantity(repair, requirement.itemId));
}

/**
 * One row of a repair's material list, derived generically from the recipe.
 *
 * Mission observations and the repair UI both read this rather than naming
 * Refined Ferrite or Slag themselves, so a target with a different recipe
 * needs no new observation field and no new UI branch (#209).
 */
export type RepairMaterialProgress = {
  itemId: string;
  required: number;
  contributed: number;
  remaining: number;
};

export function repairMaterialProgress(
  repair: RepairTargetState,
  target: RepairTargetBalance,
): readonly RepairMaterialProgress[] {
  return target.materials.map((requirement) => ({
    itemId: requirement.itemId,
    required: requirement.quantity,
    contributed: Math.min(contributedQuantity(repair, requirement.itemId), requirement.quantity),
    remaining: remainingQuantity(repair, requirement),
  }));
}

export function repairMaterialsComplete(
  repair: RepairTargetState,
  target: RepairTargetBalance,
): boolean {
  return target.materials.every((requirement) => remainingQuantity(repair, requirement) === 0);
}

export function repairComplete(repair: RepairTargetState): boolean {
  return repair.completedAt != null;
}

/**
 * Calculate the single useful contribution from the carried quantities. The
 * project is a finite recipe: surplus material is never part of the plan.
 *
 * Contribution is deliberately partial and incremental. A player may hand over
 * what they are carrying, leave, gather more, and come back — the Crew Stop's
 * twenty Refined Ferrite is meant to be an investment made over several trips,
 * exactly the way the Cargo Hold already works.
 */
export function planRepairMaterialContribution(input: {
  repair: RepairTargetState;
  /** Carried quantity per item ID; anything the recipe does not want is ignored. */
  carried: Readonly<Record<string, number>>;
  target: RepairTargetBalance;
}): RepairMaterialContribution {
  const { repair, target } = input;
  if (repairComplete(repair)) return {};
  const contribution: Record<string, number> = {};
  for (const requirement of target.materials) {
    const carried = input.carried[requirement.itemId] ?? 0;
    if (!Number.isInteger(carried) || carried < 0) {
      throw new RangeError("Carried repair materials must be non-negative integers");
    }
    const planned = Math.min(carried, remainingQuantity(repair, requirement));
    if (planned > 0) contribution[requirement.itemId] = planned;
  }
  return contribution;
}

/** Whether a planned contribution would actually move anything. */
export function contributionIsEmpty(contribution: RepairMaterialContribution): boolean {
  return Object.values(contribution).every((quantity) => quantity <= 0);
}

/** Apply a planned contribution to a repair's durable material map. */
export function applyRepairMaterialContribution(
  repair: RepairTargetState,
  contribution: RepairMaterialContribution,
): Readonly<Record<string, number>> {
  const next: Record<string, number> = { ...repair.materials };
  for (const [itemId, quantity] of Object.entries(contribution)) {
    if (quantity > 0) next[itemId] = (next[itemId] ?? 0) + quantity;
  }
  return next;
}

export type WeldingSnapshot = RepairTargetState;

export type WeldingResolution = {
  consumedTicks: number;
  completedIncrements: number;
  weldingProgress: number;
  awardedXp: number;
  completed: boolean;
  stopReason?: "materials_incomplete" | "completed";
};

/**
 * Resolve only whole, bounded welding passes. A partial five-tick pass leaves
 * the action cursor untouched and therefore grants neither progress nor XP.
 *
 * This is the single Welding resolution for every repair target: the attempt
 * duration and the XP per increment are global Welding rules, while how many
 * increments remain comes from the target's own recipe.
 */
export function resolveWelding(input: {
  elapsedTicks: number;
  snapshot: WeldingSnapshot;
  target: RepairTargetBalance;
  balance: EffectiveGameBalance;
}): WeldingResolution {
  const { balance, snapshot, target } = input;
  if (!Number.isInteger(input.elapsedTicks) || input.elapsedTicks < 0) {
    throw new RangeError("Elapsed ticks must be a non-negative integer");
  }

  if (!repairMaterialsComplete(snapshot, target)) {
    return {
      consumedTicks: 0,
      completedIncrements: 0,
      weldingProgress: snapshot.weldingProgress,
      awardedXp: 0,
      completed: false,
      stopReason: "materials_incomplete",
    };
  }

  const remainingIncrements = Math.max(0, target.repairIncrements - snapshot.weldingProgress);
  if (snapshot.completedAt != null) {
    return {
      consumedTicks: 0,
      completedIncrements: 0,
      weldingProgress: Math.min(snapshot.weldingProgress, target.repairIncrements),
      awardedXp: 0,
      completed: true,
      stopReason: "completed",
    };
  }

  // A row at the progress ceiling without completedAt is malformed or from
  // an interrupted legacy write. It must stop without becoming an unlock.
  if (remainingIncrements === 0) {
    return {
      consumedTicks: 0,
      completedIncrements: 0,
      weldingProgress: snapshot.weldingProgress,
      awardedXp: 0,
      completed: false,
      stopReason: "completed",
    };
  }

  const availableIncrements = Math.floor(input.elapsedTicks / balance.welding.attemptDurationTicks);
  const completedIncrements = Math.min(remainingIncrements, availableIncrements);
  const weldingProgress = snapshot.weldingProgress + completedIncrements;
  const completed = weldingProgress >= target.repairIncrements;
  return {
    consumedTicks: completedIncrements * balance.welding.attemptDurationTicks,
    completedIncrements,
    weldingProgress,
    awardedXp: completedIncrements * balance.welding.xpPerIncrement,
    completed,
    ...(completed ? { stopReason: "completed" as const } : {}),
  };
}

/**
 * The repair targets that are actually finished.
 *
 * Derived world state (a Local Place that looks different once something in it
 * is fixed) reads this instead of persisting a second "repaired" flag that
 * could drift from the authoritative repair record. It takes the minimal
 * structural shape both the play projection and the server rows satisfy.
 */
export function deriveCompletedRepairTargetIds(
  repairs: readonly { targetId: string; complete: boolean }[],
): ReadonlySet<string> {
  return new Set(repairs.filter((repair) => repair.complete).map((repair) => repair.targetId));
}
