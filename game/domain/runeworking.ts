import {
  getEffectiveGameBalance,
  getItemDefinition,
  runeworkingRecipes,
  type EffectiveGameBalance,
  type RuneworkingRecipeBalance,
} from "@/game/config/balance";
import { BOUNDED_RUN_QUANTITY_CEILING } from "@/game/config/foundations";
import type { BoundedRunAllowance } from "@/game/domain/bounded-run";
import type { StackState } from "@/game/domain/inventory";
import {
  addStackExact,
  carriedQuantity,
  removeStacks,
  workingInventory,
  workingInventoryDiff,
  type WorkingInventory,
  type WorkingInventoryDiff,
} from "@/game/domain/working-inventory";

/**
 * Runeworking (#391): one cycle at a time on the Wise Old Enby's Resonance Rig
 * at Hilltop Workshop, in a player-selected number of cycles or Max.
 *
 * It keeps Fabrication's proven run shape (#232) and none of its machine. A
 * started cycle is binding: its input set is reserved — it stays in the real
 * Inventory, counted for mass and slots, and nothing else may make it
 * unavailable (`server/fabrication-reservation.ts`) — until the cycle resolves.
 * Resolution is atomic: the cycle's inputs are consumed and its output created
 * together. Runeworking never fails, so there is no chance, bust, byproduct or
 * Manual Override. Only the current cycle is reserved; the next one is checked
 * against the inventory the last one actually left, which is what lets Max
 * respond to real results rather than a prediction.
 *
 * The capacity question is always asked of the hypothetical inventory AFTER the
 * inputs are removed, so an output may use the slot or mass its own inputs free.
 */

export type RuneworkingStopReason =
  | "insufficient_inputs"
  | "inventory_slots_full"
  | "carried_mass_capacity_reached"
  | "recipe_locked"
  /** The player asked for the cycle on the Rig to be the last. */
  | "finished_current"
  /** A numeric run completed every cycle it was asked for. */
  | "run_completed"
  /** A Max run reached the internal defect guard; real inventories never do. */
  | "run_safety_limit"
  /** An operator cleared the Rig; a player has no way to do this. */
  | "manually_stopped";

/** What one cycle check needs to know about the character, in numbers. */
export type RuneworkingCapacitySnapshot = {
  runeworkingLevel: number;
  stacks: readonly StackState<string>[];
  slotsAvailable: number;
  massAvailableGrams: number;
};

export function runeworkingRecipeUnlocked(
  level: number,
  recipe: Pick<RuneworkingRecipeBalance, "minimumLevel">,
): boolean {
  return level >= recipe.minimumLevel;
}

export type RuneworkingCycleCheck =
  | { ok: true; after: WorkingInventory }
  | {
      ok: false;
      reason: Exclude<
        RuneworkingStopReason,
        "finished_current" | "run_completed" | "run_safety_limit" | "manually_stopped"
      >;
    };

/**
 * Whether one cycle of `recipe` can begin (or, at resolution, complete) against
 * this inventory, and the inventory it would leave: the level, every input, and
 * the output's fit after those inputs are gone — partial stacks first.
 */
export function checkRuneworkingCycle(
  inventory: WorkingInventory,
  level: number,
  recipe: RuneworkingRecipeBalance,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): RuneworkingCycleCheck {
  if (!runeworkingRecipeUnlocked(level, recipe)) return { ok: false, reason: "recipe_locked" };
  const removal = removeStacks(inventory, recipe.inputs, balance);
  if (!removal.ok) return { ok: false, reason: "insufficient_inputs" };
  const added = addStackExact(
    removal.inventory,
    recipe.outputItemId,
    recipe.outputQuantity,
    balance,
  );
  if (!added.ok) {
    return {
      ok: false,
      reason: added.reason === "mass" ? "carried_mass_capacity_reached" : "inventory_slots_full",
    };
  }
  return { ok: true, after: added.inventory };
}

/** Start's preflight (and the reservation guard's question) against the carried snapshot. */
export function runeworkingStartCheck(
  snapshot: RuneworkingCapacitySnapshot,
  recipe: RuneworkingRecipeBalance,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): RuneworkingCycleCheck {
  return checkRuneworkingCycle(
    workingInventory(snapshot),
    snapshot.runeworkingLevel,
    recipe,
    balance,
  );
}

/**
 * How many cycles of `recipe` the inputs carried right now pay for (#229's
 * affordable count): the largest number the selector offers and what Start
 * revalidates a number against. A plain count of inputs — never a prediction,
 * and not what Max does. Zero while the recipe is locked.
 */
export function runeworkingAffordableCycles(
  snapshot: Pick<RuneworkingCapacitySnapshot, "runeworkingLevel" | "stacks">,
  recipe: RuneworkingRecipeBalance,
): number {
  if (!runeworkingRecipeUnlocked(snapshot.runeworkingLevel, recipe)) return 0;
  const inventory = workingInventory({
    stacks: snapshot.stacks,
    slotsAvailable: 0,
    massAvailableGrams: 0,
  });
  const cycles = Math.min(
    ...recipe.inputs.map((input) =>
      Math.floor(carriedQuantity(inventory, input.itemId) / input.quantity),
    ),
  );
  return Math.min(BOUNDED_RUN_QUANTITY_CEILING, cycles);
}

export type RuneworkingRunSnapshot = RuneworkingCapacitySnapshot & {
  /** What the selection still allows to START (a number's remainder, or Max's guard). */
  allowance: BoundedRunAllowance;
  /** The player asked for the cycle on the Rig to be the last. */
  finishCurrent: boolean;
};

/** One completed cycle, as the run history and Mission progress see it. */
export type RuneworkingResolvedCycle = { xpAwarded: number };

export type RuneworkingResolution = WorkingInventoryDiff & {
  consumedTicks: number;
  resolved: readonly RuneworkingResolvedCycle[];
  inputsConsumed: Readonly<Record<string, number>>;
  outputsGained: Readonly<Record<string, number>>;
  awardedXp: number;
  stopReason?: RuneworkingStopReason;
};

function addTotals(totals: Record<string, number>, itemId: string, quantity: number) {
  totals[itemId] = (totals[itemId] ?? 0) + quantity;
}

/**
 * After a cycle resolves, whether the run starts another one right now. Finish
 * Current and an exhausted selection are checked first so the run reports what
 * the player asked for rather than an incidental shortage; otherwise the next
 * cycle is revalidated — level, inputs and post-consumption capacity — against
 * the inventory the last cycle actually left.
 */
export function nextRuneworkingCycle(input: {
  inventory: WorkingInventory;
  level: number;
  recipe: RuneworkingRecipeBalance;
  /** Cycles resolved since the allowance was read. */
  resolvedThisRun: number;
  snapshot: Pick<RuneworkingRunSnapshot, "allowance" | "finishCurrent">;
  balance?: EffectiveGameBalance;
}): { stopReason?: RuneworkingStopReason } {
  if (input.snapshot.finishCurrent) return { stopReason: "finished_current" };
  if (input.resolvedThisRun >= input.snapshot.allowance.remaining) {
    return { stopReason: input.snapshot.allowance.exhaustedReason };
  }
  const check = checkRuneworkingCycle(
    input.inventory,
    input.level,
    input.recipe,
    input.balance ?? getEffectiveGameBalance(),
  );
  return check.ok ? {} : { stopReason: check.reason };
}

/**
 * Lazily resolve whole cycles. The durable cursor always stands at the start of
 * the cycle on the Rig, so a window shorter than one cycle resolves nothing and
 * a long one — an offline hour, a reconnect — resolves every cycle that fits, in
 * order, each against the inventory the one before it left.
 *
 * A cycle whose time has run out completes: its inputs are taken and its output
 * made, and it pays its XP. After that the next cycle begins at that instant
 * only while the run allows it and the next cycle can genuinely begin;
 * otherwise the run stops with the ordinary reason. A cycle that could not
 * complete — reachable only if the reservation were bypassed — consumes
 * nothing, makes nothing, and ends the run with the honest reason.
 */
export function resolveRuneworking(input: {
  elapsedTicks: number;
  snapshot: RuneworkingRunSnapshot;
  recipe: RuneworkingRecipeBalance;
  balance?: EffectiveGameBalance;
}): RuneworkingResolution {
  const balance = input.balance ?? getEffectiveGameBalance();
  const { snapshot, recipe } = input;
  if (!Number.isInteger(input.elapsedTicks) || input.elapsedTicks < 0) {
    throw new RangeError("Elapsed ticks must be a non-negative integer");
  }
  let inventory = workingInventory(snapshot);
  const resolved: RuneworkingResolvedCycle[] = [];
  const inputsConsumed: Record<string, number> = {};
  const outputsGained: Record<string, number> = {};
  let remainingTicks = input.elapsedTicks;
  let consumedTicks = 0;
  let awardedXp = 0;
  let stopReason: RuneworkingStopReason | undefined;

  while (remainingTicks >= recipe.durationTicks) {
    const completed = checkRuneworkingCycle(inventory, snapshot.runeworkingLevel, recipe, balance);
    if (!completed.ok) {
      stopReason = completed.reason;
      break;
    }
    inventory = completed.after;
    remainingTicks -= recipe.durationTicks;
    consumedTicks += recipe.durationTicks;
    awardedXp += recipe.baseXp;
    for (const each of recipe.inputs) addTotals(inputsConsumed, each.itemId, each.quantity);
    addTotals(outputsGained, recipe.outputItemId, recipe.outputQuantity);
    resolved.push({ xpAwarded: recipe.baseXp });
    stopReason = nextRuneworkingCycle({
      inventory,
      level: snapshot.runeworkingLevel,
      recipe,
      resolvedThisRun: resolved.length,
      snapshot,
      balance,
    }).stopReason;
    if (stopReason) break;
  }

  return {
    ...workingInventoryDiff(snapshot.stacks, inventory),
    consumedTicks,
    resolved,
    inputsConsumed,
    outputsGained,
    awardedXp,
    ...(stopReason ? { stopReason } : {}),
  };
}

/** Every authored recipe's inputs and output are stackable; validated once at module load. */
export function validateRuneworkingRecipes(
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): void {
  for (const recipe of runeworkingRecipes(balance)) {
    for (const input of recipe.inputs) {
      if (getItemDefinition(input.itemId, balance)?.kind !== "stack") {
        throw new Error(`Runeworking recipe ${recipe.actionId} input ${input.itemId} must stack`);
      }
    }
    if (getItemDefinition(recipe.outputItemId, balance)?.kind !== "stack") {
      throw new Error(`Runeworking recipe ${recipe.actionId} output must be a stackable item`);
    }
  }
}
