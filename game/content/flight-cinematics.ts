import { SHIP_ROUTE_IDS, type ShipRouteId } from "@/game/config/foundations";
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
 */
export type FlightCinematicBackdrop = {
  scene: z.infer<typeof LocationSceneSchema>;
  ship: z.infer<typeof SceneOverlaySchema>;
  /** The colour of what the thrusters kick up off this ground: mud, or pad spray. */
  dustColor: string;
};

export type FlightCinematic = {
  /**
   * Where the chart says the leg is flown. The first route is a short local hop
   * on Skatboll, so the chart is a local one: no planet, orbit or second world.
   */
  chartTitle: string;
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

export const FLIGHT_CINEMATICS: Readonly<Record<ShipRouteId, FlightCinematic>> = {
  [SHIP_ROUTE_IDS.crashSiteToHoloHollowLanding]: {
    chartTitle: "Skatboll local flight",
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
    arrival: backdrop(
      {
        asset: "/location-scenes/holo-hollow-landing-arrival.webp",
        alt: "Your repaired Rivet Utility Shuttle settling onto the wet Holo Hollow Landing pad inside its painted H.H. circle, green edge lights glowing, fuel tanks and service sheds behind it under snowy hills",
        focal: { x: 50, y: 60 },
      },
      { left: 29, top: 43, width: 42 },
      // Grey spray and grit off the wet pad.
      "rgb(200 206 214 / 0.7)",
    ),
  },
};

export function getFlightCinematic(routeId: string): FlightCinematic | undefined {
  return (FLIGHT_CINEMATICS as Readonly<Record<string, FlightCinematic>>)[routeId];
}
