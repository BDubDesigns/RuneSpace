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

const envSchema = z.object({
  NODE_ENV: nodeEnvSchema.default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  // Better Auth owns credential and session security. The secret signs session
  // tokens; the base URL is used for callback/cookie origins. Both MUST come
  // from the environment and never be hardcoded.
  BETTER_AUTH_SECRET: z.string().min(1, "BETTER_AUTH_SECRET is required"),
  BETTER_AUTH_URL: z.string().min(1, "BETTER_AUTH_URL is required"),
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
