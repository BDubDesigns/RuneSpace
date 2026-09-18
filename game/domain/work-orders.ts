import {
  getEffectiveGameBalance,
  getItemDefinition,
  workOrderSectionXp,
  type EffectiveGameBalance,
} from "@/game/config/balance";
import type { ItemId, WorkOrderId } from "@/game/config/foundations";
import { MERCHANTS } from "@/game/content/merchants";
import { WORK_ORDERS, type WorkOrderDefinition } from "@/game/content/work-orders";
import type { CleanPassRandom, CleanPassState } from "@/game/domain/clean-pass";
import { rolledCleanPass } from "@/game/domain/clean-pass";

/**
 * Work Orders — the rules every authored client job obeys (#207).
 *
 * The jobs themselves are content and the board's shape is balance; this module
 * is the arithmetic and the selection between them. It is deliberately not a
 * profession or contract engine: there is one board, one active job, and one
 * completion, and a second consumer will have to earn any abstraction beyond
 * that.
 */

/** The durable state of the one accepted job on the bench. */
export type ActiveWorkOrderState = {
  workOrderId: WorkOrderId;
  /** Whole Welding sections resolved for this job. */
  sectionsCompleted: number;
  cleanPass: CleanPassState;
};

/**
 * What the player would pay to replace one unit of a material.
 *
 * Derived from the merchant registry rather than restated as a second price
 * table, so a shop price and a Work Order payout can never disagree. A price a
 * merchant *sells* at is the real replacement cost, which is why a Power Cell
 * counts at Bix's 8 rather than the 3 he buys them back for — a job that
 * consumes a Cell must not underpay the player who has to buy another. Where
 * nobody sells the material, the best available buy-back price is the only
 * honest valuation of the unit the player gives up.
 */
export function workOrderMaterialReplacementValue(itemId: ItemId): number {
  let sellPrice: number | undefined;
  let buyPrice: number | undefined;
  for (const merchant of MERCHANTS) {
    for (const price of merchant.prices) {
      if (price.itemId !== itemId) continue;
      if (price.sellPrice !== undefined) {
        sellPrice =
          sellPrice === undefined ? price.sellPrice : Math.min(sellPrice, price.sellPrice);
      }
      if (price.buyPrice !== undefined) {
        buyPrice = buyPrice === undefined ? price.buyPrice : Math.max(buyPrice, price.buyPrice);
      }
    }
  }
  const value = sellPrice ?? buyPrice;
  if (value === undefined) {
    throw new Error(`No merchant price establishes a replacement value for ${itemId}`);
  }
  return value;
}

/** The whole recipe's replacement value, in Credits. */
export function workOrderMaterialReplacementTotal(definition: WorkOrderDefinition): number {
  return definition.materials.reduce(
    (total, material) =>
      total + workOrderMaterialReplacementValue(material.itemId) * material.quantity,
    0,
  );
}

/**
 * The one payout rule, applied to one job.
 *
 * `base + sections × perSection + replacementValue × premium`, rounded up to
 * the next authored Credit step. The fixed base is deliberate: it keeps a short
 * job genuinely attractive on a Credits-per-minute basis instead of every job
 * collapsing to one perfectly-scaled rate.
 */
export function workOrderPayoutCredits(
  definition: WorkOrderDefinition,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): number {
  const { payout } = balance.workOrders;
  const raw =
    payout.baseCredits +
    definition.sections * payout.creditsPerSection +
    (workOrderMaterialReplacementTotal(definition) * payout.materialPremiumBps) / 10_000;
  return Math.ceil(raw / payout.roundUpToCredits) * payout.roundUpToCredits;
}

/** The total Welding XP a job pays, fixed by its section count. */
export function workOrderTotalXp(
  definition: WorkOrderDefinition,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): number {
  return definition.sections * workOrderSectionXp(balance);
}

/** A job is finished the moment its last section resolves. */
export function workOrderComplete(
  definition: WorkOrderDefinition,
  sectionsCompleted: number,
): boolean {
  return sectionsCompleted >= definition.sections;
}

/** A freshly accepted job's durable state, with its Clean Pass rolled once. */
export function acceptedWorkOrderState(
  definition: WorkOrderDefinition,
  random: CleanPassRandom,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): ActiveWorkOrderState {
  return {
    workOrderId: definition.id,
    sectionsCompleted: 0,
    // Rolled once, here, from the job's own length. Stop, Resume, Travel and
    // going offline never reroll it.
    cleanPass: rolledCleanPass(random, definition.sections, balance),
  };
}

/** Every job the character's Welding level currently makes eligible. */
export function eligibleWorkOrders(
  weldingLevel: number,
  pool: readonly WorkOrderDefinition[] = WORK_ORDERS,
): readonly WorkOrderDefinition[] {
  // Lower-level jobs stay eligible forever: a later Welding tier expands the
  // pool rather than replacing the work the player already knows how to do.
  return pool.filter((definition) => weldingLevel >= definition.requiredWeldingLevel);
}

/**
 * Choose one job to fill a board slot.
 *
 * Two exclusions apply, and they are by JOB identity, never client identity:
 * a job already visible elsewhere on the board cannot be drawn, and the job
 * just completed should not immediately redraw. There is deliberately no
 * weighting, normalization, or per-client cap — a client with more authored
 * jobs simply appears more often, which is the content saying they use Wade's
 * shop more.
 *
 * If the two exclusions ever leave nothing (a future pool smaller than four),
 * keeping the visible postings distinct wins and the just-completed exclusion
 * is relaxed first. That cannot arise from the current eight.
 */
export function selectWorkOrderRefill(input: {
  eligible: readonly WorkOrderDefinition[];
  /** Jobs currently occupying the board's other slots. */
  visibleWorkOrderIds: readonly WorkOrderId[];
  /** The job whose slot is being refilled, when it was just completed. */
  justClearedWorkOrderId?: WorkOrderId;
  random: CleanPassRandom;
}): WorkOrderDefinition | undefined {
  const visible = new Set<string>(input.visibleWorkOrderIds);
  const distinct = input.eligible.filter((definition) => !visible.has(definition.id));
  if (distinct.length === 0) return undefined;

  const preferred = input.justClearedWorkOrderId
    ? distinct.filter((definition) => definition.id !== input.justClearedWorkOrderId)
    : distinct;
  const candidates = preferred.length > 0 ? preferred : distinct;

  const roll = input.random.nextBasisPoints();
  if (!Number.isInteger(roll) || roll < 0) {
    throw new RangeError("Work Order selection randomness must be a non-negative integer roll");
  }
  return candidates[roll % candidates.length];
}

/**
 * Draw a whole board from scratch.
 *
 * Each slot is filled in turn against the jobs the earlier slots already took,
 * which is the same distinctness rule a single refill obeys — one selection
 * rule, used twice, rather than a separate initial-board algorithm.
 */
export function selectInitialWorkOrderBoard(input: {
  eligible: readonly WorkOrderDefinition[];
  slots: number;
  random: CleanPassRandom;
}): readonly WorkOrderDefinition[] {
  const board: WorkOrderDefinition[] = [];
  for (let slot = 0; slot < input.slots; slot += 1) {
    const drawn = selectWorkOrderRefill({
      eligible: input.eligible,
      visibleWorkOrderIds: board.map((definition) => definition.id),
      random: input.random,
    });
    if (!drawn) break;
    board.push(drawn);
  }
  return board;
}

/**
 * Validate the authored pool against the rules it is supposed to obey.
 *
 * Runs at module load beside the other content registries, so an authoring
 * mistake fails fast at the boundary instead of reaching a player as a wrong
 * payout, an unpayable recipe, or a job whose length cannot host the Clean Pass
 * cadence.
 */
export function validateWorkOrderDefinitions(
  definitions: readonly WorkOrderDefinition[] = WORK_ORDERS,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): void {
  const seen = new Set<string>();
  for (const definition of definitions) {
    if (seen.has(definition.id)) {
      throw new Error(`Duplicate Work Order id: ${definition.id}`);
    }
    seen.add(definition.id);

    if (!definition.title.trim() || !definition.clientName.trim()) {
      throw new Error(`${definition.id} must author a title and a client name`);
    }
    if (!definition.description.trim()) {
      throw new Error(`${definition.id} must author a board description`);
    }
    if (!Number.isInteger(definition.requiredWeldingLevel) || definition.requiredWeldingLevel < 1) {
      throw new Error(`${definition.id} requires a positive integer Welding level`);
    }
    if (!Number.isInteger(definition.sections) || definition.sections < 1) {
      throw new Error(`${definition.id} requires a positive integer section count`);
    }
    // Deliberately NO minimum beyond one section. The generalized Clean Pass
    // contract supports zero opportunities below the authored minimum length,
    // so a short job simply has none — that is the cadence working, not a job
    // that is malformed. Inventing a minimum here would be an authoring rule
    // nobody approved.

    if (definition.materials.length === 0) {
      throw new Error(`${definition.id} must author at least one required material`);
    }
    const materialIds = new Set<string>();
    for (const material of definition.materials) {
      if (materialIds.has(material.itemId)) {
        throw new Error(`${definition.id} names ${material.itemId} twice in one recipe`);
      }
      materialIds.add(material.itemId);
      const item = getItemDefinition(material.itemId, balance);
      if (!item) throw new Error(`${definition.id} requires an unknown item: ${material.itemId}`);
      // Acceptance commits the recipe through the authoritative carried-stack
      // boundary, which has no execution path for a unique item.
      if (item.kind !== "stack") {
        throw new Error(`${definition.id} requires a non-stackable item: ${material.itemId}`);
      }
      if (!Number.isInteger(material.quantity) || material.quantity < 1) {
        throw new Error(`${definition.id} requires a positive integer quantity of ${item.itemId}`);
      }
    }

    // The authored number and the rule must be the same number. A price change
    // that moves a replacement value fails here rather than quietly paying a
    // stale rate.
    const derived = workOrderPayoutCredits(definition, balance);
    if (definition.payoutCredits !== derived) {
      throw new Error(
        `${definition.id} authors ${definition.payoutCredits} Credits but the payout rule ` +
          `derives ${derived}`,
      );
    }
  }

  // The board can only guarantee three distinct postings, plus a refill that
  // avoids all three, from a pool of at least four.
  const minimumPool = balance.workOrders.postedSlots + 1;
  if (definitions.length < minimumPool) {
    throw new Error(
      `The Work Order pool needs at least ${minimumPool} jobs to fill ` +
        `${balance.workOrders.postedSlots} distinct slots and refill one`,
    );
  }
}
