import { describe, expect, it } from "vitest";
import {
  candidateBlockedReasons,
  deriveLoadoutCells,
  derivePowerCellUtility,
  shortSlotLabel,
  equipmentSlotKey,
  resolveSelectedCandidate,
  resolveSelectedSlot,
  type EquipmentCandidate,
  type EquipmentSlotState,
} from "@/features/inventory/equipment-loadout";

const candidate = (id: string, blockedReasons?: string[]): EquipmentCandidate => ({
  itemInstanceId: id,
  itemId: "item",
  name: id,
  massGrams: 1_000,
  ...(blockedReasons ? { blockedReasons } : {}),
});
const slot = (
  assignmentKind: string,
  suitSlotId: string,
  eligibleItems: EquipmentCandidate[] = [],
): EquipmentSlotState => ({
  target: { assignmentKind, suitSlotId },
  label: suitSlotId,
  item: undefined,
  eligibleItems,
});

const tool = slot("gear", "mining_tool");
const one = slot("container", "container_1");
const two = slot("container", "container_2");

describe("equipment loadout grid", () => {
  it("lays out Mining tool | Power Cell, Gloves | Boots, then the containers", () => {
    const cells = deriveLoadoutCells([tool, one, two], "mining_tool");
    expect(cells.map(({ kind, key }) => `${kind}:${key}`)).toEqual([
      "slot:gear:mining_tool",
      "power_cell:utility:power_cell",
      "placeholder:placeholder:gloves",
      "placeholder:placeholder:boots",
      "slot:container:container_1",
      "slot:container:container_2",
    ]);
  });

  it("keeps Gloves and Boots visual-only: they never come from, or become, authoritative slots", () => {
    const cells = deriveLoadoutCells([tool, one, two], "mining_tool");
    expect(cells.filter((cell) => cell.kind === "slot")).toHaveLength(3);
    expect(cells.filter((cell) => cell.kind === "placeholder").map((cell) => cell.icon)).toEqual([
      "gloves",
      "boots",
    ]);
    // A selection key for a placeholder resolves to no authoritative slot.
    expect(resolveSelectedSlot([tool, one, two], "placeholder:gloves")).toBeUndefined();
  });

  it("shortens only the container labels", () => {
    expect(shortSlotLabel("Container attachment 2")).toBe("Container 2");
    expect(shortSlotLabel("Mining tool")).toBe("Mining tool");
    const cells = deriveLoadoutCells([tool, one], "mining_tool");
    const slotCell = cells.find((cell) => cell.kind === "slot" && cell.slot === one);
    expect(slotCell?.kind === "slot" && slotCell.shortLabel).toBe("container_1");
  });

  it("derives the Power Cell utility state from the authoritative projection", () => {
    const equipment = (charge: number | undefined, carried: number) =>
      ({
        carriedPowerCellQuantity: carried,
        miningTool: charge === undefined ? undefined : { currentCharge: charge, maximumCharge: 10 },
      }) as unknown as Parameters<typeof derivePowerCellUtility>[0];
    expect(derivePowerCellUtility(equipment(undefined, 3))).toEqual({
      status: "no_tool",
      carried: 3,
    });
    expect(derivePowerCellUtility(equipment(0, 3))).toEqual({
      status: "ready",
      charge: 0,
      maximum: 10,
      carried: 3,
    });
    expect(derivePowerCellUtility(equipment(0, 0)).status).toBe("no_cells");
    expect(derivePowerCellUtility(equipment(4, 3)).status).toBe("charged");
  });

  it("resolves a selection against the current projection and drops stale ones", () => {
    const withCandidate = slot("container", "container_2", [candidate("box")]);
    const slots = [tool, one, withCandidate];
    expect(resolveSelectedSlot(slots, equipmentSlotKey(withCandidate.target))).toBe(withCandidate);
    expect(resolveSelectedSlot(slots, undefined)).toBeUndefined();
    expect(resolveSelectedSlot(slots, "container:gone")).toBeUndefined();
    expect(resolveSelectedCandidate(withCandidate, "box")?.name).toBe("box");
    // The candidate left the list (it was equipped or dropped): nothing stale remains.
    expect(resolveSelectedCandidate(slot("container", "container_2"), "box")).toBeUndefined();
    expect(resolveSelectedCandidate(undefined, "box")).toBeUndefined();
  });

  it("keeps a blocked candidate selectable and reports every blocking reason", () => {
    const blocked = candidate("cutter", ["Requires Mining 5 (current 3).", "Over capacity."]);
    expect(candidateBlockedReasons(blocked)).toEqual([
      "Requires Mining 5 (current 3).",
      "Over capacity.",
    ]);
    expect(candidateBlockedReasons(candidate("ready"))).toEqual([]);
    expect(resolveSelectedCandidate(slot("gear", "mining_tool", [blocked]), "cutter")).toBe(
      blocked,
    );
  });
});
