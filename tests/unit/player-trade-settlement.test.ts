import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance } from "@/game/config/balance";
import {
  planTradeSettlement,
  type TradeOfferContent,
  type TradeSettlementSide,
} from "@/game/domain/player-trade-settlement";
import type { TradeSide } from "@/game/domain/player-trade";

/**
 * Issue #267 — the pure settlement planner: offer re-proof, the hypothetical
 * post-trade inventories (stack merging, slots, mass, a received container
 * adding no capacity), and the last-Cutter guard. Locking, atomicity, and the
 * audit are proved against PostgreSQL in
 * tests/integration/player-trade-settlement.test.ts.
 */

const balance = getEffectiveGameBalance();
const { items } = balance;
const MYKEA = items.starterContainer.itemId; // 8 slots, 10 kg
const SCRAP_BOX = items.scrapBox.itemId; // 3 slots, 5 kg
const SALVAGE = items.salvageCutter.itemId; // 5 kg
const LOADSTEEL = items.loadsteelCutter.itemId; // 8 kg, Mining 5
const SHALE = items.ferriteShale.itemId; // 100 g, stack of 10
const FERRITE = items.refinedFerrite.itemId; // 150 g, stack of 5

type Instance = { id: string; itemId: string };

/**
 * A character wearing an 8-slot MYKEA and an equipped Salvage Cutter (15 kg of
 * the 50 kg capacity), plus whatever the test adds.
 */
function character(
  id: string,
  extra: {
    credits?: number;
    miningLevel?: number;
    stacks?: { itemId: string; quantity: number }[];
    carried?: Instance[];
    cargo?: Instance[];
    equippedCutter?: boolean;
  } = {},
): TradeSettlementSide {
  const pack = { id: `${id}-pack`, itemId: MYKEA };
  const cutter = { id: `${id}-cutter`, itemId: SALVAGE };
  const equippedCutter = extra.equippedCutter ?? true;
  return {
    characterId: id,
    credits: extra.credits ?? 10,
    miningLevel: extra.miningLevel ?? 1,
    stacks: (extra.stacks ?? []).map((stack, index) => ({
      id: `${id}-stack-${index}`,
      createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, index)),
      ...stack,
    })) as TradeSettlementSide["stacks"],
    instances: [
      pack,
      ...(equippedCutter ? [cutter] : []),
      ...(extra.carried ?? []),
      ...(extra.cargo ?? []),
    ],
    assignments: [
      {
        assignmentKind: "container",
        suitSlotId: "container_attachment_1",
        itemInstanceId: pack.id,
      },
      ...(equippedCutter
        ? [{ assignmentKind: "gear", suitSlotId: "mining_tool", itemInstanceId: cutter.id }]
        : []),
    ],
    cargoInstanceIds: new Set((extra.cargo ?? []).map((instance) => instance.id)),
  };
}

function offer(content: Partial<TradeOfferContent> = {}): TradeOfferContent {
  return { credits: 0, stacks: [], itemInstanceIds: [], ...content };
}

/** Seven full Refined Ferrite stacks: with one more row, an 8-slot pack is full. */
const SEVEN_FULL = Array.from({ length: 7 }, () => ({ itemId: FERRITE, quantity: 5 }));

function plan(
  sides: Record<TradeSide, TradeSettlementSide>,
  offers: Partial<Record<TradeSide, TradeOfferContent>>,
) {
  return planTradeSettlement(
    sides,
    { requester: offers.requester ?? offer(), recipient: offers.recipient ?? offer() },
    balance,
  );
}

describe("player-trade settlement planning", () => {
  it("settles a one-sided gift of Credits and stacks in the explicit direction", () => {
    const result = plan(
      {
        requester: character("a", { credits: 25, stacks: [{ itemId: SHALE, quantity: 7 }] }),
        recipient: character("b", { credits: 3 }),
      },
      { requester: offer({ credits: 20, stacks: [{ itemId: SHALE, quantity: 4 }] }) },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sides.requester.creditsAfter).toBe(5);
    expect(result.sides.recipient.creditsAfter).toBe(23);
    expect(result.sides.requester.stacks).toEqual({
      stackUpdates: [{ id: "a-stack-0", quantity: 3 }],
      deletedStackIds: [],
      createdStacks: [],
    });
    expect(result.sides.recipient.stacks.createdStacks).toEqual([{ itemId: SHALE, quantity: 4 }]);
    // Both explicit offers, not a net delta.
    expect(result.offers.requester).toEqual({
      credits: 20,
      stacks: [{ itemId: SHALE, quantity: 4 }],
      items: [],
    });
    expect(result.offers.recipient).toEqual({ credits: 0, stacks: [], items: [] });
  });

  it("lets a full Inventory complete a one-for-one swap that fits afterwards", () => {
    const boxForB = { id: "a-box", itemId: SCRAP_BOX };
    const result = plan(
      {
        requester: character("a", { carried: [boxForB] }),
        // Eight occupied slots in an 8-slot pack.
        recipient: character("b", {
          stacks: [...SEVEN_FULL, { itemId: SHALE, quantity: 10 }],
        }),
      },
      {
        requester: offer({ itemInstanceIds: [boxForB.id] }),
        recipient: offer({ stacks: [{ itemId: SHALE, quantity: 10 }] }),
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sides.recipient.receivedInstanceIds).toEqual([boxForB.id]);
    expect(result.sides.recipient.stacks.deletedStackIds).toEqual(["b-stack-7"]);
    expect(result.offers.requester.items).toEqual([
      { itemInstanceId: boxForB.id, itemId: SCRAP_BOX },
    ]);
  });

  it("merges incoming units into a partial stack before needing a new slot", () => {
    const full = { requester: character("a", { stacks: [{ itemId: SHALE, quantity: 10 }] }) };
    const recipient = character("b", { stacks: [...SEVEN_FULL, { itemId: SHALE, quantity: 7 }] });
    const merges = plan(
      { ...full, recipient },
      { requester: offer({ stacks: [{ itemId: SHALE, quantity: 3 }] }) },
    );
    expect(merges.ok).toBe(true);
    if (merges.ok) {
      expect(merges.sides.recipient.stacks).toEqual({
        stackUpdates: [{ id: "b-stack-7", quantity: 10 }],
        deletedStackIds: [],
        createdStacks: [],
      });
    }
    // One unit more than the partial stack holds needs a ninth slot.
    expect(
      plan(
        { ...full, recipient },
        { requester: offer({ stacks: [{ itemId: SHALE, quantity: 4 }] }) },
      ),
    ).toEqual({ ok: false, reason: "slots", side: "recipient" });
  });

  it("refuses true mass overflow even with free slots", () => {
    const packs = [1, 2, 3, 4].map((n) => ({ id: `a-mykea-${n}`, itemId: MYKEA }));
    // 15 kg worn + 40 kg of packs is over the 50 kg capacity, in only 4 slots.
    expect(
      plan(
        { requester: character("a", { carried: packs }), recipient: character("b") },
        { requester: offer({ itemInstanceIds: packs.map((pack) => pack.id) }) },
      ),
    ).toEqual({ ok: false, reason: "mass", side: "recipient" });
  });

  it("does not let a container received in the trade add capacity to it", () => {
    const box = { id: "a-box", itemId: SCRAP_BOX };
    expect(
      plan(
        {
          requester: character("a", { carried: [box] }),
          recipient: character("b", { stacks: [...SEVEN_FULL, { itemId: SHALE, quantity: 10 }] }),
        },
        { requester: offer({ itemInstanceIds: [box.id] }) },
      ),
    ).toEqual({ ok: false, reason: "slots", side: "recipient" });
  });

  it("never offers what is equipped, in the Cargo Hold, foreign, or beyond the balance", () => {
    const stored = { id: "a-stored", itemId: SCRAP_BOX };
    const sides = {
      requester: character("a", {
        credits: 5,
        cargo: [stored],
        stacks: [{ itemId: SHALE, quantity: 2 }],
      }),
      recipient: character("b", { carried: [{ id: "b-box", itemId: SCRAP_BOX }] }),
    };
    for (const bad of [
      offer({ credits: 6 }),
      offer({ credits: -1 }),
      offer({ credits: 1.5 }),
      offer({ stacks: [{ itemId: SHALE, quantity: 3 }] }),
      offer({ stacks: [{ itemId: SHALE, quantity: 0 }] }),
      offer({ stacks: [{ itemId: SALVAGE, quantity: 1 }] }),
      offer({ itemInstanceIds: ["a-cutter"] }), // equipped
      offer({ itemInstanceIds: ["a-pack"] }), // equipped container
      offer({ itemInstanceIds: [stored.id] }), // Cargo Hold
      offer({ itemInstanceIds: ["b-box"] }), // the counterpart's
    ]) {
      expect(plan(sides, { requester: bad })).toEqual({
        ok: false,
        reason: "offer_unavailable",
        side: "requester",
      });
    }
  });

  it("guards the last usable Mining Cutter across Equipment, Inventory, and Cargo", () => {
    const spare = { id: "a-spare", itemId: SALVAGE };
    // Carried, unequipped, and the only Cutter the character owns.
    const onlyCutter = character("a", { equippedCutter: false, carried: [spare] });
    expect(
      plan(
        { requester: onlyCutter, recipient: character("b") },
        { requester: offer({ itemInstanceIds: [spare.id] }) },
      ),
    ).toEqual({ ok: false, reason: "last_cutter", side: "requester" });

    // A Cutter in the Cargo Hold still counts.
    const stored = { id: "a-stored", itemId: SALVAGE };
    expect(
      plan(
        {
          requester: character("a", { equippedCutter: false, carried: [spare], cargo: [stored] }),
          recipient: character("b"),
        },
        { requester: offer({ itemInstanceIds: [spare.id] }) },
      ).ok,
    ).toBe(true);
  });

  it("allows a Cutter-for-Cutter swap only when the received Cutter is usable", () => {
    const mine = { id: "a-spare", itemId: SALVAGE };
    const theirs = { id: "b-loadsteel", itemId: LOADSTEEL };
    const swap = (miningLevel: number) =>
      plan(
        {
          requester: character("a", { equippedCutter: false, carried: [mine], miningLevel }),
          recipient: character("b", { carried: [theirs], miningLevel: 5 }),
        },
        {
          requester: offer({ itemInstanceIds: [mine.id] }),
          recipient: offer({ itemInstanceIds: [theirs.id] }),
        },
      );
    expect(swap(5).ok).toBe(true);
    // A Loadsteel Cutter needs Mining 5: at Mining 1 it leaves A with none usable.
    expect(swap(1)).toEqual({ ok: false, reason: "last_cutter", side: "requester" });
  });

  it("does not hold a trade hostage to a state the trade did not cause", () => {
    // Already without a Cutter: trading stacks away is still fine.
    expect(
      plan(
        {
          requester: character("a", {
            equippedCutter: false,
            stacks: [{ itemId: SHALE, quantity: 2 }],
          }),
          recipient: character("b"),
        },
        { requester: offer({ stacks: [{ itemId: SHALE, quantity: 2 }] }) },
      ).ok,
    ).toBe(true);
  });

  it("names the requester's failure before the recipient's", () => {
    const spare = { id: "a-spare", itemId: SALVAGE };
    expect(
      plan(
        {
          requester: character("a", { equippedCutter: false, carried: [spare] }),
          recipient: character("b", { stacks: [...SEVEN_FULL, { itemId: SHALE, quantity: 10 }] }),
        },
        { requester: offer({ itemInstanceIds: [spare.id] }) },
      ),
    ).toEqual({ ok: false, reason: "last_cutter", side: "requester" });
  });
});
