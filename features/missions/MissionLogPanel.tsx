"use client";

import { useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { Feedback } from "@/components/ui/Feedback";
import type { MissionProjection } from "@/game/domain/missions";
import type { PlayGameplayState } from "@/server/play";

function formatCompletedDate(completedAt: Date | null | undefined): string | undefined {
  if (!completedAt) return undefined;
  const date = completedAt instanceof Date ? completedAt : new Date(completedAt);
  if (!Number.isFinite(date.getTime())) return undefined;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function stateLabel(mission: MissionProjection): string {
  if (mission.state === "ready_for_completion") return "Ready to turn in";
  if (mission.state === "completed") return "Completed";
  return "Active";
}

function MissionEntry({
  mission,
  expanded,
  onToggle,
}: {
  mission: MissionProjection;
  expanded: boolean;
  onToggle: () => void;
}) {
  const ready = mission.state === "ready_for_completion";
  const completed = mission.state === "completed";
  const completedDate = completed ? formatCompletedDate(mission.completedAt) : undefined;
  return (
    <div
      className="border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)]"
      data-mission-log-entry={mission.missionId}
      data-mission-log-state={mission.state}
    >
      <button
        aria-expanded={expanded}
        className="rs-focus flex w-full items-center justify-between gap-3 px-3 py-3 text-left"
        onClick={onToggle}
        type="button"
      >
        <span className="min-w-0">
          <span className="block truncate font-display text-sm font-bold uppercase tracking-wide">
            {mission.title}
          </span>
          <span className="mt-1 block text-xs text-[color:var(--rs-text-secondary)]">
            {stateLabel(mission)}
            {completed && completedDate ? ` · ${completedDate}` : ""}
          </span>
        </span>
        <span
          aria-hidden="true"
          className="shrink-0 font-display text-xs text-[color:var(--rs-text-muted)]"
        >
          {expanded ? "−" : "+"}
        </span>
      </button>
      {expanded ? (
        <div className="border-t border-[color:var(--rs-border-subtle)] px-3 py-3">
          <p className="text-sm text-[color:var(--rs-text-secondary)]">{mission.summary}</p>
          {!completed && mission.requirements ? (
            <ul className="mt-3 space-y-1.5" data-mission-log-requirements>
              {mission.requirements.map((requirement, index) => (
                <li
                  className="flex items-start gap-2 text-sm"
                  data-mission-requirement-satisfied={requirement.satisfied ? "true" : "false"}
                  key={`${requirement.kind}-${index}`}
                >
                  <span
                    aria-hidden="true"
                    className={
                      requirement.satisfied
                        ? "text-[color:var(--rs-accent-success)]"
                        : "text-[color:var(--rs-text-muted)]"
                    }
                  >
                    {requirement.satisfied ? "✓" : "·"}
                  </span>
                  <span className="text-[color:var(--rs-text-secondary)]">
                    {requirement.objective}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {!completed ? (
            <p
              className={`mt-3 text-sm font-semibold ${ready ? "text-[color:var(--rs-mission-accent-strong)]" : "text-[color:var(--rs-text-secondary)]"}`}
              data-mission-log-next={ready ? "turn-in" : "objective"}
            >
              {mission.currentObjective}
            </p>
          ) : null}
          {completed && mission.earnedReward ? (
            <p
              className="mt-3 border-t border-[color:var(--rs-border-subtle)] pt-3 text-sm text-[color:var(--rs-text-secondary)]"
              data-mission-log-reward
            >
              Reward earned:{" "}
              {mission.earnedReward.kind === "item"
                ? mission.earnedReward.itemName
                : `+${mission.earnedReward.amount} ${mission.earnedReward.skillName} XP`}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function MissionLogPanel({
  state,
  focusedMissionId,
  onClose,
  triggerRef,
}: {
  state: PlayGameplayState;
  focusedMissionId?: string;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const active = state.missions.filter(
    (mission) => mission.state === "active" || mission.state === "ready_for_completion",
  );
  const completed = state.missions.filter((mission) => mission.state === "completed");
  const [expandedId, setExpandedId] = useState<string | undefined>(
    focusedMissionId ??
      active.find((mission) => mission.state === "ready_for_completion")?.missionId ??
      active[0]?.missionId,
  );
  const [completedOpen, setCompletedOpen] = useState(false);

  function toggle(missionId: string) {
    setExpandedId((current) => (current === missionId ? undefined : missionId));
  }

  return (
    <Drawer
      eyebrow="Mission record"
      label="Mission Log"
      onClose={onClose}
      title="Mission Log"
      triggerRef={triggerRef}
    >
      <div data-mission-log>
        <section aria-label="Active missions" data-mission-log-section="active">
          <h3 className="mt-2 font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-mission-accent-strong)]">
            Active
          </h3>
          {active.length === 0 ? (
            <p
              className="mt-2 text-sm text-[color:var(--rs-text-secondary)]"
              data-mission-log-empty
            >
              No active missions. Talk to people you meet and explore the world.
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              {active.map((mission) => (
                <MissionEntry
                  expanded={expandedId === mission.missionId}
                  key={mission.missionId}
                  mission={mission}
                  onToggle={() => toggle(mission.missionId)}
                />
              ))}
            </div>
          )}
        </section>
        <section aria-label="Completed missions" data-mission-log-section="completed">
          <button
            aria-expanded={completedOpen}
            className="rs-focus mt-4 flex w-full items-center justify-between gap-3 text-left"
            onClick={() => setCompletedOpen((open) => !open)}
            type="button"
          >
            <span className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-text-muted)]">
              Completed{completed.length > 0 ? ` (${completed.length})` : ""}
            </span>
            <span
              aria-hidden="true"
              className="font-display text-xs text-[color:var(--rs-text-muted)]"
            >
              {completedOpen ? "−" : "+"}
            </span>
          </button>
          {completedOpen ? (
            completed.length === 0 ? (
              <Feedback tone="muted">No completed missions yet.</Feedback>
            ) : (
              <div className="mt-2 space-y-2">
                {completed.map((mission) => (
                  <MissionEntry
                    expanded={expandedId === mission.missionId}
                    key={mission.missionId}
                    mission={mission}
                    onToggle={() => toggle(mission.missionId)}
                  />
                ))}
              </div>
            )
          ) : null}
        </section>
      </div>
    </Drawer>
  );
}
