import type { ChildProcess } from "node:child_process";

export const ROOT: string;
export const PACKAGE_MANAGER: string;

export const E2E_ADMIN_USER_IDS: string;
export function accountBoundaryE2eEnv(input: { port: number; runId: string }): {
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
  RUNESPACE_E2E_TURNSTILE_SITEVERIFY_URL: string;
  RUNESPACE_E2E_MAIL_OUTBOX_FILE: string;
};

export function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  label: string,
): number;

export function readPositiveDuration(value: string | undefined, fallback: number): number;

export function fail(msg: string): never;

export function isRunning(child: ChildProcess | null | undefined): boolean;

export function waitForClose(child: ChildProcess, timeoutMs: number): Promise<boolean>;

export function terminateProcess(
  child: ChildProcess,
  label: string,
  log?: (msg: string) => void,
): Promise<void>;

export function assertPortAvailable(port: number): Promise<void>;

export function assertLocalDatabaseUrl(databaseUrl: string | undefined): void;

export function assertNode22(version?: string): void;

export const E2E_LOCK_PATH: string;
export const DEFAULT_E2E_LOCK_WAIT_MS: number;
export const E2E_LOCK_POLL_MS: number;

export interface E2eLockOwner {
  pid: number;
  processStart: string | null;
  label: string;
  worktree: string;
  acquiredAt: string;
  token: string;
}

export interface E2eLockHandle {
  owner: E2eLockOwner | null;
  release(): void;
}

export interface AcquireE2eLockOptions {
  label: string;
  log(msg: string): void;
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
  path?: string;
  maxWaitMs?: number;
  pollMs?: number;
}

export function readProcessStartTime(pid: number): string | null;
export function isE2eLockOwnerAlive(owner: Partial<E2eLockOwner> | null | undefined): boolean;
export function readE2eLockOwner(path?: string): E2eLockOwner | null;
export function acquireE2eLock(options: AcquireE2eLockOptions): Promise<E2eLockHandle>;

export interface E2eRuntimeOptions {
  label: string;
  port: number;
  env: NodeJS.ProcessEnv;
  readyTimeoutMs: number;
}

export interface E2eRuntime {
  log(msg: string): void;
  fail(msg: string): never;
  abort(reason: string): void;
  readonly signal: AbortSignal;
  throwIfAborted(): void;
  runCommand(args: string[], label: string, command?: string): Promise<void>;
  runTimedCommand(args: string[], label: string, command?: string): Promise<void>;
  startServer(): void;
  waitForServer(): Promise<void>;
  terminateOwned(): Promise<void>;
}

export function createE2eRuntime(options: E2eRuntimeOptions): E2eRuntime;
