import { describe, expect, it } from "vitest";
import {
  getLocalMapMissionEdgeCues,
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

describe("off-screen Mission edge cues (issue #240)", () => {
  // A 300x400 window onto a larger canvas, scrolled to (200, 100).
  const visible = { left: 200, top: 100, right: 500, bottom: 500 };

  it("cues the edge an accepted Mission target lies beyond, in every direction", () => {
    expect(getLocalMapMissionEdgeCues(visible, [{ x: 120, y: 300, tone: "active" }])).toEqual({
      left: "active",
    });
    expect(getLocalMapMissionEdgeCues(visible, [{ x: 640, y: 300, tone: "active" }])).toEqual({
      right: "active",
    });
    expect(getLocalMapMissionEdgeCues(visible, [{ x: 350, y: 40, tone: "turn_in" }])).toEqual({
      top: "turn_in",
    });
    expect(getLocalMapMissionEdgeCues(visible, [{ x: 350, y: 700, tone: "turn_in" }])).toEqual({
      bottom: "turn_in",
    });
  });

  it("cues both edges for a diagonal target", () => {
    expect(getLocalMapMissionEdgeCues(visible, [{ x: 40, y: 700, tone: "active" }])).toEqual({
      left: "active",
      bottom: "active",
    });
  });

  it("clears the cue once the target's center is inside the viewport", () => {
    expect(getLocalMapMissionEdgeCues(visible, [{ x: 350, y: 300, tone: "active" }])).toEqual({});
    // On the boundary counts as in view: at least half the hex is showing.
    expect(getLocalMapMissionEdgeCues(visible, [{ x: 200, y: 500, tone: "active" }])).toEqual({});
  });

  it("lets active work win an edge shared with a turn-in, in either order", () => {
    const turnInFirst = [
      { x: 40, y: 300, tone: "turn_in" as const },
      { x: 90, y: 200, tone: "active" as const },
    ];
    expect(getLocalMapMissionEdgeCues(visible, turnInFirst)).toEqual({ left: "active" });
    expect(getLocalMapMissionEdgeCues(visible, [...turnInFirst].reverse())).toEqual({
      left: "active",
    });
  });

  it("keeps a turn-in cue on its own edge when active work is elsewhere", () => {
    expect(
      getLocalMapMissionEdgeCues(visible, [
        { x: 40, y: 300, tone: "turn_in" },
        { x: 640, y: 300, tone: "active" },
      ]),
    ).toEqual({ left: "turn_in", right: "active" });
  });

  it("has nothing to cue without accepted Mission targets", () => {
    expect(getLocalMapMissionEdgeCues(visible, [])).toEqual({});
  });
});
