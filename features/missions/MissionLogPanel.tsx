"use client";

import { useState, type ReactNode } from "react";
import {
  UtilitySurface,
  type DockedUtilityRegion,
  type UtilityPresentation,
} from "@/components/ui/UtilitySurface";
import { XpAmount } from "@/components/ui/XpAmount";
import { CreditsAmount } from "@/components/ui/CreditsAmount";
import { Feedback } from "@/components/ui/Feedback";
import { ItemSourcesButton } from "@/features/item-sources/ItemSourcesButton";
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
  state,
}: {
  mission: MissionProjection;
  expanded: boolean;
  onToggle: () => void;
  state: PlayGameplayState;
}) {
  const ready = mission.state === "ready_for_completion";
  const completed = mission.state === "completed";
  const completedDate = completed ? formatCompletedDate(mission.completedAt) : undefined;
  const requirements = mission.requirements ?? [];
  const showCurrentObjective = !requirements.some(
    (requirement) => requirement.objective === mission.currentObjective,
  );
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
              {requirements.map((requirement, index) => (
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
                    {/* A Mission only says what it needs. How to get an unmet item
                        is the item's own reference, derived from the content
                        that owns each way of getting it (#326). */}
                    {requirement.itemId && !requirement.satisfied ? (
                      <ItemSourcesButton itemId={requirement.itemId} state={state} />
                    ) : null}
                    {/* Secondary context (what is carried, for instance) is its
                        own subordinate line so it can never read as progress. */}
                    {requirement.detail ? (
                      <span
                        className="mt-0.5 block text-xs text-[color:var(--rs-text-muted)]"
                        data-mission-requirement-detail
                      >
                        {requirement.detail}
                      </span>
                    ) : null}
                    {/* A recipe needing several materials reports each one on
                        its own line: unlike materials are never summed into a
                        single total that would mean nothing. */}
                    {requirement.materials?.map((material) => (
                      <span
                        className="mt-0.5 block text-xs text-[color:var(--rs-text-secondary)]"
                        data-mission-requirement-material={material.itemId}
                        key={material.itemId}
                      >
                        {`${material.label} — ${material.current} / ${material.target}`}
                        {material.current < material.target ? (
                          <ItemSourcesButton itemId={material.itemId} state={state} />
                        ) : null}
                        {material.carried !== undefined ? (
                          <span
                            className="pl-2 text-[color:var(--rs-text-muted)]"
                            data-mission-requirement-detail
                          >
                            {`Carrying: ${material.carried}`}
                          </span>
                        ) : null}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {!completed && showCurrentObjective ? (
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
              Reward earned: {earnedRewardSummary(mission.earnedReward)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One line describing what a completed Mission actually paid.
 *
 * A bundle lists its items rather than collapsing to a count, because "Reward
 * earned: 2 items" tells the player nothing they wanted to know.
 */
function earnedRewardSummary(reward: NonNullable<MissionProjection["earnedReward"]>): ReactNode {
  switch (reward.kind) {
    case "item":
      return reward.itemName;
    case "credits":
      return <CreditsAmount amount={reward.amount} prefix="+" />;
    case "stack_bundle":
      return reward.items.map((entry) => `${entry.itemName} x${entry.quantity}`).join(", ");
    default:
      return (
        <XpAmount
          amount={reward.amount}
          prefix="+"
          skillId={reward.skillId}
          skillName={reward.skillName}
        />
      );
  }
}

export function MissionLogPanel({
  state,
  focusedMissionId,
  onClose,
  triggerRef,
  presentation = "modal",
  docked,
}: {
  state: PlayGameplayState;
  focusedMissionId?: string;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  presentation?: UtilityPresentation;
  docked?: DockedUtilityRegion;
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
    <UtilitySurface
      docked={docked}
      eyebrow="Mission record"
      label="Mission Log"
      onClose={onClose}
      presentation={presentation}
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
                  state={state}
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
                    state={state}
                    mission={mission}
                    onToggle={() => toggle(mission.missionId)}
                  />
                ))}
              </div>
            )
          ) : null}
        </section>
      </div>
    </UtilitySurface>
  );
}
