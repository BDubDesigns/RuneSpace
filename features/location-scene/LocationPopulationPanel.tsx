"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Feedback } from "@/components/ui/Feedback";
import type { LocationPopulationEntry } from "@/game/domain/location-population";
import { usePlay } from "@/features/play/PlayContext";
import { CharacterProfilePanel } from "./CharacterProfilePanel";

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
  const countLabel = count === 1 ? "1 other character here" : `${count} other characters here`;
  return (
    <button
      aria-controls="location-population-list"
      aria-expanded={open}
      aria-label={open ? "Hide characters here" : `View ${countLabel}`}
      className="rs-bevel rs-focus inline-flex min-h-[var(--rs-touch-target)] items-center gap-1.5 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] px-2 text-sm font-semibold text-[color:var(--rs-text-primary)] outline-none transition duration-[var(--rs-duration-fast)] hover:border-[color:var(--rs-accent-secondary)]"
      data-population-count={count}
      data-location-population-trigger
      onClick={onToggle}
      ref={triggerRef}
      type="button"
    >
      <span>{countLabel} · View</span>
      <ChevronIcon
        className={`h-3 w-3 shrink-0 text-[color:var(--rs-text-secondary)] motion-safe:transition-transform ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
}

function LocationPopulationList({
  entries,
  error,
  open,
  profileTarget,
  onOpenProfile,
}: {
  entries: readonly LocationPopulationEntry[];
  error?: string;
  open: boolean;
  profileTarget?: string;
  onOpenProfile: (displayName: string, trigger: HTMLButtonElement) => void;
}) {
  return (
    <div
      id="location-population-list"
      className="mt-3 divide-y divide-[color:var(--rs-border-subtle)] border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-1.5"
      hidden={!open}
    >
      {error ? (
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
                className={`rs-focus flex min-h-[var(--rs-touch-target)] w-full items-center gap-3 border-l-2 px-2 py-2 text-left outline-none motion-safe:transition-colors ${selected ? "border-[color:var(--rs-accent-mining)] bg-[color:var(--rs-accent-mining-hover)]" : "border-transparent hover:bg-[color:var(--rs-accent-mining-subtle)] active:bg-[color:var(--rs-accent-mining-hover)]"}`}
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
                  className={`shrink-0 border px-1.5 py-0.5 font-display text-[10px] uppercase leading-none tracking-[0.08em] ${selected ? "border-[color:var(--rs-accent-mining)] bg-[color:var(--rs-accent-mining-subtle)] text-[color:var(--rs-accent-mining)]" : "border-[color:var(--rs-item-plate-border)] bg-[color:var(--rs-item-plate-surface)] text-[color:var(--rs-text-secondary)]"}`}
                >
                  Lv {entry.level}
                </span>
                <ChevronIcon
                  className={`h-3 w-3 shrink-0 ${selected ? "text-[color:var(--rs-accent-mining)]" : "text-[color:var(--rs-text-muted)]"}`}
                />
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

export function LocationPopulationPanel() {
  const { state } = usePlay();
  const [population, setPopulation] = useState<readonly LocationPopulationEntry[]>([]);
  const [populationLocationId, setPopulationLocationId] = useState<string>();
  const [populationError, setPopulationError] = useState<string>();
  const [populationOpen, setPopulationOpen] = useState(false);
  const [profileTarget, setProfileTarget] = useState<string>();
  const populationRequest = useRef(0);
  const profileTriggerRef = useRef<HTMLButtonElement>(null);
  const profilePanelRef = useRef<HTMLElement>(null);
  const populationTriggerRef = useRef<HTMLButtonElement>(null);
  const currentLocationId = state.location.currentLocationId;
  const inTransit = Boolean(state.travelState);

  useEffect(() => {
    setPopulationOpen(false);
    setPopulation([]);
    setPopulationLocationId(undefined);
    const active = document.activeElement;
    if (active instanceof Node && profilePanelRef.current?.contains(active)) {
      populationTriggerRef.current?.focus();
    }
    setProfileTarget(undefined);
  }, [currentLocationId, inTransit]);

  useEffect(() => {
    const token = populationRequest.current + 1;
    populationRequest.current = token;
    if (inTransit) return;
    const locationId = currentLocationId;
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
      () => {
        if (token !== populationRequest.current) return;
        setPopulationError(undefined);
      },
    );
    // Each accepted gameplay revision revalidates this narrow read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.characterId, currentLocationId, state, inTransit]);

  if (inTransit) return null;

  const matchesLocation = populationLocationId === currentLocationId;
  const count = matchesLocation ? population.length : 0;

  function openProfile(targetName: string, trigger: HTMLButtonElement) {
    profileTriggerRef.current = trigger;
    setProfileTarget(targetName);
  }

  function closeProfile() {
    const opener = profileTriggerRef.current;
    if (opener && opener.isConnected && opener.offsetParent !== null) opener.focus();
    else populationTriggerRef.current?.focus();
    setProfileTarget(undefined);
  }

  return (
    <section aria-label="Characters at this location" data-location-population>
      {count === 0 ? (
        <p className="text-sm text-[color:var(--rs-text-secondary)]">
          You&apos;re the only one here.
        </p>
      ) : (
        <LocationPopulationTrigger
          count={count}
          onToggle={() => setPopulationOpen((open) => !open)}
          open={populationOpen}
          triggerRef={populationTriggerRef}
        />
      )}
      {count > 0 ? (
        <LocationPopulationList
          entries={population}
          error={populationError}
          onOpenProfile={openProfile}
          open={populationOpen}
          profileTarget={profileTarget}
        />
      ) : populationError ? (
        <div className="mt-2">
          <Feedback tone="muted">{populationError}</Feedback>
        </div>
      ) : null}
      <CharacterProfilePanel
        activeCharacterId={state.characterId}
        onClose={closeProfile}
        openerRef={profileTriggerRef}
        panelRef={profilePanelRef}
        refreshKey={state}
        targetName={profileTarget}
      />
    </section>
  );
}
