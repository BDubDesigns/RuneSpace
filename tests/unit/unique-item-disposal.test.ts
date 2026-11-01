import { describe, expect, it } from "vitest";
import { ITEM_IDS } from "@/game/config/foundations";
import { planUniqueItemDisposal } from "@/game/domain/unique-item-disposal";

const none = new Set<string>();
const SALVAGE = ITEM_IDS.salvageCutter;
const LOADSTEEL = ITEM_IDS.loadsteelCutter;

function plan(
  overrides: Partial<Parameters<typeof planUniqueItemDisposal>[0]> & {
    itemInstanceId: string;
    expectedItemId: string;
  },
  instances: { id: string; itemId: string }[],
) {
  return planUniqueItemDisposal({
    instances,
    equippedInstanceIds: none,
    cargoInstanceIds: none,
    installedContainerInstanceIds: none,
    storedInstanceIds: none,
    miningLevel: 1,
    ...overrides,
  });
}

describe("planUniqueItemDisposal", () => {
  it("allows any carried, unequipped unique item that is not a Cutter", () => {
    for (const itemId of [
      ITEM_IDS.scrapBox,
      ITEM_IDS.mykeaSchleppraum8,
      ITEM_IDS.freightHarness,
      ITEM_IDS.minersBoots,
    ]) {
      expect(plan({ itemInstanceId: "a", expectedItemId: itemId }, [{ id: "a", itemId }])).toEqual({
        ok: true,
        itemId,
      });
    }
  });

  it("refuses unknown, foreign and changed identities", () => {
    const instances = [{ id: "a", itemId: ITEM_IDS.scrapBox }];
    expect(plan({ itemInstanceId: "zzz", expectedItemId: ITEM_IDS.scrapBox }, instances)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(
      plan({ itemInstanceId: "a", expectedItemId: ITEM_IDS.mykeaSchleppraum8 }, instances),
    ).toEqual({ ok: false, reason: "changed" });
  });

  it("refuses equipped, Cargo, installed, stored and mission-bound instances", () => {
    const instances = [{ id: "a", itemId: ITEM_IDS.scrapBox }];
    const base = { itemInstanceId: "a", expectedItemId: ITEM_IDS.scrapBox };
    const only = new Set(["a"]);
    expect(plan({ ...base, equippedInstanceIds: only }, instances)).toMatchObject({
      reason: "equipped",
    });
    expect(plan({ ...base, cargoInstanceIds: only }, instances)).toMatchObject({
      reason: "in_cargo",
    });
    expect(plan({ ...base, installedContainerInstanceIds: only }, instances)).toMatchObject({
      reason: "installed",
    });
    expect(plan({ ...base, storedInstanceIds: only }, instances)).toMatchObject({
      reason: "stored",
    });
    expect(plan({ ...base, missionBoundInstanceId: "a" }, instances)).toMatchObject({
      reason: "mission_bound",
    });
  });

  describe("last usable Mining Cutter", () => {
    const target = { itemInstanceId: "c1", expectedItemId: SALVAGE };

    it("refuses the only usable Cutter the character owns", () => {
      expect(plan(target, [{ id: "c1", itemId: SALVAGE }])).toEqual({
        ok: false,
        reason: "last_cutter",
      });
    });

    it("does not count a Cutter the Mining level cannot use as a replacement", () => {
      const instances = [
        { id: "c1", itemId: SALVAGE },
        { id: "c2", itemId: LOADSTEEL },
      ];
      expect(plan({ ...target, miningLevel: 4 }, instances)).toEqual({
        ok: false,
        reason: "last_cutter",
      });
    });

    it("counts a Cutter the Mining level can use, wherever it is held", () => {
      const instances = [
        { id: "c1", itemId: SALVAGE },
        { id: "c2", itemId: LOADSTEEL },
      ];
      for (const where of [
        { equippedInstanceIds: new Set(["c2"]) },
        { cargoInstanceIds: new Set(["c2"]) },
        { installedContainerInstanceIds: new Set(["c2"]) },
        { storedInstanceIds: new Set(["c2"]) },
        {},
      ]) {
        expect(plan({ ...target, miningLevel: 5, ...where }, instances)).toMatchObject({
          ok: true,
        });
      }
    });

    it("lets a level-locked Cutter go while a usable one remains", () => {
      const instances = [
        { id: "c1", itemId: SALVAGE },
        { id: "c2", itemId: LOADSTEEL },
      ];
      expect(
        plan({ itemInstanceId: "c2", expectedItemId: LOADSTEEL, miningLevel: 1 }, instances),
      ).toMatchObject({ ok: true });
    });

    it("never invents a block when the character had no usable Cutter to lose", () => {
      expect(
        plan({ itemInstanceId: "c2", expectedItemId: LOADSTEEL, miningLevel: 1 }, [
          { id: "c2", itemId: LOADSTEEL },
        ]),
      ).toMatchObject({ ok: true });
    });
  });
});
