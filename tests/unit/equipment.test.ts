import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { ITEM_IDS } from "@/game/config/foundations";
import {
  carriedItemMassGrams,
  deriveEquipmentLoadout,
  isCompatibleEquipmentAssignment,
  planEquipmentChange,
} from "@/game/domain/equipment";

const balance = getEffectiveGameBalance();
const toolTarget = { assignmentKind: "gear", suitSlotId: balance.items.salvageCutter.suitSlotId };
const firstContainerTarget = {
  assignmentKind: "container",
  suitSlotId: balance.carrying.containerSuitSlotIds[0],
};
const secondContainerTarget = {
  assignmentKind: "container",
  suitSlotId: balance.carrying.containerSuitSlotIds[1],
};
const cutter = { id: "cutter", itemId: ITEM_IDS.salvageCutter };
const firstContainer = { id: "container-one", itemId: ITEM_IDS.mykeaSchleppraum8 };
const secondContainer = { id: "container-two", itemId: ITEM_IDS.mykeaSchleppraum8 };

describe("equipment loadout rules", () => {
  it("accepts only approved compatible assignments", () => {
    expect(isCompatibleEquipmentAssignment(cutter.itemId, toolTarget, balance)).toBe(true);
    expect(isCompatibleEquipmentAssignment(cutter.itemId, firstContainerTarget, balance)).toBe(
      false,
    );
    expect(isCompatibleEquipmentAssignment(firstContainer.itemId, toolTarget, balance)).toBe(false);
    expect(
      isCompatibleEquipmentAssignment(firstContainer.itemId, secondContainerTarget, balance),
    ).toBe(true);
  });

  it("derives aggregate container capacity and counts equipped mass outside inventory slots", () => {
    const loadout = deriveEquipmentLoadout({
      balance,
      instances: [cutter, firstContainer, secondContainer],
      stacks: [],
      assignments: [
        { ...toolTarget, itemInstanceId: cutter.id },
        { ...firstContainerTarget, itemInstanceId: firstContainer.id },
        { ...secondContainerTarget, itemInstanceId: secondContainer.id },
      ],
    });
    expect(loadout.containerSlotCapacity).toBe(16);
    expect(loadout.inventorySlotsUsed).toBe(0);
    expect(loadout.carriedMassGrams).toBe(25_000);
  });

  it("rejects duplicate assignments for one unique item", () => {
    expect(() =>
      deriveEquipmentLoadout({
        balance,
        instances: [cutter, firstContainer],
        stacks: [],
        assignments: [
          { ...firstContainerTarget, itemInstanceId: firstContainer.id },
          { ...secondContainerTarget, itemInstanceId: firstContainer.id },
        ],
      }),
    ).toThrow(/cannot be equipped twice/i);
  });

  it("counts a carried spare container as one inventory slot with mass but no capacity", () => {
    const loadout = deriveEquipmentLoadout({
      balance,
      instances: [cutter, firstContainer],
      stacks: [],
      assignments: [{ ...toolTarget, itemInstanceId: cutter.id }],
    });
    // Only the Cutter is equipped, so no slots from containers.
    expect(loadout.containerSlotCapacity).toBe(0);
    // The unequipped MYKEA consumes one inventory slot.
    expect(loadout.inventorySlotsUsed).toBe(1);
    // Both items contribute mass.
    expect(loadout.carriedMassGrams).toBe(15_000);
    expect(carriedItemMassGrams(ITEM_IDS.mykeaSchleppraum8, balance)).toBe(10_000);
  });

  it("requires at least one compatible container to remain equipped", () => {
    expect(() =>
      planEquipmentChange({
        balance,
        instances: [cutter, firstContainer],
        stacks: [],
        assignments: [
          { ...toolTarget, itemInstanceId: cutter.id },
          { ...firstContainerTarget, itemInstanceId: firstContainer.id },
        ],
        change: { kind: "unequip", target: firstContainerTarget },
      }),
    ).toThrow(/at least one compatible container/i);
  });

  it("refuses a container removal that would strand carried inventory", () => {
    expect(() =>
      planEquipmentChange({
        balance,
        instances: [cutter, firstContainer, secondContainer],
        stacks: Array.from({ length: 9 }, (_, index) => ({
          itemId: ITEM_IDS.ferriteShale,
          quantity: index + 1,
        })),
        assignments: [
          { ...toolTarget, itemInstanceId: cutter.id },
          { ...firstContainerTarget, itemInstanceId: firstContainer.id },
          { ...secondContainerTarget, itemInstanceId: secondContainer.id },
        ],
        change: { kind: "unequip", target: secondContainerTarget },
      }),
    ).toThrow(/current inventory would not fit/i);
  });
});
