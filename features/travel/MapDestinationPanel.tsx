"use client";

import type { ReactNode } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import type { MapDestinationStatus } from "./map-destination";

/**
 * The selected-destination panel (#240). It sticks just above the fixed bottom
 * navigation so the travel decision stays in reach wherever the page is
 * scrolled, without a backdrop, without moving the map, and without scrolling
 * the document. It is compact by default: the flavor paragraph only appears
 * when Details is latched on, so the Walk control is never pushed out of view.
 */
export function MapDestinationPanel({
  id,
  locationId,
  name,
  mapStatus,
  description,
  status,
  walkSeconds,
  workActive,
  walkDisabled,
  detailsOpen,
  onToggleDetails,
  onWalk,
  feedback,
}: {
  id: string;
  locationId: string;
  name: string;
  /** The location's resolved short status (`Mining`, `Daily cells`, `CAVE-IN`). */
  mapStatus?: string;
  description: string;
  status: MapDestinationStatus;
  walkSeconds: number;
  workActive: boolean;
  walkDisabled: boolean;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  onWalk: () => void;
  feedback?: ReactNode;
}) {
  const detailsId = `${id}-details`;
  // A blocked route already names its status in the reason line below.
  const meta = [
    status === "blocked" ? undefined : mapStatus,
    status === "reachable" ? `${walkSeconds} sec walk` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      aria-label="Selected destination"
      className="rs-map-destination-panel mt-3 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3 shadow-[var(--rs-shadow-panel)] sm:mx-auto sm:max-w-xl"
      data-map-destination-panel={locationId}
      data-map-destination-status={status}
      id={id}
    >
      <p className="font-display text-sm font-bold text-[color:var(--rs-text-primary)]">{name}</p>
      {meta ? (
        <p
          className="mt-0.5 font-display text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]"
          data-map-destination-meta
        >
          {meta}
        </p>
      ) : null}
      {detailsOpen ? (
        <p
          className="mt-2 text-sm text-[color:var(--rs-text-secondary)]"
          data-map-destination-details
          id={detailsId}
        >
          {description}
        </p>
      ) : null}
      {status === "reachable" && workActive ? (
        <p className="mt-2 text-xs text-[color:var(--rs-text-secondary)]">
          Departing resolves your completed work and stops the active activity before the journey
          begins.
        </p>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        {/* A latched toggle, not a disclosure that disables itself (#240):
            secondary while off, primary while on, always enabled, and
            aria-pressed carries the same state for assistive tech. */}
        <ActionButton
          aria-controls={detailsOpen ? detailsId : undefined}
          aria-pressed={detailsOpen}
          className={`shrink-0 px-3 ${
            detailsOpen ? "shadow-[inset_0_0_0_1px_var(--rs-accent-primary)]" : ""
          }`}
          data-map-destination-details-toggle
          intent={detailsOpen ? "primary" : "secondary"}
          onClick={onToggleDetails}
          type="button"
        >
          Details
        </ActionButton>
        {status === "reachable" ? (
          <ActionButton
            className="min-w-0 flex-1"
            disabled={walkDisabled}
            intent="primary"
            onClick={onWalk}
            type="button"
          >
            {/* The visible label stays short on a phone; the accessible name
                keeps the destination so it is never an ambiguous "Walk". One
                inline wrapper, so ActionButton's flex gap cannot split it. */}
            <span>
              Walk<span className="sr-only"> to {name}</span> — {walkSeconds} sec
            </span>
          </ActionButton>
        ) : status === "blocked" ? (
          <p
            className="min-w-0 font-display text-xs uppercase tracking-wide text-[color:var(--rs-accent-danger)]"
            data-map-route-blocked={locationId}
          >
            {mapStatus
              ? `${mapStatus} — the way through is blocked.`
              : "The way through is blocked."}
          </p>
        ) : (
          <p
            className="min-w-0 font-display text-xs uppercase tracking-wide text-[color:var(--rs-text-secondary)]"
            data-map-destination-state
          >
            {status === "current" ? "You are here" : "No route from here"}
          </p>
        )}
      </div>
      {feedback}
    </section>
  );
}
