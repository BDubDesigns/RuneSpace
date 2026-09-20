import { describe, expect, it } from "vitest";
import { RUNESPACE_RESET_TIME_ZONE, pacificResetDate } from "@/game/domain/daily-reset";

/**
 * The shared daily-reset boundary (#217), generalized out of the Power Annex.
 * These are the same DST/local-midnight cases `power-annex.test.ts` proves
 * through the re-exported alias, verified directly against the shared module
 * every daily-reset consumer (the Annex claim and the Work Order ForceSales
 * refresh) now calls.
 */
describe("the shared RuneSpace daily-reset boundary", () => {
  it("uses America/Los_Angeles as the canonical reset timezone", () => {
    expect(RUNESPACE_RESET_TIME_ZONE).toBe("America/Los_Angeles");
  });

  it("changes eligibility at midnight Pacific rather than after 24 hours", () => {
    expect(pacificResetDate(new Date("2026-01-02T07:59:59.999Z"))).toBe("2026-01-01");
    expect(pacificResetDate(new Date("2026-01-02T08:00:00.000Z"))).toBe("2026-01-02");
  });

  it("uses the spring-forward Pacific calendar date", () => {
    expect(pacificResetDate(new Date("2026-03-08T09:59:59.999Z"))).toBe("2026-03-08");
    expect(pacificResetDate(new Date("2026-03-08T10:00:00.000Z"))).toBe("2026-03-08");
  });

  it("uses the fall-back Pacific calendar date", () => {
    expect(pacificResetDate(new Date("2026-11-01T08:59:59.999Z"))).toBe("2026-11-01");
    expect(pacificResetDate(new Date("2026-11-01T09:00:00.000Z"))).toBe("2026-11-01");
  });

  it("rejects an invalid instant", () => {
    expect(() => pacificResetDate(new Date(Number.NaN))).toThrow(RangeError);
  });
});
