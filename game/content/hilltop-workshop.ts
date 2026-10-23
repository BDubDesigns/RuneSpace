import {
  LOCATION_IDS,
  MISSION_IDS,
  type LocationId,
  type MissionId,
} from "@/game/config/foundations";

/**
 * The Wise Old Enby's Hilltop Workshop, as authored content (#391).
 *
 * Two facts, in the boundary that owns them: the one place the Resonance Rig
 * physically exists, and the Mission whose COMPLETION puts the player on it for
 * good. Completing Not From Around Here is the moment the Enby has explained
 * RuneSpace; from then on the Rig is the player's to use whether or not the
 * First Runeworking Lesson has been accepted, is under way or is finished.
 * Derived from the Mission record, so there is no second unlock flag to drift.
 *
 * Deliberately not a workstation registry: one Rig, in one workshop, named here
 * by the Mission moment that opens it — the way Rusk Recovery names its
 * Workbench and Fabrication Station (`game/content/rusk-recovery.ts`).
 */
export const HILLTOP_WORKSHOP_CONTENT: {
  locationId: LocationId;
  resonanceRigUnlockMissionId: MissionId;
} = {
  locationId: LOCATION_IDS.hilltopWorkshop,
  resonanceRigUnlockMissionId: MISSION_IDS.notFromAroundHere,
};
