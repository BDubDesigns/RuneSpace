declare module "@/scripts/hold-it-together-backfill.mjs" {
  export const EXECUTION_CONFIRMATION: string;
  export const REPORT_KIND: string;
  export const REPORT_SCHEMA_VERSION: number;
  const AUTHORITY: {
    readonly missionIds: {
      readonly wasteNot: string;
      readonly holdItTogether: string;
    };
  };
  export type HoldItTogetherBackfillScan = {
    wouldAcceptCharacterIds: string[];
    alreadyAcceptedCharacterIds: string[];
  };
  export type HoldItTogetherBackfillReport = HoldItTogetherBackfillScan & {
    kind: string;
    schemaVersion: number;
    mode: "dry-run";
    generatedAt: string;
    authority: typeof AUTHORITY;
    counts: {
      wouldAccept: number;
      alreadyAccepted: number;
    };
  };
  export function parseArguments(
    argv: readonly string[],
  ):
    | { mode: "dry-run" }
    | { mode: "verify"; expectedReport: string }
    | { mode: "execute"; expectedReport: string; confirm: string }
    | { help: true };
  export function queryScan(client: import("pg").Client): Promise<HoldItTogetherBackfillScan>;
  export function reportFromScan(scan: HoldItTogetherBackfillScan): HoldItTogetherBackfillReport;
  export function lockPopulation(client: import("pg").Client): Promise<void>;
  export function applyBackfill(
    client: import("pg").Client,
    characterIds: readonly string[],
    now: Date,
  ): Promise<void>;
  export function executeBackfill(
    client: import("pg").Client,
    expectedReport: HoldItTogetherBackfillReport,
    confirmation: string,
    now?: Date,
  ): Promise<{
    kind: string;
    schemaVersion: number;
    mode: "execute";
    generatedAt: string;
    accepted: number;
    verification: {
      withinTransaction: Awaited<ReturnType<typeof verifyApplied>>;
      afterCommit: Awaited<ReturnType<typeof verifyApplied>>;
    };
  }>;
  export function verifyApplied(
    client: import("pg").Client,
    expectedReport: HoldItTogetherBackfillReport,
  ): Promise<{
    expected: number;
    accepted: number;
    completed: number;
    progressRows: number;
    passed: boolean;
  }>;
}
