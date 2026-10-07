"use client";

import { Pin } from "lucide-react";
import { useRef } from "react";
import type { MissionProjection } from "@/game/domain/missions";
import { Feedback } from "@/components/ui/Feedback";
import { itemQuantityLabel } from "@/game/content/item-presentation";
import { missionGuidancePhase, stillNeededMaterials } from "@/game/domain/missions";
import type { PlayGameplayState } from "@/server/play";
import { usePlay } from "@/features/play/PlayContext";
import { useMissionPin } from "./useMissionPin";

type AcceptedMission = MissionProjection & { state: "active" | "ready_for_completion" };

/**
 * The compact Mission guidance stack at the top of every Play surface: one
 * strip per accepted, non-completed, pinned Mission, in the authoritative
 * Mission order. Unaccepted and completed Missions never appear; nothing is
 * selected or tracked. Each strip is green while authored work remains and
 * blue once only the final handoff does — the phase comes from the Mission
 * projection, never from where the player is standing.
 *
 * Exactly one instance is mounted in whichever composition is active (#286):
 * above the main column on a phone or tablet, at the top of the desktop rail.
 *
 * A strip is a status row, not a guidance target. It carries two controls: the
 * Mission-guidance shortcut Open Equipment, inside the strip whose Mission
 * currently targets equipment, and Unpin (#325), which removes only that strip.
 * Unpinning changes nothing else about the Mission; the Mission Log pins it
 * back.
 */
export function guidanceMissions(state: PlayGameplayState): AcceptedMission[] {
  return state.missions.filter(
    (mission): mission is AcceptedMission =>
      mission.state === "active" || mission.state === "ready_for_completion",
  );
}

/**
 * Whether the player has this Mission pinned (#325). Absence of an unpin is
 * pinned, so every newly accepted or auto-continued Mission starts pinned.
 */
export function isMissionPinned(state: PlayGameplayState, missionId: string): boolean {
  return !state.unpinnedMissionIds.includes(missionId);
}

/** The active Missions Current Missions shows: accepted, not completed, pinned. */
export function pinnedGuidanceMissions(state: PlayGameplayState): AcceptedMission[] {
  return guidanceMissions(state).filter((mission) => isMissionPinned(state, mission.missionId));
}

export function MissionGuidanceStrips({
  state,
  className,
}: {
  state: PlayGameplayState;
  /** Layout only (for example hiding the phone placement at desktop width). */
  className?: string;
}) {
  const { missionsTrigger, openInventory } = usePlay();
  const { message, pendingMissionId, setPinned } = useMissionPin();
  const list = useRef<HTMLOListElement>(null);
  const missions = pinnedGuidanceMissions(state);

  // An unpinned strip takes its focused control with it, so focus moves to the
  // next strip's Unpin, or with none left to the Mission Log's entry point,
  // where the Mission can be pinned again.
  function unpin(missionId: string, index: number) {
    setPinned(missionId, false, () => {
      const remaining = list.current?.querySelectorAll<HTMLElement>("[data-mission-strip-unpin]");
      const next = remaining?.[Math.min(index, remaining.length - 1)];
      const entry = missionsTrigger.current?.isConnected
        ? missionsTrigger.current
        : document.querySelector<HTMLElement>('[data-utility-tab="missions"]');
      (next ?? entry)?.focus();
    });
  }

  if (missions.length === 0) {
    return message ? (
      <div className={className}>
        <Feedback tone="danger">{message}</Feedback>
      </div>
    ) : null;
  }

  return (
    <section aria-label="Current Missions" className={className} data-mission-strips>
      <ol className="space-y-2" ref={list}>
        {missions.map((mission, index) => {
          const phase = missionGuidancePhase(mission);
          const unmet = mission.requirements?.filter((requirement) => !requirement.satisfied) ?? [];
          // The first unmet requirement owns the current objective; others that
          // track progress at the same time stay visible, compactly.
          const alsoInProgress = unmet.slice(1).filter((requirement) => requirement.progress);
          // A repair needing several materials also says what is still to be
          // obtained, net of what is carried (#322); empty when nothing is.
          const stillNeeded = stillNeededMaterials(mission);
          return (
            // A status row, not an interaction target: it carries the phase, never
            // `data-mission-guidance`, which marks what a player acts on.
            <li
              className={`${phase === "turn_in" ? "rs-mission-available" : "rs-mission-guidance"} flex items-center justify-between gap-3 border bg-[color:var(--rs-surface-panel)] px-3 py-2`}
              data-mission-phase={phase}
              data-mission-strip={mission.missionId}
              key={mission.missionId}
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2 font-display uppercase">
                  <span className="text-xs font-bold tracking-wide" data-mission-strip-title>
                    {mission.title}
                  </span>
                  <span className="text-[10px] tracking-[0.14em]" data-mission-strip-phase>
                    {phase === "turn_in" ? "Turn in" : "Active"}
                  </span>
                </p>
                <p
                  className="mt-0.5 text-sm leading-snug text-[color:var(--rs-text-primary)]"
                  data-mission-strip-objective
                >
                  {mission.currentObjective}
                </p>
                {stillNeeded.length > 0 ? (
                  <p
                    className="mt-0.5 text-xs leading-snug text-[color:var(--rs-text-secondary)]"
                    data-mission-strip-needed
                  >
                    {`Still needed: ${stillNeeded
                      .map((material) =>
                        itemQuantityLabel(material.itemId, material.remaining, material.label),
                      )
                      .join(" · ")}`}
                  </p>
                ) : null}
                {alsoInProgress.length > 0 ? (
                  <p
                    className="mt-0.5 text-xs leading-snug text-[color:var(--rs-text-secondary)]"
                    data-mission-strip-also
                  >
                    {alsoInProgress.map((requirement) => requirement.objective).join(" · ")}
                  </p>
                ) : null}
              </div>
              {mission.guidance?.equipmentItemId !== undefined ? (
                <button
                  aria-label="Open Equipment"
                  className="rs-focus min-h-[var(--rs-touch-target)] shrink-0 border border-current px-2 font-display text-[10px] font-bold uppercase tracking-[0.12em]"
                  data-mission-equipment-open
                  onClick={() => openInventory("equipment")}
                  type="button"
                >
                  Equipment
                </button>
              ) : null}
              {/* A pin, not an X: unpinning hides the strip, it never abandons
                  the Mission. The touch target hangs into the strip's own
                  padding, so it never makes the strip taller. */}
              <button
                aria-label={`Unpin ${mission.title}`}
                className="rs-focus -my-2 -ml-1 -mr-2 inline-flex h-[var(--rs-touch-target)] w-[var(--rs-touch-target)] shrink-0 items-center justify-center opacity-80 transition-opacity duration-[var(--rs-duration-fast)] hover:opacity-100 aria-busy:opacity-40"
                aria-busy={pendingMissionId === mission.missionId || undefined}
                data-mission-strip-unpin={mission.missionId}
                onClick={() => unpin(mission.missionId, index)}
                title="Unpin"
                type="button"
              >
                <Pin aria-hidden="true" className="h-4 w-4" fill="currentColor" />
              </button>
            </li>
          );
        })}
      </ol>
      {message ? <Feedback tone="danger">{message}</Feedback> : null}
    </section>
  );
}
