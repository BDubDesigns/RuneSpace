import {
  LOCATION_IDS,
  MISSION_IDS,
  type LocationId,
  type MissionId,
} from "@/game/config/foundations";

/**
 * Practice Welding's authored world facts (#190).
 *
 * Two facts, in the boundary that owns them: the one place the Workbench
 * physically exists, and the Mission whose ACCEPTANCE opens it. Accepting
 * 10,000 Hours is the moment Wade says the bench is the player's to use, and
 * that acceptance record stays true forever after, so nothing else needs to be
 * persisted to remember it.
 *
 * Deliberately not a workstation registry: this is one bench, in one yard,
 * opened by one Mission. A second workstation earns its own shape when a real
 * one exists.
 */
export const PRACTICE_WELDING_CONTENT: {
  locationId: LocationId;
  authorizingMissionId: MissionId;
} = {
  locationId: LOCATION_IDS.ruskRecovery,
  authorizingMissionId: MISSION_IDS.tenThousandHours,
};
