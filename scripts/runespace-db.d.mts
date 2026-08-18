import type { SpawnSyncOptions, SpawnSyncReturns } from "node:child_process";

export const CONTROL_DATABASE: "runespace_control";
export const DEVELOPMENT_ROLE: "runespace_dev";

export class LocalDatabaseError extends Error {}

export interface DatabaseClient {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(sql: string, parameters?: unknown[]): Promise<{ rowCount: number | null }>;
}

export type DatabaseClientFactory = (connectionString: string) => DatabaseClient;

export interface DatabaseOperationOptions {
  clientFactory?: DatabaseClientFactory;
}

export interface RunDatabaseCommandOptions extends DatabaseOperationOptions {
  spawnSyncImpl?: (
    command: string,
    args: string[],
    options: SpawnSyncOptions,
  ) => SpawnSyncReturns<Buffer>;
}

export function normalizeDatabaseKey(key: string | undefined): string;

export function parseControlDatabaseUrl(databaseUrl: string | undefined): URL;

export function buildTargetDatabaseUrl(
  databaseUrl: string | undefined,
  key: string | undefined,
): { databaseName: string; databaseUrl: string };

export function createDatabase(
  databaseUrl: string | undefined,
  key: string | undefined,
  options?: DatabaseOperationOptions,
): Promise<string>;

export function dropDatabase(
  databaseUrl: string | undefined,
  key: string | undefined,
  options?: DatabaseOperationOptions,
): Promise<string>;

export function runDatabaseCommand(
  databaseUrl: string | undefined,
  key: string | undefined,
  commandArgs: string[],
  options?: RunDatabaseCommandOptions,
): Promise<{ signal: NodeJS.Signals | null; status: number }>;

export function safeErrorMessage(error: unknown): string;

export function main(
  argv: string[],
  environment?: NodeJS.ProcessEnv,
): Promise<{ signal: NodeJS.Signals | null; status: number }>;
