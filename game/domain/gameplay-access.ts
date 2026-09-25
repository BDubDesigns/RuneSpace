/**
 * The one authoritative gameplay-access rule (issue #223).
 *
 * ```
 * canEnterGameplay = emailVerified && (publicGameplayOpen || earlyAccessGranted)
 * ```
 *
 * Every server boundary that decides whether a request may read or mutate
 * in-world character state calls this function with authoritative inputs loaded
 * fresh for that request (`server/gameplay-access.ts`). No page, action, or
 * component re-implements the rule, and the browser never decides access.
 *
 * Deliberately absent inputs:
 * - no clock: reaching the Soft Alpha launch target never grants access;
 * - no admin/operator flag: allowlist membership does not bypass the gate — an
 *   operator's own account plays early only with an explicit Early Access grant.
 */

export type GameplayAccessInput = {
  emailVerified: boolean;
  earlyAccessGranted: boolean;
  publicGameplayOpen: boolean;
};

export type GameplayAccessDecision =
  | { allowed: true; via: "public" | "early_access" }
  | { allowed: false; reason: "email_unverified" | "gameplay_closed" };

export function decideGameplayAccess(input: GameplayAccessInput): GameplayAccessDecision {
  if (!input.emailVerified) return { allowed: false, reason: "email_unverified" };
  if (input.publicGameplayOpen) return { allowed: true, via: "public" };
  if (input.earlyAccessGranted) return { allowed: true, via: "early_access" };
  return { allowed: false, reason: "gameplay_closed" };
}

/**
 * Stable machine code for a gameplay-access refusal, shared by the server
 * boundary and the browser's stale-page recovery (the browser only uses it to
 * navigate back to Characters; it never decides access).
 */
export const GAMEPLAY_ACCESS_REQUIRED_CODE = "GAMEPLAY_ACCESS_REQUIRED";
