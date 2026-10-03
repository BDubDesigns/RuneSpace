export type NeedsContext = Record<string, { result?: string } | undefined>;

export const REQUIRED_JOBS: readonly string[];

export const OPTIONAL_JOBS: readonly string[];

export function evaluateMergeGate(needs: NeedsContext | null | undefined): {
  passed: boolean;
  failures: string[];
};
