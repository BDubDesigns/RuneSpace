import { describe, expect, it } from "vitest";
import { LOCATION_IDS } from "@/game/config/foundations";
import { LOCAL_MAP_LOCATION_IDS_BY_PLANET, getLocation } from "@/game/content/locations";
import {
  chainWalkingRouteLegs,
  planWalkingRoute,
  remainingRouteLocationIds,
} from "@/game/domain/travel";

const WALK_MS = 40 * 600;
const open = () => true;

function route(from: string, to: string, isTravelable: (id: string) => boolean = open) {
  return planWalkingRoute({
    currentLocationId: from,
    destinationLocationId: to,
    isTravelable,
  });
}

describe("issue #450 Route To planning", () => {
  it("finds the shortest ordinary walking path on Skatboll", () => {
    expect(route(LOCATION_IDS.crashSite, LOCATION_IDS.theJag)).toEqual({
      ok: true,
      path: [LOCATION_IDS.crashSite, LOCATION_IDS.theLongScramble, LOCATION_IDS.theJag],
      legCount: 2,
      durationTicks: 80,
    });
    expect(route(LOCATION_IDS.crashSite, LOCATION_IDS.theSouthCut)).toMatchObject({
      ok: true,
      path: [LOCATION_IDS.crashSite, LOCATION_IDS.southAccessTrack, LOCATION_IDS.theSouthCut],
    });
    expect(route(LOCATION_IDS.ruskRecovery, LOCATION_IDS.theJag)).toMatchObject({
      ok: true,
      path: [
        LOCATION_IDS.ruskRecovery,
        LOCATION_IDS.holoHollow,
        LOCATION_IDS.theLongScramble,
        LOCATION_IDS.theJag,
      ],
      legCount: 3,
    });
  });

  it("finds the shortest ordinary walking path on Stillreach", () => {
    expect(route(LOCATION_IDS.stillreachLandingStation, LOCATION_IDS.theLowHum)).toMatchObject({
      ok: true,
      path: [
        LOCATION_IDS.stillreachLandingStation,
        LOCATION_IDS.windwardTrack,
        LOCATION_IDS.hilltopWorkshop,
        LOCATION_IDS.theLowHum,
      ],
    });
    expect(route(LOCATION_IDS.stillreachLandingStation, LOCATION_IDS.theDrySeam)).toMatchObject({
      ok: true,
      legCount: 4,
    });
  });

  it("breaks ties between equally short paths by location ID, never by authoring order", () => {
    // Annex -> Long Scramble: via the Crash Site or via Holo Hollow.
    expect(route(LOCATION_IDS.emergencyPowerAnnex, LOCATION_IDS.theLongScramble)).toMatchObject({
      path: [
        LOCATION_IDS.emergencyPowerAnnex,
        LOCATION_IDS.crashSite,
        LOCATION_IDS.theLongScramble,
      ],
    });
    // Processing Yard -> South Access Track: via the Crash Site or the Landing.
    expect(
      route(LOCATION_IDS.abandonedProcessingYard, LOCATION_IDS.southAccessTrack),
    ).toMatchObject({
      path: [
        LOCATION_IDS.abandonedProcessingYard,
        LOCATION_IDS.crashSite,
        LOCATION_IDS.southAccessTrack,
      ],
    });
    // Quarry -> Harmonic Workings: via The Survey Line or Werner's Lab.
    expect(route(LOCATION_IDS.prospectingQuarry, LOCATION_IDS.harmonicWorkings)).toMatchObject({
      path: [
        LOCATION_IDS.prospectingQuarry,
        LOCATION_IDS.theSurveyLine,
        LOCATION_IDS.harmonicWorkings,
      ],
    });
  });

  it("routes around a shut hex rather than through it, or explains there is no way", () => {
    // With the Crash Site shut, the Annex reaches the Scramble through Holo Hollow.
    expect(
      route(
        LOCATION_IDS.emergencyPowerAnnex,
        LOCATION_IDS.theLongScramble,
        (id) => id !== LOCATION_IDS.crashSite,
      ),
    ).toMatchObject({
      path: [
        LOCATION_IDS.emergencyPowerAnnex,
        LOCATION_IDS.holoHollow,
        LOCATION_IDS.theLongScramble,
      ],
    });
    // The South Cut is reachable only through the Track.
    expect(
      route(
        LOCATION_IDS.crashSite,
        LOCATION_IDS.theSouthCut,
        (id) => id !== LOCATION_IDS.southAccessTrack,
      ),
    ).toEqual({ ok: false, reason: "no_walking_route" });
  });

  it("refuses a destination whose own state is shut: a collapsed Deep Jag", () => {
    expect(
      route(LOCATION_IDS.crashSite, LOCATION_IDS.deepJag, (id) => id !== LOCATION_IDS.deepJag),
    ).toEqual({ ok: false, reason: "route_blocked" });
  });

  it("never walks between planets, and refuses unknown or same destinations", () => {
    expect(route(LOCATION_IDS.holoHollowLanding, LOCATION_IDS.stillreachLandingStation)).toEqual({
      ok: false,
      reason: "no_walking_route",
    });
    expect(route(LOCATION_IDS.crashSite, "nowhere")).toEqual({
      ok: false,
      reason: "unknown_destination",
    });
    expect(route(LOCATION_IDS.crashSite, LOCATION_IDS.crashSite)).toEqual({
      ok: false,
      reason: "same_location",
    });
  });

  it("plans only along authored adjacency for every pair on every map", () => {
    for (const ids of Object.values(LOCAL_MAP_LOCATION_IDS_BY_PLANET)) {
      for (const from of ids) {
        for (const to of ids) {
          if (from === to) continue;
          const plan = route(from, to);
          if (!plan.ok) throw new Error(`${from} -> ${to} should be walkable`);
          expect(plan.path[0]).toBe(from);
          expect(plan.path.at(-1)).toBe(to);
          expect(new Set(plan.path).size).toBe(plan.path.length);
          for (let index = 1; index < plan.path.length; index += 1) {
            expect(getLocation(plan.path[index - 1]!)?.adjacentLocationIds).toContain(
              plan.path[index],
            );
          }
          expect(plan.durationTicks).toBe(plan.legCount * 40);
        }
      }
    }
  });
});

describe("issue #450 route legs", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  const plus = (ms: number) => new Date(start.getTime() + ms);

  it("names the hexes still ahead of the active leg, or nothing for a leg it does not describe", () => {
    const path = ["a", "b", "c", "d"];
    expect(
      remainingRouteLocationIds({
        routeLocationIds: path,
        originLocationId: "a",
        destinationLocationId: "b",
      }),
    ).toEqual(["c", "d"]);
    expect(
      remainingRouteLocationIds({
        routeLocationIds: path,
        originLocationId: "c",
        destinationLocationId: "d",
      }),
    ).toEqual([]);
    expect(
      remainingRouteLocationIds({
        routeLocationIds: path,
        originLocationId: "a",
        destinationLocationId: "c",
      }),
    ).toBeUndefined();
    expect(
      remainingRouteLocationIds({
        routeLocationIds: ["a", "b", "a"],
        originLocationId: "a",
        destinationLocationId: "b",
      }),
    ).toBeUndefined();
  });

  it("starts each leg at the previous arrival instant with no pause and no discount", () => {
    const chain = chainWalkingRouteLegs({
      arrivedAt: plus(WALK_MS),
      fromLocationId: "b",
      remainingLocationIds: ["c", "d"],
      availableThroughAt: plus(WALK_MS + 1),
      canWalk: open,
    });
    expect(chain.arrivedLegs).toEqual([]);
    expect(chain.activeLeg).toEqual({
      originLocationId: "b",
      destinationLocationId: "c",
      startedAt: plus(WALK_MS),
      arrivesAt: plus(WALK_MS * 2),
    });
  });

  it("arrives every overdue leg in order and leaves the next one under way", () => {
    const chain = chainWalkingRouteLegs({
      arrivedAt: plus(WALK_MS),
      fromLocationId: "b",
      remainingLocationIds: ["c", "d", "e"],
      // Exactly at leg c's arrival, part way into leg d.
      availableThroughAt: plus(WALK_MS * 2 + 5),
      canWalk: open,
    });
    expect(chain.arrivedLegs.map((leg) => leg.destinationLocationId)).toEqual(["c"]);
    expect(chain.activeLeg).toMatchObject({
      originLocationId: "c",
      destinationLocationId: "d",
      startedAt: plus(WALK_MS * 2),
    });

    const done = chainWalkingRouteLegs({
      arrivedAt: plus(WALK_MS),
      fromLocationId: "b",
      remainingLocationIds: ["c", "d", "e"],
      availableThroughAt: plus(WALK_MS * 4),
      canWalk: open,
    });
    expect(
      done.arrivedLegs.map((leg) => [leg.originLocationId, leg.destinationLocationId]),
    ).toEqual([
      ["b", "c"],
      ["c", "d"],
      ["d", "e"],
    ]);
    expect(done.arrivedLegs.at(-1)?.arrivesAt).toEqual(plus(WALK_MS * 4));
    expect(done.activeLeg).toBeUndefined();
    expect(done.refused).toBe(false);
  });

  it("ends the route at the last arrival when a leg would be refused", () => {
    const chain = chainWalkingRouteLegs({
      arrivedAt: plus(WALK_MS),
      fromLocationId: "b",
      remainingLocationIds: ["c", "d"],
      availableThroughAt: plus(WALK_MS * 10),
      canWalk: (_origin, destination) => destination !== "d",
    });
    expect(chain.arrivedLegs.map((leg) => leg.destinationLocationId)).toEqual(["c"]);
    expect(chain.activeLeg).toBeUndefined();
    expect(chain.refused).toBe(true);
  });
});
