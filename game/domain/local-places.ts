import { getLocalPlaceInLocation } from "@/game/content/local-places";
import type { LocalPlaceDefinition } from "@/game/schemas/local-places";

/**
 * The derived access result presentation and server commands both consume.
 *
 * Presentation asks this one question — "may I enter, and if not what do I tell
 * the player?" — instead of testing for a named building. A locked place stays
 * visible; only entry is refused.
 */
export type LocalPlaceAccess = { available: true } | { available: false; reason: string };

/**
 * The single semantic Local Place access predicate.
 *
 * It currently depends only on authored content, because the approved
 * foundation needs exactly two outcomes: open places, and HH B&B locked with an
 * in-world reason. Keeping the derivation behind this function is what lets a
 * later Mission/world-state unlock change the inputs without rewriting the
 * Local Place system or scattering building-specific checks through React.
 */
export function deriveLocalPlaceAccess(place: LocalPlaceDefinition): LocalPlaceAccess {
  return place.access.kind === "open"
    ? { available: true }
    : { available: false, reason: place.access.reason };
}

/**
 * The single interpretation of "which Local Place is the player actually in".
 *
 * Navigation state is a request, not a fact: the id in the route may name a
 * place that does not exist, belongs to a different World Location, or is
 * locked. Only a place that passes all three checks counts as active, and every
 * presentation surface reads that one answer — the place surface and the
 * resident it hosts can never disagree about where the player is.
 *
 * This is presentation's shared reading of the same content and access rules the
 * server applies; it never replaces the server's own independent validation.
 */
export function resolveActiveLocalPlace(input: {
  locationId: string;
  requestedLocalPlaceId?: string;
}): LocalPlaceDefinition | undefined {
  if (!input.requestedLocalPlaceId) return undefined;
  const place = getLocalPlaceInLocation(input.locationId, input.requestedLocalPlaceId);
  if (!place) return undefined;
  return deriveLocalPlaceAccess(place).available ? place : undefined;
}
