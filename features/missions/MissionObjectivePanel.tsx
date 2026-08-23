"use client";

import { Panel } from "@/components/ui/Panel";
import { MISSION_IDS } from "@/game/config/foundations";
import type { MiningGameplayState } from "@/server/mining";

export function MissionObjectivePanel({ state }: { state: MiningGameplayState }) {
  const mission = state.missions.find((entry) => entry.missionId === MISSION_IDS.walkItOff);
  if (!mission || mission.state === "not_accepted") return null;
  const completed = mission.state === "completed";
  return (
    <Panel
      aria-label="Mission objective"
      className="border-[color:var(--rs-accent-primary)]/60 !p-4"
      data-mission-objective
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-[11px] uppercase tracking-[0.18em] text-[color:var(--rs-accent-primary)]">
            Mission objective
          </p>
          <h2 className="mt-1 font-display text-lg font-bold uppercase tracking-wide">
            {mission.title}
          </h2>
        </div>
        <span className="border border-[color:var(--rs-border-structural)] px-2 py-1 font-display text-[10px] uppercase tracking-[0.14em] text-[color:var(--rs-text-secondary)]">
          {completed ? "Completed" : "Active"}
        </span>
      </div>
      <p className="mt-3 text-sm text-[color:var(--rs-text-secondary)]">
        {completed ? "Walk It Off complete." : mission.currentObjective}
      </p>
    </Panel>
  );
}
