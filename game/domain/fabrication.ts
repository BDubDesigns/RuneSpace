import {
  fabricationRecipes,
  getEffectiveGameBalance,
  getItemDefinition,
  type EffectiveGameBalance,
  type FabricationRecipeBalance,
} from "@/game/config/balance";
import { BOUNDED_RUN_QUANTITY_CEILING } from "@/game/config/foundations";
import type { BoundedRunAllowance } from "@/game/domain/bounded-run";
import type { StackState } from "@/game/domain/inventory";
import {
  manualOverrideXp,
  startManualOverride,
  type ManualOverrideState,
  type OverrideRandom,
} from "@/game/domain/manual-override";
import {
  addStackExact,
  addUnique,
  carriedQuantity,
  removeStacks,
  workingInventory,
  workingInventoryDiff,
  type WorkingInventory,
  type WorkingInventoryDiff,
} from "@/game/domain/working-inventory";

/**
 * Tier-1 Fabrication (#232): one workpiece at a time on Rusk Recovery's
 * Fabrication Station, in a player-selected number of batches or Max.
 *
 * Starting a workpiece is binding. Its complete recipe input set is reserved —
 * it stays in the real Inventory, counted for mass and slots, and nothing else
 * may make it unavailable — until the workpiece resolves. Resolution is atomic:
 * the whole input set is consumed and the whole authored output created
 * together, or, for a Manual Override bust, the whole input set is consumed
 * and nothing is created. Only the current workpiece is reserved; the next one
 * is checked against the inventory the last one actually left, which is what
 * lets a Max run respond to real results rather than a prediction.
 *
 * The capacity question is always asked of the hypothetical inventory AFTER
 * the inputs are removed, so an output may use the slot or mass its own
 * inputs free.
 */

export type FabricationStopReason =
  | "insufficient_inputs"
  | "inventory_slots_full"
  | "carried_mass_capacity_reached"
  | "recipe_locked"
  /** The player asked for the workpiece on the machine to be the last. */
  | "finished_current"
  /** A numeric run started every batch it was asked for. */
  | "run_completed"
  /** A Max run reached the internal defect guard; real inventories never do. */
  | "run_safety_limit"
  /** An operator cleared the station; a player has no way to do this. */
  | "manually_stopped";

/** What one workpiece check needs to know about the character, in numbers. */
export type FabricationCapacitySnapshot = {
  fabricationLevel: number;
  stacks: readonly StackState<string>[];
  slotsAvailable: number;
  massAvailableGrams: number;
};

export function fabricationRecipeUnlocked(
  level: number,
  recipe: Pick<FabricationRecipeBalance, "minimumLevel">,
): boolean {
  return level >= recipe.minimumLevel;
}

export type FabricationWorkpieceCheck =
  | { ok: true; after: WorkingInventory }
  | {
      ok: false;
      reason: Exclude<
        FabricationStopReason,
        "finished_current" | "run_completed" | "run_safety_limit" | "manually_stopped"
      >;
    };

/**
 * Whether one workpiece of `recipe` can begin (or, at resolution, complete)
 * against this inventory, and the inventory it would leave. The level, every
 * input, and the output's fit after those inputs are gone.
 */
export function checkFabricationWorkpiece(
  inventory: WorkingInventory,
  level: number,
  recipe: FabricationRecipeBalance,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): FabricationWorkpieceCheck {
  if (!fabricationRecipeUnlocked(level, recipe)) return { ok: false, reason: "recipe_locked" };
  const removal = removeStacks(inventory, recipe.inputs, balance);
  if (!removal.ok) return { ok: false, reason: "insufficient_inputs" };
  const output = getItemDefinition(recipe.outputItemId, balance);
  if (!output) throw new Error(`Fabrication output "${recipe.outputItemId}" is not an item`);
  const added =
    output.kind === "stack"
      ? addStackExact(removal.inventory, recipe.outputItemId, recipe.outputQuantity, balance)
      : addUnique(removal.inventory, recipe.outputItemId, balance);
  if (!added.ok) {
    return {
      ok: false,
      reason: added.reason === "mass" ? "carried_mass_capacity_reached" : "inventory_slots_full",
    };
  }
  return { ok: true, after: added.inventory };
}

/** Start's preflight against the carried snapshot. */
export function fabricationStartCheck(
  snapshot: FabricationCapacitySnapshot,
  recipe: FabricationRecipeBalance,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): FabricationWorkpieceCheck {
  return checkFabricationWorkpiece(
    workingInventory(snapshot),
    snapshot.fabricationLevel,
    recipe,
    balance,
  );
}

/**
 * How many batches of `recipe` the inputs carried right now pay for (#229's
 * affordable count): the largest number the selector offers and what Start
 * revalidates a number against. A plain count of inputs — never a prediction,
 * and not what Max does. Zero while the recipe is locked.
 */
export function fabricationAffordableBatches(
  snapshot: Pick<FabricationCapacitySnapshot, "fabricationLevel" | "stacks">,
  recipe: FabricationRecipeBalance,
): number {
  if (!fabricationRecipeUnlocked(snapshot.fabricationLevel, recipe)) return 0;
  const inventory = workingInventory({
    stacks: snapshot.stacks,
    slotsAvailable: 0,
    massAvailableGrams: 0,
  });
  const batches = Math.min(
    ...recipe.inputs.map((input) =>
      Math.floor(carriedQuantity(inventory, input.itemId) / input.quantity),
    ),
  );
  return Math.min(BOUNDED_RUN_QUANTITY_CEILING, batches);
}

/** One resolved workpiece, as the run history and Mission facts see it. */
export type FabricationResolvedWorkpiece = {
  result: "success" | "bust";
  xpAwarded: number;
  /** The workpiece was worked with Manual Override and pushed at least once. */
  usedOverride: boolean;
  safePushes: number;
  exactPushes: number;
  /** For a bust: the Feed the player chose and the Load the machine actually rolled. */
  bust?: { feed: number; load: number };
};

export type FabricationRunSnapshot = FabricationCapacitySnapshot & {
  /** What the selection still allows to START (a number's remainder, or Max's guard). */
  allowance: BoundedRunAllowance;
  /** The player asked for the workpiece on the machine to be the last. */
  finishCurrent: boolean;
  /** The station's Manual Override toggle, read when each new workpiece begins. */
  overrideEnabled: boolean;
  /** The workpiece on the machine's Override state, when Override was enabled on it. */
  override?: ManualOverrideState;
};

export type FabricationResolution = WorkingInventoryDiff & {
  consumedTicks: number;
  resolved: readonly FabricationResolvedWorkpiece[];
  /** Unique outputs created, to be inserted as new instances. */
  uniqueItemsCreated: number;
  inputsConsumed: Readonly<Record<string, number>>;
  outputsGained: Readonly<Record<string, number>>;
  awardedXp: number;
  /**
   * The Override state of the workpiece now on the machine, or undefined when
   * it has none. Always the NEXT workpiece's once one resolved: every new
   * workpiece starts at 1.00× and rolls a fresh Load only if Override is on.
   */
  override?: ManualOverrideState;
  /** The finished workpiece is being held at 0 for the player's Override decision. */
  held: boolean;
  stopReason?: FabricationStopReason;
};

function addTotals(totals: Record<string, number>, itemId: string, quantity: number) {
  totals[itemId] = (totals[itemId] ?? 0) + quantity;
}

/**
 * Complete one workpiece successfully against the working inventory: the whole
 * input set out, the whole output in, revalidated at the resolution boundary.
 * It refuses when the reserved inputs or the output's room are no longer
 * there — which the reservation guard makes unreachable — and a refusal must
 * then consume nothing at all.
 */
export function completeFabricationWorkpiece(
  inventory: WorkingInventory,
  level: number,
  recipe: FabricationRecipeBalance,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): FabricationWorkpieceCheck {
  return checkFabricationWorkpiece(inventory, level, recipe, balance);
}

/**
 * A bust consumes the complete reserved input set and creates nothing. Unlike
 * success it needs no room, only the inputs.
 */
export function bustFabricationWorkpiece(
  inventory: WorkingInventory,
  recipe: FabricationRecipeBalance,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): { ok: true; inventory: WorkingInventory } | { ok: false } {
  const removal = removeStacks(inventory, recipe.inputs, balance);
  return removal.ok ? { ok: true, inventory: removal.inventory } : { ok: false };
}

/** The running totals one resolution accumulates across its workpieces. */
type FabricationTally = {
  inventory: WorkingInventory;
  resolved: FabricationResolvedWorkpiece[];
  inputsConsumed: Record<string, number>;
  outputsGained: Record<string, number>;
  uniqueItemsCreated: number;
  awardedXp: number;
};

function freshTally(snapshot: FabricationCapacitySnapshot): FabricationTally {
  return {
    inventory: workingInventory(snapshot),
    resolved: [],
    inputsConsumed: {},
    outputsGained: {},
    uniqueItemsCreated: 0,
    awardedXp: 0,
  };
}

/**
 * Resolve the workpiece on the machine into the tally, atomically: a success
 * takes every input and makes the whole output at the multiplier its Override
 * earned; a bust takes every input, makes nothing, and pays nothing. Returns
 * the ordinary reason when it cannot — and then it has changed nothing.
 */
function resolveWorkpieceInto(
  tally: FabricationTally,
  input: {
    level: number;
    recipe: FabricationRecipeBalance;
    result: "success" | "bust";
    override: ManualOverrideState | undefined;
    bust?: { feed: number; load: number };
    balance: EffectiveGameBalance;
  },
): FabricationStopReason | undefined {
  const { recipe, balance, override } = input;
  const safePushes = override?.safePushes ?? 0;
  const exactPushes = override?.exactPushes ?? 0;
  if (input.result === "bust") {
    const bust = bustFabricationWorkpiece(tally.inventory, recipe, balance);
    if (!bust.ok) return "insufficient_inputs";
    tally.inventory = bust.inventory;
    for (const each of recipe.inputs) addTotals(tally.inputsConsumed, each.itemId, each.quantity);
    tally.resolved.push({
      result: "bust",
      xpAwarded: 0,
      usedOverride: true,
      safePushes,
      exactPushes,
      ...(input.bust ? { bust: input.bust } : {}),
    });
    return undefined;
  }
  const completed = completeFabricationWorkpiece(tally.inventory, input.level, recipe, balance);
  if (!completed.ok) return completed.reason;
  tally.inventory = completed.after;
  const xp = manualOverrideXp(recipe.baseXp, override, balance);
  tally.awardedXp += xp;
  for (const each of recipe.inputs) addTotals(tally.inputsConsumed, each.itemId, each.quantity);
  addTotals(tally.outputsGained, recipe.outputItemId, recipe.outputQuantity);
  if (getItemDefinition(recipe.outputItemId, balance)?.kind === "unique") {
    tally.uniqueItemsCreated += recipe.outputQuantity;
  }
  tally.resolved.push({
    result: "success",
    xpAwarded: xp,
    usedOverride: safePushes + exactPushes > 0,
    safePushes,
    exactPushes,
  });
  return undefined;
}

function resolutionFrom(
  snapshot: FabricationCapacitySnapshot,
  tally: FabricationTally,
  rest: {
    consumedTicks: number;
    override: ManualOverrideState | undefined;
    held: boolean;
    stopReason: FabricationStopReason | undefined;
  },
): FabricationResolution {
  return {
    ...workingInventoryDiff(snapshot.stacks, tally.inventory),
    consumedTicks: rest.consumedTicks,
    resolved: tally.resolved,
    uniqueItemsCreated: tally.uniqueItemsCreated,
    inputsConsumed: tally.inputsConsumed,
    outputsGained: tally.outputsGained,
    awardedXp: tally.awardedXp,
    // A stopped run leaves nothing on the machine.
    ...(rest.override && !rest.stopReason ? { override: rest.override } : {}),
    held: rest.held,
    ...(rest.stopReason ? { stopReason: rest.stopReason } : {}),
  };
}

/**
 * Lazily resolve whole workpieces. The durable cursor always stands at the
 * start of the workpiece on the machine.
 *
 * A workpiece whose timer has run out resolves — unless Manual Override is on
 * it and not locked, in which case the finished workpiece holds at 0 for the
 * player's decision, indefinitely, producing nothing and starting nothing.
 * After a resolution the next workpiece begins at that instant only while the
 * run allows it and the next recipe cycle can actually begin; otherwise the
 * run stops with the ordinary reason. Busts never happen here: only a push the
 * player makes can bust a workpiece.
 */
export function resolveFabrication(input: {
  elapsedTicks: number;
  snapshot: FabricationRunSnapshot;
  recipe: FabricationRecipeBalance;
  random: OverrideRandom;
  balance?: EffectiveGameBalance;
}): FabricationResolution {
  const balance = input.balance ?? getEffectiveGameBalance();
  const { snapshot, recipe } = input;
  if (!Number.isInteger(input.elapsedTicks) || input.elapsedTicks < 0) {
    throw new RangeError("Elapsed ticks must be a non-negative integer");
  }
  const tally = freshTally(snapshot);
  let override = snapshot.override;
  let remainingTicks = input.elapsedTicks;
  let consumedTicks = 0;
  let held = false;
  let stopReason: FabricationStopReason | undefined;

  for (;;) {
    if (remainingTicks < recipe.durationTicks) break;
    if (override && !override.locked) {
      held = true;
      break;
    }
    // Unreachable while the reservation holds. If it ever is reached, the
    // workpiece consumes nothing and the run ends with the honest reason
    // rather than inventing a partial result.
    stopReason = resolveWorkpieceInto(tally, {
      level: snapshot.fabricationLevel,
      recipe,
      result: "success",
      override,
      balance,
    });
    if (stopReason) break;
    remainingTicks -= recipe.durationTicks;
    consumedTicks += recipe.durationTicks;
    override = undefined;
    stopReason = nextFabricationWorkpiece({
      inventory: tally.inventory,
      level: snapshot.fabricationLevel,
      recipe,
      resolvedThisRun: tally.resolved.length,
      snapshot,
      balance,
    }).stopReason;
    if (stopReason) break;
    if (snapshot.overrideEnabled) override = startManualOverride(input.random, balance);
  }

  return resolutionFrom(snapshot, tally, { consumedTicks, override, held, stopReason });
}

/**
 * Resolve the workpiece on the machine at the player's command: a Lock In (or
 * Override switched off, or the fifth push) once the timer has run out, or a
 * bust at any moment. Then decide, exactly as the timer would, whether the next
 * workpiece begins at this instant — with a fresh 1.00× machine, rolled only
 * if Override is on.
 */
export function resolveFabricationWorkpieceNow(input: {
  snapshot: FabricationRunSnapshot;
  recipe: FabricationRecipeBalance;
  result: "success" | "bust";
  /** For a bust: the Feed and the Load that busted it. */
  bust?: { feed: number; load: number };
  random: OverrideRandom;
  balance?: EffectiveGameBalance;
}): FabricationResolution {
  const balance = input.balance ?? getEffectiveGameBalance();
  const { snapshot, recipe } = input;
  const tally = freshTally(snapshot);
  let stopReason = resolveWorkpieceInto(tally, {
    level: snapshot.fabricationLevel,
    recipe,
    result: input.result,
    override: snapshot.override,
    ...(input.bust ? { bust: input.bust } : {}),
    balance,
  });
  stopReason ??= nextFabricationWorkpiece({
    inventory: tally.inventory,
    level: snapshot.fabricationLevel,
    recipe,
    resolvedThisRun: tally.resolved.length,
    snapshot,
    balance,
  }).stopReason;
  const override =
    !stopReason && snapshot.overrideEnabled
      ? startManualOverride(input.random, balance)
      : undefined;
  return resolutionFrom(snapshot, tally, { consumedTicks: 0, override, held: false, stopReason });
}

/**
 * After a workpiece resolves, whether the run starts another one right now —
 * the one decision every resolution path (the timer, Lock In, a bust) shares.
 * Finish Current and an exhausted selection are checked first so the run
 * reports what the player asked for rather than an incidental shortage.
 */
export function nextFabricationWorkpiece(input: {
  inventory: WorkingInventory;
  level: number;
  recipe: FabricationRecipeBalance;
  /** Workpieces resolved since the allowance was read. */
  resolvedThisRun: number;
  snapshot: Pick<FabricationRunSnapshot, "allowance" | "finishCurrent">;
  balance?: EffectiveGameBalance;
}): { stopReason?: FabricationStopReason } {
  if (input.snapshot.finishCurrent) return { stopReason: "finished_current" };
  if (input.resolvedThisRun >= input.snapshot.allowance.remaining) {
    return { stopReason: input.snapshot.allowance.exhaustedReason };
  }
  const check = checkFabricationWorkpiece(
    input.inventory,
    input.level,
    input.recipe,
    input.balance ?? getEffectiveGameBalance(),
  );
  return check.ok ? {} : { stopReason: check.reason };
}

/** Every authored recipe's inputs are stackable; validated once at module load. */
export function validateFabricationRecipes(
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): void {
  for (const recipe of fabricationRecipes(balance)) {
    for (const input of recipe.inputs) {
      if (getItemDefinition(input.itemId, balance)?.kind !== "stack") {
        throw new Error(`Fabrication recipe ${recipe.actionId} input ${input.itemId} must stack`);
      }
    }
    if (!getItemDefinition(recipe.outputItemId, balance)) {
      throw new Error(`Fabrication recipe ${recipe.actionId} output is not an item`);
    }
  }
}
