import { z } from "zod";

export const DIAGNOSTIC_MAX_BYTES = 8_192;

const safeText = z.string().trim().min(1).max(500);

/** The deliberately small, privacy-reviewed browser-to-server diagnostic contract. */
export const clientDiagnosticSchema = z
  .object({
    timestamp: z.string().datetime(),
    incidentId: z.string().regex(/^rs-[a-z0-9]{8,32}$/),
    clientReleaseId: z.string().max(100).optional(),
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
