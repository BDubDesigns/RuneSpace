"use client";

import { Panel } from "@/components/ui/Panel";
import type { MiningGameplayState } from "@/server/mining";

/**
 * Displays the relevant active mission through the shared projection surface.
 * Completed missions never block later ones: the newest accepted, uncompleted
 * mission wins; otherwise the most recently completed mission shows its
 * completed state. There is deliberately no one-active-mission restriction
 * and no history/log redesign here.
 */
export function MissionObjectivePanel({ state }: { state: MiningGameplayState }) {
  const active = [...state.missions]
    .reverse()
    .find((entry) => entry.state !== "not_accepted" && entry.state !== "completed");
  const mission =
    active ??
    [...state.missions].reverse().find((entry) => entry.state === "completed") ??
    state.missions[0];
  if (!mission || mission.state === "not_accepted") return null;
  const completed = mission.state === "completed";
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
          {completed ? "Completed" : "Active"}
        </span>
      </div>
      <p className="mt-3 text-sm text-[color:var(--rs-mission-text)]">
        {completed ? `${mission.title} complete.` : mission.currentObjective}
      </p>
    </Panel>
  );
}
