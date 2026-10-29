import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getItemDefinition,
  lapidaryRecipeForActionId,
  lapidaryRecipes,
  type LapidaryRecipeBalance,
} from "@/game/config/balance";
import {
  ACTION_IDS,
  CONVERSATION_TOPIC_IDS,
  DIALOGUE_IDS,
  EXPRESSION_IDS,
  GAME_TICK_MS,
  ITEM_IDS,
  MERCHANT_IDS,
  NPC_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { getConversationTopic } from "@/game/content/conversation-topics";
import { getDialogue } from "@/game/content/dialogue";
import { ITEM_CATEGORY_BY_ITEM_ID } from "@/game/content/item-categories";
import { getItemPresentation } from "@/game/content/item-presentation";
import { LOCATIONS } from "@/game/content/locations";
import { getMerchant, merchantBuybackPrice } from "@/game/content/merchants";
import { merchantPurchasableItemIds } from "@/game/domain/trade";
import { topicAvailable, resolveNpcConversation } from "@/game/domain/conversation";
import {
  checkCraftingCycle,
  craftingAffordableCycles,
  craftingStartCheck,
} from "@/game/domain/deterministic-crafting";
import { resolveItemSources } from "@/game/domain/item-sources";
import { isItemTransferable } from "@/game/domain/player-trade";
import { workingInventory } from "@/game/domain/working-inventory";
import {
  learnedLapidaryTechniques,
  workLapidaryTechniques,
  type LapidaryTechnique,
} from "@/features/lapidary/technique-presentation";
import { readImageHeader } from "./image-header";
import { type ItemSourceFacts } from "@/game/domain/item-sources";
import { resolveLocationState } from "@/game/domain/location-state";

/**
 * Issue #433 — Werner Slice C: Cut Topaz (Lapidary 5), Cut Sapphire (Lapidary 8),
 * their two items and art, Werner's buybacks and the Lapidary 8 "Beyond the Basics" topic.
 * Server authority is proven against PostgreSQL in tests/integration/lapidary-gems.test.ts.
 */
const sha256 = (path: string) =>
  createHash("sha256")
    .update(readFileSync(join(process.cwd(), path)))
    .digest("hex");
const topaz = lapidaryRecipeForActionId(ACTION_IDS.cutTopaz)!;
const sapphire = lapidaryRecipeForActionId(ACTION_IDS.cutSapphire)!;
const quartz = lapidaryRecipeForActionId(ACTION_IDS.cutQuartz)!;

describe("the Cut Topaz and Cut Sapphire recipes", () => {
  it("are authored exactly: level, input, output, whole ticks and XP", () => {
    expect(topaz).toMatchObject({
      displayName: "Cut Topaz",
      minimumLevel: 5,
      durationTicks: 50,
      baseXp: 150,
      outputItemId: ITEM_IDS.cutTopaz,
      outputQuantity: 1,
      inputs: [{ itemId: ITEM_IDS.uncutTopaz, quantity: 1 }],
    });
    expect(sapphire).toMatchObject({
      displayName: "Cut Sapphire",
      minimumLevel: 8,
      durationTicks: 75,
      baseXp: 300,
      outputItemId: ITEM_IDS.cutSapphire,
      outputQuantity: 1,
      inputs: [{ itemId: ITEM_IDS.uncutSapphire, quantity: 1 }],
    });
  });

  it("derive 30 and 45 seconds from the shared tick, and leave Stone and Quartz untouched", () => {
    expect((topaz.durationTicks * GAME_TICK_MS) / 1000).toBe(30);
    expect((sapphire.durationTicks * GAME_TICK_MS) / 1000).toBe(45);
    expect(quartz).toMatchObject({ minimumLevel: 1, durationTicks: 30, baseXp: 75 });
    expect(lapidaryRecipes().map((recipe) => recipe.actionId)).toEqual([
      ACTION_IDS.shapeStone,
      ACTION_IDS.cutQuartz,
      ACTION_IDS.cutTopaz,
      ACTION_IDS.cutSapphire,
    ]);
  });

  it("carry no failure, breakage or chance data: every cut is deterministic", () => {
    for (const recipe of [topaz, sapphire]) {
      expect(Object.keys(recipe).sort()).toEqual(
        [
          "actionId",
          "baseXp",
          "displayName",
          "durationTicks",
          "inputs",
          "minimumLevel",
          "outputItemId",
          "outputQuantity",
        ].sort(),
      );
    }
  });
});

describe("the level gates in the shared crafting rule", () => {
  const stacks = (itemId: string, quantity: number) => [{ id: "s1", itemId, quantity }];
  const snapshot = (skillLevel: number, itemId: string, quantity = 1) => ({
    skillLevel,
    stacks: stacks(itemId, quantity),
    slotsAvailable: 5,
    massAvailableGrams: 100_000,
  });

  it.each([1, 4])("refuses Cut Topaz at Lapidary %i even with the gem carried", (level) => {
    expect(craftingStartCheck(snapshot(level, ITEM_IDS.uncutTopaz), topaz)).toEqual({
      ok: false,
      reason: "recipe_locked",
    });
    expect(craftingAffordableCycles(snapshot(level, ITEM_IDS.uncutTopaz), topaz)).toBe(0);
  });

  it("starts Cut Topaz at exactly Lapidary 5 and Cut Sapphire at exactly Lapidary 8", () => {
    expect(craftingStartCheck(snapshot(5, ITEM_IDS.uncutTopaz), topaz).ok).toBe(true);
    expect(craftingStartCheck(snapshot(7, ITEM_IDS.uncutSapphire), sapphire)).toEqual({
      ok: false,
      reason: "recipe_locked",
    });
    expect(craftingStartCheck(snapshot(8, ITEM_IDS.uncutSapphire), sapphire).ok).toBe(true);
  });

  it("needs the matching uncut gem, not another gem", () => {
    expect(craftingStartCheck(snapshot(8, ITEM_IDS.uncutQuartz), topaz)).toEqual({
      ok: false,
      reason: "insufficient_inputs",
    });
    expect(craftingStartCheck(snapshot(8, ITEM_IDS.uncutTopaz), sapphire)).toEqual({
      ok: false,
      reason: "insufficient_inputs",
    });
  });

  it("converts exactly one uncut into one cut and counts affordable cycles", () => {
    const two = snapshot(8, ITEM_IDS.uncutSapphire, 2);
    expect(craftingAffordableCycles(two, sapphire)).toBe(2);
    const check = checkCraftingCycle(workingInventory(two), 8, sapphire);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    const carried = (itemId: string) =>
      check.after.stacks.filter((s) => s.itemId === itemId).reduce((n, s) => n + s.quantity, 0);
    expect(carried(ITEM_IDS.uncutSapphire)).toBe(1);
    expect(carried(ITEM_IDS.cutSapphire)).toBe(1);
  });

  it("reports full capacity when the finished gem cannot fit after the input is gone", () => {
    const full = { ...snapshot(5, ITEM_IDS.uncutTopaz), slotsAvailable: 0 };
    // The consumed input frees its own slot, so one cut still fits; a mass cap does not.
    expect(craftingStartCheck(full, topaz).ok).toBe(true);
    expect(
      craftingStartCheck({ ...snapshot(5, ITEM_IDS.uncutTopaz), massAvailableGrams: 0 }, topaz).ok,
    ).toBe(true);
  });
});

describe("Cut Topaz and Cut Sapphire items", () => {
  it.each([ITEM_IDS.cutTopaz, ITEM_IDS.cutSapphire])("%s is a 100 g, stack-2 stack", (itemId) => {
    expect(getItemDefinition(itemId)).toMatchObject({
      kind: "stack",
      massGrams: 100,
      stackLimit: 2,
    });
    expect(ITEM_CATEGORY_BY_ITEM_ID[itemId]).toBe("ores-and-gemstones");
    expect(isItemTransferable(itemId)).toBe(true);
  });

  it("have full presentation and accessible descriptions that match the colour of the art", () => {
    const t = getItemPresentation(ITEM_IDS.cutTopaz)!;
    const s = getItemPresentation(ITEM_IDS.cutSapphire)!;
    expect(t).toMatchObject({
      displayName: "Cut Topaz",
      pluralName: "Cut Topaz",
      artworkSrc: "/item-art/cut-topaz.webp",
    });
    expect(s).toMatchObject({
      displayName: "Cut Sapphire",
      pluralName: "Cut Sapphire",
      artworkSrc: "/item-art/cut-sapphire.webp",
    });
    expect(t.accessibleDescription).toMatch(/golden/i);
    expect(s.accessibleDescription).toMatch(/blue/i);
    // They are crafted, never a Mining find or a random reward.
    for (const itemId of [ITEM_IDS.cutTopaz, ITEM_IDS.cutSapphire]) {
      expect(getItemDefinition(itemId)).not.toHaveProperty("secondaryFindMiningXp");
    }
  });

  it("give every cut gem the same rarity treatment as the uncut gem it is cut from", () => {
    const cuts = lapidaryRecipes().filter((recipe) => "outputItemId" in recipe);
    expect(cuts.map((recipe) => recipe.displayName)).toEqual([
      "Cut Quartz",
      "Cut Topaz",
      "Cut Sapphire",
    ]);
    for (const recipe of cuts) {
      const uncut = getItemPresentation(recipe.inputs[0]!.itemId)!;
      const cut = getItemPresentation(recipe.outputItemId!)!;
      expect(uncut.rarity).toBe("rare");
      expect(cut.rarity).toBe(uncut.rarity);
    }
  });

  it("derive a Lapidary Workbench source gated on the level, not on another permission", () => {
    const facts = (level: number): ItemSourceFacts => ({
      skillLevels: { [SKILL_IDS.lapidary]: level },
      acceptedMissionIds: new Set(),
      completedMissionIds: new Set(),
      fabricationStationUnlocked: false,
      resonanceRigUnlocked: false,
      locationStates: Object.fromEntries(
        LOCATIONS.map((location) => [
          location.id,
          resolveLocationState(location, {
            acceptedMissionIds: new Set(),
            completedRepairTargetIds: new Set(),
          }),
        ]),
      ),
      lapidaryAccess: { kind: "unrestricted" },
    });
    const at = (itemId: string, level: number) =>
      resolveItemSources(itemId, facts(level)).filter((source) => source.kind === "lapidary");
    expect(at(ITEM_IDS.cutTopaz, 4)).toMatchObject([
      { recipeActionId: ACTION_IDS.cutTopaz, minimumLevel: 5, access: { state: "locked" } },
    ]);
    expect(at(ITEM_IDS.cutTopaz, 5)[0]!.access.state).toBe("available");
    expect(at(ITEM_IDS.cutSapphire, 7)[0]!.access.state).toBe("locked");
    expect(at(ITEM_IDS.cutSapphire, 8)[0]!.access.state).toBe("available");
  });

  it("keep both masters byte-identical and derive valid transparent runtime art", () => {
    expect(sha256("assets/item-art/cut-topaz.png")).toBe(
      "3fb79c1c7c93c1f77799d06891270602dd9bfe4d6b3c67a063803b8cdb31d308",
    );
    expect(sha256("assets/item-art/cut-sapphire.png")).toBe(
      "9444228782d4f6ca350197817362393f6d23032395e67f88f3cab9abe21b38e8",
    );
    for (const name of ["cut-topaz", "cut-sapphire"]) {
      const header = readImageHeader(join(process.cwd(), `assets/item-art/${name}.png`));
      expect(header).toMatchObject({ width: 1024, height: 1024 });
      const webp = readFileSync(join(process.cwd(), `public/item-art/${name}.webp`));
      expect(webp.subarray(0, 4).toString()).toBe("RIFF");
      expect(webp.subarray(8, 12).toString()).toBe("WEBP");
    }
  });
});

describe("Werner's buyback of the cut gems", () => {
  const werner = MERCHANT_IDS.wernerLab;
  it("pays 36 and 70, twice the uncut price, and never sells either", () => {
    expect(merchantBuybackPrice(werner, ITEM_IDS.cutTopaz)).toBe(36);
    expect(merchantBuybackPrice(werner, ITEM_IDS.cutSapphire)).toBe(70);
    expect(merchantBuybackPrice(werner, ITEM_IDS.cutTopaz)).toBe(
      2 * merchantBuybackPrice(werner, ITEM_IDS.uncutTopaz),
    );
    expect(merchantBuybackPrice(werner, ITEM_IDS.cutSapphire)).toBe(
      2 * merchantBuybackPrice(werner, ITEM_IDS.uncutSapphire),
    );
    expect(merchantBuybackPrice(werner, ITEM_IDS.cutQuartz)).toBe(16);
    expect(merchantPurchasableItemIds(getMerchant(werner)!)).toEqual([ITEM_IDS.stone]);
  });
});

describe('Werner\'s "Beyond the Basics" topic', () => {
  const topic = getConversationTopic(CONVERSATION_TOPIC_IDS.wernerBeyondTheBasics)!;
  const levels = (lapidary: number) => ({ skillLevels: { [SKILL_IDS.lapidary]: lapidary } });

  it("is hidden below Lapidary 8 and visible and replayable from 8 onward", () => {
    for (const level of [1, 5, 7]) expect(topicAvailable(topic, [], levels(level))).toBe(false);
    for (const level of [8, 9, 99]) expect(topicAvailable(topic, [], levels(level))).toBe(true);
    expect(topicAvailable(topic, [])).toBe(false);
    expect(topicAvailable(topic, [], {})).toBe(false);
  });

  it("requires only the skill: no Mission, receipt or item", () => {
    expect(topic).toMatchObject({
      npcId: NPC_IDS.werner,
      label: "Beyond the Basics",
      availability: { kind: "skill_level", skillId: SKILL_IDS.lapidary, minimumLevel: 8 },
    });
  });

  it("appears in Werner's hub after his three always-available topics, only at Lapidary 8", () => {
    const labels = (level: number) =>
      resolveNpcConversation(NPC_IDS.werner, [], levels(level)).map((entry) =>
        entry.kind === "topic" ? entry.label : entry.kind,
      );
    expect(labels(7)).toEqual(["About the Lab", "The Quarry", "Gem Cutting"]);
    expect(labels(8)).toEqual(["About the Lab", "The Quarry", "Gem Cutting", "Beyond the Basics"]);
  });

  it("speaks the three owner-approved beats verbatim, in order, with the approved expressions", () => {
    const sequence = getDialogue(DIALOGUE_IDS.wernerBeyondTheBasicsTopic)!;
    expect(
      sequence.beats.map((beat) =>
        beat.kind === "npc" ? { expression: beat.expressionId, text: beat.text } : beat.kind,
      ),
    ).toEqual([
      {
        expression: EXPRESSION_IDS.thoughtful,
        text: "Quartz. Topaz. Sapphire. You can work all three now. A respectable beginning.",
      },
      {
        expression: EXPRESSION_IDS.intense,
        text: "But don't mistake three specimens for the full mineral record. There are gemstones out there that make these look like gravel.",
      },
      {
        expression: EXPRESSION_IDS.amused,
        text: "When you find one, bring it to me. Preferably before you've done something regrettable with a hammer.",
      },
    ]);
    // Purely conversational: nothing but Werner speaking.
    for (const beat of sequence.beats) expect(beat.kind).toBe("npc");
    expect(Object.keys(sequence).sort()).toEqual(["beats", "id", "npcId"]);
  });
});

describe("Work and Techniques with the new recipes", () => {
  const technique = (recipe: LapidaryRecipeBalance, carried: number): LapidaryTechnique => ({
    ...recipe,
    outputItemId: "outputItemId" in recipe ? recipe.outputItemId : undefined,
    outputQuantity: "outputQuantity" in recipe ? recipe.outputQuantity : undefined,
    outputStackLimit: 2,
    authorized: true,
    canStart: carried > 0,
    affordableCycles: carried,
    refusal: undefined,
    inputs: recipe.inputs.map((input) => ({
      ...input,
      name: "Uncut gem",
      stackLimit: 2,
      carried,
    })),
  });
  const all = [quartz, topaz, sapphire].map((recipe) => technique(recipe, 1));

  it("keeps future level-locked techniques out of Techniques and Work until learned", () => {
    expect(learnedLapidaryTechniques(all, 4).map((t) => t.actionId)).toEqual([
      ACTION_IDS.cutQuartz,
    ]);
    expect(learnedLapidaryTechniques(all, 5).map((t) => t.actionId)).toEqual([
      ACTION_IDS.cutQuartz,
      ACTION_IDS.cutTopaz,
    ]);
    expect(learnedLapidaryTechniques(all, 8).map((t) => t.actionId)).toEqual([
      ACTION_IDS.cutQuartz,
      ACTION_IDS.cutTopaz,
      ACTION_IDS.cutSapphire,
    ]);
    const bench = (level: number) => ({
      recipes: all,
      level,
      access: { kind: "unrestricted" } as const,
    });
    expect(workLapidaryTechniques(bench(4), new Set()).map((t) => t.actionId)).toEqual([
      ACTION_IDS.cutQuartz,
    ]);
    expect(workLapidaryTechniques(bench(8), new Set()).map((t) => t.actionId)).toEqual([
      ACTION_IDS.cutQuartz,
      ACTION_IDS.cutTopaz,
      ACTION_IDS.cutSapphire,
    ]);
  });

  it("lists a learned technique in Techniques without material but not in Work", () => {
    const empty = [technique(topaz, 0)];
    expect(learnedLapidaryTechniques(empty, 5)).toHaveLength(1);
    expect(
      workLapidaryTechniques(
        { recipes: empty, level: 5, access: { kind: "unrestricted" } },
        new Set(),
      ),
    ).toEqual([]);
  });
});
