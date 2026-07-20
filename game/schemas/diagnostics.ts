import { z } from "zod";

export const DIAGNOSTIC_MAX_BYTES = 8_192;

const safeText = z.string().trim().min(1).max(500);
const releaseId = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/);

const sensitiveValue =
  /(?:bearer\s+|authorization\s*[:=]\s*(?:bearer\s+)?|cookie\s*[:=]|set-cookie\s*[:=]|session(?:[_-]?id)?\s*[:=]|(?:access|refresh)[_-]?token\s*[:=]|api[_-]?key\s*[:=]|password\s*[:=]|secret\s*[:=])[^\s,;]+/gi;

/** Remove values that must never enter a diagnostic record, even from an untrusted client. */
export function sanitizeDiagnosticText(value: unknown, max: number, maxLines = 1) {
  if (typeof value !== "string") return undefined;
  return (
    value
      .replace(/(?:https?:\/\/|file:|webpack:|blob:|data:|javascript:)[^\s"')]+/gi, "[location]")
      .replace(/(?<![\w.-])\/(?:[^\s"')]|\/(?!\s))+/g, "[location]")
      .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
      .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi, "[identifier]")
      .replace(sensitiveValue, "[redacted]")
      .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[opaque]")
      .split(/\r?\n/)
      .slice(0, maxLines)
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
