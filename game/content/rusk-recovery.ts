import {
  LOCATION_IDS,
  MISSION_IDS,
  type LocationId,
  type MissionId,
} from "@/game/config/foundations";

/**
 * Wade's yard, as authored content (#190).
 *
 * Three facts, in the boundary that owns them: the one place these surfaces
 * physically exist, the Mission whose ACCEPTANCE opens the Workbench, and the
 * Mission whose COMPLETION turns the Work Orders terminal from scenery into a
 * real surface. Both are the same Mission today and are named separately
 * anyway, because they are genuinely different moments: Wade offering the bench
 * is not Wade trusting the player with paying work.
 *
 * Deliberately not a workstation registry: this is one bench and one terminal,
 * in one yard. A second workstation earns its own shape when a real one exists.
 */
export const RUSK_RECOVERY_CONTENT: {
  locationId: LocationId;
  practiceAuthorizingMissionId: MissionId;
  workOrdersRevealMissionId: MissionId;
} = {
  locationId: LOCATION_IDS.ruskRecovery,
  practiceAuthorizingMissionId: MISSION_IDS.tenThousandHours,
  workOrdersRevealMissionId: MISSION_IDS.tenThousandHours,
};
