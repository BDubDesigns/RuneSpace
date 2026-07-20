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

const incidents = new WeakMap<object, string>();
const scrub = (value: string, max: number) =>
  value
    .replace(/(?:https?:\/\/|file:|webpack:|blob:|\/)[^\s"']+/gi, "[location]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
    .replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi, "[identifier]")
    .replace(
      /(?:bearer|authorization|cookie|set-cookie|token|secret|password|session|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
      "[redacted]",
    )
    .replace(/[A-Za-z0-9_-]{32,}/g, "[opaque]")
    .slice(0, max);
function fallbackId() {
  return `rs-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.slice(
    0,
    35,
  );
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
      errorName: scrub(error.name || "Error", 100),
      message: scrub(error.message || "Unexpected error", 500),
      stack: error.stack
        ? scrub(error.stack.split("\n").slice(0, 20).join("\n"), 2_000)
        : undefined,
      digest:
        typeof (error as Error & { digest?: unknown }).digest === "string"
          ? scrub((error as Error & { digest: string }).digest, 100)
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
  options: { miningActive?: boolean } = {},
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
      clientReleaseId:
        scrub(process.env.NEXT_PUBLIC_RUNESPACE_RELEASE_ID || "", 100) ||
        undefined,
      source,
      ...errorDetails(error),
      route,
      online: globalThis.navigator?.onLine ?? false,
      platform: scrub(globalThis.navigator?.userAgent ?? "", 120) || undefined,
      miningActive: options.miningActive,
    });
    if (!parsed.success) return id;
    const body = JSON.stringify(parsed.data);
    if (new TextEncoder().encode(body).byteLength > DIAGNOSTIC_MAX_BYTES)
      return id;
    const beacon = globalThis.navigator?.sendBeacon;
    if (
      !beacon?.(
        "/api/diagnostics",
        new Blob([body], { type: "application/json" }),
      )
    )
      void globalThis
        .fetch?.("/api/diagnostics", {
          method: "POST",
          body,
          headers: { "content-type": "application/json" },
          keepalive: true,
        })
        .catch(() => undefined);
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
      reportClientDiagnostic(
        "window-error",
        event.error ?? new Error(event.message),
      ),
    );
    window.addEventListener("unhandledrejection", (event) =>
      reportClientDiagnostic("unhandled-rejection", event.reason),
    );
  } catch {
    /* startup remains safe */
  }
}
