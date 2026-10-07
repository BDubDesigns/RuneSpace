import {
  ITEM_IDS,
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
 * What reveals a repair target's controls (#284 generalized this from the
 * original Mission-only rule).
 *
 * - `mission`: the named Mission has been ACCEPTED and, when
 *   `requiresMissionWeldingLevel` is set, the character's personal Welding level
 *   has reached the Welding level that Mission itself requires. A finished repair
 *   stays usable regardless of Mission state or level.
 * - `welding_level`: the character's personal Welding level has reached
 *   `level` and, when authored, `requiresCompletedTargetId` is itself
 *   complete (Deep Jag's stash mount needs the passage open first). No other
 *   skill ever gates these; a level-gated target never consults Mining,
 *   Refining, or Fabrication.
 */
export type RepairAuthorization =
  | {
      kind: "mission";
      missionId: MissionId;
      /**
       * The permanent work also needs the personal Welding level the authorizing
       * Mission already requires of its offer (#330), read from that Mission's
       * `prerequisiteSkillLevels`, so the level has exactly one home. Enforced
       * by the one repair-access predicate, so the controls and the commands
       * agree and no command holds a level of its own. Absent for a repair that
       * asks no skill of the hands doing it.
       */
      requiresMissionWeldingLevel?: true;
    }
  | { kind: "welding_level"; level: number; requiresCompletedTargetId?: RepairTargetId };

/**
 * The authoritative registry of things Welding can repair (#172).
 *
 * A repair target says where the work happens and what authorizes it. Its recipe (materials, increments) is balance; its durable
 * per-character state is `character_repair_targets`. Nothing here is a second
 * copy of either.
 *
 * A Mission authorization is the Mission whose ACCEPTANCE reveals the repair
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
  authorization: RepairAuthorization;
  /**
   * Optional authored flavour for one material row, keyed by item ID (#209).
   *
   * Presentation only, and authored here rather than in balance because a line
   * like "thermal packing for bulkhead voids" is content, not an approved
   * number. A repair surface renders whatever rows the recipe has and shows
   * this line under one when the target bothered to write it — which is what
   * keeps the Cargo Hold's two descriptions without any surface knowing that
   * the Cargo Hold is the thing it is rendering.
   */
  materialNotes?: Readonly<Record<string, string>>;
  /**
   * The status a finished ship system reads as on its own surface (#322).
   * Authored here beside the target it describes, so the words that tell a
   * player what the repair did and what it did not do have exactly one home, and
   * read from the repair's own completion rather than from a second flag.
   */
  completedStatus?: string;
  /**
   * What the finished system reads as once its authorizing Mission has been
   * turned in (#330), replacing `completedStatus` from then on. Lets a system
   * say "report back" until the story has caught up with the physical repair,
   * from the repair's completion and the Mission's own completion — never a
   * third flag. Only meaningful for a Mission-authorized target.
   */
  reportedStatus?: string;
  /**
   * What a ship system reads as while it is damaged and no job has authorized
   * its repair (#322). Used by the shared ship-system panel, so a system is
   * visible from the start without the recipe or any progression hint.
   */
  offlineStatus?: string;
};

export const REPAIR_TARGETS: readonly RepairTargetDefinition[] = [
  {
    id: REPAIR_TARGET_IDS.cargoHold,
    displayName: "Cargo Hold",
    locationId: LOCATION_IDS.crashSite,
    authorization: { kind: "mission", missionId: MISSION_IDS.holdItTogether },
    offlineStatus: "The Cargo Hold is buckled from the crash and still inaccessible.",
    completedStatus: "Cargo Hold operational.",
    materialNotes: {
      [ITEM_IDS.refinedFerrite]: "replacement plating and braces",
      [ITEM_IDS.slag]: "thermal packing for bulkhead voids",
    },
  },
  {
    id: REPAIR_TARGET_IDS.crewStop,
    displayName: "Crew Stop",
    locationId: LOCATION_IDS.holoHollow,
    localPlaceId: LOCAL_PLACE_IDS.holoHollowCrewStop,
    authorization: { kind: "mission", missionId: MISSION_IDS.outOfTheWeather },
  },
  {
    // Deep Jag's cave-in (#209). Its completion is the authoritative fact the
    // location-state boundary reads to open the mine; nothing else records it.
    id: REPAIR_TARGET_IDS.deepJagCaveIn,
    displayName: "Collapsed Passage",
    locationId: LOCATION_IDS.deepJag,
    authorization: { kind: "mission", missionId: MISSION_IDS.braceYourself },
    materialNotes: {
      [ITEM_IDS.refinedFerrite]: "the brace legs and the crown plate",
      [ITEM_IDS.powerCell]: "charge for Tansy's jack, spent setting the brace",
    },
  },
  {
    // The ship's landing gear (#322). A Wade Mission reveals it, but nothing
    // here is Wade-specific: the ship status below is read from the repair's own
    // completion, and finishing it opens no flight, route or Propulsion work.
    id: REPAIR_TARGET_IDS.landingGear,
    displayName: "Landing Gear",
    locationId: LOCATION_IDS.crashSite,
    authorization: { kind: "mission", missionId: MISSION_IDS.wheelBeRightBack },
    materialNotes: {
      [ITEM_IDS.wheelAssembly]: "the rebuilt wheels the ship stands on",
      [ITEM_IDS.mountingBracket]: "ship-side mounting hardware",
      [ITEM_IDS.galvanicWireSpool]: "actuation and sensor wiring",
    },
    offlineStatus: "The landing gear is damaged and cannot be repaired yet.",
    // Says only what the landing gear is. The Propulsion System reports its own
    // state (#330), so this line never has to be corrected when that changes.
    completedStatus: "Landing gear restored.",
  },
  {
    // The ship's propulsion (#330), the capstone of the physical restoration.
    // Its completion is the one fact that the ship is restored: the Crash Site
    // scene (`game/content/locations`) and this status both read it, and the
    // Mission turn-in is the separate narrative fact `reportedStatus` reads.
    // Finishing it opens no flight control, route or fuel system.
    id: REPAIR_TARGET_IDS.propulsionSystem,
    displayName: "Propulsion System",
    locationId: LOCATION_IDS.crashSite,
    // Welding 8 is Thrust Issues' own offer gate; the repair reads it from there.
    authorization: {
      kind: "mission",
      missionId: MISSION_IDS.thrustIssues,
      requiresMissionWeldingLevel: true,
    },
    materialNotes: {
      [ITEM_IDS.driveMount]: "the powered interface between the drive and the hull",
      [ITEM_IDS.galvaferrite]: "reinforcement for the damaged frame",
      [ITEM_IDS.mountingBracket]: "ship-side mounting hardware",
      [ITEM_IDS.galvanicWireSpool]: "ship-side wiring",
    },
    offlineStatus: "The propulsion system is damaged and cannot be repaired yet.",
    completedStatus: "Propulsion restored. Report to Wade.",
    reportedStatus: "Propulsion restored. Ship flight-ready.",
  },
  // Site stash mounts (#284): permanent, per-character, one per authored site.
  // Same tier, same Welding gate, same recipe wherever it is built.
  {
    id: REPAIR_TARGET_IDS.siteStashTheJag,
    displayName: "Stash Mount",
    locationId: LOCATION_IDS.theJag,
    authorization: { kind: "welding_level", level: 1 },
  },
  {
    id: REPAIR_TARGET_IDS.siteStashRuskRecovery,
    displayName: "Stash Mount",
    locationId: LOCATION_IDS.ruskRecovery,
    authorization: { kind: "welding_level", level: 5 },
  },
  {
    id: REPAIR_TARGET_IDS.siteStashProcessingYard,
    displayName: "Stash Mount",
    locationId: LOCATION_IDS.abandonedProcessingYard,
    authorization: { kind: "welding_level", level: 5 },
  },
  {
    id: REPAIR_TARGET_IDS.siteStashDeepJag,
    displayName: "Stash Mount",
    locationId: LOCATION_IDS.deepJag,
    authorization: {
      kind: "welding_level",
      level: 8,
      requiresCompletedTargetId: REPAIR_TARGET_IDS.deepJagCaveIn,
    },
  },
  {
    // Curly's storage mount (#292): a commission at HH B&B, revealed only by
    // accepting Curly Must-Stash. The finished mount holds HIS container. It
    // is a completed job for an NPC — never a site stash, never storage the
    // player can open, and never a fifth stash site.
    id: REPAIR_TARGET_IDS.curlyStashMount,
    displayName: "Stash Mount",
    locationId: LOCATION_IDS.holoHollow,
    localPlaceId: LOCAL_PLACE_IDS.hhBnb,
    authorization: { kind: "mission", missionId: MISSION_IDS.curlyMustStash },
  },
] as const satisfies readonly RepairTargetDefinition[];

const byId = new Map<string, RepairTargetDefinition>(
  REPAIR_TARGETS.map((target) => [target.id, target]),
);

export function getRepairTarget(targetId: string): RepairTargetDefinition | undefined {
  return byId.get(targetId);
}
