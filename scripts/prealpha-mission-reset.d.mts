export type ResetCounts = {
  affectedCharacters: number;
  walkItOffRows: number;
  cutYourTeethRows: number;
  salvageCutterInstances: number;
  equippedSalvageCutterAssignments: number;
  unrelatedInventoryStackRows: number;
  unrelatedInventoryQuantity: number;
  unrelatedItemInstances: number;
};

export type ResetBaseline = {
  unrelatedStateFingerprint: string;
  unrelatedInventoryStackRows: number;
  unrelatedInventoryQuantity: number;
  unrelatedItemInstances: number;
  miningXp: readonly {
    characterId: string;
    totalXp: string | null;
    rowCount: number;
  }[];
};

export type ResetUnsafeState = {
  code: string;
  count: number;
  characterIds: readonly string[];
  actionIds?: readonly string[];
};

export type ResetScan = {
  characterIds: readonly string[];
  counts: ResetCounts;
  unsafeStates: readonly ResetUnsafeState[];
  baseline: ResetBaseline;
};

export type ResetReport = {
  kind: string;
  schemaVersion: number;
  mode: string;
  authority: unknown;
  affectedCharacterIds: readonly string[];
  counts: ResetCounts;
  unsafeStates: readonly ResetUnsafeState[];
  baseline: ResetBaseline;
};

export const REPORT_KIND: string;
export const REPORT_SCHEMA_VERSION: number;
export const EXECUTION_CONFIRMATION: string;

export function stableJson(value: unknown): string;
export function parseArguments(argv: readonly string[]): {
  mode: "dry-run" | "execute" | "verify" | "help";
  expectedReportPath?: string;
  confirmation?: string;
};
export function scanResetState(client: unknown): Promise<ResetScan>;
export function executeReset(client: unknown, expectedReport: ResetReport): Promise<unknown>;
export function verifyReset(client: unknown, expectedReport: ResetReport): Promise<unknown>;
export function assertExpectedDryRunMatches(
  currentScan: ResetScan,
  expectedReport: ResetReport,
): void;
