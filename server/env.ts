import { z } from "zod";

/**
 * Single source of truth for server-side environment configuration.
 *
 * Env parsing happens once at module load. Invalid configuration fails fast
 * instead of producing confusing runtime errors deep inside the app.
 *
 * This module intentionally validates ONLY deployment/infrastructure config.
 * Game content and request boundary validation belongs in `game/schemas/`.
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
  // tokens; the base URL is used for callback/cookie origins. Both MUST come
  // from the environment and never be hardcoded. BETTER_AUTH_URL is optional —
  // Better Auth derives the origin from the request when it is unset.
  BETTER_AUTH_SECRET: betterAuthSecretField,
  BETTER_AUTH_URL: z.string().url().optional(),
});

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

if (!isProduction && !process.env.BETTER_AUTH_SECRET) {
  console.warn(
    "[env] BETTER_AUTH_SECRET not set — using an insecure development placeholder. " +
      "Set a real secret for any non-local environment.",
  );
}
