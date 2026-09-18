import { getEffectiveGameBalance, type EffectiveGameBalance } from "@/game/config/balance";
import { ticksToMilliseconds } from "@/game/domain/timing";

/**
 * Clean Pass — the general Welding opportunity mechanic (#190, generalized by
 * #207).
 *
 * Every Welding work unit — a Practice weld, the Cargo Hold repair, the Crew
 * Stop repair, a customer Work Order — rolls its opportunity sections once, and
 * each one is open for exactly one ordinary Welding section. Laying a clean bead
 * at the right moment advances the work one extra section and pays that
 * section's ordinary XP for the activity. Missing one costs nothing at all.
 *
 * The cadence is now a function of the work unit's own length rather than a
 * fixed pair, because Work Orders introduced genuinely variable-length Welding
 * (8 to 19 sections) and two opportunities on a 19-section job would have been
 * the same mechanic stretched thin. `cleanPassOpportunityWindows` owns that
 * rule; everything else here is indifferent to how many there are.
 *
 * This module owns the rules and nothing else: where the opportunities fall,
 * whether one is open right now, whether a claim is valid, and how an outcome
 * is recorded. The work unit's own persistence owns the state, which is why the
 * shape below is small enough for a repair-target row, a Practice row, and a
 * Work Order row to all carry it without any of them learning about the others.
 *
 * Deliberately NOT a generic timed-opportunity engine. Scavenge looks similar
 * and stays entirely separate: its window belongs to a Travel leg, is rolled in
 * ticks, and resolves against a loot table. The only things borrowed here are
 * conventions — a server-derived window and a small network grace.
 */

export type CleanPassOutcome = "claimed" | "missed";

/**
 * One rolled opportunity and what became of it.
 *
 * A `null` outcome means nothing has been recorded for it — which reads as
 * pending, open, or missed depending purely on how far the work has got, so an
 * opportunity the player welded straight past needs no write at all. The one
 * outcome that must be written is a miss at interruption: Stop and Travel
 * durably close an open window so Resume cannot reopen it.
 */
export type CleanPassOpportunity = {
  section: number;
  outcome: CleanPassOutcome | null;
};

/**
 * One work unit's opportunities.
 *
 * `null` means the work unit has not rolled yet, which is distinct from a work
 * unit that rolled and legitimately got none (a unit shorter than the authored
 * minimum). Keeping those apart is what lets a roll stay exactly-once: a
 * `null` is the only state `ensure…Roll` is allowed to overwrite.
 */
export type CleanPassState = {
  opportunities: readonly CleanPassOpportunity[] | null;
};

export const UNROLLED_CLEAN_PASS: CleanPassState = { opportunities: null };

/** Which opportunity is being talked about: an index into the rolled array. */
export type CleanPassIndex = number;

export type CleanPassLifecycle = "pending" | "open" | "claimed" | "missed";

/** The same basis-point roll source every other authored randomness uses. */
export type CleanPassRandom = { nextBasisPoints(): number };

/** The inclusive section range one opportunity may be rolled into. */
export type CleanPassWindow = { minSection: number; maxSection: number };

export function isCleanPassRolled(
  state: CleanPassState,
): state is { opportunities: readonly CleanPassOpportunity[] } {
  return state.opportunities !== null;
}

/** The rolled opportunities, or an empty list while the unit is unrolled. */
export function cleanPassOpportunities(state: CleanPassState): readonly CleanPassOpportunity[] {
  return state.opportunities ?? [];
}

/**
 * Read one work unit's persisted Clean Pass column.
 *
 * Every work unit stores the same JSON array, so this is the one place that
 * knows the durable shape — a repair target, a Practice weld and a Work Order
 * posting all come back through it. Anything that is not a well-formed array of
 * rolled opportunities reads as unrolled rather than throwing: a corrupt column
 * should cost the player one reroll, not lock them out of their own bench.
 */
export function cleanPassFromPersisted(value: unknown): CleanPassState {
  if (!Array.isArray(value)) return UNROLLED_CLEAN_PASS;
  const opportunities: CleanPassOpportunity[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return UNROLLED_CLEAN_PASS;
    const { section, outcome } = entry as { section?: unknown; outcome?: unknown };
    if (!Number.isInteger(section) || (section as number) < 1) return UNROLLED_CLEAN_PASS;
    if (outcome !== null && outcome !== "claimed" && outcome !== "missed") {
      return UNROLLED_CLEAN_PASS;
    }
    opportunities.push({ section: section as number, outcome: outcome ?? null });
  }
  return { opportunities };
}

/** The durable JSON for one work unit's Clean Pass column; `null` while unrolled. */
export function cleanPassToPersisted(
  state: CleanPassState,
): readonly CleanPassOpportunity[] | null {
  return state.opportunities === null ? null : state.opportunities.map((entry) => ({ ...entry }));
}

function rollInclusive(random: CleanPassRandom, minimum: number, maximum: number): number {
  const roll = random.nextBasisPoints();
  if (!Number.isInteger(roll) || roll < 0) {
    throw new RangeError("Clean Pass randomness must be a non-negative integer roll");
  }
  return minimum + (roll % (maximum - minimum + 1));
}

/**
 * How many opportunities a work unit of this length gets.
 *
 * One per authored cadence period, and none at all below the authored minimum
 * length — a five-section job is too short for the mechanic to mean anything,
 * and the trailing-section rule below could not be satisfied on one anyway.
 */
export function cleanPassOpportunityCount(
  totalSections: number,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): number {
  const { cleanPass } = balance.welding;
  if (!Number.isInteger(totalSections) || totalSections < 0) {
    throw new RangeError("Total sections must be a non-negative integer");
  }
  if (totalSections < cleanPass.minimumSectionsForOpportunity) return 0;
  return Math.floor(totalSections / cleanPass.sectionsPerOpportunity);
}

/**
 * The inclusive window each opportunity is rolled into, for a work unit of this
 * length.
 *
 * Nominal windows repeat on the authored cadence — 2-4, then 7-9, then 12-14,
 * and so on — which keeps the rhythm identical however long the job is. The
 * **final** window is the only one that moves: it shifts left just far enough
 * that the last possible opportunity still leaves the authored number of
 * ordinary sections behind it. That is what guarantees a claim can never
 * complete the work unit, on any length, without anybody re-deriving the
 * arithmetic per job.
 *
 * Worked examples (with the current 2/3/5/2 authoring):
 * 6 → 2-4 · 8 → 2-4 · 10 → 2-4, 6-8 · 12 → 2-4, 7-9 · 15 → 2-4, 7-9, 11-13 ·
 * 18 → 2-4, 7-9, 12-14 · 20 → 2-4, 7-9, 12-14, 16-18.
 */
export function cleanPassOpportunityWindows(
  totalSections: number,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): readonly CleanPassWindow[] {
  const { cleanPass } = balance.welding;
  const count = cleanPassOpportunityCount(totalSections, balance);
  if (count === 0) return [];

  const windows: CleanPassWindow[] = [];
  for (let index = 0; index < count; index += 1) {
    const minSection = cleanPass.windowStartSection + index * cleanPass.sectionsPerOpportunity;
    windows.push({ minSection, maxSection: minSection + cleanPass.windowLengthSections - 1 });
  }

  // Only the last window can run out of room, because every earlier one is a
  // whole cadence period ahead of it.
  const last = windows[windows.length - 1]!;
  const latestAllowed = totalSections - cleanPass.trailingOrdinarySections;
  const shift = last.maxSection - latestAllowed;
  if (shift > 0) {
    windows[windows.length - 1] = {
      minSection: last.minSection - shift,
      maxSection: last.maxSection - shift,
    };
  }

  const shifted = windows[windows.length - 1]!;
  if (shifted.minSection < cleanPass.windowStartSection) {
    throw new RangeError(
      `A ${totalSections}-section work unit cannot host ${count} Clean Pass opportunities`,
    );
  }
  return windows;
}

/**
 * Roll one work unit's opportunity sections, one uniformly inside each window.
 *
 * Rolled once per work unit and persisted. Stop and Resume never reroll.
 */
export function rollCleanPassSections(
  random: CleanPassRandom,
  totalSections: number,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): readonly number[] {
  return cleanPassOpportunityWindows(totalSections, balance).map((window) =>
    rollInclusive(random, window.minSection, window.maxSection),
  );
}

/** A freshly rolled state for a new work unit of the given length. */
export function rolledCleanPass(
  random: CleanPassRandom,
  totalSections: number,
  balance: EffectiveGameBalance = getEffectiveGameBalance(),
): CleanPassState {
  return {
    opportunities: rollCleanPassSections(random, totalSections, balance).map((section) => ({
      section,
      outcome: null,
    })),
  };
}

export function cleanPassSection(state: CleanPassState, index: CleanPassIndex): number | null {
  return state.opportunities?.[index]?.section ?? null;
}

export function cleanPassOutcome(
  state: CleanPassState,
  index: CleanPassIndex,
): CleanPassOutcome | null {
  return state.opportunities?.[index]?.outcome ?? null;
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
  const opportunity = state.opportunities?.[index];
  if (!opportunity) return undefined;
  if (opportunity.outcome) return opportunity.outcome;
  if (opportunity.section > sectionsCompleted + 1) return "pending";
  if (opportunity.section === sectionsCompleted + 1) return "open";
  // Welded straight past, including while the player was away: a miss needs no
  // durable write, because the work's own progress already says it happened.
  return "missed";
}

/** The opportunity open during the section currently being welded, if any. */
export function openCleanPassIndex(
  state: CleanPassState,
  sectionsCompleted: number,
): CleanPassIndex | undefined {
  const opportunities = cleanPassOpportunities(state);
  for (let index = 0; index < opportunities.length; index += 1) {
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
  if (!isCleanPassRolled(state)) return state;
  return {
    opportunities: state.opportunities.map((opportunity, candidate) =>
      candidate === index ? { ...opportunity, outcome } : opportunity,
    ),
  };
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
  const opportunities = cleanPassOpportunities(input.state);
  for (let index = 0; index < opportunities.length; index += 1) {
    const opportunity = opportunities[index]!;
    if (opportunity.outcome) continue;
    if (opportunity.section !== input.sectionsCompleted) continue;
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
