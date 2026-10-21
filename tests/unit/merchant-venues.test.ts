import { describe, expect, it } from "vitest";
import {
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MERCHANT_IDS,
  MISSION_IDS,
  NPC_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { LOCAL_PLACES } from "@/game/content/local-places";
import { LOCATIONS } from "@/game/content/locations";
import { getMerchant, MERCHANTS } from "@/game/content/merchants";
import { getNpc, npcCanStandAt } from "@/game/content/npcs";
import { buildItemReference } from "@/game/domain/item-reference";
import { resolveItemSources, type ItemSourceFacts } from "@/game/domain/item-sources";
import { resolveLocationState } from "@/game/domain/location-state";
import { merchantVenues } from "@/game/domain/merchant-venues";
import { describeItemSources } from "@/features/item-sources/item-source-presentation";
import { buildWikiItemPage } from "@/features/public-site/public-item-wiki";

/**
 * Issue #375 — a merchant is a business that can keep several venues. Last Leg
 * Trading has Toll's counter at Holo Hollow Landing and an automated terminal
 * hosted by Stillreach Landing Station: one merchant, so one set of prices,
 * unlock and daily allowances, listed once per venue in every Item Sources view.
 */
const FULL = ITEM_IDS.fullSmallFuelCanister;
const EMPTY = ITEM_IDS.emptySmallFuelCanister;
const registries = { localPlaces: LOCAL_PLACES, locations: LOCATIONS };

function facts(completed: readonly string[] = [MISSION_IDS.thrustIssues]): ItemSourceFacts {
  return {
    skillLevels: { [SKILL_IDS.fabrication]: 8, [SKILL_IDS.refining]: 8 },
    acceptedMissionIds: new Set(),
    completedMissionIds: new Set(completed),
    fabricationStationUnlocked: true,
    locationStates: Object.fromEntries(
      LOCATIONS.map((location) => [
        location.id,
        resolveLocationState(location, {
          acceptedMissionIds: new Set(),
          completedRepairTargetIds: new Set(),
        }),
      ]),
    ),
  };
}

type MerchantSource = {
  kind: "merchant";
  merchantId: string;
  npcId?: string;
  locationId: string;
};
const merchantSources = (sources: readonly { kind: string }[]) =>
  sources.filter((source): source is MerchantSource => source.kind === "merchant");

describe("merchant venues", () => {
  it("lists Toll's counter and the Stillreach terminal as venues of one merchant", () => {
    const merchant = getMerchant(MERCHANT_IDS.lastLegTrading)!;
    expect(merchantVenues(merchant, registries)).toEqual([
      {
        locationId: LOCATION_IDS.holoHollowLanding,
        localPlaceId: LOCAL_PLACE_IDS.lastLegTrading,
        place: LOCAL_PLACES.find((place) => place.id === LOCAL_PLACE_IDS.lastLegTrading),
        npcId: NPC_IDS.tollKade,
      },
      // Nobody stands at the terminal, so no NPC is credited there.
      { locationId: LOCATION_IDS.stillreachLandingStation },
    ]);
  });

  it("keeps every other merchant at exactly one venue, still fronted by its resident", () => {
    for (const merchant of MERCHANTS) {
      if (merchant.id === MERCHANT_IDS.lastLegTrading) continue;
      const venues = merchantVenues(merchant, registries);
      expect(venues, merchant.id).toHaveLength(1);
      expect(venues[0]!.npcId, merchant.id).toBe(merchant.npcId);
    }
  });

  it("knows an NPC's authored venues, home and relocations, and no other", () => {
    const wade = getNpc(NPC_IDS.wadeRusk)!;
    expect(npcCanStandAt(wade, LOCATION_IDS.ruskRecovery)).toBe(true);
    expect(npcCanStandAt(wade, LOCATION_IDS.crashSite)).toBe(true);
    expect(npcCanStandAt(wade, LOCATION_IDS.stillreachLandingStation)).toBe(false);
    const toll = getNpc(NPC_IDS.tollKade)!;
    expect(
      npcCanStandAt(toll, LOCATION_IDS.holoHollowLanding, LOCAL_PLACE_IDS.lastLegTrading),
    ).toBe(true);
    expect(npcCanStandAt(toll, LOCATION_IDS.holoHollowLanding)).toBe(false);
    expect(npcCanStandAt(toll, LOCATION_IDS.stillreachLandingStation)).toBe(false);
  });
});

describe.each([
  ["Full Small Fuel Canister", FULL, 225],
  ["Empty Small Fuel Canister", EMPTY, 40],
])("%s sources (#375)", (_name, itemId, price) => {
  it("lists both Last Leg Trading venues once the shared Thrust Issues unlock is met", () => {
    const sources = merchantSources(resolveItemSources(itemId, facts()));
    expect(sources).toHaveLength(2);
    expect(sources.map((source) => source.merchantId)).toEqual([
      MERCHANT_IDS.lastLegTrading,
      MERCHANT_IDS.lastLegTrading,
    ]);
    expect(sources[0]).toMatchObject({
      locationId: LOCATION_IDS.holoHollowLanding,
      localPlaceId: LOCAL_PLACE_IDS.lastLegTrading,
      npcId: NPC_IDS.tollKade,
      unitPrice: price,
      dailyLimit: 5,
    });
    expect(sources[1]).toMatchObject({
      locationId: LOCATION_IDS.stillreachLandingStation,
      unitPrice: price,
      dailyLimit: 5,
    });
    // No second economy and no NPC at the terminal.
    expect(sources[1]).not.toHaveProperty("npcId");
    expect(sources[1]).not.toHaveProperty("localPlaceId");
  });

  it("shows neither venue to a character who has not turned in Thrust Issues", () => {
    expect(merchantSources(resolveItemSources(itemId, facts([])))).toEqual([]);
  });

  it("is listed in the item reference with the same unlock at each venue", () => {
    const reference = merchantSources(buildItemReference(itemId)!.sources);
    expect(reference.map((source) => source.locationId)).toEqual([
      LOCATION_IDS.holoHollowLanding,
      LOCATION_IDS.stillreachLandingStation,
    ]);
    for (const source of reference) {
      expect(source).toMatchObject({
        merchantId: MERCHANT_IDS.lastLegTrading,
        unitPrice: price,
        dailyLimit: 5,
        opensAfterCompletedMissionId: MISSION_IDS.thrustIssues,
      });
    }
    expect(reference[1]).not.toHaveProperty("npcId");
  });

  it("describes the two venues with distinct keys, crediting Toll only at his counter", () => {
    const described = describeItemSources(
      itemId,
      resolveItemSources(itemId, facts()),
      facts(),
    ).filter((entry) => entry.kind === "merchant");
    expect(new Set(described.map((entry) => entry.key)).size).toBe(2);
    expect(described[0]!.where).toBe(
      "Tolliver “Toll” Kade — Last Leg Trading, Holo Hollow Landing",
    );
    expect(described[1]!.where).toBe("Automated terminal — Stillreach Landing Station");
    for (const entry of described) {
      expect(entry).toMatchObject({ price, notes: ["Up to 5 a day"] });
    }
  });

  it("is worded on the public item page for both venues", () => {
    const text = buildWikiItemPage(itemId)!
      .obtain.map((line) =>
        line.map((segment) => (typeof segment === "string" ? segment : segment.text)).join(""),
      )
      .join("\n");
    expect(text).toContain("Tolliver “Toll” Kade — Last Leg Trading, Holo Hollow Landing");
    expect(text).toContain("the automated terminal — Stillreach Landing Station");
    expect(text).toContain(`for ${price} Credits each, up to 5 a day per character`);
  });
});

describe("Oil Shale (#375)", () => {
  it("is bought by both venues but sold by neither, so it has no merchant source", () => {
    expect(merchantSources(resolveItemSources(ITEM_IDS.oilShale, facts()))).toEqual([]);
    expect(merchantSources(buildItemReference(ITEM_IDS.oilShale)!.sources)).toEqual([]);
  });
});
