import { describe, expect, it } from "vitest";
import {
  candidateBlockedReasons,
  deriveLoadoutTiles,
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
  it("spans the Mining tool across both columns and pairs every other slot", () => {
    const tiles = deriveLoadoutTiles([tool, one, two], "mining_tool");
    expect(tiles.map(({ key, span, icon }) => ({ key, span, icon }))).toEqual([
      { key: "gear:mining_tool", span: 2, icon: "tool" },
      { key: "container:container_1", span: 1, icon: "container" },
      { key: "container:container_2", span: 1, icon: "container" },
    ]);
  });

  it("renders only the slots the authoritative projection lists", () => {
    expect(deriveLoadoutTiles([one, two], "mining_tool")).toHaveLength(2);
    expect(deriveLoadoutTiles([], "mining_tool")).toEqual([]);
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
