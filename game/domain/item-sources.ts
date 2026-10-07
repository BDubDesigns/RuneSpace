import {
  fabricationRecipes,
  getEffectiveGameBalance,
  miningSources,
  refiningRecipeIsDeterministic,
  refiningRecipes,
  type EffectiveGameBalance,
} from "@/game/config/balance";
import { ACTION_IDS } from "@/game/config/foundations";
import { LOCAL_PLACES } from "@/game/content/local-places";
import { LOCATIONS } from "@/game/content/locations";
import { isMerchantOpen, MERCHANTS } from "@/game/content/merchants";
import { SCAVENGE_OUTCOMES, type ScavengeOutcome } from "@/game/content/scavenge";
import { STARTING_LEVEL } from "@/game/domain/character-progression";
import { fabricationRecipeUnlocked } from "@/game/domain/fabrication";
import { deriveLocalPlaceAccess } from "@/game/domain/local-places";
import { locationsOfferingAction } from "@/game/domain/location-state";
import { isItemTransferable } from "@/game/domain/player-trade";
import { POWER_ANNEX_CLAIM } from "@/game/domain/power-annex";
import { refiningRecipeUnlocked } from "@/game/domain/refining";
import type { LocalPlaceDefinition } from "@/game/schemas/local-places";
import type { LocationDefinition } from "@/game/schemas/locations";
import type { MerchantDefinition } from "@/game/schemas/merchants";

/**
 * The item-source reference (#326): "how can I get this item?", answered from
 * the content that already owns each way of getting it.
 *
 * Missions say what they need; items expose how they can be obtained. This
 * module is a projection, not a registry. It holds no recipe, price, location
 * or chance of its own — it reads the Fabrication and Refining recipe
 * registries, the Mining source registry, the merchant registry, the location
 * registry, the Scavenge table, and the one fixed claim that exists, and joins
 * them by stable ID. Changing an authored recipe, price or source therefore
 * changes what this reports with no second edit.
 *
 * It is an acquisition reference, not provenance. It never reads Mission
 * rewards, dialogue item beats, admin grants, a Refining failure's byproducts,
 * Practice Welding's Slag, Tinkering's recovered Scrap or Work Order payouts:
 * those are things that can happen to an item, not things a player can set out
 * to do. Keeping them out is structural (none of those modules is imported
 * here), and a unit test pins it.
 *
 * Two different gates are kept apart on purpose:
 *
 * - A DISCOVERY gate is existing story or state progression that has not yet
 *   revealed a system or place (the Fabrication Station before its Mission is
 *   accepted, a merchant before the Mission that opens them, a mine that only
 *   exists in a location's opened state). An undiscovered source is omitted
 *   entirely — it is never listed, and never hinted at.
 * - A CAPABILITY gate is something the character already knows exists but
 *   cannot use yet (a recipe's minimum skill level). The source is listed,
 *   locked, with its concrete gate.
 */

/** What a source asks of the character that they do not yet have. */
export type ItemSourceGate = { kind: "skill_level"; skillId: string; level: number };

export type ItemSourceAccess =
  | { state: "available" }
  | { state: "locked"; gates: readonly ItemSourceGate[] };

/** One item and how many of it, as a recipe consumes it. */
export type ItemSourceInput = { itemId: string; quantity: number };

export type ItemSourceBody =
  | {
      kind: "fabricate";
      recipeActionId: string;
      skillId: string;
      minimumLevel: number;
      /** Where the station is, as this character's state currently resolves it. */
      locationIds: readonly string[];
      inputs: readonly ItemSourceInput[];
      outputQuantity: number;
    }
  | {
      kind: "refine";
      recipeActionId: string;
      skillId: string;
      minimumLevel: number;
      locationIds: readonly string[];
      inputs: readonly ItemSourceInput[];
      outputQuantity: number;
      /** Always succeeds: the recipe has no failure and rolls nothing. */
      deterministic: boolean;
    }
  | {
      kind: "mine";
      sourceActionId: string;
      skillId: string;
      locationIds: readonly string[];
      /** The ore the source is for, or a bonus find turned up beside it. */
      role: "primary" | "secondary";
      /** The source's own ore: what a Secondary Find turns up beside. */
      oreItemId: string;
    }
  | {
      kind: "merchant";
      merchantId: string;
      npcId: string;
      locationId: string;
      /** Present when the merchant keeps shop inside a Local Place. */
      localPlaceId?: string;
      /** Credits per unit: what the merchant charges the player. */
      unitPrice: number;
      /** Authored per-character daily purchase cap, when the line has one. */
      dailyLimit?: number;
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

export type ItemSourceKind = ItemSourceBody["kind"];

export type ItemSource = ItemSourceBody & { access: ItemSourceAccess };

/**
 * A repeatable fixed supply at a place. Only the Power Annex exists; a future
 * one adds an entry beside the system that owns it and joins `fixedClaims`.
 */
export type FixedClaimSource = {
  readonly claimId: string;
  readonly itemId: string;
  readonly quantity: number;
  readonly locationId: string;
  readonly cadence: "daily";
};

/**
 * What the reference needs to know about THIS character. Every part of it is
 * already authoritative state the Play projection carries; nothing here is
 * persisted for this feature.
 */
export type ItemSourceFacts = {
  /** Current level by stable skill ID; an absent skill is at `STARTING_LEVEL`. */
  skillLevels: Readonly<Record<string, number>>;
  /** Missions the character has accepted, including finished ones. */
  acceptedMissionIds: ReadonlySet<string>;
  /** Missions the character has completed (what a Local Place's access reads). */
  completedMissionIds: ReadonlySet<string>;
  /**
   * Whether the Fabrication Station is the character's to use, exactly as the
   * server projects it (`PlayGameplayState.fabricationStation.unlocked`). The
   * rule belongs to the station, so it is carried in, never re-derived here.
   */
  fabricationStationUnlocked: boolean;
  /**
   * Each World Location's actions as THIS character's state resolves them
   * (`PlayGameplayState.locationStates`), so a source that exists only in an
   * opened location state is found only once it has opened.
   */
  locationStates: Readonly<Record<string, { readonly availableActionIds: readonly string[] }>>;
};

/** The authored content the projection reads. Injectable so tests can doctor it. */
export type ItemSourceRegistries = {
  balance: EffectiveGameBalance;
  locations: readonly LocationDefinition[];
  localPlaces: readonly LocalPlaceDefinition[];
  merchants: readonly MerchantDefinition[];
  scavengeOutcomes: readonly ScavengeOutcome[];
  fixedClaims: readonly FixedClaimSource[];
};

export function defaultItemSourceRegistries(): ItemSourceRegistries {
  return {
    balance: getEffectiveGameBalance(),
    locations: LOCATIONS,
    localPlaces: LOCAL_PLACES,
    merchants: MERCHANTS,
    scavengeOutcomes: SCAVENGE_OUTCOMES,
    fixedClaims: [POWER_ANNEX_CLAIM],
  };
}

/** A character's level in a skill; a skill they have no progress in is at the starting level. */
export function itemSourceSkillLevel(facts: ItemSourceFacts, skillId: string): number {
  return facts.skillLevels[skillId] ?? STARTING_LEVEL;
}

/** A recipe gated by `unlocked` is capability-gated: below the level it is locked, not hidden. */
function recipeAccess(unlocked: boolean, skillId: string, minimumLevel: number): ItemSourceAccess {
  return unlocked
    ? { state: "available" }
    : { state: "locked", gates: [{ kind: "skill_level", skillId, level: minimumLevel }] };
}

/**
 * Presentation order, strongest first: what the character can do now, then the
 * occasional walking find, then what is locked behind a level, then trading
 * (which has no price and is always a fallback).
 */
function sourceRank(source: ItemSource): number {
  if (source.kind === "player_trade") return 3;
  if (source.access.state === "locked") return 2;
  return source.kind === "scavenge" ? 1 : 0;
}

/**
 * Every way this character can set out to obtain `itemId`, best first.
 *
 * Undiscovered sources are absent. Within a rank the order is authored order,
 * so a source never moves because another was added. Several recipes that make
 * the same item (Slag, Scrap Metal) are separate sources keyed by recipe — one
 * never replaces another.
 */
export function resolveItemSources(
  itemId: string,
  facts: ItemSourceFacts,
  registries: ItemSourceRegistries = defaultItemSourceRegistries(),
): readonly ItemSource[] {
  const { balance } = registries;
  const sources: ItemSource[] = [];

  // Fabrication: the station is Tansy's to open, so the whole kind is hidden
  // until its Mission is accepted — a character who has not been shown the
  // station is not told it exists.
  if (facts.fabricationStationUnlocked) {
    for (const recipe of fabricationRecipes(balance)) {
      if (recipe.outputItemId !== itemId) continue;
      const locationIds = locationsOfferingAction(
        recipe.actionId,
        facts.locationStates,
        registries.locations,
      );
      if (locationIds.length === 0) continue;
      sources.push({
        kind: "fabricate",
        recipeActionId: recipe.actionId,
        skillId: balance.fabrication.skillId,
        minimumLevel: recipe.minimumLevel,
        locationIds,
        inputs: recipe.inputs.map(({ itemId: inputId, quantity }) => ({
          itemId: inputId,
          quantity,
        })),
        outputQuantity: recipe.outputQuantity,
        access: recipeAccess(
          fabricationRecipeUnlocked(
            itemSourceSkillLevel(facts, balance.fabrication.skillId),
            recipe,
          ),
          balance.fabrication.skillId,
          recipe.minimumLevel,
        ),
      });
    }
  }

  // Refining is hosted by the location's console, not by each recipe, so the
  // console action is what places every recipe.
  const refiningLocationIds = locationsOfferingAction(
    ACTION_IDS.refining,
    facts.locationStates,
    registries.locations,
  );
  if (refiningLocationIds.length > 0) {
    for (const recipe of refiningRecipes(balance)) {
      if (recipe.outputItemId !== itemId) continue;
      sources.push({
        kind: "refine",
        recipeActionId: recipe.actionId,
        skillId: balance.refining.skillId,
        minimumLevel: recipe.minimumLevel,
        locationIds: refiningLocationIds,
        inputs: recipe.inputs.map(({ itemId: inputId, quantity }) => ({
          itemId: inputId,
          quantity,
        })),
        outputQuantity: recipe.outputQuantity,
        deterministic: refiningRecipeIsDeterministic(recipe),
        access: recipeAccess(
          refiningRecipeUnlocked(itemSourceSkillLevel(facts, balance.refining.skillId), recipe),
          balance.refining.skillId,
          recipe.minimumLevel,
        ),
      });
    }
  }

  // Mining: the primary ore, and every source whose Secondary Find table can
  // turn the item up. A source with no reachable mine yet is undiscovered.
  for (const source of miningSources(balance)) {
    const role =
      source.itemId === itemId
        ? "primary"
        : source.secondaryFinds.some((find) => find.itemId === itemId)
          ? "secondary"
          : undefined;
    if (!role) continue;
    const locationIds = locationsOfferingAction(
      source.actionId,
      facts.locationStates,
      registries.locations,
    );
    if (locationIds.length === 0) continue;
    sources.push({
      kind: "mine",
      sourceActionId: source.actionId,
      skillId: balance.mining.skillId,
      locationIds,
      role,
      oreItemId: source.itemId,
      access: { state: "available" },
    });
  }

  // Merchants: only what a merchant SELLS to the player is a source. Buying an
  // item from the player is not. A merchant who is not open to the
  // character, or whose shop is not, has not been revealed.
  for (const merchant of registries.merchants) {
    const line = merchant.prices.find((price) => price.itemId === itemId);
    if (line?.sellPrice === undefined) continue;
    if (!isMerchantOpen(merchant, facts.acceptedMissionIds)) continue;
    const place = registries.localPlaces.find((candidate) => candidate.merchantId === merchant.id);
    const location = registries.locations.find((candidate) => candidate.merchantId === merchant.id);
    const locationId = place?.parentLocationId ?? location?.id;
    if (locationId === undefined) continue;
    if (place && !deriveLocalPlaceAccess(place, facts.completedMissionIds).available) continue;
    sources.push({
      kind: "merchant",
      merchantId: merchant.id,
      npcId: merchant.npcId,
      locationId,
      ...(place ? { localPlaceId: place.id } : {}),
      unitPrice: line.sellPrice,
      ...(line.dailySellLimit !== undefined ? { dailyLimit: line.dailySellLimit } : {}),
      access: { state: "available" },
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
      access: { state: "available" },
    });
  }

  // Scavenge is a luck-of-the-walk find. It reports only that it can happen:
  // the table's odds are deliberately not part of the reference.
  if (registries.scavengeOutcomes.some((outcome) => outcome.itemId === itemId)) {
    sources.push({ kind: "scavenge", access: { state: "available" } });
  }

  // Whether the item may be traded at all is the trade rules' answer, never an
  // assumption made here.
  if (isItemTransferable(itemId, balance)) {
    sources.push({ kind: "player_trade", access: { state: "available" } });
  }

  return sources
    .map((source, index) => ({ source, index }))
    .sort((a, b) => sourceRank(a.source) - sourceRank(b.source) || a.index - b.index)
    .map(({ source }) => source);
}

/**
 * Extend a drill-down path with the next item, or `undefined` when that item
 * is already on the path. Recipes are acyclic today; this is the defensive
 * guard the drill-down uses so a future cycle can never trap the player in a
 * loop of ingredient details.
 */
export function extendItemSourcePath(
  path: readonly string[],
  itemId: string,
): readonly string[] | undefined {
  return path.includes(itemId) ? undefined : [...path, itemId];
}
