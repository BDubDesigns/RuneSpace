import { describe, expect, it } from "vitest";
import {
  EXECUTION_CONFIRMATION,
  REPORT_KIND,
  REPORT_SCHEMA_VERSION,
  assertExpectedDryRunMatches,
  parseArguments,
  stableJson,
} from "@/scripts/prealpha-mission-reset.mjs";
import { ITEM_IDS, MISSION_IDS, SKILL_IDS } from "@/game/config/foundations";

describe("Issue #126 pre-alpha mission reset operator boundary", () => {
  it("defaults to read-only dry-run mode", () => {
    expect(parseArguments([])).toEqual({ mode: "dry-run" });
  });

  it("requires both the reviewed report and exact confirmation for execution", () => {
    expect(() => parseArguments(["--execute"])).toThrow(
      "--execute requires --expected-report <dry-run.json>",
    );
    expect(() =>
      parseArguments(["--execute", "--expected-report", "dry-run.json", "--confirm", "wrong"]),
    ).toThrow(`--execute requires --confirm ${EXECUTION_CONFIRMATION}`);
    expect(
      parseArguments([
        "--execute",
        "--confirm",
        EXECUTION_CONFIRMATION,
        "--expected-report",
        "dry-run.json",
      ]),
    ).toEqual({
      mode: "execute",
      confirmation: EXECUTION_CONFIRMATION,
      expectedReportPath: "dry-run.json",
    });
  });

  it("keeps verification read-only and rejects confirmation in that mode", () => {
    expect(parseArguments(["--verify", "--expected-report=dry-run.json"])).toEqual({
      mode: "verify",
      expectedReportPath: "dry-run.json",
    });
    expect(() =>
      parseArguments([
        "--verify",
        "--expected-report",
        "dry-run.json",
        "--confirm",
        EXECUTION_CONFIRMATION,
      ]),
    ).toThrow("--confirm is valid only with --execute");
  });

  it("uses the canonical stable IDs in the report identity", () => {
    expect(stableJson({ missionIds: [MISSION_IDS.walkItOff, MISSION_IDS.cutYourTeeth] })).toBe(
      stableJson({ missionIds: ["walk_it_off", "cut_your_teeth"] }),
    );
    expect(stableJson({ itemId: ITEM_IDS.salvageCutter, skillId: SKILL_IDS.mining })).toBe(
      stableJson({ itemId: "salvage_cutter", skillId: "mining" }),
    );
    expect(REPORT_KIND).toBe("runespace.issue-126.prealpha-mission-reset");
    expect(REPORT_SCHEMA_VERSION).toBe(1);
  });

  it("aborts when an execution preflight no longer matches the reviewed report", () => {
    const expected = {
      kind: REPORT_KIND,
      schemaVersion: REPORT_SCHEMA_VERSION,
      mode: "dry-run",
      authority: {
        missionIds: { walkItOff: "walk_it_off", cutYourTeeth: "cut_your_teeth" },
        itemIds: { salvageCutter: "salvage_cutter" },
        skillIds: { mining: "mining" },
      },
      affectedCharacterIds: ["character-1"],
      counts: {
        affectedCharacters: 1,
        walkItOffRows: 1,
        cutYourTeethRows: 1,
        salvageCutterInstances: 1,
        equippedSalvageCutterAssignments: 1,
        unrelatedInventoryStackRows: 0,
        unrelatedInventoryQuantity: 0,
        unrelatedItemInstances: 0,
      },
      unsafeStates: [],
      baseline: {
        unrelatedStateFingerprint: "fingerprint",
        unrelatedInventoryStackRows: 0,
        unrelatedInventoryQuantity: 0,
        unrelatedItemInstances: 0,
        miningXp: [{ characterId: "character-1", totalXp: null, rowCount: 0 }],
      },
    };

    expect(() =>
      assertExpectedDryRunMatches(
        {
          characterIds: ["character-1"],
          counts: { ...expected.counts, salvageCutterInstances: 2 },
          unsafeStates: [],
          baseline: expected.baseline,
        },
        expected,
      ),
    ).toThrow("database state no longer matches the reviewed dry-run report");
  });
});
