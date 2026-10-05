import type { Locator, Page } from "@playwright/test";
import { expect } from "./fixtures";
import { expectRowDetailsAboveNav, expectRowDetailsBeneathRow } from "./row-details";

/**
 * Storage (Cargo Hold, Site Stash) host of the shared row-details proof from
 * Issue #291 — see `row-details.ts` for the geometry contract both storage and
 * Inventory (#311) share.
 */

/**
 * Select tile `index` of `region` (a `[data-storage-area]` section), assert the
 * shared row-details geometry (`row-details.ts`), then the storage preview: the
 * whole name beside real artwork, with the controls on their own row. Returns
 * the measurement so a caller can add host-specific checks.
 */
export async function expectDetailsBeneathRow(page: Page, region: Locator, index: number) {
  const m = await expectRowDetailsBeneathRow(page, region, index);
  const preview = await region.evaluate((section) => {
    const panel = section.querySelector<HTMLElement>("[data-row-details]")!;
    const box = (element: Element) => {
      const { top, bottom, left, right } = element.getBoundingClientRect();
      return { top, bottom, left, right };
    };
    const name = panel.querySelector<HTMLElement>("[data-storage-selection-name]")!;
    return {
      name: {
        text: (name.textContent ?? "").trim(),
        clipped: name.scrollWidth > name.clientWidth + 1 || name.scrollHeight > name.clientHeight,
        ...box(name),
      },
      art: box(panel.querySelector("[data-storage-selection-art]")!),
      buttons: [...panel.querySelectorAll("button")].map(box),
    };
  });
  // The preview: the whole name, not ellipsised or clipped.
  expect(preview.name.clipped, `${preview.name.text} is displayed in full`).toBe(false);
  expect(preview.art.right - preview.art.left).toBeGreaterThanOrEqual(48);
  expect(preview.name.left).toBeGreaterThanOrEqual(preview.art.right);
  expect(preview.name.right).toBeLessThanOrEqual(m.panel.right);
  const actionButtons = preview.buttons.slice(1);
  expect(actionButtons.length).toBeGreaterThan(0);
  for (const button of actionButtons) {
    expect(button.top).toBeGreaterThanOrEqual(
      Math.max(preview.name.bottom, preview.art.bottom) - 0.5,
    );
    expect(button.left).toBeGreaterThanOrEqual(m.panel.left);
    expect(button.right).toBeLessThanOrEqual(m.panel.right + 0.5);
    expect(button.bottom).toBeLessThanOrEqual(m.panel.bottom);
  }
  return { ...m, name: preview.name };
}

/** The whole details area, not just its heading, is clear of the fixed phone nav. */
export const expectDetailsAboveNav = expectRowDetailsAboveNav;

/**
 * Selection moves and closes: another tile moves the one details area to its
 * own row, the same tile dismisses it, and Close dismisses it.
 */
export async function expectSelectionMovesAndCloses(page: Page, region: Locator) {
  const tiles = region.locator("button[aria-pressed]");
  const panel = page.locator("[data-storage-selection]");
  const last = (await tiles.count()) - 1;
  await expectDetailsBeneathRow(page, region, 0);
  await expectDetailsBeneathRow(page, region, last);
  await expect(tiles.nth(0)).toHaveAttribute("aria-pressed", "false");
  await expect(panel).toHaveCount(1);
  // The same tile again closes it.
  await tiles.nth(last).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator("button[aria-pressed='true']")).toHaveCount(0);
  // And so does Close.
  await tiles.nth(0).click();
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "CLOSE" }).click();
  await expect(panel).toHaveCount(0);
}

/**
 * Transfer feedback sits directly beneath the storage surface it came from
 * (#291 follow-up) — within one gap of the lowest visible region, never at the
 * distant foot of the activity — and above `before` when the host has more
 * below the surface (the stash's Container management).
 */
export async function expectFeedbackBeneathStorage(
  host: Locator,
  feedback: Locator,
  before?: Locator,
) {
  await expect(feedback).toHaveCount(1);
  await expect(feedback).toBeVisible();
  const surfaceBottom = await host.evaluate((element) =>
    Math.max(
      ...[...element.querySelectorAll("[data-storage-area]")]
        .filter((region) => region.getClientRects().length > 0)
        .map((region) => region.getBoundingClientRect().bottom),
    ),
  );
  const notice = (await feedback.boundingBox())!;
  expect(notice.y, "feedback starts below the storage surface").toBeGreaterThanOrEqual(
    surfaceBottom - 0.5,
  );
  expect(notice.y - surfaceBottom, "feedback is adjacent to the surface").toBeLessThanOrEqual(32);
  if (before) {
    const next = (await before.boundingBox())!;
    expect(next.y, "feedback is above what follows the surface").toBeGreaterThanOrEqual(
      notice.y + notice.height - 0.5,
    );
  }
}
