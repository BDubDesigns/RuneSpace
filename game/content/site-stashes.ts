import {
  REPAIR_TARGET_IDS,
  LOCATION_IDS,
  type LocationId,
  type RepairTargetId,
} from "@/game/config/foundations";
import { getRepairTarget } from "@/game/content/repair-targets";

/**
 * The authored sites that can host a character-owned stash mount (#284).
 *
 * A site names the repair target whose completion IS the built mount. The
 * mount's Welding gate, recipe and construction time live with that repair
 * target (`game/content/repair-targets`, `balance.repairTargets`); storage
 * capacity comes from whichever ordinary container is installed. Nothing here
 * is a second copy of either.
 */
export type SiteStashDefinition = {
  locationId: LocationId;
  mountTargetId: RepairTargetId;
};

export const SITE_STASHES: readonly SiteStashDefinition[] = [
  { locationId: LOCATION_IDS.theJag, mountTargetId: REPAIR_TARGET_IDS.siteStashTheJag },
  { locationId: LOCATION_IDS.ruskRecovery, mountTargetId: REPAIR_TARGET_IDS.siteStashRuskRecovery },
  {
    locationId: LOCATION_IDS.abandonedProcessingYard,
    mountTargetId: REPAIR_TARGET_IDS.siteStashProcessingYard,
  },
  { locationId: LOCATION_IDS.deepJag, mountTargetId: REPAIR_TARGET_IDS.siteStashDeepJag },
] as const satisfies readonly SiteStashDefinition[];

const byLocation = new Map<string, SiteStashDefinition>(
  SITE_STASHES.map((site) => [site.locationId, site]),
);

export function getSiteStash(locationId: string): SiteStashDefinition | undefined {
  return byLocation.get(locationId);
}

// A site whose mount target is missing, or lives at a different location, would
// reach a player as a stash that silently never builds. Fail at module load.
for (const site of SITE_STASHES) {
  const target = getRepairTarget(site.mountTargetId);
  if (!target || target.locationId !== site.locationId) {
    throw new Error(
      `Site stash "${site.locationId}" has no mount repair target authored at that location.`,
    );
  }
}
