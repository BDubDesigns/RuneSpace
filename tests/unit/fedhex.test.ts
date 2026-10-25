import { describe, expect, it } from "vitest";
import { LOCAL_PLACE_IDS, LOCATION_IDS, NPC_IDS } from "@/game/config/foundations";
import {
  FEDHEX_ECHO_RECOVERY_BODY,
  FEDHEX_ECHO_RECOVERY_SUBJECT,
  fedhexEchoRecoverySender,
} from "@/game/content/fedhex";
import {
  getLocalPlace,
  getLocalPlaceInLocation,
  getLocalPlacesForLocation,
  LOCAL_PLACES,
} from "@/game/content/local-places";
import { isFedhexMailboxPlace, planFedhexClaim } from "@/game/domain/fedhex";
import { deriveLocalPlaceAccess, resolveActiveLocalPlace } from "@/game/domain/local-places";

/**
 * FedHex (#399): two always-open pickups under the two landing hubs, one shared
 * scene, one character-owned mailbox, and the claim's capacity rule. The claim's
 * persistence, location checks and concurrency are proven against PostgreSQL in
 * tests/integration/fedhex.test.ts.
 */

const holoHollow = () => getLocalPlace(LOCAL_PLACE_IDS.fedhexHoloHollowLanding)!;
const stillreach = () => getLocalPlace(LOCAL_PLACE_IDS.fedhexStillreachLandingStation)!;

describe("the two FedHex Local Places", () => {
  it("sit under their own landing hubs, always open, as Local Places and not map hexes", () => {
    expect(holoHollow().parentLocationId).toBe(LOCATION_IDS.holoHollowLanding);
    expect(stillreach().parentLocationId).toBe(LOCATION_IDS.stillreachLandingStation);
    for (const place of [holoHollow(), stillreach()]) {
      expect(place.access).toEqual({ kind: "open" });
      expect(deriveLocalPlaceAccess(place, new Set()).available).toBe(true);
      expect(isFedhexMailboxPlace(place)).toBe(true);
      // Never a Travel destination or a second position.
      expect(place).not.toHaveProperty("localMap");
      expect(place).not.toHaveProperty("adjacentLocationIds");
      expect(place.merchantId).toBeUndefined();
    }
    expect(holoHollow().displayName).toBe("FedHex — Holo Hollow Landing");
    expect(stillreach().displayName).toBe("FedHex — Stillreach Landing Station");
    expect(getLocalPlacesForLocation(LOCATION_IDS.holoHollowLanding).map((p) => p.id)).toContain(
      LOCAL_PLACE_IDS.fedhexHoloHollowLanding,
    );
  });

  it("share one identical approved 4:1 interior scene, with no exterior or sign of another business", () => {
    expect(holoHollow().presentation.scene).toEqual(stillreach().presentation.scene);
    const { scene } = holoHollow().presentation;
    expect(scene.asset).toBe("/location-scenes/fedhex-parcel-hub.webp");
    expect(scene.width / scene.height).toBe(4);
    expect(scene.alt).toMatch(/FedHex/);
    expect(scene.alt).not.toMatch(/Last Leg|Refiner/i);
    expect(holoHollow().description).toBe(stillreach().description);
    const fedhex = LOCAL_PLACES.filter(isFedhexMailboxPlace);
    expect(fedhex.map((place) => place.id).sort()).toEqual(
      [
        LOCAL_PLACE_IDS.fedhexHoloHollowLanding,
        LOCAL_PLACE_IDS.fedhexStillreachLandingStation,
      ].sort(),
    );
  });

  it("opens only from its own parent location", () => {
    expect(
      getLocalPlaceInLocation(LOCATION_IDS.stillreachLandingStation, holoHollow().id),
    ).toBeUndefined();
    expect(
      resolveActiveLocalPlace({
        locationId: LOCATION_IDS.holoHollowLanding,
        requestedLocalPlaceId: stillreach().id,
      }),
    ).toBeUndefined();
    expect(
      resolveActiveLocalPlace({
        locationId: LOCATION_IDS.holoHollowLanding,
        requestedLocalPlaceId: holoHollow().id,
      })?.id,
    ).toBe(holoHollow().id);
  });
});

describe("the recovery mail's authored content", () => {
  it("is from The Wise Old Enby with the exact approved subject", () => {
    expect(fedhexEchoRecoverySender()).toEqual({
      kind: "npc",
      id: NPC_IDS.wiseOldEnby,
      displayName: "The Wise Old Enby",
    });
    expect(FEDHEX_ECHO_RECOVERY_SUBJECT).toBe("Hey, did you drop this? 😏");
  });

  it("is short, in first person and never gives the Enby a pronoun", () => {
    expect(FEDHEX_ECHO_RECOVERY_BODY.length).toBeLessThan(280);
    expect(FEDHEX_ECHO_RECOVERY_BODY).toMatch(/\bI've\b|\bI\b/);
    expect(FEDHEX_ECHO_RECOVERY_BODY).not.toMatch(/\b(he|she|they|them|him|her|his|hers|their)\b/i);
  });
});

describe("planning a claim", () => {
  it("needs a slot and the mass of the unique item, and says which is short", () => {
    expect(
      planFedhexClaim({ massGrams: 2_000, availableSlots: 1, availableMassGrams: 2_000 }),
    ).toEqual({
      ok: true,
    });
    const noSlot = planFedhexClaim({
      massGrams: 2_000,
      availableSlots: 0,
      availableMassGrams: 99_000,
    });
    expect(noSlot).toMatchObject({ ok: false, reason: "no_slot" });
    const noMass = planFedhexClaim({
      massGrams: 2_000,
      availableSlots: 4,
      availableMassGrams: 1_999,
    });
    expect(noMass).toMatchObject({ ok: false, reason: "no_mass" });
    if (!noMass.ok) expect(noMass.message).toContain("Free up");
  });
});
