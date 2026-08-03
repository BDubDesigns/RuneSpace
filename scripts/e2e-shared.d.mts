import type { ChildProcess } from "node:child_process";

export const ROOT: string;
export const PACKAGE_MANAGER: string;

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
  throwIfAborted(): void;
  runCommand(args: string[], label: string, command?: string): Promise<void>;
  runTimedCommand(args: string[], label: string, command?: string): Promise<void>;
  startServer(): void;
  waitForServer(): Promise<void>;
  terminateOwned(): Promise<void>;
}

export function createE2eRuntime(options: E2eRuntimeOptions): E2eRuntime;
