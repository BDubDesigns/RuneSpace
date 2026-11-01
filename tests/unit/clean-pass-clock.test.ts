// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CleanPassControl } from "@/features/welding/CleanPassControl";
import type { CleanPassProjection } from "@/server/play";

const play = vi.hoisted(() => ({
  skew: 0,
  serverNow: "",
  action: { progressStartedAt: "", nextAttemptAt: "" } as
    | { progressStartedAt: string; nextAttemptAt: string }
    | undefined,
  acceptState: vi.fn(),
  claim: vi.fn(),
  serverNowMs: () => Date.now() - play.skew,
}));
vi.mock("@/features/play/PlayContext", () => ({
  usePlay: () => ({
    state: { activeAction: play.action, characterId: "test", serverNow: play.serverNow },
    serverNowMs: play.serverNowMs,
    foregroundBusy: false,
    enqueueForeground: (work: () => void) => work(),
    releaseCommand: vi.fn(),
    acceptState: play.acceptState,
  }),
}));
vi.mock("@/server/actions", () => ({ claimCleanPassAction: play.claim }));
vi.mock("@/features/diagnostics/client", () => ({ reportClientDiagnostic: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const base = Date.parse("2026-01-01T00:00:00.000Z");
let host: HTMLDivElement;
let root: Root;
const projection = (section: number, completed: number): CleanPassProjection => ({
  opportunities: [{ section, outcome: null }],
  sectionsCompleted: completed,
});
function setAction(start: number, end: number) {
  play.action = {
    progressStartedAt: new Date(start).toISOString(),
    nextAttemptAt: new Date(end).toISOString(),
  };
}
async function render(cleanPass?: CleanPassProjection) {
  await act(async () => root.render(React.createElement(CleanPassControl, { cleanPass })));
}
function countdown() {
  return host.querySelector('[role="progressbar"]');
}
beforeEach(() => {
  vi.useFakeTimers();
  play.skew = 0;
  play.serverNow = new Date(base).toISOString();
  play.acceptState.mockReset();
  play.claim.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("Clean Pass server-clock display (#470)", () => {
  it.each([-5_000, 0, 5_000])(
    "rehydrates and ticks mid-window with browser skew %i",
    async (skew) => {
      play.skew = skew;
      vi.setSystemTime(base + 1_000 + skew);
      setAction(base, base + 3_000);
      await render(projection(2, 1));
      expect(countdown()?.getAttribute("aria-label")).toBe("Clean Pass window: 2.0s");
      expect(Number(countdown()?.getAttribute("aria-valuenow"))).toBeCloseTo(200 / 3);
      await act(async () => vi.advanceTimersByTime(500));
      expect(countdown()?.getAttribute("aria-label")).toBe("Clean Pass window: 1.5s");
      expect(Number(countdown()?.getAttribute("aria-valuenow"))).toBeCloseTo(50);
    },
  );

  it("reads the server clock immediately when a pending opportunity opens", async () => {
    vi.setSystemTime(base);
    setAction(base, base + 3_000);
    await render(projection(2, 0));
    expect(countdown()).toBeNull();
    vi.setSystemTime(base + 1_000);
    await render(projection(2, 1));
    expect(countdown()?.getAttribute("aria-label")).toBe("Clean Pass window: 2.0s");
  });

  it("refreshes on a new section and stops ticking after the opportunity closes", async () => {
    vi.setSystemTime(base + 1_000);
    setAction(base, base + 3_000);
    await render(projection(2, 1));
    vi.setSystemTime(base + 4_000);
    setAction(base + 3_000, base + 6_000);
    await render(projection(3, 2));
    expect(countdown()?.getAttribute("aria-label")).toBe("Clean Pass window: 2.0s");
    await render(projection(3, 3));
    expect(countdown()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("refreshes the same opportunity when a new server projection recalibrates the clock", async () => {
    vi.setSystemTime(base + 1_000);
    setAction(base, base + 3_000);
    await render(projection(2, 1));
    play.skew = 500;
    play.serverNow = new Date(base + 500).toISOString();
    await render(projection(2, 1));
    expect(countdown()?.getAttribute("aria-label")).toBe("Clean Pass window: 2.5s");
  });

  it("waits for server confirmation before showing success", async () => {
    vi.setSystemTime(base + 1_000);
    setAction(base, base + 3_000);
    let resolve!: (value: unknown) => void;
    play.claim.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await render(projection(2, 1));
    await act(async () =>
      host.querySelector<HTMLButtonElement>("[data-clean-pass-claim]")!.click(),
    );
    expect(host.textContent).not.toContain("STACKIN' DIMES!");
    await act(async () => resolve({ state: {}, cleanPass: { status: "claimed", awardedXp: 10 } }));
    expect(host.textContent).toContain("STACKIN' DIMES!");
    expect(play.acceptState).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTime(2_400));
    expect(host.textContent).not.toContain("STACKIN' DIMES!");
  });
  it("never opens a claim from clock skew alone and respects server refusal", async () => {
    play.skew = 5_000;
    vi.setSystemTime(base + 1_000 + play.skew);
    setAction(base, base + 3_000);
    await render(projection(3, 1));
    const button = host.querySelector<HTMLButtonElement>("[data-clean-pass-claim]")!;
    expect(button.disabled).toBe(true);
    await render(projection(2, 1));
    play.claim.mockResolvedValue({
      state: {},
      cleanPass: { status: "expired", message: "Window expired." },
    });
    await act(async () => button.click());
    expect(play.claim).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("Window expired.");
    expect(host.textContent).not.toContain("STACKIN' DIMES!");
  });
});
