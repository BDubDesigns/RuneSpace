"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { ACTION_IDS, GAME_TICK_MS, LOCATION_IDS } from "@/game/config/foundations";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { LOCATIONS, getLocation } from "@/game/content/locations";
import { beginTravelAction } from "@/server/actions";
import { useMiningPlay } from "@/features/mining/MiningPlayContext";

const WALK_SECONDS = Math.round(
  (getEffectiveGameBalance().travel.adjacentWalkDurationTicks * GAME_TICK_MS) / 1000,
);

// ---------------------------------------------------------------------------
// Flat-top regular hexagon geometry (issue #40 two-hex local map)
// ---------------------------------------------------------------------------
// For a regular flat-top hexagon of width W:
//   height H = W × √3/2 = W × 0.8660254
//
// Vertices (centered at origin):
//   top-left     (-W/4, -H/2)     top-right   ( W/4, -H/2)
//   right        ( W/2,    0 )    bottom-right( W/4,  H/2)
//   bottom-left  (-W/4,  H/2)     left        (-W/2,   0 )
//
// Diagonal-neighbor center offset:
//   Δx = 0.75 × W    (75% of hex width to the right)
//   Δy = 0.50 × H    (50% of hex height upward)
//
// Crash Site = lower-left hex; Processing Yard = upper-right hex.

const HEX_ASPECT = 0.8660254;
const HEX_W = 140;
const HEX_H = HEX_W * HEX_ASPECT;
// Base diagonal-neighbor offset: 75% width, 50% height.
const BASE_OFFSET_X = HEX_W * 0.75;
const BASE_OFFSET_Y = HEX_H * 0.5;
// Add EDGE_GAP along the diagonal direction so the facing angled edges
// are visibly separated with room for a short route bridge.
const _diagLen = Math.sqrt(BASE_OFFSET_X ** 2 + BASE_OFFSET_Y ** 2);
const EDGE_GAP = 14;
const GAP_SCALE = EDGE_GAP / _diagLen;
const OFFSET_X = BASE_OFFSET_X + BASE_OFFSET_X * GAP_SCALE;
const OFFSET_Y = BASE_OFFSET_Y + BASE_OFFSET_Y * GAP_SCALE;
const PAD = 14;

// Composition bounding box (SVG viewBox + container size).
const COMP_W = PAD * 2 + HEX_W + OFFSET_X;
// Y span: from bottom of Crash Site to top of Processing Yard.
const COMP_H = PAD * 2 + HEX_H + OFFSET_Y;

// Center coordinates of each hex within the composition.
const CRASH_CX = PAD + HEX_W / 2;
const CRASH_CY = COMP_H - PAD - HEX_H / 2;
const YARD_CX = CRASH_CX + OFFSET_X;
const YARD_CY = CRASH_CY - OFFSET_Y;

/** Flat-top hex vertex points as an SVG polygon string. */
function hexPoints(cx: number, cy: number, w: number): string {
  const h = w * HEX_ASPECT;
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

/** Midpoint of Crash Site's upper-right angled edge (top-right → right). */
function crashEdgeMid(): [number, number] {
  const h = HEX_H;
  return [(HEX_W / 4 + HEX_W / 2) / 2, (-h / 2 + 0) / 2];
}

/** Midpoint of Processing Yard's lower-left angled edge (left → bottom-left). */
function yardEdgeMid(): [number, number] {
  const h = HEX_H;
  return [(-HEX_W / 2 - HEX_W / 4) / 2, (0 + h / 2) / 2];
}

// Route line endpoints: connect edge midpoints directly. The centers are
// inflated by EDGE_GAP along the diagonal so the edge midpoints are already
// EDGE_GAP apart, creating a visible gap plus a short diagonal bridge.
const [rawRouteX1, rawRouteY1] = crashEdgeMid();
const [rawRouteX2, rawRouteY2] = yardEdgeMid();
const ROUTE_X1 = CRASH_CX + rawRouteX1;
const ROUTE_Y1 = CRASH_CY + rawRouteY1;
const ROUTE_X2 = YARD_CX + rawRouteX2;
const ROUTE_Y2 = YARD_CY + rawRouteY2;

// ---------------------------------------------------------------------------
// Hex button layer (native <button> for semantics, transparent over the SVG)
// ---------------------------------------------------------------------------

type HexButtonProps = {
  locationId: string;
  name: string;
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
  const accessibleName = [
    name,
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
      aria-label={accessibleName}
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
// SVG visual layer: hex outlines, state markers, diagonal route
// ---------------------------------------------------------------------------

function HexMapSvg({
  crashCurrent,
  yardCurrent,
  crashSelected,
  yardSelected,
  crashTransitRole,
  yardTransitRole,
  inTransit,
  transitProgress,
}: {
  crashCurrent: boolean;
  yardCurrent: boolean;
  crashSelected: boolean;
  yardSelected: boolean;
  crashTransitRole?: "origin" | "destination";
  yardTransitRole?: "origin" | "destination";
  inTransit: boolean;
  transitProgress: number;
}) {
  const crashPoints = hexPoints(CRASH_CX, CRASH_CY, HEX_W);
  const yardPoints = hexPoints(YARD_CX, YARD_CY, HEX_W);

  const hexFill = (current: boolean, selected: boolean) =>
    current
      ? "fill-[color:var(--rs-accent-primary-subtle)] stroke-[color:var(--rs-accent-primary)]"
      : selected
        ? "fill-[color:var(--rs-accent-mining-subtle)] stroke-[color:var(--rs-accent-mining)]"
        : "fill-[color:var(--rs-surface-raised)] stroke-[color:var(--rs-border-structural)]";

  const selectedMarker = (cx: number, cy: number) => (
    <path
      d={`M ${cx + HEX_W * 0.28} ${cy - HEX_W * 0.22} L ${cx + HEX_W * 0.34} ${cy - HEX_W * 0.15} L ${cx + HEX_W * 0.42} ${cy - HEX_W * 0.27}`}
      fill="none"
      stroke="var(--rs-accent-mining)"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );

  const transitDot = (cx: number, cy: number, role?: "origin" | "destination") =>
    role ? (
      <circle
        cx={cx + (role === "origin" ? -HEX_W * 0.35 : HEX_W * 0.35)}
        cy={cy}
        r="4"
        className="fill-[color:var(--rs-accent-arcane)]"
      />
    ) : null;

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${COMP_W} ${COMP_H}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Hexes first (route drawn after for contrast) */}
      <polygon
        points={crashPoints}
        className={hexFill(crashCurrent, crashSelected)}
        strokeWidth="3"
      />
      {crashSelected && !crashCurrent ? selectedMarker(CRASH_CX, CRASH_CY) : null}
      {transitDot(CRASH_CX, CRASH_CY, crashTransitRole)}

      <polygon points={yardPoints} className={hexFill(yardCurrent, yardSelected)} strokeWidth="3" />
      {yardSelected && !yardCurrent ? selectedMarker(YARD_CX, YARD_CY) : null}
      {transitDot(YARD_CX, YARD_CY, yardTransitRole)}

      {/* Diagonal route segment bridging the nearest angled edges (drawn
          after hexes for visibility). Uses a brighter structural color. */}
      <line
        x1={ROUTE_X1}
        y1={ROUTE_Y1}
        x2={ROUTE_X2}
        y2={ROUTE_Y2}
        className="stroke-[color:var(--rs-accent-secondary)]"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {inTransit ? (
        <line
          x1={ROUTE_X1}
          y1={ROUTE_Y1}
          x2={ROUTE_X1 + (ROUTE_X2 - ROUTE_X1) * (transitProgress / 100)}
          y2={ROUTE_Y1 + (ROUTE_Y2 - ROUTE_Y1) * (transitProgress / 100)}
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
  const [, startTransition] = useTransition();
  const [transitioning, setTransitioning] = useState(false);
  const observedTravel = useRef(state.travelState?.destinationLocationId);

  const currentLocationId = state.location.currentLocationId;
  const travel = state.travelState;
  const inTransit = Boolean(travel);
  const miningActive = state.activeAction?.actionId === ACTION_IDS.crashSiteMining;

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
    return loc.availableActionIds.length > 0 ? "Mining available" : "Processing offline";
  }

  // Button positions: each button is positioned to overlay its hex in the SVG.
  // The button's top-left is at (cx - W/2, cy - H/2) and size is W × H.
  const crashBtnStyle: CSSProperties = {
    left: `${CRASH_CX - HEX_W / 2}px`,
    top: `${CRASH_CY - HEX_H / 2}px`,
    width: `${HEX_W}px`,
    height: `${HEX_H}px`,
  };
  const yardBtnStyle: CSSProperties = {
    left: `${YARD_CX - HEX_W / 2}px`,
    top: `${YARD_CY - HEX_H / 2}px`,
    width: `${HEX_W}px`,
    height: `${HEX_H}px`,
  };

  return (
    <Panel tone="raised">
      <SectionHeader eyebrow="Local area">World map</SectionHeader>
      <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
        Locations are hexes connected by routes. Select a reachable hex to inspect it, then confirm
        to walk there.
      </p>

      {/* Two-hex diagonal map. Crash Site is lower-left; Processing Yard is
          upper-right. The SVG renders complete hex outlines and a diagonal
          route; native <button> elements overlay each hex for semantics
          and text labels. */}
      <div
        className="relative mx-auto mt-4"
        role="group"
        aria-label="Local map"
        style={{ width: `${COMP_W}px`, height: `${COMP_H}px` }}
      >
        <HexMapSvg
          crashCurrent={currentLocationId === LOCATION_IDS.crashSite}
          yardCurrent={currentLocationId === LOCATION_IDS.abandonedProcessingYard}
          crashSelected={selected === LOCATION_IDS.crashSite}
          yardSelected={selected === LOCATION_IDS.abandonedProcessingYard}
          crashTransitRole={
            inTransit && travel?.originLocationId === LOCATION_IDS.crashSite
              ? "origin"
              : inTransit && travel?.destinationLocationId === LOCATION_IDS.crashSite
                ? "destination"
                : undefined
          }
          yardTransitRole={
            inTransit && travel?.originLocationId === LOCATION_IDS.abandonedProcessingYard
              ? "origin"
              : inTransit && travel?.destinationLocationId === LOCATION_IDS.abandonedProcessingYard
                ? "destination"
                : undefined
          }
          inTransit={inTransit}
          transitProgress={transitProgress}
        />
        {LOCATIONS.map((location) => {
          const isCrash = location.id === LOCATION_IDS.crashSite;
          const isCurrent = location.id === currentLocationId;
          return (
            <HexButton
              key={location.id}
              locationId={location.id}
              name={location.displayName}
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
              style={isCrash ? crashBtnStyle : yardBtnStyle}
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
            Mining and other actions are paused until you arrive.
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
