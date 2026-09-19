import type { PlayGameplayState } from "@/server/play";

/**
 * Player-facing copy for an authoritative travel refusal.
 *
 * Shared by the Map's walking controls and the Crew Hauler ride controls so a
 * refusal reads the same wherever the player triggered it. The reasons
 * themselves are server-owned; this only renders them.
 */
export function travelErrorMessage(reason: NonNullable<PlayGameplayState["travelError"]>): string {
  return {
    unknown_destination: "That destination is not a known location.",
    same_location: "You are already at that location.",
    not_adjacent: "You can only travel to a directly adjacent location.",
    // The route exists on the map and is simply not passable yet (#209). Kept
    // distinct from `not_adjacent` so a collapsed Deep Jag never reads as
    // though The Jag does not connect to it.
    route_blocked: "That way is blocked.",
    already_traveling: "You are already traveling. Arrival must complete first.",
    mining_unavailable_here: "Mining is not available at this location.",
    unknown_route: "No ride runs that way.",
    route_locked: "The crew do not know you well enough for that yet.",
    insufficient_credits: "You cannot cover the fare.",
  }[reason];
}
