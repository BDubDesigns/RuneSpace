import { describe, expect, it } from "vitest";
import {
  normalizeReportNote,
  REPORT_POLICY,
  REPORT_REASON_LABEL,
  REPORT_REASONS,
} from "@/game/domain/social-safety";
import { ReportMessageRequestSchema } from "@/game/schemas/social-safety";

/**
 * Issue #247 — the pure Report rules. Block scope, non-disclosure, evidence
 * windows, dedupe, and retention are proven against PostgreSQL in
 * tests/integration/social-safety.test.ts.
 */
describe("report reasons", () => {
  it("offers exactly the six #226 categories, each with a label", () => {
    expect(REPORT_REASONS.map((reason) => REPORT_REASON_LABEL[reason])).toEqual([
      "Harassment or hate",
      "Threats",
      "Spam or scam",
      "Sexual or inappropriate",
      "Offensive name or profile",
      "Other",
    ]);
  });

  it("refuses an unknown reason at the request boundary and defaults Report + Block off", () => {
    const base = {
      characterId: "00000000-0000-4000-8000-000000000001",
      messageId: "00000000-0000-4000-8000-000000000002",
    };
    expect(ReportMessageRequestSchema.safeParse({ ...base, reason: "vibes" }).success).toBe(false);
    const parsed = ReportMessageRequestSchema.parse({ ...base, reason: "threats" });
    expect(parsed.alsoBlock).toBe(false);
  });
});

describe("report note", () => {
  it("is optional: blank or missing means no note", () => {
    expect(normalizeReportNote(undefined)).toEqual({ ok: true, note: null });
    expect(normalizeReportNote("   \n ")).toEqual({ ok: true, note: null });
  });

  it("is trimmed plain text and never silently cut", () => {
    expect(normalizeReportNote("  kept\r\nspamming  ")).toEqual({
      ok: true,
      note: "kept\nspamming",
    });
    expect(normalizeReportNote("a\u0000b")).toEqual({ ok: true, note: "ab" });
    const limit = "é".repeat(REPORT_POLICY.noteMaxLength);
    expect(normalizeReportNote(limit)).toEqual({ ok: true, note: limit });
    expect(normalizeReportNote(`${limit}!`)).toEqual({ ok: false, reason: "note_too_long" });
  });
});
