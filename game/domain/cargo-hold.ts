import type { EffectiveGameBalance } from "@/game/config/balance";

export type CargoHoldRepairState = {
  refinedFerriteContributed: number;
  slagContributed: number;
  weldingProgress: number;
  completedAt?: Date | null;
};

export type CargoHoldMaterialContribution = {
  refinedFerrite: number;
  slag: number;
};

export function cargoHoldMaterialsComplete(
  repair: CargoHoldRepairState,
  balance: EffectiveGameBalance,
): boolean {
  return (
    repair.refinedFerriteContributed >= balance.cargoHold.refinedFerriteRequired &&
    repair.slagContributed >= balance.cargoHold.slagRequired
  );
}

export function cargoHoldRepairComplete(
  repair: CargoHoldRepairState,
  balance: EffectiveGameBalance,
): boolean {
  return repair.completedAt != null || repair.weldingProgress >= balance.welding.repairIncrements;
}

/**
 * Calculate the single useful contribution from the carried quantities. The
 * project is a finite recipe: surplus material is never part of the plan.
 */
export function planCargoHoldMaterialContribution(input: {
  repair: CargoHoldRepairState;
  carriedRefinedFerrite: number;
  carriedSlag: number;
  balance: EffectiveGameBalance;
}): CargoHoldMaterialContribution {
  const { balance, repair } = input;
  if (cargoHoldRepairComplete(repair, balance)) return { refinedFerrite: 0, slag: 0 };
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
      Math.max(0, balance.cargoHold.refinedFerriteRequired - repair.refinedFerriteContributed),
    ),
    slag: Math.min(
      input.carriedSlag,
      Math.max(0, balance.cargoHold.slagRequired - repair.slagContributed),
    ),
  };
}

export type CargoHoldWeldingSnapshot = CargoHoldRepairState;

export type CargoHoldWeldingResolution = {
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
 */
export function resolveCargoHoldWelding(input: {
  elapsedTicks: number;
  snapshot: CargoHoldWeldingSnapshot;
  balance: EffectiveGameBalance;
}): CargoHoldWeldingResolution {
  const { balance, snapshot } = input;
  if (!Number.isInteger(input.elapsedTicks) || input.elapsedTicks < 0) {
    throw new RangeError("Elapsed ticks must be a non-negative integer");
  }

  if (!cargoHoldMaterialsComplete(snapshot, balance)) {
    return {
      consumedTicks: 0,
      completedIncrements: 0,
      weldingProgress: snapshot.weldingProgress,
      awardedXp: 0,
      completed: false,
      stopReason: "materials_incomplete",
    };
  }

  const remainingIncrements = Math.max(
    0,
    balance.welding.repairIncrements - snapshot.weldingProgress,
  );
  if (remainingIncrements === 0 || snapshot.completedAt != null) {
    return {
      consumedTicks: 0,
      completedIncrements: 0,
      weldingProgress: Math.min(snapshot.weldingProgress, balance.welding.repairIncrements),
      awardedXp: 0,
      completed: true,
      stopReason: "completed",
    };
  }

  const availableIncrements = Math.floor(input.elapsedTicks / balance.welding.attemptDurationTicks);
  const completedIncrements = Math.min(remainingIncrements, availableIncrements);
  const weldingProgress = snapshot.weldingProgress + completedIncrements;
  const completed = weldingProgress >= balance.welding.repairIncrements;
  return {
    consumedTicks: completedIncrements * balance.welding.attemptDurationTicks,
    completedIncrements,
    weldingProgress,
    awardedXp: completedIncrements * balance.welding.xpPerIncrement,
    completed,
    ...(completed ? { stopReason: "completed" as const } : {}),
  };
}
