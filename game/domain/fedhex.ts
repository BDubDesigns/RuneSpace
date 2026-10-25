import { formatMassGrams } from "@/game/domain/mass";
import type { LocalPlaceDefinition } from "@/game/schemas/local-places";

/**
 * FedHex mailbox rules (#399): pure, so the server and the tests ask the same
 * questions. The server loads the stored facts and the carried capacity.
 */

/** Whether a Local Place is a FedHex pickup, authored as `fedhexMailbox`. */
export function isFedhexMailboxPlace(place: Pick<LocalPlaceDefinition, "fedhexMailbox">): boolean {
  return place.fedhexMailbox === true;
}

export type FedhexClaimRefusal =
  | "in_transit"
  | "active_action"
  | "not_at_fedhex"
  | "not_found"
  | "already_claimed"
  | "no_slot"
  | "no_mass";

/**
 * Whether a unique attachment fits carried Inventory: it needs one free slot AND
 * its own mass. Either shortfall refuses with a usable explanation, and the
 * parcel stays exactly as it was.
 */
export function planFedhexClaim(input: {
  massGrams: number;
  availableSlots: number;
  availableMassGrams: number;
}): { ok: true } | { ok: false; reason: "no_slot" | "no_mass"; message: string } {
  if (input.availableSlots < 1)
    return {
      ok: false,
      reason: "no_slot",
      message: "Your Inventory is full. Make room for one more item, then collect it.",
    };
  if (input.availableMassGrams < input.massGrams)
    return {
      ok: false,
      reason: "no_mass",
      message: `This is too heavy to carry right now. Free up ${formatMassGrams(input.massGrams - input.availableMassGrams)} more, then collect it.`,
    };
  return { ok: true };
}
