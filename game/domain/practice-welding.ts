import {
  getEffectiveGameBalance,
  practiceSectionXp,
  type EffectiveGameBalance,
} from "@/game/config/balance";
import {
  rolledCleanPass,
  UNROLLED_CLEAN_PASS,
  type CleanPassRandom,
  type CleanPassState,
} from "@/game/domain/clean-pass";
import { ITEM_IDS } from "@/game/config/foundations";
import { planExactStackRemoval } from "@/game/domain/inventory";

/**
 * Practice Welding — the indefinite Welding training loop at Wade's Workbench
 * (#190).
 *
 * It is genuine Welding, not a tutorial simulation: the same skill, the same
 * five-tick section cadence, and the same Clean Pass opportunities as an
 * authored repair, at half the XP because nothing is actually being fixed. Two
 * Scrap Metal go in at the start of every fresh weld and up to two Slag come
 * out at the end of it.
 *
 * What makes it different from a repair is that it repeats. A repair target is
 * one finite physical job that permanently completes; Practice has no end
 * state at all, so it owns a small durable state of its own — the partial
 * weld, whether the current weld's Scrap is already spent, this run's totals,
 * and the player's Slag preference — rather than pretending to be a resettable
 * repair target.
 */

export type PracticeWeldState = {
  /** Whole sections of the CURRENT weld that have resolved (0 .. sectionsPerWeld - 1). */
  sectionsCompleted: number;
  /**
   * This weld's two Scrap are already spent, so it is a real partial weld that
   * Resume continues rather than a new one that would cost two more. Stop never
   * refunds, so this survives Stop, Travel, and going offline.
   */
  cycleActive: boolean;
  cleanPass: CleanPassState;
};

export const UNSTARTED_PRACTICE: PracticeWeldState = {
  sectionsCompleted: 0,
  cycleActive: false,
  cleanPass: UNROLLED_CLEAN_PASS,
};

/**
 * Everything resolution needs to know about carrying capacity, in numbers.
 *
 * Slag output can never block or fail a completed weld, so this models exactly
 * what Keep Slag needs: which Slag stacks have room, and how many slots and how
 * much mass are free. Consuming Scrap frees its mass immediately, and frees a
 * slot only when it empties a whole Scrap stack (#230) — which is why the
 * snapshot carries the stacks themselves rather than a loose total.
 */
export type PracticeSnapshot = {
  practice: PracticeWeldState;
  /**
   * Quantities of the carried Scrap Metal stacks, each at or under the Scrap
   * stack limit. Their sum is the Scrap available; how they are split across
   * stacks decides how many slots consuming them actually frees.
   */
  scrapStackQuantities: readonly number[];
  /** Quantities of the carried Slag stacks, each at or under the Slag stack limit. */
  slagStackQuantities: readonly number[];
  slotsAvailable: number;
  massAvailableGrams: number;
  /** The player's persistent per-character preference, read at completion time. */
  autoDiscardSlag: boolean;
  /**
   * The player asked for the weld they have already paid for to finish and the
   * run to end there (#207).
   *
   * Practice is deliberately continuous, so "let the current one finish" is not
   * something ordinary Stop can express: Stop preserves a partial weld, and
   * waiting costs two more Scrap the moment the weld completes. This is the
   * narrow third intent — finish this unit, charge nothing further, and leave
   * the Workbench clear so a customer Work Order can claim it.
   */
  finishCurrentWeld: boolean;
};

/** One completed weld, as `This Run` shows it. */
export type PracticeResolvedWeld = {
  /** Sections this resolution welded for it; a claimed Clean Pass supplies the rest. */
  sections: number;
  scrapConsumed: number;
  slagKept: number;
  slagDiscarded: number;
  xpGained: number;
};

/**
 * Why a continuous run stopped on its own.
 *
 * `out_of_scrap` is the bench running dry: the weld in progress finishes and
 * there is nothing to start another with. `finished_current_weld` is the player
 * having asked for exactly that outcome in advance (#207) — the paid weld
 * completes, no next recipe is consumed, and the bench is left clear. Everything
 * else that ends a run — the player's ordinary Stop, Travel — is an
 * interruption, not a resolution.
 */
export type PracticeStopReason = "out_of_scrap" | "finished_current_weld";

export type PracticeResolution = {
  consumedTicks: number;
  /** The durable "finish and stop" intent was acted on and must now be cleared. */
  finishCurrentWeldHonoured: boolean;
  /** Whole sections welded in this window, excluding any Clean Pass advance. */
  sectionsResolved: number;
  completedWelds: number;
  scrapConsumed: number;
  slagKept: number;
  slagDiscarded: number;
  awardedXp: number;
  /** The durable state to persist, including any freshly rolled Clean Pass. */
  practice: PracticeWeldState;
  resolvedWelds: readonly PracticeResolvedWeld[];
  /**
   * The aggregate capacity this resolution decided its Slag against: what was
   * free at the start plus everything the consumed Scrap freed along the way —
   * its full mass, but only the slots of the Scrap stacks it actually emptied.
   *
   * Persistence plans the kept Slag against exactly this, so the write places
   * what resolution decided rather than re-deciding it against a snapshot taken
   * after the Scrap rows are already gone. Placing the total against this
   * aggregate can never exceed the per-weld budget resolution actually used,
   * because consuming Scrap only ever frees capacity.
   */
  slagBudget: { slots: number; massGrams: number };
  stopReason?: PracticeStopReason;
};

type WorkingCapacity = {
  slagStacks: number[];
  slotsAvailable: number;
  massAvailableGrams: number;
};

/**
 * Add one weld's Slag, keeping as much as ordinary capacity allows and
 * discarding only the overflow. Never fails: a completed weld is completed.
 */
function depositSlag(
  capacity: WorkingCapacity,
  units: number,
  stackLimit: number,
  massGrams: number,
): { kept: number; discarded: number } {
  let kept = 0;
  for (let unit = 0; unit < units; unit += 1) {
    if (capacity.massAvailableGrams < massGrams) continue;
    const partial = capacity.slagStacks.findIndex((quantity) => quantity < stackLimit);
    const partialQuantity = partial >= 0 ? capacity.slagStacks[partial] : undefined;
    if (partial >= 0 && partialQuantity !== undefined) {
      capacity.slagStacks[partial] = partialQuantity + 1;
    } else if (capacity.slotsAvailable > 0) {
      capacity.slagStacks.push(1);
      capacity.slotsAvailable -= 1;
    } else {
      continue;
    }
    capacity.massAvailableGrams -= massGrams;
    kept += 1;
  }
  return { kept, discarded: units - kept };
}

/** Total carried Scrap across its stacks. */
export function practiceScrapAvailable(snapshot: Pick<PracticeSnapshot, "scrapStackQuantities">) {
  return snapshot.scrapStackQuantities.reduce((total, quantity) => total + quantity, 0);
}

/**
 * How many inventory slots consuming `quantity` Scrap from these stacks frees.
 *
 * A slot frees only when a stack empties, so two Scrap taken from one stack of
 * three free nothing, while the same two taken from two single pieces free
 * two. This asks the same removal planner persistence's carried-stack
 * consumption applies, so resolution and the write agree on which stacks go.
 */
function scrapSlotsFreed(stackQuantities: readonly number[], quantity: number): number {
  if (quantity === 0) return 0;
  const removal = planExactStackRemoval(
    stackQuantities.map((stackQuantity, index) => ({
      id: index,
      itemId: ITEM_IDS.scrapMetal,
      quantity: stackQuantity,
    })),
    ITEM_IDS.scrapMetal,
    quantity,
  );
  if (!removal.ok) throw new RangeError("Practice cannot consume more Scrap than is carried");
  return removal.deletedStackIds.length;
}

/**
 * Resolve only whole, bounded Practice sections.
 *
 * A partial section leaves the durable cursor untouched and therefore grants
 * neither progress nor XP, exactly as repair Welding does. A fresh weld begins
 * the instant the previous one finishes — that is what makes one Start a
 * continuous run — and its two Scrap are consumed at that instant, even when
 * the window ends before the new weld's first section resolves. `cycleActive`
 * is what makes that safe: the next resolution continues the weld the player
 * already paid for instead of charging again.
 */
export function resolvePracticeWelding(input: {
  elapsedTicks: number;
  snapshot: PracticeSnapshot;
  random: CleanPassRandom;
  balance?: EffectiveGameBalance;
}): PracticeResolution {
  const balance = input.balance ?? getEffectiveGameBalance();
  if (!Number.isInteger(input.elapsedTicks) || input.elapsedTicks < 0) {
    throw new RangeError("Elapsed ticks must be a non-negative integer");
  }
  const { practiceWelding, welding, items } = balance;
  const sectionTicks = welding.attemptDurationTicks;
  const sectionXp = practiceSectionXp(balance);
  const { snapshot } = input;

  const capacity: WorkingCapacity = {
    slagStacks: [...snapshot.slagStackQuantities],
    slotsAvailable: snapshot.slotsAvailable,
    massAvailableGrams: snapshot.massAvailableGrams,
  };

  let { sectionsCompleted, cycleActive, cleanPass } = snapshot.practice;
  let scrapAvailable = practiceScrapAvailable(snapshot);
  let scrapSlotsFreedSoFar = 0;
  let remainingTicks = input.elapsedTicks;
  let consumedTicks = 0;
  let sectionsResolved = 0;
  let scrapConsumed = 0;
  let slagKept = 0;
  let slagDiscarded = 0;
  let stopReason: PracticeStopReason | undefined;
  const resolvedWelds: PracticeResolvedWeld[] = [];
  let weldSections = 0;

  for (;;) {
    if (!cycleActive) {
      // An honoured "finish and stop" never starts the next weld, so it never
      // spends the next weld's Scrap. Checked before the Scrap test so the run
      // reports what the player asked for rather than an incidental shortage.
      if (snapshot.finishCurrentWeld) {
        stopReason = "finished_current_weld";
        break;
      }
      if (scrapAvailable < practiceWelding.scrapPerWeld) {
        stopReason = "out_of_scrap";
        break;
      }
      // The two Scrap are spent the moment the weld begins, and their mass is
      // free from that moment. Slots free only as whole Scrap stacks empty
      // (#230): the cumulative consumption is replanned against the original
      // stacks, exactly as persistence removes it in one go, so the freed count
      // only ever grows and ends at precisely what the write will free.
      scrapAvailable -= practiceWelding.scrapPerWeld;
      scrapConsumed += practiceWelding.scrapPerWeld;
      const slotsFreed = scrapSlotsFreed(snapshot.scrapStackQuantities, scrapConsumed);
      capacity.slotsAvailable += slotsFreed - scrapSlotsFreedSoFar;
      scrapSlotsFreedSoFar = slotsFreed;
      capacity.massAvailableGrams += practiceWelding.scrapPerWeld * items.scrapMetal.massGrams;
      cycleActive = true;
      sectionsCompleted = 0;
      weldSections = 0;
      cleanPass = rolledCleanPass(input.random, practiceWelding.sectionsPerWeld, balance);
    }

    if (remainingTicks < sectionTicks) break;
    remainingTicks -= sectionTicks;
    consumedTicks += sectionTicks;
    sectionsCompleted += 1;
    sectionsResolved += 1;
    weldSections += 1;

    if (sectionsCompleted >= practiceWelding.sectionsPerWeld) {
      // The Slag setting is read here, at completion time, so flipping it
      // mid-weld applies to the weld that is finishing.
      const produced = snapshot.autoDiscardSlag
        ? { kept: 0, discarded: practiceWelding.slagPerWeld }
        : depositSlag(
            capacity,
            practiceWelding.slagPerWeld,
            items.slag.stackLimit,
            items.slag.massGrams,
          );
      slagKept += produced.kept;
      slagDiscarded += produced.discarded;
      resolvedWelds.push({
        sections: weldSections,
        scrapConsumed: practiceWelding.scrapPerWeld,
        slagKept: produced.kept,
        slagDiscarded: produced.discarded,
        xpGained: weldSections * sectionXp,
      });
      cycleActive = false;
      sectionsCompleted = 0;
      weldSections = 0;
      cleanPass = UNROLLED_CLEAN_PASS;
    }
  }

  return {
    consumedTicks,
    // The intent is spent once resolution has acted on it, whether that means
    // a weld finished under it or the bench was already clear. Leaving it set
    // would silently refuse the player's next Start.
    finishCurrentWeldHonoured: stopReason === "finished_current_weld",
    sectionsResolved,
    completedWelds: resolvedWelds.length,
    scrapConsumed,
    slagKept,
    slagDiscarded,
    awardedXp: sectionsResolved * sectionXp,
    practice: { sectionsCompleted, cycleActive, cleanPass },
    resolvedWelds,
    slagBudget: {
      slots: snapshot.slotsAvailable + scrapSlotsFreedSoFar,
      massGrams: snapshot.massAvailableGrams + scrapConsumed * items.scrapMetal.massGrams,
    },
    ...(stopReason ? { stopReason } : {}),
  };
}

/**
 * Whether a fresh weld can begin right now. Resume is deliberately NOT this
 * question: a partial weld's Scrap is already spent, so it continues with none
 * left at all.
 */
export function canBeginPracticeWeld(
  scrapAvailable: number,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): boolean {
  return scrapAvailable >= balance.practiceWelding.scrapPerWeld;
}

/** A partial weld the player has already paid for is waiting to be resumed. */
export function hasResumablePracticeWeld(practice: PracticeWeldState): boolean {
  return practice.cycleActive;
}
