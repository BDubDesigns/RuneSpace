"use client";

import {
  DIAGNOSTIC_MAX_BYTES,
  clientDiagnosticSchema,
  type ClientDiagnostic,
} from "@/game/schemas/diagnostics";

declare global {
  interface Window {
    __runespaceDiagnosticsInstalled?: boolean;
  }
}

let sending = false;
const reportedErrors = new WeakSet<object>();

function id() {
  return `rs-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function routeName(pathname = window.location.pathname): ClientDiagnostic["route"] {
  return /^\/play\/[^/]+/.test(pathname)
    ? "/play/[characterId]"
    : pathname === "/characters"
      ? "/characters"
      : "/other";
}

function details(error: unknown) {
  if (error instanceof Error)
    return {
      errorName: clean(error.name || "Error", 100),
      message: clean(error.message || "Unexpected error", 500),
      stack: error.stack ? clean(error.stack, 2_000) : undefined,
      digest:
        typeof (error as Error & { digest?: unknown }).digest === "string"
          ? clean((error as Error & { digest: string }).digest, 100)
          : undefined,
    };
  return { errorName: "NonErrorThrown", message: "Unexpected non-error value was thrown" };
}

function clean(value: string, max: number) {
  return value
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
    .replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi, "[identifier]")
    .slice(0, max);
}

export function reportClientDiagnostic(
  source: ClientDiagnostic["source"],
  error: unknown,
  options: { miningActive?: boolean; incidentId?: string } = {},
) {
  if (error && typeof error === "object") {
    if (reportedErrors.has(error)) return options.incidentId;
    reportedErrors.add(error);
  }
  if (sending) return options.incidentId;
  const payload = clientDiagnosticSchema.parse({
    timestamp: new Date().toISOString(),
    incidentId: options.incidentId ?? id(),
    releaseId: process.env.NEXT_PUBLIC_RUNESPACE_RELEASE_ID || undefined,
    source,
    ...details(error),
    route: routeName(),
    online: navigator.onLine,
    platform: navigator.userAgent.slice(0, 120),
    miningActive: options.miningActive,
  });
  const body = JSON.stringify(payload);
  if (new TextEncoder().encode(body).byteLength > DIAGNOSTIC_MAX_BYTES) return payload.incidentId;
  sending = true;
  try {
    if (!navigator.sendBeacon?.("/api/diagnostics", new Blob([body], { type: "application/json" })))
      void fetch("/api/diagnostics", {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
        keepalive: true,
      }).catch(() => undefined);
  } catch {
    // Reporting is intentionally best-effort and must not become another error source.
  } finally {
    sending = false;
  }
  return payload.incidentId;
}

export function installClientDiagnostics() {
  if (window.__runespaceDiagnosticsInstalled) return;
  window.__runespaceDiagnosticsInstalled = true;
  window.addEventListener("error", (event) =>
    reportClientDiagnostic("window-error", event.error ?? new Error(event.message)),
  );
  window.addEventListener("unhandledrejection", (event) =>
    reportClientDiagnostic("unhandled-rejection", event.reason),
  );
}
