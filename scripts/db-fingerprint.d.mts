export interface DatabaseFingerprint {
  database: string;
  user: string;
  serverPort: number;
  socket: "tcp" | "unix";
  inRecovery: boolean;
}

export interface DatabaseFingerprintRow {
  database: string;
  dbUser: string;
  serverPort: number;
  inRecovery: boolean;
}

export interface ClassifyResult {
  ok: boolean;
  reason: string | null;
}

export function projectFingerprint(
  row: DatabaseFingerprintRow,
  socketKind: string,
): DatabaseFingerprint;

export function classifyDatabaseUrl(databaseUrl: string | undefined): ClassifyResult;

export function main(
  environment?: NodeJS.ProcessEnv,
  log?: (message: string) => void,
  errorLog?: (message: string) => void,
): Promise<{ status: number; signal: NodeJS.Signals | null }>;
