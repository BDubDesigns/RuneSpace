import { describe, expect, it } from "vitest";
import { ContentId, asContentId } from "@/game/schemas/ids";

/**
 * Smoke test for the single-source-of-truth content-ID contract.
 *
 * This is a meaningful unit test of pure domain validation (no DOM, no DB).
 * It guards the identifier rule that all future typed content will reuse.
 */

describe("ContentId", () => {
  it("accepts valid lowercase snake_case ids", () => {
    expect(ContentId.parse("crash_site")).toBe("crash_site");
    expect(ContentId.parse("mining_01")).toBe("mining_01");
  });

  it("rejects ids that do not start with a letter", () => {
    expect(ContentId.safeParse("1mining").success).toBe(false);
    expect(ContentId.safeParse("_mining").success).toBe(false);
  });

  it("rejects uppercase and spaces", () => {
    expect(ContentId.safeParse("Mining").success).toBe(false);
    expect(ContentId.safeParse("mining ore").success).toBe(false);
  });

  it("asContentId throws on invalid input", () => {
    expect(() => asContentId("Bad Id")).toThrow();
  });
});
