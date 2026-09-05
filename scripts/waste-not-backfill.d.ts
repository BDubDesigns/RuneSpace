declare module "@/scripts/waste-not-backfill.mjs" {
  export const EXECUTION_CONFIRMATION: string;
  export const REPORT_KIND: string;
  export const REPORT_SCHEMA_VERSION: number;
  const AUTHORITY: {
    readonly missionIds: {
      readonly walkItOff: string;
      readonly cutYourTeeth: string;
      readonly wasteNot: string;
    };
    readonly progressKey: string;
  };
  export type WasteNotBackfillScan = {
    wouldAcceptCharacterIds: string[];
    skippedActiveAction: { characterId: string; actionId: string }[];
    alreadyAcceptedCharacterIds: string[];
  };
  export type WasteNotBackfillReport = WasteNotBackfillScan & {
    kind: string;
    schemaVersion: number;
    mode: "dry-run";
    generatedAt: string;
    authority: typeof AUTHORITY;
    counts: {
      wouldAccept: number;
      skippedActiveAction: number;
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
  export function queryScan(client: import("pg").Client): Promise<WasteNotBackfillScan>;
  export function reportFromScan(scan: WasteNotBackfillScan): WasteNotBackfillReport;
  export function lockPopulation(client: import("pg").Client): Promise<void>;
  export function applyBackfill(
    client: import("pg").Client,
    characterIds: readonly string[],
    now: Date,
  ): Promise<void>;
  export function executeBackfill(
    client: import("pg").Client,
    expectedReport: WasteNotBackfillReport,
    confirmation: string,
    now?: Date,
  ): Promise<{
    kind: string;
    schemaVersion: number;
    mode: "execute";
    generatedAt: string;
    accepted: number;
    skippedActiveAction: WasteNotBackfillScan["skippedActiveAction"];
    verification: {
      withinTransaction: Awaited<ReturnType<typeof verifyApplied>>;
      afterCommit: Awaited<ReturnType<typeof verifyApplied>>;
    };
  }>;
  export function verifyApplied(
    client: import("pg").Client,
    expectedReport: WasteNotBackfillReport,
  ): Promise<{
    expected: number;
    accepted: number;
    progressAtZero: number;
    passed: boolean;
  }>;
}
