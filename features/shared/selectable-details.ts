/**
 * The pure half of the shared selectable-item interaction contract used by the
 * Inventory drawer and the Cargo Hold storage grids (see
 * `features/shared/use-selectable-details.ts` for the interaction behavior).
 *
 * Selection identity deliberately stays with each domain: an Inventory
 * selection is a kind plus an id, while a Cargo selection also carries the
 * storage area it belongs to. Only the toggle rule itself is shared, so the
 * two surfaces cannot drift apart on what re-selecting an open tile means.
 */

/** Re-selecting the already-selected entry closes it; any other selection replaces it. */
export function toggleSelection<TSelection>(
  current: TSelection | undefined,
  next: TSelection,
  isSameSelection: (current: TSelection, next: TSelection) => boolean,
): TSelection | undefined {
  if (current !== undefined && isSameSelection(current, next)) return undefined;
  return next;
}
