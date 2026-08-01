"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { ACTION_IDS, GAME_TICK_MS, LOCATION_IDS } from "@/game/config/foundations";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { getLocation } from "@/game/content/locations";
import { beginTravelAction } from "@/server/actions";
import { useMiningPlay } from "@/features/mining/MiningPlayContext";
import {
  buildLocalMapGeometry,
  LOCAL_MAP_GEOMETRY,
  LOCAL_MAP_HEX_WIDTH,
  type LocalMapGeometry,
} from "./local-map-layout";
import { routeProgressSegment } from "./route-progress";

const WALK_SECONDS = Math.round(
  (getEffectiveGameBalance().travel.adjacentWalkDurationTicks * GAME_TICK_MS) / 1000,
);

const MOBILE_LOCAL_MAP_HEX_WIDTH = 108;

/** Flat-top hex vertex points as an SVG polygon string. */
function hexPoints(cx: number, cy: number, w: number): string {
  const h = w * (Math.sqrt(3) / 2);
  return [
    [cx - w / 4, cy - h / 2],
    [cx + w / 4, cy - h / 2],
    [cx + w / 2, cy],
    [cx + w / 4, cy + h / 2],
    [cx - w / 4, cy + h / 2],
    [cx - w / 2, cy],
  ]
    .map(([x, y]) => `${x},${y}`)
    .join(" ");
}

// ---------------------------------------------------------------------------
// Hex button layer (native <button> for semantics, transparent over the SVG)
// ---------------------------------------------------------------------------

type HexButtonProps = {
  locationId: string;
  name: string;
  accessibleName: string;
  description: string;
  selected: boolean;
  current: boolean;
  transitRole?: "origin" | "destination";
  disabled: boolean;
  onSelect: () => void;
  children: React.ReactNode;
  style: CSSProperties;
};

function HexButton({
  locationId,
  name,
  accessibleName,
  description,
  selected,
  current,
  transitRole,
  disabled,
  onSelect,
  children,
  style,
}: HexButtonProps) {
  const youAreHere = current;
  const stateLabel = transitRole
    ? transitRole === "origin"
      ? "Origin"
      : "Destination"
    : youAreHere
      ? "You are here"
      : selected
        ? "Selected"
        : "Reachable";
  const accessibleLabel = [
    accessibleName,
    youAreHere ? "You are here." : "Reachable destination.",
    selected && !youAreHere ? "Selected." : "",
    disabled ? "Travel in progress; map is read-only." : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      aria-pressed={selected && !youAreHere}
      aria-current={youAreHere ? "true" : undefined}
      aria-label={accessibleLabel}
      aria-describedby={`loc-desc-${locationId}`}
      disabled={disabled}
      onClick={onSelect}
      style={style}
      className="rs-focus group absolute z-10 flex flex-col items-center justify-center gap-0.5 text-center outline-none transition disabled:cursor-not-allowed disabled:opacity-70 motion-safe:transition-transform motion-safe:hover:scale-[1.025]"
    >
      <span
        aria-hidden="true"
        className="relative z-10 font-display text-[9px] uppercase tracking-[0.18em] text-[color:var(--rs-text-secondary)] sm:text-[10px]"
      >
        {stateLabel}
      </span>
      <span className="relative z-10 max-w-[80%] font-display text-[12px] font-bold leading-tight text-[color:var(--rs-text-primary)] sm:text-sm">
        {name}
      </span>
      <span id={`loc-desc-${locationId}`} className="sr-only">
        {description}
      </span>
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// SVG visual layer: hex outlines, state markers, and the three routes
// ---------------------------------------------------------------------------

function HexMapSvg({
  geometry,
  currentLocationId,
  selectedLocationId,
  inTransit,
  transitProgress,
  travelOriginLocationId,
  travelDestinationLocationId,
}: {
  geometry: LocalMapGeometry;
  currentLocationId: string;
  selectedLocationId?: string;
  inTransit: boolean;
  transitProgress: number;
  travelOriginLocationId?: (typeof LOCATION_IDS)[keyof typeof LOCATION_IDS];
  travelDestinationLocationId?: (typeof LOCATION_IDS)[keyof typeof LOCATION_IDS];
}) {
  const hexWidth = geometry.hexWidth;
  const hexFill = (current: boolean, selected: boolean) =>
    current
      ? "fill-[color:var(--rs-accent-primary-subtle)] stroke-[color:var(--rs-accent-primary)]"
      : selected
        ? "fill-[color:var(--rs-accent-mining-subtle)] stroke-[color:var(--rs-accent-mining)]"
        : "fill-[color:var(--rs-surface-raised)] stroke-[color:var(--rs-border-structural)]";

  const selectedMarker = (cx: number, cy: number) => (
    <path
      d={`M ${cx + hexWidth * 0.28} ${cy - hexWidth * 0.22} L ${cx + hexWidth * 0.34} ${cy - hexWidth * 0.15} L ${cx + hexWidth * 0.42} ${cy - hexWidth * 0.27}`}
      fill="none"
      stroke="var(--rs-accent-mining)"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );

  const routeProgress =
    inTransit && travelOriginLocationId && travelDestinationLocationId
      ? routeProgressSegment({
          originLocationId: travelOriginLocationId,
          destinationLocationId: travelDestinationLocationId,
          routeSegments: geometry.routeSegments,
          progress: transitProgress,
        })
      : undefined;

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Hexes first (routes are drawn after for contrast). */}
      {geometry.layouts.map((layout) => {
        const current = layout.locationId === currentLocationId;
        const selected = layout.locationId === selectedLocationId;
        return (
          <g key={layout.locationId}>
            <polygon
              points={hexPoints(layout.center.x, layout.center.y, hexWidth)}
              className={hexFill(current, selected)}
              strokeWidth="3"
            />
            {selected && !current ? selectedMarker(layout.center.x, layout.center.y) : null}
          </g>
        );
      })}

      {geometry.undirectedRoutes.map((route) => (
        <line
          key={`${route.originLocationId}->${route.destinationLocationId}`}
          x1={route.endpoints.start.x}
          y1={route.endpoints.start.y}
          x2={route.endpoints.end.x}
          y2={route.endpoints.end.y}
          className="stroke-[color:var(--rs-accent-secondary)]"
          strokeWidth="3"
          strokeLinecap="round"
        />
      ))}
      {routeProgress ? (
        <line
          data-route-progress
          data-route-start-location={routeProgress.originLocationId}
          data-route-end-location={routeProgress.destinationLocationId}
          x1={routeProgress.routeStart.x}
          y1={routeProgress.routeStart.y}
          x2={routeProgress.progressEnd.x}
          y2={routeProgress.progressEnd.y}
          className="stroke-[color:var(--rs-accent-arcane)]"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function LocalMapPanel() {
  const { state, setState, acquireCommand, releaseCommand, busy, requestAutoRefresh } =
    useMiningPlay();
  const [selected, setSelected] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [now, setNow] = useState(Date.now());
  const [mapGeometry, setMapGeometry] = useState<LocalMapGeometry>(LOCAL_MAP_GEOMETRY);
  const [, startTransition] = useTransition();
  const [transitioning, setTransitioning] = useState(false);
  const observedTravel = useRef(state.travelState?.destinationLocationId);

  const currentLocationId = state.location.currentLocationId;
  const travel = state.travelState;
  const inTransit = Boolean(travel);
  const miningActive = state.activeAction?.actionId === ACTION_IDS.crashSiteMining;

  useEffect(() => {
    function updateMapGeometry() {
      const hexWidth = window.innerWidth < 640 ? MOBILE_LOCAL_MAP_HEX_WIDTH : LOCAL_MAP_HEX_WIDTH;
      setMapGeometry(buildLocalMapGeometry(undefined, hexWidth));
    }
    updateMapGeometry();
    window.addEventListener("resize", updateMapGeometry);
    return () => window.removeEventListener("resize", updateMapGeometry);
  }, []);

  useEffect(() => {
    if (!inTransit) return;
    const clock = window.setInterval(() => setNow(Date.now()), 250);
    const arrivesAt = new Date(travel!.arrivesAt).getTime();
    const delay = Math.max(120, arrivesAt - Date.now() + 150);
    const refresh = window.setTimeout(() => requestAutoRefresh(), delay);
    return () => {
      window.clearInterval(clock);
      window.clearTimeout(refresh);
    };
  }, [inTransit, travel?.arrivesAt, requestAutoRefresh]);

  useEffect(() => {
    if (inTransit) return;
    const previous = observedTravel.current;
    if (previous && previous === currentLocationId) {
      setMessage(`Arrived at ${getLocation(currentLocationId)?.displayName ?? "destination"}.`);
    }
    observedTravel.current = state.travelState?.destinationLocationId;
  }, [inTransit, currentLocationId, state.travelState?.destinationLocationId]);

  function travelTo(destinationId: string) {
    if (!acquireCommand()) return;
    setTransitioning(true);
    startTransition(() => {
      (async () => {
        try {
          const result = await beginTravelAction({
            characterId: state.characterId,
            destinationLocationId: destinationId,
          });
          if (result.error) {
            setMessage(result.error);
            return;
          }
          if (result.state?.travelError) {
            setMessage(travelErrorMessage(result.state.travelError));
            return;
          }
          setState(result.state!);
          setMessage(undefined);
          setSelected(undefined);
        } catch {
          setMessage("Comms interruption. Travel could not be confirmed.");
          requestAutoRefresh();
        } finally {
          setTransitioning(false);
          releaseCommand();
        }
      })();
    });
  }

  function travelErrorMessage(reason: NonNullable<typeof state.travelError>): string {
    return {
      unknown_destination: "That destination is not a known location.",
      same_location: "You are already at that location.",
      not_adjacent: "You can only travel to a directly adjacent location.",
      already_traveling: "You are already traveling. Arrival must complete first.",
      mining_unavailable_here: "Mining is not available at this location.",
    }[reason];
  }

  const transitProgress =
    travel && travel.startedAt && travel.arrivesAt
      ? Math.min(
          100,
          Math.max(
            0,
            ((now - new Date(travel.startedAt).getTime()) /
              (new Date(travel.arrivesAt).getTime() - new Date(travel.startedAt).getTime())) *
              100,
          ),
        )
      : 0;
  const transitRemainingSeconds =
    travel && travel.arrivesAt
      ? Math.max(0, (new Date(travel.arrivesAt).getTime() - now) / 1000)
      : 0;

  const selectedLocation = selected ? getLocation(selected) : undefined;
  const selectedIsDestination = selectedLocation && !inTransit && selected !== currentLocationId;

  // Helper: determine the status label for a location tile.
  function tileStatusLabel(locationId: string): string {
    const loc = getLocation(locationId);
    if (!loc) return "";
    if (locationId === LOCATION_IDS.emergencyPowerAnnex) return "Power Cells daily";
    return loc.availableActionIds.length > 0 ? "Mining available" : "Processing offline";
  }

  // Button positions: each button is positioned to overlay its hex in the SVG.
  // The button's top-left is at (cx - W/2, cy - H/2) and size is W × H.
  function hexButtonStyle(locationId: string): CSSProperties {
    const layout = mapGeometry.layouts.find((candidate) => candidate.locationId === locationId);
    if (!layout) throw new Error(`Missing map layout for ${locationId}`);
    return {
      left: `${layout.center.x - mapGeometry.hexWidth / 2}px`,
      top: `${layout.center.y - mapGeometry.hexHeight / 2}px`,
      width: `${mapGeometry.hexWidth}px`,
      height: `${mapGeometry.hexHeight}px`,
    };
  }

  return (
    <Panel tone="raised">
      <SectionHeader eyebrow="Local area">World map</SectionHeader>
      <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
        Locations are hexes connected by routes. Select a reachable hex to inspect it, then confirm
        to walk there.
      </p>

      {/* Three flat-top hexes form a triangle. The SVG renders complete hex
          outlines and all approved routes; native buttons overlay each hex for
          semantics and text labels. */}
      <div
        className="relative mx-auto mt-4"
        role="group"
        aria-label="Local map"
        style={{ width: `${mapGeometry.width}px`, height: `${mapGeometry.height}px` }}
      >
        <HexMapSvg
          geometry={mapGeometry}
          currentLocationId={currentLocationId}
          selectedLocationId={selected}
          inTransit={inTransit}
          transitProgress={transitProgress}
          travelOriginLocationId={travel?.originLocationId}
          travelDestinationLocationId={travel?.destinationLocationId}
        />
        {mapGeometry.layouts.map((layout) => {
          const location = getLocation(layout.locationId);
          if (!location) return null;
          const isCurrent = location.id === currentLocationId;
          return (
            <HexButton
              key={location.id}
              locationId={location.id}
              name={location.presentation.localMap.label}
              accessibleName={location.displayName}
              description={location.description}
              selected={selected === location.id}
              current={isCurrent}
              transitRole={
                inTransit && travel?.originLocationId === location.id
                  ? "origin"
                  : inTransit && travel?.destinationLocationId === location.id
                    ? "destination"
                    : undefined
              }
              disabled={inTransit}
              onSelect={() => !inTransit && setSelected(location.id)}
              style={hexButtonStyle(location.id)}
            >
              <span
                className={`mt-0.5 font-display text-[10px] uppercase tracking-wide ${
                  isCurrent
                    ? "text-[color:var(--rs-accent-primary)]"
                    : "text-[color:var(--rs-text-secondary)]"
                }`}
              >
                {tileStatusLabel(location.id)}
              </span>
            </HexButton>
          );
        })}
      </div>

      {inTransit ? (
        <div className="mt-4 rounded-sm border border-[color:var(--rs-accent-arcane)] bg-[color:var(--rs-accent-arcane-subtle)] p-3">
          <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-arcane)]">
            In transit
          </p>
          <p className="mt-2 text-sm text-[color:var(--rs-text-primary)]">
            Walking from <strong>{getLocation(travel!.originLocationId)?.displayName}</strong> to{" "}
            <strong>{getLocation(travel!.destinationLocationId)?.displayName}</strong>.
          </p>
          <div className="mt-3">
            <StatusMeter
              label="Journey progress"
              value={transitProgress}
              detail={`${transitRemainingSeconds.toFixed(1)}s remaining`}
            />
          </div>
          <p className="mt-2 text-xs text-[color:var(--rs-text-muted)]">
            Mining stopped before departure. No new activity can begin until you arrive.
          </p>
        </div>
      ) : selectedLocation ? (
        <div className="mt-4 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3">
          <p className="font-display text-sm font-bold text-[color:var(--rs-text-primary)]">
            {selectedLocation.displayName}
          </p>
          <p className="mt-1 text-sm text-[color:var(--rs-text-secondary)]">
            {selectedLocation.description}
          </p>
          {selectedIsDestination ? (
            <div className="mt-3">
              <p className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
                Walking time: {WALK_SECONDS} seconds
              </p>
              {miningActive ? (
                <p className="mt-2 text-xs text-[color:var(--rs-text-secondary)]">
                  Departing resolves your completed Mining work and stops Mining before the journey
                  begins.
                </p>
              ) : null}
              <ActionButton
                className="mt-3"
                disabled={busy || transitioning}
                intent="primary"
                onClick={() => travelTo(selectedLocation.id)}
              >
                Walk to {selectedLocation.displayName} — {WALK_SECONDS} sec
              </ActionButton>
            </div>
          ) : (
            <p className="mt-2 text-xs text-[color:var(--rs-text-secondary)]">
              {selectedLocation.availableActionIds.length > 0
                ? "Mining is available here."
                : selectedLocation.id === LOCATION_IDS.emergencyPowerAnnex
                  ? "Claim five Power Cells here once per Pacific reset day."
                  : "The processing equipment is offline. Refining is not available yet."}
            </p>
          )}
        </div>
      ) : null}

      <p aria-live="polite" className="sr-only">
        {inTransit
          ? `In transit to ${travel ? getLocation(travel.destinationLocationId)?.displayName : ""}. ${transitRemainingSeconds.toFixed(0)} seconds remaining.`
          : message
            ? message
            : ""}
      </p>
      {message && !inTransit ? (
        <Feedback tone={state.travelError ? "danger" : "muted"}>{message}</Feedback>
      ) : null}
    </Panel>
  );
}
