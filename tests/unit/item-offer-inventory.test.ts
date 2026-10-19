import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { InventoryPanel } from "@/features/inventory/InventoryPanel";
import { ITEM_IDS, LOCATION_IDS } from "@/game/config/foundations";
import { NOT_FROM_AROUND_HERE } from "@/game/content/missions";
import { projectMission, type MissionObservation } from "@/game/domain/missions";
import type { PlayGameplayState } from "@/server/play";

vi.mock("@/features/play/PlayContext", () => ({
  usePlay: () => ({
    acquireCommand: () => true,
    acceptState: () => undefined,
    enqueueForeground: () => undefined,
    foregroundBusy: false,
    openInventory: () => undefined,
    releaseCommand: () => undefined,
    state: { characterId: "character-1" },
  }),
}));
vi.mock("@/server/actions", () => ({
  breakApartRunestoneAction: () => undefined,
  discardInventoryStackAction: () => undefined,
  acceptItemOfferAction: () => undefined,
}));
vi.mock("@/features/mining/useLoadPowerCell", () => ({
  useLoadPowerCell: () => ({ busy: false, loadPowerCell: () => undefined }),
}));

/**
 * The Inventory side of the item offer (#369): which tiles carry the blue
 * affordance. The Inspect action and the modal are interactive and are proven in
 * the mobile E2E; this proves the tile derives from the projected guidance only.
 */

const stack = (id: string, itemId: string, name: string) => ({
  id,
  itemId,
  name,
  quantity: 1,
  stackLimit: 10,
});

function observation(fragments: number, stones: number): MissionObservation {
  return {
    equippedItemIds: new Set<string>(),
    carriedQuantities: new Map([
      [ITEM_IDS.runeFragment, fragments],
      [ITEM_IDS.runestone, stones],
    ]),
    stackLimits: new Map(),
    itemNames: new Map(),
  };
}

function render(
  record: { acceptedAt: Date } | undefined,
  stacks: ReturnType<typeof stack>[],
  unpinned: string[] = [],
) {
  const fragments = stacks
    .filter((entry) => entry.itemId === ITEM_IDS.runeFragment)
    .reduce((sum, entry) => sum + entry.quantity, 0);
  const stones = stacks
    .filter((entry) => entry.itemId === ITEM_IDS.runestone)
    .reduce((sum, entry) => sum + entry.quantity, 0);
  const missions = [
    projectMission(
      NOT_FROM_AROUND_HERE,
      record,
      LOCATION_IDS.crashSite,
      true,
      observation(fragments, stones),
      true,
    ),
  ];
  const state = {
    characterId: "character-1",
    missions,
    unpinnedMissionIds: unpinned,
    credits: 0,
    equipment: { miningTool: undefined },
    inventory: {
      slotsUsed: stacks.length,
      slotsAvailable: 8 - stacks.length,
      massGrams: 0,
      capacityGrams: 50_000,
      stacks,
      uniqueItems: [],
    },
  } as unknown as PlayGameplayState;
  return renderToStaticMarkup(
    React.createElement(InventoryPanel, {
      state,
      onClose: () => undefined,
      triggerRef: { current: null },
      embedded: true,
    }),
  );
}

const FRAGMENT = stack("s1", ITEM_IDS.runeFragment, "Rune Fragment");
const RUNESTONE = stack("s2", ITEM_IDS.runestone, "Runestone");
const tile = (markup: string, name: string) =>
  new RegExp(`<button[^>]*aria-label="[^"]*${name}[^"]*"[^>]*>`).exec(markup)?.[0] ?? "";

const hop = (markup: string, name: string) => {
  const tileStart = new RegExp(`<button[^>]*aria-label="[^"]*${name}[^"]*"`).exec(markup);
  if (!tileStart) return false;
  const rest = markup.slice(tileStart.index);
  const end = rest.indexOf("</button>");
  return rest.slice(0, end).includes("data-offer-hop");
};

describe("the offering tiles", () => {
  it("shows the blue Mission-available affordance and the hop only while the offer is open", () => {
    const offered = tile(render(undefined, [FRAGMENT]), "Rune Fragment");
    expect(offered).toContain('data-mission-guidance="available"');
    expect(offered).toContain("rs-mission-available");
    // Not green: this is a new Mission, not accepted progression.
    expect(offered).not.toContain("rs-mission-guidance");
    expect(hop(render(undefined, [FRAGMENT]), "Rune Fragment")).toBe(true);
  });

  it("drops the affordance and the hop once accepted, leaving an ordinary tile", () => {
    const markup = render({ acceptedAt: new Date() }, [FRAGMENT, RUNESTONE]);
    for (const name of ["Rune Fragment", "Runestone"]) {
      expect(tile(markup, name)).not.toContain("data-mission-guidance");
      expect(tile(markup, name)).not.toContain("rs-mission-");
      expect(hop(markup, name)).toBe(false);
    }
  });

  it("marks an intact Runestone too, for the same Mission", () => {
    const markup = render(undefined, [RUNESTONE]);
    expect(tile(markup, "Runestone")).toContain('data-mission-guidance="available"');
    expect(hop(markup, "Runestone")).toBe(true);
  });

  it("marks both tiles when both are carried, and no other item", () => {
    const markup = render(undefined, [
      FRAGMENT,
      RUNESTONE,
      stack("s3", ITEM_IDS.ferriteShale, "Ferrite Shale"),
    ]);
    expect(hop(markup, "Rune Fragment")).toBe(true);
    expect(hop(markup, "Runestone")).toBe(true);
    expect(hop(markup, "Ferrite Shale")).toBe(false);
    expect(tile(markup, "Ferrite Shale")).not.toContain("data-mission-guidance");
  });

  it("is not affected by pinning, since the Mission is not accepted yet", () => {
    const markup = render(undefined, [FRAGMENT], [NOT_FROM_AROUND_HERE.id]);
    expect(tile(markup, "Rune Fragment")).toContain('data-mission-guidance="available"');
  });
});
