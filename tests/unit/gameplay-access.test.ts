import { describe, expect, it } from "vitest";
import { decideGameplayAccess } from "@/game/domain/gameplay-access";

/**
 * Issue #223 — the one gameplay-access rule:
 * canEnterGameplay = emailVerified && (publicGameplayOpen || earlyAccessGranted).
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
      expect(decideGameplayAccess(input).allowed).toBe(allowed);
    },
  );

  it("explains every refusal and every grant", () => {
    expect(
      decideGameplayAccess({
        emailVerified: false,
        earlyAccessGranted: true,
        publicGameplayOpen: true,
      }),
    ).toEqual({ allowed: false, reason: "email_unverified" });
    expect(
      decideGameplayAccess({
        emailVerified: true,
        earlyAccessGranted: false,
        publicGameplayOpen: false,
      }),
    ).toEqual({ allowed: false, reason: "gameplay_closed" });
    expect(
      decideGameplayAccess({
        emailVerified: true,
        earlyAccessGranted: true,
        publicGameplayOpen: false,
      }),
    ).toEqual({ allowed: true, via: "early_access" });
    // Once public gameplay is open, an Early Access grant is preserved but no
    // longer the reason the account may play.
    expect(
      decideGameplayAccess({
        emailVerified: true,
        earlyAccessGranted: true,
        publicGameplayOpen: true,
      }),
    ).toEqual({ allowed: true, via: "public" });
  });
});
