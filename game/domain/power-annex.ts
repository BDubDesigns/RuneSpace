import { asContentId } from "@/game/schemas/ids";

/** Stable reward/source identity for the DeWhat? daily allotment ledger. */
export const POWER_ANNEX_REWARD_SOURCE_ID = asContentId("dewhat_emergency_power_annex_allotment");
export const POWER_CELL_DAILY_ALLOTMENT = 5;
export const POWER_ANNEX_RESET_TIME_ZONE = "America/Los_Angeles";

/**
 * Resolve the RuneSpace calendar date from an instant in Pacific time.
 * Intl's IANA timezone implementation applies the correct UTC offset for each
 * daylight-saving transition; this is deliberately not a rolling duration.
 */
export function pacificResetDate(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Reset date requires a valid instant");

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: POWER_ANNEX_RESET_TIME_ZONE,
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
