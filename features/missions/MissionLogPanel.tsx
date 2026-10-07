"use client";

import { ChevronDown, ChevronUp, Pin, PinOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import {
  UtilitySurface,
  type DockedUtilityRegion,
  type UtilityPresentation,
} from "@/components/ui/UtilitySurface";
import { XpAmount } from "@/components/ui/XpAmount";
import { CreditsAmount } from "@/components/ui/CreditsAmount";
import { Feedback } from "@/components/ui/Feedback";
import { ItemSourcesButton } from "@/features/item-sources/ItemSourcesButton";
import {
  MISSION_STANDING_LABELS,
  missionGuidancePhase,
  type MissionProjection,
} from "@/game/domain/missions";
import type { PlayGameplayState } from "@/server/play";
import { guidanceMissions, isMissionPinned } from "./mission-pins";
import { useMissionPin } from "./useMissionPin";

function formatCompletedDate(completedAt: Date | null | undefined): string | undefined {
  if (!completedAt) return undefined;
  const date = completedAt instanceof Date ? completedAt : new Date(completedAt);
  if (!Number.isFinite(date.getTime())) return undefined;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * The Pin toggle in an active card's header (#325). One setting, so the name
 * stays "Pin <Mission>" and `aria-pressed` says whether it is on; it latches in
 * `primary` like every toggle that belongs to no skill. It sits beside the
 * expand control, never inside it, so pinning never needs the card opened.
 */
function MissionPinToggle({
  mission,
  onToggle,
  pending,
  pinned,
}: {
  mission: MissionProjection;
  onToggle: () => void;
  pending: boolean;
  pinned: boolean;
}) {
  const Icon = pinned ? Pin : PinOff;
  return (
    // Never disabled mid-change, so keyboard focus stays on it (see
    // `useMissionPin`); `aria-busy` says the change is still being confirmed.
    <ActionButton
      aria-busy={pending || undefined}
      aria-label={`Pin ${mission.title}`}
      aria-pressed={pinned}
      className="w-[var(--rs-touch-target)] shrink-0 px-0 aria-busy:opacity-60"
      data-mission-log-pin={mission.missionId}
      intent={pinned ? "primary" : "secondary"}
      onClick={onToggle}
      title={pinned ? "Pinned to Current Missions" : "Not pinned"}
    >
      <Icon aria-hidden="true" className="h-4 w-4" fill={pinned ? "currentColor" : "none"} />
    </ActionButton>
  );
}

/** A small uppercase section label inside an expanded card. */
function CardLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`font-display text-[10px] font-bold uppercase tracking-[0.16em] ${className}`}>
      {children}
    </p>
  );
}

function MissionEntry({
  mission,
  expanded,
  onToggle,
  pin,
  state,
}: {
  mission: MissionProjection;
  expanded: boolean;
  onToggle: () => void;
  /** Present only on an active Mission: completed Missions cannot be pinned. */
  pin?: { onToggle: () => void; pending: boolean; pinned: boolean };
  state: PlayGameplayState;
}) {
  const completed = mission.state === "completed";
  // The same phase the strips colour by: green work, blue turn-in.
  const phase = completed ? undefined : missionGuidancePhase(mission);
  const completedDate = completed ? formatCompletedDate(mission.completedAt) : undefined;
  const requirements = mission.requirements ?? [];
  const bodyId = `mission-log-body-${mission.missionId}`;
  return (
    <article
      aria-label={mission.title}
      className={`rs-mission-card border border-l-2 border-[color:var(--rs-border-structural)] ${completed ? "bg-[color:var(--rs-surface-raised)]" : "bg-[color:var(--rs-surface-panel)]"}`}
      data-mission-log-entry={mission.missionId}
      data-mission-log-state={mission.state}
      data-mission-phase={phase}
    >
      <div className="flex items-stretch">
        <button
          aria-controls={expanded ? bodyId : undefined}
          aria-expanded={expanded}
          className="rs-focus flex min-h-[var(--rs-touch-target)] min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2 text-left"
          onClick={onToggle}
          type="button"
        >
          <span className="min-w-0">
            <span
              className={`block truncate font-display text-sm font-bold uppercase tracking-wide ${completed ? "text-[color:var(--rs-text-secondary)]" : "text-[color:var(--rs-text-primary)]"}`}
              data-mission-log-title
            >
              {mission.title}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className="rs-mission-phase-plate px-1.5 py-px font-display text-[10px] font-bold uppercase leading-4 tracking-[0.14em]"
                data-mission-log-phase
              >
                {MISSION_STANDING_LABELS[phase ?? "completed"]}
              </span>
              {completedDate ? (
                <span className="text-xs text-[color:var(--rs-text-muted)]">{completedDate}</span>
              ) : null}
            </span>
          </span>
          {expanded ? (
            <ChevronUp
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-[color:var(--rs-text-muted)]"
            />
          ) : (
            <ChevronDown
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-[color:var(--rs-text-muted)]"
            />
          )}
        </button>
        {pin ? (
          <div className="flex shrink-0 items-center border-l border-[color:var(--rs-border-subtle)] px-2">
            <MissionPinToggle mission={mission} {...pin} />
          </div>
        ) : null}
      </div>
      {expanded ? (
        <div className="border-t border-[color:var(--rs-border-subtle)] px-3 pb-3 pt-2" id={bodyId}>
          <p className="text-xs leading-relaxed text-[color:var(--rs-text-secondary)]">
            {mission.summary}
          </p>
          {!completed ? (
            // The strongest thing in the card: what to do now, before the
            // checklist that backs it up.
            <div
              className="rs-mission-objective-block mt-2.5 bg-[color:var(--rs-surface-control)] px-2.5 py-2"
              data-mission-log-current
            >
              <CardLabel className="rs-mission-objective-block__label">Current objective</CardLabel>
              <p
                className="mt-0.5 text-sm font-semibold leading-snug text-[color:var(--rs-text-primary)]"
                data-mission-log-next={phase === "turn_in" ? "turn-in" : "objective"}
              >
                {mission.currentObjective}
              </p>
            </div>
          ) : null}
          {!completed && requirements.length > 0 ? (
            <div className="mt-3">
              <CardLabel className="text-[color:var(--rs-text-muted)]">Progress</CardLabel>
              <ul className="mt-1.5 space-y-1.5" data-mission-log-requirements>
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
                          {!material.satisfied ? (
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
            </div>
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
    </article>
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
  // The same active list Current Missions filters by pin, so the Missions
  // offered a Pin toggle are exactly the ones a strip can show.
  const active = guidanceMissions(state);
  const completed = state.missions.filter((mission) => mission.state === "completed");
  const [expandedId, setExpandedId] = useState<string | undefined>(
    focusedMissionId ??
      active.find((mission) => mission.state === "ready_for_completion")?.missionId ??
      active[0]?.missionId,
  );
  const [completedOpen, setCompletedOpen] = useState(false);
  const { message, pendingMissionId, setPinned } = useMissionPin();

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
        {message ? <Feedback tone="danger">{message}</Feedback> : null}
        <section aria-label="Active missions" data-mission-log-section="active">
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-mission-accent-strong)]">
              Active{active.length > 0 ? ` (${active.length})` : ""}
            </h3>
            {active.length > 0 ? (
              <p className="text-xs text-[color:var(--rs-text-muted)]">
                Pinned Missions show in Current Missions.
              </p>
            ) : null}
          </div>
          {active.length === 0 ? (
            <p
              className="mt-2 text-sm text-[color:var(--rs-text-secondary)]"
              data-mission-log-empty
            >
              No active missions. Talk to people you meet and explore the world.
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              {active.map((mission) => {
                const pinned = isMissionPinned(state, mission.missionId);
                return (
                  <MissionEntry
                    expanded={expandedId === mission.missionId}
                    key={mission.missionId}
                    state={state}
                    mission={mission}
                    onToggle={() => toggle(mission.missionId)}
                    pin={{
                      onToggle: () => setPinned(mission.missionId, !pinned),
                      pending: pendingMissionId === mission.missionId,
                      pinned,
                    }}
                  />
                );
              })}
            </div>
          )}
        </section>
        <section aria-label="Completed missions" data-mission-log-section="completed">
          <button
            aria-expanded={completedOpen}
            className="rs-focus mt-3 flex min-h-[var(--rs-touch-target)] w-full items-center justify-between gap-3 border-t border-[color:var(--rs-border-subtle)] text-left"
            onClick={() => setCompletedOpen((open) => !open)}
            type="button"
          >
            <span className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-text-muted)]">
              Completed{completed.length > 0 ? ` (${completed.length})` : ""}
            </span>
            {completedOpen ? (
              <ChevronUp aria-hidden="true" className="h-4 w-4 text-[color:var(--rs-text-muted)]" />
            ) : (
              <ChevronDown
                aria-hidden="true"
                className="h-4 w-4 text-[color:var(--rs-text-muted)]"
              />
            )}
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
