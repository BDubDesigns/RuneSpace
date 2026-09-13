import type { EffectiveGameBalance, RepairTargetBalance } from "@/game/config/balance";

/**
 * The durable state of one repair target for one character (#172).
 *
 * Every Welding job in RuneSpace — the Crash Site Cargo Hold, Holo Hollow's
 * Crew Stop, and any later one — is this same shape: how much of each material
 * has been contributed, how many whole Welding increments have resolved, and
 * whether the job is finished. The numbers a particular target needs are its
 * authored recipe (`getRepairTargetBalance`), never values baked into this
 * module or duplicated by a caller.
 */
export type RepairTargetState = {
  refinedFerriteContributed: number;
  slagContributed: number;
  weldingProgress: number;
  completedAt?: Date | null;
};

export type RepairMaterialContribution = {
  refinedFerrite: number;
  slag: number;
};

export function repairMaterialsComplete(
  repair: RepairTargetState,
  target: RepairTargetBalance,
): boolean {
  return (
    repair.refinedFerriteContributed >= target.refinedFerriteRequired &&
    repair.slagContributed >= target.slagRequired
  );
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
  carriedRefinedFerrite: number;
  carriedSlag: number;
  target: RepairTargetBalance;
}): RepairMaterialContribution {
  const { repair, target } = input;
  if (repairComplete(repair)) return { refinedFerrite: 0, slag: 0 };
  if (
    !Number.isInteger(input.carriedRefinedFerrite) ||
    input.carriedRefinedFerrite < 0 ||
    !Number.isInteger(input.carriedSlag) ||
    input.carriedSlag < 0
  ) {
    throw new RangeError("Carried repair materials must be non-negative integers");
  }
  return {
    refinedFerrite: Math.min(
      input.carriedRefinedFerrite,
      Math.max(0, target.refinedFerriteRequired - repair.refinedFerriteContributed),
    ),
    slag: Math.min(input.carriedSlag, Math.max(0, target.slagRequired - repair.slagContributed)),
  };
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
