import {
  PLANET_IDS,
  SHIP_ROUTE_IDS,
  type PlanetId,
  type ShipRouteId,
} from "@/game/config/foundations";
import { REPAIRED_RIVET_OVERLAY } from "@/game/content/locations";
import { z } from "zod";
import { LocationSceneSchema, SceneOverlaySchema } from "@/game/schemas/locations";

/**
 * Presentation for a Rivet flight's cinematic (#359): the approved 15:8 shipless
 * environment it takes off from and the one it touches down on, each with the
 * spot the separately composited Rivet rests on.
 *
 * This is art and framing only. It never says where a route goes, what it costs
 * or how long it takes (`game/content/ship-routes`, `game/config/balance`), and
 * the cinematic that reads it is a presentation layer over the server's recorded
 * flight; nothing here can land, refuel or complete anything.
 *
 * The ship is always the canonical transparent repaired Rivet the Crash Site and
 * Holo Hollow Landing scenes already use (#351, #358). Its `placement` is percent
 * of the backdrop's own canvas, exactly as a location overlay's is, so the stage
 * that crops the backdrop also crops the ship and it cannot leave its mark. The
 * marks were measured on the delivered 1717x916 art: the departure Rivet stands
 * on the open mud left of the outpost, the arrival Rivet inside the painted H.H.
 * circle, with its wheels about 80% down the frame on both.
 *
 * The interplanetary leg (#375) reuses Holo Hollow Landing's approved pad backdrop
 * and mark in both directions (take off from it outbound, settle onto it on the way
 * home) and adds the owner-approved empty 15:8 Stillreach scene, with the Rivet on
 * the approved "Option B" mark inside the fungal ring.
 */
export type FlightCinematicBackdrop = {
  scene: z.infer<typeof LocationSceneSchema>;
  ship: z.infer<typeof SceneOverlaySchema>;
  /** The colour of what the thrusters kick up off this ground: mud, or pad spray. */
  dustColor: string;
};

/**
 * What the travel phase charts. The first route is a short local hop on Skatboll,
 * drawn between the two places' Local Map positions with no planet, orbit or
 * second world. The interplanetary leg (#375) is drawn between the two worlds,
 * each labelled with its landing station; it states no distance or scale.
 */
export type FlightChart =
  | { kind: "local" }
  | { kind: "interplanetary"; originPlanetId: PlanetId; destinationPlanetId: PlanetId };

export type FlightCinematic = {
  /** Where the chart says the leg is flown. */
  chartTitle: string;
  chart: FlightChart;
  departure: FlightCinematicBackdrop;
  arrival: FlightCinematicBackdrop;
};

const CINEMATIC_SIZE = { width: 1717, height: 916 } as const;

function backdrop(
  scene: { asset: string; alt: string; focal?: { x: number; y: number } },
  placement: { left: number; top: number; width: number },
  dustColor: string,
): FlightCinematicBackdrop {
  return {
    dustColor,
    scene: LocationSceneSchema.parse({ ...scene, ...CINEMATIC_SIZE }),
    ship: SceneOverlaySchema.parse({
      asset: REPAIRED_RIVET_OVERLAY.asset,
      width: REPAIRED_RIVET_OVERLAY.width,
      height: REPAIRED_RIVET_OVERLAY.height,
      placement,
    }),
  };
}

/** The Rivet's mark inside Holo Hollow Landing's painted H.H. circle (#359). */
const HOLO_HOLLOW_LANDING_PAD_MARK = { left: 29, top: 43, width: 42 } as const;
const HOLO_HOLLOW_LANDING_PAD_ASSET = "/location-scenes/holo-hollow-landing-arrival.webp";
/** Grey spray and grit off the wet pad. */
const HOLO_HOLLOW_LANDING_PAD_DUST = "rgb(200 206 214 / 0.7)";

const HOLO_HOLLOW_LANDING_ARRIVAL = backdrop(
  {
    asset: HOLO_HOLLOW_LANDING_PAD_ASSET,
    alt: "Your repaired Rivet Utility Shuttle settling onto the wet Holo Hollow Landing pad inside its painted H.H. circle, green edge lights glowing, fuel tanks and service sheds behind it under snowy hills",
    focal: { x: 50, y: 60 },
  },
  HOLO_HOLLOW_LANDING_PAD_MARK,
  HOLO_HOLLOW_LANDING_PAD_DUST,
);

/**
 * The approved empty 15:8 Stillreach Landing Station scene (#375): the same station,
 * prismatic aurora and glowing mushroom ring as its 4:1 location panorama, framed
 * with more sky and ground. The Rivet's mark is the owner-approved Pillow composite
 * "Option B — Balanced": the 1774x887 transparent master scaled to 515 px wide with
 * its top-left at (680, 268) on the 1717x916 canvas. The runtime overlay is that
 * master trimmed to its alpha bounds (16, 43, 1742x816; `prepare-crash-site-art`),
 * so the mark is the trimmed box at the same scale: left (680 + 16 x 0.2903) / 1717,
 * top (268 + 43 x 0.2903) / 916, width 1742 x 0.2903 / 1717.
 */
const STILLREACH_RING_MARK = { left: 39.874, top: 30.62, width: 29.453 } as const;
const STILLREACH_CINEMATIC_ASSET = "/location-scenes/stillreach-landing-station-cinematic.webp";
/** Pale dust and spores kicked off the clearing inside the ring. */
const STILLREACH_RING_DUST = "rgb(196 182 196 / 0.7)";

const SKATBOLL_TO_STILLREACH: FlightChart = {
  kind: "interplanetary",
  originPlanetId: PLANET_IDS.skatboll,
  destinationPlanetId: PLANET_IDS.stillreach,
};

export const FLIGHT_CINEMATICS: Readonly<Record<ShipRouteId, FlightCinematic>> = {
  [SHIP_ROUTE_IDS.crashSiteToHoloHollowLanding]: {
    chartTitle: "Skatboll local flight",
    chart: { kind: "local" },
    departure: backdrop(
      {
        asset: "/location-scenes/crash-site-departure.webp",
        alt: "Your repaired Rivet Utility Shuttle lifting off the wet, rock-strewn mud of the Crash Site under a heavy overcast sky, mesas and a spired outpost behind it",
        focal: { x: 50, y: 60 },
      },
      { left: 22, top: 49, width: 38 },
      // The Crash Site's wet brown mud.
      "rgb(186 160 128 / 0.8)",
    ),
    arrival: HOLO_HOLLOW_LANDING_ARRIVAL,
  },
  [SHIP_ROUTE_IDS.holoHollowLandingToStillreachLandingStation]: {
    chartTitle: "Skatboll to Stillreach",
    chart: SKATBOLL_TO_STILLREACH,
    departure: backdrop(
      {
        asset: HOLO_HOLLOW_LANDING_PAD_ASSET,
        alt: "Your repaired Rivet Utility Shuttle lifting off the wet Holo Hollow Landing pad inside its painted H.H. circle, green edge lights glowing, fuel tanks and service sheds behind it under snowy hills",
        focal: { x: 50, y: 60 },
      },
      HOLO_HOLLOW_LANDING_PAD_MARK,
      HOLO_HOLLOW_LANDING_PAD_DUST,
    ),
    arrival: backdrop(
      {
        asset: STILLREACH_CINEMATIC_ASSET,
        alt: "Your repaired Rivet Utility Shuttle settling into the open clearing inside a wide ring of glowing violet, blue and amber mushrooms at Stillreach Landing Station, weathered station buildings to the left and prismatic aurora overhead at twilight",
        focal: { x: 50, y: 50 },
      },
      STILLREACH_RING_MARK,
      STILLREACH_RING_DUST,
    ),
  },
  [SHIP_ROUTE_IDS.stillreachLandingStationToHoloHollowLanding]: {
    chartTitle: "Stillreach to Skatboll",
    chart: {
      kind: "interplanetary",
      originPlanetId: PLANET_IDS.stillreach,
      destinationPlanetId: PLANET_IDS.skatboll,
    },
    departure: backdrop(
      {
        asset: STILLREACH_CINEMATIC_ASSET,
        alt: "Your repaired Rivet Utility Shuttle lifting out of the open clearing inside a wide ring of glowing violet, blue and amber mushrooms at Stillreach Landing Station, weathered station buildings to the left and prismatic aurora overhead at twilight",
        focal: { x: 50, y: 50 },
      },
      STILLREACH_RING_MARK,
      STILLREACH_RING_DUST,
    ),
    arrival: HOLO_HOLLOW_LANDING_ARRIVAL,
  },
};

export function getFlightCinematic(routeId: string): FlightCinematic | undefined {
  return (FLIGHT_CINEMATICS as Readonly<Record<string, FlightCinematic>>)[routeId];
}
