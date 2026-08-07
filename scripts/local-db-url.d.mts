export interface LocalDatabaseUrlValidationResult {
  ok: boolean;
  reason: string | null;
}

export function validateLocalDatabaseUrl(
  databaseUrl: string | undefined,
): LocalDatabaseUrlValidationResult;

export function assertLocalDatabaseUrl(databaseUrl: string | undefined): void;
