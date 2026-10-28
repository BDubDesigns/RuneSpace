import { describe, expect, it } from "vitest";
import { playUpdateDeferral, type PlayUpdateSnapshot } from "@/features/play/update-deferral";

const NOW = Date.parse("2026-10-28T12:00:00.000Z");

function snapshot(overrides: Partial<PlayUpdateSnapshot> = {}, travelState?: unknown) {
  return {
    commandInFlight: false,
    tradeSessionOpen: false,
    serverNowMs: NOW,
    state: { travelState, scavengeReveals: [] },
    ...overrides,
  } as PlayUpdateSnapshot;
}

const window = (expiresInMs: number, outcome?: unknown) => ({
  scavenge: {
    opportunityStartTick: 3,
    opensAt: "x",
    expiresAt: new Date(NOW + expiresInMs).toISOString(),
    outcome,
  },
});

describe("playUpdateDeferral", () => {
  it("does not defer an idle character", () => {
    expect(playUpdateDeferral(snapshot())).toBeUndefined();
  });

  it("defers while a command or background reconciliation is in flight", () => {
    expect(playUpdateDeferral(snapshot({ commandInFlight: true }))).toBe("command-in-flight");
  });

  it("defers while the character is in an accepted Trade session", () => {
    expect(playUpdateDeferral(snapshot({ tradeSessionOpen: true }))).toBe("trade-session");
  });

  it("defers while a Scavenge window is unclaimed and not yet expired", () => {
    expect(playUpdateDeferral(snapshot({}, window(5_000)))).toBe("scavenge-window");
  });

  it("stops deferring once the Scavenge window has expired or was claimed", () => {
    expect(playUpdateDeferral(snapshot({}, window(-1)))).toBeUndefined();
    expect(playUpdateDeferral(snapshot({}, window(5_000, { outcomeId: "x" })))).toBeUndefined();
  });

  it("defers while a committed Scavenge reveal awaits acknowledgment", () => {
    const withReveal = snapshot();
    withReveal.state = { ...withReveal.state, scavengeReveals: [{} as never] };
    expect(playUpdateDeferral(withReveal)).toBe("scavenge-reveal");
  });

  it("does not defer for server-persisted Travel without a Scavenge window", () => {
    expect(playUpdateDeferral(snapshot({}, { arrivesAt: "x" }))).toBeUndefined();
  });
});
