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
