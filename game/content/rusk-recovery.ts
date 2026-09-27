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
 * Deliberately not a workstation registry: one bench, one terminal, and since
 * #232 one Fabrication Station, in one yard — each named here by the Mission
 * moment that opens it.
 */
export const RUSK_RECOVERY_CONTENT: {
  locationId: LocationId;
  practiceAuthorizingMissionId: MissionId;
  workOrdersRevealMissionId: MissionId;
  workOrdersMissionId: MissionId;
  fabricationAuthorizingMissionId: MissionId;
  tinkeringAuthorizingMissionId: MissionId;
} = {
  locationId: LOCATION_IDS.ruskRecovery,
  practiceAuthorizingMissionId: MISSION_IDS.tenThousandHours,
  // Completing 10,000 Hours reveals the terminal as a real surface (#190)...
  workOrdersRevealMissionId: MISSION_IDS.tenThousandHours,
  // ...and ACCEPTING 10,001 Hours is the permanent authorization for playable
  // client work (#207). Deliberately two fields for two different moments: the
  // terminal becomes visible long before it becomes the player's to use, and
  // turning 10,001 Hours in is never a second gate.
  workOrdersMissionId: MISSION_IDS.tenThousandOneHours,
  // The Fabrication Station (#232) is Tansy's to open, the way the Workbench is
  // Wade's: ACCEPTING Return the Favor puts the player on it for good...
  fabricationAuthorizingMissionId: MISSION_IDS.returnTheFavor,
  // ...and COMPLETING it — Tansy's own demonstration, at the turn-in — is what
  // unlocks Tinkering. Not a separate pickup, and no second unlock flag.
  tinkeringAuthorizingMissionId: MISSION_IDS.returnTheFavor,
};
