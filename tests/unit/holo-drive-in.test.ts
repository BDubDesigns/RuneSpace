import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONVERSATION_BACKGROUND_IDS,
  CONVERSATION_TOPIC_IDS,
  DIALOGUE_IDS,
  EXPRESSION_IDS,
  LOCATION_IDS,
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
import { getLocationMerchant } from "@/game/content/merchants";
import { getNpc, getResidentNpcs, resolveNpcExpression } from "@/game/content/npcs";
import { resolveNpcConversation } from "@/game/domain/conversation";
import { selectEchoTarget, validateEchoHuntContent } from "@/game/domain/echo-hunts";
import { planTravel } from "@/game/domain/travel";
import { resolveMapIdentifierAsset } from "@/features/travel/local-map-identifiers";
import {
  LOCAL_MAP_GEOMETRY_BY_PLANET,
  getLocalMapGeometryForLocation,
} from "@/features/travel/local-map-layout";
import { readImageHeader } from "./image-header";

/**
 * Issue #491, slice 1 — the Holo Drive-In as a place: its World Location, its resident
 * Tamsyn Suzara, her two launch topics that do not depend on the theatre, the approved
 * art, and its place in the fixed Skatboll Beginner Echo pool.
 *
 * Everything here is derived from the registries without PostgreSQL or a browser. The
 * showings, tickets, buffs and viewer are later slices of #491 and are deliberately not
 * asserted (or implied) here.
 */

const driveIn = LOCATION_IDS.holoDriveIn;
const tamsyn = NPC_IDS.tamsynSuzara;

const sha256 = (path: string) =>
  createHash("sha256")
    .update(readFileSync(join(process.cwd(), path)))
    .digest("hex");

describe("the Holo Drive-In on the Skatboll map", () => {
  const location = getLocation(driveIn)!;

  it("is Skatboll's twelfth World Location at axial (-1, 0), named Holo Drive-In", () => {
    expect(location.displayName).toBe("Holo Drive-In");
    expect(location.planetId).toBe(PLANET_IDS.skatboll);
    expect(location.region).toBe("holo_hollow");
    expect(location.presentation.localMap).toEqual({
      axial: { q: -1, r: 0 },
      label: "Holo Drive-In",
    });
    expect(LOCAL_MAP_LOCATION_IDS_BY_PLANET.skatboll).toHaveLength(12);
    expect(LOCAL_MAP_LOCATION_IDS_BY_PLANET.skatboll).toContain(driveIn);
    expect(LOCATIONS.filter((l) => l.planetId === PLANET_IDS.skatboll)).toHaveLength(12);
  });

  it("sits directly north of Holo Hollow on a hex no other Skatboll location holds", () => {
    const hollow = getLocation(LOCATION_IDS.holoHollow)!.presentation.localMap.axial;
    const here = location.presentation.localMap.axial;
    expect(hollow).toEqual({ q: -1, r: 1 });
    expect({ q: here.q, r: here.r + 1 }).toEqual(hollow);
    const keys = LOCAL_MAP_LOCATION_IDS_BY_PLANET.skatboll.map((id) => {
      const { q, r } = getLocation(id)!.presentation.localMap.axial;
      return `${q},${r}`;
    });
    expect(new Set(keys).size).toBe(12);
    expect(keys.filter((key) => key === "-1,0")).toHaveLength(1);
  });

  it("walks to Holo Hollow, both ways, and nowhere else", () => {
    expect([...location.adjacentLocationIds]).toEqual([LOCATION_IDS.holoHollow]);
    expect(areLocationsAdjacent(driveIn, LOCATION_IDS.holoHollow)).toBe(true);
    expect(areLocationsAdjacent(LOCATION_IDS.holoHollow, driveIn)).toBe(true);
    for (const [from, to] of [
      [driveIn, LOCATION_IDS.holoHollow],
      [LOCATION_IDS.holoHollow, driveIn],
    ] as const) {
      // An ordinary walk: the same plan any other walking edge produces.
      expect(
        planTravel({ currentLocationId: from, destinationLocationId: to, alreadyTraveling: false }),
      ).toMatchObject({ ok: true });
    }
  });

  it("touches the Power Annex and Rusk Recovery on the hex grid but has no route to either", () => {
    // (-1,0) neighbours (0,0) and (-2,1); the registry authors no edge, and nothing is
    // inferred from axial adjacency.
    for (const touching of [LOCATION_IDS.emergencyPowerAnnex, LOCATION_IDS.ruskRecovery]) {
      const axial = getLocation(touching)!.presentation.localMap.axial;
      const dq = axial.q - location.presentation.localMap.axial.q;
      const dr = axial.r - location.presentation.localMap.axial.r;
      expect(Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr))).toBe(1);
      expect(areLocationsAdjacent(driveIn, touching)).toBe(false);
      expect(areLocationsAdjacent(touching, driveIn)).toBe(false);
      expect(getLocation(touching)!.adjacentLocationIds).not.toContain(driveIn);
      for (const [from, to] of [
        [driveIn, touching],
        [touching, driveIn],
      ] as const) {
        expect(
          planTravel({
            currentLocationId: from,
            destinationLocationId: to,
            alreadyTraveling: false,
          }),
        ).toEqual({ ok: false, reason: "not_adjacent" });
      }
    }
    const geometry = LOCAL_MAP_GEOMETRY_BY_PLANET.skatboll;
    const pairs = geometry.undirectedRoutes.map((route) =>
      [route.originLocationId, route.destinationLocationId].sort().join("|"),
    );
    expect(pairs.filter((pair) => pair.includes(driveIn))).toEqual([
      [driveIn, LOCATION_IDS.holoHollow].sort().join("|"),
    ]);
    expect(getLocalMapGeometryForLocation(driveIn)).toBe(geometry);
  });

  it("adds no other edge: no other location gained a walk to it, and Holo Hollow gained only it", () => {
    expect(
      LOCATIONS.filter((l) => l.adjacentLocationIds.includes(driveIn)).map((l) => l.id),
    ).toEqual([LOCATION_IDS.holoHollow]);
    expect([...getLocation(LOCATION_IDS.holoHollow)!.adjacentLocationIds].sort()).toEqual(
      [
        LOCATION_IDS.crashSite,
        LOCATION_IDS.emergencyPowerAnnex,
        LOCATION_IDS.theLongScramble,
        LOCATION_IDS.ruskRecovery,
        driveIn,
      ].sort(),
    );
  });

  it("is open from the start: no gate, no activity, no Local Place, no merchant, no variant", () => {
    expect(location.availableActionIds).toEqual([]);
    expect(location.dormantActivities).toEqual([]);
    expect(location.stateVariants).toEqual([]);
    expect(location.mapStatus).toBeUndefined();
    expect(location.travelable).toBe(true);
    expect(getLocalPlacesForLocation(driveIn)).toEqual([]);
    expect(getLocationMerchant(driveIn)).toBeUndefined();
  });

  it("carries the owner-approved description verbatim, with no em dash", () => {
    expect(location.description).toBe(
      "A towering, weather-beaten movie screen overlooks rows of faded parking lanes, old speeders, and mining crew buses. Warm light spills from the concession stand. The projector may be outdated, but the pictures still run.",
    );
    expect(location.description).not.toMatch(/—/);
  });

  it("shows the committed 4:1 exterior and the map identifier at their real sizes", () => {
    const { scene } = location.presentation;
    expect(scene.asset).toBe("/location-scenes/holo-drive-in.webp");
    expect({ width: scene.width, height: scene.height }).toEqual({ width: 1536, height: 384 });
    expect(scene.width).toBe(scene.height * 4);
    const header = readImageHeader(`public${scene.asset}`);
    expect({ width: header.width, height: header.height }).toEqual({ width: 1536, height: 384 });
    expect(header.container).toBe("VP8 ");

    expect(location.presentation.mapIconKey).toBe("holo_drive_in");
    const icon = resolveMapIdentifierAsset("holo_drive_in");
    expect(icon).toBe("/map-icons/holo-drive-in.webp");
    const iconHeader = readImageHeader(`public${icon}`);
    expect(iconHeader.container).toBe("VP8L");
    expect(iconHeader.hasAlpha ?? true).toBe(true);
    expect(Math.max(iconHeader.width, iconHeader.height)).toBe(512);
  });
});

describe("the Skatboll Beginner Echo pool with the Holo Drive-In (#491)", () => {
  const pool = BEGINNER_ECHO_TARGET_POOLS[PLANET_IDS.skatboll];

  it("grows from ten to eleven by exactly this location, and still excludes Deep Jag", () => {
    expect(pool).toHaveLength(11);
    expect(pool).toContain(driveIn);
    expect(pool).not.toContain(LOCATION_IDS.deepJag);
    expect(new Set(pool).size).toBe(11);
    expect(pool.filter((id) => id !== driveIn).sort()).toEqual(
      LOCATIONS.filter((l) => l.planetId === PLANET_IDS.skatboll)
        .map((l) => l.id)
        .filter((id) => id !== driveIn && id !== LOCATION_IDS.deepJag)
        .sort(),
    );
    expect(() => validateEchoHuntContent()).not.toThrow();
  });

  it("is chosen uniformly across all eleven, so the Drive-In can be the hidden target", () => {
    const drawing = (index: number) => ({ nextInteger: () => index });
    const chosen = pool.map((_, index) => selectEchoTarget(pool, drawing(index)));
    expect(chosen).toEqual([...pool]);
    expect(chosen).toContain(driveIn);
    expect(() => selectEchoTarget(pool, { nextInteger: () => 11 })).toThrow(RangeError);
  });

  it("leaves Stillreach's pool alone", () => {
    expect(BEGINNER_ECHO_TARGET_POOLS[PLANET_IDS.stillreach]).toHaveLength(9);
    expect(BEGINNER_ECHO_TARGET_POOLS[PLANET_IDS.stillreach]).not.toContain(driveIn);
  });
});

describe("approved art", () => {
  const expressions = ["neutral", "welcoming", "amused", "wistful"] as const;
  const portraitMasters: Record<
    (typeof expressions)[number],
    { sha256: string; width: number; height: number }
  > = {
    neutral: {
      sha256: "e0b034a366b005aa95c1036397b875959b7c9dd9fa30359c248449d6f029965b",
      width: 1086,
      height: 1448,
    },
    welcoming: {
      sha256: "3e3fa5f4eaf43fef0cb99745a27d45ca5674cf76cf02c8490bf93b1286fc6d01",
      width: 1087,
      height: 1447,
    },
    amused: {
      sha256: "4b285e58e92046739cc782bf00ff1095126ad590f6213f855893e2105d462404",
      width: 1087,
      height: 1446,
    },
    wistful: {
      sha256: "6e1671e17b1f945a4da84f86654ef0f1aa99940f04a1607b77ecf1a0dc023256",
      width: 1088,
      height: 1446,
    },
  };

  it("maps the four approved portraits onto Tamsyn's expressions on one shared canvas", () => {
    const assets = getNpc(tamsyn)!.expressionAssets!;
    expect(Object.keys(assets).sort()).toEqual(
      expressions.map((expression) => EXPRESSION_IDS[expression]).sort(),
    );
    for (const expression of expressions) {
      const asset = assets[EXPRESSION_IDS[expression]]!;
      expect(asset).toBe(`/npc-art/tamsyn-suzara-${expression}.png`);
      expect(resolveNpcExpression(tamsyn, expression)).toBe(asset);
      const header = readImageHeader(`public${asset}`);
      expect(header.container).toBe("png");
      expect({ width: header.width, height: header.height }).toEqual({ width: 400, height: 500 });
      const master = `assets/npc-art/tamsyn-suzara/tamsyn-suzara-${expression}-master.png`;
      const expected = portraitMasters[expression];
      expect(sha256(master)).toBe(expected.sha256);
      const masterHeader = readImageHeader(master);
      expect({ width: masterHeader.width, height: masterHeader.height }).toEqual({
        width: expected.width,
        height: expected.height,
      });
    }
  });

  it("keeps every portrait transparent", () => {
    for (const expression of expressions) {
      const buffer = readFileSync(
        join(process.cwd(), `public/npc-art/tamsyn-suzara-${expression}.png`),
      );
      // IHDR colour type 6 is RGBA.
      expect(buffer[25], expression).toBe(6);
    }
  });

  it("talks against the dedicated people-free 15:8 concession stand, labelled by the Drive-In", () => {
    const background = getConversationBackground(
      CONVERSATION_BACKGROUND_IDS.holoDriveInConcessions,
    )!;
    expect(getNpc(tamsyn)!.conversationBackgroundId).toBe(background.id);
    expect(background.locationId).toBe(driveIn);
    expect(background.localPlaceId).toBeUndefined();
    expect(getConversationBackgroundPlaceName(background.id)).toBe("Holo Drive-In");
    expect(background.asset).toBe("/location-scenes/holo-drive-in-concessions.webp");
    const { width, height } = readImageHeader(`public${background.asset}`);
    expect({ width, height }).toEqual({ width: 1665, height: 888 });
    expect(width * 8).toBe(height * 15);
    expect(background.alt).not.toMatch(/tamsyn|person|woman|man\b/i);
    // The 4:1 exterior is the location's own scene and is not reused for dialogue.
    expect(background.asset).not.toBe(getLocation(driveIn)!.presentation.scene.asset);
  });

  it("keeps the unaltered exterior, concession stand and identifier masters", () => {
    expect(sha256("assets/location-scenes/holo-drive-in-master.png")).toBe(
      "089aaf5faadd37aa67cb6bc9428c7a2180dc363dafe91912d3c35b2a90882e0a",
    );
    expect(sha256("assets/location-scenes/holo-drive-in-concessions-master.png")).toBe(
      "3c9f2e25fda875f154314b7c16ee1b98a9396f5ad5dfb7d7cfadb7a3733fbe8d",
    );
    expect(sha256("assets/map-icons/holo-drive-in.png")).toBe(
      "d0710c55331f9fd05a6b28d08eb98a930ec4d70b76d96d2201b53f7fe551b7d9",
    );
  });
});

describe("Tamsyn Suzara, the person", () => {
  it("is one resident, standing at the World Location with no Local Place or relocation", () => {
    const npc = getNpc(tamsyn)!;
    expect(npc.displayName).toBe("Tamsyn Suzara");
    expect(npc.role).toBe("Holo Drive-In owner & operator");
    expect(npc.homeLocationId).toBe(driveIn);
    expect(npc.localPlaceId).toBeUndefined();
    expect(npc.relocations).toBeUndefined();
    expect(getResidentNpcs({ locationId: driveIn }).map((resident) => resident.id)).toEqual([
      tamsyn,
    ]);
    expect(
      LOCATIONS.filter((l) => getResidentNpcs({ locationId: l.id }).some((n) => n.id === tamsyn)),
    ).toHaveLength(1);
  });

  it("is there for a character who has completed no Mission at all", () => {
    expect(
      getResidentNpcs({ locationId: driveIn, completedMissionIds: new Set() }).map((n) => n.id),
    ).toEqual([tamsyn]);
  });

  it("uses her public name everywhere, never the nickname reserved for close friends", () => {
    const text = [
      getNpc(tamsyn)!.displayName,
      getNpc(tamsyn)!.role,
      ...getNpcConversationTopics(tamsyn).map((topic) => topic.label),
      ...DIALOGUE_SEQUENCES.filter((sequence) => sequence.npcId === tamsyn)
        .flatMap((sequence) => sequence.beats)
        .map((beat) => ("text" in beat ? beat.text : "")),
    ].join("\n");
    expect(text).not.toMatch(/\bTamsy\b/);
  });
});

describe("Tamsyn's launch topics", () => {
  const topics = getNpcConversationTopics(tamsyn);
  const beats = (dialogueId: string) =>
    getDialogue(dialogueId)!.beats.map((beat) =>
      beat.kind === "npc"
        ? { kind: beat.kind, expression: beat.expressionId, text: beat.text }
        : { kind: beat.kind },
    );

  it("offers Tell me about the projector and Why keep this place open?, always, in that order", () => {
    expect(topics.map((topic) => topic.label)).toEqual([
      "Tell me about the projector",
      "Why keep this place open?",
    ]);
    expect(topics.map((topic) => topic.id)).toEqual([
      CONVERSATION_TOPIC_IDS.tamsynAboutTheProjector,
      CONVERSATION_TOPIC_IDS.tamsynWhyKeepItOpen,
    ]);
    expect(topics.every((topic) => topic.availability.kind === "always")).toBe(true);
    expect(CONVERSATION_TOPICS.filter((topic) => topic.npcId === tamsyn)).toHaveLength(2);
  });

  it("creates no farewell topic: Back and Finish already end every conversation", () => {
    const labels = CONVERSATION_TOPICS.filter((topic) => topic.npcId === tamsyn).map((topic) =>
      topic.label.toLowerCase(),
    );
    expect(labels.join("\n")).not.toMatch(/see you|goodbye|farewell|bye\b/);
  });

  it("lists both with no Mission, first-meeting or unlock entry in the hub", () => {
    const conversation = resolveNpcConversation(tamsyn, [], {
      workOrdersRefreshUnlocked: false,
    });
    expect(conversation.map((entry) => entry.kind)).toEqual(["topic", "topic"]);
    const veteran = resolveNpcConversation(
      tamsyn,
      [{ missionId: "keep_the_change", status: "completed" } as never],
      { workOrdersRefreshUnlocked: true },
    );
    expect(veteran.map((entry) => entry.kind)).toEqual(["topic", "topic"]);
  });

  it("speaks Tell me about the projector verbatim, with the approved per-beat expressions", () => {
    expect(beats(DIALOGUE_IDS.tamsynAboutTheProjectorTopic)).toEqual([
      {
        kind: "npc",
        expression: EXPRESSION_IDS.neutral,
        text: "Oh, that old girl? She's been here longer than some of the buildings in the Hollow.",
      },
      {
        kind: "npc",
        expression: EXPRESSION_IDS.amused,
        text: "She still runs beautifully. Well, she runs. Beautifully is a matter of opinion.",
      },
      {
        kind: "npc",
        expression: EXPRESSION_IDS.neutral,
        text: "Can't play the newer film formats, mind you. But the old pictures? Those she knows by heart.",
      },
    ]);
  });

  it("speaks Why keep this place open? verbatim, with the approved per-beat expressions", () => {
    expect(beats(DIALOGUE_IDS.tamsynWhyKeepItOpenTopic)).toEqual([
      {
        kind: "npc",
        expression: EXPRESSION_IDS.neutral,
        text: "Used to get visitors from all over. Whole families coming out to the Hollow just for a night at the pictures.",
      },
      {
        kind: "npc",
        expression: EXPRESSION_IDS.wistful,
        text: "Then the new films stopped coming. The crowds followed.",
      },
      {
        kind: "npc",
        expression: EXPRESSION_IDS.wistful,
        text: "But there's still the regulars. Families, workers finishing a long shift, people who just want to forget about everything for a little while.",
      },
      {
        kind: "npc",
        expression: EXPRESSION_IDS.welcoming,
        text: "Because people still come to watch them. Isn't that reason enough?",
      },
    ]);
  });

  it("is presentation only: every beat is Tamsyn speaking at her stand, nothing is granted", () => {
    const all = DIALOGUE_SEQUENCES.filter((sequence) =>
      topics.some((topic) => topic.dialogueId === sequence.id),
    );
    expect(all).toHaveLength(2);
    for (const sequence of all) {
      for (const beat of sequence.beats) {
        expect(beat.kind).toBe("npc");
        if (beat.kind !== "npc") continue;
        expect(beat.speakerNpcId).toBe(tamsyn);
        expect(beat.backgroundId).toBe(CONVERSATION_BACKGROUND_IDS.holoDriveInConcessions);
        expect(beat.presentationMode).toBe("local");
        // Every expression used is one Tamsyn actually has art for.
        expect(resolveNpcExpression(tamsyn, beat.expressionId)).toBeDefined();
        expect(beat.text).not.toMatch(/—/);
      }
      expect(Object.keys(sequence).sort()).toEqual(["beats", "id", "npcId"]);
    }
  });

  it("changes expression with the emotional beat, never one expression for a whole topic", () => {
    const used = (dialogueId: string) =>
      new Set(
        getDialogue(dialogueId)!.beats.map((beat) =>
          beat.kind === "npc" ? beat.expressionId : "",
        ),
      );
    expect(used(DIALOGUE_IDS.tamsynAboutTheProjectorTopic).size).toBe(2);
    expect(used(DIALOGUE_IDS.tamsynWhyKeepItOpenTopic).size).toBe(3);
  });

  it("keeps the theatre out of these topics: no ticket, price, buff or showing is promised yet", () => {
    const text = DIALOGUE_SEQUENCES.filter((sequence) =>
      topics.some((topic) => topic.dialogueId === sequence.id),
    )
      .flatMap((sequence) => sequence.beats)
      .map((beat) => ("text" in beat ? beat.text : ""))
      .join("\n");
    expect(text).not.toMatch(/ticket|credit|bonus|attempt|showing|tansy|savings/i);
  });
});
