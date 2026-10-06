import { describe, expect, it, vi } from "vitest";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { ITEM_IDS } from "@/game/config/foundations";
import { resolveItemSources, type ItemSourceFacts } from "@/game/domain/item-sources";
import { planTradeSettlement } from "@/game/domain/player-trade-settlement";

/**
 * Issue #326 — one durable item-level eligibility rule. The trade enforcement
 * points and the item-source reference's "Player trade" entry both ask
 * `isItemTransferable`; here the rule is made to refuse one item type and every
 * consumer is shown to follow it. Where a copy of the item is (equipped, in the
 * Cargo Hold, stashed) stays a separate, per-character check.
 */

const restricted = vi.hoisted(() => ({ itemId: "" }));

vi.mock("@/game/domain/player-trade", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/game/domain/player-trade")>();
  return {
    ...actual,
    isItemTransferable: (
      itemId: string,
      balance?: Parameters<typeof actual.isItemTransferable>[1],
    ) => itemId !== restricted.itemId && actual.isItemTransferable(itemId, balance),
  };
});

const balance = getEffectiveGameBalance();
const facts: ItemSourceFacts = {
  skillLevels: {},
  acceptedMissionIds: new Set(),
  completedMissionIds: new Set(),
  fabricationStationUnlocked: false,
  locationStates: {},
};

function side(id: string, stacks: { itemId: string; quantity: number }[]) {
  return {
    characterId: id,
    credits: 10,
    miningLevel: 1,
    stacks: stacks.map((stack, index) => ({
      id: `${id}-${index}`,
      createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, index)),
      ...stack,
    })),
    instances: [{ id: `${id}-pack`, itemId: balance.items.starterContainer.itemId }],
    assignments: [
      {
        assignmentKind: "container" as const,
        suitSlotId: "container_attachment_1",
        itemInstanceId: `${id}-pack`,
      },
    ],
    cargoInstanceIds: new Set<string>(),
  };
}

function settle(itemId: string) {
  return planTradeSettlement(
    {
      requester: side("a", [{ itemId, quantity: 2 }]) as never,
      recipient: side("b", []) as never,
    },
    {
      requester: { credits: 0, stacks: [{ itemId, quantity: 1 }], itemInstanceIds: [] },
      recipient: { credits: 0, stacks: [], itemInstanceIds: [] },
    },
    balance,
  );
}

describe("isItemTransferable is the one item-level trade rule", () => {
  it("lets settlement and the reference agree while the item is transferable", () => {
    restricted.itemId = "";
    expect(settle(ITEM_IDS.ferriteShale).ok).toBe(true);
    expect(
      resolveItemSources(ITEM_IDS.ferriteShale, facts).some((s) => s.kind === "player_trade"),
    ).toBe(true);
  });

  it("makes settlement refuse the offer and the reference drop Player trade together", () => {
    restricted.itemId = ITEM_IDS.ferriteShale;
    expect(settle(ITEM_IDS.ferriteShale)).toMatchObject({
      ok: false,
      reason: "offer_unavailable",
      side: "requester",
    });
    expect(
      resolveItemSources(ITEM_IDS.ferriteShale, facts).some((s) => s.kind === "player_trade"),
    ).toBe(false);
    // An unrestricted item is untouched.
    expect(
      resolveItemSources(ITEM_IDS.refinedFerrite, facts).some((s) => s.kind === "player_trade"),
    ).toBe(true);
    restricted.itemId = "";
  });
});
