import {
  LOCATION_IDS,
  MISSION_IDS,
  REPAIR_TARGET_IDS,
  type LocationId,
  type MissionId,
  type RepairTargetId,
} from "@/game/config/foundations";
import { HILLTOP_WORKSHOP_CONTENT } from "./hilltop-workshop";

/**
 * Where a Resonance Rig stands, and the one durable fact that opens it (#441).
 *
 * Runeworking has always had one station, the Wise Old Enby's prebuilt Rig at
 * Hilltop Workshop, opened by the Not From Around Here mystery being complete.
 * A character's personal Rig at the Crash Site is a second station, opened by their
 * own Rig repair being complete. Both are derived from records the game already
 * keeps (a Mission completion stamp, a repair completion), so there is no second
 * "Rig unlocked" flag to drift.
 *
 * A recipe belongs to the station whose location authors its action in
 * `availableActionIds` (`game/content/locations.ts`); nothing here lists recipes.
 * Deliberately two entries, not a station engine: a third station earns its own
 * line here.
 */
export type RuneworkingStation = {
  locationId: LocationId;
  unlock:
    | { kind: "mission_completed"; missionId: MissionId }
    | { kind: "repair_completed"; targetId: RepairTargetId };
};

export const RUNEWORKING_STATIONS: readonly RuneworkingStation[] = [
  {
    locationId: HILLTOP_WORKSHOP_CONTENT.locationId,
    unlock: {
      kind: "mission_completed",
      missionId: HILLTOP_WORKSHOP_CONTENT.resonanceRigUnlockMissionId,
    },
  },
  {
    locationId: LOCATION_IDS.crashSite,
    unlock: { kind: "repair_completed", targetId: REPAIR_TARGET_IDS.resonanceRig },
  },
];

export function getRuneworkingStation(locationId: string): RuneworkingStation | undefined {
  return RUNEWORKING_STATIONS.find((station) => station.locationId === locationId);
}

/** The personal Rig's own facts, for the Missions and presentation that name them. */
export const PERSONAL_RESONANCE_RIG = {
  repairTargetId: REPAIR_TARGET_IDS.resonanceRig,
  locationId: LOCATION_IDS.crashSite,
  buildMissionId: MISSION_IDS.aPlaceToCallHome,
  craftMissionId: MISSION_IDS.aRuneOfYourOwn,
} as const;
