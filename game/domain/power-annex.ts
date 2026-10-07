import { ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { asContentId } from "@/game/schemas/ids";
import { RUNESPACE_RESET_TIME_ZONE, pacificResetDate } from "@/game/domain/daily-reset";

/** Stable reward/source identity for the DeWhat? daily allotment ledger. */
export const POWER_ANNEX_REWARD_SOURCE_ID = asContentId("dewhat_emergency_power_annex_allotment");
export const POWER_CELL_DAILY_ALLOTMENT = 5;

/**
 * The Annex's daily claim as one queryable fact (#326): what it hands out,
 * where, and how much. The claim command (`server/power-annex.ts`) and the
 * item-source reference (`game/domain/item-sources.ts`) both read this one
 * descriptor, so the reference can never describe a claim the server does not
 * make. It is the only fixed-supply source that exists, so it is kept beside
 * the system that owns it rather than in a registry of its own.
 */
export const POWER_ANNEX_CLAIM = {
  claimId: POWER_ANNEX_REWARD_SOURCE_ID,
  itemId: ITEM_IDS.powerCell,
  quantity: POWER_CELL_DAILY_ALLOTMENT,
  locationId: LOCATION_IDS.emergencyPowerAnnex,
  cadence: "daily",
} as const;

/**
 * The reset timezone, re-exported under its original Annex-scoped name.
 *
 * The calculation itself moved to the shared `game/domain/daily-reset`
 * boundary (#217), which the Work Order ForceSales refresh now shares; this
 * alias keeps every existing Annex import (and its UI copy) unchanged.
 */
export const POWER_ANNEX_RESET_TIME_ZONE = RUNESPACE_RESET_TIME_ZONE;

export { pacificResetDate };
