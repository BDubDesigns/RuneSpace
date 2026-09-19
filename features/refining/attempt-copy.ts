import { resolveItemPresentation } from "@/game/content/item-presentation";
import type { RefiningRunAttempt } from "@/server/refining";

/**
 * How a Refining attempt's own inputs and outputs are put into words.
 *
 * Separate from the console so the wording can be stated as tests rather than
 * only walked into in a browser (#211 review).
 */

/** The item's authoritative display name, by its stable ID. */
function itemName(itemId: string): string {
  return resolveItemPresentation(itemId, itemId).displayName;
}

/** "2 Galvanite", "1 Refined Ferrite + 1 Galvanic Stock". */
export function describeQuantities(
  quantities: readonly { itemId: string; quantity: number }[],
  separator = " + ",
): string {
  if (quantities.length === 0) return "nothing";
  return quantities.map((entry) => `${entry.quantity} ${itemName(entry.itemId)}`).join(separator);
}

/**
 * What a failed attempt actually did with what it hands back.
 *
 * The two authored failure shapes are genuinely different events (#209): Slag
 * from a Refined Ferrite or Galvanic Stock pour is new material the failure
 * *produced*, while Galvaferrite hands one of the inputs it took straight back,
 * which is *returned*. The attempt already records both sides, so an award that
 * appears among this attempt's own consumed inputs came back and anything else
 * was made — no recipe lookup, and a future failure shape that does both at
 * once reads correctly without another branch here.
 */
export function describeFailureOutcome(attempt: RefiningRunAttempt): string {
  const consumedItemIds = new Set(attempt.consumed.map((input) => input.itemId));
  const returned = attempt.awarded.filter((award) => consumedItemIds.has(award.itemId));
  const produced = attempt.awarded.filter((award) => !consumedItemIds.has(award.itemId));
  const clauses: string[] = [];
  if (produced.length > 0) clauses.push(`${describeQuantities(produced, ", ")} produced`);
  if (returned.length > 0) clauses.push(`${describeQuantities(returned, ", ")} returned`);
  return clauses.length > 0 ? clauses.join(", ") : "nothing recovered";
}
