"use client";

import { useEffect, useState } from "react";
import { MissionGuidanceHalo, missionGuidanceClassName } from "@/components/ui/MissionGuidanceHalo";
import { FabricationStation } from "@/features/fabrication/FabricationStation";
import { usePlay } from "@/features/play/PlayContext";
import { WorkbenchPanel } from "@/features/practice/WorkbenchPanel";
import { WorkOrdersTerminal } from "@/features/practice/WorkOrdersTerminal";
import { fabricationActionIds, tinkeringActionIds } from "@/game/config/balance";
import { ACTION_IDS } from "@/game/config/foundations";
import { derivePinnedGuidanceTargets } from "@/features/missions/mission-pins";

type WorkArea = "workshop" | "fabrication";

/**
 * Rusk Recovery's two work areas (#232): Wade's Welding Workshop and the
 * Fabrication Station, inside one World Location.
 *
 * Not Local Places and not scenes: the place, its art and the people standing
 * in it stay shared at the top of the Location surface whichever area is
 * selected. This is a selector of prominent cards — never a dropdown — with
 * only the selected area's full surface expanded, so both capabilities stay
 * visible and discoverable. It is deliberately this yard's composition rather
 * than a work-area framework: a second location with work areas earns the
 * abstraction when it exists.
 *
 * Until Tansy puts the player on the Fabrication Station there is only the
 * workshop, and it renders exactly as it always has.
 */
export function RuskRecoveryWorkAreas() {
  const { state } = usePlay();
  const actionId = state.activeAction?.actionId;
  const stationBusy =
    (actionId !== undefined &&
      [...fabricationActionIds(), ...tinkeringActionIds()].includes(actionId)) ||
    state.tinkering.cycle !== undefined;
  const workshopBusy =
    actionId === ACTION_IDS.practiceWelding || actionId === ACTION_IDS.workOrderWelding;
  const guidance = derivePinnedGuidanceTargets(state);
  const stationGuided =
    [...guidance.actionIds].some((id) =>
      [...fabricationActionIds(), ...tinkeringActionIds()].includes(id),
    ) ||
    guidance.activities.has("fabrication") ||
    guidance.activities.has("tinkering");
  const workshopGuided =
    guidance.actionIds.has(ACTION_IDS.practiceWelding) ||
    guidance.actionIds.has(ACTION_IDS.workOrderWelding);
  const [area, setArea] = useState<WorkArea>(
    stationBusy || (stationGuided && !workshopBusy) ? "fabrication" : "workshop",
  );

  // Work that is actually running is what the yard shows.
  useEffect(() => {
    if (stationBusy) setArea("fabrication");
  }, [stationBusy]);
  useEffect(() => {
    if (workshopBusy) setArea("workshop");
  }, [workshopBusy]);
  // A Mission turning to the station — Tansy's offer just accepted, Break It
  // Down just begun — brings it forward, unless the bench is busy.
  useEffect(() => {
    if (stationGuided && !workshopBusy) setArea("fabrication");
  }, [stationGuided, workshopBusy]);

  if (!state.fabricationStation.unlocked) {
    return (
      <>
        <WorkbenchPanel />
        <WorkOrdersTerminal />
      </>
    );
  }

  const cards: {
    id: WorkArea;
    title: string;
    detail: string;
    guided: boolean;
  }[] = [
    {
      id: "workshop",
      title: "Welding Workshop",
      detail: "Practice Welding · Work Orders",
      guided: workshopGuided,
    },
    {
      id: "fabrication",
      title: "Fabrication Station",
      detail: state.tinkering.unlocked ? "Fabricate · Tinker" : "Fabricate",
      guided: stationGuided,
    },
  ];

  return (
    <>
      <div
        aria-label="Work areas at Rusk Recovery"
        className="grid grid-cols-2 gap-2"
        data-work-areas
        role="group"
      >
        {cards.map((card) => {
          const selected = area === card.id;
          const guidanceKind = card.guided && !selected ? "active" : undefined;
          return (
            <MissionGuidanceHalo className="flex min-w-0" guidance={guidanceKind} key={card.id}>
              <button
                aria-pressed={selected}
                // The keyboard ring is drawn inside the card, as the beveled
                // controls draw theirs, so the Mission halo outside it and
                // the focus mark never read as one.
                className={`flex min-h-[var(--rs-touch-target)] w-full min-w-0 flex-col items-start gap-0.5 border p-3 text-left transition duration-[var(--rs-duration-fast)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-[color:var(--rs-focus-ring)] ${
                  selected
                    ? "border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-surface-raised)]"
                    : "border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] hover:border-[color:var(--rs-accent-secondary)]"
                } ${missionGuidanceClassName(guidanceKind)}`}
                data-mission-guidance={guidanceKind}
                data-work-area={card.id}
                onClick={() => setArea(card.id)}
                type="button"
              >
                <span className="font-display text-sm font-bold uppercase tracking-wide">
                  {card.title}
                </span>
                <span className="text-xs text-[color:var(--rs-text-secondary)]">{card.detail}</span>
              </button>
            </MissionGuidanceHalo>
          );
        })}
      </div>
      {area === "workshop" ? (
        <>
          <WorkbenchPanel />
          <WorkOrdersTerminal />
        </>
      ) : (
        <FabricationStation />
      )}
    </>
  );
}
