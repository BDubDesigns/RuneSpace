import type { ClientDiagnostic } from "@/game/schemas/diagnostics";

type SafeError = { name: string; message: string; stack?: string; digest?: string };

const reportedErrors = new WeakSet<object>();

function truncate(value: string, length: number) {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
    .replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi, "[identifier]")
    .slice(0, length);
}

export function releaseId() {
  return process.env.RUNESPACE_RELEASE_ID?.slice(0, 100) || undefined;
}

export function safeError(error: unknown): SafeError {
  if (error instanceof Error) {
    const digest = "digest" in error && typeof error.digest === "string" ? error.digest : undefined;
    return {
      name: truncate(error.name || "Error", 100),
      message: truncate(error.message || "Unexpected error", 500),
      stack: error.stack ? truncate(error.stack, 2_000) : undefined,
      digest: digest ? truncate(digest, 100) : undefined,
    };
  }
  return { name: "NonErrorThrown", message: "Unexpected non-error value was thrown" };
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
      releaseId: releaseId(),
      source,
      ...details,
      ...(error ? safeError(error) : {}),
    }),
  );
}

export function logClientDiagnostic(diagnostic: ClientDiagnostic) {
  // The deployment's configured release is authoritative; never let a browser
  // supplied value overwrite it in application logs.
  const { releaseId: _clientReleaseId, ...safeDiagnostic } = diagnostic;
  logDiagnostic("client", safeDiagnostic);
}
