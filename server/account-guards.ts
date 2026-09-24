import { APIError, createAuthMiddleware, getIp } from "better-auth/api";
import type { BetterAuthOptions } from "better-auth";
import { validatePlayerName } from "@/game/domain/player-name";
import {
  UNKNOWN_IP_BUCKET,
  admitSignupAttempt,
  admitVerificationResend,
  type AbuseAdmission,
} from "@/server/account-abuse";
import { isAccountRegistrationAvailable } from "@/server/account-protection";

/**
 * RuneSpace's account guards (issue #221), installed as Better Auth's
 * user-level `hooks.before`, which runs before every plugin hook:
 *
 * - `/sign-up/email` — registration must be available (Turnstile + mail
 *   configured); a valid Player name is required and becomes the one
 *   canonical value for `username`, `displayUsername`, and `name`, so a crafted
 *   request cannot pair a harmless key with an impersonating display form;
 *   then the per-IP signup limits admit or refuse the attempt.
 * - `/send-verification-email` — the per-address resend limits and the per-IP
 *   mail cap.
 * - `/update-user` — Player names are immutable for ordinary users during
 *   alpha. The Username plugin in Better Auth 1.6.23 has no immutability
 *   option, so this is the server-side enforcement.
 *
 * Turnstile itself is verified earlier, in the Captcha plugin's request
 * handler, so these guards only count requests that passed the challenge.
 */

export const ACCOUNT_ERROR_CODES = {
  registrationUnavailable: "REGISTRATION_UNAVAILABLE",
  invalidPlayerName: "INVALID_PLAYER_NAME",
  playerNameImmutable: "PLAYER_NAME_IMMUTABLE",
  signupThrottled: "SIGNUP_THROTTLED",
  resendThrottled: "VERIFICATION_RESEND_THROTTLED",
  verificationMailPaused: "VERIFICATION_MAIL_PAUSED",
} as const;

/** The normalized client IP Better Auth resolves, or the shared unknown bucket. */
export function ipBucketFor(
  source: Request | Headers | undefined,
  options: BetterAuthOptions,
): string {
  if (!source) return UNKNOWN_IP_BUCKET;
  return getIp(source, options) ?? UNKNOWN_IP_BUCKET;
}

function refusalError(admission: Extract<AbuseAdmission, { admitted: false }>): APIError {
  const headers = { "Retry-After": String(admission.retryAfterSeconds) };
  const retryAfterSeconds = admission.retryAfterSeconds;
  switch (admission.reason) {
    case "verification-mail-paused":
      return new APIError(
        "SERVICE_UNAVAILABLE",
        {
          code: ACCOUNT_ERROR_CODES.verificationMailPaused,
          message: "Verification email is temporarily paused. Please try again later.",
          retryAfterSeconds,
        },
        headers,
      );
    case "resend-throttled":
      return new APIError(
        "TOO_MANY_REQUESTS",
        {
          code: ACCOUNT_ERROR_CODES.resendThrottled,
          message: "Please wait before requesting another verification email.",
          retryAfterSeconds,
        },
        headers,
      );
    case "ip-mail-cap":
    case "signup-throttled":
      return new APIError(
        "TOO_MANY_REQUESTS",
        {
          code: ACCOUNT_ERROR_CODES.signupThrottled,
          message: "Too many attempts from this network. Please try again later.",
          retryAfterSeconds,
        },
        headers,
      );
  }
}

export const accountGuards = createAuthMiddleware(async (ctx) => {
  if (ctx.path === "/sign-up/email") {
    if (!isAccountRegistrationAvailable()) {
      throw new APIError("SERVICE_UNAVAILABLE", {
        code: ACCOUNT_ERROR_CODES.registrationUnavailable,
        message: "Account registration is temporarily unavailable.",
      });
    }
    const body = ctx.body as Record<string, unknown>;
    const submitted = body.displayUsername ?? body.username;
    const validation = validatePlayerName(typeof submitted === "string" ? submitted : "");
    if (!validation.ok) {
      throw new APIError("BAD_REQUEST", {
        code: ACCOUNT_ERROR_CODES.invalidPlayerName,
        message: validation.error,
      });
    }
    body.username = validation.display;
    body.displayUsername = validation.display;
    body.name = validation.display;

    const admission = await admitSignupAttempt(
      ipBucketFor(ctx.request ?? ctx.headers, ctx.context.options),
    );
    if (!admission.admitted) throw refusalError(admission);
    return;
  }

  if (ctx.path === "/send-verification-email") {
    const email = (ctx.body as Record<string, unknown>).email;
    // A malformed body is rejected by the endpoint's own validation.
    if (typeof email !== "string") return;
    const admission = await admitVerificationResend(
      email.trim().toLowerCase(),
      ipBucketFor(ctx.request ?? ctx.headers, ctx.context.options),
    );
    if (!admission.admitted) throw refusalError(admission);
    return;
  }

  if (ctx.path === "/update-user") {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    if ("username" in body || "displayUsername" in body) {
      throw new APIError("FORBIDDEN", {
        code: ACCOUNT_ERROR_CODES.playerNameImmutable,
        message: "Player names can't be changed during alpha.",
      });
    }
  }
});
