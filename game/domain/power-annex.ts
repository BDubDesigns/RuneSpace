import { asContentId } from "@/game/schemas/ids";
import { RUNESPACE_RESET_TIME_ZONE, pacificResetDate } from "@/game/domain/daily-reset";

/** Stable reward/source identity for the DeWhat? daily allotment ledger. */
export const POWER_ANNEX_REWARD_SOURCE_ID = asContentId("dewhat_emergency_power_annex_allotment");
export const POWER_CELL_DAILY_ALLOTMENT = 5;

/**
 * The reset timezone, re-exported under its original Annex-scoped name.
 *
 * The calculation itself moved to the shared `game/domain/daily-reset`
 * boundary (#217), which the Work Order ForceSales refresh now shares; this
 * alias keeps every existing Annex import (and its UI copy) unchanged.
 */
export const POWER_ANNEX_RESET_TIME_ZONE = RUNESPACE_RESET_TIME_ZONE;

export { pacificResetDate };
