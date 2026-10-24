import {
  LOCATION_IDS,
  PLANET_IDS,
  type LocationId,
  type PlanetId,
} from "@/game/config/foundations";

/**
 * Where a Beginner Resonance Echo may be hidden (#393), per planet.
 *
 * Fixed, owner-approved pools. They never grow when a player unlocks more of a
 * planet, so unlocking content can never make a Beginner hunt harder:
 *
 * - Skatboll: its ten Beginner-accessible World Locations. Deep Jag is
 *   permanently excluded — it is Mission-gated, and stays out even once a
 *   character has opened it.
 * - Stillreach: all eight of its original walkable World Locations.
 *
 * Only the server ever reads these to choose a hidden target. Registry
 * validation (`validateEchoHuntContent`) proves every ID is a real World
 * Location on its own planet.
 */
export const BEGINNER_ECHO_TARGET_POOLS: Readonly<Record<PlanetId, readonly LocationId[]>> = {
  [PLANET_IDS.skatboll]: [
    LOCATION_IDS.crashSite,
    LOCATION_IDS.abandonedProcessingYard,
    LOCATION_IDS.emergencyPowerAnnex,
    LOCATION_IDS.theLongScramble,
    LOCATION_IDS.theJag,
    LOCATION_IDS.holoHollow,
    LOCATION_IDS.ruskRecovery,
    LOCATION_IDS.southAccessTrack,
    LOCATION_IDS.theSouthCut,
    LOCATION_IDS.holoHollowLanding,
  ],
  [PLANET_IDS.stillreach]: [
    LOCATION_IDS.stillreachLandingStation,
    LOCATION_IDS.windwardTrack,
    LOCATION_IDS.hilltopWorkshop,
    LOCATION_IDS.prospectingQuarry,
    LOCATION_IDS.theLowHum,
    LOCATION_IDS.theSurveyLine,
    LOCATION_IDS.theDrySeam,
    LOCATION_IDS.harmonicWorkings,
  ],
};

/** The one tier shipped (#393). A hunt row records it so a later tier is a new key, not a migration. */
export const BEGINNER_ECHO_TIER = "beginner";
