import type { BetterAuthOptions } from "better-auth";
import { env } from "../server/env";

/**
 * Shared Better Auth options. Kept free of the database adapter so it can be
 * composed by both the generation config (relative imports, no DB) and the
 * runtime config (`@/` aliases + Drizzle schema). One place owns the
 * email/password policy and base URL.
 *
 * Cookie `secure`/attributes are handled automatically by Better Auth based on
 * the incoming request protocol, so no manual cookie config is needed here.
 */
export const authOptions: BetterAuthOptions = {
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    // Issue scope: email/password only. No email verification, reset, or
    // social login in this issue (see Non-goals).
    requireEmailVerification: false,
    minPasswordLength: 8,
  },
};
