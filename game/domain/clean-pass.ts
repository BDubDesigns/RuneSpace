import { getEffectiveGameBalance, type EffectiveGameBalance } from "@/game/config/balance";
import { ticksToMilliseconds } from "@/game/domain/timing";

/**
 * Clean Pass — the general Welding opportunity mechanic (#190).
 *
 * Every Welding work unit — a Practice weld, the Cargo Hold repair, the Crew
 * Stop repair, and whatever is welded next — rolls exactly two optional
 * opportunity sections once, and each one is open for exactly one ordinary
 * Welding section. Laying a clean bead at the right moment advances the work
 * one extra section and pays that section's ordinary XP for the activity.
 * Missing one costs nothing at all.
 *
 * This module owns the rules and nothing else: where the opportunities fall,
 * whether one is open right now, whether a claim is valid, and how an outcome
 * is recorded. The work unit's own persistence owns the state, which is why the
 * shape below is small enough for a repair-target row and a Practice row to
 * both carry it without either learning about the other.
 *
 * Deliberately NOT a generic timed-opportunity engine. Scavenge looks similar
 * and stays entirely separate: its window belongs to a Travel leg, is rolled in
 * ticks, and resolves against a loot table. The only things borrowed here are
 * conventions — a server-derived window and a small network grace.
 */

export type CleanPassOutcome = "claimed" | "missed";

/**
 * The two rolled opportunities for one work unit, and what became of each.
 *
 * `null` sections mean the work unit has not rolled yet. A `null` outcome on a
 * rolled section means nothing has been recorded for it — which reads as
 * pending, open, or missed depending purely on how far the work has got, so
 * an opportunity the player welded straight past needs no write at all. The
 * one outcome that must be written is a miss at interruption: Stop and Travel
 * durably close an open window so Resume cannot reopen it.
 */
export type CleanPassState = {
  firstSection: number | null;
  secondSection: number | null;
  firstOutcome: CleanPassOutcome | null;
  secondOutcome: CleanPassOutcome | null;
};

export const UNROLLED_CLEAN_PASS: CleanPassState = {
  firstSection: null,
  secondSection: null,
  firstOutcome: null,
  secondOutcome: null,
};

/** Which of the two opportunities is being talked about. */
export type CleanPassIndex = 0 | 1;

export type CleanPassLifecycle = "pending" | "open" | "claimed" | "missed";

/** The same basis-point roll source every other authored randomness uses. */
export type CleanPassRandom = { nextBasisPoints(): number };

function rollInclusive(random: CleanPassRandom, minimum: number, maximum: number): number {
  const roll = random.nextBasisPoints();
  if (!Number.isInteger(roll) || roll < 0) {
    throw new RangeError("Clean Pass randomness must be a non-negative integer roll");
  }
  return minimum + (roll % (maximum - minimum + 1));
}

/**
 * Roll one work unit's two opportunity sections.
 *
 * The first lands 2-4 sections in; the second is an independent 2-4 sections
 * after that, so the pair lands at 2-4 and 4-8. The minimum spacing of two
 * sections is the whole reason the second roll is an offset rather than an
 * absolute position: a claimed first opportunity advances the work by one
 * section, which can therefore never step over the second one.
 *
 * Rolled once per work unit and persisted. Stop and Resume never reroll, and
 * this deliberately assumes the current 10-and-12-section work units — a
 * radically different section count earns its own rule rather than a
 * generalized formula nobody has playtested.
 */
export function rollCleanPassSections(
  random: CleanPassRandom,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): { firstSection: number; secondSection: number } {
  const { cleanPass } = balance.welding;
  const firstSection = rollInclusive(
    random,
    cleanPass.firstOpportunityMinSection,
    cleanPass.firstOpportunityMaxSection,
  );
  const offset = rollInclusive(
    random,
    cleanPass.secondOpportunityMinOffset,
    cleanPass.secondOpportunityMaxOffset,
  );
  return { firstSection, secondSection: firstSection + offset };
}

/** A freshly rolled state for a new work unit. */
export function rolledCleanPass(
  random: CleanPassRandom,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): CleanPassState {
  const { firstSection, secondSection } = rollCleanPassSections(random, balance);
  return { firstSection, secondSection, firstOutcome: null, secondOutcome: null };
}

export function cleanPassSection(state: CleanPassState, index: CleanPassIndex): number | null {
  return index === 0 ? state.firstSection : state.secondSection;
}

export function cleanPassOutcome(
  state: CleanPassState,
  index: CleanPassIndex,
): CleanPassOutcome | null {
  return index === 0 ? state.firstOutcome : state.secondOutcome;
}

/**
 * What one opportunity currently is, given how many whole sections of this work
 * unit have resolved. `sectionsCompleted + 1` is the section being welded right
 * now, because resolution only ever advances the durable cursor by whole
 * sections.
 */
export function cleanPassLifecycle(
  state: CleanPassState,
  index: CleanPassIndex,
  sectionsCompleted: number,
): CleanPassLifecycle | undefined {
  const section = cleanPassSection(state, index);
  if (section === null) return undefined;
  const outcome = cleanPassOutcome(state, index);
  if (outcome) return outcome;
  if (section > sectionsCompleted + 1) return "pending";
  if (section === sectionsCompleted + 1) return "open";
  // Welded straight past, including while the player was away: a miss needs no
  // durable write, because the work's own progress already says it happened.
  return "missed";
}

/** The opportunity open during the section currently being welded, if any. */
export function openCleanPassIndex(
  state: CleanPassState,
  sectionsCompleted: number,
): CleanPassIndex | undefined {
  for (const index of [0, 1] as const) {
    if (cleanPassLifecycle(state, index, sectionsCompleted) === "open") return index;
  }
  return undefined;
}

/** Record one opportunity's outcome. Pure: the caller persists the result. */
export function withCleanPassOutcome(
  state: CleanPassState,
  index: CleanPassIndex,
  outcome: CleanPassOutcome,
): CleanPassState {
  return index === 0 ? { ...state, firstOutcome: outcome } : { ...state, secondOutcome: outcome };
}

/**
 * Close whatever window is open right now as missed.
 *
 * Manual Stop and Travel share this: an opportunity the player was in the
 * middle of is spent, so resuming the same partial weld later cannot resurrect
 * it. An opportunity still ahead of the work is untouched and stays scheduled.
 */
export function withOpenCleanPassMissed(
  state: CleanPassState,
  sectionsCompleted: number,
): CleanPassState {
  const index = openCleanPassIndex(state, sectionsCompleted);
  return index === undefined ? state : withCleanPassOutcome(state, index, "missed");
}

export type CleanPassClaim =
  | { ok: true; index: CleanPassIndex }
  | { ok: false; reason: "none_open" | "expired" };

/**
 * Validate a claim against authoritative timing.
 *
 * The caller has already reconciled due work, so every whole section that has
 * elapsed is committed and `sectionsCompleted + 1` is genuinely the section in
 * progress. That makes the open window purely positional — no second timing
 * source to drift.
 *
 * The one timing input is the grace: a claim that arrives just after its
 * section resolved still counts, the same small network allowance Scavenge
 * makes, and only when the durable cursor has actually advanced past this
 * run's start (so resuming a weld cannot back-date a claim on an opportunity
 * that was welded past long ago).
 */
export function cleanPassClaim(input: {
  state: CleanPassState;
  sectionsCompleted: number;
  /** The work action's start, used only to tell a real cursor advance from a fresh Resume. */
  startedAt: Date;
  /** The durable action cursor: the completion instant of the last whole section. */
  resolvedThroughAt: Date;
  now: Date;
  balance?: EffectiveGameBalance;
}): CleanPassClaim {
  const balance = input.balance ?? getEffectiveGameBalance();
  const open = openCleanPassIndex(input.state, input.sectionsCompleted);
  if (open !== undefined) return { ok: true, index: open };

  // The section that just resolved, inside the network grace.
  const graceMs = balance.welding.cleanPass.claimGraceMs;
  const cursorAdvanced = input.resolvedThroughAt.getTime() > input.startedAt.getTime();
  const withinGrace = input.now.getTime() - input.resolvedThroughAt.getTime() <= graceMs;
  for (const index of [0, 1] as const) {
    const section = cleanPassSection(input.state, index);
    if (section === null || cleanPassOutcome(input.state, index)) continue;
    if (section !== input.sectionsCompleted) continue;
    if (cursorAdvanced && withinGrace) return { ok: true, index };
    return { ok: false, reason: "expired" };
  }
  return { ok: false, reason: "none_open" };
}

/**
 * When the currently open window closes, for presentation only.
 *
 * An open opportunity lasts exactly one ordinary Welding section, which began
 * at the durable cursor. The authoritative claim is validated positionally
 * above; this is what a countdown renders.
 */
export function cleanPassWindowExpiresAt(
  resolvedThroughAt: Date,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): Date {
  return new Date(
    resolvedThroughAt.getTime() + ticksToMilliseconds(balance.welding.attemptDurationTicks),
  );
}
