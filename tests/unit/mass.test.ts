import { describe, expect, it } from "vitest";
import { formatMassGrams } from "@/game/domain/mass";

describe("formatMassGrams — canonical mass SSOT (Issue #116)", () => {
  // Required exact boundary examples from the issue contract.
  it("renders 0 as 0 g", () => {
    expect(formatMassGrams(0)).toBe("0 g");
  });

  it("renders 1 as 1 g", () => {
    expect(formatMassGrams(1)).toBe("1 g");
  });

  it("renders 999 as 999 g", () => {
    expect(formatMassGrams(999)).toBe("999 g");
  });

  it("renders the 1000 boundary as 1 kg", () => {
    expect(formatMassGrams(1000)).toBe("1 kg");
  });

  it("renders 1001 as 1.001 kg", () => {
    expect(formatMassGrams(1001)).toBe("1.001 kg");
  });

  it("strips trailing zeroes from fractional kilograms", () => {
    expect(formatMassGrams(1010)).toBe("1.01 kg");
    expect(formatMassGrams(1100)).toBe("1.1 kg");
    expect(formatMassGrams(1250)).toBe("1.25 kg");
    expect(formatMassGrams(1500)).toBe("1.5 kg");
  });

  it("renders a larger exact gram quantity deterministically", () => {
    expect(formatMassGrams(12345)).toBe("12.345 kg");
  });

  it("renders a large value that remains in kilograms", () => {
    expect(formatMassGrams(1_000_000)).toBe("1000 kg");
  });

  it("renders intermediate holdings without locale dependence", () => {
    expect(formatMassGrams(500)).toBe("500 g");
    expect(formatMassGrams(2000)).toBe("2 kg");
    expect(formatMassGrams(7000)).toBe("7 kg");
    expect(formatMassGrams(15000)).toBe("15 kg");
    expect(formatMassGrams(50000)).toBe("50 kg");
  });

  it("rejects malformed input consistently with domain helpers", () => {
    expect(() => formatMassGrams(NaN)).toThrow(RangeError);
    expect(() => formatMassGrams(Infinity)).toThrow(RangeError);
    expect(() => formatMassGrams(-1)).toThrow(RangeError);
    expect(() => formatMassGrams(-0.5)).toThrow(RangeError);
    expect(() => formatMassGrams(1.5)).toThrow(RangeError);
    expect(() => formatMassGrams(1000.1)).toThrow(RangeError);
  });

  it("never emits floating-point artifacts", () => {
    // Cheap check: none of the representative outputs should contain
    // the repeating patterns that binary floating-point noise produces.
    const samples = [
      0, 1, 999, 1000, 1001, 1010, 1100, 1250, 1500, 12345, 500, 2000, 15000, 1_000_000,
    ].map(formatMassGrams);
    for (const s of samples) {
      expect(s).not.toMatch(/0{4,}|9{4,}/);
      expect(s).not.toMatch(/\d+\.\d{4,}/);
    }
  });
});
