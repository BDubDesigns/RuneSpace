"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type RefObject,
} from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { ACTION_IDS, GAME_TICK_MS, LOCATION_IDS } from "@/game/config/foundations";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { getLocation } from "@/game/content/locations";
import type { LocationPopulationEntry } from "@/game/domain/location-population";
import { beginTravelAction } from "@/server/actions";
import { useMiningPlay } from "@/features/mining/MiningPlayContext";
import { COLLAPSE_KEYS, useSyncedCollapse } from "@/features/shared/use-synced-collapse";
import { CollapseButton } from "@/features/shared/CollapseButton";
import { CharacterProfilePanel } from "./CharacterProfilePanel";
import {
  buildLocalMapGeometry,
  LOCAL_MAP_GEOMETRY,
  LOCAL_MAP_HEX_WIDTH,
  type LocalMapGeometry,
} from "./local-map-layout";
import { routeProgressSegment } from "./route-progress";
import { resolveMapIdentifierAsset } from "./local-map-identifiers";

const WALK_SECONDS = Math.round(
  (getEffectiveGameBalance().travel.adjacentWalkDurationTicks * GAME_TICK_MS) / 1000,
);

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

type HexButtonProps = {
  locationId: string;
  name: string;
  accessibleName: string;
  statusLabel: string;
  description: string;
  selected: boolean;
  current: boolean;
  /** Other characters at this location (only the current tile shows them). */
  populationCount: number;
  transitRole?: "origin" | "destination";
  disabled: boolean;
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
  populationCount,
  transitRole,
  disabled,
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
        : "Reachable";
  const accessibleLabel = [
    accessibleName,
    youAreHere ? "You are here." : "Reachable destination.",
    youAreHere && populationCount > 0
      ? `${populationCount} other ${populationCount === 1 ? "character" : "characters"} here.`
      : "",
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
      data-map-location={locationId}
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
      <span aria-hidden="true" className="block h-[44px] w-full shrink-0" data-map-artwork-spacer />
      {/* Lower cluster: nameplate toward lower portion + population + status */}
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
        {current && populationCount > 0 ? (
          <span
            aria-hidden="true"
            className="rs-map-plate rs-map-plate--population relative z-10 inline-flex max-w-[58%] items-center justify-center truncate px-1.5 py-0.5 font-display text-[8px] uppercase leading-none tracking-[0.08em]"
            data-map-population
          >
            {populationCount} here
          </span>
        ) : null}
        <span
          aria-hidden="true"
          className="rs-map-plate rs-map-plate--status relative z-10 inline-flex max-w-[68%] items-center justify-center truncate px-1.5 py-0.5 font-display text-[8px] uppercase leading-none tracking-[0.08em]"
          data-map-status
        >
          {statusLabel}
        </span>
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

        return (
          <g key={layout.locationId}>
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

// ---------------------------------------------------------------------------
// Location population disclosure (issue #62) and character rows (issue #64)
// ---------------------------------------------------------------------------

/**
 * Small disclosure/affordance chevron drawn with the repository's inline-SVG
 * technique (the map layer uses inline SVG; there is no icon font). Rotating
 * it (or leaving it static) is the caller's choice via `className`.
 */
function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 16 16"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

/**
 * Compact disclosure trigger associated with the current-location tile. The
 * tile's hex button shows the aria-hidden count indicator; this header
 * control reveals the full public list (character name, derived level, owner
 * name) fetched from the server's narrow read boundary. The visible label is
 * \"Characters here\" — the entries are characters, not unique players, because
 * multiple listed characters may share one owner — with a compact count badge
 * and a disclosure chevron. The accessible label states the action truthfully
 * (\"Show N characters here\" / \"Hide characters here\").
 *
 * This is a deliberately compact control (not the ActionButton primitive,
 * whose fixed `px-4 gap-2` metrics would push the panel header's \"World map\"
 * heading onto a second line and break the yard page's no-scroll layout
 * contract at the canonical viewport). It reuses the secondary intent tokens
 * and the shared rs-focus/rs-bevel treatments.
 */
function LocationPopulationTrigger({
  count,
  open,
  onToggle,
  triggerRef,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      aria-controls="location-population-list"
      aria-expanded={open}
      aria-label={
        open
          ? "Hide characters here"
          : `Show ${count} ${count === 1 ? "character" : "characters"} here`
      }
      className={`rs-bevel rs-focus inline-flex min-h-[var(--rs-touch-target)] shrink-0 items-center justify-center gap-1.5 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] px-2 text-sm font-semibold text-[color:var(--rs-text-primary)] outline-none transition duration-[var(--rs-duration-fast)] hover:border-[color:var(--rs-accent-secondary)]`}
      onClick={onToggle}
      ref={triggerRef}
      type="button"
    >
      <span className="tracking-tight">Characters here</span>
      <span
        aria-hidden="true"
        className="min-w-4 rounded-sm border border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-accent-primary-subtle)] px-0.5 py-0.5 text-center font-display text-[10px] leading-none text-[color:var(--rs-accent-primary)]"
        data-population-count
      >
        {count}
      </span>
      <ChevronIcon
        className={`h-3 w-3 shrink-0 text-[color:var(--rs-text-secondary)] motion-safe:transition-transform ${
          open ? "rotate-180" : ""
        }`}
      />
    </button>
  );
}

/**
 * The revealed population list, rendered directly below the map. It stays
 * mounted (hidden when closed) so the disclosure trigger's `aria-controls`
 * always references an existing region; content renders only for the
 * location the entries were fetched for. Each character entry is a deliberate
 * interactive row (issue #64): the character name is the strongest text, the
 * public owner name sits underneath, the derived overall level is a compact
 * badge, and a chevron communicates that the row opens a profile. The row of
 * the character whose profile is open stays visibly selected (gold accent
 * border, tinted background, and a \"Viewing\" indicator — never color alone),
 * transfers immediately when another row is selected, and unselects when the
 * panel closes or is invalidated.
 *
 * Row structure: each row button is wrapped in a plain divider div. The
 * container's `divide-y` treatment applies the inter-row separator to the
 * wrappers, never to the buttons, so the wrapper's top border can never
 * recolor the button's own left selection rail — selected rows look identical
 * whether they are first, middle, or last, and unselected rows show no stray
 * vertical line.
 */
function LocationPopulationList({
  entries,
  error,
  matchesLocation,
  open,
  profileTarget,
  onOpenProfile,
}: {
  entries: readonly LocationPopulationEntry[];
  error?: string;
  matchesLocation: boolean;
  open: boolean;
  /** Display name of the character whose profile is currently open, if any. */
  profileTarget?: string;
  onOpenProfile: (displayName: string, trigger: HTMLButtonElement) => void;
}) {
  return (
    <div
      id="location-population-list"
      className="mt-4 divide-y divide-[color:var(--rs-border-subtle)] border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-1.5"
      hidden={!open}
    >
      {!matchesLocation ? null : error ? (
        <Feedback tone="muted">{error}</Feedback>
      ) : entries.length === 0 ? (
        <p className="px-2 py-2 text-sm text-[color:var(--rs-text-secondary)]">
          No other characters here
        </p>
      ) : (
        entries.map((entry) => {
          const selected = profileTarget === entry.displayName;
          return (
            <div key={entry.displayName}>
              <button
                aria-controls="character-profile-panel"
                aria-expanded={selected}
                aria-label={`${entry.displayName}, Level ${entry.level}, player ${entry.ownerName}`}
                className={`rs-focus flex min-h-[var(--rs-touch-target)] w-full items-center gap-3 border-l-2 px-2 py-2 text-left outline-none motion-safe:transition-colors ${
                  selected
                    ? "border-[color:var(--rs-accent-mining)] bg-[color:var(--rs-accent-mining-hover)]"
                    : "border-transparent hover:bg-[color:var(--rs-accent-mining-subtle)] active:bg-[color:var(--rs-accent-mining-hover)]"
                }`}
                onClick={(event) => onOpenProfile(entry.displayName, event.currentTarget)}
                type="button"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate font-display text-sm font-bold text-[color:var(--rs-text-primary)]">
                      {entry.displayName}
                    </span>
                    {selected ? (
                      <span className="shrink-0 font-display text-[9px] uppercase tracking-[0.14em] text-[color:var(--rs-accent-mining)]">
                        Viewing
                      </span>
                    ) : null}
                  </span>
                  <span className="truncate text-xs text-[color:var(--rs-text-secondary)]">
                    Player: {entry.ownerName}
                  </span>
                </span>
                <span
                  className={`shrink-0 border px-1.5 py-0.5 font-display text-[10px] uppercase leading-none tracking-[0.08em] ${
                    selected
                      ? "border-[color:var(--rs-accent-mining)] bg-[color:var(--rs-accent-mining-subtle)] text-[color:var(--rs-accent-mining)]"
                      : "border-[color:var(--rs-item-plate-border)] bg-[color:var(--rs-item-plate-surface)] text-[color:var(--rs-text-secondary)]"
                  }`}
                >
                  Lv {entry.level}
                </span>
                <ChevronIcon
                  className={`h-3 w-3 shrink-0 ${
                    selected
                      ? "text-[color:var(--rs-accent-mining)]"
                      : "text-[color:var(--rs-text-muted)]"
                  }`}
                />
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function LocalMapPanel() {
  const {
    state,
    acceptState,
    acquireCommand,
    releaseCommand,
    foregroundBusy: busy,
    requestAutoRefresh,
  } = useMiningPlay();
  const [selected, setSelected] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [now, setNow] = useState(Date.now());
  const [mapGeometry, setMapGeometry] = useState<LocalMapGeometry>(LOCAL_MAP_GEOMETRY);
  const [, startTransition] = useTransition();
  const [transitioning, setTransitioning] = useState(false);
  const observedTravel = useRef(state.travelState?.destinationLocationId);
  const [population, setPopulation] = useState<readonly LocationPopulationEntry[]>([]);
  const [populationLocationId, setPopulationLocationId] = useState<string | undefined>();
  const [populationError, setPopulationError] = useState<string | undefined>();
  const [populationOpen, setPopulationOpen] = useState(false);
  const populationRequest = useRef(0);
  const { collapsed: mapCollapsed, toggle: toggleMapCollapsed } = useSyncedCollapse(
    COLLAPSE_KEYS.worldMap,
  );
  // One shared profile panel (issue #64): only the selected target's display
  // name is state; the panel stays mounted so every entry's aria-controls
  // stays valid, and switching targets updates the same panel. The trigger
  // ref receives the button that opened the current view so closing returns
  // focus predictably to it.
  const [profileTarget, setProfileTarget] = useState<string | undefined>();
  const profileTriggerRef = useRef<HTMLButtonElement>(null);
  const profilePanelRef = useRef<HTMLElement>(null);
  // Persistent fallback focus target: the population disclosure trigger is
  // always mounted and visible, so focus can never end up on a hidden or
  // removed list button when a profile closes or is invalidated.
  const populationTriggerRef = useRef<HTMLButtonElement>(null);

  const currentLocationId = state.location.currentLocationId;
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

  useEffect(() => {
    if (inTransit) return;
    const previous = observedTravel.current;
    if (previous && previous === currentLocationId) {
      setMessage(`Arrived at ${getLocation(currentLocationId)?.displayName ?? "destination"}.`);
    }
    observedTravel.current = state.travelState?.destinationLocationId;
  }, [inTransit, currentLocationId, state.travelState?.destinationLocationId]);

  // When the authoritative location changes, immediately drop the previous
  // location's population and collapse the disclosure: the old tile's entries
  // must never render on the new tile, not even for a single frame or while a
  // replacement read is in flight. The open profile panel is invalidated the
  // same way; if focus is inside the panel it is moved to the population
  // disclosure BEFORE the panel hides, so focus never lands on a hidden
  // control.
  useEffect(() => {
    setPopulationOpen(false);
    setPopulation([]);
    setPopulationLocationId(undefined);
    const active = document.activeElement;
    if (active instanceof Node && profilePanelRef.current?.contains(active)) {
      populationTriggerRef.current?.focus();
    }
    setProfileTarget(undefined);
  }, [currentLocationId]);

  // The population read is scoped to the owned active character server-side.
  // It revalidates on every accepted authoritative gameplay revision (initial
  // load, Refresh status, Mining commands, Travel arrival) through the
  // existing state boundary — no polling, presence, or real-time system. A
  // request generation token discards completions that raced a newer one.
  // The read is a plain route-handler GET: server-action responses carry
  // flight revalidation that can corrupt the Next.js Router when a read fires
  // during error-boundary recovery.
  useEffect(() => {
    const locationId = currentLocationId;
    const token = populationRequest.current + 1;
    populationRequest.current = token;
    fetch(`/api/location-population?characterId=${encodeURIComponent(state.characterId)}`, {
      headers: { accept: "application/json" },
    }).then(
      async (response) => {
        if (token !== populationRequest.current) return;
        const body = (await response.json().catch(() => null)) as {
          characters?: readonly LocationPopulationEntry[];
          error?: string;
        } | null;
        if (!response.ok || !body?.characters) {
          setPopulation([]);
          setPopulationLocationId(undefined);
          setPopulationError(body?.error ?? "The location population could not be loaded.");
          return;
        }
        setPopulationError(undefined);
        setPopulation(body.characters);
        setPopulationLocationId(locationId);
      },
      // A transport interruption of this read is non-fatal: the location
      // guard keeps the previous tile's entries hidden; the next accepted
      // gameplay revision revalidates.
      () => {
        if (token !== populationRequest.current) return;
        setPopulationError(undefined);
      },
    );
    // `state` identity changes exactly when accepted authoritative gameplay
    // state arrives, so every accepted revision revalidates the population.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.characterId, state.location.currentLocationId, state]);

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
          acceptState(result.state!);
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

  /** Open (or switch) the shared profile panel for one visible character. */
  function openProfile(targetName: string, trigger: HTMLButtonElement) {
    profileTriggerRef.current = trigger;
    setProfileTarget(targetName);
  }

  /** Close the profile panel and return focus to the name that opened it. */
  function closeProfile() {
    const opener = profileTriggerRef.current;
    if (opener && opener.isConnected && opener.offsetParent !== null) {
      opener.focus();
    } else {
      // The opener is hidden (disclosure collapsed) or was removed by a
      // refreshed population: focus the persistent disclosure trigger so the
      // close never strands focus on a hidden or missing control.
      populationTriggerRef.current?.focus();
    }
    setProfileTarget(undefined);
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
  // Entries are only shown for the location they were fetched for: after a
  // travel arrival the previous tile's population must never leak onto the
  // new tile while the replacement read is in flight.
  const populationMatchesLocation = populationLocationId === currentLocationId;

  // Helper: determine the status label for a location tile.
  function tileStatusLabel(locationId: string): string {
    const loc = getLocation(locationId);
    if (!loc) return "";
    if (locationId === LOCATION_IDS.emergencyPowerAnnex) return "Daily cells";
    if (locationId === LOCATION_IDS.abandonedProcessingYard) return "Refining";
    return loc.availableActionIds.length > 0 ? "Mining" : "Offline";
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
        <SectionHeader eyebrow="Local area">World map</SectionHeader>
        <div className="flex shrink-0 items-center gap-2">
          <LocationPopulationTrigger
            count={populationMatchesLocation ? population.length : 0}
            onToggle={() => setPopulationOpen((open) => !open)}
            open={populationOpen}
            triggerRef={populationTriggerRef}
          />
          <CollapseButton
            collapsed={mapCollapsed}
            label="world map"
            onToggle={toggleMapCollapsed}
          />
        </div>
      </div>
      {!mapCollapsed ? (
        <>
          <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
            Locations are hexes connected by routes. Select a reachable hex to inspect it, then
            confirm to walk there.
          </p>

          {/* Three flat-top hexes form a triangle. The SVG renders plated chassis,
          decorative identifiers, and all approved routes; native buttons overlay
          each hex for semantics and text labels. */}
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
                  statusLabel={tileStatusLabel(location.id)}
                  description={location.description}
                  selected={selected === location.id}
                  current={isCurrent}
                  populationCount={isCurrent && populationMatchesLocation ? population.length : 0}
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
                />
              );
            })}
          </div>

          <LocationPopulationList
            entries={population}
            error={populationError}
            matchesLocation={populationMatchesLocation}
            onOpenProfile={openProfile}
            open={populationOpen}
            profileTarget={profileTarget}
          />

          <CharacterProfilePanel
            activeCharacterId={state.characterId}
            onClose={closeProfile}
            openerRef={profileTriggerRef}
            panelRef={profilePanelRef}
            refreshKey={state}
            targetName={profileTarget}
          />

          {inTransit ? (
            <div className="mt-4 rounded-sm border border-[color:var(--rs-accent-arcane)] bg-[color:var(--rs-accent-arcane-subtle)] p-3">
              <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-arcane)]">
                In transit
              </p>
              <p className="mt-2 text-sm text-[color:var(--rs-text-primary)]">
                Walking from <strong>{getLocation(travel!.originLocationId)?.displayName}</strong>{" "}
                to <strong>{getLocation(travel!.destinationLocationId)?.displayName}</strong>.
              </p>
              <div className="mt-3">
                <StatusMeter
                  label="Journey progress"
                  value={transitProgress}
                  detail={`${transitRemainingSeconds.toFixed(1)}s remaining`}
                />
              </div>
              <p className="mt-2 text-xs text-[color:var(--rs-text-muted)]">
                The active work stopped before departure. No new activity can begin until you
                arrive.
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
                  {workActive ? (
                    <p className="mt-2 text-xs text-[color:var(--rs-text-secondary)]">
                      Departing resolves your completed work and stops the active activity before
                      the journey begins.
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
                  {selectedLocation.availableActionIds.includes(ACTION_IDS.refining)
                    ? "Refining is available here — feed Ferrite Shale to produce Refined Ferrite or Slag."
                    : selectedLocation.availableActionIds.includes(ACTION_IDS.crashSiteMining)
                      ? "Mining is available here."
                      : selectedLocation.id === LOCATION_IDS.emergencyPowerAnnex
                        ? "Claim five Power Cells here once per Pacific reset day."
                        : "No production activity is available here."}
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
        </>
      ) : null}
    </Panel>
  );
}
