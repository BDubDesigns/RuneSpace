import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { captcha } from "better-auth/plugins";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { reserveVerificationDispatch } from "@/server/account-abuse";
import { verificationEmail } from "@/server/account-email";
import { ACCOUNT_ERROR_CODES, accountGuards, ipBucketFor } from "@/server/account-guards";
import { TURNSTILE_PROTECTED_PATHS, resolveTurnstileConfig } from "@/server/account-protection";
import { authOptions } from "@/server/auth-options";
import { sendTransactionalMail } from "@/server/transactional-mail";

/**
 * Better Auth — the single source of truth for authentication identity and
 * sessions (user, session, account/provider, verification records).
 *
 * Per the issue and `docs/architecture.md`:
 * - Email/password authentication is enabled; email verification is required
 *   before sign-in (issue #221).
 * - The official Drizzle adapter backs persistence (provider "pg").
 * - Better Auth owns credential and session security; we never duplicate
 *   password or session tables elsewhere.
 * - RuneSpace ownership (player_accounts, characters) lives in separate domain
 *   tables and is resolved by `server/ownership.ts`, never by the auth tables.
 *
 * The schema tables are imported from the generated `db/auth-schema.ts` so the
 * adapter and Drizzle migrations share one definition. Schema-shaping options
 * (including the Username plugin) live in `server/auth-options.ts`; this file
 * adds the runtime-only behavior: verification mail, Turnstile, and the
 * account guards. See `docs/authentication.md`.
 */

const turnstile = resolveTurnstileConfig();

function isExplicitResend(request: Request | undefined): boolean {
  return request ? new URL(request.url).pathname.endsWith("/send-verification-email") : false;
}

export const auth = betterAuth({
  ...authOptions,
  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: false,
    schema: {
      user: authSchema.user,
      session: authSchema.session,
      account: authSchema.account,
      verification: authSchema.verification,
    },
  }),
  emailVerification: {
    // Sign-up sends the first link; after that only the explicit, rate-limited
    // resend does. A failed or unverified sign-in never sends mail.
    sendOnSignUp: true,
    sendOnSignIn: false,
    autoSignInAfterVerification: true,
    async sendVerificationEmail({ user, url }, request) {
      const resend = isExplicitResend(request);
      const dispatch = await reserveVerificationDispatch(
        user.email.toLowerCase(),
        ipBucketFor(request, authOptions),
      );
      if (!dispatch.admitted) {
        // Abnormal global send velocity: stop dispatching and surface it.
        console.error(
          "[account-verification] ALERT: verification dispatch circuit is open; email not sent",
        );
        if (resend) {
          throw new APIError("SERVICE_UNAVAILABLE", {
            code: ACCOUNT_ERROR_CODES.verificationMailPaused,
            message: "Verification email is temporarily paused. Please try again later.",
          });
        }
        return;
      }
      const displayUsername = (user as { displayUsername?: string | null }).displayUsername;
      try {
        await sendTransactionalMail(
          verificationEmail({ to: user.email, playerName: displayUsername, url }),
        );
      } catch (error) {
        console.error(
          `[account-verification] verification email failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        // Sign-up still succeeds — the account exists and the player can use
        // the explicit resend. A failed explicit resend is reported to them.
        if (resend) {
          throw new APIError("SERVICE_UNAVAILABLE", {
            message: "We couldn't send the verification email. Please try again shortly.",
          });
        }
      }
    },
  },
  hooks: { before: accountGuards },
  plugins: [
    ...authOptions.plugins,
    captcha({
      provider: "cloudflare-turnstile",
      endpoints: TURNSTILE_PROTECTED_PATHS,
      // An empty secret makes the plugin fail closed (500) on protected paths.
      secretKey: turnstile?.secretKey ?? "",
      ...(turnstile?.siteVerifyURLOverride
        ? { siteVerifyURLOverride: turnstile.siteVerifyURLOverride }
        : {}),
    }),
  ],
});
