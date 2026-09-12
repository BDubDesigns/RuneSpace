"use client";

import type { MissionProjection } from "@/game/domain/missions";
import { missionGuidancePhase } from "@/game/domain/missions";
import type { PlayGameplayState } from "@/server/play";
import { usePlay } from "@/features/play/PlayContext";

type AcceptedMission = MissionProjection & { state: "active" | "ready_for_completion" };

/**
 * The compact Mission guidance stack at the top of every Play surface: one
 * strip per accepted, non-completed Mission, in the authoritative Mission order.
 * Unaccepted and completed Missions never appear; nothing is selected or
 * tracked. Each strip is green while authored work remains and blue once only
 * the final handoff does — the phase comes from the Mission projection, never
 * from where the player is standing.
 *
 * Informational only: a strip is not a control. The one existing
 * Mission-guidance shortcut, Open Equipment, stays available inside the strip
 * whose Mission currently targets equipment.
 */
export function MissionGuidanceStrips({ state }: { state: PlayGameplayState }) {
  const { openInventory } = usePlay();
  const missions = state.missions.filter(
    (mission): mission is AcceptedMission =>
      mission.state === "active" || mission.state === "ready_for_completion",
  );
  if (missions.length === 0) return null;

  return (
    <section aria-label="Current Missions" data-mission-strips>
      <ol className="space-y-2">
        {missions.map((mission) => {
          const phase = missionGuidancePhase(mission);
          const unmet = mission.requirements?.filter((requirement) => !requirement.satisfied) ?? [];
          // The first unmet requirement owns the current objective; others that
          // track progress at the same time stay visible, compactly.
          const alsoInProgress = unmet.slice(1).filter((requirement) => requirement.progress);
          return (
            // A status row, not an interaction target: it carries the phase, never
            // `data-mission-guidance`, which marks what a player acts on.
            <li
              className={`${phase === "turn_in" ? "rs-mission-available" : "rs-mission-guidance"} flex items-center justify-between gap-3 border bg-[color:var(--rs-surface-panel)] px-3 py-2`}
              data-mission-phase={phase}
              data-mission-strip={mission.missionId}
              key={mission.missionId}
            >
              <div className="min-w-0">
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
            </li>
          );
        })}
      </ol>
    </section>
  );
}
