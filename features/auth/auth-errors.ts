/**
 * Player-facing copy for Better Auth error responses on the account screens
 * (issue #221). The server stays authoritative; this only chooses wording for
 * codes whose default message names internal concepts (e.g. "Username").
 */

export type AuthClientError = {
  code?: string;
  message?: string;
  status?: number;
  retryAfterSeconds?: number;
};

const COPY: Readonly<Record<string, string>> = {
  USERNAME_IS_ALREADY_TAKEN: "That Player name is already taken. Please choose another.",
  INVALID_USERNAME: "That Player name isn't allowed. Please choose another.",
  INVALID_DISPLAY_USERNAME: "That Player name isn't allowed. Please choose another.",
  USERNAME_TOO_SHORT: "That Player name is too short.",
  USERNAME_TOO_LONG: "That Player name is too long.",
  MISSING_RESPONSE: "Please complete the security check.",
  VERIFICATION_FAILED: "The security check didn't pass. Please try again.",
  UNKNOWN_ERROR: "The security check is unavailable right now. Please try again shortly.",
  INVALID_EMAIL_OR_PASSWORD: "That email and password don't match an account.",
};

export function authErrorMessage(error: AuthClientError, fallback: string): string {
  return (error.code && COPY[error.code]) || error.message || fallback;
}

/** Seconds as `m:ss`, e.g. `0:45` or `1:00`. */
export function formatCooldown(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
