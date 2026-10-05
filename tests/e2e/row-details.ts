import type { Locator, Page } from "@playwright/test";
import { expect } from "./fixtures";

/**
 * Shared geometry proof for the row-anchored details contract (#291 storage,
 * #311 Inventory): the selected item's details are one full-width area directly
 * beneath the selected tile's own row, with every remaining tile after it and a
 * connector rising from the selected column. Cargo Hold, Site Stash and
 * Inventory all render the same `RowDetailsGrid`, so all their specs call this.
 *
 * The contract is geometric and structural, never a class name or a pixel
 * position: the column count is read back from where the tiles actually lay out.
 * `region` is any locator that contains the grid, the tiles
 * (`button[aria-pressed]`, and optionally other cells) and the details panel
 * (`[data-row-details]`).
 */

type TileBox = { top: number; bottom: number; left: number; right: number };

export type RowGeometry = {
  columns: number;
  selectedIndex: number;
  rowEnd: number;
  panel: TileBox;
  tiles: TileBox[];
};

async function measure(region: Locator) {
  return region.evaluate((section) => {
    const panel = section.querySelector<HTMLElement>("[data-row-details]")!;
    const grid = panel.parentElement as HTMLElement;
    const box = (element: Element) => {
      const { top, bottom, left, right } = element.getBoundingClientRect();
      return { top, bottom, left, right };
    };
    const children = [...grid.children];
    const tiles = children.filter((child) => child.matches("button[aria-pressed]"));
    // Every grid cell (tiles and empty slots) decides row membership.
    const cells = children.filter((child) => child !== panel);
    const selectedIndex = tiles.findIndex((tile) => tile.getAttribute("aria-pressed") === "true");
    const firstTop = tiles[0]!.getBoundingClientRect().top;
    const connector = panel.querySelector("[data-row-details-connector]");
    const connectorBox = connector?.getBoundingClientRect();
    return {
      columns: cells.filter((cell) => cell.getBoundingClientRect().top === firstTop).length,
      selectedIndex,
      cellsBeforeDetails: children.indexOf(panel),
      detailsInLabelledGrid: grid.getAttribute("aria-label") !== null,
      panelCount: document.querySelectorAll("[data-row-details]").length,
      pressedCount: document.querySelectorAll("button[aria-pressed='true']").length,
      grid: { left: grid.getBoundingClientRect().left, right: grid.getBoundingClientRect().right },
      panel: {
        ...box(panel),
        clientWidth: panel.clientWidth,
        scrollWidth: panel.scrollWidth,
      },
      cells: cells.map(box),
      tiles: tiles.map(box),
      connector: connectorBox
        ? {
            centerX: (connectorBox.left + connectorBox.right) / 2,
            top: connectorBox.top,
            bottom: connectorBox.bottom,
          }
        : undefined,
    };
  });
}

/**
 * Select tile `index` of `region` and assert the details sit directly under
 * that tile's row — counting every grid cell, empty slots included. Returns the
 * measurement so a caller can add host-specific checks.
 */
export async function expectRowDetailsBeneathRow(page: Page, region: Locator, index: number) {
  const tile = region.locator("button[aria-pressed]").nth(index);
  await tile.click();
  const panel = region.locator("[data-row-details]");
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

  // The selected row is every cell whose top matches the selected tile's top.
  const selectedTop = m.tiles[index]!.top;
  const rowEnd = Math.max(
    ...m.cells.flatMap((entry, position) => (entry.top === selectedTop ? [position] : [])),
  );
  // DOM order matches the drawn order: the details follow the row's last cell.
  expect(m.cellsBeforeDetails, "details follow the selected row in DOM order").toBe(rowEnd + 1);
  for (const [position, entry] of m.cells.entries()) {
    if (position <= rowEnd) {
      expect(entry.bottom, `cell ${position} is above the details`).toBeLessThanOrEqual(
        m.panel.top + 0.5,
      );
    } else {
      expect(entry.top, `cell ${position} is below the details`).toBeGreaterThanOrEqual(
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
  return { ...m, rowEnd };
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
export async function expectRowDetailsAboveNav(page: Page, region: Locator) {
  const panel = region.locator("[data-row-details]");
  await expect
    .poll(async () => {
      const box = (await panel.boundingBox())!;
      const nav = (await page.getByRole("navigation", { name: "Primary" }).boundingBox())!;
      return box.y + box.height <= nav.y;
    })
    .toBe(true);
}
