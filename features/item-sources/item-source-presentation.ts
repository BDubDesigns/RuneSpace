import { itemQuantityLabel, resolveItemPresentation } from "@/game/content/item-presentation";
import { getLocalPlace } from "@/game/content/local-places";
import { getLocation } from "@/game/content/locations";
import { getNpc } from "@/game/content/npcs";
import { getSkillPresentation } from "@/game/content/skill-presentation";
import {
  itemSourceSkillLevel,
  type ItemSource,
  type ItemSourceFacts,
  type ItemSourceKind,
} from "@/game/domain/item-sources";

/**
 * Player-facing wording for an item source (#326). The projection
 * (`game/domain/item-sources.ts`) decides WHAT the sources are; this decides
 * only how each reads. Every number and name shown is taken from the source it
 * describes or the content registry that owns the name — no recipe, price or
 * quantity is written here — so a changed authored value reads correctly with
 * no edit to this file.
 */

export type ItemSourceInputLine = {
  itemId: string;
  /** "3 Refined Ferrite", in the item's authored singular or plural. */
  label: string;
};

export type ItemSourceDescription = {
  /** Stable within one item's list: the recipe, merchant, claim or kind. */
  key: string;
  kind: ItemSourceKind;
  /** The way of getting it: "Fabricate", "Buy", "Player trade". */
  title: string;
  /** Where it happens, when it happens somewhere. */
  where?: string;
  /** The skill and level it asks for, when it asks for one. */
  requirement?: string;
  /** Present exactly when the source is locked: the concrete gate, in words. */
  locked?: string;
  /** Short qualitative facts, one per line. */
  notes: readonly string[];
  /** Credits per unit, for a merchant. */
  price?: number;
  /** What a recipe consumes, each inspectable as an item of its own. */
  inputs?: readonly ItemSourceInputLine[];
  /** What a recipe makes, e.g. "Makes 2 Power Cells". */
  yields?: string;
};

/** An item's player-facing name, from its authored presentation. */
export function itemName(itemId: string): string {
  return resolveItemPresentation(itemId, itemId).displayName;
}

function locationNames(locationIds: readonly string[]): string {
  return locationIds.map((id) => getLocation(id)?.displayName ?? id).join(" or ");
}

function skillRequirement(skillId: string, level: number): string {
  return `${getSkillPresentation(skillId)?.displayName ?? skillId} ${level}`;
}

function lockedReason(source: ItemSource, facts: ItemSourceFacts): string | undefined {
  if (source.access.state !== "locked") return undefined;
  return source.access.gates
    .map((gate) => {
      const have = itemSourceSkillLevel(facts, gate.skillId);
      return `Requires ${skillRequirement(gate.skillId, gate.level)} — you are ${have}`;
    })
    .join("; ");
}

function inputLines(inputs: readonly { itemId: string; quantity: number }[]) {
  return inputs.map((input) => ({
    itemId: input.itemId,
    label: itemQuantityLabel(input.itemId, input.quantity, itemName(input.itemId)),
  }));
}

/** Describe one source for display. */
export function describeItemSource(
  itemId: string,
  source: ItemSource,
  facts: ItemSourceFacts,
): ItemSourceDescription {
  const locked = lockedReason(source, facts);
  const base = { notes: [] as string[], ...(locked ? { locked } : {}) };
  switch (source.kind) {
    case "fabricate":
      return {
        ...base,
        key: source.recipeActionId,
        kind: source.kind,
        title: "Fabricate",
        where: locationNames(source.locationIds),
        requirement: skillRequirement(source.skillId, source.minimumLevel),
        inputs: inputLines(source.inputs),
        yields: `Makes ${itemQuantityLabel(itemId, source.outputQuantity, itemName(itemId))}`,
      };
    case "refine":
      return {
        ...base,
        key: source.recipeActionId,
        kind: source.kind,
        title: "Refine",
        where: locationNames(source.locationIds),
        requirement: skillRequirement(source.skillId, source.minimumLevel),
        notes: source.deterministic ? ["Never fails"] : [],
        inputs: inputLines(source.inputs),
        yields: `Makes ${itemQuantityLabel(itemId, source.outputQuantity, itemName(itemId))}`,
      };
    case "mine":
      return {
        ...base,
        key: source.sourceActionId,
        kind: source.kind,
        title: "Mine",
        where: locationNames(source.locationIds),
        notes:
          source.role === "primary"
            ? []
            : [`Occasionally turns up while mining ${itemName(source.oreItemId)}`],
      };
    case "merchant": {
      const place = source.localPlaceId ? getLocalPlace(source.localPlaceId) : undefined;
      const where = [place?.displayName, getLocation(source.locationId)?.displayName]
        .filter(Boolean)
        .join(", ");
      return {
        ...base,
        key: source.merchantId,
        kind: source.kind,
        title: "Buy",
        where: `${getNpc(source.npcId)?.displayName ?? "Merchant"} — ${where}`,
        price: source.unitPrice,
        notes: source.dailyLimit === undefined ? [] : [`Up to ${source.dailyLimit} a day`],
      };
    }
    case "fixed_claim":
      return {
        ...base,
        key: source.claimId,
        kind: source.kind,
        title: "Daily claim",
        where: getLocation(source.locationId)?.displayName ?? source.locationId,
        notes: [`${itemQuantityLabel(itemId, source.quantity, itemName(itemId))} once a day`],
      };
    case "scavenge":
      return {
        ...base,
        key: "scavenge",
        kind: source.kind,
        title: "Scavenge",
        notes: ["Occasionally found while walking"],
      };
    case "player_trade":
      return {
        ...base,
        key: "player_trade",
        kind: source.kind,
        title: "Player trade",
        notes: ["Tradable — players set their own terms"],
      };
  }
}

export function describeItemSources(
  itemId: string,
  sources: readonly ItemSource[],
  facts: ItemSourceFacts,
): readonly ItemSourceDescription[] {
  return sources.map((source) => describeItemSource(itemId, source, facts));
}
