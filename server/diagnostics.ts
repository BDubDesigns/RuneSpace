import type { ClientDiagnostic } from "@/game/schemas/diagnostics";

type SafeError = { name: string; message: string; stack?: string; digest?: string };

const reportedErrors = new WeakSet<object>();

function truncate(value: string, length: number) {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/(?:https?:\/\/|file:|webpack:|blob:|\/)[^\s"']+/gi, "[location]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
    .replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi, "[identifier]")
    .replace(/(?:bearer|authorization|cookie|set-cookie|token|secret|password|session|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "[redacted]")
    .replace(/[A-Za-z0-9_-]{32,}/g, "[opaque]")
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
      serverReleaseId: releaseId(),
      source,
      ...details,
      ...(error ? safeError(error) : {}),
    }),
  );
}

export function logClientDiagnostic(diagnostic: ClientDiagnostic) {
  // The deployment's configured release is authoritative; never let a browser
  // supplied value overwrite it in application logs.
  logDiagnostic("client", diagnostic);
}
