import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  fabricationRecipeForActionId,
  getEffectiveGameBalance,
  getItemDefinition,
  tinkeringTargetForActionId,
} from "@/game/config/balance";
import {
  ACTION_IDS,
  ITEM_IDS,
  LOCATION_IDS,
  MISSION_IDS,
  SKILL_IDS,
} from "@/game/config/foundations";
import { ITEM_CATEGORY_BY_ITEM_ID } from "@/game/content/item-categories";
import { getItemPresentation } from "@/game/content/item-presentation";
import { LOCATIONS } from "@/game/content/locations";
import { MERCHANTS } from "@/game/content/merchants";
import { resolveLocationState } from "@/game/domain/location-state";
import { resolveItemSources } from "@/game/domain/item-sources";
import { isItemTransferable } from "@/game/domain/player-trade";
import { recipesUnlockedBetween } from "@/game/domain/recipe-unlocks";
import { tinkeringDurationTicks, tinkeringScrapYield, tinkeringXp } from "@/game/domain/tinkering";

/**
 * Issue #436 — the Fabrication 12 Resonance Core: an ordinary manufactured
 * component with one ordinary recipe and ordinary derived Tinkering. Every
 * expectation is the issue's locked value; the rules themselves are the shared
 * Fabrication, Tinkering, inventory and trade ones, proven by their own suites.
 */

const balance = getEffectiveGameBalance();
const recipe = fabricationRecipeForActionId(ACTION_IDS.resonanceCoreFabrication, balance)!;

describe("the Resonance Core item", () => {
  it("is an ordinary stack of two at exactly 3,900 g", () => {
    const item = getItemDefinition(ITEM_IDS.resonanceCore, balance)!;
    expect(item).toMatchObject({ massGrams: 3_900, stackLimit: 2 });
    expect(item).not.toHaveProperty("equipment");
  });

  it("conserves its mass through its authored inputs", () => {
    const mass = (itemId: string) => getItemDefinition(itemId, balance)!.massGrams;
    const inputs = recipe.inputs.reduce(
      (sum, input) => sum + mass(input.itemId) * input.quantity,
      0,
    );
    expect(inputs).toBe(mass(ITEM_IDS.resonanceCore));
  });

  it("is a components-and-supplies item with no rarity, Use or teleport action", () => {
    expect(ITEM_CATEGORY_BY_ITEM_ID[ITEM_IDS.resonanceCore]).toBe("components-and-supplies");
    const presentation = getItemPresentation(ITEM_IDS.resonanceCore)!;
    expect(presentation).toMatchObject({
      displayName: "Resonance Core",
      pluralName: "Resonance Cores",
      description:
        "A Runestone suspended in a wired Galvaferrite containment frame. Built as the heart of a larger resonance system.",
    });
    expect(presentation).not.toHaveProperty("rarity");
    expect(presentation.description).not.toMatch(/teleport|travel/i);
  });

  it("ships its optimized derivative and the byte-identical approved master", () => {
    expect(getItemPresentation(ITEM_IDS.resonanceCore)!.artworkSrc).toBe(
      "/item-art/resonance-core.webp",
    );
    expect(existsSync("public/item-art/resonance-core.webp")).toBe(true);
    expect(
      createHash("sha256").update(readFileSync("assets/item-art/resonance-core.png")).digest("hex"),
    ).toBe("b959650ed93f7bac4b1402de8093912d24d2414d5e66e95516bf462b6cc43565");
  });
});

describe("the Resonance Core recipe", () => {
  it("is exactly the locked Fabrication 12 recipe", () => {
    expect(recipe).toEqual({
      actionId: ACTION_IDS.resonanceCoreFabrication,
      outputItemId: ITEM_IDS.resonanceCore,
      outputQuantity: 1,
      minimumLevel: 12,
      durationTicks: 80,
      baseXp: 400,
      inputs: [
        { itemId: ITEM_IDS.runestone, quantity: 1 },
        { itemId: ITEM_IDS.galvaferrite, quantity: 2 },
        { itemId: ITEM_IDS.galvanicWireSpool, quantity: 1 },
      ],
    });
  });

  it("is a Rusk Recovery station action, so it needs no new station", () => {
    const rusk = LOCATIONS.find((location) => location.id === LOCATION_IDS.ruskRecovery)!;
    expect(rusk.availableActionIds).toContain(ACTION_IDS.resonanceCoreFabrication);
    expect(rusk.availableActionIds).toContain(ACTION_IDS.resonanceCoreTinkering);
  });

  it("unlocks at Fabrication 12 and not at 11, with no other gate", () => {
    const unlockedAt = (from: number, to: number) =>
      recipesUnlockedBetween(SKILL_IDS.fabrication, from, to).map((entry) => entry.actionId);
    expect(unlockedAt(1, 11)).not.toContain(ACTION_IDS.resonanceCoreFabrication);
    expect(unlockedAt(11, 12)).toEqual([ACTION_IDS.resonanceCoreFabrication]);
  });
});

describe("the Resonance Core as standard Tinkering", () => {
  const target = tinkeringTargetForActionId(ACTION_IDS.resonanceCoreTinkering, balance)!;

  it("dismantles its own recipe with the universal derived values", () => {
    expect(target.recipe.actionId).toBe(ACTION_IDS.resonanceCoreFabrication);
    expect(tinkeringDurationTicks(target.recipe, balance)).toBe(160);
    expect(tinkeringXp(target.recipe)).toBe(400);
    expect(tinkeringScrapYield(target.recipe, balance)).toBe(2);
  });
});

describe("where the Resonance Core comes from", () => {
  const facts = (level: number) => ({
    skillLevels: { [SKILL_IDS.fabrication]: level },
    acceptedMissionIds: new Set<string>([MISSION_IDS.returnTheFavor, MISSION_IDS.tenThousandHours]),
    completedMissionIds: new Set<string>(),
    fabricationStationUnlocked: true,
    resonanceRigUnlocked: true,
    locationStates: Object.fromEntries(
      LOCATIONS.map((location) => [
        location.id,
        resolveLocationState(location, {
          acceptedMissionIds: new Set<string>(),
          completedRepairTargetIds: new Set<string>(),
        }),
      ]),
    ),
  });

  it("is a Fabrication source plus player trade, never a merchant", () => {
    const sources = resolveItemSources(ITEM_IDS.resonanceCore, facts(12));
    const fabricate = sources.filter((source) => source.kind === "fabricate");
    expect(fabricate).toHaveLength(1);
    expect(fabricate[0]).toMatchObject({
      recipeActionId: ACTION_IDS.resonanceCoreFabrication,
      minimumLevel: 12,
      outputQuantity: 1,
      inputs: recipe.inputs,
    });
    expect(sources.filter((source) => source.kind === "player_trade")).toHaveLength(1);
    expect(sources.filter((source) => source.kind === "merchant")).toEqual([]);
    for (const merchant of MERCHANTS) {
      expect(JSON.stringify(merchant)).not.toContain(ITEM_IDS.resonanceCore);
    }
  });

  it("is tradable, and holding one never needs Fabrication 12", () => {
    expect(isItemTransferable(ITEM_IDS.resonanceCore)).toBe(true);
    const [locked] = resolveItemSources(ITEM_IDS.resonanceCore, facts(11)).filter(
      (source) => source.kind === "fabricate",
    );
    expect(locked?.access).toMatchObject({ state: "locked" });
    expect(
      resolveItemSources(ITEM_IDS.resonanceCore, facts(11)).some(
        (source) => source.kind === "player_trade",
      ),
    ).toBe(true);
  });
});
