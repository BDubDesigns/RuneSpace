import {
  getEffectiveGameBalance,
  getItemDefinition,
  getMiningToolDefinition,
  type EffectiveGameBalance,
  type FabricationRecipeBalance,
  type TinkeringTargetBalance,
} from "@/game/config/balance";
import { BOUNDED_RUN_QUANTITY_CEILING, type ItemId } from "@/game/config/foundations";
import type { BoundedRunAllowance } from "@/game/domain/bounded-run";
import type { StackState } from "@/game/domain/inventory";
import { miningToolUsable } from "@/game/domain/mining";
import {
  addStackExact,
  addStackKeepingWhatFits,
  carriedQuantity,
  removeStacks,
  removeUnique,
  workingInventory,
  workingInventoryDiff,
  type WorkingInventory,
  type WorkingInventoryDiff,
} from "@/game/domain/working-inventory";

/**
 * Tinkering (#232): dismantling finished Fabrication output at the
 * Fabrication Station for Fabrication XP and Scrap Metal — the lower-attention
 * training loop and item sink, taught by Tansy's Return the Favor
 * demonstration.
 *
 * One action consumes one complete authored recipe-output batch, and every
 * number derives from that recipe through universal rules: the recipe's base
 * Fabrication XP, twice its duration, and one Scrap per two immediate input
 * units, rounded up. Scrap only, never the original ingredients.
 *
 * It follows Practice Welding's cycle semantics rather than Fabrication's
 * reservation: starting a cycle commits — destroys — its batch, ordinary Stop
 * preserves the committed cycle so Resume continues it without committing
 * another, and Finish Current completes it and stops before the next. That is
 * what makes a refresh or disconnect unable to duplicate or dodge the
 * destruction: the batch is already gone when the cycle exists.
 */

export type TinkeringStopReason =
  /** Not enough of the target carried to form one complete batch. */
  | "no_eligible_items"
  /** The next batch would leave the character without a usable Mining Cutter. */
  | "last_cutter"
  /** Auto-discard is off and the batch's Scrap would not fit. */
  | "no_room_for_scrap"
  | "recipe_locked"
  | "finished_current_item"
  | "run_completed"
  | "run_safety_limit";

/** A carried, unequipped unique instance as Tinkering may select it. */
export type TinkeringUniqueInstance = {
  id: string;
  itemId: string;
  currentCharge: number | null;
  createdAt: string;
};

/** A committed cycle: its batch is already destroyed; this is the work left on it. */
export type TinkeringCycle = { targetActionId: string; ticksCompleted: number };

export type TinkeringSnapshot = {
  fabricationLevel: number;
  /** Decides which owned Mining Cutters are usable, for the last-Cutter guard (#233). */
  miningLevel: number;
  stacks: readonly StackState<string>[];
  /** Unequipped carried unique instances; equipped and stored items are never selectable. */
  carriedUniqueItems: readonly TinkeringUniqueInstance[];
  /**
   * Every usable Mining Cutter the character owns, wherever it is: equipped,
   * carried, or in the Cargo Hold (`usableMiningCutterCount`). The first-alpha
   * last-Cutter guard counts all of them, even the ones Tinkering could never
   * select.
   */
  usableMiningCutters: number;
  slotsAvailable: number;
  massAvailableGrams: number;
  /** The persistent per-character preference, read at each cycle. */
  autoDiscardScrap: boolean;
  finishCurrent: boolean;
  allowance: BoundedRunAllowance;
  cycle?: TinkeringCycle;
};

export function tinkeringScrapYield(
  recipe: Pick<FabricationRecipeBalance, "inputs">,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): number {
  const units = recipe.inputs.reduce((total, input) => total + input.quantity, 0);
  return Math.ceil(units / balance.tinkering.inputUnitsPerScrap);
}

export function tinkeringDurationTicks(
  recipe: Pick<FabricationRecipeBalance, "durationTicks">,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): number {
  return recipe.durationTicks * balance.tinkering.durationMultiplier;
}

/** Tinkering pays the recipe's base XP; an Override multiplier never travels with the item. */
export function tinkeringXp(recipe: Pick<FabricationRecipeBalance, "baseXp">): number {
  return recipe.baseXp;
}

export function tinkeringUnlocked(
  level: number,
  recipe: Pick<FabricationRecipeBalance, "minimumLevel">,
) {
  return level >= recipe.minimumLevel;
}

/**
 * Whether an item is a Mining Cutter this character can actually use (#233):
 * any authored Mining tool whose Mining requirement they meet. The Salvage
 * Cutter always is; a Loadsteel Cutter is from Mining 5. Only a usable Cutter
 * keeps a character able to mine, so only a usable one counts — and only
 * taking a usable one apart can leave them without.
 */
export function isUsableMiningCutter(
  itemId: string,
  miningLevel: number,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): boolean {
  const tool = getMiningToolDefinition(itemId, balance);
  return tool !== undefined && miningToolUsable(tool, miningLevel);
}

/** How many usable Mining Cutters are among these owned instances. */
export function usableMiningCutterCount(
  instances: readonly { itemId: string }[],
  miningLevel: number,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): number {
  return instances.filter((instance) => isUsableMiningCutter(instance.itemId, miningLevel, balance))
    .length;
}

/**
 * Which carried instances a batch takes, in a stable order that spends the
 * least value first: an uncharged instance before a charged one, then the
 * newest. The player's own starter Cutter is never singled out.
 */
export function orderInstancesForConsumption<Instance extends TinkeringUniqueInstance>(
  instances: readonly Instance[],
): Instance[] {
  return [...instances].sort(
    (a, b) =>
      (a.currentCharge ?? 0) - (b.currentCharge ?? 0) ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.id.localeCompare(b.id),
  );
}

type TinkeringWorkingState = {
  inventory: WorkingInventory;
  uniques: readonly TinkeringUniqueInstance[];
  usableMiningCutters: number;
};

/** Why a batch cannot begin — the ordinary Tinkering rules, not the run's own limits. */
export type TinkeringBlockReason = Exclude<
  TinkeringStopReason,
  "finished_current_item" | "run_completed" | "run_safety_limit"
>;

type BatchCheck =
  | { ok: true; state: TinkeringWorkingState; consumedInstanceIds: readonly string[] }
  | { ok: false; reason: TinkeringBlockReason };

/**
 * Whether one complete batch of `target` can be committed now, and the state
 * committing it leaves: the level, the complete batch, the last-Cutter guard,
 * and — unless Scrap is being discarded — room for that batch's Scrap after
 * the batch itself is gone.
 */
function checkTinkeringBatch(
  state: TinkeringWorkingState,
  level: number,
  miningLevel: number,
  target: TinkeringTargetBalance,
  autoDiscardScrap: boolean,
  balance: EffectiveGameBalance,
): BatchCheck {
  const { recipe } = target;
  if (!tinkeringUnlocked(level, recipe)) return { ok: false, reason: "recipe_locked" };
  const definition = getItemDefinition(recipe.outputItemId, balance);
  if (!definition) throw new Error(`Tinkering target "${recipe.outputItemId}" is not an item`);
  let inventory = state.inventory;
  let uniques = state.uniques;
  let consumedInstanceIds: string[] = [];
  if (definition.kind === "stack") {
    const removal = removeStacks(
      inventory,
      [{ itemId: recipe.outputItemId, quantity: recipe.outputQuantity }],
      balance,
    );
    if (!removal.ok) return { ok: false, reason: "no_eligible_items" };
    inventory = removal.inventory;
  } else {
    const selectable = orderInstancesForConsumption(
      uniques.filter((instance) => instance.itemId === recipe.outputItemId),
    );
    if (selectable.length < recipe.outputQuantity) {
      return { ok: false, reason: "no_eligible_items" };
    }
    consumedInstanceIds = selectable.slice(0, recipe.outputQuantity).map((instance) => instance.id);
    const consumed = new Set(consumedInstanceIds);
    uniques = uniques.filter((instance) => !consumed.has(instance.id));
    for (let index = 0; index < recipe.outputQuantity; index += 1) {
      inventory = removeUnique(inventory, recipe.outputItemId, balance);
    }
  }
  let usableMiningCutters = state.usableMiningCutters;
  if (isUsableMiningCutter(recipe.outputItemId, miningLevel, balance)) {
    usableMiningCutters -= recipe.outputQuantity;
    if (usableMiningCutters < 1) return { ok: false, reason: "last_cutter" };
  }
  if (!autoDiscardScrap) {
    const scrap = addStackExact(
      inventory,
      balance.tinkering.recoveredItemId,
      tinkeringScrapYield(recipe, balance),
      balance,
    );
    if (!scrap.ok) return { ok: false, reason: "no_room_for_scrap" };
  }
  return { ok: true, state: { inventory, uniques, usableMiningCutters }, consumedInstanceIds };
}

/** Start's preflight: whether a fresh cycle of `target` can be committed right now. */
export function tinkeringStartCheck(
  snapshot: TinkeringSnapshot,
  target: TinkeringTargetBalance,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): { ok: true } | { ok: false; reason: TinkeringBlockReason } {
  const check = checkTinkeringBatch(
    {
      inventory: workingInventory(snapshot),
      uniques: snapshot.carriedUniqueItems,
      usableMiningCutters: snapshot.usableMiningCutters,
    },
    snapshot.fabricationLevel,
    snapshot.miningLevel,
    target,
    snapshot.autoDiscardScrap,
    balance,
  );
  return check.ok ? { ok: true } : { ok: false, reason: check.reason };
}

/**
 * How many complete batches of `target` the eligible items carried right now
 * can form (#229's affordable count): the largest number the selector offers
 * and what Start revalidates a number against. Only complete authored output
 * batches count, and a Cutter batch that would take the character's last usable
 * Mining Cutter is not eligible to begin with. Not a prediction of Max.
 */
export function tinkeringAffordableBatches(
  snapshot: Pick<
    TinkeringSnapshot,
    "fabricationLevel" | "miningLevel" | "stacks" | "carriedUniqueItems" | "usableMiningCutters"
  >,
  target: TinkeringTargetBalance,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): number {
  const { recipe } = target;
  if (!tinkeringUnlocked(snapshot.fabricationLevel, recipe)) return 0;
  const definition = getItemDefinition(recipe.outputItemId, balance);
  const carried =
    definition?.kind === "stack"
      ? carriedQuantity(
          workingInventory({ stacks: snapshot.stacks, slotsAvailable: 0, massAvailableGrams: 0 }),
          recipe.outputItemId,
        )
      : snapshot.carriedUniqueItems.filter((instance) => instance.itemId === recipe.outputItemId)
          .length;
  let batches = Math.floor(carried / recipe.outputQuantity);
  if (isUsableMiningCutter(recipe.outputItemId, snapshot.miningLevel, balance)) {
    batches = Math.min(
      batches,
      Math.floor(Math.max(0, snapshot.usableMiningCutters - 1) / recipe.outputQuantity),
    );
  }
  return Math.min(BOUNDED_RUN_QUANTITY_CEILING, batches);
}

/** One completed Tinkering batch. */
export type TinkeringResolvedBatch = {
  itemId: ItemId;
  quantity: number;
  xpAwarded: number;
  scrapKept: number;
  scrapDiscarded: number;
};

export type TinkeringResolution = WorkingInventoryDiff & {
  consumedTicks: number;
  /** Unique instances committed (destroyed) by cycles begun in this window. */
  consumedInstanceIds: readonly string[];
  /** Items committed by cycles begun in this window, by item ID. */
  itemsCommitted: Readonly<Record<string, number>>;
  resolved: readonly TinkeringResolvedBatch[];
  awardedXp: number;
  scrapKept: number;
  scrapDiscarded: number;
  /** The committed cycle left on the station, if any. */
  cycle?: TinkeringCycle;
  /** The durable Finish Current intent was acted on and must now be cleared. */
  finishCurrentHonoured: boolean;
  stopReason?: TinkeringStopReason;
};

/**
 * Lazily resolve Tinkering ticks. Progress on a committed cycle is kept in
 * whole ticks, so Stop loses nothing already worked; a fresh cycle commits its
 * batch the instant it begins, while the run allows it and the next batch can
 * actually begin.
 */
export function resolveTinkering(input: {
  elapsedTicks: number;
  snapshot: TinkeringSnapshot;
  target: TinkeringTargetBalance;
  balance?: EffectiveGameBalance;
}): TinkeringResolution {
  const balance = input.balance ?? getEffectiveGameBalance();
  const { snapshot, target } = input;
  const { recipe } = target;
  if (!Number.isInteger(input.elapsedTicks) || input.elapsedTicks < 0) {
    throw new RangeError("Elapsed ticks must be a non-negative integer");
  }
  const duration = tinkeringDurationTicks(recipe, balance);
  const scrapYield = tinkeringScrapYield(recipe, balance);
  let state: TinkeringWorkingState = {
    inventory: workingInventory(snapshot),
    uniques: snapshot.carriedUniqueItems,
    usableMiningCutters: snapshot.usableMiningCutters,
  };
  let cycle = snapshot.cycle;
  let remainingTicks = input.elapsedTicks;
  let consumedTicks = 0;
  let awardedXp = 0;
  let scrapKept = 0;
  let scrapDiscarded = 0;
  let stopReason: TinkeringStopReason | undefined;
  const consumedInstanceIds: string[] = [];
  const itemsCommitted: Record<string, number> = {};
  const resolved: TinkeringResolvedBatch[] = [];

  for (;;) {
    if (!cycle) {
      if (snapshot.finishCurrent) {
        stopReason = "finished_current_item";
        break;
      }
      if (resolved.length >= snapshot.allowance.remaining) {
        stopReason = snapshot.allowance.exhaustedReason;
        break;
      }
      const check = checkTinkeringBatch(
        state,
        snapshot.fabricationLevel,
        snapshot.miningLevel,
        target,
        snapshot.autoDiscardScrap,
        balance,
      );
      if (!check.ok) {
        stopReason = check.reason;
        break;
      }
      state = check.state;
      consumedInstanceIds.push(...check.consumedInstanceIds);
      itemsCommitted[recipe.outputItemId] =
        (itemsCommitted[recipe.outputItemId] ?? 0) + recipe.outputQuantity;
      cycle = { targetActionId: target.actionId, ticksCompleted: 0 };
    }
    const needed = duration - cycle.ticksCompleted;
    if (remainingTicks < needed) {
      cycle = { ...cycle, ticksCompleted: cycle.ticksCompleted + remainingTicks };
      consumedTicks += remainingTicks;
      break;
    }
    remainingTicks -= needed;
    consumedTicks += needed;
    // The preference is read at completion, so flipping it mid-cycle applies
    // to the cycle that is finishing. Kept Scrap is whatever ordinary room
    // allows; the start check already proved room for it with Auto-discard off,
    // so a discard here only follows a change the player made mid-cycle.
    const scrap = snapshot.autoDiscardScrap
      ? { inventory: state.inventory, kept: 0, discarded: scrapYield }
      : addStackKeepingWhatFits(
          state.inventory,
          balance.tinkering.recoveredItemId,
          scrapYield,
          balance,
        );
    state = { ...state, inventory: scrap.inventory };
    const xp = tinkeringXp(recipe);
    awardedXp += xp;
    scrapKept += scrap.kept;
    scrapDiscarded += scrap.discarded;
    resolved.push({
      itemId: recipe.outputItemId,
      quantity: recipe.outputQuantity,
      xpAwarded: xp,
      scrapKept: scrap.kept,
      scrapDiscarded: scrap.discarded,
    });
    cycle = undefined;
  }

  return {
    ...workingInventoryDiff(snapshot.stacks, state.inventory),
    consumedTicks,
    consumedInstanceIds,
    itemsCommitted,
    resolved,
    awardedXp,
    scrapKept,
    scrapDiscarded,
    ...(cycle ? { cycle } : {}),
    finishCurrentHonoured: stopReason === "finished_current_item",
    ...(stopReason ? { stopReason } : {}),
  };
}
