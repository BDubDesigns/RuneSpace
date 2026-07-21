import {
  sanitizeClientDiagnostic,
  sanitizeDiagnosticText,
  sanitizeReleaseId,
  type ClientDiagnostic,
} from "@/game/schemas/diagnostics";

type SafeError = {
  name: string;
  message: string;
  stack?: string;
  digest?: string;
};

const reportedErrors = new WeakSet<object>();

export function releaseId() {
  return sanitizeReleaseId(process.env.RUNESPACE_RELEASE_ID);
}

export function safeError(error: unknown): SafeError {
  if (error instanceof Error) {
    const digest = "digest" in error && typeof error.digest === "string" ? error.digest : undefined;
    return {
      name: sanitizeDiagnosticText(error.name || "Error", 100) || "Error",
      message:
        sanitizeDiagnosticText(error.message || "Unexpected error", 500) || "Unexpected error",
      stack: error.stack ? sanitizeDiagnosticText(error.stack, 2_000, 20) : undefined,
      digest: digest ? sanitizeDiagnosticText(digest, 100) : undefined,
    };
  }
  return {
    name: "NonErrorThrown",
    message: "Unexpected non-error value was thrown",
  };
}

export function logDiagnostic(
  source: "client" | "server",
  details: Record<string, unknown>,
  error?: unknown,
) {
  if (error && typeof error === "object") {
    if (reportedErrors.has(error)) return;
    reportedErrors.add(error);
  }
  console.error(
    JSON.stringify({
      event: "runespace.diagnostic",
      timestamp: new Date().toISOString(),
      serverReleaseId: releaseId(),
      source,
      ...details,
      ...(error ? safeError(error) : {}),
    }),
  );
}

export function logClientDiagnostic(diagnostic: ClientDiagnostic) {
  // A report can bypass browser sanitization, so sanitize again before stderr.
  logDiagnostic("client", sanitizeClientDiagnostic(diagnostic));
}
