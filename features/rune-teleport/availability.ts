import type { PlayGameplayState } from "@/server/play";

/**
 * The browser's advisory view of whether USE RUNE can work right now (#438).
 * It only decides whether the button is offered: the server revalidates
 * everything inside the character lock, so a stale answer here can never make a
 * teleport happen or stop a legitimate one from being refused.
 */
export type RuneTeleportAdvisory = "already_there" | "activity" | "in_transit";

export function runeTeleportAdvisory(
  state: Pick<
    PlayGameplayState,
    "location" | "activeAction" | "travelState" | "ship" | "passenger"
  >,
  destinationLocationId: string,
): RuneTeleportAdvisory | undefined {
  if (state.travelState || state.ship.flight || state.passenger.journey) return "in_transit";
  if (state.activeAction) return "activity";
  if (state.location.currentLocationId === destinationLocationId) return "already_there";
  return undefined;
}

export const RUNE_TELEPORT_ADVISORY_COPY = {
  already_there: "You are already there.",
  activity: "Finish what you are doing first.",
  in_transit: "You cannot teleport while travelling.",
} as const satisfies Record<RuneTeleportAdvisory, string>;
