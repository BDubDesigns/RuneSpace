import { describe, expect, it } from "vitest";
import {
  formatAuditSummary,
  missionLabel,
  missionStateLabel,
  itemLabel,
} from "@/features/admin/admin-format";

/**
 * Issue #113 operator-console presentation regression guard: the audit trail's
 * human-readable mutation summaries are derived ONLY from the structured JSON
 * the command boundaries persist (`details`) plus the row's operation and
 * target identity — never invented. These cases mirror the exact shapes the
 * seams write in `server/admin-command-seams.ts`.
 */
describe("formatAuditSummary", () => {
  it("formats stop_current_action without a target", () => {
    expect(formatAuditSummary("stop_current_action", { actionId: "mining" }, "mining")).toBe(
      "Stopped the in-progress action.",
    );
  });

  it("formats teleport_character with human location names", () => {
    expect(
      formatAuditSummary(
        "teleport_character",
        { fromLocationId: "the_jag", toLocationId: "crash_site", interruptedActionId: "mining" },
        "crash_site",
      ),
    ).toBe("Teleported The Jag → Crash Site (interrupted an in-flight action).");
  });

  it("formats teleport_character without an interruption", () => {
    expect(
      formatAuditSummary(
        "teleport_character",
        { fromLocationId: "the_jag", toLocationId: "crash_site", interruptedActionId: null },
        "crash_site",
      ),
    ).toBe("Teleported The Jag → Crash Site.");
  });

  it("formats carrying a whole stack removal", () => {
    expect(
      formatAuditSummary(
        "removed_stack_quantity",
        { source: "carried", mode: "stack", removedQuantity: 4 },
        "stack-1",
      ),
    ).toBe("Removed the whole stack from carried inventory (4 item(s)).");
  });

  it("formats removing a single item", () => {
    expect(
      formatAuditSummary(
        "removed_stack_quantity",
        { source: "cargo", mode: "one", removedQuantity: 1 },
        "stack-2",
      ),
    ).toBe("Removed 1 item from the Cargo hold.");
  });

  it("formats force_unequipped_item with a human slot", () => {
    expect(
      formatAuditSummary(
        "force_unequipped_item",
        { assignmentKind: "gear", suitSlotId: "mining_tool" },
        "instance-9",
      ),
    ).toBe("Force-unequipped an item from Mining Tool.");
  });

  it("formats deleting a carried unique by item id", () => {
    expect(
      formatAuditSummary(
        "removed_unique_item",
        { source: "carried", itemId: "salvage_cutter" },
        "instance-9",
      ),
    ).toBe("Permanently deleted unique Salvage Cutter from carried inventory.");
  });

  it("formats added stackable with human item label from target identity", () => {
    expect(formatAuditSummary("added_stackable_item", { quantity: 10 }, "ferrite_shale")).toBe(
      "Added 10 × Ferrite Shale to carried inventory.",
    );
  });

  it("formats added unique with human item label from details", () => {
    expect(
      formatAuditSummary(
        "added_unique_item",
        { itemId: "mykea_schleppraum_8", currentCharge: 0 },
        "instance-1",
      ),
    ).toBe("Added unique MYKEA SCHLEPPRAUM-8 to carried inventory.");
  });

  it("formats a mission chain reset by row count", () => {
    expect(
      formatAuditSummary(
        "reset_mission_chain",
        {
          scope: ["walk_it_off", "cut_your_teeth"],
          deletedMissionIds: ["walk_it_off", "cut_your_teeth"],
        },
        "walk_it_off",
      ),
    ).toBe("Reset the mission chain rooted at Walk It Off: cleared 2 row(s).");
  });

  it("formats reset_all_missions by row count", () => {
    expect(
      formatAuditSummary("reset_all_missions", { deletedMissionIds: ["a", "b", "c"] }, null),
    ).toBe("Reset ALL missions for this character: cleared 3 row(s).");
  });

  it("formats set_skill_xp as a before → after transition", () => {
    expect(
      formatAuditSummary("set_skill_xp", { skillId: "mining", before: 175, after: 500 }, "mining"),
    ).toBe("Set Mining total XP 175 → 500.");
  });

  it("falls back gracefully for unknown operations and missing details", () => {
    expect(formatAuditSummary("some_future_op", null, null)).toBe("some_future_op.");
    expect(formatAuditSummary("some_future_op", null, "target-1")).toBe(
      "some_future_op (target-1).",
    );
  });

  it("omits invented values when details do not carry them", () => {
    // set_skill_xp with only a skill id — no before/after numbers stored.
    expect(formatAuditSummary("set_skill_xp", { skillId: "mining" }, "mining")).toBe(
      "Set Mining total XP.",
    );
  });
});

describe("admin presentation label helpers", () => {
  it("missionStateLabel maps canonical states to readable labels", () => {
    expect(missionStateLabel("not_accepted")).toBe("not accepted");
    expect(missionStateLabel("active")).toBe("active");
    expect(missionStateLabel("ready_for_completion")).toBe("ready to complete");
    expect(missionStateLabel("completed")).toBe("completed");
    expect(missionStateLabel("unknown")).toBe("unknown");
  });

  it("itemLabel resolves canonical item ids to display names", () => {
    expect(itemLabel("ferrite_shale")).toBe("Ferrite Shale");
    expect(itemLabel("salvage_cutter")).toBe("Salvage Cutter");
    expect(itemLabel("totally_unknown_item")).toBe("totally_unknown_item");
  });

  it("missionLabel resolves canonical mission ids to titles", () => {
    expect(missionLabel("cut_your_teeth")).toBe("Cut Your Teeth");
    expect(missionLabel("definitely_not_a_mission")).toBe("definitely_not_a_mission");
  });
});
