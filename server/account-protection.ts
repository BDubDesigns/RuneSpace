import { env } from "@/server/env";
import { isLocalE2eRuntime, loopbackUrl } from "@/server/local-e2e";
import { resolveMailTransport } from "@/server/transactional-mail";

/**
 * Cloudflare Turnstile configuration and registration availability (issue
 * #221). Turnstile protects the public auth endpoints that create accounts or
 * send verification mail; Better Auth's official Captcha plugin verifies the
 * token server-side (`server/auth.ts`).
 *
 * - Configured keys are always used. Inside the local-E2E gate the runner may
 *   point site verification at its loopback stub; the keys it supplies are
 *   test-only values.
 * - Development and Vitest fall back to Cloudflare's published always-pass
 *   test keys so local sign-up works without a Cloudflare account.
 * - Anything else without keys (an unconfigured production deploy) has no
 *   Turnstile configuration; registration then reports unavailable and the
 *   Captcha plugin itself fails closed.
 */

/** Cloudflare's documented always-pass testing keys (public by design). */
const CLOUDFLARE_TEST_SITE_KEY = "1x00000000000000000000AA";
const CLOUDFLARE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

/** The public auth paths Turnstile guards. */
export const TURNSTILE_PROTECTED_PATHS = ["/sign-up/email", "/send-verification-email"];

export type TurnstileConfig = {
  siteKey: string;
  secretKey: string;
  siteVerifyURLOverride?: string;
};

export function resolveTurnstileConfig(): TurnstileConfig | null {
  if (env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY) {
    const override = isLocalE2eRuntime()
      ? loopbackUrl(process.env.RUNESPACE_E2E_TURNSTILE_SITEVERIFY_URL)
      : undefined;
    return {
      siteKey: env.TURNSTILE_SITE_KEY,
      secretKey: env.TURNSTILE_SECRET_KEY,
      ...(override ? { siteVerifyURLOverride: override } : {}),
    };
  }
  if (env.NODE_ENV === "development" || env.NODE_ENV === "test") {
    return { siteKey: CLOUDFLARE_TEST_SITE_KEY, secretKey: CLOUDFLARE_TEST_SECRET_KEY };
  }
  return null;
}

/**
 * The public Turnstile site key for the registration surfaces, or null when
 * registration cannot currently be protected and delivered.
 */
export function publicRegistrationSiteKey(): string | null {
  return isAccountRegistrationAvailable() ? (resolveTurnstileConfig()?.siteKey ?? null) : null;
}

/**
 * Registration needs both abuse protection and a way to deliver the
 * verification email; without either it is closed rather than degraded.
 */
export function isAccountRegistrationAvailable(): boolean {
  return resolveTurnstileConfig() !== null && resolveMailTransport() !== null;
}
