import {
  PASSENGER_ROUTE_IDS,
  PLANET_IDS,
  SHIP_ROUTE_IDS,
  type PassengerRouteId,
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

/**
 * The transparent Milky Waymo passenger shuttle (#404), trimmed on its alpha
 * bounds by `scripts/prepare-milky-waymo-art.mjs` (1289x596, the 1719x794 crop of
 * its 1774x887 master at 0.75).
 */
const MILKY_WAYMO_SHUTTLE_OVERLAY = {
  asset: "/location-scenes/milky-waymo-shuttle.webp" as const,
  width: 1289,
  height: 596,
};

/**
 * Where each trimmed overlay sits on its own untrimmed 1774x887 master canvas.
 * The Rivet's marks above were measured from that canvas, and the shuttle master
 * is the same canvas size, so the shuttle is seated by mapping the Rivet's trimmed
 * mark back to its canvas and trimming the shuttle at its own offset: the two
 * vehicles stand on the very same reference box, and neither has to be re-measured.
 */
const RIVET_TRIM = { left: 16, top: 43, width: 1742 } as const;
const SHUTTLE_TRIM = { left: 39, top: 55, width: 1719 } as const;

const round3 = (value: number) => Number(value.toFixed(3));

function shuttlePlacement(rivet: { left: number; top: number; width: number }) {
  // Canvas px per master px, then the master canvas's own top-left in percent.
  const scale = ((rivet.width / 100) * CINEMATIC_SIZE.width) / RIVET_TRIM.width;
  const canvasLeft = rivet.left - ((RIVET_TRIM.left * scale) / CINEMATIC_SIZE.width) * 100;
  const canvasTop = rivet.top - ((RIVET_TRIM.top * scale) / CINEMATIC_SIZE.height) * 100;
  return {
    left: round3(canvasLeft + ((SHUTTLE_TRIM.left * scale) / CINEMATIC_SIZE.width) * 100),
    top: round3(canvasTop + ((SHUTTLE_TRIM.top * scale) / CINEMATIC_SIZE.height) * 100),
    width: round3(((SHUTTLE_TRIM.width * scale) / CINEMATIC_SIZE.width) * 100),
  };
}

/** The same approved backdrop with the Milky Waymo shuttle on the Rivet's mark. */
function shuttleBackdrop(source: FlightCinematicBackdrop, alt: string): FlightCinematicBackdrop {
  return {
    dustColor: source.dustColor,
    scene: { ...source.scene, alt },
    ship: SceneOverlaySchema.parse({
      ...MILKY_WAYMO_SHUTTLE_OVERLAY,
      placement: shuttlePlacement(source.ship.placement),
    }),
  };
}

const SKATBOLL_DEPARTURE_SHUTTLE_ALT =
  "A white-and-blue Milky Waymo passenger shuttle lifting off the wet Holo Hollow Landing pad inside its painted H.H. circle, green edge lights glowing, fuel tanks and service sheds behind it under snowy hills";
const SKATBOLL_ARRIVAL_SHUTTLE_ALT =
  "A white-and-blue Milky Waymo passenger shuttle settling onto the wet Holo Hollow Landing pad inside its painted H.H. circle, green edge lights glowing, fuel tanks and service sheds behind it under snowy hills";
const STILLREACH_DEPARTURE_SHUTTLE_ALT =
  "A white-and-blue Milky Waymo passenger shuttle lifting out of the open clearing inside a wide ring of glowing violet, blue and amber mushrooms at Stillreach Landing Station, weathered station buildings to the left and prismatic aurora overhead at twilight";
const STILLREACH_ARRIVAL_SHUTTLE_ALT =
  "A white-and-blue Milky Waymo passenger shuttle settling into the open clearing inside a wide ring of glowing violet, blue and amber mushrooms at Stillreach Landing Station, weathered station buildings to the left and prismatic aurora overhead at twilight";

/**
 * The passenger journey's cinematic (#404): the interplanetary Rivet leg's own
 * chart and approved backdrops, flown by the Milky Waymo shuttle instead of the
 * Rivet. Derived from the Rivet entries so a chart or backdrop is never authored
 * twice, and keyed by the passenger route so a journey never reaches the Rivet's.
 */
function passengerCinematic(
  shipRouteId: ShipRouteId,
  alts: { departure: string; arrival: string },
): FlightCinematic {
  const source = FLIGHT_CINEMATICS[shipRouteId];
  if (!source) throw new Error(`Ship route "${shipRouteId}" has no flight cinematic.`);
  return {
    chartTitle: source.chartTitle,
    chart: source.chart,
    departure: shuttleBackdrop(source.departure, alts.departure),
    arrival: shuttleBackdrop(source.arrival, alts.arrival),
  };
}

export const PASSENGER_FLIGHT_CINEMATICS: Readonly<Record<PassengerRouteId, FlightCinematic>> = {
  [PASSENGER_ROUTE_IDS.holoHollowLandingToStillreachLandingStation]: passengerCinematic(
    SHIP_ROUTE_IDS.holoHollowLandingToStillreachLandingStation,
    { departure: SKATBOLL_DEPARTURE_SHUTTLE_ALT, arrival: STILLREACH_ARRIVAL_SHUTTLE_ALT },
  ),
  [PASSENGER_ROUTE_IDS.stillreachLandingStationToHoloHollowLanding]: passengerCinematic(
    SHIP_ROUTE_IDS.stillreachLandingStationToHoloHollowLanding,
    { departure: STILLREACH_DEPARTURE_SHUTTLE_ALT, arrival: SKATBOLL_ARRIVAL_SHUTTLE_ALT },
  ),
};

/** A cinematic by its route: a Rivet flight route or a Milky Waymo passenger route. */
export function getFlightCinematic(routeId: string): FlightCinematic | undefined {
  return (
    (FLIGHT_CINEMATICS as Readonly<Record<string, FlightCinematic>>)[routeId] ??
    (PASSENGER_FLIGHT_CINEMATICS as Readonly<Record<string, FlightCinematic>>)[routeId]
  );
}
