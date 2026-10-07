import { getItemDefinition, type EffectiveGameBalance } from "@/game/config/balance";
import type { ItemId } from "@/game/config/foundations";
import {
  deriveEquipmentLoadout,
  type EquipmentAssignmentState,
  type EquipmentLoadout,
} from "@/game/domain/equipment";
import type { StackState } from "@/game/domain/inventory";
import {
  isItemTransferable,
  isValidCreditOffer,
  isValidStackQuantity,
  otherTradeSide,
  type TradeSide,
} from "@/game/domain/player-trade";
import { usableMiningCutterCount } from "@/game/domain/tinkering";
import {
  addStackExact,
  removeStacks,
  workingInventory,
  workingInventoryDiff,
  type WorkingInventoryDiff,
} from "@/game/domain/working-inventory";

/**
 * Player-trade settlement planning (issue #267). Pure: the server locks both
 * characters' rows, loads these facts inside the commit transaction, and asks
 * one question — can this exact pair of offers settle right now, and if so,
 * what does each side's inventory become?
 *
 * Each side's outgoing removals and incoming additions are planned as one
 * hypothetical post-trade state, through the existing inventory planners
 * (stack merging and limits included) and the one equipment-loadout
 * derivation, so a full Inventory can still complete a one-for-one swap. The
 * loadout keeps each character's own equipped containers: a container
 * received in the trade arrives unequipped, so it adds mass and a slot but no
 * capacity until its new owner equips it later.
 *
 * A trade may not leave a character worse off than a valid state: it is
 * refused when it would push a side's slots or mass past capacity (or further
 * past it), or take a side from at least one usable Mining Cutter to none —
 * counted across Equipment, carried Inventory, and the Cargo Hold, by that
 * character's own Mining level, as Tinkering's last-Cutter guard counts them.
 */

/** Everything one participant owns that settlement must see, as loaded under lock. */
export type TradeSettlementSide = {
  characterId: string;
  credits: number;
  miningLevel: number;
  /** Carried fungible stacks. Cargo Hold stacks are never offerable or affected. */
  stacks: readonly StackState<string>[];
  /** Every owned unique instance, wherever it is: equipped, carried, or in the Cargo Hold. */
  instances: readonly { id: string; itemId: string }[];
  assignments: readonly EquipmentAssignmentState[];
  cargoInstanceIds: ReadonlySet<string>;
};

/** One participant's offer exactly as stored. */
export type TradeOfferContent = {
  credits: number;
  stacks: readonly { itemId: string; quantity: number }[];
  itemInstanceIds: readonly string[];
};

/** One participant's explicit offer as the economic audit preserves it. */
export type SettledTradeOffer = {
  credits: number;
  stacks: { itemId: string; quantity: number }[];
  items: { itemInstanceId: string; itemId: string }[];
};

export type TradeSideSettlement = {
  characterId: string;
  creditsAfter: number;
  /** This side's carried-stack rows after both offers, as one diff from the rows loaded. */
  stacks: WorkingInventoryDiff;
  /** Instances this side receives; each keeps its id and every mutable column. */
  receivedInstanceIds: string[];
};

export type TradeSettlementFailure =
  /** An offered asset is no longer this side's to give, as offered. */
  | "offer_unavailable"
  /** This side's Credits after the trade would not fit `MAXIMUM_CHARACTER_CREDITS`. */
  | "credits"
  | "slots"
  | "mass"
  | "last_cutter";

export type TradeSettlementPlan =
  | {
      ok: true;
      sides: Record<TradeSide, TradeSideSettlement>;
      offers: Record<TradeSide, SettledTradeOffer>;
    }
  | { ok: false; reason: TradeSettlementFailure; side: TradeSide }
  /** Neither side offers anything: there is no trade to commit or audit. */
  | { ok: false; reason: "empty" };

/**
 * The most Credits one character can hold: `characters.credits` is a
 * PostgreSQL `integer`. Settlement proves every post-trade balance fits before
 * it writes, so an overflow is a correctable refusal, never a database error.
 */
export const MAXIMUM_CHARACTER_CREDITS = 2_147_483_647;

/** An offer of no Credits, no stacks, and no unique items. */
export function isEmptyTradeOffer(offer: TradeOfferContent): boolean {
  return offer.credits === 0 && offer.stacks.length === 0 && offer.itemInstanceIds.length === 0;
}

const SIDES: readonly TradeSide[] = ["requester", "recipient"];

/**
 * Prove an offer is still exactly its side's to give: Credits within balance,
 * every stack quantity carried, and every unique instance owned, unequipped,
 * outside the Cargo Hold, and a real unique item. Returns the audit form.
 */
function settleableOffer(
  side: TradeSettlementSide,
  offer: TradeOfferContent,
  balance: EffectiveGameBalance,
): SettledTradeOffer | undefined {
  if (!isValidCreditOffer(offer.credits, side.credits)) return undefined;
  const carried = new Map<string, number>();
  for (const stack of side.stacks) {
    carried.set(stack.itemId, (carried.get(stack.itemId) ?? 0) + stack.quantity);
  }
  const offeredStacks = new Map<string, number>();
  for (const line of offer.stacks) {
    if (!isItemTransferable(line.itemId, balance)) return undefined;
    if (getItemDefinition(line.itemId, balance)?.kind !== "stack") return undefined;
    if (!isValidStackQuantity(line.quantity)) return undefined;
    offeredStacks.set(line.itemId, (offeredStacks.get(line.itemId) ?? 0) + line.quantity);
  }
  for (const [itemId, quantity] of offeredStacks) {
    if (quantity > (carried.get(itemId) ?? 0)) return undefined;
  }
  const equipped = new Set(side.assignments.map((assignment) => assignment.itemInstanceId));
  const items: SettledTradeOffer["items"] = [];
  for (const id of new Set(offer.itemInstanceIds)) {
    const instance = side.instances.find((candidate) => candidate.id === id);
    if (!instance || equipped.has(id) || side.cargoInstanceIds.has(id)) return undefined;
    if (!isItemTransferable(instance.itemId, balance)) return undefined;
    if (getItemDefinition(instance.itemId, balance)?.kind !== "unique") return undefined;
    items.push({ itemInstanceId: id, itemId: instance.itemId });
  }
  return {
    credits: offer.credits,
    stacks: [...offeredStacks].map(([itemId, quantity]) => ({ itemId, quantity })),
    items,
  };
}

function loadoutOf(
  side: TradeSettlementSide,
  stacks: readonly { itemId: string; quantity: number }[],
  instances: readonly { id: string; itemId: string }[],
  balance: EffectiveGameBalance,
): EquipmentLoadout {
  return deriveEquipmentLoadout({
    assignments: side.assignments,
    instances: instances.filter((instance) => !side.cargoInstanceIds.has(instance.id)),
    stacks,
    balance,
  });
}

function planSide(
  side: TradeSettlementSide,
  outgoing: SettledTradeOffer,
  incoming: SettledTradeOffer,
  balance: EffectiveGameBalance,
):
  | { ok: true; settlement: TradeSideSettlement }
  | { ok: false; reason: Exclude<TradeSettlementFailure, "offer_unavailable"> } {
  const creditsAfter = side.credits - outgoing.credits + incoming.credits;
  if (creditsAfter > MAXIMUM_CHARACTER_CREDITS) return { ok: false, reason: "credits" };

  // Room is judged on the finished state below, so the working inventory is
  // only asked to merge: every incoming unit could at worst need its own row.
  const incomingUnits = incoming.stacks.reduce((total, line) => total + line.quantity, 0);
  let inventory = workingInventory({
    stacks: side.stacks,
    slotsAvailable: incomingUnits,
    massAvailableGrams: Number.POSITIVE_INFINITY,
  });
  const removed = removeStacks(
    inventory,
    outgoing.stacks.map((line) => ({ itemId: line.itemId as ItemId, quantity: line.quantity })),
    balance,
  );
  // `settleableOffer` already proved every outgoing quantity is carried.
  if (!removed.ok) throw new Error("Offered stacks were proven carried");
  inventory = removed.inventory;
  for (const line of incoming.stacks) {
    const added = addStackExact(inventory, line.itemId as ItemId, line.quantity, balance);
    if (!added.ok) throw new Error("An unbounded merge cannot run out of room");
    inventory = added.inventory;
  }

  const outgoingIds = new Set(outgoing.items.map((item) => item.itemInstanceId));
  const instancesAfter = [
    ...side.instances.filter((instance) => !outgoingIds.has(instance.id)),
    ...incoming.items.map((item) => ({ id: item.itemInstanceId, itemId: item.itemId })),
  ];
  const before = loadoutOf(side, side.stacks, side.instances, balance);
  const after = loadoutOf(side, inventory.stacks, instancesAfter, balance);
  if (
    after.inventorySlotsUsed > after.containerSlotCapacity &&
    after.inventorySlotsUsed > before.inventorySlotsUsed
  ) {
    return { ok: false, reason: "slots" };
  }
  if (
    after.carriedMassGrams > after.maximumCarryCapacityGrams &&
    after.carriedMassGrams > before.carriedMassGrams
  ) {
    return { ok: false, reason: "mass" };
  }
  const cuttersBefore = usableMiningCutterCount(side.instances, side.miningLevel, balance);
  const cuttersAfter = usableMiningCutterCount(instancesAfter, side.miningLevel, balance);
  if (cuttersAfter < 1 && cuttersAfter < cuttersBefore) return { ok: false, reason: "last_cutter" };

  return {
    ok: true,
    settlement: {
      characterId: side.characterId,
      creditsAfter,
      stacks: workingInventoryDiff(side.stacks, inventory),
      receivedInstanceIds: incoming.items.map((item) => item.itemInstanceId),
    },
  };
}

/**
 * Plan the settlement of two offers against both participants' current
 * authoritative state. Either both sides' post-trade states are valid and the
 * plan describes exactly what to write, or nothing may move and the first
 * failure (requester side first) is named. A gift one way is a trade; nothing
 * either way is not.
 */
export function planTradeSettlement(
  participants: Record<TradeSide, TradeSettlementSide>,
  offers: Record<TradeSide, TradeOfferContent>,
  balance: EffectiveGameBalance,
): TradeSettlementPlan {
  if (isEmptyTradeOffer(offers.requester) && isEmptyTradeOffer(offers.recipient)) {
    return { ok: false, reason: "empty" };
  }
  const settled = {} as Record<TradeSide, SettledTradeOffer>;
  for (const side of SIDES) {
    const offer = settleableOffer(participants[side], offers[side], balance);
    if (!offer) return { ok: false, reason: "offer_unavailable", side };
    settled[side] = offer;
  }
  const sides = {} as Record<TradeSide, TradeSideSettlement>;
  for (const side of SIDES) {
    const plan = planSide(
      participants[side],
      settled[side],
      settled[otherTradeSide(side)],
      balance,
    );
    if (!plan.ok) return { ok: false, reason: plan.reason, side };
    sides[side] = plan.settlement;
  }
  return { ok: true, sides, offers: settled };
}
