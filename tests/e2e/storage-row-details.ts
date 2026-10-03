import type { Locator, Page } from "@playwright/test";
import { expect } from "./fixtures";

/**
 * Shared geometry proof for Issue #291: in the shared storage surface the
 * selected item's details are one full-width area directly beneath the
 * selected tile's own row, with every remaining row after it. Both hosts (ship
 * Cargo Hold, Site Stash) render the same surface, so both specs call this.
 *
 * The contract is geometric and structural, never a class name or a pixel
 * position: the column count is read back from where the tiles actually lay out,
 * so it holds at the phone's three columns and the desktop's four.
 */

type TileBox = { top: number; bottom: number; left: number; right: number };

type Measurement = {
  tileCount: number;
  columns: number;
  selectedIndex: number;
  /** Tiles that come before the details in DOM order. */
  tilesBeforeDetails: number;
  detailsInLabelledGrid: boolean;
  panelCount: number;
  pressedCount: number;
  grid: { left: number; right: number };
  panel: TileBox & { clientWidth: number; scrollWidth: number };
  tiles: TileBox[];
  connector: { centerX: number; top: number; bottom: number } | undefined;
  name: {
    text: string;
    clipped: boolean;
    lines: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
  art: TileBox;
  buttons: TileBox[];
};

async function measure(region: Locator): Promise<Measurement> {
  return region.evaluate((section) => {
    const panel = section.querySelector<HTMLElement>("[data-storage-selection]")!;
    const grid = panel.parentElement as HTMLElement;
    const box = (element: Element): TileBox => {
      const { top, bottom, left, right } = element.getBoundingClientRect();
      return { top, bottom, left, right };
    };
    const children = [...grid.children];
    const tiles = children.filter((child) => child.matches("button[aria-pressed]"));
    const selectedIndex = tiles.findIndex((tile) => tile.getAttribute("aria-pressed") === "true");
    const firstTop = tiles[0]!.getBoundingClientRect().top;
    const name = panel.querySelector<HTMLElement>("[data-storage-selection-name]")!;
    const connector = panel.querySelector("[data-storage-selection-connector]");
    const connectorBox = connector?.getBoundingClientRect();
    return {
      tileCount: tiles.length,
      columns: tiles.filter((tile) => tile.getBoundingClientRect().top === firstTop).length,
      selectedIndex,
      tilesBeforeDetails: children
        .slice(0, children.indexOf(panel))
        .filter((child) => child.matches("button[aria-pressed]")).length,
      detailsInLabelledGrid: grid.getAttribute("aria-label") !== null,
      panelCount: document.querySelectorAll("[data-storage-selection]").length,
      pressedCount: document.querySelectorAll("button[aria-pressed='true']").length,
      grid: { left: grid.getBoundingClientRect().left, right: grid.getBoundingClientRect().right },
      panel: {
        ...box(panel),
        clientWidth: panel.clientWidth,
        scrollWidth: panel.scrollWidth,
      },
      tiles: tiles.map(box),
      connector: connectorBox
        ? {
            centerX: (connectorBox.left + connectorBox.right) / 2,
            top: connectorBox.top,
            bottom: connectorBox.bottom,
          }
        : undefined,
      name: {
        text: (name.textContent ?? "").trim(),
        clipped: name.scrollWidth > name.clientWidth + 1 || name.scrollHeight > name.clientHeight,
        lines: Math.round(
          name.getBoundingClientRect().height /
            Number.parseFloat(getComputedStyle(name).lineHeight),
        ),
        ...(() => {
          const { left, right, top, bottom } = name.getBoundingClientRect();
          return { left, right, top, bottom };
        })(),
      },
      art: box(panel.querySelector("[data-storage-selection-art]")!),
      buttons: [...panel.querySelectorAll("button")].map(box),
    };
  });
}

/**
 * Select tile `index` of `region` (a `[data-storage-area]` section) and assert
 * the details sit directly under that tile's row. Returns the measurement so a
 * caller can add host-specific checks.
 */
export async function expectDetailsBeneathRow(page: Page, region: Locator, index: number) {
  const tile = region.locator("button[aria-pressed]").nth(index);
  await tile.click();
  const panel = region.locator("[data-storage-selection]");
  await expect(panel).toBeVisible();
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  // The shared reveal scrolls smoothly; wait for it to settle so every box below
  // is read at one scroll position.
  await settle(page, panel);

  const m = await measure(region);
  expect(m.panelCount, "exactly one details area on the page").toBe(1);
  expect(m.pressedCount, "exactly one tile is selected").toBe(1);
  expect(m.selectedIndex).toBe(index);
  expect(m.detailsInLabelledGrid).toBe(true);

  // The selected row is every tile whose top matches the selected tile's top.
  const selectedTop = m.tiles[index]!.top;
  const rowEnd = Math.max(
    ...m.tiles.flatMap((entry, position) => (entry.top === selectedTop ? [position] : [])),
  );
  // DOM order matches the drawn order: the details follow the row's last tile.
  expect(m.tilesBeforeDetails, "details follow the selected row in DOM order").toBe(rowEnd + 1);
  for (const [position, entry] of m.tiles.entries()) {
    if (position <= rowEnd) {
      expect(entry.bottom, `tile ${position} is above the details`).toBeLessThanOrEqual(
        m.panel.top + 0.5,
      );
    } else {
      expect(entry.top, `tile ${position} is below the details`).toBeGreaterThanOrEqual(
        m.panel.bottom - 0.5,
      );
    }
  }

  // One full-width area: the whole grid, no horizontal overflow.
  expect(Math.abs(m.panel.left - m.grid.left)).toBeLessThan(1);
  expect(Math.abs(m.panel.right - m.grid.right)).toBeLessThan(1);
  expect(m.panel.scrollWidth).toBeLessThanOrEqual(m.panel.clientWidth);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );

  // The connector rises from the selected tile's own column into the details.
  const selected = m.tiles[index]!;
  expect(m.connector, "connector is present").toBeDefined();
  expect(Math.abs(m.connector!.centerX - (selected.left + selected.right) / 2)).toBeLessThan(1.5);
  expect(m.connector!.top).toBeGreaterThanOrEqual(selected.bottom - 1);
  expect(m.connector!.bottom).toBeGreaterThanOrEqual(m.panel.top);

  // The preview: the whole name, not ellipsised or clipped, beside real artwork,
  // with the controls on their own row, clear of both.
  expect(m.name.clipped, `${m.name.text} is displayed in full`).toBe(false);
  expect(m.art.right - m.art.left).toBeGreaterThanOrEqual(48);
  expect(m.name.left).toBeGreaterThanOrEqual(m.art.right);
  expect(m.name.right).toBeLessThanOrEqual(m.panel.right);
  const actionButtons = m.buttons.slice(1);
  expect(actionButtons.length).toBeGreaterThan(0);
  for (const button of actionButtons) {
    expect(button.top).toBeGreaterThanOrEqual(Math.max(m.name.bottom, m.art.bottom) - 0.5);
    expect(button.left).toBeGreaterThanOrEqual(m.panel.left);
    expect(button.right).toBeLessThanOrEqual(m.panel.right + 0.5);
    expect(button.bottom).toBeLessThanOrEqual(m.panel.bottom);
  }
  return m;
}

/** Wait until the page has stopped scrolling and the panel has stopped moving. */
async function settle(page: Page, panel: Locator) {
  let last = Number.NaN;
  await expect
    .poll(async () => {
      const y = (await panel.boundingBox())!.y;
      const steady = y === last;
      last = y;
      return steady;
    })
    .toBe(true);
}

/** The whole details area, not just its heading, is clear of the fixed phone nav. */
export async function expectDetailsAboveNav(page: Page, region: Locator) {
  const panel = region.locator("[data-storage-selection]");
  await expect
    .poll(async () => {
      const box = (await panel.boundingBox())!;
      const nav = (await page.getByRole("navigation", { name: "Primary" }).boundingBox())!;
      return box.y + box.height <= nav.y;
    })
    .toBe(true);
}

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
