/**
 * Vertical scroll affordances (#345): the pure rule behind the amber directional
 * arrows shown on bounded, independently scrolling panels (and the Play page's
 * preview experiment). The local map keeps its own one-pixel, four-direction
 * rule (`features/travel/local-map-scroll-affordances.ts`); a panel's arrow
 * tolerates a little more so subpixel scroll positions never flicker it and an
 * arrow gives way as soon as the player is essentially at that edge.
 */

/** Distance, in CSS pixels, within which a scroller counts as "at" an edge. */
export const SCROLL_AFFORDANCE_EDGE_EPSILON = 8;

/** The native scroll metrics the rule reads, from a scroller or the document. */
export type VerticalScrollMetrics = {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
};

export type VerticalScrollAffordances = Readonly<{ top: boolean; bottom: boolean }>;

export const NO_VERTICAL_SCROLL_AFFORDANCES: VerticalScrollAffordances = {
  top: false,
  bottom: false,
};

/**
 * Which edges have genuinely hidden content beyond them. `top` means content is
 * scrolled out above the viewport; `bottom` means content continues below it.
 * A scroller whose content fits shows neither, because both distances are then
 * within the epsilon — the arrows measure real overflow, never the mere
 * possibility of scrolling.
 */
export function getVerticalScrollAffordances(
  metrics: VerticalScrollMetrics,
  epsilon = SCROLL_AFFORDANCE_EDGE_EPSILON,
): VerticalScrollAffordances {
  const remainingBelow = metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop;
  return {
    top: metrics.scrollTop > epsilon,
    bottom: remainingBelow > epsilon,
  };
}

/** Equality, so an unchanged scroll does not re-render the panel. */
export function sameVerticalScrollAffordances(
  left: VerticalScrollAffordances,
  right: VerticalScrollAffordances,
): boolean {
  return left.top === right.top && left.bottom === right.bottom;
}
