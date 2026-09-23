import { describe, expect, it } from "vitest";
import {
  ACCOUNT_ABUSE_LIMITS,
  decideDispatchCircuit,
  decideIpDispatch,
  decideSignupAttempt,
  decideVerificationResend,
  decideWindowCap,
  signupWindowMs,
} from "@/server/account-abuse-policy";

/**
 * Pure signup / verification-mail limit decisions (issue #221). The
 * PostgreSQL ledger that feeds these timestamps under a lock is proved in
 * `tests/integration/account-identity.test.ts`.
 */

const NOW = new Date("2026-10-01T12:00:00.000Z");
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function spread(count: number, stepMs: number, startAgoMs: number): Date[] {
  return Array.from({ length: count }, (_, index) => ago(startAgoMs - index * stepMs));
}

describe("decideWindowCap", () => {
  it("allows until the window is full, then reports when the oldest counted event expires", () => {
    const events = [ago(10 * MINUTE), ago(5 * MINUTE)];
    expect(decideWindowCap(events, 3, 15 * MINUTE, NOW)).toEqual({ allowed: true });
    expect(decideWindowCap(events, 2, 15 * MINUTE, NOW)).toEqual({
      allowed: false,
      retryAfterSeconds: 5 * 60,
    });
  });

  it("ignores events outside the window and events in the future", () => {
    const events = [ago(16 * MINUTE), new Date(NOW.getTime() + HOUR)];
    expect(decideWindowCap(events, 1, 15 * MINUTE, NOW)).toEqual({ allowed: true });
  });
});

describe("decideSignupAttempt", () => {
  it("admits five attempts per 15 minutes per IP and refuses the sixth", () => {
    const five = spread(5, MINUTE, 10 * MINUTE);
    expect(decideSignupAttempt(five.slice(0, 4), NOW)).toEqual({ allowed: true });
    const refused = decideSignupAttempt(five, NOW);
    expect(refused.allowed).toBe(false);
    // The oldest of the five (10 minutes ago) leaves the 15-minute window in 5 minutes.
    expect(refused).toEqual({ allowed: false, retryAfterSeconds: 5 * 60 });
  });

  it("widens the window progressively with sustained volume and never bans permanently", () => {
    expect(signupWindowMs([], NOW)).toBe(15 * MINUTE);
    expect(signupWindowMs(spread(10, 20 * MINUTE, 20 * HOUR), NOW)).toBe(HOUR);
    expect(signupWindowMs(spread(20, 30 * MINUTE, 23 * HOUR), NOW)).toBe(6 * HOUR);
    // Volume older than the 24-hour lookback no longer counts.
    expect(signupWindowMs(spread(30, MINUTE, 26 * HOUR), NOW)).toBe(15 * MINUTE);
  });

  it("applies the widened window: five attempts within the last hour refuse at the second tier", () => {
    const earlier = spread(6, 30 * MINUTE, 20 * HOUR); // older volume raising the tier
    const lastHour = spread(5, 10 * MINUTE, 55 * MINUTE); // 55, 45, 35, 25, 15 minutes ago
    const decision = decideSignupAttempt([...earlier, ...lastHour], NOW);
    expect(decision.allowed).toBe(false);
    // At the base tier these would already have aged out of 15 minutes.
    expect(decideSignupAttempt(lastHour, NOW)).toEqual({ allowed: true });
  });
});

describe("decideVerificationResend", () => {
  it("enforces one resend per 60 seconds", () => {
    expect(decideVerificationResend([], NOW)).toEqual({ allowed: true });
    expect(decideVerificationResend([ago(20 * SECOND)], NOW)).toEqual({
      allowed: false,
      retryAfterSeconds: 40,
    });
    expect(decideVerificationResend([ago(61 * SECOND)], NOW)).toEqual({ allowed: true });
  });

  it("caps resends at five per 24 hours even when each respects the cooldown", () => {
    const five = spread(5, 2 * HOUR, 12 * HOUR);
    const decision = decideVerificationResend(five, NOW);
    expect(decision).toEqual({ allowed: false, retryAfterSeconds: 12 * 60 * 60 });
    expect(decideVerificationResend(five.slice(1), NOW)).toEqual({ allowed: true });
  });
});

describe("mail caps", () => {
  it("allows twenty verification emails per IP per hour", () => {
    const nineteen = spread(19, MINUTE, 30 * MINUTE);
    expect(decideIpDispatch(nineteen, NOW)).toEqual({ allowed: true });
    expect(decideIpDispatch([...nineteen, ago(SECOND)], NOW).allowed).toBe(false);
  });

  it("opens the circuit at 100 verification emails in 10 minutes", () => {
    const { max } = ACCOUNT_ABUSE_LIMITS.dispatchCircuit;
    const almost = spread(max - 1, 5 * SECOND, 9 * MINUTE);
    expect(decideDispatchCircuit(almost, NOW)).toEqual({ allowed: true });
    expect(decideDispatchCircuit([...almost, ago(SECOND)], NOW).allowed).toBe(false);
  });

  it("keeps ledger rows at least as long as the longest window", () => {
    const longest = Math.max(
      ACCOUNT_ABUSE_LIMITS.signup.lookbackMs,
      ACCOUNT_ABUSE_LIMITS.resend.dailyWindowMs,
      ACCOUNT_ABUSE_LIMITS.ipDispatch.windowMs,
      ACCOUNT_ABUSE_LIMITS.dispatchCircuit.windowMs,
    );
    expect(ACCOUNT_ABUSE_LIMITS.retentionMs).toBeGreaterThanOrEqual(longest);
  });
});
