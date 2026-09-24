import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { accountAbuseEvents } from "@/db/rune-space";
import {
  ACCOUNT_ABUSE_LIMITS,
  type AbuseDecision,
  decideDispatchCircuit,
  decideIpDispatch,
  decideSignupAttempt,
  decideVerificationResend,
} from "@/server/account-abuse-policy";

/**
 * PostgreSQL-backed signup / verification-mail abuse ledger (issue #221).
 *
 * Every admission runs in one transaction behind a single transaction-scoped
 * advisory lock, so concurrent requests cannot both pass a cap that only one
 * of them fits under. Signup and resend volume is tiny, so one global lock
 * costs nothing measurable and needs no Redis, queue, or distributed limiter.
 * Pure limit decisions live in `server/account-abuse-policy.ts`.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type EventKind = "signup_attempt" | "verification_resend" | "verification_dispatch";

/** Arbitrary constant naming this ledger's advisory lock. */
const ACCOUNT_ABUSE_LOCK_KEY = 221_0001;

/** The IP bucket for a request whose client address cannot be resolved. */
export const UNKNOWN_IP_BUCKET = "unknown";

export type AbuseRefusal =
  | "signup-throttled"
  | "resend-throttled"
  | "ip-mail-cap"
  | "verification-mail-paused";

export type AbuseAdmission =
  | { admitted: true }
  | { admitted: false; reason: AbuseRefusal; retryAfterSeconds: number };

function refuse(reason: AbuseRefusal, decision: AbuseDecision): AbuseAdmission | null {
  return decision.allowed
    ? null
    : { admitted: false, reason, retryAfterSeconds: decision.retryAfterSeconds };
}

async function eventTimes(
  tx: Tx,
  kind: EventKind,
  windowMs: number,
  now: Date,
  filter?: { ipBucket?: string; emailKey?: string },
): Promise<Date[]> {
  const conditions = [
    eq(accountAbuseEvents.kind, kind),
    gt(accountAbuseEvents.createdAt, new Date(now.getTime() - windowMs)),
  ];
  if (filter?.ipBucket !== undefined) {
    conditions.push(eq(accountAbuseEvents.ipBucket, filter.ipBucket));
  }
  if (filter?.emailKey !== undefined) {
    conditions.push(eq(accountAbuseEvents.emailKey, filter.emailKey));
  }
  const rows = await tx
    .select({ createdAt: accountAbuseEvents.createdAt })
    .from(accountAbuseEvents)
    .where(and(...conditions));
  return rows.map((row) => row.createdAt);
}

async function withLedgerLock<T>(now: Date, work: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${ACCOUNT_ABUSE_LOCK_KEY})`);
    await tx
      .delete(accountAbuseEvents)
      .where(
        lt(
          accountAbuseEvents.createdAt,
          new Date(now.getTime() - ACCOUNT_ABUSE_LIMITS.retentionMs),
        ),
      );
    return work(tx);
  });
}

/** Refusals shared by every path that would lead to a verification email. */
async function mailRefusal(tx: Tx, ipBucket: string, now: Date): Promise<AbuseAdmission | null> {
  const { dispatchCircuit, ipDispatch } = ACCOUNT_ABUSE_LIMITS;
  const global = await eventTimes(tx, "verification_dispatch", dispatchCircuit.windowMs, now);
  const paused = refuse("verification-mail-paused", decideDispatchCircuit(global, now));
  if (paused) return paused;
  const fromIp = await eventTimes(tx, "verification_dispatch", ipDispatch.windowMs, now, {
    ipBucket,
  });
  return refuse("ip-mail-cap", decideIpDispatch(fromIp, now));
}

/**
 * Admit one signup attempt from an IP bucket, recording it when admitted.
 * Refused while verification mail is paused or the IP is at its mail cap,
 * because an admitted signup would immediately need a verification email.
 */
export async function admitSignupAttempt(
  ipBucket: string,
  now: Date = new Date(),
): Promise<AbuseAdmission> {
  return withLedgerLock(now, async (tx) => {
    const mail = await mailRefusal(tx, ipBucket, now);
    if (mail) return mail;
    const prior = await eventTimes(
      tx,
      "signup_attempt",
      ACCOUNT_ABUSE_LIMITS.signup.lookbackMs,
      now,
      { ipBucket },
    );
    const throttled = refuse("signup-throttled", decideSignupAttempt(prior, now));
    if (throttled) return throttled;
    await tx
      .insert(accountAbuseEvents)
      .values({ kind: "signup_attempt", ipBucket, emailKey: null, createdAt: now });
    return { admitted: true };
  });
}

/**
 * Admit one explicit verification-resend request for an address, recording it
 * when admitted. Recorded for any requested address — registered or not — so
 * the cooldown cannot reveal which addresses have accounts.
 */
export async function admitVerificationResend(
  emailKey: string,
  ipBucket: string,
  now: Date = new Date(),
): Promise<AbuseAdmission> {
  return withLedgerLock(now, async (tx) => {
    const mail = await mailRefusal(tx, ipBucket, now);
    if (mail) return mail;
    const prior = await eventTimes(
      tx,
      "verification_resend",
      ACCOUNT_ABUSE_LIMITS.resend.dailyWindowMs,
      now,
      { emailKey },
    );
    const throttled = refuse("resend-throttled", decideVerificationResend(prior, now));
    if (throttled) return throttled;
    await tx
      .insert(accountAbuseEvents)
      .values({ kind: "verification_resend", ipBucket, emailKey, createdAt: now });
    return { admitted: true };
  });
}

/**
 * Reserve one verification-email dispatch immediately before it is handed to
 * the mail transport. Refused only by the global velocity circuit: the
 * per-request limits were already enforced when the signup or resend was
 * admitted.
 */
export async function reserveVerificationDispatch(
  emailKey: string,
  ipBucket: string,
  now: Date = new Date(),
): Promise<AbuseAdmission> {
  return withLedgerLock(now, async (tx) => {
    const global = await eventTimes(
      tx,
      "verification_dispatch",
      ACCOUNT_ABUSE_LIMITS.dispatchCircuit.windowMs,
      now,
    );
    const paused = refuse("verification-mail-paused", decideDispatchCircuit(global, now));
    if (paused) return paused;
    await tx
      .insert(accountAbuseEvents)
      .values({ kind: "verification_dispatch", ipBucket, emailKey, createdAt: now });
    return { admitted: true };
  });
}
