"use client";

import {
  DIAGNOSTIC_MAX_BYTES,
  clientDiagnosticSchema,
  sanitizeDiagnosticText,
  sanitizeReleaseId,
  type ClientDiagnostic,
} from "@/game/schemas/diagnostics";

declare global {
  interface Window {
    __runespaceDiagnosticsInstalled?: boolean;
  }
}

const incidents = new WeakMap<object, string>();
function fallbackId() {
  return `rs-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.slice(0, 35);
}
function createId() {
  try {
    return `rs-${globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 16) ?? fallbackId().slice(3)}`;
  } catch {
    return fallbackId();
  }
}
function errorDetails(error: unknown) {
  if (error instanceof Error)
    return {
      errorName: sanitizeDiagnosticText(error.name || "Error", 100) || "Error",
      message:
        sanitizeDiagnosticText(error.message || "Unexpected error", 500) || "Unexpected error",
      stack: error.stack ? sanitizeDiagnosticText(error.stack, 2_000, 20) : undefined,
      digest:
        typeof (error as Error & { digest?: unknown }).digest === "string"
          ? sanitizeDiagnosticText((error as Error & { digest: string }).digest, 100)
          : undefined,
    };
  return {
    errorName: "NonErrorThrown",
    message: "Unexpected non-error value was thrown",
  };
}

/** Best effort by design: diagnostics can never throw into player interaction. */
export function reportClientDiagnostic(
  source: ClientDiagnostic["source"],
  error: unknown,
  options: { miningActive?: boolean; onAccepted?: (incidentId: string) => void } = {},
) {
  let id = "rs-unknown";
  try {
    id = createId();
    if (error && typeof error === "object") {
      const existing = incidents.get(error);
      if (existing) return existing;
      incidents.set(error, id);
    }
    const pathname = globalThis.location?.pathname ?? "/other";
    const route: ClientDiagnostic["route"] = /^\/play\/[^/]+/.test(pathname)
      ? "/play/[characterId]"
      : pathname === "/characters"
        ? "/characters"
        : "/other";
    const parsed = clientDiagnosticSchema.safeParse({
      timestamp: new Date().toISOString(),
      incidentId: id,
      clientReleaseId: sanitizeReleaseId(process.env.NEXT_PUBLIC_RUNESPACE_RELEASE_ID),
      source,
      ...errorDetails(error),
      route,
      online: globalThis.navigator?.onLine ?? false,
      platform: sanitizeDiagnosticText(globalThis.navigator?.userAgent ?? "", 120) || undefined,
      miningActive: options.miningActive,
    });
    if (!parsed.success) return id;
    const body = JSON.stringify(parsed.data);
    if (new TextEncoder().encode(body).byteLength > DIAGNOSTIC_MAX_BYTES) return id;
    if (options.onAccepted) {
      void globalThis.fetch!("/api/diagnostics", {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
        keepalive: true,
      })
        .then((response) => {
          if (response.ok) options.onAccepted?.(id);
        })
        .catch(() => undefined);
    } else if (
      !globalThis.navigator?.sendBeacon?.(
        "/api/diagnostics",
        new Blob([body], { type: "application/json" }),
      )
    ) {
      void globalThis
        .fetch?.("/api/diagnostics", {
          method: "POST",
          body,
          headers: { "content-type": "application/json" },
          keepalive: true,
        })
        .catch(() => undefined);
    }
  } catch {
    try {
      id = id === "rs-unknown" ? fallbackId() : id;
    } catch {
      /* deliberately silent */
    }
  }
  return id;
}
export function installClientDiagnostics() {
  try {
    if (window.__runespaceDiagnosticsInstalled) return;
    window.__runespaceDiagnosticsInstalled = true;
    window.addEventListener("error", (event) =>
      reportClientDiagnostic("window-error", event.error ?? new Error(event.message)),
    );
    window.addEventListener("unhandledrejection", (event) =>
      reportClientDiagnostic("unhandled-rejection", event.reason),
    );
  } catch {
    /* startup remains safe */
  }
}
