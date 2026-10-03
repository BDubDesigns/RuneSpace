/**
 * Pure row arithmetic for the storage tile grids (Issue #291). The selected
 * item's details are inserted into the grid's own child order, right after the
 * last tile of the selected tile's row, so the DOM reading and tab order match
 * what is drawn. The column count is whatever the grid currently renders —
 * measured, never hard-coded here — so these helpers hold for any breakpoint.
 */

function wholeColumns(columns: number): number {
  return Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : 1;
}

/** Zero-based column the tile at `index` occupies in a grid of `columns`. */
export function tileColumn(index: number, columns: number): number {
  return index % wholeColumns(columns);
}

/**
 * Index of the last tile in the row holding `selectedIndex`; the details area
 * renders immediately after it. A short final row ends at the last tile.
 */
export function detailsInsertionIndex(
  selectedIndex: number,
  columns: number,
  tileCount: number,
): number {
  const width = wholeColumns(columns);
  return Math.min(tileCount - 1, (Math.floor(selectedIndex / width) + 1) * width - 1);
}
