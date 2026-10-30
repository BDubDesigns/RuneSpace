import { getTeleportRune } from "@/game/content/rune-teleports";

/**
 * Pure rules for using a teleport rune (#438).
 *
 * The server reads the facts under the character lock, after due work has been
 * reconciled, and this decides. There is deliberately no level, Rig, Mission or
 * visited-destination input: any character carrying a valid rune may use it.
 * Walking, flight, passenger travel and an incompatible trade are refused by the
 * shared owned-character boundary before this runs; `hasActiveAction` covers
 * every other running activity, which a teleport never cancels or minimizes.
 */
export type RuneTeleportRefusalReason =
  | "stack_not_found"
  | "stack_changed"
  | "not_a_teleport_rune"
  | "another_action_active"
  | "already_there";

export const RUNE_TELEPORT_REFUSALS = {
  stack_not_found: "Inventory changed. Review the stack and try again.",
  stack_changed: "Inventory changed. Review the stack and try again.",
  not_a_teleport_rune: "That item cannot be used to teleport.",
  another_action_active: "Finish what you are doing first. Nothing was used.",
  already_there: "You are already there. The rune was not used.",
} as const satisfies Record<RuneTeleportRefusalReason, string>;

export type RuneTeleportPlan =
  | { ok: true; itemId: string; destinationLocationId: string }
  | { ok: false; reason: RuneTeleportRefusalReason };

export function planRuneTeleport(input: {
  /** The carried stack the request named, as the server just read and locked it. */
  stack: { itemId: string; quantity: number } | undefined;
  /** The quantity the player confirmed against. */
  expectedQuantity: number;
  currentLocationId: string;
  hasActiveAction: boolean;
}): RuneTeleportPlan {
  const { stack } = input;
  if (!stack || stack.quantity < 1) return { ok: false, reason: "stack_not_found" };
  const rune = getTeleportRune(stack.itemId);
  if (!rune) return { ok: false, reason: "not_a_teleport_rune" };
  if (stack.quantity !== input.expectedQuantity) return { ok: false, reason: "stack_changed" };
  if (input.hasActiveAction) return { ok: false, reason: "another_action_active" };
  const { destinationLocationId } = rune;
  if (input.currentLocationId === destinationLocationId) {
    return { ok: false, reason: "already_there" };
  }
  return { ok: true, itemId: stack.itemId, destinationLocationId };
}

/** The Play projection (#438): what the confirmation names and the durable arrival owed. */
export type RuneTeleportDestination = {
  locationId: string;
  name: string;
  planetName?: string;
};

export type RuneTeleportProjection = {
  /** Each teleport rune's destination, labelled for this character. */
  runes: Readonly<Record<string, RuneTeleportDestination>>;
  /** The last confirmed Use whose arrival modal has not been dismissed. */
  arrival?: RuneTeleportDestination & { intentId: string; itemId: string; arrivedAt: string };
};
