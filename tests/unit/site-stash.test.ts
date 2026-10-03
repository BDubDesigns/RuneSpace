import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance, getRepairTargetBalance } from "@/game/config/balance";
import { GAME_TICK_MS, ITEM_IDS, LOCATION_IDS, REPAIR_TARGET_IDS } from "@/game/config/foundations";
import { LOCATIONS } from "@/game/content/locations";
import { REPAIR_TARGETS, getRepairTarget } from "@/game/content/repair-targets";
import { SITE_STASHES, getSiteStash } from "@/game/content/site-stashes";
import { cleanPassOpportunityCount } from "@/game/domain/clean-pass";
import { validateRepairTargets } from "@/game/domain/repair-targets";
import {
  planSiteStashRemoval,
  planSiteStashSwap,
  siteStashSlotCapacity,
  type CarriedRoom,
} from "@/game/domain/site-stash";
import { MISSIONS } from "@/game/content/missions";

const balance = getEffectiveGameBalance();

/** Roomy carried Inventory by default; each test narrows what it is about. */
function room(overrides: Partial<CarriedRoom> = {}): CarriedRoom {
  return {
    inventorySlotsUsed: 2,
    slotCapacity: 8,
    carriedMassGrams: 20_000,
    maximumCarryCapacityGrams: 50_000,
    ...overrides,
  };
}

describe("site stash container capacity", () => {
  it("is exactly the container's authored equipped slot capacity", () => {
    expect(siteStashSlotCapacity(ITEM_IDS.mykeaSchleppraum8)).toBe(8);
    expect(siteStashSlotCapacity(ITEM_IDS.freightHarness)).toBe(6);
    expect(siteStashSlotCapacity(ITEM_IDS.scrapBox)).toBe(3);
  });

  it("is undefined for anything that is not a container", () => {
    expect(siteStashSlotCapacity(ITEM_IDS.salvageCutter)).toBeUndefined();
    expect(siteStashSlotCapacity(ITEM_IDS.slag)).toBeUndefined();
    expect(siteStashSlotCapacity("not_an_item")).toBeUndefined();
  });
});

describe("removing a container", () => {
  it("needs a completely empty stash", () => {
    expect(
      planSiteStashRemoval({
        occupiedSlots: 1,
        installedItemId: ITEM_IDS.scrapBox,
        carried: room(),
      }),
    ).toEqual({ ok: false, reason: "not_empty" });
  });

  it("needs the returned container to fit carried slots and mass", () => {
    const base = { occupiedSlots: 0, installedItemId: ITEM_IDS.mykeaSchleppraum8 } as const;
    expect(planSiteStashRemoval({ ...base, carried: room() })).toEqual({ ok: true });
    expect(planSiteStashRemoval({ ...base, carried: room({ inventorySlotsUsed: 8 }) })).toEqual({
      ok: false,
      reason: "carried_capacity",
    });
    // MYKEA is 10 kg: 45 kg carried leaves exactly 5 kg.
    expect(planSiteStashRemoval({ ...base, carried: room({ carriedMassGrams: 45_000 }) })).toEqual({
      ok: false,
      reason: "carried_capacity",
    });
    expect(planSiteStashRemoval({ ...base, carried: room({ carriedMassGrams: 40_000 }) })).toEqual({
      ok: true,
    });
  });
});

describe("swapping a container", () => {
  const swap = (
    installedItemId: string,
    replacementItemId: string,
    occupiedSlots: number,
    carried = room(),
  ) => planSiteStashSwap({ installedItemId, replacementItemId, occupiedSlots, carried });

  it("refuses the same item type, even though a different instance would be a different item", () => {
    expect(swap(ITEM_IDS.scrapBox, ITEM_IDS.scrapBox, 0)).toEqual({
      ok: false,
      reason: "same_container_type",
    });
  });

  it("refuses a replacement that is not a container", () => {
    expect(swap(ITEM_IDS.scrapBox, ITEM_IDS.salvageCutter, 0)).toEqual({
      ok: false,
      reason: "not_a_container",
    });
  });

  it("holds every occupied slot: exactly equal capacity is allowed, one fewer is not", () => {
    // Freight Harness 6 slots -> Scrap Box 3 slots.
    expect(swap(ITEM_IDS.freightHarness, ITEM_IDS.scrapBox, 3)).toEqual({ ok: true });
    expect(swap(ITEM_IDS.freightHarness, ITEM_IDS.scrapBox, 4)).toEqual({
      ok: false,
      reason: "stash_capacity",
    });
  });

  it("allows a heavy model to be exchanged for a lighter one, which returns the heavier to the player", () => {
    // MYKEA 10 kg comes back while a 5 kg Scrap Box is consumed: +5 kg carried,
    // so exactly 45 kg carried is the last mass that still fits.
    const carried = (carriedMassGrams: number) => room({ carriedMassGrams });
    expect(swap(ITEM_IDS.mykeaSchleppraum8, ITEM_IDS.scrapBox, 2, carried(45_000))).toEqual({
      ok: true,
    });
    expect(swap(ITEM_IDS.mykeaSchleppraum8, ITEM_IDS.scrapBox, 2, carried(45_001))).toEqual({
      ok: false,
      reason: "carried_capacity",
    });
  });

  it("measures the returned container against carried room AFTER consuming the replacement", () => {
    // Returning a 9 kg Freight Harness while consuming a 5 kg Scrap Box nets +4 kg.
    const carried = (carriedMassGrams: number) => room({ carriedMassGrams });
    expect(swap(ITEM_IDS.freightHarness, ITEM_IDS.scrapBox, 0, carried(46_000))).toEqual({
      ok: true,
    });
    expect(swap(ITEM_IDS.freightHarness, ITEM_IDS.scrapBox, 0, carried(46_001))).toEqual({
      ok: false,
      reason: "carried_capacity",
    });
  });

  it("is slot-neutral: it never needs a free carried slot", () => {
    expect(
      swap(ITEM_IDS.freightHarness, ITEM_IDS.scrapBox, 0, room({ inventorySlotsUsed: 8 })),
    ).toEqual({ ok: true });
  });
});

describe("authored site stashes", () => {
  it("lists exactly the four activity sites, each backed by a mount repair target there", () => {
    expect(SITE_STASHES.map((site) => site.locationId)).toEqual([
      LOCATION_IDS.theJag,
      LOCATION_IDS.ruskRecovery,
      LOCATION_IDS.abandonedProcessingYard,
      LOCATION_IDS.deepJag,
    ]);
    for (const site of SITE_STASHES) {
      expect(getRepairTarget(site.mountTargetId)?.locationId).toBe(site.locationId);
      expect(getSiteStash(site.locationId)).toBe(site);
    }
    expect(getSiteStash(LOCATION_IDS.crashSite)).toBeUndefined();
  });

  it("gates each mount on the site's own personal Welding level and nothing else", () => {
    const authorization = (targetId: string) => getRepairTarget(targetId)?.authorization;
    expect(authorization(REPAIR_TARGET_IDS.siteStashTheJag)).toEqual({
      kind: "welding_level",
      level: 1,
    });
    expect(authorization(REPAIR_TARGET_IDS.siteStashRuskRecovery)).toEqual({
      kind: "welding_level",
      level: 5,
    });
    expect(authorization(REPAIR_TARGET_IDS.siteStashProcessingYard)).toEqual({
      kind: "welding_level",
      level: 5,
    });
    expect(authorization(REPAIR_TARGET_IDS.siteStashDeepJag)).toEqual({
      kind: "welding_level",
      level: 8,
      requiresCompletedTargetId: REPAIR_TARGET_IDS.deepJagCaveIn,
    });
  });

  it("authors the locked recipes, sections, time and base XP for every tier", () => {
    const expected = [
      [REPAIR_TARGET_IDS.siteStashTheJag, 6, 18, 300, { refined_ferrite: 6, slag: 3 }],
      [
        REPAIR_TARGET_IDS.siteStashRuskRecovery,
        10,
        30,
        500,
        { galvanic_stock: 3, mounting_bracket: 2 },
      ],
      [
        REPAIR_TARGET_IDS.siteStashProcessingYard,
        10,
        30,
        500,
        { galvanic_stock: 3, mounting_bracket: 2 },
      ],
      [
        REPAIR_TARGET_IDS.siteStashDeepJag,
        15,
        45,
        750,
        { galvaferrite: 2, mounting_bracket: 2, galvanic_stock: 1 },
      ],
    ] as const;
    for (const [targetId, sections, seconds, xp, materials] of expected) {
      const recipe = getRepairTargetBalance(targetId, balance);
      expect(recipe.repairIncrements).toBe(sections);
      // The baseline time is derived from the existing 5-tick Welding section,
      // not a separate wait timer.
      expect((sections * balance.welding.attemptDurationTicks * GAME_TICK_MS) / 1000).toBe(seconds);
      expect(sections * balance.welding.xpPerIncrement).toBe(xp);
      expect(
        Object.fromEntries(
          recipe.materials.map((material) => [material.itemId, material.quantity]),
        ),
      ).toEqual(materials);
    }
  });

  it("gives the same tier identical construction requirements at every site", () => {
    const rusk = getRepairTargetBalance(REPAIR_TARGET_IDS.siteStashRuskRecovery, balance);
    const yard = getRepairTargetBalance(REPAIR_TARGET_IDS.siteStashProcessingYard, balance);
    expect(yard.materials).toEqual(rusk.materials);
    expect(yard.repairIncrements).toBe(rusk.repairIncrements);
  });

  it("uses no Mounting Bracket at the entry tier, so Welding 1 is reachable before Fabrication", () => {
    const jag = getRepairTargetBalance(REPAIR_TARGET_IDS.siteStashTheJag, balance);
    expect(jag.materials.map((material) => material.itemId)).not.toContain(
      ITEM_IDS.mountingBracket,
    );
  });

  it("keeps Clean Pass available on every mount", () => {
    for (const site of SITE_STASHES) {
      const { repairIncrements } = getRepairTargetBalance(site.mountTargetId, balance);
      expect(cleanPassOpportunityCount(repairIncrements, balance)).toBeGreaterThan(0);
    }
  });

  it("never lists a mount's Welding in any location's available actions, which would leak it early", () => {
    const serialized = JSON.stringify(LOCATIONS);
    for (const site of SITE_STASHES) {
      const { actionId } = getRepairTargetBalance(site.mountTargetId, balance);
      expect(serialized).not.toContain(actionId);
    }
  });
});

describe("repair target authorization validation", () => {
  const missionIds = new Set(MISSIONS.map((mission) => mission.id));

  it("accepts the whole authored registry", () => {
    expect(() => validateRepairTargets(REPAIR_TARGETS, missionIds)).not.toThrow();
  });

  it("rejects a Welding gate below level 1 and a prerequisite that does not exist or is itself", () => {
    const [jag] = REPAIR_TARGETS.filter(
      (target) => target.id === REPAIR_TARGET_IDS.siteStashTheJag,
    );
    const gated = (authorization: (typeof REPAIR_TARGETS)[number]["authorization"]) => ({
      ...jag!,
      authorization,
    });
    expect(() =>
      validateRepairTargets([gated({ kind: "welding_level", level: 0 })], missionIds),
    ).toThrow(/invalid Welding level/);
    expect(() =>
      validateRepairTargets(
        [
          gated({
            kind: "welding_level",
            level: 1,
            requiresCompletedTargetId: REPAIR_TARGET_IDS.siteStashTheJag,
          }),
        ],
        missionIds,
      ),
    ).toThrow(/unknown or self/);
    expect(() =>
      validateRepairTargets(
        [
          gated({
            kind: "welding_level",
            level: 1,
            requiresCompletedTargetId: REPAIR_TARGET_IDS.cargoHold,
          }),
        ],
        missionIds,
      ),
    ).toThrow(/unknown or self/);
  });
});
