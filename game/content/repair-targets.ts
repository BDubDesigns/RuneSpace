import {
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  REPAIR_TARGET_IDS,
  type LocalPlaceId,
  type LocationId,
  type MissionId,
  type RepairTargetId,
} from "@/game/config/foundations";

/**
 * The authoritative registry of things Welding can repair (#172).
 *
 * A repair target says where the work happens and which accepted Mission
 * authorizes it. Its recipe (materials, increments) is balance; its durable
 * per-character state is `character_repair_targets`. Nothing here is a second
 * copy of either.
 *
 * `authorizingMissionId` is the Mission whose ACCEPTANCE reveals the repair
 * controls — not a completion gate. A finished repair stays usable regardless
 * of Mission state, which is why a player who repaired the Cargo Hold keeps
 * its storage forever.
 */
export type RepairTargetDefinition = {
  id: RepairTargetId;
  displayName: string;
  /** The World Location the character must genuinely be at to do the work. */
  locationId: LocationId;
  /** The Local Place hosting the work, when the target lives inside one. */
  localPlaceId?: LocalPlaceId;
  authorizingMissionId: MissionId;
};

export const REPAIR_TARGETS: readonly RepairTargetDefinition[] = [
  {
    id: REPAIR_TARGET_IDS.cargoHold,
    displayName: "Cargo Hold",
    locationId: LOCATION_IDS.crashSite,
    authorizingMissionId: MISSION_IDS.holdItTogether,
  },
  {
    id: REPAIR_TARGET_IDS.crewStop,
    displayName: "Crew Stop",
    locationId: LOCATION_IDS.holoHollow,
    localPlaceId: LOCAL_PLACE_IDS.holoHollowCrewStop,
    authorizingMissionId: MISSION_IDS.outOfTheWeather,
  },
] as const satisfies readonly RepairTargetDefinition[];

const byId = new Map<string, RepairTargetDefinition>(
  REPAIR_TARGETS.map((target) => [target.id, target]),
);

export function getRepairTarget(targetId: string): RepairTargetDefinition | undefined {
  return byId.get(targetId);
}
