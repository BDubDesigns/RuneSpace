import { describe, expect, it } from "vitest";
import {
  OPERATOR_OPERATIONS,
  OPERATOR_OPERATION_TARGET_KINDS,
  operatorAuditTargetColumns,
} from "@/server/admin-audit";

/** Issue #223 — the generalized operator audit target shapes. */
describe("operator audit targets", () => {
  it("maps each target kind to exactly its own columns", () => {
    expect(
      operatorAuditTargetColumns("set_skill_xp", { kind: "character", characterId: "c1" }),
    ).toEqual({ targetKind: "character", characterId: "c1", playerAccountId: null });
    expect(
      operatorAuditTargetColumns("grant_early_access", {
        kind: "player_account",
        playerAccountId: "a1",
      }),
    ).toEqual({ targetKind: "player_account", characterId: null, playerAccountId: "a1" });
    expect(operatorAuditTargetColumns("open_public_gameplay", { kind: "system" })).toEqual({
      targetKind: "system",
      characterId: null,
      playerAccountId: null,
    });
  });

  it("refuses an operation recorded against the wrong target kind", () => {
    expect(() =>
      operatorAuditTargetColumns("grant_early_access", { kind: "character", characterId: "c1" }),
    ).toThrow(/must target player_account/);
    expect(() =>
      operatorAuditTargetColumns("close_public_gameplay", {
        kind: "player_account",
        playerAccountId: "a1",
      }),
    ).toThrow(/must target system/);
    expect(() => operatorAuditTargetColumns("teleport_character", { kind: "system" })).toThrow(
      /must target character/,
    );
  });

  it("keeps every #113 operation character-scoped and adds the four #223 operations", () => {
    expect(OPERATOR_OPERATIONS).toHaveLength(14);
    expect(OPERATOR_OPERATION_TARGET_KINDS).toMatchObject({
      grant_early_access: "player_account",
      revoke_early_access: "player_account",
      open_public_gameplay: "system",
      close_public_gameplay: "system",
    });
    const characterOps = OPERATOR_OPERATIONS.filter(
      (operation) => OPERATOR_OPERATION_TARGET_KINDS[operation] === "character",
    );
    expect(characterOps).toEqual([
      "stop_current_action",
      "teleport_character",
      "removed_stack_quantity",
      "removed_unique_item",
      "force_unequipped_item",
      "added_stackable_item",
      "added_unique_item",
      "reset_mission_chain",
      "reset_all_missions",
      "set_skill_xp",
    ]);
  });
});
