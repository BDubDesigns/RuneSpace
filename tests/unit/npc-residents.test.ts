import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CONVERSATION_BACKGROUND_IDS,
  DIALOGUE_IDS,
  LOCAL_PLACE_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  NPC_IDS,
  type NpcId,
} from "@/game/config/foundations";
import { getLocalPlaceInLocation } from "@/game/content/local-places";
import {
  NPCS,
  getNpc,
  getResidentNpcs,
  resolveNpcPlacement,
  resolveNpcVenueBackgroundId,
  type NpcDefinition,
} from "@/game/content/npcs";
import { ResidentContacts, type ResidentContact } from "@/features/npc/NpcInteractionPanel";

// The rows import the Talk and Trade surfaces, which import server actions.
// Nothing here opens either surface, so no action is ever reached; stubbing
// the module only keeps a database environment out of a pure render test.
vi.mock("@/server/actions", () => ({}));

/**
 * Issue #231: several residents can share one exact spatial context, and one
 * NPC can move through an ordered sequence of Mission-derived placements.
 *
 * The synthetic NPCs below exist only to prove the rules. They reuse real
 * location, Local Place, and Mission identities because those are typed
 * content IDs, but none of them is authored content and none is in the roster.
 */

const REPOSITORY_ROOT = resolve(__dirname, "../..");

function synthetic(
  id: string,
  placement: Pick<NpcDefinition, "homeLocationId" | "localPlaceId" | "relocations">,
): NpcDefinition {
  return {
    id: id as NpcId,
    displayName: `Synthetic ${id}`,
    role: "Test resident",
    ...placement,
  };
}

const ids = (npcs: readonly NpcDefinition[]) => npcs.map((npc) => npc.id);

// Home at A; after Mission X at B; after the later-authored Mission Y back at A.
const A = LOCATION_IDS.theJag;
const B = LOCATION_IDS.ruskRecovery;
const C = LOCATION_IDS.crashSite;
const X = MISSION_IDS.walkItOff;
const Y = MISSION_IDS.cutYourTeeth;
const UNRELATED = MISSION_IDS.holdItTogether;

const traveller = synthetic("traveller", {
  homeLocationId: A,
  relocations: [
    {
      afterCompletedMissionId: X,
      locationId: B,
      conversationBackgroundId: CONVERSATION_BACKGROUND_IDS.ruskRecoveryYard,
    },
    { afterCompletedMissionId: Y, locationId: A },
  ],
});

describe("issue #231 ordered Mission-derived placement", () => {
  it("resolves an NPC with no relocations to home, whatever is complete", () => {
    const homebody = synthetic("homebody", { homeLocationId: C });
    expect(resolveNpcPlacement(homebody)).toEqual({ locationId: C });
    expect(resolveNpcPlacement(homebody, new Set([X, Y, UNRELATED]))).toEqual({ locationId: C });
  });

  it("applies one completed relocation", () => {
    expect(resolveNpcPlacement(traveller, new Set())).toEqual({ locationId: A });
    expect(resolveNpcPlacement(traveller, new Set([X]))).toEqual({ locationId: B });
  });

  it("lets a later authored relocation override an earlier one, including back home", () => {
    expect(resolveNpcPlacement(traveller, new Set([X, Y]))).toEqual({ locationId: A });
    // Authored order decides, not which Mission is named first in the set.
    expect(resolveNpcPlacement(traveller, new Set([Y, X]))).toEqual({ locationId: A });
    const onward = synthetic("onward", {
      homeLocationId: A,
      relocations: [
        { afterCompletedMissionId: X, locationId: B },
        { afterCompletedMissionId: Y, locationId: C },
      ],
    });
    expect(resolveNpcPlacement(onward, new Set([X]))).toEqual({ locationId: B });
    expect(resolveNpcPlacement(onward, new Set([X, Y]))).toEqual({ locationId: C });
  });

  it("uses the latest applicable entry even when an earlier one is not complete", () => {
    expect(resolveNpcPlacement(traveller, new Set([Y]))).toEqual({ locationId: A });
    const skipper = synthetic("skipper", {
      homeLocationId: A,
      relocations: [
        { afterCompletedMissionId: X, locationId: B },
        { afterCompletedMissionId: Y, locationId: C },
      ],
    });
    expect(resolveNpcPlacement(skipper, new Set([Y]))).toEqual({ locationId: C });
  });

  it("ignores completed Missions that no relocation names", () => {
    expect(resolveNpcPlacement(traveller, new Set([UNRELATED]))).toEqual({ locationId: A });
    expect(resolveNpcPlacement(traveller, new Set([X, UNRELATED]))).toEqual({ locationId: B });
  });

  it("keeps Local Place placement exact through a relocation", () => {
    const shopkeeper = synthetic("shopkeeper", {
      homeLocationId: LOCATION_IDS.holoHollow,
      relocations: [
        {
          afterCompletedMissionId: X,
          locationId: LOCATION_IDS.holoHollow,
          localPlaceId: LOCAL_PLACE_IDS.holoHollowSouvenirs,
        },
        { afterCompletedMissionId: Y, locationId: LOCATION_IDS.holoHollow },
      ],
    });
    expect(resolveNpcPlacement(shopkeeper, new Set([X]))).toEqual({
      locationId: LOCATION_IDS.holoHollow,
      localPlaceId: LOCAL_PLACE_IDS.holoHollowSouvenirs,
    });
    // Moving back out to the World Location carries no stale Local Place.
    expect(resolveNpcPlacement(shopkeeper, new Set([X, Y]))).toEqual({
      locationId: LOCATION_IDS.holoHollow,
    });
    const roster = [shopkeeper];
    const inTown = { locationId: LOCATION_IDS.holoHollow, roster };
    const inShop = { ...inTown, localPlaceId: LOCAL_PLACE_IDS.holoHollowSouvenirs };
    expect(ids(getResidentNpcs({ ...inShop, completedMissionIds: new Set([X]) }))).toEqual([
      shopkeeper.id,
    ]);
    expect(getResidentNpcs({ ...inTown, completedMissionIds: new Set([X]) })).toEqual([]);
    expect(getResidentNpcs({ ...inShop, completedMissionIds: new Set([X, Y]) })).toEqual([]);
    expect(ids(getResidentNpcs({ ...inTown, completedMissionIds: new Set([X, Y]) }))).toEqual([
      shopkeeper.id,
    ]);
  });

  it("derives the present-tense venue from the same relocation", () => {
    const yard = CONVERSATION_BACKGROUND_IDS.ruskRecoveryYard;
    const jag = CONVERSATION_BACKGROUND_IDS.theJagExterior;
    const withVenue = { ...traveller, conversationBackgroundId: jag };
    expect(resolveNpcVenueBackgroundId(withVenue, new Set())).toBe(jag);
    expect(resolveNpcVenueBackgroundId(withVenue, new Set([X]))).toBe(yard);
    // The later entry authors no venue of its own, so the NPC's own applies.
    expect(resolveNpcVenueBackgroundId(withVenue, new Set([X, Y]))).toBe(jag);
  });
});

describe("issue #231 Wade's migrated relocation", () => {
  const wade = getNpc(NPC_IDS.wadeRusk)!;

  it("authors exactly the one move he already had", () => {
    expect(wade.homeLocationId).toBe(LOCATION_IDS.crashSite);
    expect(wade.localPlaceId).toBeUndefined();
    expect(wade.relocations).toEqual([
      {
        afterCompletedMissionId: MISSION_IDS.keepTheChange,
        locationId: LOCATION_IDS.ruskRecovery,
        conversationBackgroundId: CONVERSATION_BACKGROUND_IDS.ruskRecoveryYard,
      },
    ]);
  });

  it("is at the Crash Site before Keep the Change and at Rusk Recovery after", () => {
    const allButKeepTheChange = new Set(
      Object.values(MISSION_IDS).filter((id) => id !== MISSION_IDS.keepTheChange),
    );
    expect(resolveNpcPlacement(wade, new Set())).toEqual({ locationId: LOCATION_IDS.crashSite });
    expect(resolveNpcPlacement(wade, allButKeepTheChange)).toEqual({
      locationId: LOCATION_IDS.crashSite,
    });
    expect(resolveNpcPlacement(wade, new Set([MISSION_IDS.keepTheChange]))).toEqual({
      locationId: LOCATION_IDS.ruskRecovery,
    });
    expect(resolveNpcPlacement(wade, new Set(Object.values(MISSION_IDS)))).toEqual({
      locationId: LOCATION_IDS.ruskRecovery,
    });
    expect(resolveNpcVenueBackgroundId(wade, allButKeepTheChange)).toBe(
      CONVERSATION_BACKGROUND_IDS.crashSiteExterior,
    );
    expect(resolveNpcVenueBackgroundId(wade, new Set([MISSION_IDS.keepTheChange]))).toBe(
      CONVERSATION_BACKGROUND_IDS.ruskRecoveryYard,
    );
  });

  it("is the sole resident of wherever he stands", () => {
    const after = new Set([MISSION_IDS.keepTheChange]);
    expect(ids(getResidentNpcs({ locationId: LOCATION_IDS.crashSite }))).toEqual([wade.id]);
    expect(getResidentNpcs({ locationId: LOCATION_IDS.ruskRecovery })).toEqual([]);
    expect(
      getResidentNpcs({ locationId: LOCATION_IDS.crashSite, completedMissionIds: after }),
    ).toEqual([]);
    expect(
      ids(getResidentNpcs({ locationId: LOCATION_IDS.ruskRecovery, completedMissionIds: after })),
    ).toEqual([wade.id]);
  });
});

describe("issue #231 Tansy stays where she ships", () => {
  it("authors no relocation and stays at The Jag whatever is complete", () => {
    const tansy = getNpc(NPC_IDS.tansyRusk)!;
    expect(tansy.relocations).toBeUndefined();
    const everything = new Set(Object.values(MISSION_IDS));
    expect(resolveNpcPlacement(tansy, everything)).toEqual({ locationId: LOCATION_IDS.theJag });
    expect(
      ids(getResidentNpcs({ locationId: LOCATION_IDS.theJag, completedMissionIds: everything })),
    ).toEqual([tansy.id]);
    expect(
      getResidentNpcs({ locationId: LOCATION_IDS.ruskRecovery, completedMissionIds: everything })
        .map((npc) => npc.id)
        .includes(tansy.id),
    ).toBe(false);
  });
});

describe("issue #231 ordered resident sets", () => {
  const first = synthetic("first", { homeLocationId: B });
  const second = synthetic("second", { homeLocationId: B });
  const inside = synthetic("inside", {
    homeLocationId: LOCATION_IDS.holoHollow,
    localPlaceId: LOCAL_PLACE_IDS.holoHollowSouvenirs,
  });
  const alsoInside = synthetic("also-inside", {
    homeLocationId: LOCATION_IDS.holoHollow,
    localPlaceId: LOCAL_PLACE_IDS.holoHollowSouvenirs,
  });
  const nextDoor = synthetic("next-door", {
    homeLocationId: LOCATION_IDS.holoHollow,
    localPlaceId: LOCAL_PLACE_IDS.holoHollowAssistanceCenter,
  });
  const inTown = synthetic("in-town", { homeLocationId: LOCATION_IDS.holoHollow });
  const roster = [first, inside, nextDoor, second, inTown, alsoInside];

  it("returns nobody for a context nobody occupies", () => {
    expect(getResidentNpcs({ locationId: C, roster })).toEqual([]);
  });

  it("returns every resident of one World Location in authored roster order", () => {
    expect(ids(getResidentNpcs({ locationId: B, roster }))).toEqual([first.id, second.id]);
    // The roster's order is the order — not identity, name, or arrival.
    expect(ids(getResidentNpcs({ locationId: B, roster: [second, first] }))).toEqual([
      second.id,
      first.id,
    ]);
  });

  it("returns every resident of one Local Place in authored roster order", () => {
    expect(
      ids(
        getResidentNpcs({
          locationId: LOCATION_IDS.holoHollow,
          localPlaceId: LOCAL_PLACE_IDS.holoHollowSouvenirs,
          roster,
        }),
      ),
    ).toEqual([inside.id, alsoInside.id]);
  });

  it("keeps World Location and Local Place scopes from bleeding into each other", () => {
    expect(ids(getResidentNpcs({ locationId: LOCATION_IDS.holoHollow, roster }))).toEqual([
      inTown.id,
    ]);
    expect(
      ids(
        getResidentNpcs({
          locationId: LOCATION_IDS.holoHollow,
          localPlaceId: LOCAL_PLACE_IDS.holoHollowAssistanceCenter,
          roster,
        }),
      ),
    ).toEqual([nextDoor.id]);
    // The same Local Place id under another World Location matches nobody.
    expect(
      getResidentNpcs({
        locationId: B,
        localPlaceId: LOCAL_PLACE_IDS.holoHollowSouvenirs,
        roster,
      }),
    ).toEqual([]);
  });

  it("presents a relocated NPC exactly once, beside whoever already stands there", () => {
    const roster = [traveller, first];
    expect(ids(getResidentNpcs({ locationId: B, roster }))).toEqual([first.id]);
    // After X the traveller is at B too; authored order still decides.
    expect(
      ids(getResidentNpcs({ locationId: B, roster, completedMissionIds: new Set([X]) })),
    ).toEqual([traveller.id, first.id]);
    expect(
      ids(getResidentNpcs({ locationId: A, roster, completedMissionIds: new Set([X, Y]) })),
    ).toEqual([traveller.id]);
  });
});

describe("issue #231 authored roster invariants", () => {
  it("authors each NPC once", () => {
    expect(new Set(NPCS.map((npc) => npc.id)).size).toBe(NPCS.length);
  });

  it("scopes every authored placement to a Local Place of its own World Location", () => {
    for (const npc of NPCS) {
      const placements = [
        { locationId: npc.homeLocationId, localPlaceId: npc.localPlaceId },
        ...(npc.relocations ?? []),
      ];
      for (const placement of placements) {
        if (placement.localPlaceId) {
          expect(
            getLocalPlaceInLocation(placement.locationId, placement.localPlaceId),
            `${npc.id} → ${placement.localPlaceId}`,
          ).toBeDefined();
        }
      }
    }
  });

  it("names each relocation Mission at most once per NPC", () => {
    for (const npc of NPCS) {
      const missions = (npc.relocations ?? []).map((entry) => entry.afterCompletedMissionId);
      expect(new Set(missions).size, npc.id).toBe(missions.length);
    }
  });

  it("persists no NPC placement or relocation state", () => {
    // Placement is derived from durable Mission completion, never stored.
    const forbidden = /relocat|npc_?placement|npc_?location|resident_?npc/i;
    const migrations = readdirSync(resolve(REPOSITORY_ROOT, "drizzle"))
      .filter((file) => file.endsWith(".sql"))
      .map((file) => `drizzle/${file}`);
    const scanned = ["db/rune-space.ts", "server/play.ts", "server/missions.ts", ...migrations];
    const offenders = scanned.filter((relative) =>
      forbidden.test(readFileSync(resolve(REPOSITORY_ROOT, relative), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

describe("issue #231 resident presentation", () => {
  const topic = (npc: NpcDefinition): ResidentContact => ({
    npc,
    entries: [
      {
        kind: "topic",
        id: `${npc.id}-topic`,
        label: "Test topic",
        dialogueId: DIALOGUE_IDS.tansyMiningTopic,
      },
    ],
    turnInAvailable: false,
  });
  const first = topic(synthetic("first", { homeLocationId: B }));
  const second = topic(synthetic("second", { homeLocationId: B }));
  const meta = React.createElement("span", { "data-test-meta": "" }, "Only you here");

  const render = (contacts: readonly ResidentContact[], stationary = true) =>
    renderToStaticMarkup(
      React.createElement(ResidentContacts, { contacts, disabled: false, meta, stationary }),
    );
  const count = (html: string, needle: string) => html.split(needle).length - 1;

  it("renders the place meta alone when nobody is here", () => {
    const html = render([]);
    expect(count(html, "data-npc-interaction")).toBe(0);
    expect(count(html, "data-place-meta")).toBe(1);
    expect(count(html, "data-test-meta")).toBe(1);
  });

  it("renders one resident with the place meta once", () => {
    const html = render([first]);
    expect(count(html, "data-npc-interaction")).toBe(1);
    expect(html).toContain('aria-label="Talk to Synthetic first"');
    expect(count(html, "data-place-meta")).toBe(1);
    expect(count(html, "data-test-meta")).toBe(1);
  });

  it("renders two residents in the given order, each with their own Talk, and the meta once", () => {
    const html = render([first, second]);
    expect(count(html, "data-npc-interaction")).toBe(2);
    expect(count(html, 'data-npc-action="talk"')).toBe(2);
    const firstAt = html.indexOf('data-npc-interaction="first"');
    const secondAt = html.indexOf('data-npc-interaction="second"');
    const metaAt = html.indexOf("data-place-meta");
    expect(firstAt).toBeGreaterThan(-1);
    expect(secondAt).toBeGreaterThan(firstAt);
    // Place context follows the people rather than sitting in one person's row.
    expect(metaAt).toBeGreaterThan(secondAt);
    expect(count(html, "data-place-meta")).toBe(1);
    expect(count(html, "data-test-meta")).toBe(1);
    expect(html.indexOf("data-test-meta")).toBeGreaterThan(html.lastIndexOf("</section>"));

    const reversed = render([second, first]);
    expect(reversed.indexOf('data-npc-interaction="second"')).toBeLessThan(
      reversed.indexOf('data-npc-interaction="first"'),
    );
  });

  it("states the stationary requirement once for the place, not once per person", () => {
    const html = render([first, second], false);
    expect(count(html, "require a stationary character")).toBe(1);
  });
});
