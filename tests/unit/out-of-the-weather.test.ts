import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance, getRepairTargetBalance } from "@/game/config/balance";
import {
  DIALOGUE_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  REPAIR_TARGET_IDS,
  SKILL_IDS,
  TRANSPORT_ROUTE_IDS,
} from "@/game/config/foundations";
import { getDialogue } from "@/game/content/dialogue";
import { getLocalPlace } from "@/game/content/local-places";
import { areLocationsAdjacent, getLocation } from "@/game/content/locations";
import {
  KEEP_THE_CHANGE,
  MISSIONS,
  OUT_OF_THE_WEATHER,
  type MissionDefinition,
} from "@/game/content/missions";
import { getRepairTarget, REPAIR_TARGETS } from "@/game/content/repair-targets";
import {
  getTransportRoute,
  getTransportRoutesFrom,
  TRANSPORT_ROUTES,
  validateTransportRoutes,
} from "@/game/content/transport-routes";
import { availableCrewHaulerRides } from "@/features/travel/crew-hauler-rides";
import { resolveNpcConversation } from "@/game/domain/conversation";
import { deriveLocalPlaceAccess, deriveLocalPlaceSurface } from "@/game/domain/local-places";
import {
  deriveMissionGuidanceTargets,
  projectMission,
  validateMissionDefinitions,
  type MissionObservation,
  type MissionProjection,
} from "@/game/domain/missions";
import {
  isTravelRouteValid,
  planTransportTravel,
  planTravel,
  resolveTravel,
  travelDurationTicks,
  travelOffersScavenge,
} from "@/game/domain/travel";
import { isTravelReplaceableAction } from "@/game/domain/travel-replacement";

/**
 * Issue #172 — Out of the Weather.
 *
 * Everything provable without PostgreSQL or a browser lives here: the Mission's
 * discovery and optionality rules, the Crew Stop's authored recipe and
 * presentation, the Crew Hauler's route/duration/Scavenge semantics, and the
 * guarantee that adding a paid route never created a walkable one. Server
 * authority — exactly-once material consumption, Welding XP, the 250 XP
 * completion reward, and the atomic 5-Credit fare — is proven against real
 * PostgreSQL in tests/integration/out-of-the-weather.test.ts.
 */

const balance = getEffectiveGameBalance();
const crewStop = getRepairTargetBalance(REPAIR_TARGET_IDS.crewStop, balance);

function observation(repaired: boolean): MissionObservation {
  return {
    equippedItemIds: new Set<string>(),
    carriedQuantities: new Map(),
    stackLimits: new Map(),
    itemNames: new Map(),
    completedRepairTargetIds: new Set(
      repaired
        ? [REPAIR_TARGET_IDS.cargoHold, REPAIR_TARGET_IDS.crewStop]
        : [REPAIR_TARGET_IDS.cargoHold],
    ),
  };
}

const accepted = () => ({ acceptedAt: new Date("2026-09-13T00:00:00.000Z") });
const completed = () => ({
  acceptedAt: new Date("2026-09-13T00:00:00.000Z"),
  completedAt: new Date("2026-09-13T01:00:00.000Z"),
});

function project(
  definition: MissionDefinition,
  mission: { acceptedAt?: Date; completedAt?: Date } | undefined,
  options: { at?: string; repaired?: boolean; prerequisiteCompleted?: boolean } = {},
): MissionProjection {
  return projectMission(
    definition,
    mission,
    options.at ?? LOCATION_IDS.holoHollow,
    true,
    observation(options.repaired ?? false),
    options.prerequisiteCompleted ?? true,
  );
}

describe("Out of the Weather is an optional branch, not a chain link", () => {
  it("is gated by Hold It Together and never by Keep the Change", () => {
    expect(OUT_OF_THE_WEATHER.prerequisiteMissionId).toBe(MISSION_IDS.holdItTogether);
    expect(KEEP_THE_CHANGE.prerequisiteMissionId).toBe(MISSION_IDS.holdItTogether);
  });

  it("is never anybody's continuation and never continues into anything", () => {
    expect(OUT_OF_THE_WEATHER.continuationMissionId).toBeUndefined();
    expect(
      MISSIONS.some((mission) => mission.continuationMissionId === OUT_OF_THE_WEATHER.id),
    ).toBe(false);
  });

  it("is never a prerequisite for any other Mission", () => {
    expect(
      MISSIONS.some((mission) => mission.prerequisiteMissionId === OUT_OF_THE_WEATHER.id),
    ).toBe(false);
  });

  it("passes the authored-content validation boundary", () => {
    expect(() => validateMissionDefinitions(MISSIONS)).not.toThrow();
  });
});

describe("discovery happens through Renn, never automatically", () => {
  it("offers nothing while Hold It Together is incomplete", () => {
    const locked = project(OUT_OF_THE_WEATHER, undefined, { prerequisiteCompleted: false });
    expect(locked.state).toBe("not_accepted");
    expect(locked.guidance).toBeUndefined();
    // Renn's ordinary replayable topics are unaffected; what is absent is any
    // Mission entry offering the side Mission.
    const entries = resolveNpcConversation(NPC_IDS.rennCalder, [projectionFor(locked)]);
    expect(entries.every((entry) => entry.kind === "topic")).toBe(true);
  });

  it("advertises through Renn once the prerequisite holds, and only in Holo Hollow", () => {
    const here = project(OUT_OF_THE_WEATHER, undefined);
    expect(here.guidance?.availableNpcIds).toEqual([NPC_IDS.rennCalder]);

    const elsewhere = project(OUT_OF_THE_WEATHER, undefined, { at: LOCATION_IDS.theJag });
    expect(elsewhere.guidance).toBeUndefined();

    const offered = resolveNpcConversation(NPC_IDS.rennCalder, [projectionFor(here)]).find(
      (entry) => entry.kind === "mission",
    );
    expect(offered).toMatchObject({
      role: "offer",
      missionId: MISSION_IDS.outOfTheWeather,
      dialogueId: DIALOGUE_IDS.rennOutOfTheWeatherOffer,
      action: { kind: "accept_mission" },
    });
  });

  it("never appears in the Mission Log before it is accepted", () => {
    const undiscovered = project(OUT_OF_THE_WEATHER, undefined);
    // The Mission Log renders active/ready/completed only; an available Mission
    // has no objective, no requirement list, and no global guidance target.
    expect(undiscovered.state).toBe("not_accepted");
    expect(undiscovered.currentObjective).toBeUndefined();
    expect(undiscovered.requirements).toBeUndefined();
    const targets = deriveMissionGuidanceTargets([undiscovered]);
    expect([...targets.locationIds]).toEqual([]);
    expect([...targets.repairTargetIds]).toEqual([]);
    expect([...targets.localPlaceIds]).toEqual([]);
  });

  it("is accepted from Renn's authored offer, which is real dialogue", () => {
    const [offer, ...others] = OUT_OF_THE_WEATHER.offers;
    expect(others).toEqual([]);
    expect(offer).toMatchObject({
      npcId: NPC_IDS.rennCalder,
      locationId: LOCATION_IDS.holoHollow,
      dialogueId: DIALOGUE_IDS.rennOutOfTheWeatherOffer,
    });
    expect(getDialogue(DIALOGUE_IDS.rennOutOfTheWeatherOffer)?.npcId).toBe(NPC_IDS.rennCalder);
    // The offer grants nothing up front: this Mission costs the player.
    expect(offer?.acceptEffect).toBeUndefined();
  });
});

describe("the repair is the Mission's only work", () => {
  it("observes authoritative Crew Stop completion and nothing else", () => {
    expect(OUT_OF_THE_WEATHER.requirements).toEqual([
      {
        kind: "repair_target_complete",
        targetId: REPAIR_TARGET_IDS.crewStop,
        objective: "Repair the Crew Stop in Holo Hollow",
      },
    ]);
  });

  it("guides the player to the Crew Stop's Local Place while the repair is unfinished", () => {
    const active = project(OUT_OF_THE_WEATHER, accepted());
    expect(active.state).toBe("active");
    expect(active.guidance).toEqual({
      repairTargetId: REPAIR_TARGET_IDS.crewStop,
      localPlaceId: LOCAL_PLACE_IDS.holoHollowCrewStop,
    });
    const targets = deriveMissionGuidanceTargets([active]);
    expect(targets.repairTargetIds.has(REPAIR_TARGET_IDS.crewStop)).toBe(true);
    expect([...targets.localPlaceIds]).toEqual([LOCAL_PLACE_IDS.holoHollowCrewStop]);
  });

  it("guides toward Holo Hollow while the player is elsewhere", () => {
    const away = project(OUT_OF_THE_WEATHER, accepted(), { at: LOCATION_IDS.theJag });
    expect(away.guidance).toEqual({
      repairTargetId: REPAIR_TARGET_IDS.crewStop,
      locationId: LOCATION_IDS.holoHollow,
    });
  });

  it("moves to Renn's turn-in the moment the repair completes", () => {
    const ready = project(OUT_OF_THE_WEATHER, accepted(), { repaired: true });
    expect(ready.state).toBe("ready_for_completion");
    expect(ready.guidance).toMatchObject({ npcId: NPC_IDS.rennCalder, turnIn: true });
    const targets = deriveMissionGuidanceTargets([ready]);
    expect([...targets.turnInNpcIds]).toEqual([NPC_IDS.rennCalder]);
    expect(targets.repairTargetIds.has(REPAIR_TARGET_IDS.crewStop)).toBe(false);
  });

  it("awards 250 Welding XP on completion through the generic reward boundary", () => {
    expect(OUT_OF_THE_WEATHER.reward).toEqual({
      kind: "skill_xp",
      skillId: SKILL_IDS.welding,
      amount: 250,
    });
    const done = project(OUT_OF_THE_WEATHER, completed(), { repaired: true });
    expect(done.earnedReward).toMatchObject({ kind: "skill_xp", amount: 250 });
  });

  it("totals 750 Welding XP for the whole side Mission", () => {
    const work = crewStop.repairIncrements * balance.welding.xpPerIncrement;
    expect(work).toBe(500);
    expect(work + 250).toBe(750);
  });
});

describe("Renn's voice and the silent protagonist", () => {
  const authoredLabels = [
    OUT_OF_THE_WEATHER.offers[0]?.actionLabel,
    OUT_OF_THE_WEATHER.turnIn?.actionLabel,
  ];

  it("never puts first-person speech in the player's controls", () => {
    expect(authoredLabels).toEqual(["TAKE THE JOB", "TELL RENN"]);
    for (const label of authoredLabels) {
      // The player never speaks: a control is an instruction to the game, not a
      // line of dialogue, exactly as every other authored Mission label is.
      expect(label).not.toMatch(/\b(I|I'M|I'LL|I'VE|MY|ME)\b/);
    }
  });

  it("says nothing that needs time to have passed", () => {
    // The tenth weld and the turn-in can be seconds apart. Renn may notice the
    // shelter and speak for the crews; he may not remember a week of it.
    const spoken = [
      DIALOGUE_IDS.rennOutOfTheWeatherTurnIn,
      DIALOGUE_IDS.rennOutOfTheWeatherCompletion,
      DIALOGUE_IDS.rennPostOutOfTheWeather,
    ].flatMap((dialogueId) =>
      (getDialogue(dialogueId)?.beats ?? []).flatMap((beat) =>
        "text" in beat && typeof beat.text === "string" ? [beat.text] : [],
      ),
    );
    expect(spoken.length).toBeGreaterThan(0);
    for (const line of spoken) {
      expect(line).not.toMatch(
        /this morning|all week|yesterday|last night|for days|since you left/i,
      );
    }
  });

  it("still lets the crews notice, and still offers the ride, in Renn's own voice", () => {
    const completion = (getDialogue(DIALOGUE_IDS.rennOutOfTheWeatherCompletion)?.beats ?? [])
      .flatMap((beat) => ("text" in beat && typeof beat.text === "string" ? [beat.text] : []))
      .join(" ");
    expect(completion).toMatch(/crews/i);
    expect(completion).toMatch(/five Credits/i);
  });
});

describe("the Crew Stop as a place and as a repair target", () => {
  it("is an ordinary open Holo Hollow Local Place, visible from the start", () => {
    const place = getLocalPlace(LOCAL_PLACE_IDS.holoHollowCrewStop);
    expect(place?.parentLocationId).toBe(LOCATION_IDS.holoHollow);
    expect(place?.access).toEqual({ kind: "open" });
    expect(deriveLocalPlaceAccess(place!)).toEqual({ available: true });
  });

  it("is not a World Location and owns no map position", () => {
    expect(getLocation(LOCAL_PLACE_IDS.holoHollowCrewStop)).toBeUndefined();
    expect(getLocalPlace(LOCAL_PLACE_IDS.holoHollowCrewStop)).not.toHaveProperty("localMap");
  });

  it("derives damaged and repaired presentation from authoritative repair state", () => {
    const place = getLocalPlace(LOCAL_PLACE_IDS.holoHollowCrewStop)!;
    const damaged = deriveLocalPlaceSurface(place, new Set());
    const repaired = deriveLocalPlaceSurface(place, new Set([REPAIR_TARGET_IDS.crewStop]));

    expect(damaged.repaired).toBe(false);
    expect(repaired.repaired).toBe(true);
    // The state is carried by the copy itself, not by colour or a badge.
    expect(damaged.description).not.toBe(repaired.description);
    expect(damaged.description).toMatch(/sags|leans/i);
    expect(repaired.description).toMatch(/welded|square/i);
    expect(repaired.presentation.scene.asset).toBeTruthy();
  });

  it("leaves a place with nothing to repair completely unchanged", () => {
    const bnb = getLocalPlace(LOCAL_PLACE_IDS.hhBnb)!;
    const surface = deriveLocalPlaceSurface(bnb, new Set([REPAIR_TARGET_IDS.crewStop]));
    expect(surface.repaired).toBeUndefined();
    expect(surface.description).toBe(bnb.description);
  });

  it("is authorized by the Mission it belongs to and lives where the place does", () => {
    expect(getRepairTarget(REPAIR_TARGET_IDS.crewStop)).toMatchObject({
      locationId: LOCATION_IDS.holoHollow,
      localPlaceId: LOCAL_PLACE_IDS.holoHollowCrewStop,
      authorizingMissionId: MISSION_IDS.outOfTheWeather,
    });
    expect(REPAIR_TARGETS.map((target) => target.id)).toEqual([
      REPAIR_TARGET_IDS.cargoHold,
      REPAIR_TARGET_IDS.crewStop,
    ]);
  });

  it("makes Crew Stop Welding ordinary interruptible work", () => {
    expect(isTravelReplaceableAction(crewStop.actionId)).toBe(true);
  });
});

describe("where the ride is boarded, and when it exists at all", () => {
  const unlocked = new Set<string>([MISSION_IDS.outOfTheWeather]);

  it("offers Holo Hollow's ride inside the Crew Stop and nowhere else in town", () => {
    const town = availableCrewHaulerRides({
      locationId: LOCATION_IDS.holoHollow,
      completedMissionIds: unlocked,
    });
    expect(town).toEqual([]);

    const shelter = availableCrewHaulerRides({
      locationId: LOCATION_IDS.holoHollow,
      localPlaceId: LOCAL_PLACE_IDS.holoHollowCrewStop,
      completedMissionIds: unlocked,
    });
    expect(shelter).toHaveLength(1);
    expect(shelter[0]?.destinationLocationId).toBe(LOCATION_IDS.theJag);
  });

  it("offers The Jag's return leg on the location surface, with no place of its own", () => {
    const jag = availableCrewHaulerRides({
      locationId: LOCATION_IDS.theJag,
      completedMissionIds: unlocked,
    });
    expect(jag).toHaveLength(1);
    expect(jag[0]?.destinationLocationId).toBe(LOCATION_IDS.holoHollow);
    // The Crew Stop belongs to Holo Hollow: asking for it from The Jag offers
    // nothing, so a hand-edited URL cannot move the boarding point.
    expect(
      availableCrewHaulerRides({
        locationId: LOCATION_IDS.theJag,
        localPlaceId: LOCAL_PLACE_IDS.holoHollowCrewStop,
        completedMissionIds: unlocked,
      }),
    ).toEqual([]);
  });

  it("offers nothing anywhere until the Mission is genuinely completed", () => {
    for (const surface of [
      { locationId: LOCATION_IDS.holoHollow },
      { locationId: LOCATION_IDS.holoHollow, localPlaceId: LOCAL_PLACE_IDS.holoHollowCrewStop },
      { locationId: LOCATION_IDS.theJag },
    ]) {
      // A repaired shelter is not a completed Mission: an accepted or
      // ready-for-turn-in Out of the Weather unlocks no ride at either end.
      expect(availableCrewHaulerRides({ ...surface, completedMissionIds: new Set() })).toEqual([]);
    }
  });

  it("authors the boarding place on the route, not in a component", () => {
    expect(TRANSPORT_ROUTES[0]?.boardingLocalPlaceIds).toEqual({
      [LOCATION_IDS.holoHollow]: LOCAL_PLACE_IDS.holoHollowCrewStop,
    });
  });

  it("rejects a boarding place that is not in one of the route's endpoints", () => {
    const [route] = TRANSPORT_ROUTES;
    expect(() =>
      validateTransportRoutes([
        {
          ...route!,
          boardingLocalPlaceIds: { [LOCATION_IDS.crashSite]: LOCAL_PLACE_IDS.holoHollowCrewStop },
        },
      ]),
    ).toThrow(/not one of its endpoints/);
    expect(() =>
      validateTransportRoutes([
        { ...route!, boardingLocalPlaceIds: { [LOCATION_IDS.holoHollow]: LOCAL_PLACE_IDS.hhBnb } },
      ]),
    ).not.toThrow();
  });
});

describe("the Crew Hauler is a paid route, not map adjacency", () => {
  it("connects Holo Hollow and The Jag without making them walk-adjacent", () => {
    expect(areLocationsAdjacent(LOCATION_IDS.holoHollow, LOCATION_IDS.theJag)).toBe(false);
    expect(areLocationsAdjacent(LOCATION_IDS.theJag, LOCATION_IDS.holoHollow)).toBe(false);
    expect(getTransportRoute(LOCATION_IDS.holoHollow, LOCATION_IDS.theJag)?.id).toBe(
      TRANSPORT_ROUTE_IDS.crewHaulerHoloHollowTheJag,
    );
    expect(getTransportRoute(LOCATION_IDS.theJag, LOCATION_IDS.holoHollow)?.id).toBe(
      TRANSPORT_ROUTE_IDS.crewHaulerHoloHollowTheJag,
    );
  });

  it("still refuses to WALK between them", () => {
    expect(
      planTravel({
        currentLocationId: LOCATION_IDS.holoHollow,
        destinationLocationId: LOCATION_IDS.theJag,
        alreadyTraveling: false,
      }),
    ).toEqual({ ok: false, reason: "not_adjacent" });
  });

  it("costs exactly 5 Credits per ride, in both directions", () => {
    expect(TRANSPORT_ROUTES).toHaveLength(1);
    expect(TRANSPORT_ROUTES[0]).toMatchObject({ fareCredits: 5, mode: "crew_hauler" });
    for (const origin of [LOCATION_IDS.holoHollow, LOCATION_IDS.theJag]) {
      const [ride, ...others] = getTransportRoutesFrom(origin);
      expect(others).toEqual([]);
      expect(ride?.route.fareCredits).toBe(5);
    }
  });

  it("takes 20 ticks / 12 seconds while walking the same trip stays two 40-tick legs", () => {
    expect(travelDurationTicks("crew_hauler")).toBe(20);
    expect(travelDurationTicks("crew_hauler") * 600).toBe(12_000);
    expect(travelDurationTicks("walk")).toBe(40);
    // Walking is Holo Hollow -> The Long Scramble -> The Jag.
    expect(areLocationsAdjacent(LOCATION_IDS.holoHollow, LOCATION_IDS.theLongScramble)).toBe(true);
    expect(areLocationsAdjacent(LOCATION_IDS.theLongScramble, LOCATION_IDS.theJag)).toBe(true);
    expect(travelDurationTicks("walk") * 2).toBe(80);
  });

  it("resolves a ride as a real Journey that arrives on its own duration", () => {
    const startedAt = new Date("2026-09-13T00:00:00.000Z");
    const ride = {
      originLocationId: LOCATION_IDS.holoHollow,
      destinationLocationId: LOCATION_IDS.theJag,
      mode: "crew_hauler" as const,
      startedAt,
      arrivesAt: new Date(startedAt.getTime() + 12_000),
    };
    // Not a teleport: partway through, the Journey is still under way.
    expect(
      resolveTravel({
        travel: ride,
        windowStartsAt: startedAt,
        elapsedTicks: 10,
        alreadyConsumedTicks: 0,
      }),
    ).toEqual({ arrived: false, consumedTicks: 10 });
    expect(
      resolveTravel({
        travel: ride,
        windowStartsAt: startedAt,
        elapsedTicks: 20,
        alreadyConsumedTicks: 0,
      }),
    ).toEqual({ arrived: true, consumedTicks: 20 });
  });

  it("validates a persisted ride against its route and a walk against adjacency", () => {
    expect(
      isTravelRouteValid({
        mode: "crew_hauler",
        originLocationId: LOCATION_IDS.holoHollow,
        destinationLocationId: LOCATION_IDS.theJag,
      }),
    ).toBe(true);
    // A forged ride along a route nobody authored never commits an arrival.
    expect(
      isTravelRouteValid({
        mode: "crew_hauler",
        originLocationId: LOCATION_IDS.crashSite,
        destinationLocationId: LOCATION_IDS.theJag,
      }),
    ).toBe(false);
    // And a forged WALK along the Crew Hauler route is still not adjacent.
    expect(
      isTravelRouteValid({
        mode: "walk",
        originLocationId: LOCATION_IDS.holoHollow,
        destinationLocationId: LOCATION_IDS.theJag,
      }),
    ).toBe(false);
  });
});

describe("boarding is server-decided", () => {
  const board = (overrides: Partial<Parameters<typeof planTransportTravel>[0]> = {}) =>
    planTransportTravel({
      currentLocationId: LOCATION_IDS.holoHollow,
      destinationLocationId: LOCATION_IDS.theJag,
      alreadyTraveling: false,
      completedMissionIds: new Set([MISSION_IDS.outOfTheWeather]),
      credits: 5,
      ...overrides,
    });

  it("refuses the ride until the side Mission is completed", () => {
    expect(board({ completedMissionIds: new Set() })).toEqual({
      ok: false,
      reason: "route_locked",
    });
    expect(board({ completedMissionIds: new Set([MISSION_IDS.keepTheChange]) })).toEqual({
      ok: false,
      reason: "route_locked",
    });
  });

  it("refuses a route nobody authored, whatever the client asks for", () => {
    expect(board({ destinationLocationId: LOCATION_IDS.crashSite })).toEqual({
      ok: false,
      reason: "unknown_route",
    });
    expect(board({ destinationLocationId: "somewhere_else" })).toEqual({
      ok: false,
      reason: "unknown_destination",
    });
    expect(board({ destinationLocationId: LOCATION_IDS.holoHollow })).toEqual({
      ok: false,
      reason: "same_location",
    });
  });

  it("refuses an unaffordable fare and a ride already under way", () => {
    expect(board({ credits: 4 })).toEqual({ ok: false, reason: "insufficient_credits" });
    expect(board({ alreadyTraveling: true })).toEqual({ ok: false, reason: "already_traveling" });
  });

  it("resolves fare, duration and mode from content, not from the request", () => {
    expect(board({ credits: 1_000 })).toMatchObject({
      ok: true,
      fareCredits: 5,
      durationTicks: 20,
      mode: "crew_hauler",
    });
  });
});

describe("riding offers nothing to scavenge; walking is untouched", () => {
  it("keeps the Scavenge window a walking-only thing", () => {
    expect(travelOffersScavenge("walk")).toBe(true);
    expect(travelOffersScavenge("crew_hauler")).toBe(false);
  });

  it("leaves ordinary walking free, 40 ticks, and adjacency-validated", () => {
    expect(
      planTravel({
        currentLocationId: LOCATION_IDS.holoHollow,
        destinationLocationId: LOCATION_IDS.theLongScramble,
        alreadyTraveling: false,
      }),
    ).toEqual({ ok: true, durationTicks: 40 });
  });
});

function projectionFor(projection: MissionProjection) {
  return {
    missionId: projection.missionId,
    state: projection.state,
    prerequisiteSatisfied: projection.prerequisiteSatisfied,
    stage: projection.stage,
    requirements: projection.requirements,
  };
}
