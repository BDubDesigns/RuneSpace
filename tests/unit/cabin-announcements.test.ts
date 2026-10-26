import { describe, expect, it } from "vitest";
import {
  CABIN_ANNOUNCEMENT_POOL,
  CABIN_ANNOUNCEMENT_SLOT_SECONDS,
  CABIN_DEPARTURE_ANNOUNCEMENT,
  CHATGPT_CABIN_ANNOUNCEMENTS,
  CLAUDE_CABIN_ANNOUNCEMENTS,
  cabinArrivalAnnouncement,
} from "@/game/content/cabin-announcements";
import {
  cabinAnnouncementAt,
  cabinAnnouncementSeed,
  selectCabinAnnouncementIndices,
} from "@/game/domain/cabin-announcements";

/**
 * Issue #404 — Milky Waymo's cabin announcements: a fixed greeting, five
 * mid-flight lines drawn without repeats from one 24-line pool, and a fixed
 * sign-off, all derived from the journey's own recorded instants.
 */
const START = Date.parse("2026-10-25T12:00:00.000Z");
const journey = (routeId = "milky_waymo_route") => ({
  routeId,
  startedAt: new Date(START).toISOString(),
  arrivesAt: new Date(START + 180_000).toISOString(),
});
const at = (seconds: number, j = journey()) =>
  cabinAnnouncementAt(j, START + seconds * 1_000, "Stillreach Landing Station");

describe("the 24-line pool", () => {
  it("is exactly the 12 approved lines followed by 12 new ones, all distinct", () => {
    expect(CHATGPT_CABIN_ANNOUNCEMENTS).toHaveLength(12);
    expect(CLAUDE_CABIN_ANNOUNCEMENTS).toHaveLength(12);
    expect(CABIN_ANNOUNCEMENT_POOL).toHaveLength(24);
    expect(new Set(CABIN_ANNOUNCEMENT_POOL).size).toBe(24);
    expect(CABIN_ANNOUNCEMENT_POOL).toEqual([
      ...CHATGPT_CABIN_ANNOUNCEMENTS,
      ...CLAUDE_CABIN_ANNOUNCEMENTS,
    ]);
  });

  it("keeps the approved lines word for word", () => {
    expect(CHATGPT_CABIN_ANNOUNCEMENTS[0]).toBe(
      "For your comfort, the windows have been calibrated to display approximately what is outside.",
    );
    expect(CHATGPT_CABIN_ANNOUNCEMENTS[11]).toBe(
      "Milky Waymo is proud to bring the convenience of public transit to places that really shouldn't have it.",
    );
  });

  it("keeps every line short, sincere prose with no invented fees, faults or crew", () => {
    for (const line of CABIN_ANNOUNCEMENT_POOL) {
      expect(line.length).toBeGreaterThan(20);
      expect(line.length).toBeLessThanOrEqual(140);
      expect(line).toMatch(/[.!]$/);
      expect(line).not.toMatch(/\$|\bcredits?\b|\bCR\b|\bfee\b|\bsurcharge\b/i);
      expect(line).not.toMatch(/\b(malfunction|turbulence|emergency|captain|crew|human)\b/i);
      // Planet-neutral: either direction can use any line.
      expect(line).not.toMatch(/\b(Skatboll|Stillreach|Holo Hollow)\b/);
    }
  });
});

describe("fixed announcements", () => {
  it("greets with the approved departure line", () => {
    expect(CABIN_DEPARTURE_ANNOUNCEMENT).toBe(
      "Welcome aboard Milky Waymo! Please sit back, relax, and enjoy your journey. Your pilot is fully automated, thoroughly tested, and legally considered a transportation professional.",
    );
  });

  it("signs off with the approved arrival line, naming the destination", () => {
    expect(cabinArrivalAnnouncement("Holo Hollow Landing")).toBe(
      "Congratulations! You have successfully arrived at Holo Hollow Landing. Please collect your belongings and exit the vehicle. Milky Waymo appreciates your business and looks forward to charging you again.",
    );
  });
});

describe("selecting a journey's five lines", () => {
  it("draws five distinct pool lines, the same five every time for the same journey", () => {
    const seed = cabinAnnouncementSeed(journey());
    const first = selectCabinAnnouncementIndices(seed);
    expect(first).toHaveLength(CABIN_ANNOUNCEMENT_SLOT_SECONDS.length);
    expect(new Set(first).size).toBe(5);
    for (const index of first) {
      expect(Number.isInteger(index)).toBe(true);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(24);
    }
    expect(selectCabinAnnouncementIndices(seed)).toEqual(first);
  });

  it("never repeats a line within a flight, across thousands of journeys", () => {
    for (let n = 0; n < 3_000; n += 1) {
      const indices = selectCabinAnnouncementIndices(`route@${START + n * 1_000}`);
      expect(new Set(indices).size).toBe(5);
    }
  });

  it("varies between journeys and reaches both authors' lines", () => {
    const seen = new Set<number>();
    const orders = new Set<string>();
    for (let n = 0; n < 400; n += 1) {
      const indices = selectCabinAnnouncementIndices(`route@${START + n * 1_000}`);
      indices.forEach((index) => seen.add(index));
      orders.add(indices.join(","));
    }
    expect(seen.size).toBe(24);
    expect(orders.size).toBeGreaterThan(300);
  });

  it("is independent of how many times or when it is asked", () => {
    const j = journey("a");
    const early = [30, 60, 90, 120, 150].map((s) => at(s, j).text);
    const later = [150, 90, 30, 120, 60].map((s) => at(s, j).text);
    expect(later).toEqual([early[4], early[2], early[0], early[3], early[1]]);
  });

  it("refuses a pool too small to give each slot its own line", () => {
    expect(() => selectCabinAnnouncementIndices("x", 4, 5)).toThrow(RangeError);
  });
});

describe("the announcement a journey is on", () => {
  it("greets until 00:30, then speaks one drawn line per 30 seconds until the sign-off", () => {
    expect(at(0)).toMatchObject({ phase: "departure", key: "departure" });
    expect(at(29.999).key).toBe("departure");
    const indices = selectCabinAnnouncementIndices(cabinAnnouncementSeed(journey()));
    CABIN_ANNOUNCEMENT_SLOT_SECONDS.forEach((seconds, slot) => {
      const before = at(seconds - 0.001);
      const exact = at(seconds);
      const later = at(seconds + 29);
      expect(exact).toMatchObject({
        phase: "in_flight",
        key: `slot-${slot + 1}`,
        text: CABIN_ANNOUNCEMENT_POOL[indices[slot] as number],
      });
      expect(later).toEqual(exact);
      expect(before.key).toBe(slot === 0 ? "departure" : `slot-${slot}`);
    });
    expect(at(179.999).key).toBe("slot-5");
  });

  it("signs off from the recorded arrival instant, naming the destination, and holds it", () => {
    expect(at(180)).toEqual({
      phase: "arrival",
      key: "arrival",
      text: cabinArrivalAnnouncement("Stillreach Landing Station"),
    });
    expect(at(10_000).key).toBe("arrival");
  });

  it("resumes late at the time-appropriate line, never a replay of a missed one", () => {
    // A reload at 02:07 is on the 02:00 line and says nothing about 00:30 to 01:30.
    const resumed = at(127);
    expect(resumed.key).toBe("slot-4");
    expect(resumed.text).toBe(at(120).text);
  });

  it("treats a clock before departure as the greeting, never a negative slot", () => {
    expect(at(-5).key).toBe("departure");
  });

  it("gives different journeys different draws from the same pool", () => {
    const a = [30, 60, 90, 120, 150].map((s) => at(s, journey("a")).text);
    const b = [30, 60, 90, 120, 150].map((s) => at(s, journey("b")).text);
    expect(a).not.toEqual(b);
    for (const line of [...a, ...b]) expect(CABIN_ANNOUNCEMENT_POOL).toContain(line);
  });
});
