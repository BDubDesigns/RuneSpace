import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getItemDefinition } from "@/game/config/balance";
import {
  ACTION_IDS,
  CONVERSATION_BACKGROUND_IDS,
  CONVERSATION_TOPIC_IDS,
  DIALOGUE_IDS,
  EXPRESSION_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MERCHANT_IDS,
  NPC_IDS,
  PLANET_IDS,
} from "@/game/config/foundations";
import {
  getConversationBackground,
  getConversationBackgroundPlaceName,
} from "@/game/content/conversation-backgrounds";
import { CONVERSATION_TOPICS, getNpcConversationTopics } from "@/game/content/conversation-topics";
import { DIALOGUE_SEQUENCES, getDialogue } from "@/game/content/dialogue";
import { BEGINNER_ECHO_TARGET_POOLS } from "@/game/content/echo-hunts";
import { getLocalPlacesForLocation } from "@/game/content/local-places";
import {
  LOCAL_MAP_LOCATION_IDS_BY_PLANET,
  LOCATIONS,
  areLocationsAdjacent,
  getLocation,
} from "@/game/content/locations";
import {
  getLocationMerchant,
  getMerchant,
  merchantBuybackPrice,
  merchantRetailPrice,
} from "@/game/content/merchants";
import { getNpc, getResidentNpcs, resolveNpcExpression } from "@/game/content/npcs";
import { resolveNpcConversation } from "@/game/domain/conversation";
import {
  checkEchoClue,
  echoReadingDirections,
  resolveEchoReading,
  selectEchoTarget,
  validateEchoHuntContent,
  type EchoRandom,
} from "@/game/domain/echo-hunts";
import {
  dailyPurchaseAllowance,
  maximumPurchasableQuantity,
  merchantDailyAllowances,
  merchantDailySellLimit,
  merchantPurchasableItemIds,
  merchantSellableItemIds,
  quoteTrade,
} from "@/game/domain/trade";
import { planTransportTravel, planTravel } from "@/game/domain/travel";
import { resolveMapIdentifierAsset } from "@/features/travel/local-map-identifiers";
import {
  LOCAL_MAP_GEOMETRY_BY_PLANET,
  getLocalMapGeometryForLocation,
} from "@/features/travel/local-map-layout";
import { readImageHeader } from "./image-header";

/**
 * Issue #429 — Werner's Lab: the ninth Stillreach World Location, its NPC, his three
 * locked topics, his mineral merchant and his place in the Beginner Echo pool.
 *
 * Everything here is derived from the registries without PostgreSQL or a browser.
 * Server authority — the 12-a-day ledger, concurrency, the Pacific rollover, funds and
 * capacity refusals, and persisted hunts — is proven against real PostgreSQL in
 * tests/integration/werners-lab.test.ts.
 */

const lab = LOCATION_IDS.wernersLab;
const werner = NPC_IDS.werner;
const merchantId = MERCHANT_IDS.wernerLab;

const sha256 = (path: string) =>
  createHash("sha256")
    .update(readFileSync(join(process.cwd(), path)))
    .digest("hex");

describe("Werner's Lab on the Stillreach map", () => {
  const location = getLocation(lab)!;

  it("is Stillreach's ninth World Location at axial (1, 2), named Werner's Lab", () => {
    expect(location.displayName).toBe("Werner's Lab");
    expect(location.planetId).toBe(PLANET_IDS.stillreach);
    expect(location.region).toBeUndefined();
    expect(location.presentation.localMap).toEqual({
      axial: { q: 1, r: 2 },
      label: "Werner's Lab",
    });
    expect(LOCAL_MAP_LOCATION_IDS_BY_PLANET.stillreach).toHaveLength(9);
    expect(LOCAL_MAP_LOCATION_IDS_BY_PLANET.stillreach).toContain(lab);
    expect(LOCATIONS.filter((l) => l.planetId === PLANET_IDS.stillreach)).toHaveLength(9);
  });

  it("occupies a hex no other Stillreach location holds", () => {
    const keys = LOCAL_MAP_LOCATION_IDS_BY_PLANET.stillreach.map((id) => {
      const { q, r } = getLocation(id)!.presentation.localMap.axial;
      return `${q},${r}`;
    });
    expect(new Set(keys).size).toBe(9);
    expect(keys.filter((key) => key === "1,2")).toHaveLength(1);
  });

  it("walks to the Quarry and Harmonic Workings, both ways, and nowhere else", () => {
    expect([...location.adjacentLocationIds].sort()).toEqual(
      [LOCATION_IDS.prospectingQuarry, LOCATION_IDS.harmonicWorkings].sort(),
    );
    for (const neighbor of [LOCATION_IDS.prospectingQuarry, LOCATION_IDS.harmonicWorkings]) {
      expect(areLocationsAdjacent(lab, neighbor)).toBe(true);
      expect(areLocationsAdjacent(neighbor, lab)).toBe(true);
      expect(
        planTravel({
          currentLocationId: lab,
          destinationLocationId: neighbor,
          alreadyTraveling: false,
        }),
      ).toEqual(
        planTravel({
          currentLocationId: LOCATION_IDS.windwardTrack,
          destinationLocationId: LOCATION_IDS.prospectingQuarry,
          alreadyTraveling: false,
        }),
      );
      expect(
        planTravel({
          currentLocationId: neighbor,
          destinationLocationId: lab,
          alreadyTraveling: false,
        }),
      ).toMatchObject({ ok: true });
    }
  });

  it("has no walking route to The Survey Line, though the hexes touch", () => {
    // (1,2) and (2,1) are neighbours on the hex grid; the registry authors no edge.
    expect(areLocationsAdjacent(lab, LOCATION_IDS.theSurveyLine)).toBe(false);
    expect(areLocationsAdjacent(LOCATION_IDS.theSurveyLine, lab)).toBe(false);
    for (const [from, to] of [
      [lab, LOCATION_IDS.theSurveyLine],
      [LOCATION_IDS.theSurveyLine, lab],
    ] as const) {
      expect(
        planTravel({ currentLocationId: from, destinationLocationId: to, alreadyTraveling: false }),
      ).toEqual({
        ok: false,
        reason: "not_adjacent",
      });
    }
    expect(getLocation(LOCATION_IDS.theSurveyLine)!.adjacentLocationIds).not.toContain(lab);
    const geometry = LOCAL_MAP_GEOMETRY_BY_PLANET.stillreach;
    const pairs = geometry.undirectedRoutes.map((route) =>
      [route.originLocationId, route.destinationLocationId].sort().join("|"),
    );
    expect(pairs).not.toContain([lab, LOCATION_IDS.theSurveyLine].sort().join("|"));
    expect(pairs).toContain([lab, LOCATION_IDS.prospectingQuarry].sort().join("|"));
    expect(pairs).toContain([lab, LOCATION_IDS.harmonicWorkings].sort().join("|"));
  });

  it("is isolated from Skatboll and picks the Stillreach map from its own location", () => {
    expect(getLocalMapGeometryForLocation(lab)).toBe(LOCAL_MAP_GEOMETRY_BY_PLANET.stillreach);
    for (const skatboll of LOCATIONS.filter((l) => l.planetId === PLANET_IDS.skatboll)) {
      expect(areLocationsAdjacent(skatboll.id, lab)).toBe(false);
      expect(areLocationsAdjacent(lab, skatboll.id)).toBe(false);
    }
    expect(
      planTransportTravel({
        currentLocationId: LOCATION_IDS.crashSite,
        destinationLocationId: lab,
        alreadyTraveling: false,
        completedMissionIds: new Set(),
        credits: 1_000_000,
      }),
    ).toMatchObject({ ok: false });
  });

  it("hosts its mineral merchant and Lapidary Workbench without another Local Place", () => {
    expect(location.availableActionIds).toEqual([ACTION_IDS.shapeStone, ACTION_IDS.cutQuartz]);
    expect(location.dormantActivities).toEqual([]);
    expect(location.stateVariants).toEqual([]);
    expect(location.mapStatus).toBeUndefined();
    expect(getLocalPlacesForLocation(lab)).toEqual([]);
    expect(location.merchantId).toBe(merchantId);
    expect(getLocationMerchant(lab)?.id).toBe(merchantId);
  });

  it("describes the parked lab and what it actually does today, with its shipped Lapidary authorization", () => {
    expect(location.description).toMatch(/mineral laboratory/i);
    expect(location.description).toContain("Werner");
    expect(location.description).toContain("Stone");
    expect(location.description).toMatch(/supervised Lapidary lessons/i);
    expect(location.presentation.scene.alt).not.toMatch(/lapidary/i);
  });

  it("keeps its neighbours' descriptions consistent with the new walk", () => {
    for (const neighbor of [LOCATION_IDS.prospectingQuarry, LOCATION_IDS.harmonicWorkings]) {
      expect(getLocation(neighbor)!.description).toContain("Werner's Lab");
    }
    expect(getLocation(LOCATION_IDS.theSurveyLine)!.description).not.toContain("Werner");
  });

  it("shows the committed 4:1 exterior and the map identifier at their real sizes", () => {
    const { scene } = location.presentation;
    expect(scene.asset).toBe("/location-scenes/werner-lab.webp");
    expect({ width: scene.width, height: scene.height }).toEqual({ width: 1536, height: 384 });
    expect(scene.width).toBe(scene.height * 4);
    const header = readImageHeader(`public${scene.asset}`);
    expect({ width: header.width, height: header.height }).toEqual({ width: 1536, height: 384 });
    expect(header.container).toBe("VP8 ");

    expect(location.presentation.mapIconKey).toBe("werner_lab");
    const icon = resolveMapIdentifierAsset("werner_lab");
    expect(icon).toBe("/map-icons/werner-lab.webp");
    const iconHeader = readImageHeader(`public${icon}`);
    expect(iconHeader.container).toBe("VP8L");
    expect(iconHeader.hasAlpha ?? true).toBe(true);
    expect(Math.max(iconHeader.width, iconHeader.height)).toBeLessThanOrEqual(512);
    expect(Math.max(iconHeader.width, iconHeader.height)).toBe(512);
  });
});

describe("approved art", () => {
  const expressions = ["neutral", "thoughtful", "amused", "intense"] as const;
  const portraitMasters: Record<(typeof expressions)[number], string> = {
    neutral: "e96bac935690d4b56f58f8029e17d9fd070a0f4828059d2f0a3696d933f97835",
    thoughtful: "a7959c6e7fa3db6871a45a06b79564ecf887a866b1dbecb8a86b63a27635fca3",
    amused: "88589f8cc26cc80f39c0e6139f0f065f38b3446b06bfa84e5334ab06f938527a",
    intense: "0e437862a2ac1676154a1be4687251362fc4f348599995475cd3ad6fb1522803",
  };

  it("maps the four approved portraits onto Werner's expressions on one shared canvas", () => {
    const assets = getNpc(werner)!.expressionAssets!;
    expect(Object.keys(assets).sort()).toEqual(
      expressions.map((expression) => EXPRESSION_IDS[expression]).sort(),
    );
    for (const expression of expressions) {
      const asset = assets[EXPRESSION_IDS[expression]]!;
      expect(asset).toBe(`/npc-art/werner-${expression}.png`);
      expect(resolveNpcExpression(werner, expression)).toBe(asset);
      const header = readImageHeader(`public${asset}`);
      expect(header.container).toBe("png");
      expect({ width: header.width, height: header.height }).toEqual({ width: 400, height: 500 });
      const master = `assets/npc-art/werner/werner-${expression}-master.png`;
      expect(sha256(master)).toBe(portraitMasters[expression]);
      const masterHeader = readImageHeader(master);
      expect({ width: masterHeader.width, height: masterHeader.height }).toEqual({
        width: 1086,
        height: 1448,
      });
    }
  });

  it("keeps every portrait transparent, with empty margin and a clear background", () => {
    for (const expression of expressions) {
      const buffer = readFileSync(join(process.cwd(), `public/npc-art/werner-${expression}.png`));
      // IHDR colour type 6 is RGBA.
      expect(buffer[25], expression).toBe(6);
    }
  });

  it("talks against the dedicated people-free 15:8 interior, labelled by the lab", () => {
    const background = getConversationBackground(CONVERSATION_BACKGROUND_IDS.wernersLabInterior)!;
    expect(getNpc(werner)!.conversationBackgroundId).toBe(background.id);
    expect(background.locationId).toBe(lab);
    expect(background.localPlaceId).toBeUndefined();
    expect(getConversationBackgroundPlaceName(background.id)).toBe("Werner's Lab");
    expect(background.asset).toBe("/location-scenes/werner-lab-interior.webp");
    const { width, height } = readImageHeader(`public${background.asset}`);
    expect({ width, height }).toEqual({ width: 1710, height: 912 });
    expect(width * 8).toBe(height * 15);
    expect(background.alt).not.toMatch(/werner|person|man\b/i);
  });

  it("keeps the unaltered exterior, interior and identifier masters", () => {
    expect(sha256("assets/location-scenes/werner-lab-master.png")).toBe(
      "73d35b87d57e60d2716fd8e61d6d0e98baa9434142661f0d493dd7774d493141",
    );
    expect(sha256("assets/location-scenes/werner-lab-dialogue-interior-master.png")).toBe(
      "26fc34d06e9090369738779aa888b0fd5a863b4d03ad454c36604d5efb4dd6a1",
    );
    expect(sha256("assets/map-icons/werner-lab.png")).toBe(
      "0ae3086c63ae15cf5e2e1b5d87a80cc126e038892c237d3f58f6da4e5a25de03",
    );
  });
});

describe("Werner, the person", () => {
  it("is one resident, standing at the World Location with no Local Place or relocation", () => {
    const npc = getNpc(werner)!;
    expect(npc.displayName).toBe("Werner");
    expect(npc.homeLocationId).toBe(lab);
    expect(npc.localPlaceId).toBeUndefined();
    expect(npc.relocations).toBeUndefined();
    expect(getResidentNpcs({ locationId: lab }).map((resident) => resident.id)).toEqual([werner]);
    // Nobody else stands here, and nobody else hosts Werner.
    expect(
      LOCATIONS.filter((l) => getResidentNpcs({ locationId: l.id }).some((n) => n.id === werner)),
    ).toHaveLength(1);
  });

  it("is there for a character who has completed no Mission at all", () => {
    expect(
      getResidentNpcs({ locationId: lab, completedMissionIds: new Set() }).map((n) => n.id),
    ).toEqual([werner]);
  });

  it("fronts the merchant he sells through", () => {
    expect(getMerchant(merchantId)!.npcId).toBe(werner);
  });
});

describe("Werner's three replayable topics", () => {
  const topics = getNpcConversationTopics(werner);
  const beats = (dialogueId: string) =>
    getDialogue(dialogueId)!.beats.map((beat) =>
      beat.kind === "npc"
        ? { kind: beat.kind, expression: beat.expressionId, text: beat.text }
        : { kind: beat.kind },
    );

  it("offers exactly About the Lab, The Quarry and Gem Cutting, always, in that order", () => {
    expect(topics.map((topic) => topic.label)).toEqual([
      "About the Lab",
      "The Quarry",
      "Gem Cutting",
    ]);
    expect(topics.map((topic) => topic.id)).toEqual([
      CONVERSATION_TOPIC_IDS.wernerAboutTheLab,
      CONVERSATION_TOPIC_IDS.wernerTheQuarry,
      CONVERSATION_TOPIC_IDS.wernerGemCutting,
    ]);
    expect(topics.every((topic) => topic.availability.kind === "always")).toBe(true);
    expect(CONVERSATION_TOPICS.filter((topic) => topic.npcId === werner)).toHaveLength(3);
  });

  it("lists all three with no Mission, first-meeting or unlock entry in the hub", () => {
    const conversation = resolveNpcConversation(werner, [], {
      workOrdersRefreshUnlocked: false,
    });
    expect(conversation.map((entry) => entry.kind)).toEqual(["topic", "topic", "topic"]);
    // A completed-everything character sees the same three.
    const veteran = resolveNpcConversation(
      werner,
      [
        {
          missionId: "keep_the_change",
          status: "completed",
        } as never,
      ],
      { workOrdersRefreshUnlocked: true },
    );
    expect(veteran.map((entry) => entry.kind)).toEqual(["topic", "topic", "topic"]);
  });

  it("speaks About the Lab verbatim, with the approved expressions", () => {
    expect(beats(DIALOGUE_IDS.wernerAboutTheLabTopic)).toEqual([
      {
        kind: "npc",
        expression: EXPRESSION_IDS.neutral,
        text: "It's a mineral laboratory. I would have thought the equipment made that obvious.",
      },
      {
        kind: "npc",
        expression: EXPRESSION_IDS.thoughtful,
        text: "The quarry provides the raw material. I provide the precision. There's a considerable difference.",
      },
      {
        kind: "npc",
        expression: EXPRESSION_IDS.intense,
        text: "And don't touch my equipment. You have no idea what you're handling.",
      },
    ]);
  });

  it("speaks The Quarry verbatim, with the approved expressions", () => {
    expect(beats(DIALOGUE_IDS.wernerTheQuarryTopic)).toEqual([
      {
        kind: "npc",
        expression: EXPRESSION_IDS.neutral,
        text: "Most people walk through that quarry looking for something valuable. They don't understand what they're looking at.",
      },
      {
        kind: "npc",
        expression: EXPRESSION_IDS.thoughtful,
        text: "Every stone has a structure. Every fracture tells you something. You simply have to know how to listen.",
      },
      {
        kind: "npc",
        expression: EXPRESSION_IDS.amused,
        text: "Of course, knowing how to listen is a rare quality.",
      },
    ]);
  });

  it("speaks Gem Cutting verbatim, with the approved expressions", () => {
    expect(beats(DIALOGUE_IDS.wernerGemCuttingTopic)).toEqual([
      {
        kind: "npc",
        expression: EXPRESSION_IDS.thoughtful,
        text: "A gemstone doesn't become valuable because you found it. Its potential was always there.",
      },
      {
        kind: "npc",
        expression: EXPRESSION_IDS.intense,
        text: "One wrong cut and you've destroyed something that took millions of years to form.",
      },
      {
        kind: "npc",
        expression: EXPRESSION_IDS.neutral,
        text: "You can spend a lifetime mastering the cut. The stone will still demand your full attention.",
      },
    ]);
  });

  it("is presentation only: every beat is Werner speaking in his lab, nothing is granted", () => {
    const all = DIALOGUE_SEQUENCES.filter((sequence) =>
      topics.some((topic) => topic.dialogueId === sequence.id),
    );
    expect(all).toHaveLength(3);
    for (const sequence of all) {
      expect(sequence.beats).toHaveLength(3);
      for (const beat of sequence.beats) {
        expect(beat.kind).toBe("npc");
        if (beat.kind !== "npc") continue;
        expect(beat.speakerNpcId).toBe(werner);
        expect(beat.backgroundId).toBe(CONVERSATION_BACKGROUND_IDS.wernersLabInterior);
        expect(beat.presentationMode).toBe("local");
        // Every expression used is one Werner actually has art for.
        expect(resolveNpcExpression(werner, beat.expressionId)).toBeDefined();
      }
      expect(Object.keys(sequence).sort()).toEqual(["beats", "id", "npcId"]);
    }
  });

  it("keeps the signature line for his later introductory Mission", () => {
    const text = DIALOGUE_SEQUENCES.filter((sequence) =>
      topics.some((topic) => topic.dialogueId === sequence.id),
    )
      .flatMap((sequence) => sequence.beats)
      .map((beat) => ("text" in beat ? beat.text : ""))
      .join("\n");
    expect(text).not.toMatch(/one who rocks/i);
  });
});

describe("Werner's mineral merchant", () => {
  const merchant = getMerchant(merchantId)!;
  const bix = getMerchant(MERCHANT_IDS.bixWeller)!;
  const price = (itemId: string) => merchant.prices.find((line) => line.itemId === itemId);

  it("sells only Stone, at 5 Credits, twelve a character a Pacific day", () => {
    expect(merchantPurchasableItemIds(merchant)).toEqual([ITEM_IDS.stone]);
    expect(merchantRetailPrice(merchantId, ITEM_IDS.stone)).toBe(5);
    expect(merchantDailySellLimit(merchant, ITEM_IDS.stone)).toBe(12);
  });

  it("buys Stone at 2 and the three uncut gems at 8, 18 and 35", () => {
    expect(merchantBuybackPrice(merchantId, ITEM_IDS.stone)).toBe(2);
    expect(merchantBuybackPrice(merchantId, ITEM_IDS.uncutQuartz)).toBe(8);
    expect(merchantBuybackPrice(merchantId, ITEM_IDS.uncutTopaz)).toBe(18);
    expect(merchantBuybackPrice(merchantId, ITEM_IDS.uncutSapphire)).toBe(35);
    expect([...merchantSellableItemIds(merchant)].sort()).toEqual(
      [
        ITEM_IDS.stone,
        ITEM_IDS.cutQuartz,
        ITEM_IDS.uncutQuartz,
        ITEM_IDS.uncutTopaz,
        ITEM_IDS.uncutSapphire,
      ].sort(),
    );
  });

  it("never retails a gem; Cut Quartz has its buyback only", () => {
    for (const itemId of [ITEM_IDS.uncutQuartz, ITEM_IDS.uncutTopaz, ITEM_IDS.uncutSapphire]) {
      expect(price(itemId)?.sellPrice).toBeUndefined();
      expect(price(itemId)?.dailySellLimit).toBeUndefined();
      expect(quoteTrade({ merchant, itemId, direction: "buy", quantity: 1 })).toEqual({
        ok: false,
        reason: "not_traded",
      });
    }
    expect(merchant.prices).toHaveLength(5);
    expect(price(ITEM_IDS.cutQuartz)).toEqual({ itemId: ITEM_IDS.cutQuartz, buyPrice: 16 });
  });

  it("has no Mission, unlock or locked message: anyone who walks in can trade", () => {
    expect(merchant.authorizingMissionId).toBeUndefined();
    expect(merchant.requiredCompletedMissionId).toBeUndefined();
    expect(merchant.lockedMessage).toBeUndefined();
  });

  it("leaves Bix's uncut-gem buybacks exactly as they were", () => {
    const bixLine = (itemId: string) => bix.prices.find((line) => line.itemId === itemId);
    expect(bixLine(ITEM_IDS.uncutQuartz)).toEqual({ itemId: ITEM_IDS.uncutQuartz, buyPrice: 8 });
    expect(bixLine(ITEM_IDS.uncutTopaz)).toEqual({ itemId: ITEM_IDS.uncutTopaz, buyPrice: 18 });
    expect(bixLine(ITEM_IDS.uncutSapphire)).toEqual({
      itemId: ITEM_IDS.uncutSapphire,
      buyPrice: 35,
    });
    expect(bixLine(ITEM_IDS.stone)).toBeUndefined();
  });

  it("quotes a Stone purchase at 5 Credits each and a sale at 2, from the registry alone", () => {
    expect(
      quoteTrade({ merchant, itemId: ITEM_IDS.stone, direction: "buy", quantity: 12 }),
    ).toEqual({
      ok: true,
      quote: {
        itemId: ITEM_IDS.stone,
        direction: "buy",
        unitPrice: 5,
        quantity: 12,
        totalCredits: 60,
      },
    });
    expect(
      quoteTrade({ merchant, itemId: ITEM_IDS.stone, direction: "sell", quantity: 7 }),
    ).toEqual({
      ok: true,
      quote: {
        itemId: ITEM_IDS.stone,
        direction: "sell",
        unitPrice: 2,
        quantity: 7,
        totalCredits: 14,
      },
    });
  });

  it("allows exactly 12 Stone a day: the 12th is the last, the 13th has no allowance", () => {
    expect(dailyPurchaseAllowance(12, 0)).toEqual({ limit: 12, purchased: 0, remaining: 12 });
    expect(dailyPurchaseAllowance(12, 11)).toEqual({ limit: 12, purchased: 11, remaining: 1 });
    expect(dailyPurchaseAllowance(12, 12)).toEqual({ limit: 12, purchased: 12, remaining: 0 });
    expect(
      merchantDailyAllowances(
        [merchant],
        [{ merchantId, itemId: ITEM_IDS.stone, quantityPurchased: 12 }],
      ),
    ).toEqual({
      [merchantId]: { [ITEM_IDS.stone]: { limit: 12, purchased: 12, remaining: 0 } },
    });
  });

  it("limits the Trade preview by the allowance, funds and room, never by selling back", () => {
    const stone = getItemDefinition(ITEM_IDS.stone)!;
    if (stone.kind !== "stack") throw new Error("Stone is a stackable item");
    const common = {
      unitPrice: 5,
      existingStacks: [],
      itemId: ITEM_IDS.stone,
      stackLimit: stone.stackLimit,
      availableSlots: 10,
      availableWeight: 1_000_000,
      itemWeight: stone.massGrams,
    };
    expect(maximumPurchasableQuantity({ ...common, credits: 1_000, dailyRemaining: 12 })).toBe(12);
    expect(maximumPurchasableQuantity({ ...common, credits: 1_000, dailyRemaining: 1 })).toBe(1);
    expect(maximumPurchasableQuantity({ ...common, credits: 1_000, dailyRemaining: 0 })).toBe(0);
    expect(maximumPurchasableQuantity({ ...common, credits: 24, dailyRemaining: 12 })).toBe(4);
    // Selling Stone back is not an input: the remaining allowance is only ever the
    // limit minus units bought.
    expect(dailyPurchaseAllowance(12, 12).remaining).toBe(0);
  });
});

describe("the Stillreach Beginner Echo pool with Werner's Lab (#429)", () => {
  const pool = BEGINNER_ECHO_TARGET_POOLS[PLANET_IDS.stillreach];

  function drawing(index: number): EchoRandom {
    return {
      nextInteger: (max) => {
        expect(max).toBe(pool.length);
        return index;
      },
    };
  }

  it("is the original eight plus Werner's Lab, nine in all, with no duplicates", () => {
    expect(pool).toHaveLength(9);
    expect(new Set(pool).size).toBe(9);
    expect(pool[pool.length - 1]).toBe(lab);
    expect([...pool].sort()).toEqual([...LOCAL_MAP_LOCATION_IDS_BY_PLANET.stillreach].sort());
    expect(() => validateEchoHuntContent()).not.toThrow();
  });

  it("chooses uniformly across all nine, so Werner's Lab can be the hidden target", () => {
    const chosen = pool.map((_, index) => selectEchoTarget(pool, drawing(index)));
    expect(chosen).toEqual([...pool]);
    expect(chosen).toContain(lab);
    expect(() => selectEchoTarget(pool, { nextInteger: () => 9 })).toThrow(RangeError);
  });

  it("leaves Skatboll's ten-location pool untouched", () => {
    const skatboll = BEGINNER_ECHO_TARGET_POOLS[PLANET_IDS.skatboll];
    expect(skatboll).toHaveLength(10);
    expect(skatboll).not.toContain(lab);
    expect(skatboll).not.toContain(LOCATION_IDS.deepJag);
  });

  const SEEKER = ITEM_IDS.beginnerEchoSeeker;
  const seekerStack = [{ itemId: SEEKER, quantity: 1 }] as never;
  const snapshot = (currentLocationId: string, target?: string) => ({
    currentLocationId,
    stacks: seekerStack,
    slotsAvailable: 10,
    massAvailableGrams: 50_000,
    ...(target ? { hunt: { targetLocationId: target } } : {}),
  });
  const noDraws: EchoRandom = {
    nextInteger: () => {
      throw new Error("Nothing may be drawn");
    },
  };

  it("lets a Seeker be used at the lab to start a hunt, and a hunt there be found", () => {
    // Starting at the lab: the first draw picks any of nine; a wrong pick points away.
    const started = resolveEchoReading({
      snapshot: snapshot(lab),
      random: {
        nextInteger: (max) => {
          expect(max).toBe(9);
          return 0; // the Landing Station
        },
      },
    });
    expect(started).toMatchObject({
      kind: "wrong",
      planetId: PLANET_IDS.stillreach,
      sourceLocationId: lab,
      startedTargetLocationId: LOCATION_IDS.stillreachLandingStation,
    });
    // A persisted target of the lab, read at the lab, is the discovery.
    const found = resolveEchoReading({
      snapshot: snapshot(lab, lab),
      random: { nextInteger: () => 0 },
    });
    expect(found.kind).toBe("found");
    expect(found).toMatchObject({ planetId: PLANET_IDS.stillreach, sourceLocationId: lab });
  });

  it("starts a hunt whose hidden target is Werner's Lab, read from another location", () => {
    const labIndex = pool.indexOf(lab);
    const wrong = resolveEchoReading({
      snapshot: snapshot(LOCATION_IDS.prospectingQuarry),
      random: {
        nextInteger: () => labIndex,
      },
    });
    expect(wrong).toMatchObject({
      kind: "wrong",
      startedTargetLocationId: lab,
      // (1,1) -> (1,2): same column, one row south.
      directions: { eastWest: "aligned", northSouth: "south" },
    });
  });

  it("keeps a hunt's persisted target: reading elsewhere never rerolls, so old hunts stay intact", () => {
    const old = LOCATION_IDS.theLowHum;
    const reading = resolveEchoReading({
      snapshot: snapshot(lab, old),
      random: noDraws,
    });
    expect(reading).toMatchObject({
      kind: "wrong",
      sourceLocationId: lab,
      directions: echoReadingDirections(lab, old),
    });
    expect(reading).not.toHaveProperty("startedTargetLocationId");
  });

  it("reads compass directions to and from the lab on the map's own axes", () => {
    // Lab (1,2): east 1, south 5. The Quarry (1,1): south 3. The Survey Line (2,1): east 2, south 4.
    expect(echoReadingDirections(lab, LOCATION_IDS.prospectingQuarry)).toEqual({
      eastWest: "aligned",
      northSouth: "north",
    });
    expect(echoReadingDirections(LOCATION_IDS.prospectingQuarry, lab)).toEqual({
      eastWest: "aligned",
      northSouth: "south",
    });
    expect(echoReadingDirections(lab, LOCATION_IDS.theSurveyLine)).toEqual({
      eastWest: "east",
      northSouth: "north",
    });
    expect(echoReadingDirections(LOCATION_IDS.harmonicWorkings, lab)).toEqual({
      eastWest: "west",
      northSouth: "north",
    });
    expect(echoReadingDirections(lab, LOCATION_IDS.stillreachLandingStation)).toEqual({
      eastWest: "west",
      northSouth: "north",
    });
  });

  it("rules the lab in or out of a clue from other hexes, read-only and without revealing a target", () => {
    // A wrong reading at the Quarry that says "south": the lab is consistent, and so is
    // every hex due south of it; the Landing Station (north-west of the Quarry) is out.
    const south = { eastWest: "aligned", northSouth: "south" } as const;
    expect(
      checkEchoClue({
        sourceLocationId: LOCATION_IDS.prospectingQuarry,
        directions: south,
        currentLocationId: lab,
      }),
    ).toEqual({ eastWestConflict: false, northSouthConflict: false, ruledOut: false });
    expect(
      checkEchoClue({
        sourceLocationId: LOCATION_IDS.prospectingQuarry,
        directions: south,
        currentLocationId: LOCATION_IDS.stillreachLandingStation,
      }).ruledOut,
    ).toBe(true);
    // A wrong reading at the lab is always ruled out for the lab itself.
    expect(
      checkEchoClue({
        sourceLocationId: lab,
        directions: { eastWest: "east", northSouth: "aligned" },
        currentLocationId: lab,
      }).ruledOut,
    ).toBe(true);
    // And a clue taken at the lab rules out the hexes it contradicts.
    expect(
      checkEchoClue({
        sourceLocationId: lab,
        directions: { eastWest: "west", northSouth: "north" },
        currentLocationId: LOCATION_IDS.theSurveyLine,
      }).ruledOut,
    ).toBe(true);
  });
});
