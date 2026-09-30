import { describe, expect, it } from "vitest";
import {
  formatAuditSummary,
  formatOperatorTime,
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
  it("formats stop_current_action with the stored action id", () => {
    expect(formatAuditSummary("stop_current_action", { actionId: "mining" }, "mining")).toBe(
      'Stopped the in-progress "mining" action.',
    );
  });

  it("formats stop_current_action without inventing an action id", () => {
    expect(formatAuditSummary("stop_current_action", {}, null)).toBe(
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
    ).toBe('Teleported The Jag → Crash Site (interrupted "mining").');
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

  it("formats an enriched one-item removal with the item name (current rows carry itemId)", () => {
    expect(
      formatAuditSummary(
        "removed_stack_quantity",
        { source: "carried", mode: "one", removedQuantity: 1, itemId: "ferrite_shale" },
        "stack-1",
      ),
    ).toBe("Removed 1 Ferrite Shale from carried inventory.");
  });

  it("formats an enriched whole-stack removal with the item name and count", () => {
    expect(
      formatAuditSummary(
        "removed_stack_quantity",
        { source: "cargo", mode: "stack", removedQuantity: 10, itemId: "ferrite_shale" },
        "stack-2",
      ),
    ).toBe("Removed the whole Ferrite Shale stack from the Cargo hold (10 items).");
  });

  it("formats an enriched whole-stack removal with singular count", () => {
    expect(
      formatAuditSummary(
        "removed_stack_quantity",
        { source: "carried", mode: "stack", removedQuantity: 1, itemId: "refined_ferrite" },
        "stack-3",
      ),
    ).toBe("Removed the whole Refined Ferrite stack from carried inventory (1 item).");
  });

  it("keeps the generic summaries for legacy rows without itemId", () => {
    // Historical rows (pre-enrichment) carry no itemId and must still render.
    expect(
      formatAuditSummary(
        "removed_stack_quantity",
        { source: "carried", mode: "stack", removedQuantity: 4 },
        "stack-1",
      ),
    ).toBe("Removed the whole stack from carried inventory (4 items).");
    expect(
      formatAuditSummary(
        "removed_stack_quantity",
        { source: "cargo", mode: "one", removedQuantity: 1 },
        "stack-2",
      ),
    ).toBe("Removed 1 item from the Cargo hold.");
  });

  it("formats an enriched force unequip with the item name (current rows carry itemId)", () => {
    expect(
      formatAuditSummary(
        "force_unequipped_item",
        { assignmentKind: "gear", suitSlotId: "mining_tool", itemId: "salvage_cutter" },
        "instance-9",
      ),
    ).toBe("Force-unequipped Salvage Cutter from Mining Tool.");
  });

  it("keeps the generic force-unequip summary for legacy rows without itemId", () => {
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

  it("falls back honestly when a removed unique row lacks the item id", () => {
    expect(formatAuditSummary("removed_unique_item", { source: "carried" }, "instance-9")).toBe(
      "Permanently deleted unique item from carried inventory.",
    );
  });

  it("formats added stackable with human item label from target identity", () => {
    expect(formatAuditSummary("added_stackable_item", { quantity: 10 }, "ferrite_shale")).toBe(
      "Added 10 × Ferrite Shale to carried inventory.",
    );
  });

  it("falls back honestly when an added stackable row lacks the target identity", () => {
    expect(formatAuditSummary("added_stackable_item", { quantity: 3 }, null)).toBe(
      "Added 3 item(s) to carried inventory.",
    );
  });

  it("formats added unique with human item label and stored charge", () => {
    expect(
      formatAuditSummary(
        "added_unique_item",
        { itemId: "salvage_cutter", currentCharge: 87 },
        "instance-1",
      ),
    ).toBe("Added unique Salvage Cutter to carried inventory (charge 87).");
  });

  it("formats added unique without a stored charge", () => {
    expect(
      formatAuditSummary("added_unique_item", { itemId: "mykea_schleppraum_8" }, "instance-1"),
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

  it("falls back honestly when a chain reset row lacks the mission identity", () => {
    expect(formatAuditSummary("reset_mission_chain", { deletedMissionIds: ["a"] }, null)).toBe(
      "Reset the mission chain: cleared 1 row(s).",
    );
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

describe("formatAuditSummary — moderation operations (issue #248)", () => {
  it("formats open_moderation_case with the stored reason", () => {
    expect(
      formatAuditSummary(
        "open_moderation_case",
        { reason: "Seen scamming in chat", fromCharacterId: "c-1" },
        "MOD-00007",
      ),
    ).toBe('Opened the case. Reason: "Seen scamming in chat"');
    expect(formatAuditSummary("open_moderation_case", {}, "MOD-00007")).toBe("Opened the case.");
  });

  it("formats set_moderation_case_status with domain labels", () => {
    expect(
      formatAuditSummary("set_moderation_case_status", { from: "open", to: "dismissed" }, null),
    ).toBe("Set case status Open → Dismissed.");
    expect(formatAuditSummary("set_moderation_case_status", {}, null)).toBe("Set the case status.");
  });

  it("formats add_moderation_case_note without leaking the note body", () => {
    expect(formatAuditSummary("add_moderation_case_note", { noteId: "n-1" }, null)).toBe(
      "Added a case note.",
    );
  });

  it("formats a timed sanction with rule, duration, end, and case transition", () => {
    expect(
      formatAuditSummary(
        "issue_moderation_sanction",
        {
          reference: "MOD-00003",
          kind: "social_restriction",
          ruleCategory: "harassment",
          duration: "7d",
          endsAt: "2026-10-07T12:00:00.000Z",
          caseStatus: { from: "reviewed", to: "actioned" },
        },
        "s-1",
      ),
    ).toBe(
      "Issued Social restriction on MOD-00003 (Harassment, 7 days, ends 2026-10-07 12:00:00 UTC); case Reviewed → Actioned.",
    );
  });

  it("formats a warning and a permanent suspension", () => {
    expect(
      formatAuditSummary(
        "issue_moderation_sanction",
        {
          reference: "MOD-00003",
          kind: "warning",
          ruleCategory: "scams_spam",
          duration: null,
          endsAt: null,
          caseStatus: { from: "open", to: "actioned" },
        },
        "s-1",
      ),
    ).toBe("Issued Warning on MOD-00003 (Scams, impersonation, or spam); case Open → Actioned.");
    expect(
      formatAuditSummary(
        "issue_moderation_sanction",
        {
          reference: "MOD-00004",
          kind: "suspension",
          ruleCategory: "threats_private_info",
          duration: "permanent",
          endsAt: null,
          caseStatus: { from: "open", to: "actioned" },
        },
        "s-2",
      ),
    ).toBe(
      "Issued Account suspension on MOD-00004 (Threats or sharing private information, Permanent); case Open → Actioned.",
    );
  });

  it("formats change_moderation_sanction_duration, noting an appeal", () => {
    expect(
      formatAuditSummary(
        "change_moderation_sanction_duration",
        {
          kind: "suspension",
          duration: { from: "30d", to: "7d" },
          endsAt: { from: "2026-10-30T00:00:00.000Z", to: "2026-10-07T00:00:00.000Z" },
          appealId: "a-1",
        },
        "s-1",
      ),
    ).toBe(
      "Changed Account suspension duration 30 days → 7 days (ends 2026-10-30 00:00:00 UTC → 2026-10-07 00:00:00 UTC) while deciding an appeal.",
    );
    expect(
      formatAuditSummary(
        "change_moderation_sanction_duration",
        {
          kind: "social_restriction",
          duration: { from: "7d", to: "permanent" },
          endsAt: { from: "2026-10-07T00:00:00.000Z", to: null },
        },
        "s-1",
      ),
    ).toBe(
      "Changed Social restriction duration 7 days → Permanent (ends 2026-10-07 00:00:00 UTC → never).",
    );
  });

  it("formats reverse_moderation_sanction", () => {
    expect(
      formatAuditSummary(
        "reverse_moderation_sanction",
        { kind: "warning", ruleCategory: "harassment" },
        "s-1",
      ),
    ).toBe("Reversed Warning (Harassment).");
    expect(
      formatAuditSummary(
        "reverse_moderation_sanction",
        { kind: "suspension", ruleCategory: "harassment", appealId: "a-1" },
        "s-1",
      ),
    ).toBe("Reversed Account suspension (Harassment) while deciding an appeal.");
  });

  it("formats decide_moderation_appeal outcomes", () => {
    expect(
      formatAuditSummary(
        "decide_moderation_appeal",
        { sanctionId: "s-1", outcome: "modified", duration: "7d", hasNote: true },
        "a-1",
      ),
    ).toBe("Decided an appeal: Modified (new duration 7 days), with an internal note.");
    expect(
      formatAuditSummary(
        "decide_moderation_appeal",
        { sanctionId: "s-1", outcome: "upheld", hasNote: false },
        "a-1",
      ),
    ).toBe("Decided an appeal: Upheld.");
  });

  it("formatOperatorTime renders deterministic UTC and passes through garbage", () => {
    expect(formatOperatorTime("2026-09-30T14:03:05.123Z")).toBe("2026-09-30 14:03:05 UTC");
    expect(formatOperatorTime("not a date")).toBe("not a date");
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
