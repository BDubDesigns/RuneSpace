"use client";

import { useEffect, useId, useState } from "react";
import { InventoryStackVisual } from "@/components/items/InventoryStackVisual";
import { ItemVisual } from "@/components/items/ItemVisual";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { BoundedRunProgress } from "@/features/shared/BoundedRunControl";
import { BATCH_UNIT } from "@/features/fabrication/station-copy";
import { BOUNDED_RUN_MAX } from "@/game/domain/bounded-run";
import type {
  FabricationProjection,
  FabricationRecipeProjection,
  ManualOverrideProjection,
} from "@/server/play";
import { XpAmount } from "@/components/ui/XpAmount";
import { SKILL_IDS } from "@/game/config/foundations";

/**
 * The workpiece on the machine (#232), as one compact live panel: the output's
 * canonical visual anchored on the left, the production details beside it, and
 * — when Manual Override is on this workpiece — its Load, Trend, Feed,
 * multiplier and Lock In expanding inside the same panel, so the item never
 * loses its identity to the machine controls. On a phone the two columns stack
 * rather than shrink.
 *
 * Every number is the server's. The timer is presentation of the workpiece's
 * authoritative start and duration; what happens at 0 is the server's call.
 */
export function LiveWorkpiecePanel({
  busy,
  onFinishCurrent,
  onLockIn,
  onPush,
  onToggleOverride,
  pending,
  recipe,
  station,
}: {
  busy: boolean;
  onFinishCurrent: () => void;
  onLockIn: () => void;
  onPush: (feed: number) => void;
  onToggleOverride: (enabled: boolean) => void;
  pending?: string;
  recipe: FabricationRecipeProjection;
  station: FabricationProjection;
}) {
  const workpiece = station.workpiece!;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(clock);
  }, []);
  const startsAt = new Date(workpiece.startedAt).getTime();
  const endsAt = new Date(workpiece.endsAt).getTime();
  const remainingMs = Math.max(0, endsAt - now);
  const timerDone = remainingMs === 0;
  const override = workpiece.override;
  const held = timerDone && override !== undefined && !override.locked;
  const run = station.run;
  const lastRunWorkpiece = run.selection !== BOUNDED_RUN_MAX && workpiece.sequence >= run.selection;

  return (
    <section
      aria-label="Workpiece on the machine"
      className="border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3"
      data-live-workpiece
      data-workpiece-sequence={workpiece.sequence}
      data-workpiece-held={String(held)}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="w-28 shrink-0">
          {recipe.outputStackLimit !== undefined ? (
            <InventoryStackVisual
              itemId={recipe.outputItemId}
              name={recipe.outputName}
              quantity={recipe.outputQuantity}
              stackLimit={recipe.outputStackLimit}
            />
          ) : (
            <ItemVisual itemId={recipe.outputItemId} name={recipe.outputName} />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-display text-sm font-bold uppercase tracking-wide">
            {recipe.outputName}
          </p>
          <p className="text-xs text-[color:var(--rs-text-secondary)]">
            {recipe.inputs.map((input) => `${input.quantity} ${input.name}`).join(" + ")} &rarr;{" "}
            {recipe.outputQuantity} {recipe.outputName}
          </p>
          <BoundedRunProgress completed={run.batches} selection={run.selection} unit={BATCH_UNIT} />
          <StatusMeter
            detail={
              held
                ? "Waiting on you"
                : timerDone
                  ? "Resolving"
                  : `${(remainingMs / 1000).toFixed(1)}s`
            }
            label={`Workpiece ${workpiece.sequence}`}
            value={
              endsAt === startsAt
                ? 100
                : Math.min(100, ((now - startsAt) / (endsAt - startsAt)) * 100)
            }
          />
        </div>
      </div>

      {held ? (
        <Feedback tone="muted">
          The piece is finished and holding on the machine. Lock In to take it, or push again.
        </Feedback>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <ActionButton
          aria-pressed={station.manualOverrideEnabled}
          data-manual-override-toggle
          disabled={busy && pending !== "override"}
          intent={station.manualOverrideEnabled ? "fabrication" : "secondary"}
          loading={pending === "override"}
          onClick={() => onToggleOverride(!station.manualOverrideEnabled)}
        >
          Manual Override: {station.manualOverrideEnabled ? "On" : "Off"}
        </ActionButton>
        {lastRunWorkpiece ? null : (
          <ActionButton
            aria-pressed={workpiece.finishCurrent}
            data-fabrication-finish
            data-fabrication-finish-armed={String(workpiece.finishCurrent)}
            disabled={workpiece.finishCurrent || (busy && pending !== "finish")}
            intent={workpiece.finishCurrent ? "success" : "secondary"}
            loading={pending === "finish"}
            onClick={onFinishCurrent}
          >
            {workpiece.finishCurrent
              ? "Stopping After This Workpiece"
              : "Stop After This Workpiece"}
          </ActionButton>
        )}
      </div>
      {workpiece.finishCurrent ? (
        <Feedback tone="muted">
          The run ends when this workpiece resolves. Nothing further is reserved.
        </Feedback>
      ) : null}

      {override ? (
        <ManualOverrideControls
          busy={busy}
          onLockIn={onLockIn}
          onPush={onPush}
          override={override}
          pending={pending}
          timerDone={timerDone}
        />
      ) : null}
    </section>
  );
}

function ManualOverrideControls({
  busy,
  onLockIn,
  onPush,
  override,
  pending,
  timerDone,
}: {
  busy: boolean;
  onLockIn: () => void;
  onPush: (feed: number) => void;
  override: ManualOverrideProjection;
  pending?: string;
  timerDone: boolean;
}) {
  const legendId = useId();
  const [feed, setFeed] = useState(override.load);
  // A new machine state — a push landed, or a fresh workpiece — starts the
  // dial on the Load the player can see.
  useEffect(() => setFeed(override.load), [override.load, override.pushes]);
  const dial = Array.from(
    { length: override.dial.maximum - override.dial.minimum + 1 },
    (_, index) => override.dial.minimum + index,
  );
  const last = override.lastPush;
  return (
    <div
      className="mt-3 space-y-3 border-t border-[color:var(--rs-border-structural)] pt-3"
      data-manual-override
      data-override-load={override.load}
      data-override-trend={override.trend}
      data-override-locked={String(override.locked)}
    >
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-text-muted)]">
          Load{" "}
          <strong className="text-2xl text-[color:var(--rs-text-primary)]" data-override-load-value>
            {override.load}
          </strong>
        </p>
        <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-text-muted)]">
          Trend{" "}
          <strong
            className="text-base text-[color:var(--rs-accent-primary)]"
            data-override-trend-value
          >
            {override.trend === "higher" ? "▲ Higher" : "▼ Lower"}
          </strong>
        </p>
        <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-text-muted)]">
          Multiplier{" "}
          <strong
            className="text-base text-[color:var(--rs-accent-success)]"
            data-override-multiplier
          >
            {override.multiplierLabel}
          </strong>
        </p>
        <p className="text-xs text-[color:var(--rs-text-secondary)]" data-override-pushes>
          Push {override.pushes} / {override.maximumPushes} ·{" "}
          <XpAmount amount={override.xpIfLockedIn} skillId={SKILL_IDS.fabrication} /> if locked now
        </p>
      </div>
      {last ? (
        <p
          className="text-sm text-[color:var(--rs-text-secondary)]"
          data-override-last-push
          role="status"
        >
          Fed {last.feed}. Load went to {last.load} (safe {last.safeRange.minimum}–
          {last.safeRange.maximum}). {last.outcome === "exact" ? "Exact — ×1.30." : "Safe — ×1.20."}
        </p>
      ) : null}
      {override.locked ? (
        <Feedback tone="success">
          Locked in at {override.multiplierLabel}.{" "}
          {timerDone ? "Resolving." : "It finishes when the timer runs out."}
        </Feedback>
      ) : (
        <>
          <fieldset aria-labelledby={legendId} className="min-w-0" disabled={busy}>
            <legend
              className="font-display text-xs font-bold uppercase tracking-[0.16em] text-[color:var(--rs-accent-primary)]"
              id={legendId}
            >
              Feed
            </legend>
            <div className="mt-2 grid grid-cols-5 gap-1.5 sm:grid-cols-10" role="radiogroup">
              {dial.map((setting) => (
                <label
                  className={`flex min-h-[var(--rs-touch-target)] cursor-pointer items-center justify-center border font-display text-sm focus-within:outline focus-within:outline-2 focus-within:outline-[color:var(--rs-focus-ring)] ${
                    feed === setting
                      ? "border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-surface-raised)]"
                      : "border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)]"
                  }`}
                  key={setting}
                >
                  <input
                    checked={feed === setting}
                    className="sr-only"
                    data-override-feed={setting}
                    name="manual-override-feed"
                    onChange={() => setFeed(setting)}
                    type="radio"
                    value={setting}
                  />
                  {setting}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <ActionButton
              data-override-push
              disabled={!override.canPush || (busy && pending !== "push")}
              intent="danger"
              loading={pending === "push"}
              onClick={() => onPush(feed)}
            >
              Push at Feed {feed}
            </ActionButton>
            <ActionButton
              data-override-lock-in
              disabled={busy && pending !== "lock"}
              intent="success"
              loading={pending === "lock"}
              onClick={onLockIn}
            >
              Lock In {override.multiplierLabel}
            </ActionButton>
          </div>
        </>
      )}
    </div>
  );
}
