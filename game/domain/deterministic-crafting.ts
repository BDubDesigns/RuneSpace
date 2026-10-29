import {
  getEffectiveGameBalance,
  getItemDefinition,
  type EffectiveGameBalance,
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

/** Shared deterministic stack crafting, extracted from Runeworking for Lapidary.
 * A binding current cycle reserves inputs; only committed completions consume
 * them and award XP. Capacity is checked against post-consumption inventory. */
export type DeterministicRecipe = {
  actionId: string;
  minimumLevel: number;
  durationTicks: number;
  baseXp: number;
  inputs: readonly { itemId: string; quantity: number }[];
  outputItemId?: string;
  outputQuantity?: number;
};

export type CraftingStopReason =
  | "access_denied"
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
export type CraftingCapacitySnapshot = {
  skillLevel: number;
  stacks: readonly StackState<string>[];
  slotsAvailable: number;
  massAvailableGrams: number;
};

export function craftingRecipeUnlocked(
  level: number,
  recipe: Pick<DeterministicRecipe, "minimumLevel">,
): boolean {
  return level >= recipe.minimumLevel;
}

export type CraftingCycleCheck =
  | { ok: true; after: WorkingInventory }
  | {
      ok: false;
      reason: Exclude<
        CraftingStopReason,
        "finished_current" | "run_completed" | "run_safety_limit" | "manually_stopped"
      >;
    };

/**
 * Whether one cycle of `recipe` can begin (or, at resolution, complete) against
 * this inventory, and the inventory it would leave: the level, every input, and
 * the output's fit after those inputs are gone — partial stacks first.
 */
export function checkCraftingCycle(
  inventory: WorkingInventory,
  level: number,
  recipe: DeterministicRecipe,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): CraftingCycleCheck {
  if (!craftingRecipeUnlocked(level, recipe)) return { ok: false, reason: "recipe_locked" };
  const removal = removeStacks(inventory, recipe.inputs, balance);
  if (!removal.ok) return { ok: false, reason: "insufficient_inputs" };
  if (!recipe.outputItemId) return { ok: true, after: removal.inventory };
  const added = addStackExact(
    removal.inventory,
    recipe.outputItemId,
    recipe.outputQuantity!,
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
export function craftingStartCheck(
  snapshot: CraftingCapacitySnapshot,
  recipe: DeterministicRecipe,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): CraftingCycleCheck {
  return checkCraftingCycle(workingInventory(snapshot), snapshot.skillLevel, recipe, balance);
}

/**
 * How many cycles of `recipe` the inputs carried right now pay for (#229's
 * affordable count): the largest number the selector offers and what Start
 * revalidates a number against. A plain count of inputs — never a prediction,
 * and not what Max does. Zero while the recipe is locked.
 */
export function craftingAffordableCycles(
  snapshot: Pick<CraftingCapacitySnapshot, "skillLevel" | "stacks">,
  recipe: DeterministicRecipe,
): number {
  if (!craftingRecipeUnlocked(snapshot.skillLevel, recipe)) return 0;
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

export type CraftingRunSnapshot = CraftingCapacitySnapshot & {
  /** What the selection still allows to START (a number's remainder, or Max's guard). */
  allowance: BoundedRunAllowance;
  /** The player asked for the cycle on the Rig to be the last. */
  finishCurrent: boolean;
  /** Authorization is re-read under the character lock, never supplied by UI. */
  authorized?: boolean;
};

/** One completed cycle, as the run history and Mission progress see it. */
export type CraftingResolvedCycle = { xpAwarded: number };

export type CraftingResolution = WorkingInventoryDiff & {
  consumedTicks: number;
  resolved: readonly CraftingResolvedCycle[];
  inputsConsumed: Readonly<Record<string, number>>;
  outputsGained: Readonly<Record<string, number>>;
  awardedXp: number;
  stopReason?: CraftingStopReason;
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
export function nextCraftingCycle(input: {
  inventory: WorkingInventory;
  level: number;
  recipe: DeterministicRecipe;
  /** Cycles resolved since the allowance was read. */
  resolvedThisRun: number;
  snapshot: Pick<CraftingRunSnapshot, "allowance" | "finishCurrent">;
  balance?: EffectiveGameBalance;
}): { stopReason?: CraftingStopReason } {
  if (input.snapshot.finishCurrent) return { stopReason: "finished_current" };
  if (input.resolvedThisRun >= input.snapshot.allowance.remaining) {
    return { stopReason: input.snapshot.allowance.exhaustedReason };
  }
  const check = checkCraftingCycle(
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
export function resolveCrafting(input: {
  elapsedTicks: number;
  snapshot: CraftingRunSnapshot;
  recipe: DeterministicRecipe;
  balance?: EffectiveGameBalance;
}): CraftingResolution {
  const balance = input.balance ?? getEffectiveGameBalance();
  const { snapshot, recipe } = input;
  if (!Number.isInteger(input.elapsedTicks) || input.elapsedTicks < 0) {
    throw new RangeError("Elapsed ticks must be a non-negative integer");
  }
  let inventory = workingInventory(snapshot);
  const resolved: CraftingResolvedCycle[] = [];
  const inputsConsumed: Record<string, number> = {};
  const outputsGained: Record<string, number> = {};
  let remainingTicks = input.elapsedTicks;
  let consumedTicks = 0;
  let awardedXp = 0;
  let stopReason: CraftingStopReason | undefined;

  if (snapshot.authorized === false) stopReason = "access_denied";
  else if (snapshot.allowance.remaining <= 0) stopReason = snapshot.allowance.exhaustedReason;
  while (!stopReason && remainingTicks >= recipe.durationTicks) {
    const completed = checkCraftingCycle(inventory, snapshot.skillLevel, recipe, balance);
    if (!completed.ok) {
      stopReason = completed.reason;
      break;
    }
    inventory = completed.after;
    remainingTicks -= recipe.durationTicks;
    consumedTicks += recipe.durationTicks;
    awardedXp += recipe.baseXp;
    for (const each of recipe.inputs) addTotals(inputsConsumed, each.itemId, each.quantity);
    if (recipe.outputItemId) addTotals(outputsGained, recipe.outputItemId, recipe.outputQuantity!);
    resolved.push({ xpAwarded: recipe.baseXp });
    stopReason = nextCraftingCycle({
      inventory,
      level: snapshot.skillLevel,
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
export function validateCraftingRecipes(
  recipes: readonly DeterministicRecipe[],
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): void {
  for (const recipe of recipes) {
    for (const input of recipe.inputs) {
      if (getItemDefinition(input.itemId, balance)?.kind !== "stack") {
        throw new Error(`Crafting recipe ${recipe.actionId} input ${input.itemId} must stack`);
      }
    }
    if (recipe.outputItemId && getItemDefinition(recipe.outputItemId, balance)?.kind !== "stack") {
      throw new Error(`Crafting recipe ${recipe.actionId} output must be a stackable item`);
    }
  }
}
