import { describe, expect, it } from "vitest";
import { decideGameplayAccess } from "@/game/domain/gameplay-access";

/**
 * Issue #223 — the one gameplay-access rule, with the issue #248 suspension:
 * canEnterGameplay = emailVerified && !suspended && (publicGameplayOpen || earlyAccessGranted).
 */
describe("decideGameplayAccess", () => {
  it.each([
    { emailVerified: false, earlyAccessGranted: false, publicGameplayOpen: false, allowed: false },
    { emailVerified: false, earlyAccessGranted: true, publicGameplayOpen: false, allowed: false },
    { emailVerified: false, earlyAccessGranted: false, publicGameplayOpen: true, allowed: false },
    { emailVerified: false, earlyAccessGranted: true, publicGameplayOpen: true, allowed: false },
    { emailVerified: true, earlyAccessGranted: false, publicGameplayOpen: false, allowed: false },
    { emailVerified: true, earlyAccessGranted: true, publicGameplayOpen: false, allowed: true },
    { emailVerified: true, earlyAccessGranted: false, publicGameplayOpen: true, allowed: true },
    { emailVerified: true, earlyAccessGranted: true, publicGameplayOpen: true, allowed: true },
  ])(
    "verified=$emailVerified earlyAccess=$earlyAccessGranted open=$publicGameplayOpen → $allowed",
    ({ allowed, ...input }) => {
      expect(decideGameplayAccess({ ...input, suspended: false }).allowed).toBe(allowed);
      // A suspension refuses every combination.
      expect(decideGameplayAccess({ ...input, suspended: true }).allowed).toBe(false);
    },
  );

  it("explains every refusal and every grant", () => {
    expect(
      decideGameplayAccess({
        emailVerified: false,
        earlyAccessGranted: true,
        publicGameplayOpen: true,
        suspended: false,
      }),
    ).toEqual({ allowed: false, reason: "email_unverified" });
    expect(
      decideGameplayAccess({
        emailVerified: true,
        earlyAccessGranted: false,
        publicGameplayOpen: false,
        suspended: false,
      }),
    ).toEqual({ allowed: false, reason: "gameplay_closed" });
    expect(
      decideGameplayAccess({
        emailVerified: true,
        earlyAccessGranted: true,
        publicGameplayOpen: false,
        suspended: false,
      }),
    ).toEqual({ allowed: true, via: "early_access" });
    // Once public gameplay is open, an Early Access grant is preserved but no
    // longer the reason the account may play.
    expect(
      decideGameplayAccess({
        emailVerified: true,
        earlyAccessGranted: true,
        publicGameplayOpen: true,
        suspended: false,
      }),
    ).toEqual({ allowed: true, via: "public" });
  });

  it("a suspension outranks Early Access and public gameplay", () => {
    expect(
      decideGameplayAccess({
        emailVerified: true,
        earlyAccessGranted: true,
        publicGameplayOpen: true,
        suspended: true,
      }),
    ).toEqual({ allowed: false, reason: "suspended" });
  });
});
