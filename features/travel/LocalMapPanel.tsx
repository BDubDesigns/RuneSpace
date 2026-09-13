"use client";

import { useEffect, useState, useTransition, type CSSProperties } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { ACTION_IDS, GAME_TICK_MS, LOCATION_IDS } from "@/game/config/foundations";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { areLocationsAdjacent, getLocation } from "@/game/content/locations";
import { beginTravelAction } from "@/server/actions";
import { travelErrorMessage } from "./travel-errors";
import { usePlay } from "@/features/play/PlayContext";
import { deriveMissionGuidanceTargets, type MissionGuidanceTargets } from "@/game/domain/missions";
import {
  buildLocalMapGeometry,
  LOCAL_MAP_GEOMETRY,
  LOCAL_MAP_HEX_WIDTH,
  type LocalMapGeometry,
} from "./local-map-layout";
import {
  useLocalMapScrollAffordances,
  type LocalMapScrollAffordances,
  type LocalMapScrollDirection,
} from "./local-map-scroll-affordances";
import { routeProgressSegment } from "./route-progress";
import { resolveMapIdentifierAsset } from "./local-map-identifiers";

const WALK_SECONDS = Math.round(
  (getEffectiveGameBalance().travel.adjacentWalkDurationTicks * GAME_TICK_MS) / 1000,
);

const MAP_STATUS_LABEL_BY_LOCATION: Partial<
  Record<(typeof LOCATION_IDS)[keyof typeof LOCATION_IDS], string>
> = {
  [LOCATION_IDS.emergencyPowerAnnex]: "Daily cells",
  [LOCATION_IDS.abandonedProcessingYard]: "Refining",
  [LOCATION_IDS.theJag]: "Mining",
};

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

/** Inset hex points scaled toward the center — for plated seams and rivets. */
function hexInsetPoints(cx: number, cy: number, w: number, scale: number): string {
  const h = w * (Math.sqrt(3) / 2);
  const verts: [number, number][] = [
    [cx - w / 4, cy - h / 2],
    [cx + w / 4, cy - h / 2],
    [cx + w / 2, cy],
    [cx + w / 4, cy + h / 2],
    [cx - w / 4, cy + h / 2],
    [cx - w / 2, cy],
  ];
  return verts.map(([x, y]) => `${cx + (x - cx) * scale},${cy + (y - cy) * scale}`).join(" ");
}

function hexInsetVertices(
  cx: number,
  cy: number,
  w: number,
  scale: number,
): { x: number; y: number }[] {
  const h = w * (Math.sqrt(3) / 2);
  const verts: [number, number][] = [
    [cx - w / 4, cy - h / 2],
    [cx + w / 4, cy - h / 2],
    [cx + w / 2, cy],
    [cx + w / 4, cy + h / 2],
    [cx - w / 4, cy + h / 2],
    [cx - w / 2, cy],
  ];
  return verts.map(([x, y]) => ({ x: cx + (x - cx) * scale, y: cy + (y - cy) * scale }));
}

// ---------------------------------------------------------------------------
// Hex button layer (native <button> for semantics, transparent over the SVG)
// ---------------------------------------------------------------------------

/**
 * The Mission facts for one World Location hex: an accepted Mission's next
 * work is there (MISSION) and/or a Mission's final handoff is there (TURN IN).
 * Both facts are kept; the ring colour follows the shared precedence (active
 * green over turn-in blue) while the plate text and accessible label name both.
 */
type HexMissionMarker = { mission: boolean; turnIn: boolean };

function missionMarkerFor(
  targets: MissionGuidanceTargets,
  locationId: string,
): HexMissionMarker | undefined {
  const mission = targets.locationIds.has(locationId);
  const turnIn = targets.turnInLocationIds.has(locationId);
  return mission || turnIn ? { mission, turnIn } : undefined;
}

function missionMarkerTone(marker: HexMissionMarker): "active" | "turn_in" {
  return marker.mission ? "active" : "turn_in";
}

type HexButtonProps = {
  locationId: string;
  name: string;
  accessibleName: string;
  statusLabel?: string;
  description: string;
  selected: boolean;
  current: boolean;
  transitRole?: "origin" | "destination";
  disabled: boolean;
  /** Whether this tile is directly reachable from the current location (adjacent). */
  directlyReachable: boolean;
  missionMarker?: HexMissionMarker;
  onSelect: () => void;
  style: CSSProperties;
};

function HexButton({
  locationId,
  name,
  accessibleName,
  statusLabel,
  description,
  selected,
  current,
  transitRole,
  disabled,
  directlyReachable,
  missionMarker,
  onSelect,
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
        : directlyReachable
          ? "Reachable"
          : "Visible";
  const accessibleLabel = [
    accessibleName,
    youAreHere
      ? "You are here."
      : directlyReachable
        ? "Reachable destination."
        : "Visible, not directly reachable.",
    selected && !youAreHere ? "Selected." : "",
    missionMarker?.mission ? "Mission destination." : "",
    missionMarker?.turnIn ? "Mission turn-in." : "",
    disabled ? "Travel in progress; map is read-only." : "",
  ]
    .filter(Boolean)
    .join(" ");
  const missionLabel = missionMarker
    ? [missionMarker.mission ? "Mission" : "", missionMarker.turnIn ? "Turn in" : ""]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  return (
    <button
      type="button"
      aria-pressed={selected && !youAreHere}
      aria-current={youAreHere ? "true" : undefined}
      aria-label={accessibleLabel}
      aria-describedby={`loc-desc-${locationId}`}
      data-map-location={locationId}
      data-mission-guidance={missionMarker ? missionMarkerTone(missionMarker) : undefined}
      data-map-mission={missionMarker?.mission ? "true" : undefined}
      data-map-turn-in={missionMarker?.turnIn ? "true" : undefined}
      disabled={disabled}
      onClick={onSelect}
      style={style}
      className="rs-focus group absolute z-10 flex flex-col items-center justify-between py-1.5 text-center outline-none transition disabled:cursor-not-allowed disabled:opacity-70 motion-safe:transition-transform motion-safe:hover:scale-[1.025]"
    >
      {/* Zone 1: Top state plate — mounted plaque, fitted. YOU ARE HERE
          never truncates; may slightly overhang hex (inline-flex, no max). */}
      <span
        aria-hidden="true"
        className="rs-map-plate rs-map-plate--state relative z-10 inline-flex max-w-none items-center justify-center whitespace-nowrap px-2 py-0.5 font-display text-[8px] font-bold uppercase tracking-[0.16em]"
        data-map-state
      >
        {stateLabel}
      </span>
      {/* Dedicated artwork zone spacer — keeps state high and nameplate low so
          the SVG identifier (Layer 2) has a clear middle band to occupy */}
      <span
        aria-hidden="true"
        className="relative block h-[44px] w-full shrink-0"
        data-map-artwork-spacer
      >
        {/* Mission marker overlays the artwork band so no hex zone moves. The
            wrapper positions it: .rs-map-plate sets its own position. */}
        {missionMarker && missionLabel ? (
          <span className="absolute inset-x-0 bottom-0.5 z-10 flex justify-center">
            <span
              className="rs-map-plate rs-map-plate--mission inline-flex items-center justify-center whitespace-nowrap px-1.5 py-0.5 font-display text-[8px] font-bold uppercase leading-none tracking-[0.12em]"
              data-map-mission-marker={missionMarkerTone(missionMarker)}
            >
              {missionLabel}
            </span>
          </span>
        ) : null}
      </span>
      {/* Lower cluster: nameplate toward lower portion + status */}
      <span className="flex w-full flex-col items-center gap-0.5">
        <span
          className="rs-map-plate rs-map-plate--nameplate relative z-10 inline-flex max-w-[66%] items-center justify-center break-words px-2 py-0.5 text-center font-display text-[11px] font-bold leading-tight"
          data-map-nameplate
        >
          {name}
        </span>
        <span id={`loc-desc-${locationId}`} className="sr-only">
          {description}
        </span>
        {statusLabel ? (
          <span
            aria-hidden="true"
            className="rs-map-plate rs-map-plate--status relative z-10 inline-flex max-w-[68%] items-center justify-center truncate px-1.5 py-0.5 font-display text-[8px] uppercase leading-none tracking-[0.08em]"
            data-map-status
          >
            {statusLabel}
          </span>
        ) : null}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// SVG visual layer: hex chassis (Layer 1), decorative identifiers (Layer 2),
// routes + progress — all without changing polygon bounds / touch targets
// ---------------------------------------------------------------------------

function HexMapSvg({
  geometry,
  currentLocationId,
  selectedLocationId,
  inTransit,
  transitProgress,
  travelOriginLocationId,
  travelDestinationLocationId,
  missionTargets,
}: {
  geometry: LocalMapGeometry;
  currentLocationId: string;
  selectedLocationId?: string;
  inTransit: boolean;
  transitProgress: number;
  travelOriginLocationId?: (typeof LOCATION_IDS)[keyof typeof LOCATION_IDS];
  travelDestinationLocationId?: (typeof LOCATION_IDS)[keyof typeof LOCATION_IDS];
  missionTargets: MissionGuidanceTargets;
}) {
  const hexWidth = geometry.hexWidth;
  const hexHeight = geometry.hexHeight;
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
      {/* Hexes: Layer 1 (chassis) + Layer 2 (decorative identifier) */}
      {geometry.layouts.map((layout) => {
        const current = layout.locationId === currentLocationId;
        const selected = layout.locationId === selectedLocationId;
        const cx = layout.center.x;
        const cy = layout.center.y;
        const location = getLocation(layout.locationId);
        const identifierHref = location
          ? resolveMapIdentifierAsset(location.presentation.mapIconKey)
          : undefined;
        // Visual correction: dedicated artwork zone between top state label and
        // lower nameplate. Substantially larger than 0.60W×0.62H@0.32 — now
        // 0.72W×0.68H with contain, opacity 0.58, centered slightly above hex
        // center so the lower nameplate (pushed low via justify-between + spacer)
        // overlaps minimally. At MOBILE 140 / desktop 128 the tight-cropped 512
        // WebPs paint at ~71.5% / 61.7% / 64% (crash/processing/power) — plainly
        // recognizable yet subordinate to state/name/status plates. Not full-bleed.
        const identifierW = hexWidth * 0.72;
        const identifierH = hexHeight * 0.68;
        const identifierX = cx - identifierW / 2;
        // Center the artwork in the dedicated middle band: slightly above hex
        // center (~6% H) so the lower nameplate zone stays clear.
        const identifierY = cy - identifierH / 2 - hexHeight * 0.06;
        const rivets = hexInsetVertices(cx, cy, hexWidth, 0.91);
        const clipId = `hex-clip-${layout.locationId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
        const missionMarker = missionMarkerFor(missionTargets, layout.locationId);

        return (
          <g key={layout.locationId}>
            {/* Mission ring: outside the chassis stroke, so current/selected
                stay legible; shared green/blue Mission tokens and glow. */}
            {missionMarker ? (
              <polygon
                className="rs-map-mission-ring"
                data-map-mission-ring={missionMarkerTone(missionMarker)}
                fill="none"
                points={hexPoints(cx, cy, hexWidth + 12)}
                strokeWidth="4"
              />
            ) : null}
            {/* Layer 1: shared plated chassis — outer hex fill unchanged */}
            <polygon
              data-map-hex={layout.locationId}
              points={hexPoints(cx, cy, hexWidth)}
              className={hexFill(current, selected)}
              strokeWidth="3"
            />
            {/* Inset panel seam — subtle inner border */}
            <polygon
              points={hexInsetPoints(cx, cy, hexWidth, 0.92)}
              fill="none"
              stroke="var(--rs-border-subtle)"
              strokeWidth="1"
              opacity="0.55"
              strokeOpacity="0.7"
            />
            {/* Secondary inner line for worn plating depth */}
            <polygon
              points={hexInsetPoints(cx, cy, hexWidth, 0.88)}
              fill="none"
              stroke="var(--rs-border-structural)"
              strokeWidth="0.7"
              opacity="0.28"
            />
            {/* Rivets — tiny circles at inset corners, restrained */}
            <g aria-hidden="true" opacity="0.42">
              {rivets.map((pt, idx) => (
                <circle
                  key={`${layout.locationId}-rivet-${idx}`}
                  data-map-rivet
                  cx={pt.x}
                  cy={pt.y}
                  r={Math.max(1, hexWidth * 0.012)}
                  fill="var(--rs-border-structural)"
                  stroke="var(--rs-surface-raised)"
                  strokeWidth="0.5"
                  opacity="0.9"
                />
              ))}
            </g>

            {/* Layer 2: decorative identifier — clipped to hex, dedicated zone */}
            {identifierHref ? (
              <g aria-hidden="true">
                <defs>
                  <clipPath id={clipId}>
                    <polygon points={hexPoints(cx, cy, hexWidth)} />
                  </clipPath>
                </defs>
                <g clipPath={`url(#${clipId})`}>
                  <image
                    href={identifierHref}
                    x={identifierX}
                    y={identifierY}
                    width={identifierW}
                    height={identifierH}
                    preserveAspectRatio="xMidYMid meet"
                    opacity="0.58"
                    aria-hidden="true"
                  />
                </g>
              </g>
            ) : null}

            {selected && !current ? selectedMarker(cx, cy) : null}
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

const LOCAL_MAP_SCROLL_DIRECTIONS: readonly LocalMapScrollDirection[] = [
  "left",
  "right",
  "top",
  "bottom",
];

function LocalMapScrollAffordanceLayer({
  affordances,
}: {
  affordances: LocalMapScrollAffordances;
}) {
  return (
    <div
      aria-hidden="true"
      className="rs-map-scroll-affordance-layer"
      data-map-scroll-affordance-layer
    >
      {LOCAL_MAP_SCROLL_DIRECTIONS.map((direction) =>
        affordances[direction] ? (
          <span
            key={direction}
            className={`rs-map-scroll-affordance rs-map-scroll-affordance--${direction}`}
            data-map-scroll-affordance={direction}
          />
        ) : null,
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function LocalMapPanel({
  onBack,
  onTravelStarted,
}: {
  onBack?: () => void;
  onTravelStarted?: () => void;
}) {
  const {
    state,
    acceptState,
    acquireCommand,
    enqueueForeground,
    releaseCommand,
    foregroundBusy: busy,
    requestAutoRefresh,
  } = usePlay();
  const [selected, setSelected] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [now, setNow] = useState(Date.now());
  const [mapGeometry, setMapGeometry] = useState<LocalMapGeometry>(LOCAL_MAP_GEOMETRY);
  const [, startTransition] = useTransition();
  const [transitioning, setTransitioning] = useState(false);
  const { viewportRef: localMapViewportRef, affordances: localMapAffordances } =
    useLocalMapScrollAffordances(true);

  const currentLocationId = state.location.currentLocationId;
  // Accepted Missions only: available offers never reach the map.
  const missionTargets = deriveMissionGuidanceTargets(state.missions);
  const travel = state.travelState;
  const inTransit = Boolean(travel);
  const workActive = Boolean(state.activeAction);

  useEffect(() => {
    function updateMapGeometry() {
      setMapGeometry(buildLocalMapGeometry(undefined, LOCAL_MAP_HEX_WIDTH));
    }
    updateMapGeometry();
    window.addEventListener("resize", updateMapGeometry);
    return () => window.removeEventListener("resize", updateMapGeometry);
  }, []);

  useEffect(() => {
    if (!inTransit) return;
    const clock = window.setInterval(() => setNow(Date.now()), 250);
    return () => {
      window.clearInterval(clock);
    };
  }, [inTransit]);

  function travelTo(destinationId: string) {
    const execute = () => {
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
            acceptState(result.state!);
            setMessage(undefined);
            setSelected(undefined);
            onTravelStarted?.();
          } catch {
            setMessage("Comms interruption. Travel could not be confirmed.");
            requestAutoRefresh();
          } finally {
            setTransitioning(false);
            releaseCommand();
          }
        })();
      });
    };
    enqueueForeground(execute);
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
  const selectedLocation = selected ? getLocation(selected) : undefined;
  const selectedIsDirectlyReachable =
    selectedLocation && !inTransit && areLocationsAdjacent(currentLocationId, selectedLocation.id);
  const selectedIsDestination = selectedIsDirectlyReachable && selected !== currentLocationId;
  function tileStatusLabel(
    locationId: (typeof LOCATION_IDS)[keyof typeof LOCATION_IDS],
  ): string | undefined {
    return MAP_STATUS_LABEL_BY_LOCATION[locationId];
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
      <div className="flex items-start justify-between gap-2">
        <SectionHeader eyebrow="Local area">Map</SectionHeader>
        {onBack ? (
          <ActionButton className="shrink-0 px-3" intent="secondary" onClick={onBack}>
            {inTransit ? "Back to Journey" : "Back to Location"}
          </ActionButton>
        ) : null}
      </div>
      <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
        Locations are hexes connected by routes. Select a reachable hex to inspect it, then confirm
        to walk there.
      </p>

      {/* Five flat-top hexes form the local map. The SVG renders plated chassis,
          decorative identifiers, and all approved routes; native buttons overlay
          each hex for semantics and text labels. */}
      <div className="relative -mx-1">
        <div ref={localMapViewportRef} className="overflow-auto px-1 pb-1" data-map-scroll-viewport>
          <div
            className="relative mx-auto"
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
              missionTargets={missionTargets}
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
                  statusLabel={tileStatusLabel(location.id)}
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
                  directlyReachable={
                    areLocationsAdjacent(currentLocationId, location.id) || isCurrent
                  }
                  missionMarker={missionMarkerFor(missionTargets, location.id)}
                  onSelect={() => !inTransit && setSelected(location.id)}
                  style={hexButtonStyle(location.id)}
                />
              );
            })}
          </div>
        </div>
        <LocalMapScrollAffordanceLayer affordances={localMapAffordances} />
      </div>

      {selectedLocation ? (
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
              {workActive ? (
                <p className="mt-2 text-xs text-[color:var(--rs-text-secondary)]">
                  Departing resolves your completed work and stops the active activity before the
                  journey begins.
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
          ) : selectedLocation && !selectedIsDirectlyReachable && selected !== currentLocationId ? (
            <p className="mt-2 text-xs text-[color:var(--rs-text-secondary)]">
              Not directly reachable from here.
            </p>
          ) : (
            <p className="mt-2 text-xs text-[color:var(--rs-text-secondary)]">
              {selectedLocation?.availableActionIds.includes(ACTION_IDS.refining)
                ? "Refining is available here — feed Ferrite Shale to produce Refined Ferrite or Slag."
                : selectedLocation?.availableActionIds.includes(ACTION_IDS.ferriteShaleMining)
                  ? "Mining is available here."
                  : selectedLocation?.id === LOCATION_IDS.emergencyPowerAnnex
                    ? "Claim five Power Cells here once per Pacific reset day."
                    : selectedLocation?.id === LOCATION_IDS.theLongScramble
                      ? "No production activity — this is the barren traversal to The Jag."
                      : "No production activity is available here."}
            </p>
          )}
        </div>
      ) : null}

      <p aria-live="polite" className="sr-only">
        {message ?? ""}
      </p>
      {message ? (
        <Feedback tone={state.travelError ? "danger" : "muted"}>{message}</Feedback>
      ) : null}
    </Panel>
  );
}
