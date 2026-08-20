import { describe, expect, it } from "vitest";
import {
  getLocalMapScrollAffordances,
  LOCAL_MAP_SCROLL_EPSILON,
} from "@/features/travel/local-map-scroll-affordances";

describe("local map scroll affordances (issue #92)", () => {
  it("shows every direction with remaining scroll distance", () => {
    expect(
      getLocalMapScrollAffordances({
        scrollLeft: 24,
        scrollTop: 12,
        clientWidth: 320,
        clientHeight: 180,
        scrollWidth: 600,
        scrollHeight: 420,
      }),
    ).toEqual({ left: true, right: true, top: true, bottom: true });
  });

  it("hides directions at an edge or on a non-overflowing axis", () => {
    expect(
      getLocalMapScrollAffordances({
        scrollLeft: 0,
        scrollTop: 0,
        clientWidth: 320,
        clientHeight: 420,
        scrollWidth: 600,
        scrollHeight: 420,
      }),
    ).toEqual({ left: false, right: true, top: false, bottom: false });

    expect(
      getLocalMapScrollAffordances({
        scrollLeft: 280,
        scrollTop: 0,
        clientWidth: 320,
        clientHeight: 420,
        scrollWidth: 600,
        scrollHeight: 420,
      }),
    ).toEqual({ left: true, right: false, top: false, bottom: false });
  });

  it("uses the tolerance to ignore subpixel distance at an edge", () => {
    const epsilon = LOCAL_MAP_SCROLL_EPSILON;
    expect(
      getLocalMapScrollAffordances({
        scrollLeft: epsilon,
        scrollTop: epsilon,
        clientWidth: 320,
        clientHeight: 180,
        scrollWidth: 321 + epsilon,
        scrollHeight: 181 + epsilon,
      }),
    ).toEqual({ left: false, right: false, top: false, bottom: false });
  });
});
