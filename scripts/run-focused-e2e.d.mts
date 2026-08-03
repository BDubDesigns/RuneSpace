export const DEFAULT_FOCUSED_PORT: number;
export const RESERVED_FOCUSED_PORTS: number[];
export const FOCUSED_PHASES: string[];
export const FOCUSED_AUTH_SECRET: string;

export function requireFocusedSpec(argv: string[]): string;

export function resolveFocusedPort(raw: string | undefined): number;

export function buildFocusedEnv(input: {
  databaseUrl: string | undefined;
  port: number;
}): NodeJS.ProcessEnv;
