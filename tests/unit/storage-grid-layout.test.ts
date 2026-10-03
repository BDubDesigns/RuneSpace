import { describe, expect, it } from "vitest";
import { detailsInsertionIndex, tileColumn } from "@/features/storage/storage-grid-layout";

describe("storage grid row placement (#291)", () => {
  it("inserts details after the last tile of the selected tile's row at three columns", () => {
    // Nine tiles on a phone: rows are 0-2, 3-5, 6-8.
    expect(detailsInsertionIndex(0, 3, 9)).toBe(2);
    expect(detailsInsertionIndex(2, 3, 9)).toBe(2);
    expect(detailsInsertionIndex(3, 3, 9)).toBe(5);
    expect(detailsInsertionIndex(4, 3, 9)).toBe(5);
    expect(detailsInsertionIndex(8, 3, 9)).toBe(8);
  });

  it("follows the column count the grid reports, so desktop rows are four wide", () => {
    expect(detailsInsertionIndex(0, 4, 9)).toBe(3);
    expect(detailsInsertionIndex(4, 4, 9)).toBe(7);
    expect(detailsInsertionIndex(7, 4, 9)).toBe(7);
  });

  it("ends a short final row at the last tile rather than past the grid", () => {
    expect(detailsInsertionIndex(8, 4, 9)).toBe(8);
    expect(detailsInsertionIndex(6, 3, 7)).toBe(6);
    expect(detailsInsertionIndex(0, 3, 1)).toBe(0);
  });

  it("treats an unmeasured or degenerate column count as a single column", () => {
    expect(detailsInsertionIndex(2, 0, 5)).toBe(2);
    expect(detailsInsertionIndex(2, Number.NaN, 5)).toBe(2);
  });

  it("places the connector under the selected tile's own column", () => {
    expect([0, 1, 2, 3, 4, 5].map((index) => tileColumn(index, 3))).toEqual([0, 1, 2, 0, 1, 2]);
    expect([0, 1, 2, 3, 4, 5].map((index) => tileColumn(index, 4))).toEqual([0, 1, 2, 3, 0, 1]);
  });
});
