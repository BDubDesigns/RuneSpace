import { getLocation } from "@/game/content/locations";
import type { LocationDefinition, LocationStateVariant } from "@/game/schemas/locations";

/**
 * Deriving a World Location's current player-facing state (#209).
 *
 * Deep Jag is the first location whose state changes durably: it is visible
 * from the beginning as an impassable cave-in, becomes reachable when Tansy's
 * Brace Yourself is accepted, and becomes a working mine the moment the brace
 * is welded in. This module is the one place that resolves that, so nothing
 * anywhere else needs `if (locationId === deepJag && ...)`.
 *
 * Two rules keep this narrow rather than becoming a world-event engine:
 *
 * 1. It derives from facts the game already owns authoritatively — which
 *    Missions a character has accepted, and which repair targets they have
 *    completed. It never reads or writes a state flag of its own, which is why
 *    there is no `deep_jag_open` column to drift from the repair record.
 * 2. It resolves presentation and access only. It grants nothing, consumes
 *    nothing, and decides no outcome.
 */
export type LocationStateFacts = {
  acceptedMissionIds: ReadonlySet<string>;
  completedRepairTargetIds: ReadonlySet<string>;
};

export const NO_LOCATION_STATE_FACTS: LocationStateFacts = {
  acceptedMissionIds: new Set<string>(),
  completedRepairTargetIds: new Set<string>(),
};

/** One location's resolved presentation and access for one character. */
export type ResolvedLocationState = {
  locationId: string;
  /** The winning variant's ID, or undefined when the base state applies. */
  variantId?: string;
  description: string;
  /** Whether an authored walking edge into this location may currently be used. */
  travelable: boolean;
  /** The Map's short gameplay status, when the location authors one. */
  mapStatus?: string;
  availableActionIds: readonly string[];
  scene: LocationDefinition["presentation"]["scene"];
};

function variantSatisfied(variant: LocationStateVariant, facts: LocationStateFacts): boolean {
  const { acceptedMissionId, completedRepairTargetId } = variant.requires;
  if (acceptedMissionId != null && !facts.acceptedMissionIds.has(acceptedMissionId)) return false;
  if (
    completedRepairTargetId != null &&
    !facts.completedRepairTargetIds.has(completedRepairTargetId)
  ) {
    return false;
  }
  return true;
}

/**
 * Resolve one location's current state. Variants are authored most specific
 * first, so the first satisfied variant wins and the base fields fill the rest.
 */
export function resolveLocationState(
  location: LocationDefinition,
  facts: LocationStateFacts = NO_LOCATION_STATE_FACTS,
): ResolvedLocationState {
  const variant = location.stateVariants.find((candidate) => variantSatisfied(candidate, facts));
  return {
    locationId: location.id,
    ...(variant ? { variantId: variant.id } : {}),
    description: variant?.description ?? location.description,
    travelable: variant?.travelable ?? location.travelable,
    ...((variant?.mapStatus ?? location.mapStatus)
      ? { mapStatus: variant?.mapStatus ?? location.mapStatus }
      : {}),
    availableActionIds: variant?.availableActionIds ?? location.availableActionIds,
    scene: variant?.scene ?? location.presentation.scene,
  };
}

/** Resolve by stable ID, or undefined for an unknown location. */
export function resolveLocationStateById(
  locationId: string,
  facts: LocationStateFacts = NO_LOCATION_STATE_FACTS,
): ResolvedLocationState | undefined {
  const location = getLocation(locationId);
  return location ? resolveLocationState(location, facts) : undefined;
}

/**
 * Whether the character may currently walk into this location.
 *
 * Travel legality still requires an authored adjacency edge; this is the extra
 * question adjacency alone cannot answer, and the server consults it before
 * accepting a begin-travel command so a forged request cannot reach a
 * collapsed Deep Jag.
 */
export function isLocationTravelable(locationId: string, facts: LocationStateFacts): boolean {
  return resolveLocationStateById(locationId, facts)?.travelable ?? false;
}

/** Whether the location currently hosts the given authoritative action. */
export function isActionAvailableInLocationState(
  locationId: string,
  actionId: string,
  facts: LocationStateFacts,
): boolean {
  return (
    resolveLocationStateById(locationId, facts)?.availableActionIds.includes(actionId) ?? false
  );
}

/**
 * Startup validation for authored state variants.
 *
 * A variant that references an unknown Mission or repair target, or that can
 * never be reached because a broader variant is authored ahead of it, would
 * reach a player as a location that silently never changes.
 */
export function validateLocationStateVariants(
  locations: readonly LocationDefinition[],
  knownMissionIds: ReadonlySet<string>,
  knownRepairTargetIds: ReadonlySet<string>,
): void {
  for (const location of locations) {
    const seen = new Set<string>();
    for (const variant of location.stateVariants) {
      const where = `Location "${location.id}" state variant "${variant.id}"`;
      if (seen.has(variant.id)) throw new Error(`${where} is authored more than once.`);
      seen.add(variant.id);
      const { acceptedMissionId, completedRepairTargetId } = variant.requires;
      if (acceptedMissionId != null && !knownMissionIds.has(acceptedMissionId)) {
        throw new Error(`${where} requires unknown mission "${acceptedMissionId}".`);
      }
      if (completedRepairTargetId != null && !knownRepairTargetIds.has(completedRepairTargetId)) {
        throw new Error(`${where} requires unknown repair target "${completedRepairTargetId}".`);
      }
    }
  }
}
