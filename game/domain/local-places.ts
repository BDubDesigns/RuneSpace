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
 * Access is derived, never persisted: an authored place is open, permanently
 * locked with an in-world reason, or locked until one authored Mission is
 * completed. The mission-gated rule reads the character's completed Missions —
 * already authoritative state — so a world-state unlock like HH B&B's needs no
 * second `unlocked` flag to keep in sync.
 *
 * `completedMissionIds` is the set of Missions the character has completed.
 * Callers with no mission context supply nothing and mission-gated places stay
 * locked, which is the safe direction: presentation and commands both derive
 * this from the same authoritative state.
 */
export function deriveLocalPlaceAccess(
  place: LocalPlaceDefinition,
  completedMissionIds: ReadonlySet<string> = new Set(),
): LocalPlaceAccess {
  if (place.access.kind === "open") return { available: true };
  if (place.access.kind === "locked") return { available: false, reason: place.access.reason };
  return completedMissionIds.has(place.access.missionId)
    ? { available: true }
    : { available: false, reason: place.access.reason };
}

/**
 * Startup validation for authored Local Place access. A mission-gated place
 * whose Mission does not exist would silently stay locked forever, so it fails
 * fast at module load instead of reaching a player as an unopenable door.
 */
export function validateLocalPlaceAccess(
  places: readonly LocalPlaceDefinition[],
  knownMissionIds: ReadonlySet<string>,
): void {
  for (const place of places) {
    if (place.access.kind !== "locked_until_mission_completed") continue;
    if (!knownMissionIds.has(place.access.missionId)) {
      throw new Error(
        `Local Place "${place.id}" gates access on unknown mission "${place.access.missionId}".`,
      );
    }
  }
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
  completedMissionIds?: ReadonlySet<string>;
}): LocalPlaceDefinition | undefined {
  if (!input.requestedLocalPlaceId) return undefined;
  const place = getLocalPlaceInLocation(input.locationId, input.requestedLocalPlaceId);
  if (!place) return undefined;
  return deriveLocalPlaceAccess(place, input.completedMissionIds).available ? place : undefined;
}
