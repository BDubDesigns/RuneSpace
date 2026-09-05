import { describe, expect, it } from "vitest";
import {
  EXECUTION_CONFIRMATION,
  REPORT_KIND,
  REPORT_SCHEMA_VERSION,
  parseArguments,
  reportFromScan,
} from "@/scripts/waste-not-backfill.mjs";

describe("Issue #141 Waste Not backfill operator boundary", () => {
  it("defaults to a read-only dry run", () => {
    expect(parseArguments([])).toEqual({ mode: "dry-run" });
  });

  it("requires a reviewed report and exact confirmation for execution", () => {
    expect(() => parseArguments(["--execute"])).toThrow(
      "--expected-report is required for --execute and --verify",
    );
    expect(() =>
      parseArguments(["--execute", "--expected-report", "dry-run.json", "--confirm", "wrong"]),
    ).toThrow(`--confirm must equal ${EXECUTION_CONFIRMATION}`);
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
      confirm: EXECUTION_CONFIRMATION,
      expectedReport: "dry-run.json",
    });
  });

  it("keeps dry-run and verification read-only", () => {
    expect(() => parseArguments(["--expected-report", "dry-run.json"])).toThrow(
      "--expected-report and --confirm are valid only with --verify or --execute",
    );
    expect(parseArguments(["--verify", "--expected-report", "dry-run.json"])).toEqual({
      mode: "verify",
      expectedReport: "dry-run.json",
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

  it("keeps report identity, counts, and active-action rows explicit", () => {
    expect(
      reportFromScan({
        wouldAcceptCharacterIds: ["character-1"],
        skippedActiveAction: [{ characterId: "character-2", actionId: "refining" }],
        alreadyAcceptedCharacterIds: [],
      }),
    ).toMatchObject({
      kind: REPORT_KIND,
      schemaVersion: REPORT_SCHEMA_VERSION,
      mode: "dry-run",
      counts: { wouldAccept: 1, skippedActiveAction: 1, alreadyAccepted: 0 },
    });
  });
});
