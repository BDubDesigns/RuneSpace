import type { Locator, Page } from "@playwright/test";
import { expect } from "./fixtures";

/**
 * Makes `Date` in the page run `skewMs` away from the true clock, as a player's
 * PC clock does. Only the browser is skewed: the database and the server keep
 * reading true time (#424, #446). Takes effect on the next navigation.
 */
export async function skewBrowserClock(page: Page, skewMs: number) {
  await page.addInitScript((skew) => {
    const RealDate = Date;
    class SkewedDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(RealDate.now() + skew);
        else super(...(args as [number]));
      }
      static override now() {
        return RealDate.now() + skew;
      }
    }
    window.Date = SkewedDate as DateConstructor;
  }, skewMs);
}

/** The window, on the test process's true clock, inside which the action began. */
export type StartWindow = { before: number; after: number };

/**
 * Starts an action and brackets the moment it began on the test process's own
 * (unskewed) clock. The meter is judged against that window and the authored
 * duration, never against a figure derived from the meter itself.
 */
export async function startAndBracket(start: () => Promise<void>): Promise<StartWindow> {
  const before = Date.now();
  await start();
  return { before, after: Date.now() };
}

/**
 * Asserts a progress meter agrees with the authoritative timeline: the action
 * began inside `window`, lasts `durationMs`, and `meter` reports "<n>s" of it
 * remaining plus a matching fill. Tolerance (2 s, well inside the 5 s skews) covers the bracket's width, the
 * 250 ms display tick, and the response delay the server-clock offset trails by.
 */
export async function expectMeterOnServerTimeline(
  meter: Locator,
  window: StartWindow,
  durationMs: number,
  slackMs = 2_000,
) {
  const label = (await meter.getAttribute("aria-label")) ?? "";
  const fillAttr = await meter.getAttribute("aria-valuenow");
  const readAt = Date.now();
  const shown = /([\d.]+)s/.exec(label);
  expect(shown, `no countdown in "${label}"`).not.toBeNull();
  const remainingMs = Number.parseFloat(shown![1]!) * 1_000;
  const fill = Number.parseFloat(fillAttr ?? "NaN");

  const minElapsed = readAt - window.after - slackMs;
  const maxElapsed = readAt - window.before + slackMs;
  expect(remainingMs, `remaining in "${label}"`).toBeGreaterThanOrEqual(durationMs - maxElapsed);
  expect(remainingMs, `remaining in "${label}"`).toBeLessThanOrEqual(durationMs - minElapsed);
  const filledMs = (fill / 100) * durationMs;
  expect(filledMs, `fill ${fill}% of "${label}"`).toBeGreaterThanOrEqual(Math.max(0, minElapsed));
  expect(filledMs, `fill ${fill}% of "${label}"`).toBeLessThanOrEqual(
    Math.min(durationMs, maxElapsed),
  );
}
