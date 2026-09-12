import { describe, expect, it } from "vitest";
import {
  CONVERSATION_BACKGROUND_IDS,
  EXPRESSION_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
} from "@/game/config/foundations";
import {
  LOCAL_PLACES,
  getLocalPlace,
  getLocalPlaceInLocation,
  getLocalPlacesForLocation,
} from "@/game/content/local-places";
import { LOCATIONS, areLocationsAdjacent, getLocation } from "@/game/content/locations";
import { getResidentNpc } from "@/game/content/npcs";
import {
  deriveLocalPlaceAccess,
  resolveActiveLocalPlace,
  validateLocalPlaceAccess,
} from "@/game/domain/local-places";
import { deriveCompletedMissionIds } from "@/game/domain/missions";

/**
 * The world-map geometry rule the authored adjacency is expected to agree with.
 * Adjacency itself is authored (and validated for reciprocity by the registry);
 * this recomputes the neighbor set so a coordinate change that silently breaks
 * the approved Holo Hollow relationships fails here instead of in review.
 */
const AXIAL_DIRECTIONS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
] as const;

function axialOf(locationId: string) {
  const axial = getLocation(locationId)?.presentation.localMap.axial;
  if (!axial) throw new Error(`${locationId} has no axial coordinate`);
  return axial;
}

function hexDistance(a: { q: number; r: number }, b: { q: number; r: number }) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

describe("issue #159 Holo Hollow world placement", () => {
  it("sits at the approved axial coordinate", () => {
    expect(axialOf(LOCATION_IDS.holoHollow)).toEqual({ q: -1, r: 1 });
  });

  it("directly connects only to Crash Site, the Power Annex, and The Long Scramble", () => {
    const holoHollow = getLocation(LOCATION_IDS.holoHollow);
    expect([...(holoHollow?.adjacentLocationIds ?? [])].sort()).toEqual(
      [
        LOCATION_IDS.crashSite,
        LOCATION_IDS.emergencyPowerAnnex,
        LOCATION_IDS.theLongScramble,
      ].sort(),
    );
    // Deliberately not a universal hub: The Jag stays behind The Long Scramble
    // and the Processing Yard keeps its own approach.
    expect(areLocationsAdjacent(LOCATION_IDS.holoHollow, LOCATION_IDS.theJag)).toBe(false);
    expect(
      areLocationsAdjacent(LOCATION_IDS.holoHollow, LOCATION_IDS.abandonedProcessingYard),
    ).toBe(false);
  });

  it("agrees with the axial neighbor rule the rest of the map already follows", () => {
    for (const location of LOCATIONS) {
      const origin = axialOf(location.id);
      const geometricNeighbors = new Set(
        AXIAL_DIRECTIONS.map((direction) => `${origin.q + direction.q},${origin.r + direction.r}`),
      );
      for (const neighborId of location.adjacentLocationIds) {
        const neighbor = axialOf(neighborId);
        expect(
          geometricNeighbors.has(`${neighbor.q},${neighbor.r}`),
          `${location.id} -> ${neighborId} must be a unit hex step`,
        ).toBe(true);
      }
    }
    expect(hexDistance(axialOf(LOCATION_IDS.holoHollow), axialOf(LOCATION_IDS.theJag))).toBe(2);
    expect(
      hexDistance(axialOf(LOCATION_IDS.holoHollow), axialOf(LOCATION_IDS.abandonedProcessingYard)),
    ).toBe(2);
  });
});

describe("issue #159 Local Place registry", () => {
  it("belongs entirely to Holo Hollow and never nests", () => {
    const places = getLocalPlacesForLocation(LOCATION_IDS.holoHollow);
    expect(places.map((place) => place.id)).toEqual([
      LOCAL_PLACE_IDS.holoHollowSouvenirs,
      LOCAL_PLACE_IDS.holoHollowAssistanceCenter,
      LOCAL_PLACE_IDS.hhBnb,
    ]);
    expect(places).toHaveLength(LOCAL_PLACES.length);
    for (const place of LOCAL_PLACES) {
      expect(place.parentLocationId).toBe(LOCATION_IDS.holoHollow);
      // A Local Place is never a world position: no coordinate, no adjacency.
      expect(place).not.toHaveProperty("localMap");
      expect(place).not.toHaveProperty("adjacentLocationIds");
      // Nor is any Local Place also a World Location.
      expect(getLocation(place.id)).toBeUndefined();
    }
  });

  it("resolves a place only from its own parent World Location", () => {
    expect(
      getLocalPlaceInLocation(LOCATION_IDS.holoHollow, LOCAL_PLACE_IDS.holoHollowSouvenirs)?.id,
    ).toBe(LOCAL_PLACE_IDS.holoHollowSouvenirs);
    // The same request from anywhere else resolves to nothing at all, which is
    // what stops a submitted place id from being honored off-site.
    expect(
      getLocalPlaceInLocation(LOCATION_IDS.crashSite, LOCAL_PLACE_IDS.holoHollowSouvenirs),
    ).toBeUndefined();
    expect(getLocalPlaceInLocation(LOCATION_IDS.holoHollow, "not_a_place")).toBeUndefined();
  });

  it("derives access without naming any particular building", () => {
    const shop = getLocalPlace(LOCAL_PLACE_IDS.holoHollowSouvenirs)!;
    const assistance = getLocalPlace(LOCAL_PLACE_IDS.holoHollowAssistanceCenter)!;
    const bnb = getLocalPlace(LOCAL_PLACE_IDS.hhBnb)!;

    expect(deriveLocalPlaceAccess(shop)).toEqual({ available: true });
    expect(deriveLocalPlaceAccess(assistance)).toEqual({ available: true });

    const bnbAccess = deriveLocalPlaceAccess(bnb);
    expect(bnbAccess.available).toBe(false);
    // Locked still means visible, with a reason the player can read.
    expect(bnbAccess.available === false && bnbAccess.reason.length).toBeGreaterThan(10);
  });

  it("only authors a merchant where one actually trades", () => {
    expect(getLocalPlace(LOCAL_PLACE_IDS.holoHollowSouvenirs)?.merchantId).toBeDefined();
    expect(getLocalPlace(LOCAL_PLACE_IDS.holoHollowAssistanceCenter)?.merchantId).toBeUndefined();
    expect(getLocalPlace(LOCAL_PLACE_IDS.hhBnb)?.merchantId).toBeUndefined();
  });
});

describe("issue #159 active Local Place interpretation", () => {
  it("accepts an open place requested from its own parent location", () => {
    expect(
      resolveActiveLocalPlace({
        locationId: LOCATION_IDS.holoHollow,
        requestedLocalPlaceId: LOCAL_PLACE_IDS.holoHollowSouvenirs,
      })?.id,
    ).toBe(LOCAL_PLACE_IDS.holoHollowSouvenirs);
  });

  it("resolves nothing when no place is requested", () => {
    expect(resolveActiveLocalPlace({ locationId: LOCATION_IDS.holoHollow })).toBeUndefined();
  });

  it("refuses a hand-edited request for an unknown, wrong-parent, or locked place", () => {
    for (const requested of ["not_a_place", LOCAL_PLACE_IDS.hhBnb]) {
      expect(
        resolveActiveLocalPlace({
          locationId: LOCATION_IDS.holoHollow,
          requestedLocalPlaceId: requested,
        }),
        `${requested} must not become active`,
      ).toBeUndefined();
    }
    expect(
      resolveActiveLocalPlace({
        locationId: LOCATION_IDS.crashSite,
        requestedLocalPlaceId: LOCAL_PLACE_IDS.holoHollowSouvenirs,
      }),
    ).toBeUndefined();
  });

  it("gives the place surface and the resident panel the same answer", () => {
    // The locked B&B is the case that matters: its resident must not become
    // active context just because its id appears in the URL.
    const requestedLocalPlaceId = LOCAL_PLACE_IDS.hhBnb;
    const active = resolveActiveLocalPlace({
      locationId: LOCATION_IDS.holoHollow,
      requestedLocalPlaceId,
    });
    expect(active).toBeUndefined();
    expect(
      getResidentNpc({ locationId: LOCATION_IDS.holoHollow, localPlaceId: active?.id }),
    ).toBeUndefined();
    // Reading the raw request instead would have resolved Mara.
    expect(
      getResidentNpc({ locationId: LOCATION_IDS.holoHollow, localPlaceId: requestedLocalPlaceId })
        ?.id,
    ).toBe(NPC_IDS.maraKells);
  });
});

describe("issue #159 Local-Place-scoped residents", () => {
  it("resolves each Holo Hollow resident from their own place", () => {
    expect(
      getResidentNpc({
        locationId: LOCATION_IDS.holoHollow,
        localPlaceId: LOCAL_PLACE_IDS.holoHollowSouvenirs,
      })?.id,
    ).toBe(NPC_IDS.bixWeller);
    expect(
      getResidentNpc({
        locationId: LOCATION_IDS.holoHollow,
        localPlaceId: LOCAL_PLACE_IDS.holoHollowAssistanceCenter,
      })?.id,
    ).toBe(NPC_IDS.rennCalder);
  });

  it("exposes nobody merely for standing in town", () => {
    expect(getResidentNpc({ locationId: LOCATION_IDS.holoHollow })).toBeUndefined();
  });

  it("keeps World-Location residents resolving exactly as before", () => {
    expect(getResidentNpc({ locationId: LOCATION_IDS.crashSite })?.id).toBe(NPC_IDS.wadeRusk);
    expect(getResidentNpc({ locationId: LOCATION_IDS.theJag })?.id).toBe(NPC_IDS.tansyRusk);
    // Supplying a place at a location that has none resolves nothing rather
    // than falling back to the location's own resident.
    expect(
      getResidentNpc({
        locationId: LOCATION_IDS.crashSite,
        localPlaceId: LOCAL_PLACE_IDS.holoHollowSouvenirs,
      }),
    ).toBeUndefined();
  });

  it("keeps Mara as the B&B's resident, now with her authored conversation art", () => {
    const mara = getResidentNpc({
      locationId: LOCATION_IDS.holoHollow,
      localPlaceId: LOCAL_PLACE_IDS.hhBnb,
    });
    expect(mara?.id).toBe(NPC_IDS.maraKells);
    // Issue #170 supplies her approved set. The shared expression vocabulary is
    // mapped to her own art; `firm` is composed and matter-of-fact rather than
    // reusing `guarded`, which means wary.
    expect(mara?.conversationBackgroundId).toBe(CONVERSATION_BACKGROUND_IDS.hhBnbInterior);
    expect(mara?.expressionAssets).toEqual({
      [EXPRESSION_IDS.neutral]: "/npc-art/mara-neutral-pragmatic.png",
      [EXPRESSION_IDS.amused]: "/npc-art/mara-warm-wry.png",
      [EXPRESSION_IDS.firm]: "/npc-art/mara-firm-no-nonsense.png",
    });
  });
});

/**
 * Issue #170: HH B&B opens because the player finished Keep the Change, and for
 * no other reason. Access is derived from that completion — there is no second
 * persisted unlock flag that could disagree with the Mission record.
 */
describe("issue #170 mission-derived Local Place access", () => {
  const bnb = () => getLocalPlace(LOCAL_PLACE_IDS.hhBnb)!;
  const completed = new Set<string>([MISSION_IDS.keepTheChange]);

  it("gates the B&B on Keep the Change rather than on a stored flag", () => {
    expect(bnb().access).toEqual({
      kind: "locked_until_mission_completed",
      missionId: MISSION_IDS.keepTheChange,
      reason: expect.any(String),
    });
  });

  it("stays locked with an in-world reason until that Mission is completed", () => {
    const locked = deriveLocalPlaceAccess(bnb(), new Set());
    expect(locked.available).toBe(false);
    expect(locked.available === false && locked.reason).toContain("locals");
    // Completing a different Mission changes nothing.
    expect(deriveLocalPlaceAccess(bnb(), new Set([MISSION_IDS.holdItTogether])).available).toBe(
      false,
    );
  });

  it("opens once that Mission is completed", () => {
    expect(deriveLocalPlaceAccess(bnb(), completed)).toEqual({ available: true });
    expect(
      resolveActiveLocalPlace({
        locationId: LOCATION_IDS.holoHollow,
        requestedLocalPlaceId: LOCAL_PLACE_IDS.hhBnb,
        completedMissionIds: completed,
      })?.id,
    ).toBe(LOCAL_PLACE_IDS.hhBnb);
  });

  it("makes Mara reachable only through that opened place", () => {
    const active = resolveActiveLocalPlace({
      locationId: LOCATION_IDS.holoHollow,
      requestedLocalPlaceId: LOCAL_PLACE_IDS.hhBnb,
      completedMissionIds: completed,
    });
    expect(
      getResidentNpc({ locationId: LOCATION_IDS.holoHollow, localPlaceId: active?.id })?.id,
    ).toBe(NPC_IDS.maraKells);
    // Still nobody merely for standing in town, and still nobody while locked.
    expect(getResidentNpc({ locationId: LOCATION_IDS.holoHollow })).toBeUndefined();
    expect(
      resolveActiveLocalPlace({
        locationId: LOCATION_IDS.holoHollow,
        requestedLocalPlaceId: LOCAL_PLACE_IDS.hhBnb,
      }),
    ).toBeUndefined();
  });

  it("derives completed Mission ids from authoritative projections only", () => {
    expect(
      deriveCompletedMissionIds([
        { missionId: MISSION_IDS.holdItTogether, state: "completed" },
        { missionId: MISSION_IDS.keepTheChange, state: "ready_for_completion" },
      ]),
    ).toEqual(new Set([MISSION_IDS.holdItTogether]));
    expect(
      deriveCompletedMissionIds([{ missionId: MISSION_IDS.keepTheChange, state: "completed" }]),
    ).toEqual(completed);
  });

  it("fails fast when an authored place gates on a Mission that does not exist", () => {
    expect(() =>
      validateLocalPlaceAccess(LOCAL_PLACES, new Set([MISSION_IDS.keepTheChange])),
    ).not.toThrow();
    expect(() => validateLocalPlaceAccess(LOCAL_PLACES, new Set())).toThrow(/unknown mission/i);
  });
});
