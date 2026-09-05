declare module "@/scripts/waste-not-backfill.mjs" {
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
  export function queryScan(client: import("pg").Client): Promise<WasteNotBackfillScan>;
  export function reportFromScan(scan: WasteNotBackfillScan): WasteNotBackfillReport;
  export function lockPopulation(client: import("pg").Client): Promise<void>;
  export function applyBackfill(
    client: import("pg").Client,
    characterIds: readonly string[],
    now: Date,
  ): Promise<void>;
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
