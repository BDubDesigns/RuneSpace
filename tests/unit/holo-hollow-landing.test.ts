import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONVERSATION_BACKGROUND_IDS,
  CONVERSATION_TOPIC_IDS,
  EXPRESSION_IDS,
  ITEM_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MERCHANT_IDS,
  MISSION_IDS,
  NPC_IDS,
} from "@/game/config/foundations";
import { getConversationBackground } from "@/game/content/conversation-backgrounds";
import { getNpcConversationTopics } from "@/game/content/conversation-topics";
import { getDialogue } from "@/game/content/dialogue";
import { LOCATIONS, areLocationsAdjacent, getLocation } from "@/game/content/locations";
import { getLocalPlace, getLocalPlacesForLocation } from "@/game/content/local-places";
import { getMerchant, isMerchantOpen } from "@/game/content/merchants";
import { getNpc, getResidentNpcs } from "@/game/content/npcs";
import { MerchantDefinitionSchema } from "@/game/schemas/merchants";
import { quoteTrade } from "@/game/domain/trade";
import { resolveMapIdentifierAsset } from "@/features/travel/local-map-identifiers";
import { buildLocalMapGeometry } from "@/features/travel/local-map-layout";
import { deriveLocalPlaceAccess } from "@/game/domain/local-places";
import { resolveNpcConversation } from "@/game/domain/conversation";

const landing = LOCATION_IDS.holoHollowLanding;

function pngSize(path: string) {
  const buffer = readFileSync(join(process.cwd(), path));
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function webpSize(path: string) {
  const buffer = readFileSync(join(process.cwd(), "public", path));
  expect(buffer.toString("ascii", 0, 4)).toBe("RIFF");
  expect(buffer.toString("ascii", 8, 12)).toBe("WEBP");
  const kind = buffer.toString("ascii", 12, 16);
  if (kind === "VP8 ") {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (kind === "VP8X") {
    return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
  }
  if (kind === "VP8L") {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  throw new Error(`Unrecognized WebP chunk ${kind}`);
}

describe("issue #357 Holo Hollow Landing", () => {
  it("is an ordinary World Location at (1,1) with a map identifier", () => {
    const location = getLocation(landing)!;
    expect(location.displayName).toBe("Holo Hollow Landing");
    expect(location.presentation.localMap).toEqual({
      axial: { q: 1, r: 1 },
      label: "Holo Hollow Landing",
    });
    expect(location.availableActionIds).toEqual([]);
    expect(location.travelable).toBe(true);
    expect(location.stateVariants).toEqual([]);
    expect(location.presentation.scene.overlay).toBeUndefined();
    expect(location.presentation.scene.width / location.presentation.scene.height).toBe(4);
    expect(existsSync(join(process.cwd(), "public/location-scenes/holo-hollow-landing.webp"))).toBe(
      true,
    );
    expect(resolveMapIdentifierAsset(location.presentation.mapIconKey)).toBe(
      "/map-icons/holo-hollow-landing.webp",
    );
  });

  it("walks to exactly Crash Site, the Processing Yard and the South Access Track, both ways", () => {
    expect(getLocation(landing)?.adjacentLocationIds).toEqual([
      LOCATION_IDS.crashSite,
      LOCATION_IDS.abandonedProcessingYard,
      LOCATION_IDS.southAccessTrack,
    ]);
    for (const neighbor of [
      LOCATION_IDS.crashSite,
      LOCATION_IDS.abandonedProcessingYard,
      LOCATION_IDS.southAccessTrack,
    ]) {
      expect(areLocationsAdjacent(landing, neighbor)).toBe(true);
      expect(areLocationsAdjacent(neighbor, landing)).toBe(true);
    }
    // No phantom edges: The South Cut and everything else stays unlinked.
    const linked = LOCATIONS.filter((location) => areLocationsAdjacent(location.id, landing)).map(
      (location) => location.id,
    );
    expect(linked.sort()).toEqual(
      [
        LOCATION_IDS.crashSite,
        LOCATION_IDS.abandonedProcessingYard,
        LOCATION_IDS.southAccessTrack,
      ].sort(),
    );
    expect(areLocationsAdjacent(landing, LOCATION_IDS.theSouthCut)).toBe(false);
    expect(areLocationsAdjacent(LOCATION_IDS.theSouthCut, landing)).toBe(false);
  });

  it("puts each walking edge at the one established 24-second leg", () => {
    const geometry = buildLocalMapGeometry();
    const edges = geometry.undirectedRoutes.filter(
      (route) => route.originLocationId === landing || route.destinationLocationId === landing,
    );
    expect(edges).toHaveLength(3);
  });

  it("has Last Leg Trading as its one open Local Place and hosts no merchant of its own", () => {
    const places = getLocalPlacesForLocation(landing);
    expect(places.map((place) => place.id)).toEqual([LOCAL_PLACE_IDS.lastLegTrading]);
    const shop = getLocalPlace(LOCAL_PLACE_IDS.lastLegTrading)!;
    expect(shop.merchantId).toBe(MERCHANT_IDS.lastLegTrading);
    expect(deriveLocalPlaceAccess(shop, new Set()).available).toBe(true);
    expect(getLocation(landing)?.merchantId).toBeUndefined();
    // A distinct 4:1 exterior, not the Landing panorama.
    expect(shop.presentation.scene.asset).not.toBe(getLocation(landing)!.presentation.scene.asset);
    expect(shop.presentation.scene).toMatchObject({ width: 2508, height: 627 });
    expect(webpSize(shop.presentation.scene.asset)).toEqual({ width: 2508, height: 627 });
  });

  it("ships the approved production art at its approved dimensions", () => {
    expect(webpSize("/location-scenes/holo-hollow-landing.webp")).toEqual({
      width: 1536,
      height: 384,
    });
    expect(webpSize("/location-scenes/last-leg-trading-interior.webp")).toEqual({
      width: 1717,
      height: 916,
    });
    for (const expression of ["neutral", "friendly", "thoughtful", "skeptical"]) {
      expect(pngSize(`public/npc-art/toll-kade-${expression}.png`)).toEqual({
        width: 400,
        height: 500,
      });
    }
    // The masters are kept, and the bare backgrounds carry no baked person or ship.
    for (const master of [
      "assets/npc-art/toll-kade/toll-kade-neutral-master.png",
      "assets/location-scenes/last-leg-trading-exterior-master.png",
      "assets/location-scenes/last-leg-trading-interior-master.png",
      "assets/location-scenes/holo-hollow-landing-master.png",
      "assets/map-icons/holo-hollow-landing.png",
    ]) {
      expect(existsSync(join(process.cwd(), master))).toBe(true);
    }
  });

  it("registers the shop interior as a 15:8 conversation background", () => {
    const background = getConversationBackground(
      CONVERSATION_BACKGROUND_IDS.lastLegTradingInterior,
    )!;
    expect(background.locationId).toBe(landing);
    expect(background.alt.length).toBeGreaterThan(20);
    const { width, height } = webpSize(background.asset);
    expect(width / height).toBeCloseTo(15 / 8, 1);
  });
});

describe("issue #357 Toll Kade", () => {
  const toll = getNpc(NPC_IDS.tollKade)!;

  it("stands inside Last Leg Trading, not on the pad, with four separate portraits", () => {
    expect(toll.homeLocationId).toBe(landing);
    expect(toll.localPlaceId).toBe(LOCAL_PLACE_IDS.lastLegTrading);
    expect(getResidentNpcs({ locationId: landing }).map((npc) => npc.id)).toEqual([]);
    expect(
      getResidentNpcs({ locationId: landing, localPlaceId: LOCAL_PLACE_IDS.lastLegTrading }).map(
        (npc) => npc.id,
      ),
    ).toEqual([NPC_IDS.tollKade]);
    expect(toll.relocations).toBeUndefined();
    expect(Object.keys(toll.expressionAssets ?? {}).sort()).toEqual(
      [
        EXPRESSION_IDS.neutral,
        EXPRESSION_IDS.friendly,
        EXPRESSION_IDS.thoughtful,
        EXPRESSION_IDS.skeptical,
      ].sort(),
    );
    expect(toll.conversationBackgroundId).toBe(CONVERSATION_BACKGROUND_IDS.lastLegTradingInterior);
  });

  it("offers Skatboll, Stillreach and Fuel as always-available topics, in that order", () => {
    expect(getNpcConversationTopics(NPC_IDS.tollKade).map((topic) => topic.label)).toEqual([
      "Skatboll",
      "Stillreach",
      "Fuel",
    ]);
    expect(
      getNpcConversationTopics(NPC_IDS.tollKade).every(
        (topic) => topic.availability.kind === "always",
      ),
    ).toBe(true);
    // Before any Mission, progression or trade unlock, all three are listed and
    // nothing in the hub is a Mission action.
    const conversation = resolveNpcConversation(NPC_IDS.tollKade, [], {
      workOrdersRefreshUnlocked: false,
    });
    expect(conversation.map((entry) => entry.kind)).toEqual(["topic", "topic", "topic"]);
  });

  const lines = (topicId: string) =>
    getDialogue(topicId)!.beats.map((beat) =>
      beat.kind === "npc"
        ? [beat.expressionId, beat.text, beat.backgroundId, beat.speakerNpcId]
        : [],
    );
  const shop = CONVERSATION_BACKGROUND_IDS.lastLegTradingInterior;

  it("speaks the owner-approved Skatboll topic verbatim", () => {
    expect(lines("toll_kade_topic_skatboll")).toEqual([
      [
        "neutral",
        "Skatboll's the planet. Holo Hollow's the town. You'd be amazed how often those get swapped on a shipping label.",
        shop,
        NPC_IDS.tollKade,
      ],
      [
        "friendly",
        "This Landing isn't much to look at, but the lights work and there's room to unload. I'll take that over fancy any day.",
        shop,
        NPC_IDS.tollKade,
      ],
      [
        "skeptical",
        "A fancy landing pad doesn't help much if the fuel isn't there when you need it.",
        shop,
        NPC_IDS.tollKade,
      ],
    ]);
  });

  it("speaks the owner-approved Stillreach topic verbatim", () => {
    expect(lines("toll_kade_topic_stillreach")).toEqual([
      [
        "thoughtful",
        "Stillreach is a long enough haul that you want to count your fuel both ways. Getting there is only half the job.",
        shop,
        NPC_IDS.tollKade,
      ],
      [
        "neutral",
        "I've got a Last Leg Trading terminal at the station there. Same business. Automated counter.",
        shop,
        NPC_IDS.tollKade,
      ],
      [
        "friendly",
        "Efficient little thing. Takes payments, hands out supplies, and has never laughed at one of my jokes. Professional jealousy.",
        shop,
        NPC_IDS.tollKade,
      ],
    ]);
  });

  it("speaks the owner-approved Fuel topic verbatim", () => {
    expect(lines("toll_kade_topic_fuel")).toEqual([
      [
        "neutral",
        "A full Small Fuel Canister holds fifty fuel units. One load, and the canister's gone. That's the arrangement.",
        shop,
        NPC_IDS.tollKade,
      ],
      [
        "thoughtful",
        "Check your tank first. Less than fifty units of room, and some of that fuel goes to waste.",
        shop,
        NPC_IDS.tollKade,
      ],
      [
        "friendly",
        "You can make fuel yourself or buy it from me. Either way, I'd keep enough to get home.",
        shop,
        NPC_IDS.tollKade,
      ],
      [
        "skeptical",
        "A full cargo hold's nice. A ship that can move it is nicer.",
        shop,
        NPC_IDS.tollKade,
      ],
    ]);
  });

  it("registers three distinct topics and no Mission or first-meeting content", () => {
    expect(
      Object.values(CONVERSATION_TOPIC_IDS).filter((id) => id.startsWith("toll_kade")),
    ).toHaveLength(3);
    expect(getDialogue("toll_kade_topic_fuel")!.beats.every((beat) => beat.kind === "npc")).toBe(
      true,
    );
  });
});

describe("issue #357 Last Leg Trading merchant", () => {
  const merchant = getMerchant(MERCHANT_IDS.lastLegTrading)!;
  const price = (itemId: string) => merchant.prices.find((line) => line.itemId === itemId);

  it("is fronted by Toll and unlocks on a completed, not accepted, Thrust Issues", () => {
    expect(merchant.npcId).toBe(NPC_IDS.tollKade);
    expect(merchant.requiredCompletedMissionId).toBe(MISSION_IDS.thrustIssues);
    expect(merchant.authorizingMissionId).toBeUndefined();
    expect(merchant.lockedMessage).toBe(
      "Trading unlocks after you report the completed Thrust Issues repair to Wade at Rusk Recovery.",
    );
    const none = new Set<string>();
    const thrust = new Set<string>([MISSION_IDS.thrustIssues]);
    expect(isMerchantOpen(merchant, { acceptedMissionIds: none, completedMissionIds: none })).toBe(
      false,
    );
    // Accepted (even with the repair done) is still not reported.
    expect(
      isMerchantOpen(merchant, { acceptedMissionIds: thrust, completedMissionIds: none }),
    ).toBe(false);
    expect(
      isMerchantOpen(merchant, { acceptedMissionIds: thrust, completedMissionIds: thrust }),
    ).toBe(true);
  });

  it("authors the approved first-pass prices and daily limits", () => {
    expect(price(ITEM_IDS.fullSmallFuelCanister)).toEqual({
      itemId: ITEM_IDS.fullSmallFuelCanister,
      sellPrice: 225,
      buyPrice: 160,
      dailySellLimit: 5,
    });
    expect(price(ITEM_IDS.emptySmallFuelCanister)).toEqual({
      itemId: ITEM_IDS.emptySmallFuelCanister,
      sellPrice: 40,
      buyPrice: 25,
      dailySellLimit: 5,
    });
    expect(price(ITEM_IDS.oilShale)).toEqual({ itemId: ITEM_IDS.oilShale, buyPrice: 6 });
    expect(merchant.prices).toHaveLength(3);
  });

  it("quotes server-side from the registry and never sells Oil Shale", () => {
    expect(
      quoteTrade({
        merchant,
        itemId: ITEM_IDS.fullSmallFuelCanister,
        direction: "buy",
        quantity: 2,
      }),
    ).toMatchObject({ ok: true, quote: { totalCredits: 450 } });
    expect(
      quoteTrade({
        merchant,
        itemId: ITEM_IDS.fullSmallFuelCanister,
        direction: "sell",
        quantity: 2,
      }),
    ).toMatchObject({ ok: true, quote: { totalCredits: 320 } });
    expect(
      quoteTrade({ merchant, itemId: ITEM_IDS.oilShale, direction: "sell", quantity: 10 }),
    ).toMatchObject({ ok: true, quote: { totalCredits: 60 } });
    expect(
      quoteTrade({ merchant, itemId: ITEM_IDS.oilShale, direction: "buy", quantity: 1 }),
    ).toMatchObject({ ok: false, reason: "not_traded" });
  });

  it("keeps Wade's and Bix's unlock behavior untouched", () => {
    expect(getMerchant(MERCHANT_IDS.wadeRusk)?.authorizingMissionId).toBe(
      MISSION_IDS.tenThousandHours,
    );
    expect(getMerchant(MERCHANT_IDS.wadeRusk)?.requiredCompletedMissionId).toBeUndefined();
    expect(getMerchant(MERCHANT_IDS.bixWeller)?.requiredCompletedMissionId).toBeUndefined();
    expect(getMerchant(MERCHANT_IDS.bixWeller)?.authorizingMissionId).toBeUndefined();
  });

  it("rejects an ambiguous or half-authored unlock", () => {
    const base = { id: "m", npcId: "n", prices: [{ itemId: "i", buyPrice: 1 }] };
    expect(() =>
      MerchantDefinitionSchema.parse({ ...base, requiredCompletedMissionId: "a" }),
    ).toThrow();
    expect(() => MerchantDefinitionSchema.parse({ ...base, lockedMessage: "closed" })).toThrow();
    expect(() =>
      MerchantDefinitionSchema.parse({
        ...base,
        requiredCompletedMissionId: "a",
        authorizingMissionId: "b",
        lockedMessage: "closed",
      }),
    ).toThrow();
    expect(
      MerchantDefinitionSchema.parse({
        ...base,
        requiredCompletedMissionId: "a",
        lockedMessage: "closed",
      }),
    ).toBeDefined();
  });
});
