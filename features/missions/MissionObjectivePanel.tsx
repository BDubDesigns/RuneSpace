"use client";

import { Panel } from "@/components/ui/Panel";
import type { MissionProjection } from "@/game/domain/missions";
import type { PlayGameplayState } from "@/server/play";
import { usePlay } from "@/features/play/PlayContext";

/**
 * The compact gameplay briefing: the most relevant accepted, incomplete
 * mission's current objective. Never advertises unaccepted missions. Tapping
 * opens the Mission Log focused on this entry.
 */
export function MissionObjectivePanel({ state }: { state: PlayGameplayState }) {
  const { openInventory, setMissionsOpen, setMissionsFocus } = usePlay();
  const candidates = state.missions.filter(
    (entry): entry is MissionProjection & { state: "active" | "ready_for_completion" } =>
      entry.state === "active" || entry.state === "ready_for_completion",
  );
  const reversed = [...candidates].reverse();
  const mission =
    reversed.find((entry) => entry.state === "ready_for_completion") ?? reversed.at(0);
  if (!mission) return null;
  const ready = mission.state === "ready_for_completion";
  const missionId = mission.missionId;
  const missionTitle = mission.title;
  const equipmentGuidance = mission.guidance?.equipmentItemId !== undefined;

  function openLog() {
    setMissionsFocus(missionId);
    setMissionsOpen(true);
  }

  return (
    <Panel
      aria-label="Mission objective"
      className="!p-4"
      data-mission-objective
      data-mission-objective-id={missionId}
      style={{
        backgroundColor: "var(--rs-mission-surface)",
        borderColor: "var(--rs-mission-border)",
      }}
    >
      <div>
        <button
          aria-label={`Open Mission Log for ${missionTitle}`}
          className="rs-focus block w-full text-left"
          data-mission-objective-open
          onClick={openLog}
          type="button"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-display text-[11px] uppercase tracking-[0.18em] text-[color:var(--rs-mission-accent-strong)]">
                Mission objective
              </p>
              <h2 className="mt-1 font-display text-lg font-bold uppercase tracking-wide">
                {missionTitle}
              </h2>
            </div>
            <span
              className="border px-2 py-1 font-display text-[10px] uppercase tracking-[0.14em] text-[color:var(--rs-mission-accent-strong)]"
              style={{
                backgroundColor: "var(--rs-mission-surface-subtle)",
                borderColor: "var(--rs-mission-border)",
              }}
            >
              {ready ? "Ready to turn in" : "Active"}
            </span>
          </div>
          <p
            className="mt-3 text-sm text-[color:var(--rs-mission-text)]"
            data-mission-objective-current
          >
            {mission.currentObjective}
          </p>
        </button>
        {equipmentGuidance ? (
          <button
            aria-label="Open Equipment"
            className="rs-focus mt-3 min-h-[var(--rs-touch-target)] border px-3 py-2 font-display text-xs font-bold uppercase tracking-[0.12em] text-[color:var(--rs-mission-accent-strong)] outline-none"
            style={{
              backgroundColor: "var(--rs-mission-surface-subtle)",
              borderColor: "var(--rs-mission-border)",
            }}
            data-mission-equipment-open
            onClick={() => openInventory("equipment")}
            type="button"
          >
            Open Equipment
          </button>
        ) : null}
      </div>
    </Panel>
  );
}
