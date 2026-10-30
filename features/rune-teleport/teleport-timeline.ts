import type { PlayGameplayState } from "@/server/play";
import type { TeleportWithRuneActionResult } from "@/server/actions";

/**
 * The teleport cinematic's authored timing and its outcome rules (#438).
 *
 * Presentation only: nothing here decides whether a teleport happened. The
 * server's result, or on an uncertain transport the server's re-read state and
 * durable receipt, is the only thing that does.
 */

export type TeleportPhase = "idle" | "destabilize" | "collapse" | "reveal";

/** Milliseconds each phase takes. Reduced motion skips the breakup for a short fade. */
export type TeleportDurations = {
  /** A: the visible UI comes apart. */
  destabilize: number;
  /** B: everything fades behind fully opaque black. */
  collapse: number;
  /** C: the black lifts and the (new or restored) world reassembles. */
  reveal: number;
};

export const TELEPORT_DURATIONS: TeleportDurations = {
  destabilize: 1_200,
  collapse: 350,
  reveal: 600,
};

export const TELEPORT_REDUCED_DURATIONS: TeleportDurations = {
  destabilize: 0,
  collapse: 180,
  reveal: 180,
};

export function teleportDurations(reducedMotion: boolean): TeleportDurations {
  return reducedMotion ? TELEPORT_REDUCED_DURATIONS : TELEPORT_DURATIONS;
}

/**
 * How long the browser waits on the command, and then on the re-read that
 * settles an uncertain one, before it stops waiting and lets the player see the
 * world again. The black is never held open beyond these.
 */
export const TELEPORT_COMMAND_TIMEOUT_MS = 15_000;
export const TELEPORT_RECONCILE_TIMEOUT_MS = 10_000;

export type TeleportOutcome =
  /** The server confirmed the teleport (now, or an earlier request for this intent). */
  | { kind: "teleported"; state: PlayGameplayState }
  /** The server refused: nothing was consumed or moved. `state` is its current truth. */
  | { kind: "refused"; message: string; state: PlayGameplayState }
  /** The command could not be ruled on and the re-read says nothing happened. */
  | { kind: "unchanged"; message: string; state: PlayGameplayState }
  /** Neither the command nor the re-read could be confirmed. */
  | { kind: "unknown"; message: string };

export const UNCONFIRMED_MESSAGE =
  "Comms interruption. The teleport could not be confirmed. Check your Inventory before trying again.";
export const UNCHANGED_MESSAGE =
  "Comms interruption. Your Inventory was re-read and nothing was used. You can try again.";

/** The player-facing result of a command the server answered. */
export function outcomeOfAction(result: TeleportWithRuneActionResult): TeleportOutcome | undefined {
  if ("error" in result) return undefined;
  return result.teleport.status === "teleported"
    ? { kind: "teleported", state: result.state }
    : { kind: "refused", message: result.teleport.message, state: result.state };
}

/**
 * Decide an uncertain command from a fresh authoritative read. The durable
 * receipt names the intent that produced it, so this teleport (or another tab's
 * request that settled the same intent) is recognised; absent that receipt the
 * rune was not used by this intent, and nothing is assumed or refunded.
 */
export function outcomeOfReread(
  state: PlayGameplayState | undefined,
  intentId: string,
): TeleportOutcome {
  if (!state) return { kind: "unknown", message: UNCONFIRMED_MESSAGE };
  if (state.runeTeleport.arrival?.intentId === intentId) return { kind: "teleported", state };
  return { kind: "unchanged", message: UNCHANGED_MESSAGE, state };
}
