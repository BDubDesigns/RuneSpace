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
const gloves = slot("gear", "hands");
const boots = slot("gear", "feet");
const one = slot("container", "container_1");
const two = slot("container", "container_2");
const slotIds = { miningToolSlotId: "mining_tool", handsSlotId: "hands", feetSlotId: "feet" };

describe("equipment loadout grid", () => {
  it("lays out Mining tool | Power Cell, Gloves | Boots, then the containers", () => {
    // Authored order does not matter: the grid arranges by slot identity.
    const cells = deriveLoadoutCells([one, boots, two, gloves, tool], slotIds);
    expect(cells.map(({ kind, key }) => `${kind}:${key}`)).toEqual([
      "slot:gear:mining_tool",
      "power_cell:utility:power_cell",
      "slot:gear:hands",
      "slot:gear:feet",
      "slot:container:container_1",
      "slot:container:container_2",
    ]);
  });

  it("makes Gloves and Boots real authoritative slots with their own silhouettes", () => {
    const cells = deriveLoadoutCells([tool, gloves, boots, one, two], slotIds);
    expect(cells.filter((cell) => cell.kind === "slot")).toHaveLength(5);
    expect(cells.some((cell) => cell.kind !== "slot" && cell.kind !== "power_cell")).toBe(false);
    expect(
      cells.flatMap((cell) =>
        cell.kind === "slot" ? [[cell.slot.target.suitSlotId, cell.icon]] : [],
      ),
    ).toEqual([
      ["mining_tool", "tool"],
      ["hands", "gloves"],
      ["feet", "boots"],
      ["container_1", "container"],
      ["container_2", "container"],
    ]);
    // Their keys resolve to the authoritative slots like any other.
    expect(resolveSelectedSlot([tool, gloves, boots], "gear:hands")).toBe(gloves);
    expect(resolveSelectedSlot([tool, gloves, boots], "gear:feet")).toBe(boots);
  });

  it("is not told about Gloves and Boots a server that has not projected them: nothing is invented", () => {
    const cells = deriveLoadoutCells([tool, one, two], slotIds);
    expect(cells.filter((cell) => cell.kind === "slot")).toHaveLength(3);
  });

  it("shortens only the container labels", () => {
    expect(shortSlotLabel("Container attachment 2")).toBe("Container 2");
    expect(shortSlotLabel("Mining tool")).toBe("Mining tool");
    const cells = deriveLoadoutCells([tool, one], slotIds);
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
