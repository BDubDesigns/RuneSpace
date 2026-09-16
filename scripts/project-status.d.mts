export interface ProjectStatusAuthority {
  ownerLogin: string;
  projectNumber: number;
  projectTitle: string;
  repository: string;
  statusFieldName: string;
}

export interface ProjectStatusOptions {
  issueNumber: number | null;
  status: string | null;
  mode: "dry-run" | "execute";
  help: boolean;
}

export interface ProjectBoardItem {
  id: string;
  content?: {
    number?: number;
    repository?: { nameWithOwner?: string };
  } | null;
  fieldValueByName?: { name?: string } | null;
}

export const TOKEN_ENV_VAR: string;
export const AUTHORITY: Readonly<ProjectStatusAuthority>;
export const AGENT_SETTABLE_STATUSES: readonly string[];
export const ALLOWED_TRANSITIONS: Readonly<Record<string, readonly string[]>>;

export class ProjectStatusError extends Error {}

export function parseArguments(argv: string[]): ProjectStatusOptions;
export function assertAgentSettableStatus(raw: string | undefined): string;
export function describeAllowedTransitions(): string;
export function assertAllowedTransition(
  currentStatus: string,
  targetStatus: string,
): "no-op" | "apply";
export function resolveStatusOption(optionNames: string[], target: string): string;
export function selectBoardItem(items: ProjectBoardItem[], issueNumber: number): ProjectBoardItem;
export function readToken(environment: Record<string, string | undefined>): string;
export function describeGraphqlFailure(status: number, body: unknown): string | null;
export function main(
  argv?: string[],
  environment?: Record<string, string | undefined>,
  io?: Pick<Console, "log">,
): Promise<number>;
