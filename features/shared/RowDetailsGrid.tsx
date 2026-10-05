"use client";

import {
  Fragment,
  useRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type RefObject,
} from "react";
import { detailsInsertionIndex, tileColumn } from "@/features/shared/row-details-layout";
import { useGridColumnCount } from "@/features/shared/use-grid-column-count";

/** Where the selected tile sits in the grid the details were inserted into. */
export type RowDetailsPlacement = { column: number; columns: number };

export type RowDetailsTile = { key: string; node: ReactNode };

/**
 * A tile grid with the selected tile's details inserted into the grid's own
 * child order, right after the selected tile's row (#291, #311). It owns the
 * measured column count because the row boundary is whatever the grid is laying
 * out now, so the details follow the right row at any width and stay in DOM and
 * tab order. The caller owns the column policy (`columnsClassName`) and
 * everything inside the details; the gap is one custom property so the
 * details' connector can span exactly one gap.
 */
export function RowDetailsGrid({
  ariaLabel,
  columnsClassName,
  className,
  gridRef,
  renderDetails,
  selectedIndex,
  tiles,
}: {
  ariaLabel: string;
  /** Tailwind grid-template classes, e.g. `grid-cols-3 sm:grid-cols-4`. */
  columnsClassName: string;
  className?: string;
  /** For hosts that also need the grid element (focus return). */
  gridRef?: RefObject<HTMLDivElement | null>;
  /** Only called while a tile is selected (`selectedIndex >= 0`). */
  renderDetails: (placement: RowDetailsPlacement) => ReactNode;
  /** Index into `tiles` of the selected tile, or -1 for none. */
  selectedIndex: number;
  tiles: readonly RowDetailsTile[];
}) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = gridRef ?? ownRef;
  const columns = useGridColumnCount(ref);
  const insertAfter =
    selectedIndex < 0 ? -1 : detailsInsertionIndex(selectedIndex, columns, tiles.length);
  return (
    <div
      aria-label={ariaLabel}
      className={`grid gap-[var(--row-details-gap)] [--row-details-gap:0.5rem] ${columnsClassName} ${className ?? ""}`}
      ref={ref}
      tabIndex={gridRef ? -1 : undefined}
    >
      {tiles.flatMap((tile, index) => {
        const node = <Fragment key={tile.key}>{tile.node}</Fragment>;
        if (index !== insertAfter) return [node];
        return [
          node,
          <Fragment key="row-details">
            {renderDetails({ column: tileColumn(selectedIndex, columns), columns })}
          </Fragment>,
        ];
      })}
    </div>
  );
}

type RowDetailsPanelProps = Omit<ComponentPropsWithoutRef<"section">, "ref"> & {
  placement: RowDetailsPlacement;
  panelRef: RefObject<HTMLElement | null>;
  /**
   * Reserve the fixed phone footer's clearance when revealing the panel. Hosts
   * on the page itself keep this on; a host inside a modal Drawer, which already
   * ends above the footer and scrolls on its own, turns it off.
   */
  clearBottomNav?: boolean;
};

/**
 * The full-width, accent-bordered row the details live in, with the connector
 * bar under the selected column that ties it to the tile that opened it. Hosts
 * supply the heading, content and actions as children.
 */
export function RowDetailsPanel({
  className,
  children,
  placement,
  panelRef,
  clearBottomNav = true,
  ...rest
}: RowDetailsPanelProps) {
  return (
    <section
      // The scroll margin is the fixed phone footer's clearance, which the shared
      // reveal honors so the actions never land under it; the desktop rail
      // replaces that footer from `xl`.
      className={`relative col-span-full min-w-0 border border-[color:var(--rs-accent-mining)] bg-[color:var(--rs-surface-panel)] p-3 ${clearBottomNav ? "scroll-mb-[var(--rs-bottom-nav-clearance)] xl:scroll-mb-0" : ""} ${className ?? ""}`}
      data-row-details
      ref={panelRef}
      {...rest}
    >
      <span
        aria-hidden="true"
        className="absolute w-0.5 -translate-x-1/2 bg-[color:var(--rs-accent-mining)]"
        data-row-details-connector
        style={{
          top: "calc(-1 * var(--row-details-gap) - 1px)",
          height: "calc(var(--row-details-gap) + 1px)",
          left: `calc((100% - ${placement.columns - 1} * var(--row-details-gap)) / ${placement.columns} * ${placement.column + 0.5} + ${placement.column} * var(--row-details-gap))`,
        }}
      />
      {children}
    </section>
  );
}
