declare module "@/scripts/player-identity-cutover.mjs" {
  export const EXECUTION_CONFIRMATION: string;
  export const REPORT_KIND: string;
  export const REPORT_SCHEMA_VERSION: number;
  export type NameOverrides = Record<string, string>;
  export type PlannedAccount = {
    userId: string;
    legacyName: string;
    source: "legacy-name" | "operator-resolution";
    playerName: string;
    playerNameKey: string;
    wasEmailVerified: boolean;
  };
  export type PlanProblem = {
    userId: string;
    legacyName: string;
    source: "legacy-name" | "operator-resolution";
    reason: "invalid" | "taken" | "cohort-collision";
    detail: string;
  };
  export type CutoverPlan = { accounts: PlannedAccount[]; problems: PlanProblem[] };
  export type CutoverReport = CutoverPlan & {
    kind: string;
    schemaVersion: number;
    mode: "dry-run";
    generatedAt: string;
    nameOverrides: NameOverrides;
    counts: { cohort: number; ready: number; problems: number; toMarkVerified: number };
  };
  export class PlayerIdentityCutoverError extends Error {}
  export function parseArguments(argv: readonly string[]):
    | {
        mode: "dry-run" | "verify" | "execute";
        nameOverrides: NameOverrides;
        confirm?: string;
        expectedReport?: string;
      }
    | { help: true };
  export function queryPlan(
    client: import("pg").Client,
    nameOverrides?: NameOverrides,
    options?: { forUpdate?: boolean },
  ): Promise<CutoverPlan>;
  export function reportFromPlan(plan: CutoverPlan, nameOverrides?: NameOverrides): CutoverReport;
  export function verifyApplied(
    client: import("pg").Client,
    expectedReport: CutoverReport,
  ): Promise<{ expected: number; found: number; passed: boolean }>;
  export function executeCutover(
    client: import("pg").Client,
    expectedReport: CutoverReport,
    confirmation: string,
    nameOverrides?: NameOverrides,
  ): Promise<{
    kind: string;
    schemaVersion: number;
    mode: "execute";
    generatedAt: string;
    updated: number;
    verification: {
      withinTransaction: { expected: number; found: number; passed: boolean };
      afterCommit: { expected: number; found: number; passed: boolean };
    };
  }>;
}
