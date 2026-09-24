/**
 * Signup and verification-mail abuse limits (issue #221) as pure decisions
 * over prior event timestamps. `server/account-abuse.ts` loads the events from
 * the `account_abuse_events` ledger under a lock and asks these functions.
 *
 * The locked numbers come from the issue; the progressive signup tiers are the
 * implementation of "progressive throttling rather than permanent bans": they
 * decay on their own as attempts age out of the 24-hour lookback.
 */

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export const ACCOUNT_ABUSE_LIMITS = {
  /** Signup: 5 admitted attempts per window per IP; the window widens with sustained volume. */
  signup: {
    maxAttemptsPerWindow: 5,
    lookbackMs: 24 * HOUR,
    tiers: [
      { minAttemptsInLookback: 0, windowMs: 15 * MINUTE },
      { minAttemptsInLookback: 10, windowMs: HOUR },
      { minAttemptsInLookback: 20, windowMs: 6 * HOUR },
    ],
  },
  /** Explicit resend: one per 60 s and five per 24 h per email address. */
  resend: { cooldownMs: 60 * SECOND, dailyMax: 5, dailyWindowMs: 24 * HOUR },
  /** Verification emails dispatched from one IP: 20 per hour. */
  ipDispatch: { max: 20, windowMs: HOUR },
  /** Abnormal global velocity: at 100 verification emails in 10 minutes, dispatch stops. */
  dispatchCircuit: { max: 100, windowMs: 10 * MINUTE },
  /** Rows older than this can no longer affect any decision. */
  retentionMs: 25 * HOUR,
} as const;

export type AbuseDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

const allow: AbuseDecision = { allowed: true };

function deny(retryAtMs: number, now: Date): AbuseDecision {
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((retryAtMs - now.getTime()) / SECOND)),
  };
}

function within(events: readonly Date[], windowMs: number, now: Date): number[] {
  const since = now.getTime() - windowMs;
  return events
    .map((event) => event.getTime())
    .filter((time) => time > since && time <= now.getTime())
    .sort((left, right) => left - right);
}

/**
 * At most `max` events inside the trailing window. When full, the caller may
 * retry once the oldest counted event leaves the window.
 */
export function decideWindowCap(
  events: readonly Date[],
  max: number,
  windowMs: number,
  now: Date,
): AbuseDecision {
  const inWindow = within(events, windowMs, now);
  if (inWindow.length < max) return allow;
  return deny(inWindow[inWindow.length - max]! + windowMs, now);
}

/** The signup window currently in force for an IP, given its 24-hour attempt volume. */
export function signupWindowMs(priorAttempts: readonly Date[], now: Date): number {
  const { lookbackMs, tiers } = ACCOUNT_ABUSE_LIMITS.signup;
  const volume = within(priorAttempts, lookbackMs, now).length;
  let windowMs: number = tiers[0].windowMs;
  for (const tier of tiers) {
    if (volume >= tier.minAttemptsInLookback) windowMs = tier.windowMs;
  }
  return windowMs;
}

export function decideSignupAttempt(priorAttempts: readonly Date[], now: Date): AbuseDecision {
  return decideWindowCap(
    priorAttempts,
    ACCOUNT_ABUSE_LIMITS.signup.maxAttemptsPerWindow,
    signupWindowMs(priorAttempts, now),
    now,
  );
}

export function decideVerificationResend(priorResends: readonly Date[], now: Date): AbuseDecision {
  const { cooldownMs, dailyMax, dailyWindowMs } = ACCOUNT_ABUSE_LIMITS.resend;
  const cooldown = decideWindowCap(priorResends, 1, cooldownMs, now);
  const daily = decideWindowCap(priorResends, dailyMax, dailyWindowMs, now);
  if (cooldown.allowed && daily.allowed) return allow;
  return {
    allowed: false,
    retryAfterSeconds: Math.max(
      cooldown.allowed ? 0 : cooldown.retryAfterSeconds,
      daily.allowed ? 0 : daily.retryAfterSeconds,
    ),
  };
}

export function decideIpDispatch(priorDispatches: readonly Date[], now: Date): AbuseDecision {
  const { max, windowMs } = ACCOUNT_ABUSE_LIMITS.ipDispatch;
  return decideWindowCap(priorDispatches, max, windowMs, now);
}

export function decideDispatchCircuit(recentDispatches: readonly Date[], now: Date): AbuseDecision {
  const { max, windowMs } = ACCOUNT_ABUSE_LIMITS.dispatchCircuit;
  return decideWindowCap(recentDispatches, max, windowMs, now);
}
