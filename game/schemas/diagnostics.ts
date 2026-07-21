import { z } from "zod";

export const DIAGNOSTIC_MAX_BYTES = 8_192;

const safeText = z.string().trim().min(1).max(500);
const releaseId = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/);

const authorizationHeader = /\b(proxy-authorization|authorization)\s*(?::|=)\s*.*/gi;
const cookieHeader = /\b(set-cookie|cookie)\s*(?::|=)\s*.*/gi;
const sensitiveHeader = /\b(?:proxy-authorization|authorization|set-cookie|cookie)\s*(?::|=)/i;
const bearerValue = /\bbearer\s+[^\s,;]+/gi;
const sensitiveValue =
  /\b(?:token|credential|auth|session(?:[ _-]?id)?|(?:access|refresh)(?:[ _-]?token)|api(?:[ _-]?key)|password|secret|character(?:[ _-]?id)?|player(?:[ _-]?id)?)\s*(?:=>|:|=|\bis\b)\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;

function sanitizeDiagnosticLine(line: string) {
  // JSON-like fragments can embed complete player state; do not try to preserve them.
  if (/[{[]/.test(line) && /(?:["']?[\w-]+["']?\s*:|\[\s*[{"'])/.test(line)) {
    return "[redacted structured data]";
  }
  return line
    .replace(authorizationHeader, "$1: [redacted]")
    .replace(cookieHeader, "$1: [redacted]")
    .replace(bearerValue, "[redacted]")
    .replace(sensitiveValue, "[redacted]");
}

function sanitizeDiagnosticLines(lines: string[]) {
  let redactContinuation = false;
  return lines.map((line) => {
    if (redactContinuation && /^\s/.test(line)) return "[redacted]";
    redactContinuation = sensitiveHeader.test(line);
    return sanitizeDiagnosticLine(line);
  });
}

/** Remove values that must never enter a diagnostic record, even from an untrusted client. */
export function sanitizeDiagnosticText(value: unknown, max: number, maxLines = 1) {
  if (typeof value !== "string") return undefined;
  const lines = sanitizeDiagnosticLines(value.split(/\r?\n/).slice(0, maxLines));
  return (
    lines
      .join("\n")
      .replace(/(?:https?:\/\/|file:|webpack:|blob:|data:|javascript:)[^\s"')]+/gi, "[location]")
      .replace(/(?<![\w.-])\/(?:[^\s"')]|\/(?!\s))+/g, "[location]")
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
      .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, "[identifier]")
      .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[opaque]")
      .split(/\r?\n/)
      .map((line) => line.slice(0, Math.max(1, Math.floor(max / maxLines))))
      .join("\n")
      .slice(0, max)
      .trim() || undefined
  );
}

export function sanitizeReleaseId(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return releaseId.safeParse(trimmed).success ? trimmed : undefined;
}

/** The deliberately small, privacy-reviewed browser-to-server diagnostic contract. */
export const clientDiagnosticSchema = z
  .object({
    timestamp: z.string().datetime(),
    incidentId: z.string().regex(/^rs-[a-z0-9]{8,32}$/),
    clientReleaseId: releaseId.optional(),
    source: z.enum(["window-error", "unhandled-rejection", "play-boundary", "mining-command"]),
    errorName: safeText,
    message: safeText,
    stack: z.string().max(2_000).optional(),
    digest: z.string().max(100).optional(),
    route: z.enum(["/play/[characterId]", "/characters", "/other"]),
    online: z.boolean(),
    platform: z.string().max(120).optional(),
    miningActive: z.boolean().optional(),
  })
  .strict();

export type ClientDiagnostic = z.infer<typeof clientDiagnosticSchema>;

export function sanitizeClientDiagnostic(diagnostic: ClientDiagnostic): ClientDiagnostic {
  return {
    ...diagnostic,
    clientReleaseId: sanitizeReleaseId(diagnostic.clientReleaseId),
    errorName: sanitizeDiagnosticText(diagnostic.errorName, 100) || "Error",
    message: sanitizeDiagnosticText(diagnostic.message, 500) || "Unexpected error",
    stack: diagnostic.stack && sanitizeDiagnosticText(diagnostic.stack, 2_000, 20),
    digest: diagnostic.digest && sanitizeDiagnosticText(diagnostic.digest, 100),
    platform: diagnostic.platform && sanitizeDiagnosticText(diagnostic.platform, 120),
  };
}
