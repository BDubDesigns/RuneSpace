"use client";

import { DIAGNOSTIC_MAX_BYTES, clientDiagnosticSchema, type ClientDiagnostic } from "@/game/schemas/diagnostics";

declare global { interface Window { __runespaceDiagnosticsInstalled?: boolean } }

const incidents = new WeakMap<object, string>();
function fallbackId() { return `rs-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.slice(0, 35); }
function incidentId() { try { return `rs-${globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 16) ?? fallbackId().slice(3)}`; } catch { return fallbackId(); } }
function clean(value: string, max: number) { return value.replace(/https?:\/\/\S+/gi, "[url]").replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]").replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi, "[identifier]").slice(0, max); }
function details(error: unknown) { if (error instanceof Error) return { errorName: clean(error.name || "Error", 100), message: clean(error.message || "Unexpected error", 500), stack: error.stack ? clean(error.stack, 2_000) : undefined, digest: typeof (error as Error & { digest?: unknown }).digest === "string" ? clean((error as Error & { digest: string }).digest, 100) : undefined }; return { errorName: "NonErrorThrown", message: "Unexpected non-error value was thrown" }; }

export function reportClientDiagnostic(source: ClientDiagnostic["source"], error: unknown, options: { miningActive?: boolean } = {}) {
  let id: string;
  try {
    if (error && typeof error === "object" && incidents.has(error)) return incidents.get(error)!;
    id = incidentId();
    if (error && typeof error === "object") incidents.set(error, id);
    const pathname = globalThis.location?.pathname ?? "/other";
    const route: ClientDiagnostic["route"] = /^\/play\/[^/]+/.test(pathname) ? "/play/[characterId]" : pathname === "/characters" ? "/characters" : "/other";
    const payload = clientDiagnosticSchema.parse({ timestamp: new Date().toISOString(), incidentId: id, clientReleaseId: process.env.NEXT_PUBLIC_RUNESPACE_RELEASE_ID || undefined, source, ...details(error), route, online: globalThis.navigator?.onLine ?? false, platform: globalThis.navigator?.userAgent?.slice(0, 120), miningActive: options.miningActive });
    const body = JSON.stringify(payload);
    if (new TextEncoder().encode(body).byteLength > DIAGNOSTIC_MAX_BYTES) return id;
    const beacon = globalThis.navigator?.sendBeacon;
    if (!beacon?.("/api/diagnostics", new Blob([body], { type: "application/json" }))) void globalThis.fetch?.("/api/diagnostics", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => undefined);
  } catch { /* Diagnostics must never destabilize the game. */ }
  return id ?? fallbackId();
}

export function installClientDiagnostics() {
  try {
    if (window.__runespaceDiagnosticsInstalled) return;
    window.__runespaceDiagnosticsInstalled = true;
    window.addEventListener("error", (event) => reportClientDiagnostic("window-error", event.error ?? new Error(event.message)));
    window.addEventListener("unhandledrejection", (event) => reportClientDiagnostic("unhandled-rejection", event.reason));
  } catch { /* unavailable browser APIs must not break startup */ }
}
