import { describe, expect, it } from "vitest";
import {
  getEffectiveGameBalance,
  getEquipmentDefinition,
  getItemDefinition,
} from "@/game/config/balance";
import { ITEM_IDS } from "@/game/config/foundations";
import {
  deriveEquipmentLoadout,
  evaluateEquipmentChange,
  isApprovedEquipmentTarget,
  isCompatibleEquipmentAssignment,
  planEquipmentChange,
} from "@/game/domain/equipment";
import {
  miningSourceUnlocked,
  miningSuccessChanceBps,
  resolveMining,
  type MiningRandom,
  type MiningSnapshot,
} from "@/game/domain/mining";
import { getItemPresentation, resolveItemPresentation } from "@/game/content/item-presentation";
import { ITEM_CATEGORY_BY_ITEM_ID } from "@/game/content/item-categories";

/**
 * The Legendary miner's set (#399): unique hands and feet gear that is worth +1
 * effective Mining level EACH for success chance only. These pin the authored
 * facts, the two real slots, the stacking bonus, and that nothing but the
 * success roll ever reads it.
 */

const balance = getEffectiveGameBalance();
const feet = { assignmentKind: "gear", suitSlotId: balance.carrying.feetSuitSlotId } as const;
const hands = { assignmentKind: "gear", suitSlotId: balance.carrying.handsSuitSlotId } as const;
const toolTarget = {
  assignmentKind: "gear",
  suitSlotId: balance.carrying.miningToolSuitSlotId,
} as const;
const containerTarget = {
  assignmentKind: "container",
  suitSlotId: balance.carrying.containerSuitSlotIds[0],
} as const;
const boots = { id: "boots-1", itemId: ITEM_IDS.minersBoots };
const spareBoots = { id: "boots-2", itemId: ITEM_IDS.minersBoots };
const gloves = { id: "gloves-1", itemId: ITEM_IDS.minersGloves };
const container = { id: "container-1", itemId: ITEM_IDS.mykeaSchleppraum8 };
const cutter = { id: "cutter-1", itemId: ITEM_IDS.salvageCutter };

describe("the authored items", () => {
  it("are unique equipment at the approved masses, never stacks", () => {
    expect(getItemDefinition(ITEM_IDS.minersBoots)).toEqual({
      itemId: ITEM_IDS.minersBoots,
      kind: "unique",
      massGrams: 2_000,
    });
    expect(getItemDefinition(ITEM_IDS.minersGloves)).toEqual({
      itemId: ITEM_IDS.minersGloves,
      kind: "unique",
      massGrams: 1_000,
    });
  });

  it("author the success-level bonus and the slot, with no Mining level requirement", () => {
    expect(getEquipmentDefinition(ITEM_IDS.minersBoots)).toEqual({
      kind: "wearable",
      itemId: ITEM_IDS.minersBoots,
      assignmentKind: "gear",
      suitSlotIds: ["feet"],
      miningSuccessLevelBonus: 1,
    });
    expect(getEquipmentDefinition(ITEM_IDS.minersGloves)).toEqual({
      kind: "wearable",
      itemId: ITEM_IDS.minersGloves,
      assignmentKind: "gear",
      suitSlotIds: ["hands"],
      miningSuccessLevelBonus: 1,
    });
  });

  it("are Legendary on every shared item visual and filed under Tools & Containers", () => {
    for (const itemId of [ITEM_IDS.minersBoots, ITEM_IDS.minersGloves]) {
      const presentation = getItemPresentation(itemId)!;
      expect(presentation.rarity).toBe("legendary");
      expect(presentation.artworkSrc).toMatch(/^\/item-art\/miners-(boots|gloves)\.webp$/);
      expect(presentation.accessibleDescription.length).toBeGreaterThan(40);
      expect(presentation.description).toContain("one effective Mining level");
      expect(ITEM_CATEGORY_BY_ITEM_ID[itemId]).toBe("tools-and-containers");
    }
    expect(resolveItemPresentation(ITEM_IDS.minersBoots, "").displayName).toBe("Miner's Boots");
    expect(resolveItemPresentation(ITEM_IDS.minersGloves, "").displayName).toBe("Miner's Gloves");
  });
});

describe("the hands and feet slots", () => {
  it("are approved gear slots beside the Mining tool, without a third container or second tool", () => {
    expect(isApprovedEquipmentTarget(hands, balance)).toBe(true);
    expect(isApprovedEquipmentTarget(feet, balance)).toBe(true);
    expect(isApprovedEquipmentTarget({ assignmentKind: "gear", suitSlotId: "head" }, balance)).toBe(
      false,
    );
    expect(
      isApprovedEquipmentTarget({ assignmentKind: "container", suitSlotId: "hands" }, balance),
    ).toBe(false);
  });

  it("take only their own piece, and nothing else may take them", () => {
    expect(isCompatibleEquipmentAssignment(boots.itemId, feet, balance)).toBe(true);
    expect(isCompatibleEquipmentAssignment(boots.itemId, hands, balance)).toBe(false);
    expect(isCompatibleEquipmentAssignment(gloves.itemId, hands, balance)).toBe(true);
    expect(isCompatibleEquipmentAssignment(gloves.itemId, feet, balance)).toBe(false);
    expect(isCompatibleEquipmentAssignment(boots.itemId, toolTarget, balance)).toBe(false);
    expect(isCompatibleEquipmentAssignment(boots.itemId, containerTarget, balance)).toBe(false);
    expect(isCompatibleEquipmentAssignment(cutter.itemId, hands, balance)).toBe(false);
    expect(isCompatibleEquipmentAssignment(container.itemId, feet, balance)).toBe(false);
  });
});

describe("the equipped bonus", () => {
  const base = {
    balance,
    instances: [container, cutter, boots, gloves],
    stacks: [],
  };
  const assignments = (...items: [typeof hands | typeof feet, { id: string }][]) => [
    { ...containerTarget, itemInstanceId: container.id },
    { ...toolTarget, itemInstanceId: cutter.id },
    ...items.map(([target, item]) => ({ ...target, itemInstanceId: item.id })),
  ];

  it("is +1 each and +2 together, and nothing when neither is worn", () => {
    const bonus = (...items: [typeof hands | typeof feet, { id: string }][]) =>
      deriveEquipmentLoadout({ ...base, assignments: assignments(...items) })
        .miningSuccessLevelBonus;
    expect(bonus()).toBe(0);
    expect(bonus([feet, boots])).toBe(1);
    expect(bonus([hands, gloves])).toBe(1);
    expect(bonus([hands, gloves], [feet, boots])).toBe(2);
  });

  it("can be equipped at Mining 1, and never needs a natural level", () => {
    const evaluation = evaluateEquipmentChange({
      ...base,
      assignments: assignments(),
      change: { kind: "equip", itemInstanceId: boots.id, target: feet },
      miningLevel: 1,
    });
    expect(evaluation.allowed).toBe(true);
  });

  it("allows duplicates to be carried but only one per slot, swapping the worn one out", () => {
    const duplicates = {
      ...base,
      instances: [container, cutter, boots, spareBoots],
    };
    const worn = assignments([feet, boots]);
    const swapped = planEquipmentChange({
      ...duplicates,
      assignments: worn,
      change: { kind: "equip", itemInstanceId: spareBoots.id, target: feet },
      miningLevel: 1,
    });
    expect(swapped.miningSuccessLevelBonus).toBe(1);
    expect(swapped.equippedItemInstanceIds.has(spareBoots.id)).toBe(true);
    expect(swapped.equippedItemInstanceIds.has(boots.id)).toBe(false);
    // The same instance cannot fill two slots, and the same item cannot be worn twice.
    expect(() =>
      deriveEquipmentLoadout({
        ...duplicates,
        assignments: assignments([feet, boots], [hands, boots]),
      }),
    ).toThrow();
  });

  it("refuses an unequip that would leave the carried Inventory over capacity, like any item", () => {
    const full = evaluateEquipmentChange({
      ...base,
      // An 8-slot container already holding 8 stacks: the unequipped Boots need a ninth slot.
      stacks: Array.from({ length: 8 }, (_, index) => ({
        itemId: ITEM_IDS.ferriteShale,
        quantity: index + 1,
      })),
      assignments: assignments([feet, boots]),
      change: { kind: "unequip", target: feet },
      miningLevel: 1,
    });
    expect(full.allowed).toBe(false);
  });
});

describe("the success chance", () => {
  const source = balance.mining.sources.ferriteShale;

  it("adds effective levels to the existing curve and stops at the existing maximum", () => {
    const natural = miningSuccessChanceBps(1, source);
    expect(natural).toBe(source.successAtLevelOneBps);
    expect(miningSuccessChanceBps(2, source)).toBeGreaterThan(natural);
    expect(miningSuccessChanceBps(3, source)).toBeGreaterThan(miningSuccessChanceBps(2, source));
    // Past the guaranteed level the probability is the cap, never above it.
    expect(miningSuccessChanceBps(source.guaranteedSuccessLevel + 2, source)).toBe(10_000);
    expect(miningSuccessChanceBps(source.guaranteedSuccessLevel - 1 + 2, source)).toBe(10_000);
  });

  function run(snapshot: Partial<MiningSnapshot>, rolled: number) {
    const random: MiningRandom = { nextBasisPoints: () => rolled, nextUnit: () => 0 };
    return resolveMining({
      elapsedTicks: source.attemptDurationTicks,
      snapshot: {
        miningLevel: 1,
        prioritizePrimaryResources: false,
        tool: getEquipmentDefinition(ITEM_IDS.salvageCutter, balance) as MiningSnapshot["tool"],
        cutterCharge: 0,
        existingStacks: [],
        slotsAvailable: 8,
        massAvailableGrams: 30_000,
        ...snapshot,
      } as MiningSnapshot,
      balance,
      source: { ...source, secondaryFinds: [] },
      random,
    });
  }

  it("turns a roll that fails at the natural level into a success when gear raises the chance", () => {
    const natural = miningSuccessChanceBps(1, source);
    const boosted = miningSuccessChanceBps(3, source);
    expect(boosted).toBeGreaterThan(natural);
    const rolled = natural; // exactly at the natural threshold: a miss
    expect(run({}, rolled).successes).toBe(0);
    expect(run({ successLevelBonus: 2 }, rolled).successes).toBe(1);
    // The attempt's recorded threshold is the boosted one the UI also shows.
    expect(run({ successLevelBonus: 2 }, rolled).attempts[0]?.thresholdBasisPoints).toBe(boosted);
  });

  it("changes nothing else: not the gate, the duration, the XP or the yield", () => {
    expect(miningSourceUnlocked(1, { requiredMiningLevel: 5 })).toBe(false);
    const plain = run({}, 0);
    const geared = run({ successLevelBonus: 2 }, 0);
    expect(geared.consumedTicks).toBe(plain.consumedTicks);
    expect(geared.awardedXp).toBe(plain.awardedXp);
    expect(geared.createdStacks).toEqual(plain.createdStacks);
  });
});
