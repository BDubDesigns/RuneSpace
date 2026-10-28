import { describe, expect, it } from "vitest";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { scavengeWindowAt } from "@/game/domain/scavenge";
import { estimatedServerNowMs, serverClockOffsetMs } from "@/features/play/server-clock";

const travelStartedAt = new Date("2026-01-01T00:00:00.000Z");

/** What the Journey shows for a browser whose clock is `skewMs` off the server's. */
function lifecycleSeenByBrowser(input: {
  serverAgeMs: number;
  skewMs: number;
  receivedAgeMs: number;
  /** How long the state spent in flight before the browser read its own clock. */
  transitMs?: number;
}) {
  const serverNow = (ageMs: number) => travelStartedAt.getTime() + ageMs;
  const browserNow = (ageMs: number) => serverNow(ageMs) + input.skewMs;
  // The state the browser last accepted, read by the server at `receivedAgeMs`.
  const offset = serverClockOffsetMs(
    new Date(serverNow(input.receivedAgeMs)).toISOString(),
    browserNow(input.receivedAgeMs + (input.transitMs ?? 0)),
  );
  const believedNow = estimatedServerNowMs(browserNow(input.serverAgeMs), offset);
  return scavengeWindowAt({
    travelStartedAt,
    opportunityStartTick: 3,
    now: new Date(believedNow),
    claimed: false,
  }).lifecycle;
}

describe("browser view of the server clock (#424)", () => {
  it("is the server's time minus the browser's time at receipt", () => {
    expect(
      serverClockOffsetMs("2026-01-01T00:00:10.000Z", Date.parse("2026-01-01T00:00:13.500Z")),
    ).toBe(-3_500);
    expect(
      serverClockOffsetMs("2026-01-01T00:00:10.000Z", Date.parse("2026-01-01T00:00:07.000Z")),
    ).toBe(3_000);
  });

  it("does not poison the clock with a malformed server time", () => {
    expect(serverClockOffsetMs("not a date", 1_000)).toBe(0);
  });

  it.each([-3_500, -1_200, 0, 1_200, 3_000])(
    "shows the server's window whatever a %i ms browser clock error says",
    (skewMs) => {
      // Window 1.8 s .. 4.8 s of leg age, state received 0.5 s into the leg.
      for (const [serverAgeMs, expected] of [
        [1_000, "waiting"],
        [1_900, "available"],
        [4_700, "available"],
        [4_900, "missed"],
      ] as const) {
        expect(lifecycleSeenByBrowser({ serverAgeMs, skewMs, receivedAgeMs: 500 })).toBe(expected);
      }
    },
  );

  it("never shows a window open past what the server's own grace still accepts", () => {
    const { claimGraceMs } = getEffectiveGameBalance().travel.scavenge;
    // A state that spent 700 ms in flight leaves the browser 700 ms behind, still
    // inside the grace the server keeps for exactly that.
    const transitMs = 700;
    expect(transitMs).toBeLessThan(claimGraceMs);
    expect(
      lifecycleSeenByBrowser({
        serverAgeMs: 4_800 + transitMs - 1,
        skewMs: -3_500,
        receivedAgeMs: 0,
        transitMs,
      }),
    ).toBe("available");
  });
});
