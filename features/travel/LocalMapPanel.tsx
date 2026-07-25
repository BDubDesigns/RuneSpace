"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { Panel } from "@/components/ui/Panel";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { GAME_TICK_MS } from "@/game/config/foundations";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { LOCATIONS, getLocation } from "@/game/content/locations";
import { beginTravelAction } from "@/server/actions";
import { useMiningPlay } from "@/features/mining/MiningPlayContext";

const WALK_SECONDS = Math.round(
  (getEffectiveGameBalance().travel.adjacentWalkDurationTicks * GAME_TICK_MS) / 1000,
);

function HexCell({
  locationId,
  name,
  description,
  selected,
  current,
  disabled,
  onSelect,
  children,
}: {
  locationId: string;
  name: string;
  description: string;
  selected: boolean;
  current: boolean;
  disabled: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  const youAreHere = current;
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
      className={`rs-focus group relative flex min-h-[var(--rs-touch-target)] flex-col items-center justify-center gap-1 border-2 px-3 py-3 text-center transition disabled:cursor-not-allowed disabled:opacity-70 ${
        youAreHere
          ? "border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-accent-primary-subtle)] shadow-[var(--rs-glow-primary)]"
          : selected
            ? "border-[color:var(--rs-accent-mining)] bg-[color:var(--rs-accent-mining-subtle)]"
            : "border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-raised)] hover:border-[color:var(--rs-accent-secondary)]"
      }`}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-2 top-1 font-display text-[10px] uppercase tracking-[0.18em] text-[color:var(--rs-text-muted)]"
      >
        {youAreHere ? "You are here" : selected ? "Selected" : "Location"}
      </span>
      <span className="mt-3 font-display text-sm font-bold text-[color:var(--rs-text-primary)]">
        {name}
      </span>
      <span id={`loc-desc-${locationId}`} className="sr-only">
        {description}
      </span>
      {children}
    </button>
  );
}

export function LocalMapPanel() {
  const { state, acquireCommand, releaseCommand, busy, requestAutoRefresh } = useMiningPlay();
  const [selected, setSelected] = useState<string | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [now, setNow] = useState(Date.now());
  const [isPending, startTransition] = useTransition();
  const [transitioning, setTransitioning] = useState(false);
  const observedTravel = useRef(state.travelState?.destinationLocationId);

  const currentLocationId = state.location.currentLocationId;
  const travel = state.travelState;
  const inTransit = Boolean(travel);
  const miningActive = state.activeAction?.actionId === "crash_site_ferrite_shale_mining";

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
    // Announce arrival: the selected destination became the current location.
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
          if (result.error) setMessage(result.error);
          else if (result.state?.travelError) {
            setMessage(travelErrorMessage(result.state.travelError));
          } else {
            setMessage(undefined);
            setSelected(undefined);
          }
        } catch {
          setMessage("Comms interruption. Travel could not be confirmed.");
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

  return (
    <Panel tone="raised">
      <SectionHeader eyebrow="Local area">World map</SectionHeader>
      <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
        Locations are hexes connected by routes. Select a reachable hex to inspect it, then confirm
        to walk there.
      </p>

      <div className="mt-4 flex flex-col gap-3" role="group" aria-label="Local map">
        <div className="flex items-stretch justify-center gap-3 sm:gap-6">
          {LOCATIONS.map((location) => {
            const isCurrent = location.id === currentLocationId;
            return (
              <HexCell
                key={location.id}
                locationId={location.id}
                name={location.displayName}
                description={location.description}
                selected={selected === location.id}
                current={isCurrent}
                disabled={inTransit}
                onSelect={() => !inTransit && setSelected(location.id)}
              >
                <span
                  className={`mt-1 font-display text-[10px] uppercase tracking-wide ${
                    isCurrent
                      ? "text-[color:var(--rs-accent-primary)]"
                      : "text-[color:var(--rs-text-muted)]"
                  }`}
                >
                  {location.availableActionIds.length > 0
                    ? "Mining available"
                    : "Metallurgy dormant"}
                </span>
              </HexCell>
            );
          })}
        </div>
        <p className="text-center text-xs text-[color:var(--rs-text-muted)]">
          Route: {LOCATIONS.map((l) => l.displayName).join(" ↔ ")}
        </p>
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
            <p className="mt-2 text-xs text-[color:var(--rs-text-muted)]">
              {selectedLocation.availableActionIds.length > 0
                ? "Mining is available here."
                : "Metallurgy is dormant here and not yet operational."}
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
