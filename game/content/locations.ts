import {
  ACTION_IDS,
  LOCATION_IDS,
  MERCHANT_IDS,
  MISSION_IDS,
  PLANET_IDS,
  REPAIR_TARGET_IDS,
  type PlanetId,
} from "@/game/config/foundations";
import {
  assertBidirectionalAdjacency,
  assertPlanetMembership,
  LocationDefinitionSchema,
  type LocationDefinition,
  type LocationDefinitionInput,
} from "@/game/schemas/locations";

/**
 * The authoritative local world (single source of truth).
 *
 * Server validation, UI projection, and adjacency checks all read from this
 * registry.
 *
 * - Crash Site: wreck / start location (Cargo Hold Welding after issue #89;
 *   no mining after issue #83; Landing Gear Welding after issue #322; Propulsion
 *   System Welding and its repaired scene variant after issue #330).
 * - Abandoned Processing Yard: Ferrite Refining (issue #81).
 * - DeWhat? Emergency Power Annex: the daily Power Cell reward source.
 * - The Long Scramble (#83): intentionally barren traversal tile.
 * - The Jag (#83): Ferrite Shale Mining.
 * - Holo Hollow (#159): the first settlement. Its town places are Local Places
 *   (game/content/local-places), not separate World Locations, so they own no
 *   map coordinate, adjacency, or Travel semantics.
 * - Rusk Recovery (#190): Wade's recovery yard, one ordinary walking edge
 *   northwest of Holo Hollow. Practice Welding happens here.
 * - Deep Jag (#209): the collapsed lower workings southwest of The Jag. The
 *   first location whose player-facing state changes durably — see its
 *   `stateVariants` and `game/domain/location-state`.
 * - South Access Track (#342): a travel-only road south of the Crash Site. No
 *   activity, shop, NPC or workstation; it exists to put two walking legs between
 *   the ship and the mine.
 * - The South Cut (#342): Skatboll's Oil Shale mine, Mining 5.
 * - Holo Hollow Landing (#357): Skatboll's walkable landing pad, an ordinary
 *   World Location at (1,1) with three walking edges. Its one Local Place is
 *   Last Leg Trading. The pad is empty until the character's own Rivet lands
 *   there (#358); only then does its scene carry the ship overlay.
 * - Stillreach (#373): a second planet with its own eight-location local map; each
 *   location belongs to one planet, and a walking edge never joins two. The Rivet
 *   reaches it by flight (#375) and berths at Stillreach Landing Station, whose
 *   one Local Place is Last Leg Trading's automated terminal; the rest is
 *   scenery-only.
 */
/**
 * The Crash Site state variant that shows the repaired ship (#330). Named once so
 * the Crash Site's conversation backdrop reads the same variant rather than
 * restating what it requires.
 */
export const CRASH_SITE_SHIP_RESTORED_VARIANT_ID = "crash_site_ship_restored";

/**
 * The Crash Site once the character's ship has actually flown away (#358): the
 * already-supported empty background with no ship overlay. Read from the ship's
 * own berth, not from the repair that let it fly, so walking away from the
 * Crash Site can never remove a ship that is still parked there.
 */
export const CRASH_SITE_SHIP_DEPARTED_VARIANT_ID = "crash_site_ship_departed";

/** Holo Hollow Landing once the character's own Rivet is berthed on the pad (#358). */
export const HOLO_HOLLOW_LANDING_SHIP_BERTHED_VARIANT_ID = "holo_hollow_landing_ship_berthed";

/** Stillreach Landing Station once the character's own Rivet is berthed in the ring (#375). */
export const STILLREACH_LANDING_STATION_SHIP_BERTHED_VARIANT_ID =
  "stillreach_landing_station_ship_berthed";

/**
 * The Crash Site is one approved empty environment plus a state-selected
 * transparent Rivet overlay (#351). The background and its framing are authored
 * once; each ship state adds only its own layer, so the ground, camera and chrome
 * never change between states and nothing flashes or goes blank.
 *
 * Placement is percent of the 2508x627 background canvas (the delivered 1536x384
 * file is the same canvas), measured from the owner's composite preview and tuned
 * by visual QA at 390px, the 890x252 desktop viewport and an intermediate width.
 * Both ships share a landing mark: same left edge and the same ground contact
 * line, so crashed -> repaired changes only the ship. `scripts/prepare-crash-site-art.mjs`
 * derives these from the one reference box on each untrimmed master.
 */
const CRASH_SITE_BACKGROUND = {
  asset: "/location-scenes/crash-site-empty.webp" as const,
  width: 1536,
  height: 384,
  focal: { x: 50, y: 50 } as const,
};

const CRASHED_RIVET_OVERLAY = {
  asset: "/location-scenes/rivet-crashed.webp" as const,
  width: 1249,
  height: 584,
  placement: { left: 34.134, top: 33.115, width: 31.866 },
};

/**
 * Exported so the first-flight cinematic (#359) composites this exact canonical
 * repaired Rivet, never a second ship design.
 */
export const REPAIRED_RIVET_OVERLAY = {
  asset: "/location-scenes/rivet-repaired.webp" as const,
  width: 1307,
  height: 612,
  placement: { left: 34.289, top: 28.103, width: 31.423 },
};

/**
 * The Rivet on Holo Hollow Landing's 1536x384 pad (#358): the same canonical
 * transparent repaired overlay the Crash Site uses, placed on the pad's painted
 * circle. Placement is percent of the pano; only `width` is authored and the
 * overlay's height follows its own aspect ratio, so the ship cannot drift from
 * its spot at any viewport or crop.
 */
const LANDING_RIVET_OVERLAY = {
  asset: REPAIRED_RIVET_OVERLAY.asset,
  width: REPAIRED_RIVET_OVERLAY.width,
  height: REPAIRED_RIVET_OVERLAY.height,
  placement: { left: 36.0, top: 38.2, width: 28.0 },
};

/**
 * The Rivet inside Stillreach Landing Station's fungal ring (#375): the canonical
 * transparent repaired overlay over the approved empty 1536x384 panorama. Placement
 * is the owner-approved Pillow composite "Option 2 — balanced": the 1774x887 master
 * scaled by 0.205 with its top-left at (585, 84) on the 1536x384 canvas. The runtime
 * overlay is that master trimmed to its alpha bounds (16, 43, 1742x816), so the mark
 * is the trimmed box at the same scale: left (585 + 16 x 0.205) / 1536, top
 * (84 + 43 x 0.205) / 384, width 1742 x 0.205 / 1536.
 */
const STILLREACH_RIVET_OVERLAY = {
  asset: REPAIRED_RIVET_OVERLAY.asset,
  width: REPAIRED_RIVET_OVERLAY.width,
  height: REPAIRED_RIVET_OVERLAY.height,
  placement: { left: 38.3, top: 24.171, width: 23.249 },
};

const STILLREACH_LANDING_STATION_SCENE = {
  asset: "/location-scenes/stillreach-landing-station.webp" as const,
  width: 1536,
  height: 384,
  focal: { x: 45, y: 50 } as const,
};

const locationDefinitions = [
  {
    id: LOCATION_IDS.crashSite,
    displayName: "Crash Site",
    description:
      "Your wrecked ship lies half-sunk in mud and scrap, with only a few systems still worth salvaging.",
    planetId: PLANET_IDS.skatboll,
    region: "holo_hollow" as const,
    adjacentLocationIds: [
      LOCATION_IDS.abandonedProcessingYard,
      LOCATION_IDS.emergencyPowerAnnex,
      LOCATION_IDS.theLongScramble,
      LOCATION_IDS.holoHollow,
      LOCATION_IDS.southAccessTrack,
      LOCATION_IDS.holoHollowLanding,
    ],
    // The Crash Site's three repairs: the Cargo Hold, the Landing Gear (#322) and the
    // Propulsion System (#330). Listing each is what lets Mission guidance walk a
    // player elsewhere back to the one place it can be welded.
    availableActionIds: [
      ACTION_IDS.cargoHoldWelding,
      ACTION_IDS.landingGearWelding,
      ACTION_IDS.propulsionWelding,
    ],
    // The ship is physically restored the moment the Propulsion System repair
    // completes (#330), per character and from the repair's own durable
    // completion, so another character's repair never changes this one's wreck
    // and there is no second flag or global art swap. Cargo Hold and Landing Gear
    // restoration change no scene: the ship is one wreck until its drive is fixed.
    stateVariants: [
      {
        // First, so it wins over the restored ship: once the Rivet has flown the
        // ground it stood on is all that is left, whatever was repaired.
        id: CRASH_SITE_SHIP_DEPARTED_VARIANT_ID,
        requires: { shipBerth: "elsewhere" },
        description: "Only the churned mud and scrap where your ship stood remain.",
        scene: {
          ...CRASH_SITE_BACKGROUND,
          alt: "The empty Crash Site, churned mud and scrap where a ship once stood, a mesa and a spired outpost behind it",
        },
      },
      {
        id: CRASH_SITE_SHIP_RESTORED_VARIANT_ID,
        requires: { completedRepairTargetId: REPAIR_TARGET_IDS.propulsionSystem },
        description:
          "Your ship stands repaired on its landing gear in the mud and scrap, its propulsion restored.",
        scene: {
          ...CRASH_SITE_BACKGROUND,
          alt: "The repaired Rivet Utility Shuttle standing on its landing gear on wet ground, hull panels patched and whole, a mesa and a spired outpost behind it",
          overlay: REPAIRED_RIVET_OVERLAY,
        },
      },
    ],
    dormantActivities: [],
    presentation: {
      mapIconKey: "crash_site_deposit" as const,
      layout: "crash_site" as const,
      localMap: { axial: { q: 0, r: 1 }, label: "Crash Site" },
      scene: {
        ...CRASH_SITE_BACKGROUND,
        alt: "The crashed Rivet Utility Shuttle slumped in the mud, hull panels torn open to its drive, a mesa and a spired outpost behind it",
        overlay: CRASHED_RIVET_OVERLAY,
      },
    },
  },
  {
    id: LOCATION_IDS.abandonedProcessingYard,
    displayName: "Abandoned Processing Yard",
    description:
      "Rusted conveyors and a refurbished hopper stand ready — Ferrite Shale can be refined here into Refined Ferrite and Slag.",
    planetId: PLANET_IDS.skatboll,
    region: "holo_hollow" as const,
    adjacentLocationIds: [
      LOCATION_IDS.crashSite,
      LOCATION_IDS.emergencyPowerAnnex,
      LOCATION_IDS.holoHollowLanding,
    ],
    availableActionIds: [ACTION_IDS.refining],
    mapStatus: "Refining",
    dormantActivities: [],
    presentation: {
      mapIconKey: "processing_yard" as const,
      layout: "processing_yard" as const,
      localMap: { axial: { q: 1, r: 0 }, label: "Processing Yard" },
      scene: {
        asset: "/location-scenes/processing-yard.webp" as const,
        width: 1920,
        height: 480,
        alt: "Abandoned industrial yard with rusted conveyors, gantry and hopper on wet ground under overcast sky",
        focal: { x: 50, y: 45 } as const,
      },
    },
  },
  {
    id: LOCATION_IDS.emergencyPowerAnnex,
    displayName: "DeWhat? Emergency Power Annex",
    description:
      "An automated DeWhat? depot, installed back when Settled Systems still required a public emergency power supply for Holo Hollow's visitors. The tourists left; the contract did not. It still issues its daily allotment of Power Cells to anyone who walks up.",
    planetId: PLANET_IDS.skatboll,
    region: "holo_hollow" as const,
    adjacentLocationIds: [
      LOCATION_IDS.crashSite,
      LOCATION_IDS.abandonedProcessingYard,
      LOCATION_IDS.holoHollow,
    ],
    availableActionIds: [],
    mapStatus: "Daily cells",
    dormantActivities: [],
    presentation: {
      mapIconKey: "power_annex" as const,
      layout: "power_annex" as const,
      localMap: { axial: { q: 0, r: 0 }, label: "Power Annex" },
      scene: {
        asset: "/location-scenes/power-annex.webp" as const,
        width: 1920,
        height: 480,
        alt: "Compact emergency power bunker with a lit dispenser capsule standing in shallow water, cyan arcane light",
        focal: { x: 50, y: 46 } as const,
      },
    },
  },
  {
    id: LOCATION_IDS.theLongScramble,
    displayName: "The Long Scramble",
    description:
      "A steep run of fractured stone and loose hardpan climbing toward the high ridge. Nothing worth stopping for, which is unfortunate given how long it takes to cross.",
    planetId: PLANET_IDS.skatboll,
    region: "holo_hollow" as const,
    adjacentLocationIds: [LOCATION_IDS.crashSite, LOCATION_IDS.theJag, LOCATION_IDS.holoHollow],
    availableActionIds: [],
    dormantActivities: [],
    presentation: {
      mapIconKey: "the_long_scramble" as const,
      layout: "the_long_scramble" as const,
      localMap: { axial: { q: -1, r: 2 }, label: "Long Scramble" },
      scene: {
        // Delivered at its native 2508x627 4:1 resolution: the metadata must
        // describe the committed file (#117), and approved art is never
        // resampled merely to match the older 1920x480 convention.
        asset: "/location-scenes/the-long-scramble.png" as const,
        width: 2508,
        height: 627,
        alt: "Steep fractured stone and loose hardpan climbing toward a high ridge, rough switchback route through barren mountain approach",
        focal: { x: 50, y: 44 } as const,
      },
    },
  },
  {
    id: LOCATION_IDS.theJag,
    displayName: "The Jag",
    description:
      "An exposed ferrite seam carved into the hardpan by whoever got here first. Calling it a mine would be generous, but the shale cuts just fine.",
    planetId: PLANET_IDS.skatboll,
    region: "holo_hollow" as const,
    adjacentLocationIds: [LOCATION_IDS.theLongScramble, LOCATION_IDS.deepJag],
    availableActionIds: [ACTION_IDS.ferriteShaleMining],
    mapStatus: "Mining",
    dormantActivities: [],
    presentation: {
      mapIconKey: "the_jag" as const,
      layout: "the_jag" as const,
      localMap: { axial: { q: -2, r: 3 }, label: "The Jag" },
      scene: {
        // Delivered at its native 2508x627 4:1 resolution: the metadata must
        // describe the committed file (#117), and approved art is never
        // resampled merely to match the older 1920x480 convention.
        asset: "/location-scenes/the-jag.png" as const,
        width: 2508,
        height: 627,
        alt: "Exposed jagged Ferrite Shale outcrop with cut faces, rough improvised mine entrance and disturbed ground with loose shale",
        focal: { x: 50, y: 43 } as const,
      },
    },
  },
  {
    id: LOCATION_IDS.holoHollow,
    displayName: "Holo Hollow",
    description:
      "A declining Ferrite-mining settlement built on the remains of a holo-tourism economy. Faded attraction signage still hangs over shopfronts that now serve miners and haulers.",
    planetId: PLANET_IDS.skatboll,
    region: "holo_hollow" as const,
    adjacentLocationIds: [
      LOCATION_IDS.crashSite,
      LOCATION_IDS.emergencyPowerAnnex,
      LOCATION_IDS.theLongScramble,
      LOCATION_IDS.ruskRecovery,
    ],
    availableActionIds: [],
    dormantActivities: [],
    presentation: {
      mapIconKey: "holo_hollow" as const,
      layout: "holo_hollow" as const,
      localPlacesEyebrow: "Around town",
      localMap: { axial: { q: -1, r: 1 }, label: "Holo Hollow" },
      scene: {
        // Delivered at its native 1536x384 4:1 resolution (#159): approved art
        // is never upscaled merely to match the older 1920x480 convention.
        asset: "/location-scenes/holo-hollow.webp" as const,
        width: 1536,
        height: 384,
        alt: "Weathered main street of a small mining settlement, faded holo-tourism signage above working shopfronts under an overcast sky",
        focal: { x: 50, y: 45 } as const,
      },
    },
  },
  {
    // Wade's recovery yard on the northwest edge of town (#190). It is a full
    // World Location, not one of Holo Hollow's Local Places: it owns a map
    // coordinate, an ordinary walking edge, and its own activity. It is visible
    // and visitable from the beginning of the game — what changes with
    // progression is who is standing in it and what they will let the player
    // touch, never the place itself.
    id: LOCATION_IDS.ruskRecovery,
    displayName: "Rusk Recovery",
    description:
      "Wade's recovery yard: salvaged machinery and stripped components racked in rows, damaged speeders waiting their turn, and a welding bench somebody actually works at. Messy, and organized by somebody who knows exactly where everything is.",
    planetId: PLANET_IDS.skatboll,
    region: "holo_hollow" as const,
    adjacentLocationIds: [LOCATION_IDS.holoHollow],
    // Both kinds of Welding the yard's one bench does. Listing the customer one
    // is what lets Mission guidance point a player who is somewhere else back
    // to the only place a Work Order can be welded (#207).
    // The Fabrication Station's work (#232, #233) is here too, which is what
    // lets Mission guidance point a player somewhere else back to the one
    // place a Salvage or Loadsteel Cutter can be fabricated.
    availableActionIds: [
      ACTION_IDS.practiceWelding,
      ACTION_IDS.workOrderWelding,
      ACTION_IDS.mountingBracketFabrication,
      ACTION_IDS.scrapMetalFabrication,
      ACTION_IDS.scrapBoxFabrication,
      ACTION_IDS.salvageCutterFabrication,
      ACTION_IDS.galvanicScrapFabrication,
      ACTION_IDS.galvanicWireSpoolFabrication,
      ACTION_IDS.powerCellFabrication,
      ACTION_IDS.loadsteelCutterFabrication,
      ACTION_IDS.wheelAssemblyFabrication,
      ACTION_IDS.driveMountFabrication,
      ACTION_IDS.freightHarnessFabrication,
      ACTION_IDS.emptySmallFuelCanisterFabrication,
      ACTION_IDS.mountingBracketTinkering,
      ACTION_IDS.scrapBoxTinkering,
      ACTION_IDS.salvageCutterTinkering,
      ACTION_IDS.galvanicWireSpoolTinkering,
      ACTION_IDS.powerCellTinkering,
      ACTION_IDS.loadsteelCutterTinkering,
      ACTION_IDS.wheelAssemblyTinkering,
      ACTION_IDS.driveMountTinkering,
      ACTION_IDS.freightHarnessTinkering,
    ],
    merchantId: MERCHANT_IDS.wadeRusk,
    dormantActivities: [],
    presentation: {
      mapIconKey: "rusk_recovery" as const,
      layout: "rusk_recovery" as const,
      localMap: { axial: { q: -2, r: 1 }, label: "Rusk Recovery" },
      scene: {
        // Delivered at its native 1536x384 4:1 resolution (#190): one static
        // scene before and after progression, never a locked/unlocked swap.
        asset: "/location-scenes/rusk-recovery.webp" as const,
        width: 1536,
        height: 384,
        alt: "Working recovery yard with racked salvage, stripped components, damaged work vehicles, and a welding bench under an overcast sky",
        focal: { x: 50, y: 45 } as const,
      },
    },
  },
  {
    // Deep Jag (#209): ONE authored location with state-dependent presentation,
    // never two locations and never a second hidden one. It is visible on the
    // map from the beginning as a future-world tease, is impassable until
    // Tansy's Brace Yourself is accepted, and becomes a working Galvanite mine
    // the moment the brace is welded in.
    //
    // The unconditional fields below ARE the pre-Mission state: not travelable,
    // no actions, CAVE-IN, collapsed scene. Everything that changes is an
    // authored variant resolved from Mission acceptance and repair completion,
    // so no `deep_jag_open` flag exists to drift from the repair record.
    id: LOCATION_IDS.deepJag,
    displayName: "Deep Jag",
    description:
      "The Jag's lower workings, closed since the roof came down. Broken rock fills the passage from floor to back, and the cold draught that should be coming out of it is not.",
    planetId: PLANET_IDS.skatboll,
    region: "holo_hollow" as const,
    adjacentLocationIds: [LOCATION_IDS.theJag],
    availableActionIds: [],
    travelable: false,
    mapStatus: "CAVE-IN",
    stateVariants: [
      {
        // Authored first: once the brace is in, the opened state wins however
        // the Mission itself is progressing.
        id: "deep_jag_opened",
        requires: { completedRepairTargetId: REPAIR_TARGET_IDS.deepJagCaveIn },
        description:
          "The passage is open again, held by the brace assembly the two of you set: yellow jacks under a welded header, rock swept back to the sides. Galvanite runs in the exposed face beyond.",
        travelable: true,
        mapStatus: "MINING",
        availableActionIds: [ACTION_IDS.galvaniteMining, ACTION_IDS.deepJagWelding],
        scene: {
          // Delivered at its native 1536x384 4:1 resolution, the matched pair
          // to the collapsed scene: same camera, same framing, same lighting.
          asset: "/location-scenes/deep-jag-opened.webp" as const,
          width: 1536,
          height: 384,
          alt: "Cleared mine passage held open by a welded header beam on two yellow hydraulic braces, rubble pushed to the sides, tunnel running away into the dark",
          focal: { x: 50, y: 48 } as const,
        },
      },
      {
        id: "deep_jag_worksite",
        requires: { acceptedMissionId: MISSION_IDS.braceYourself },
        travelable: true,
        availableActionIds: [ACTION_IDS.deepJagWelding],
      },
    ],
    dormantActivities: [],
    presentation: {
      mapIconKey: "deep_jag" as const,
      layout: "deep_jag" as const,
      localMap: { axial: { q: -3, r: 4 }, label: "Deep Jag" },
      scene: {
        // Delivered at its native 1536x384 4:1 resolution (#209).
        asset: "/location-scenes/deep-jag-collapsed.webp" as const,
        width: 1536,
        height: 384,
        alt: "Mine passage blocked floor to roof by a fall of broken rock, timber props leaning at the edges, brace hardware still crated on pallets to one side",
        focal: { x: 50, y: 48 } as const,
      },
    },
  },
  {
    // A traversal-only road (#342): it hosts nothing, on purpose. Two ordinary
    // 24-second walking legs separate the Crash Site's Cargo Hold from the mine,
    // and eligible walking Scavenging applies on both of them as everywhere else.
    id: LOCATION_IDS.southAccessTrack,
    displayName: "South Access Track",
    description:
      "A muddy, rutted service road running south out of the Crash Site past sagging poles, old pipe runs and broken fence. Nothing is made or sold here; it only goes somewhere.",
    planetId: PLANET_IDS.skatboll,
    region: "holo_hollow" as const,
    adjacentLocationIds: [
      LOCATION_IDS.crashSite,
      LOCATION_IDS.theSouthCut,
      LOCATION_IDS.holoHollowLanding,
    ],
    availableActionIds: [],
    dormantActivities: [],
    presentation: {
      mapIconKey: "south_access_track" as const,
      layout: "south_access_track" as const,
      localMap: { axial: { q: 0, r: 2 }, label: "South Access Track" },
      scene: {
        // Delivered at its native 1536x384 4:1 resolution (#342): approved art
        // is never upscaled merely to match the older 1920x480 convention.
        asset: "/location-scenes/south-access-track.webp" as const,
        width: 1536,
        height: 384,
        alt: "Muddy rutted service road curving away between a pipe run on concrete supports and a wire fence, utility poles and a distant open-cut mine under an overcast sky",
        focal: { x: 50, y: 55 } as const,
      },
    },
  },
  {
    // Skatboll's Oil Shale mine (#342): a close, reinforced entrance cut into
    // black laminated shale, not an open quarry. The Mining 5 gate is the
    // source's own, enforced by the server when a run starts.
    id: LOCATION_IDS.theSouthCut,
    displayName: "The South Cut",
    description:
      "A battered steel-framed entrance cut straight into black, thinly layered oil shale, its lamps burning on wet ground. Cutting here takes Mining 5.",
    planetId: PLANET_IDS.skatboll,
    region: "holo_hollow" as const,
    adjacentLocationIds: [LOCATION_IDS.southAccessTrack],
    availableActionIds: [ACTION_IDS.oilShaleMining],
    mapStatus: "Mining",
    dormantActivities: [],
    presentation: {
      mapIconKey: "the_south_cut" as const,
      layout: "the_south_cut" as const,
      localMap: { axial: { q: 0, r: 3 }, label: "The South Cut" },
      scene: {
        // Delivered at its native 1536x384 4:1 resolution (#342).
        asset: "/location-scenes/the-south-cut.webp" as const,
        width: 1536,
        height: 384,
        alt: "A rusted steel-framed mine entrance cut into black layered oil shale, warm lamps lighting a wet rutted track into the tunnel, machinery and a conveyor gantry to either side",
        focal: { x: 50, y: 50 } as const,
      },
    },
  },
  {
    // Skatboll's landing pad (#357): a physical, walkable World Location open to
    // anyone on foot from the start, before the ship is repaired and before any
    // Mission. It owns no activity and no ship state; the one thing here is its
    // Local Place, Last Leg Trading. Three ordinary walking edges and no link to
    // The South Cut, so reaching the mine still takes the South Access Track.
    id: LOCATION_IDS.holoHollowLanding,
    displayName: "Holo Hollow Landing",
    description:
      "A worn industrial landing pad on Skatboll with a weathered H.H. painted across it, lit by edge lamps and fenced with crumbling barriers. Last Leg Trading keeps a counter on the far side.",
    planetId: PLANET_IDS.skatboll,
    region: "holo_hollow" as const,
    adjacentLocationIds: [
      LOCATION_IDS.crashSite,
      LOCATION_IDS.abandonedProcessingYard,
      LOCATION_IDS.southAccessTrack,
    ],
    availableActionIds: [],
    // The pad is empty for everyone until their own Rivet lands (#358). Reading
    // the ship's berth rather than the character's position is what keeps
    // walking here from ever putting a ship on the pad.
    stateVariants: [
      {
        id: HOLO_HOLLOW_LANDING_SHIP_BERTHED_VARIANT_ID,
        requires: { shipBerth: "here" },
        description:
          "A worn industrial landing pad on Skatboll with a weathered H.H. painted across it, lit by edge lamps and fenced with crumbling barriers. Your Rivet Utility Shuttle sits on the pad, and Last Leg Trading keeps a counter on the far side.",
        scene: {
          asset: "/location-scenes/holo-hollow-landing.webp" as const,
          width: 1536,
          height: 384,
          alt: "Your repaired Rivet Utility Shuttle parked on an industrial landing pad inside a worn white circle with a weathered H.H., edge lights glowing, two low service sheds and fuel tanks behind it, and cold mountains under a heavy overcast sky",
          focal: { x: 50, y: 62 } as const,
          overlay: LANDING_RIVET_OVERLAY,
        },
      },
    ],
    dormantActivities: [],
    presentation: {
      mapIconKey: "holo_hollow_landing" as const,
      layout: "holo_hollow_landing" as const,
      localPlacesEyebrow: "Around the pad",
      localMap: { axial: { q: 1, r: 1 }, label: "Holo Hollow Landing" },
      scene: {
        // Delivered at its native 1536x384 4:1 resolution (#357): an empty pad,
        // so a parked ship can later be a separate overlay (docs/location-scenes).
        asset: "/location-scenes/holo-hollow-landing.webp" as const,
        width: 1536,
        height: 384,
        alt: "An empty industrial landing pad with a weathered H.H. painted inside a worn white circle, edge lights glowing, two low service sheds and fuel tanks behind it, and cold mountains under a heavy overcast sky",
        focal: { x: 50, y: 62 } as const,
      },
    },
  },
  // Stillreach Slice A (#373): eight scenery-only World Locations on a second
  // planet. The seven walking edges below are the whole graph; none is inferred
  // from axial adjacency. Slice B (#375) reaches the planet by the Rivet's own
  // interplanetary flight to the Landing Station, which also hosts the ship's
  // berth and, as a Local Place, Last Leg Trading's terminal; the other seven
  // stay scenery-only. A
  // starter region name is not yet approved, so these locations author none.
  {
    id: LOCATION_IDS.stillreachLandingStation,
    planetId: PLANET_IDS.stillreach,
    displayName: "Stillreach Landing Station",
    description:
      "A wide ring of softly glowing mushrooms circles an open clearing: the landing ground, under a sky of banded aurora. A few weathered station buildings sit at its edge, where a Last Leg Trading fuel terminal serves pilots and a patched-together Refiner-To-Go will refine whatever you bring it.",
    adjacentLocationIds: [LOCATION_IDS.windwardTrack],
    availableActionIds: [],
    // The station hosts no merchant itself: Last Leg Trading's terminal is its
    // own Local Place (#375, game/content/local-places), so trading there always
    // carries that place's validated context.
    // The ring is empty for everyone until their own Rivet lands in it (#375).
    // Read from the ship's berth, so walking here never puts a ship in the ring
    // and walking away never takes it out.
    stateVariants: [
      {
        id: STILLREACH_LANDING_STATION_SHIP_BERTHED_VARIANT_ID,
        requires: { shipBerth: "here" },
        description:
          "A wide ring of softly glowing mushrooms circles an open clearing: the landing ground, under a sky of banded aurora. Your Rivet Utility Shuttle stands in the middle of the ring, and a Last Leg Trading fuel terminal serves pilots from the weathered station buildings at its edge, beside a patched-together Refiner-To-Go.",
        scene: {
          ...STILLREACH_LANDING_STATION_SCENE,
          alt: "Your repaired Rivet Utility Shuttle standing in the open clearing inside a ring of glowing violet, blue and amber mushrooms on a frosted highland plain, a few weathered station buildings and antenna masts at the left edge, aurora overhead at twilight",
          overlay: STILLREACH_RIVET_OVERLAY,
        },
      },
    ],
    dormantActivities: [],
    presentation: {
      mapIconKey: "stillreach_landing_station" as const,
      layout: "stillreach_landing_station" as const,
      localPlacesEyebrow: "Around the station",
      localMap: { axial: { q: 0, r: 0 }, label: "Landing Station" },
      scene: {
        ...STILLREACH_LANDING_STATION_SCENE,
        alt: "An empty ring of glowing violet, blue and amber mushrooms around a flat open clearing on a frosted highland plain, a few weathered station buildings and antenna masts at its left edge, aurora overhead at twilight",
      },
    },
  },
  {
    id: LOCATION_IDS.windwardTrack,
    planetId: PLANET_IDS.stillreach,
    displayName: "Windward Track",
    description:
      "A rutted dirt track winding away across open highland, edged with weathered rock and low, colorful scrub. It does not stop anywhere; it only goes somewhere.",
    adjacentLocationIds: [
      LOCATION_IDS.stillreachLandingStation,
      LOCATION_IDS.hilltopWorkshop,
      LOCATION_IDS.prospectingQuarry,
    ],
    availableActionIds: [],
    dormantActivities: [],
    presentation: {
      mapIconKey: "windward_track" as const,
      layout: "windward_track" as const,
      localMap: { axial: { q: 1, r: 0 }, label: "Windward Track" },
      scene: {
        asset: "/location-scenes/windward-track.webp" as const,
        width: 1536,
        height: 384,
        alt: "A rutted dirt track curving up through rocky highland dotted with violet and blue scrub, small lakes in the distance and a low sun under a sweep of aurora",
        focal: { x: 45, y: 50 } as const,
      },
    },
  },
  {
    id: LOCATION_IDS.hilltopWorkshop,
    planetId: PLANET_IDS.stillreach,
    displayName: "Hilltop Workshop",
    description:
      "A patched metal workshop sits above the misty highlands, warm light spilling from its windows and a low hum carrying from inside. Its resident researcher, the Wise Old Enby, lives and works here among benches, instruments and boxes of strange stone.",
    adjacentLocationIds: [LOCATION_IDS.windwardTrack, LOCATION_IDS.theLowHum],
    // The Wise Old Enby's Resonance Rig (#391). Listing its recipe here is what
    // lets Mission guidance and Item Sources find the one place a Beginner Echo
    // Seeker is attuned; who may use it is the Rig's own completed-Mission gate
    // (`game/content/hilltop-workshop.ts`), checked by the server on every Start.
    availableActionIds: [ACTION_IDS.beginnerEchoSeekerRuneworking],
    dormantActivities: [],
    presentation: {
      mapIconKey: "hilltop_workshop" as const,
      layout: "hilltop_workshop" as const,
      localMap: { axial: { q: 2, r: -1 }, label: "Hilltop Workshop" },
      scene: {
        asset: "/location-scenes/hilltop-workshop.webp" as const,
        width: 1536,
        height: 384,
        alt: "A small metal-roofed workshop with lit windows and a canvas awning on a rocky hilltop covered in violet and teal scrub and tiny glowing mushrooms, misty valleys and an aurora sky beyond",
        focal: { x: 55, y: 50 } as const,
      },
    },
  },
  {
    id: LOCATION_IDS.prospectingQuarry,
    planetId: PLANET_IDS.stillreach,
    displayName: "Prospecting Quarry",
    description:
      "A shallow quarry of pale, layered rock cut into the hillside in terraces, lit timber and metal rigs standing on its floor. The face is open to prospecting: chip loose Stone from it with a cutter.",
    adjacentLocationIds: [LOCATION_IDS.windwardTrack, LOCATION_IDS.theSurveyLine],
    availableActionIds: [ACTION_IDS.stoneMining],
    mapStatus: "Mining",
    dormantActivities: [],
    presentation: {
      mapIconKey: "prospecting_quarry" as const,
      layout: "prospecting_quarry" as const,
      localMap: { axial: { q: 1, r: 1 }, label: "Prospecting Quarry" },
      scene: {
        asset: "/location-scenes/prospecting-quarry.webp" as const,
        width: 1536,
        height: 384,
        alt: "A terraced pale-stone quarry cut into a hillside at dusk, lamp-lit timber and metal extraction rigs, a ramp and storage tanks on its floor, ringed by violet and teal scrub under an aurora sky",
        focal: { x: 55, y: 50 } as const,
      },
    },
  },
  {
    id: LOCATION_IDS.theLowHum,
    planetId: PLANET_IDS.stillreach,
    displayName: "The Low Hum",
    description:
      "A wide, open plain of weathered stone and frosted scrub, a great spiral of faintly glowing lines laid across the ground.",
    adjacentLocationIds: [LOCATION_IDS.hilltopWorkshop],
    availableActionIds: [],
    dormantActivities: [],
    presentation: {
      mapIconKey: "the_low_hum" as const,
      layout: "the_low_hum" as const,
      localMap: { axial: { q: 3, r: -2 }, label: "The Low Hum" },
      scene: {
        asset: "/location-scenes/the-low-hum.webp" as const,
        width: 1536,
        height: 384,
        alt: "A vast frosted plain with a great spiral of faintly glowing lines on the ground, weathered rock slabs in the foreground and a sky of swirling blue, pink and gold aurora",
        focal: { x: 50, y: 50 } as const,
      },
    },
  },
  {
    id: LOCATION_IDS.theSurveyLine,
    planetId: PLANET_IDS.stillreach,
    displayName: "The Survey Line",
    description:
      "A faint trail crossing rolling highland past a line of weathered survey poles tied with orange tape, a pair of worn crates at the verge.",
    adjacentLocationIds: [
      LOCATION_IDS.prospectingQuarry,
      LOCATION_IDS.theDrySeam,
      LOCATION_IDS.harmonicWorkings,
    ],
    availableActionIds: [],
    dormantActivities: [],
    presentation: {
      mapIconKey: "the_survey_line" as const,
      layout: "the_survey_line" as const,
      localMap: { axial: { q: 2, r: 1 }, label: "The Survey Line" },
      scene: {
        asset: "/location-scenes/the-survey-line.webp" as const,
        width: 1536,
        height: 384,
        alt: "A faint dirt trail running across rolling highland past weathered survey poles tied with orange tape and two worn crates, a long lake reflecting a low orange sun under vivid aurora",
        focal: { x: 50, y: 50 } as const,
      },
    },
  },
  {
    id: LOCATION_IDS.theDrySeam,
    planetId: PLANET_IDS.stillreach,
    displayName: "The Dry Seam",
    description:
      "A pale quarry wall opens onto a glossy black seam, with conveyors and battered processing tanks strung across the floor. Cutting oil shale here takes Mining 5.",
    adjacentLocationIds: [LOCATION_IDS.theSurveyLine],
    // Stillreach's Oil Shale mine (#380): the same canonical source and balance
    // as The South Cut, enabled by the action ID alone. The Mining 5 gate is the
    // source's own, enforced by the server when a run starts.
    availableActionIds: [ACTION_IDS.oilShaleMining],
    mapStatus: "Mining",
    dormantActivities: [],
    presentation: {
      mapIconKey: "the_dry_seam" as const,
      layout: "the_dry_seam" as const,
      localMap: { axial: { q: 3, r: 0 }, label: "The Dry Seam" },
      scene: {
        asset: "/location-scenes/the-dry-seam.webp" as const,
        width: 1536,
        height: 384,
        alt: "A pale quarry wall split by a dark glossy seam, with conveyors, cylindrical tanks and lamp-lit steel processing frames on the floor in front of it, aurora and a low sun overhead",
        focal: { x: 55, y: 50 } as const,
      },
    },
  },
  {
    id: LOCATION_IDS.harmonicWorkings,
    planetId: PLANET_IDS.stillreach,
    displayName: "Harmonic Workings",
    description:
      "An old lifting frame works a fractured rock face threaded with shimmering mineral veins. Ore buckets clatter onto a short rail, and cutting usable rune fragments here takes Mining 8.",
    adjacentLocationIds: [LOCATION_IDS.theSurveyLine],
    availableActionIds: [ACTION_IDS.harmonicMining],
    mapStatus: "Mining",
    dormantActivities: [],
    presentation: {
      mapIconKey: "harmonic_workings" as const,
      layout: "harmonic_workings" as const,
      localMap: { axial: { q: 2, r: 2 }, label: "Harmonic Workings" },
      scene: {
        asset: "/location-scenes/harmonic-workings.webp" as const,
        width: 1536,
        height: 384,
        alt: "A steep fractured rock face with shimmering violet and teal crystals set in it, a wooden mine headframe with a cable bucket and loaded ore carts on a short rail, and distant aurora-lit mesas",
        focal: { x: 50, y: 50 } as const,
      },
    },
  },
] as const satisfies readonly LocationDefinitionInput[];

export const LOCATIONS: readonly LocationDefinition[] = locationDefinitions.map((location) =>
  LocationDefinitionSchema.parse(location),
);

assertBidirectionalAdjacency(LOCATIONS);
assertPlanetMembership(LOCATIONS);

const locationById = new Map<string, LocationDefinition>(
  LOCATIONS.map((location) => [location.id, location]),
);

/** Resolve a location from the authoritative registry by stable ID. */
export function getLocation(locationId: string): LocationDefinition | undefined {
  return locationById.get(locationId);
}

/** Whether the given location may host the supplied authoritative action ID. */
export function isActionAvailableAtLocation(locationId: string, actionId: string): boolean {
  return getLocation(locationId)?.availableActionIds.includes(actionId) ?? false;
}

/** Whether two locations are directly adjacent and reachable in either direction. */
export function areLocationsAdjacent(originId: string, destinationId: string): boolean {
  return getLocation(originId)?.adjacentLocationIds.includes(destinationId as never) ?? false;
}

/** Resolve the planet a World Location belongs to, or undefined for an unknown ID. */
export function getLocationPlanetId(locationId: string): PlanetId | undefined {
  return getLocation(locationId)?.planetId;
}

/**
 * The ordered local map of each planet (issues #83, #159 and #373). A planet's map
 * holds exactly its own locations, so the same axial coordinate may appear on two
 * planets and no hex ever leaks from one map into another.
 */
export const LOCAL_MAP_LOCATION_IDS_BY_PLANET: Readonly<
  Record<PlanetId, readonly LocationDefinition["id"][]>
> = {
  [PLANET_IDS.skatboll]: [
    LOCATION_IDS.crashSite,
    LOCATION_IDS.abandonedProcessingYard,
    LOCATION_IDS.emergencyPowerAnnex,
    LOCATION_IDS.theLongScramble,
    LOCATION_IDS.theJag,
    LOCATION_IDS.holoHollow,
    LOCATION_IDS.ruskRecovery,
    LOCATION_IDS.deepJag,
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

// Each planet's map list must be exactly that planet's locations, so the list
// and the registry's own `planetId` can never disagree.
for (const [planetId, ids] of Object.entries(LOCAL_MAP_LOCATION_IDS_BY_PLANET)) {
  const owned = LOCATIONS.filter((location) => location.planetId === planetId).map(
    (location) => location.id,
  );
  if (ids.length !== owned.length || !ids.every((id) => owned.includes(id))) {
    throw new Error(`The ${planetId} local map must list exactly the locations on ${planetId}`);
  }
}
