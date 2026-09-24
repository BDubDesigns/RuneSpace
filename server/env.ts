import { z } from "zod";

/**
 * Single source of truth for server-side environment configuration.
 *
 * Env parsing happens once at module load. Invalid configuration fails fast
 * instead of producing confusing runtime errors deep inside the app.
 *
 * This module intentionally validates ONLY deployment/infrastructure config.
 * Game content and request boundary validation belongs in `game/schemas/`.
 *
 * NOTE: BETTER_AUTH_URL is no longer required. Better Auth host/origin
 * resolution is configured explicitly via the dynamic baseURL object in
 * server/auth-options.ts.
 */

const nodeEnvSchema = z.enum(["development", "test", "production"]);

const isProductionEnv = () => process.env.NODE_ENV === "production";

// In production the secret is required (min 16 chars). In other environments
// we fall back to an obviously-insecure placeholder so local runs "just work";
// it is never used in production and CI supplies a build-only placeholder for
// `next build`.
const betterAuthSecretField = isProductionEnv()
  ? z.string().min(16, "BETTER_AUTH_SECRET of at least 16 chars is required in production")
  : z.string().min(1).default("dev-only-insecure-secret-change-me-0000000000");

const envSchema = z.object({
  NODE_ENV: nodeEnvSchema.default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  // Better Auth owns credential and session security. The secret signs session
  // tokens and MUST come from the environment. The host/origin boundary is
  // configured explicitly via the dynamic baseURL object in auth-options.ts.
  BETTER_AUTH_SECRET: betterAuthSecretField,
  /**
   * Server-only allowlist of stable Better Auth user IDs that may act as admin
   * operators. Comma-separated, whitespace-trimmed. Absent/empty means NO
   * admins (fail closed). Never expose real production IDs in public/docs.
   */
  RUNESPACE_ADMIN_USER_IDS: z
    .string()
    .optional()
    .transform((value) =>
      (value ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  /**
   * Cloudflare Turnstile protecting sign-up and verification resend (issue
   * #221). The site key is public and rendered into the registration page; the
   * secret key is server-only. Both are optional to parse so builds and tests
   * need no placeholders; `server/account-protection.ts` decides what an
   * absent pair means per environment and fails closed in production.
   */
  TURNSTILE_SITE_KEY: optionalNonEmpty(),
  TURNSTILE_SECRET_KEY: optionalNonEmpty(),
  /**
   * Zoho ZeptoMail — transactional account email only (issue #221). The Send
   * Mail token is server-only. `ZEPTOMAIL_API_URL` selects the account's data
   * center (for example `https://api.zeptomail.eu/v1.1/email`).
   */
  ZEPTOMAIL_SEND_MAIL_TOKEN: optionalNonEmpty(),
  ZEPTOMAIL_API_URL: z.string().url().default("https://api.zeptomail.com/v1.1/email"),
  RUNESPACE_MAIL_FROM_ADDRESS: optionalNonEmpty().pipe(z.string().email().optional()),
  RUNESPACE_MAIL_FROM_NAME: z.string().trim().min(1).default("RuneSpace"),
});

/** An optional string where an empty or whitespace-only value means "unset". */
function optionalNonEmpty() {
  return z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    });
}

export type AppEnv = z.infer<typeof envSchema>;

function parseEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env: AppEnv = parseEnv();

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";

/**
 * The server-only admin allowlist. Referenced by `server/admin-auth.ts`. An
 * empty allowlist fails closed (no admins).
 */
export const adminUserIdAllowlist: readonly string[] = env.RUNESPACE_ADMIN_USER_IDS;

if (!isProduction && !process.env.BETTER_AUTH_SECRET) {
  console.warn(
    "[env] BETTER_AUTH_SECRET not set — using an insecure development placeholder. " +
      "Set a real secret for any non-local environment.",
  );
}
