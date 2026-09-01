"use client";

import { Panel } from "@/components/ui/Panel";
import type { PlayGameplayState } from "@/server/play";

/**
 * Displays the relevant active mission through the shared projection surface.
 * Completed missions never block later ones: the newest accepted, uncompleted
 * mission wins. When the newest mission is merely ELIGIBLE (its prerequisite
 * is complete but the player has not yet accepted), that mission leads the
 * panel as available; only when no next story mission is currently available
 * does the most recently completed mission show its completed state. There is
 * deliberately no one-active-mission restriction and no history/log redesign.
 */
export function MissionObjectivePanel({ state }: { state: PlayGameplayState }) {
  const active = [...state.missions]
    .reverse()
    .find((entry) => entry.state !== "not_accepted" && entry.state !== "completed");
  // A mission is only presented as an available next story quest when it
  // EXPLICITLY authors an available-story presentation (e.g. Cut Your Teeth's
  // post-Walk-It-Off state). A prerequisite-free mission (Walk It Off) must
  // NOT be flagged Available — that would undermine the explorer-first route
  // where a fresh character can reach Tansy before ever talking to Wade.
  const available = [...state.missions]
    .reverse()
    .find(
      (entry) =>
        entry.state === "not_accepted" &&
        entry.prerequisiteSatisfied &&
        entry.availableObjective !== undefined,
    );
  const completedFallback = [...state.missions]
    .reverse()
    .find((entry) => entry.state === "completed");
  const mission = active ?? available ?? completedFallback ?? state.missions[0];
  // The available mission is not_accepted but MUST render (it leads the
  // player into the next story quest). Only hide when nothing at all exists.
  if (!mission || (!available && mission.state === "not_accepted")) return null;
  const completed = mission.state === "completed";
  const isAvailable = mission === available;
  return (
    <Panel
      aria-label="Mission objective"
      className="!p-4"
      data-mission-objective
      style={{
        backgroundColor: "var(--rs-mission-surface)",
        borderColor: "var(--rs-mission-border)",
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-[11px] uppercase tracking-[0.18em] text-[color:var(--rs-mission-accent-strong)]">
            Mission objective
          </p>
          <h2 className="mt-1 font-display text-lg font-bold uppercase tracking-wide">
            {mission.title}
          </h2>
        </div>
        <span
          className="border px-2 py-1 font-display text-[10px] uppercase tracking-[0.14em] text-[color:var(--rs-mission-accent-strong)]"
          style={{
            backgroundColor: "var(--rs-mission-surface-subtle)",
            borderColor: "var(--rs-mission-border)",
          }}
        >
          {completed ? "Completed" : isAvailable ? "Available" : "Active"}
        </span>
      </div>
      <p className="mt-3 text-sm text-[color:var(--rs-mission-text)]">
        {completed
          ? `${mission.title} complete.`
          : isAvailable
            ? (mission.availableObjective ??
              `Speak with ${mission.offeringNpcName ?? "the quest giver"}.`)
            : mission.currentObjective}
      </p>
    </Panel>
  );
}
