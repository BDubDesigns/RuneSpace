import { getEffectiveGameBalance, type EffectiveGameBalance } from "@/game/config/balance";
import { usableMiningCutterCount } from "@/game/domain/tinkering";

/**
 * Pure rule for permanently destroying one carried, unequipped unique item
 * instance from Inventory (#456).
 *
 * Every refusal here is a relationship or integrity condition on THIS instance
 * at THIS moment, never an item-type ban: an item becomes disposable the moment
 * it is safely carried and unequipped. The server feeds this the character's
 * complete, locked ownership picture (`loadOwnedItemInstances` plus equipment),
 * so Cargo and every site stash count toward the last-Cutter guard.
 */
export type UniqueDisposalRefusalReason =
  | "not_found"
  | "changed"
  | "equipped"
  | "in_cargo"
  | "installed"
  | "stored"
  | "mission_bound"
  | "last_cutter";

export type UniqueDisposalPlan =
  | { ok: true; itemId: string }
  | { ok: false; reason: UniqueDisposalRefusalReason };

export type UniqueDisposalInput = {
  itemInstanceId: string;
  /** The item the player confirmed; a mismatch means the request is stale or forged. */
  expectedItemId: string;
  /** Every unique instance the character owns, wherever it is. */
  instances: readonly { id: string; itemId: string }[];
  equippedInstanceIds: ReadonlySet<string>;
  cargoInstanceIds: ReadonlySet<string>;
  installedContainerInstanceIds: ReadonlySet<string>;
  storedInstanceIds: ReadonlySet<string>;
  /** The loan the character's held research run owns: destroyed only with its run. */
  missionBoundInstanceId?: string | undefined;
  miningLevel: number;
  balance?: EffectiveGameBalance;
};

export function planUniqueItemDisposal(input: UniqueDisposalInput): UniqueDisposalPlan {
  const balance = input.balance ?? getEffectiveGameBalance();
  const target = input.instances.find((instance) => instance.id === input.itemInstanceId);
  if (!target) return { ok: false, reason: "not_found" };
  if (target.itemId !== input.expectedItemId) return { ok: false, reason: "changed" };
  if (input.equippedInstanceIds.has(target.id)) return { ok: false, reason: "equipped" };
  if (input.cargoInstanceIds.has(target.id)) return { ok: false, reason: "in_cargo" };
  if (input.installedContainerInstanceIds.has(target.id)) return { ok: false, reason: "installed" };
  if (input.storedInstanceIds.has(target.id)) return { ok: false, reason: "stored" };
  if (input.missionBoundInstanceId === target.id) return { ok: false, reason: "mission_bound" };

  // The same Mining-level-aware predicate Tinkering and player trades enforce:
  // refuse only when this removal takes the character from having a usable
  // Cutter anywhere they own to having none.
  const before = usableMiningCutterCount(input.instances, input.miningLevel, balance);
  const after = usableMiningCutterCount(
    input.instances.filter((instance) => instance.id !== target.id),
    input.miningLevel,
    balance,
  );
  if (after < 1 && after < before) return { ok: false, reason: "last_cutter" };
  return { ok: true, itemId: target.itemId };
}

export const UNIQUE_DISPOSAL_REFUSALS = {
  not_found: "That item is no longer in your Inventory.",
  changed: "Inventory changed. Review the item and try again.",
  equipped: "That item is equipped. Unequip it in Equipment first.",
  in_cargo: "That item is in your ship's Cargo Hold, not your carried Inventory.",
  installed: "That container is installed at a site stash. Remove it from its mount first.",
  stored: "That item is stored in a site stash. Take it back into your Inventory first.",
  mission_bound:
    "That item belongs to your current assignment. Use Destroy on it to abandon the assignment.",
  last_cutter:
    "That is your last usable Mining Cutter. Keep at least one you can use, equipped, carried, in Cargo or in a stash.",
} as const satisfies Record<UniqueDisposalRefusalReason, string>;
