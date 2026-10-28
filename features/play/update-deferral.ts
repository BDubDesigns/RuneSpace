import type { PlayGameplayState } from "@/server/play";

/**
 * What keeps an automatic update reload (issue #412) waiting inside Play.
 * Only interactions that are time-sensitive or in flight defer it. Mining,
 * Refining, Travel and Flight are persisted on the server and reconcile on
 * load, so they never do.
 */
export type PlayUpdateSnapshot = {
  /** A player command or background reconciliation holds the command gate. */
  commandInFlight: boolean;
  /** The accepted Trade session this character is in, if any. */
  tradeSessionOpen: boolean;
  state: Pick<PlayGameplayState, "travelState" | "scavengeReveals">;
  /** The server's current time, in ms. */
  serverNowMs: number;
};

export type PlayUpdateDeferral =
  | "command-in-flight"
  | "trade-session"
  | "scavenge-window"
  | "scavenge-reveal";

export function playUpdateDeferral(snapshot: PlayUpdateSnapshot): PlayUpdateDeferral | undefined {
  if (snapshot.commandInFlight) return "command-in-flight";
  if (snapshot.tradeSessionOpen) return "trade-session";
  if (snapshot.state.scavengeReveals.length > 0) return "scavenge-reveal";
  const scavenge = snapshot.state.travelState?.scavenge;
  // Unclaimed and not yet expired, whether or not it has opened: the claim is
  // what the player is waiting to make. A claimed window already has its reveal.
  if (scavenge && !scavenge.outcome && snapshot.serverNowMs < Date.parse(scavenge.expiresAt))
    return "scavenge-window";
  return undefined;
}
