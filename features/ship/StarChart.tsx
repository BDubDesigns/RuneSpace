import { useId } from "react";
import { PlanetBody } from "@/features/ship/PlanetBody";
import {
  chartPlanetAnchor,
  chartPlanetLabelReach,
  interplanetaryChartGeometry,
} from "@/features/ship/flight-chart";
import {
  routeForPlanetSelection,
  STAR_CHART_PLANETS,
  STAR_CHART_VIEWBOX,
  starChartColumn,
  starChartPlanetBounds,
  type StarChartDestination,
  type StarChartModel,
} from "@/features/ship/star-chart";
import type { PlanetId } from "@/game/config/foundations";
import { getPlanetPresentation } from "@/game/content/planets";

/**
 * The Rivet's star chart (#377): the shipboard pre-launch destination selector
 * for interplanetary flights. The world the ship is berthed on is the origin,
 * marked YOU ARE HERE and never a choice; every world an authored route from
 * this berth lands on is drawn from its typed presentation (`PlanetBody`), with
 * the leg to it, and is a real button. A world whose route the server would
 * refuse is dimmed and marked unavailable: it can still be selected to read the
 * server's reason, but LAUNCH stays disabled. Nothing else is drawn, so a world
 * no route reaches stays hidden.
 *
 * The drawing is one decorative SVG; labels and touch targets are HTML laid
 * over it, so text stays readable and each world is a large, focusable target
 * at phone width. Selecting only changes local state (`onSelect`); the readout
 * and LAUNCH beside the chart act on it. The selected leg's gentle dash flow and
 * the berth's pulse stop under reduced motion, leaving a static chart.
 */
export function StarChart({
  berthName,
  model,
  readoutId,
  selectedRouteId,
  selectionLocked,
  onSelect,
}: {
  berthName: string;
  model: StarChartModel;
  readoutId: string;
  selectedRouteId: string | undefined;
  /** While a launch is being prepared or sent, the choice is fixed. */
  selectionLocked: boolean;
  onSelect: (routeId: string) => void;
}) {
  const gridId = `star-chart-grid-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const titleId = `${gridId}-title`;
  const { originPlanetId, destinations } = model;
  const isSelected = (destination: StarChartDestination) =>
    destination.routes.some((route) => route.routeId === selectedRouteId);
  const availability = (destination: StarChartDestination) =>
    destination.available ? "available" : "unavailable";
  const selected = destinations.find(isSelected);
  // Selected last, so its leg and reticle sit over every other.
  const drawOrder = [...destinations].sort(
    (a, b) => Number(a === selected) - Number(b === selected),
  );

  return (
    <div
      aria-labelledby={titleId}
      className="mx-auto w-full max-w-2xl space-y-2"
      data-star-chart
      data-star-chart-origin={originPlanetId}
      role="group"
    >
      <p
        className="font-display text-[11px] uppercase tracking-[0.16em] text-[color:var(--rs-text-muted)]"
        id={titleId}
      >
        Star chart · choose a destination
      </p>
      <div className="rs-star-chart relative aspect-[2/1] w-full overflow-hidden border border-[color:var(--rs-border-structural)]">
        <svg
          aria-hidden="true"
          className="absolute inset-0 h-full w-full"
          preserveAspectRatio="xMidYMid meet"
          viewBox={`0 0 ${STAR_CHART_VIEWBOX.width} ${STAR_CHART_VIEWBOX.height}`}
        >
          <defs>
            <pattern height="40" id={gridId} patternUnits="userSpaceOnUse" width="40">
              <path className="rs-flight-chart__grid" d="M 40 0 L 0 0 0 40" fill="none" />
            </pattern>
          </defs>
          <rect
            fill={`url(#${gridId})`}
            height={STAR_CHART_VIEWBOX.height}
            width={STAR_CHART_VIEWBOX.width}
          />
          {/* Draw order: the worlds, the legs over them, the station markers over
              the legs, and the selection reticle last. */}
          <ChartWorld planetId={originPlanetId} />
          {destinations.map((destination) => (
            <ChartWorld
              dimmed={!destination.available}
              key={destination.planetId}
              planetId={destination.planetId}
            />
          ))}
          {drawOrder.map((destination) => (
            <path
              className="rs-star-chart__route"
              d={
                interplanetaryChartGeometry(
                  originPlanetId,
                  destination.planetId,
                  STAR_CHART_PLANETS,
                ).path
              }
              data-selected={isSelected(destination) ? "" : undefined}
              data-star-chart-route={destination.planetId}
              data-state={availability(destination)}
              fill="none"
              key={destination.planetId}
            />
          ))}
          <ChartStation berth planetId={originPlanetId} />
          {destinations.map((destination) => (
            <ChartStation key={destination.planetId} planetId={destination.planetId} />
          ))}
          {selected ? (
            <Reticle available={selected.available} planetId={selected.planetId} />
          ) : null}
        </svg>
        <div
          className="absolute inset-y-0 flex flex-col items-center justify-between px-1 py-1.5 text-center"
          data-star-chart-planet={originPlanetId}
          data-state="origin"
          style={columnStyle(originPlanetId)}
        >
          <span className="flex flex-col items-center gap-0.5">
            <span
              className="rs-star-chart__chip text-[color:var(--rs-accent-primary)]"
              data-star-chart-you-are-here
            >
              You are here
            </span>
            <PlanetName planetId={originPlanetId} />
          </span>
          <StationName>{berthName}</StationName>
        </div>
        {destinations.map((destination) => {
          const pressed = isSelected(destination);
          const state = availability(destination);
          const name = getPlanetPresentation(destination.planetId).displayName;
          const stations = destination.routes.map((route) => route.destinationName).join(" · ");
          // Unavailability always shows, selected or not: it is why LAUNCH is off.
          const status = !destination.available
            ? "Unavailable"
            : pressed
              ? "Selected"
              : "Available";
          return (
            <button
              aria-controls={readoutId}
              aria-label={`${name}, ${stations}: ${status.toLowerCase()}`}
              aria-pressed={pressed}
              className="rs-focus rs-star-chart__target absolute inset-y-0 flex flex-col items-center justify-between px-1 py-1.5 text-center disabled:cursor-not-allowed"
              data-selected={pressed ? "" : undefined}
              data-star-chart-destination={destination.planetId}
              data-state={state}
              disabled={selectionLocked}
              key={destination.planetId}
              onClick={() => onSelect(routeForPlanetSelection(destination, selectedRouteId))}
              style={columnStyle(destination.planetId)}
              type="button"
            >
              <span className="flex flex-col items-center gap-0.5">
                <span className="rs-star-chart__chip" data-star-chart-status={status.toLowerCase()}>
                  {status}
                </span>
                <PlanetName planetId={destination.planetId} />
              </span>
              <StationName>{stations}</StationName>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function columnStyle(planetId: PlanetId) {
  const { leftPercent, widthPercent } = starChartColumn(planetId);
  return { left: `${leftPercent}%`, width: `${widthPercent}%` };
}

function PlanetName({ planetId }: { planetId: PlanetId }) {
  return (
    <span className="font-display text-xs uppercase tracking-[0.12em] text-[color:var(--rs-text-primary)] sm:text-sm">
      {getPlanetPresentation(planetId).displayName}
    </span>
  );
}

function StationName({ children }: { children: string }) {
  return (
    <span className="font-display text-[10px] uppercase leading-tight tracking-[0.08em] text-[color:var(--rs-text-secondary)] sm:text-xs">
      {children}
    </span>
  );
}

/** One world drawn from its authored presentation; a world that cannot be reached now is dimmed. */
function ChartWorld({ planetId, dimmed = false }: { planetId: PlanetId; dimmed?: boolean }) {
  const { center, radius } = STAR_CHART_PLANETS[planetId];
  return (
    <g className={dimmed ? "rs-star-chart__dimmed" : undefined} data-star-chart-world={planetId}>
      <PlanetBody cx={center.x} cy={center.y} planetId={planetId} r={radius} />
    </g>
  );
}

/**
 * A world's landing-station marker at its authored flight anchor, where its leg
 * begins or ends: the same anchor the flight cinematic flies from and to. The
 * ship's own berth carries a ring as well.
 */
function ChartStation({ planetId, berth = false }: { planetId: PlanetId; berth?: boolean }) {
  const anchor = chartPlanetAnchor(planetId, STAR_CHART_PLANETS);
  return (
    <g data-star-chart-station={planetId} data-star-chart-berth={berth ? "" : undefined}>
      {berth ? (
        <circle className="rs-star-chart__berth" cx={anchor.x} cy={anchor.y} fill="none" r="10" />
      ) : null}
      <circle className="rs-flight-chart__place" cx={anchor.x} cy={anchor.y} r="5" />
    </g>
  );
}

/** Corner brackets around the selected world's whole drawing, ring or halo included. */
function Reticle({ planetId, available }: { planetId: PlanetId; available: boolean }) {
  const { center, reach } = starChartPlanetBounds(planetId);
  // Kept between the label lines, so the brackets never cross a name.
  const labelReach = chartPlanetLabelReach(STAR_CHART_PLANETS);
  const halfWidth = reach.x + 6;
  const halfHeight = Math.min(reach.y + 6, labelReach + 4);
  const arm = 14;
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;
  return (
    <g
      className="rs-star-chart__reticle"
      data-star-chart-reticle={planetId}
      data-state={available ? "available" : "unavailable"}
      fill="none"
    >
      {corners.map(([sx, sy]) => {
        const x = center.x + sx * halfWidth;
        const y = center.y + sy * halfHeight;
        return (
          <path
            d={`M ${x - sx * arm} ${y} L ${x} ${y} L ${x} ${y - sy * arm}`}
            key={`${sx}${sy}`}
          />
        );
      })}
    </g>
  );
}
