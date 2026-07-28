import type { BetterAuthOptions } from "better-auth";
import { env } from "../server/env";

/**
 * Shared Better Auth options. Kept free of the database adapter so it can be
 * composed by both the generation config (relative imports, no DB) and the
 * runtime config (`@/` aliases + Drizzle schema). One place owns the
 * email/password policy and host boundary.
 *
 * Uses Better Auth's dynamic baseURL with an explicit allowed-hosts boundary.
 * Relying on request-derived origins or a single static URL is neither safe nor
 * workable across production + PR previews.
 */
export const authOptions: BetterAuthOptions = {
  baseURL: {
    allowedHosts: [
      "runespace.qcfailed.com",
      "pr-*.runespace.qcfailed.com",
      "localhost:*",
      "127.0.0.1:*",
    ],
    protocol: "auto",
    // No fallback: unknown hosts must fail closed.
  },
  secret: env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    // Issue scope: email/password only. No email verification, reset, or
    // social login in this issue (see Non-goals).
    requireEmailVerification: false,
    minPasswordLength: 8,
  },
  // Canonical E2E runs the production server over plain HTTP. Better Auth's
  // default `protocol: "auto"` + production NODE_ENV sets Secure cookies that
  // Chromium discards. This env-controlled override allows the canonical runner
  // to disable Secure cookies EXCLUSIVELY for the E2E browser session, never for
  // preview or production deployments.
  advanced: {
    useSecureCookies: process.env.RUNESPACE_E2E_CANONICAL_HTTP === "true" ? false : undefined,
  },
};
