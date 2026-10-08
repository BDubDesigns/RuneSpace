import {
  fabricationRecipes,
  getEffectiveGameBalance,
  getEquipmentDefinition,
  getItemDefinition,
  miningSources,
  refiningRecipeIsDeterministic,
  refiningRecipes,
  repairTargetBalances,
  type EffectiveGameBalance,
  type EquipmentDefinition,
  type ItemDefinition,
  type RepairTargetBalance,
} from "@/game/config/balance";
import { ACTION_IDS } from "@/game/config/foundations";
import { LOCAL_PLACES } from "@/game/content/local-places";
import { LOCATIONS } from "@/game/content/locations";
import { MERCHANTS } from "@/game/content/merchants";
import { MISSIONS, type MissionDefinition } from "@/game/content/missions";
import { REPAIR_TARGETS, type RepairTargetDefinition } from "@/game/content/repair-targets";
import { SCAVENGE_OUTCOMES, type ScavengeOutcome } from "@/game/content/scavenge";
import { isItemTransferable } from "@/game/domain/player-trade";
import { POWER_ANNEX_CLAIM } from "@/game/domain/power-annex";
import type { FixedClaimSource } from "@/game/domain/item-sources";
import type { LocalPlaceDefinition } from "@/game/schemas/local-places";
import type { LocationDefinition } from "@/game/schemas/locations";
import type { MerchantDefinition } from "@/game/schemas/merchants";

/**
 * The PUBLIC item reference (#338): everything the Wiki says about one shipped
 * item, derived from the registries that own it.
 *
 * It is deliberately not the in-game source resolver (`item-sources.ts`, #326).
 * That one answers "what can THIS character do right now", so it hides what the
 * character has not discovered. The Wiki is spoiler-complete about shipped
 * gameplay and has no character, so this projection lists every authored source
 * and states each gate as a requirement. Nothing here reads a character, and
 * nothing here is shared with the resolver except the pure facts both read
 * (`isItemTransferable`, `POWER_ANNEX_CLAIM`, the registries themselves).
 *
 * Like the resolver it holds no recipe, price, chance or quantity of its own:
 * a changed authored value changes the reference with no second edit.
 *
 * Three groups are kept apart on purpose. `sources` are things a player can set
 * out to do again and again. `oneTime` are Mission payouts and hand-overs, and
 * `byproducts` are what a Refining failure can leave behind — real, but neither
 * a method of getting the item nor repeatable on demand.
 */

export type ItemReferenceInput = { itemId: string; quantity: number };

/** What a World Location needs before it hosts an action, when it is not there from the start. */
export type ItemReferenceLocationGate =
  | { kind: "repair_target"; repairTargetId: string }
  | { kind: "mission"; missionId: string };

export type ItemReferenceLocation = {
  locationId: string;
  gate?: ItemReferenceLocationGate;
};

export type ItemReferenceRecipe =
  | {
      kind: "fabricate";
      actionId: string;
      outputItemId: string;
      skillId: string;
      minimumLevel: number;
      locations: readonly ItemReferenceLocation[];
      inputs: readonly ItemReferenceInput[];
      outputQuantity: number;
    }
  | {
      kind: "refine";
      actionId: string;
      outputItemId: string;
      skillId: string;
      minimumLevel: number;
      locations: readonly ItemReferenceLocation[];
      inputs: readonly ItemReferenceInput[];
      outputQuantity: number;
      /** Always succeeds: the recipe rolls nothing and has no failure. */
      deterministic: boolean;
      /** What an unsuccessful attempt hands back, for a recipe that can fail. */
      failure?:
        | { kind: "fixed_outputs"; outputs: readonly ItemReferenceInput[] }
        | { kind: "one_input_returned" };
    };

export type ItemReferenceSource =
  | { kind: "fabricate"; recipe: Extract<ItemReferenceRecipe, { kind: "fabricate" }> }
  | { kind: "refine"; recipe: Extract<ItemReferenceRecipe, { kind: "refine" }> }
  | {
      kind: "mine";
      actionId: string;
      skillId: string;
      locations: readonly ItemReferenceLocation[];
      role: "primary" | "secondary";
      /** The source's own ore: what a Secondary Find turns up beside. */
      oreItemId: string;
      /**
       * Present for a Secondary Find only: the authored `oneIn`, which is the
       * chance per SUCCESSFUL extraction (never per attempt) of this one find.
       */
      oneInPerSuccess?: number;
    }
  | {
      kind: "merchant";
      merchantId: string;
      npcId: string;
      locationId: string;
      localPlaceId?: string;
      /** Credits per unit the merchant charges the player. */
      unitPrice: number;
      dailyLimit?: number;
      /** The Mission whose acceptance opens the merchant, when one does. */
      opensWithMissionId?: string;
      /** The Mission whose completion opens the shop's Local Place, when one does. */
      placeOpensWithMissionId?: string;
    }
  | {
      kind: "fixed_claim";
      claimId: string;
      locationId: string;
      quantity: number;
      cadence: "daily";
    }
  | { kind: "scavenge" }
  | { kind: "player_trade" };

export type ItemReferenceOneTime =
  | { kind: "mission_reward"; missionId: string; quantity: number }
  | { kind: "mission_hand_over"; missionId: string; quantity: number };

export type ItemReferenceByproduct = {
  /** The Refining recipe whose failure can leave this item behind. */
  recipeActionId: string;
  /** What that recipe refines: the item a player was trying to make. */
  recipeOutputItemId: string;
  quantity: number;
};

export type ItemReferenceUse =
  | {
      kind: "recipe_input";
      recipeKind: "fabricate" | "refine";
      actionId: string;
      outputItemId: string;
      quantity: number;
    }
  | {
      kind: "repair";
      repairTargetId: string;
      quantity: number;
    }
  | {
      kind: "mission_requirement";
      missionId: string;
      /** show: inspected only; consume: handed in; equip: must be equipped. */
      disposition: "show" | "consume" | "equip";
      quantity?: number;
    };

export type ItemReferenceProperties = {
  definition: ItemDefinition;
  equipment?: EquipmentDefinition;
};

export type ItemReference = {
  itemId: string;
  properties: ItemReferenceProperties;
  sources: readonly ItemReferenceSource[];
  oneTime: readonly ItemReferenceOneTime[];
  byproducts: readonly ItemReferenceByproduct[];
  recipes: readonly ItemReferenceRecipe[];
  uses: readonly ItemReferenceUse[];
};

/** The authored content the reference reads. Injectable so tests can doctor it. */
export type ItemReferenceRegistries = {
  balance: EffectiveGameBalance;
  locations: readonly LocationDefinition[];
  localPlaces: readonly LocalPlaceDefinition[];
  merchants: readonly MerchantDefinition[];
  scavengeOutcomes: readonly ScavengeOutcome[];
  fixedClaims: readonly FixedClaimSource[];
  repairTargets: readonly RepairTargetDefinition[];
  missions: readonly MissionDefinition[];
};

export function defaultItemReferenceRegistries(): ItemReferenceRegistries {
  return {
    balance: getEffectiveGameBalance(),
    locations: LOCATIONS,
    localPlaces: LOCAL_PLACES,
    merchants: MERCHANTS,
    scavengeOutcomes: SCAVENGE_OUTCOMES,
    fixedClaims: [POWER_ANNEX_CLAIM],
    repairTargets: REPAIR_TARGETS,
    missions: MISSIONS,
  };
}

/**
 * Every World Location that EVER hosts an action, in authored location order.
 * A location whose base state lacks the action but whose state variant adds it
 * (Deep Jag's Galvanite mine) is reported with the variant's requirement as its
 * gate, never hidden: the Wiki states the requirement and the character-aware
 * resolver is what decides whether a given player has met it.
 */
export function locationsHostingAction(
  actionId: string,
  locations: readonly LocationDefinition[],
): readonly ItemReferenceLocation[] {
  const hosting: ItemReferenceLocation[] = [];
  for (const location of locations) {
    if (location.availableActionIds.includes(actionId)) {
      hosting.push({ locationId: location.id });
      continue;
    }
    const variant = location.stateVariants.find((candidate) =>
      candidate.availableActionIds?.includes(actionId),
    );
    if (!variant) continue;
    const { acceptedMissionId, completedRepairTargetId } = variant.requires;
    hosting.push({
      locationId: location.id,
      ...(completedRepairTargetId != null
        ? { gate: { kind: "repair_target", repairTargetId: completedRepairTargetId } as const }
        : acceptedMissionId != null
          ? { gate: { kind: "mission", missionId: acceptedMissionId } as const }
          : {}),
    });
  }
  return hosting;
}

function inputsOf(inputs: readonly ItemReferenceInput[]): ItemReferenceInput[] {
  return inputs.map(({ itemId, quantity }) => ({ itemId, quantity }));
}

/** Every Fabrication and Refining recipe, as a public recipe record, in authored order. */
export function publicRecipes(registries: ItemReferenceRegistries): readonly ItemReferenceRecipe[] {
  const { balance, locations } = registries;
  const recipes: ItemReferenceRecipe[] = [];
  for (const recipe of fabricationRecipes(balance)) {
    recipes.push({
      kind: "fabricate",
      actionId: recipe.actionId,
      outputItemId: recipe.outputItemId,
      skillId: balance.fabrication.skillId,
      minimumLevel: recipe.minimumLevel,
      locations: locationsHostingAction(recipe.actionId, locations),
      inputs: inputsOf(recipe.inputs),
      outputQuantity: recipe.outputQuantity,
    });
  }
  // Refining is hosted by the location's console, not by each recipe.
  const refiningLocations = locationsHostingAction(ACTION_IDS.refining, locations);
  for (const recipe of refiningRecipes(balance)) {
    const deterministic = refiningRecipeIsDeterministic(recipe);
    recipes.push({
      kind: "refine",
      actionId: recipe.actionId,
      outputItemId: recipe.outputItemId,
      skillId: balance.refining.skillId,
      minimumLevel: recipe.minimumLevel,
      locations: refiningLocations,
      inputs: inputsOf(recipe.inputs),
      outputQuantity: recipe.outputQuantity,
      deterministic,
      ...(deterministic
        ? {}
        : recipe.failure.kind === "fixed_outputs"
          ? {
              failure: {
                kind: "fixed_outputs" as const,
                outputs: inputsOf(recipe.failure.outputs),
              },
            }
          : recipe.failure.kind === "one_input_returned"
            ? { failure: { kind: "one_input_returned" as const } }
            : {}),
    });
  }
  return recipes;
}

function materialsOf(target: RepairTargetBalance): readonly ItemReferenceInput[] {
  return target.materials;
}

/** Mission requirements that name an item, without repeating a repair a Mission only observes. */
function missionItemUses(itemId: string, missions: readonly MissionDefinition[]) {
  const uses: ItemReferenceUse[] = [];
  for (const mission of missions) {
    for (const requirement of mission.requirements) {
      if (requirement.kind === "equipped_item" && requirement.itemId === itemId) {
        uses.push({ kind: "mission_requirement", missionId: mission.id, disposition: "equip" });
      } else if (requirement.kind === "carried_stack" && requirement.itemId === itemId) {
        uses.push({
          kind: "mission_requirement",
          missionId: mission.id,
          disposition: requirement.turnIn === "show" ? "show" : "consume",
          ...(requirement.quantity !== undefined ? { quantity: requirement.quantity } : {}),
        });
      } else if (requirement.kind === "carried_unique_item" && requirement.itemId === itemId) {
        uses.push({
          kind: "mission_requirement",
          missionId: mission.id,
          disposition: requirement.turnIn === "show" ? "show" : "consume",
          quantity: 1,
        });
      }
    }
  }
  return uses;
}

function oneTimeFor(itemId: string, missions: readonly MissionDefinition[]) {
  const oneTime: ItemReferenceOneTime[] = [];
  for (const mission of missions) {
    const { reward } = mission;
    if (reward?.kind === "item" && reward.itemId === itemId) {
      oneTime.push({ kind: "mission_reward", missionId: mission.id, quantity: 1 });
    } else if (reward?.kind === "stack_bundle") {
      for (const line of reward.items) {
        if (line.itemId === itemId) {
          oneTime.push({ kind: "mission_reward", missionId: mission.id, quantity: line.quantity });
        }
      }
    }
    for (const offer of mission.offers) {
      const effect = offer.acceptEffect;
      if (effect?.kind === "stack_item" && effect.itemId === itemId) {
        // Several offer routes hand over the same thing; one line per Mission.
        if (
          !oneTime.some(
            (line) => line.kind === "mission_hand_over" && line.missionId === mission.id,
          )
        ) {
          oneTime.push({
            kind: "mission_hand_over",
            missionId: mission.id,
            quantity: effect.quantity,
          });
        }
      }
    }
  }
  return oneTime;
}

/**
 * The public reference for one shipped item, or `undefined` when the item has
 * no authoritative inventory definition (it is not a shipped item).
 */
export function buildItemReference(
  itemId: string,
  registries: ItemReferenceRegistries = defaultItemReferenceRegistries(),
): ItemReference | undefined {
  const { balance } = registries;
  const definition = getItemDefinition(itemId, balance);
  if (!definition) return undefined;
  const equipment = getEquipmentDefinition(itemId, balance);

  const allRecipes = publicRecipes(registries);
  const recipes = allRecipes.filter((recipe) => recipe.outputItemId === itemId);

  const sources: ItemReferenceSource[] = recipes.map((recipe) =>
    recipe.kind === "fabricate"
      ? { kind: "fabricate" as const, recipe }
      : { kind: "refine" as const, recipe },
  );

  for (const source of miningSources(balance)) {
    const find = source.secondaryFinds.find((candidate) => candidate.itemId === itemId);
    const role = source.itemId === itemId ? "primary" : find ? "secondary" : undefined;
    if (!role) continue;
    sources.push({
      kind: "mine",
      actionId: source.actionId,
      skillId: balance.mining.skillId,
      locations: locationsHostingAction(source.actionId, registries.locations),
      role,
      oreItemId: source.itemId,
      ...(find ? { oneInPerSuccess: find.oneIn } : {}),
    });
  }

  for (const merchant of registries.merchants) {
    const line = merchant.prices.find((price) => price.itemId === itemId);
    // Only what a merchant SELLS to the player is a source; a buy price is not.
    if (line?.sellPrice === undefined) continue;
    const place = registries.localPlaces.find((candidate) => candidate.merchantId === merchant.id);
    const location = registries.locations.find((candidate) => candidate.merchantId === merchant.id);
    const locationId = place?.parentLocationId ?? location?.id;
    if (locationId === undefined) continue;
    sources.push({
      kind: "merchant",
      merchantId: merchant.id,
      npcId: merchant.npcId,
      locationId,
      ...(place ? { localPlaceId: place.id } : {}),
      unitPrice: line.sellPrice,
      ...(line.dailySellLimit !== undefined ? { dailyLimit: line.dailySellLimit } : {}),
      ...(merchant.authorizingMissionId !== undefined
        ? { opensWithMissionId: merchant.authorizingMissionId }
        : {}),
      ...(place?.access.kind === "locked_until_mission_completed"
        ? { placeOpensWithMissionId: place.access.missionId }
        : {}),
    });
  }

  for (const claim of registries.fixedClaims) {
    if (claim.itemId !== itemId) continue;
    sources.push({
      kind: "fixed_claim",
      claimId: claim.claimId,
      locationId: claim.locationId,
      quantity: claim.quantity,
      cadence: claim.cadence,
    });
  }

  if (registries.scavengeOutcomes.some((outcome) => outcome.itemId === itemId)) {
    sources.push({ kind: "scavenge" });
  }
  if (isItemTransferable(itemId, balance)) sources.push({ kind: "player_trade" });

  // Failure byproducts: a Refining failure's fixed outputs. Separate from
  // `sources` because a player cannot set out to fail.
  const byproducts: ItemReferenceByproduct[] = [];
  for (const recipe of allRecipes) {
    if (recipe.kind !== "refine" || recipe.failure?.kind !== "fixed_outputs") continue;
    for (const output of recipe.failure.outputs) {
      if (output.itemId === itemId) {
        byproducts.push({
          recipeActionId: recipe.actionId,
          recipeOutputItemId: recipe.outputItemId,
          quantity: output.quantity,
        });
      }
    }
  }

  const uses: ItemReferenceUse[] = [];
  for (const recipe of allRecipes) {
    const input = recipe.inputs.find((candidate) => candidate.itemId === itemId);
    if (!input) continue;
    uses.push({
      kind: "recipe_input",
      recipeKind: recipe.kind,
      actionId: recipe.actionId,
      outputItemId: recipe.outputItemId,
      quantity: input.quantity,
    });
  }
  for (const target of registries.repairTargets) {
    const balanceTarget = repairTargetBalances(balance).find(
      (candidate) => candidate.targetId === target.id,
    );
    const material = balanceTarget
      ? materialsOf(balanceTarget).find((candidate) => candidate.itemId === itemId)
      : undefined;
    if (material) {
      uses.push({ kind: "repair", repairTargetId: target.id, quantity: material.quantity });
    }
  }
  uses.push(...missionItemUses(itemId, registries.missions));

  return {
    itemId,
    properties: { definition, ...(equipment ? { equipment } : {}) },
    sources,
    oneTime: oneTimeFor(itemId, registries.missions),
    byproducts,
    recipes,
    uses,
  };
}
