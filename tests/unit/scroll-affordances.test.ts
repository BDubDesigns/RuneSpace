import { describe, expect, it } from "vitest";
import {
  getVerticalScrollAffordances,
  NO_VERTICAL_SCROLL_AFFORDANCES,
  sameVerticalScrollAffordances,
  SCROLL_AFFORDANCE_EDGE_EPSILON,
} from "@/components/ui/scroll-affordances";

const EPSILON = SCROLL_AFFORDANCE_EDGE_EPSILON;

describe("vertical scroll affordances (issue #345)", () => {
  it("uses roughly an eight pixel near-edge tolerance", () => {
    expect(EPSILON).toBe(8);
  });

  it("shows only the down arrow at the top of overflowing content", () => {
    expect(
      getVerticalScrollAffordances({ scrollTop: 0, clientHeight: 400, scrollHeight: 900 }),
    ).toEqual({ top: false, bottom: true });
  });

  it("shows both arrows in the middle", () => {
    expect(
      getVerticalScrollAffordances({ scrollTop: 200, clientHeight: 400, scrollHeight: 900 }),
    ).toEqual({ top: true, bottom: true });
  });

  it("shows only the up arrow at the bottom", () => {
    expect(
      getVerticalScrollAffordances({ scrollTop: 500, clientHeight: 400, scrollHeight: 900 }),
    ).toEqual({ top: true, bottom: false });
  });

  it("shows neither arrow when the content fits", () => {
    expect(
      getVerticalScrollAffordances({ scrollTop: 0, clientHeight: 400, scrollHeight: 400 }),
    ).toEqual(NO_VERTICAL_SCROLL_AFFORDANCES);
    expect(
      getVerticalScrollAffordances({ scrollTop: 0, clientHeight: 400, scrollHeight: 300 }),
    ).toEqual(NO_VERTICAL_SCROLL_AFFORDANCES);
  });

  it("does not hint at overflow no larger than the tolerance", () => {
    // A scroller that could move by a few pixels is not "more content".
    expect(
      getVerticalScrollAffordances({
        scrollTop: 0,
        clientHeight: 400,
        scrollHeight: 400 + EPSILON,
      }),
    ).toEqual(NO_VERTICAL_SCROLL_AFFORDANCES);
    expect(
      getVerticalScrollAffordances({
        scrollTop: 0,
        clientHeight: 400,
        scrollHeight: 400 + EPSILON + 1,
      }),
    ).toEqual({ top: false, bottom: true });
  });

  it("gives way at either edge within the tolerance, including subpixel positions", () => {
    expect(
      getVerticalScrollAffordances({
        scrollTop: EPSILON,
        clientHeight: 400,
        scrollHeight: 900,
      }).top,
    ).toBe(false);
    expect(
      getVerticalScrollAffordances({
        scrollTop: EPSILON + 0.5,
        clientHeight: 400,
        scrollHeight: 900,
      }).top,
    ).toBe(true);
    // Fractional scrollTop a hair short of the real end, as browsers report on
    // scaled displays, must not leave a down arrow flickering at the bottom.
    expect(
      getVerticalScrollAffordances({
        scrollTop: 499.4,
        clientHeight: 400,
        scrollHeight: 900,
      }).bottom,
    ).toBe(false);
    expect(
      getVerticalScrollAffordances({
        scrollTop: 900 - 400 - EPSILON - 0.5,
        clientHeight: 400,
        scrollHeight: 900,
      }).bottom,
    ).toBe(true);
  });

  it("accepts a different tolerance", () => {
    const metrics = { scrollTop: 3, clientHeight: 100, scrollHeight: 200 };
    expect(getVerticalScrollAffordances(metrics, 1).top).toBe(true);
    expect(getVerticalScrollAffordances(metrics, 4).top).toBe(false);
  });

  it("compares per direction so an unchanged scroll does not re-render", () => {
    expect(
      sameVerticalScrollAffordances({ top: true, bottom: false }, { top: true, bottom: false }),
    ).toBe(true);
    expect(
      sameVerticalScrollAffordances({ top: true, bottom: false }, { top: true, bottom: true }),
    ).toBe(false);
  });
});
