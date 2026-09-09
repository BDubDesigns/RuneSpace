import { describe, expect, it } from "vitest";
import { isNewsUnread, resolveNewsReadThroughAt } from "@/game/domain/news";

const LATEST = "2026-09-08T18:00:00-07:00";

describe("account-level news read-through rules", () => {
  describe("isNewsUnread", () => {
    it("is unread when the account has never acknowledged news", () => {
      expect(isNewsUnread(LATEST, null)).toBe(true);
    });

    it("is unread when the read-through boundary is older than the newest Update", () => {
      expect(isNewsUnread(LATEST, new Date("2026-09-01T00:00:00Z"))).toBe(true);
    });

    it("is read when the read-through boundary equals the newest Update's instant", () => {
      expect(isNewsUnread(LATEST, new Date(Date.parse(LATEST)))).toBe(false);
    });

    it("is read when the read-through boundary is newer than the newest Update", () => {
      expect(isNewsUnread(LATEST, new Date("2026-09-10T00:00:00Z"))).toBe(false);
    });
  });

  describe("resolveNewsReadThroughAt", () => {
    it("advances a never-acknowledged account straight to the newest Update's instant", () => {
      const resolved = resolveNewsReadThroughAt(null, LATEST);
      expect(resolved.getTime()).toBe(Date.parse(LATEST));
    });

    it("advances an older boundary forward to the newest Update's instant", () => {
      const current = new Date("2026-09-01T00:00:00Z");
      const resolved = resolveNewsReadThroughAt(current, LATEST);
      expect(resolved.getTime()).toBe(Date.parse(LATEST));
    });

    it("never moves the boundary backward (monotonic/idempotent)", () => {
      const current = new Date("2026-09-10T00:00:00Z");
      const resolved = resolveNewsReadThroughAt(current, LATEST);
      expect(resolved.getTime()).toBe(current.getTime());
    });

    it("is idempotent when acknowledged twice at the same instant", () => {
      const first = resolveNewsReadThroughAt(null, LATEST);
      const second = resolveNewsReadThroughAt(first, LATEST);
      expect(second.getTime()).toBe(first.getTime());
    });
  });
});
