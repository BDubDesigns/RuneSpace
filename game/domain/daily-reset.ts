/**
 * RuneSpace's shared daily-reset boundary (#217).
 *
 * Generalized out of the Power Annex, which was its only consumer until the
 * Work Order ForceSales refresh (#217) needed the exact same calendar-day
 * semantics: a per-character daily allowance that changes at local midnight in
 * one fixed timezone, not after a rolling 24-hour duration. Every daily-reset
 * consumer shares this one function so "what day is it, for daily-limit
 * purposes" can never quietly diverge between them.
 */

/** The canonical RuneSpace daily-reset timezone. Never a per-feature choice. */
export const RUNESPACE_RESET_TIME_ZONE = "America/Los_Angeles";

/**
 * Resolve the RuneSpace calendar date from an instant, in the reset timezone.
 * Intl's IANA timezone implementation applies the correct UTC offset for each
 * daylight-saving transition; this is deliberately not a rolling duration.
 */
export function pacificResetDate(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Reset date requires a valid instant");

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: RUNESPACE_RESET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  if (!year || !month || !day) throw new Error("Pacific reset date could not be calculated");
  return `${year}-${month}-${day}`;
}
