import { describe, expect, it } from "vitest";
import {
  SOFT_ALPHA_COUNTDOWN_LABEL,
  SOFT_ALPHA_LAUNCH_IMMINENT,
  formatLaunchTargetPacific,
  formatSoftAlphaCountdown,
  presentSoftAlphaLaunch,
} from "@/game/domain/soft-alpha-launch";

/**
 * Issue #223 — the shared Soft Alpha countdown / LAUNCH IMMINENT! presentation.
 * The target instant is persisted by migration 0026 (the database row is its
 * runtime source); every case here uses an injected reference time.
 */
const SOFT_ALPHA_LAUNCH_TARGET_ISO = "2026-10-27T16:00:00.000Z";
const target = new Date(SOFT_ALPHA_LAUNCH_TARGET_ISO);
const at = (ms: number) => new Date(target.getTime() + ms);
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("presentSoftAlphaLaunch", () => {
  it("counts down before the target in the locked format", () => {
    const presentation = presentSoftAlphaLaunch({
      publicGameplayOpen: false,
      launchTargetAt: target,
      now: at(-(34 * DAY + 7 * HOUR + 12 * MINUTE + 9 * SECOND)),
    });
    expect(presentation).toEqual({
      kind: "countdown",
      label: "SOFT ALPHA OPENS IN",
      parts: { days: 34, hours: 7, minutes: 12, seconds: 9 },
      text: "34D · 07H · 12M · 09S",
    });
    expect(SOFT_ALPHA_COUNTDOWN_LABEL).toBe("SOFT ALPHA OPENS IN");
  });

  it("rounds partial seconds up so the countdown stays positive until the target", () => {
    expect(
      presentSoftAlphaLaunch({ publicGameplayOpen: false, launchTargetAt: target, now: at(-1500) }),
    ).toMatchObject({ kind: "countdown", text: "0D · 00H · 00M · 02S" });
    // The last fractional second before the target still counts down.
    expect(
      presentSoftAlphaLaunch({ publicGameplayOpen: false, launchTargetAt: target, now: at(-1) }),
    ).toMatchObject({
      kind: "countdown",
      parts: { days: 0, hours: 0, minutes: 0, seconds: 1 },
      text: "0D · 00H · 00M · 01S",
    });
  });

  it("reads LAUNCH IMMINENT! at the exact target and after it while closed", () => {
    for (const now of [at(0), at(1), at(SECOND), at(30 * DAY)]) {
      expect(
        presentSoftAlphaLaunch({ publicGameplayOpen: false, launchTargetAt: target, now }),
      ).toEqual({ kind: "imminent", label: "LAUNCH IMMINENT!" });
    }
    expect(SOFT_ALPHA_LAUNCH_IMMINENT).toBe("LAUNCH IMMINENT!");
  });

  it("never shows a countdown once public gameplay is open, before or after the target", () => {
    for (const now of [at(-10 * DAY), at(0), at(10 * DAY)]) {
      expect(
        presentSoftAlphaLaunch({ publicGameplayOpen: true, launchTargetAt: target, now }),
      ).toEqual({ kind: "open" });
    }
  });

  it("formats multi-digit days without padding and pads the clock fields", () => {
    expect(formatSoftAlphaCountdown({ days: 5, hours: 0, minutes: 3, seconds: 0 })).toBe(
      "5D · 00H · 03M · 00S",
    );
    expect(formatSoftAlphaCountdown({ days: 120, hours: 23, minutes: 59, seconds: 59 })).toBe(
      "120D · 23H · 59M · 59S",
    );
  });
});

describe("the locked Soft Alpha launch target", () => {
  it("is 2026-10-27 09:00 America/Los_Angeles", () => {
    expect(SOFT_ALPHA_LAUNCH_TARGET_ISO).toBe("2026-10-27T16:00:00.000Z");
    expect(formatLaunchTargetPacific(target)).toBe("October 27, 2026 · 9:00 AM Pacific");
  });
});
