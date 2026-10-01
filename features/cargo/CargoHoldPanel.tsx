"use client";

import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { MissionActionButton } from "@/components/ui/MissionActionButton";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { ActivityPanel } from "@/features/shared/ActivityPanel";
import { ActivityContextRow, SkillProgressRow } from "@/features/shared/activity-context";
import { getEffectiveGameBalance } from "@/game/config/balance";
import { ACTION_IDS, GAME_TICK_MS, REPAIR_TARGET_IDS } from "@/game/config/foundations";
import type {
  CargoHoldTransferActionResult,
  PlayActionResult,
  RepairMaterialContributionActionResult,
} from "@/server/actions";
import {
  contributeRepairMaterialsAction,
  depositCargoStackAction,
  depositCargoUniqueItemAction,
  startWeldingAction,
  stopWeldingAction,
  withdrawCargoStackAction,
  withdrawCargoUniqueItemAction,
} from "@/server/actions";
import type { PlayGameplayState } from "@/server/play";
import { deriveMissionGuidanceTargets } from "@/game/domain/missions";
import { CleanPassControl } from "@/features/welding/CleanPassControl";
import { usePlay } from "@/features/play/PlayContext";
import { CARGO_HOLD_STORAGE_LABELS, projectCargoHoldStorage } from "@/features/cargo/cargo-storage";
import {
  StorageTransferSurface,
  type StorageTransferAdapter,
  type StorageTransferHooks,
} from "@/features/storage/StorageTransferSurface";

/**
 * The exact contribution the player is being asked to confirm, keyed by item ID
 * (#209). It is the plan the projection handed over, sent back verbatim, so the
 * server can reject a stale one rather than silently installing a different
 * amount than the dialog described.
 */
type Confirmation = Readonly<Record<string, number>>;

const COMPLETION_FEEDBACK_DURATION_MS = 3_600;

function transferMessage(result: CargoHoldTransferActionResult): string | undefined {
  if ("error" in result) return result.error;
  if (result.cargo.status === "transferred") return "Cargo Hold transfer complete.";
  return result.cargo.message;
}

function weldingMessage(state: PlayGameplayState): string | undefined {
  if (state.weldingError === "welding_unavailable_here")
    return "Welding is available only while stationary at Crash Site.";
  if (state.weldingError === "welding_locked") {
    const repair = state.repairs[REPAIR_TARGET_IDS.cargoHold];
    const required = (repair?.materials ?? [])
      .map((material) => `${material.required} ${material.name}`)
      .join(" and ");
    return `Install ${required} before Welding.`;
  }
  if (state.weldingError === "repair_complete") return "The Cargo Hold is already operational.";
  if (state.commandError === "another_action_active")
    return "Another activity is active. Finish it before starting Welding.";
  return undefined;
}

function resultError(result: PlayActionResult | RepairMaterialContributionActionResult) {
  return "error" in result ? result.error : undefined;
}

export function CargoHoldPanel() {
  const { enqueueForeground, releaseCommand, acceptState, state } = usePlay();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [storageOpen, setStorageOpen] = useState(false);
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState<string>();
  const [completionFeedbackVisible, setCompletionFeedbackVisible] = useState(false);
  const [completionAnnouncement, setCompletionAnnouncement] = useState("");
  const [now, setNow] = useState(Date.now());
  const [, startTransition] = useTransition();
  const balance = getEffectiveGameBalance();
  const repair = state.cargoHold.repair;
  const previousCompletion = useRef(repair.complete);
  const activeWelding = state.activeAction?.actionId === ACTION_IDS.cargoHoldWelding;
  // Mission guidance consumes the ONE derived target set: an accepted mission
  // whose current objective observes this repair target's completion projects
  // its target ID, and this panel — which owns the authoritative
  // repair/material/Welding substate — selects the advancing affordance
  // without any mission-ID branching. Stopping active Welding never advances
  // the mission, so it is never guided.
  const cargoRepairGuided = deriveMissionGuidanceTargets(state.missions).repairTargetIds.has(
    REPAIR_TARGET_IDS.cargoHold,
  );
  const contributionAvailable = repair.canContribute;
  const plannedContribution: Confirmation = Object.fromEntries(
    repair.materials.map((material) => [material.itemId, material.availableContribution]),
  );
  const contributeGuided =
    cargoRepairGuided &&
    !repair.complete &&
    !repair.materialComplete &&
    !activeWelding &&
    contributionAvailable;
  const startWeldingGuided =
    cargoRepairGuided && !repair.complete && repair.materialComplete && !activeWelding;
  const weldingAttemptDurationMs = balance.welding.attemptDurationTicks * GAME_TICK_MS;
  const weldingElapsed = activeWelding
    ? Math.max(0, now - new Date(state.activeAction!.progressStartedAt).getTime())
    : 0;
  const weldingAttemptProgress = activeWelding
    ? Math.min(100, (weldingElapsed / weldingAttemptDurationMs) * 100)
    : 0;
  const secondsRemaining = activeWelding
    ? Math.max(0, (new Date(state.activeAction!.nextAttemptAt).getTime() - now) / 1_000)
    : 0;
  useEffect(() => {
    if (!activeWelding) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [activeWelding]);

  useEffect(() => {
    const wasComplete = previousCompletion.current;
    previousCompletion.current = repair.complete;
    if (wasComplete || !repair.complete) return;

    setCompletionFeedbackVisible(true);
    setCompletionAnnouncement("CARGO HOLD RESTORED");
    const timer = window.setTimeout(() => {
      setCompletionFeedbackVisible(false);
      setCompletionAnnouncement("");
    }, COMPLETION_FEEDBACK_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [repair.complete]);

  function applyStateResult(result: PlayActionResult) {
    const error = resultError(result);
    if (error) {
      setMessage(error);
      return;
    }
    if (!result.state) return;
    acceptState(result.state);
    setMessage(weldingMessage(result.state));
  }

  function runWeldingCommand(intent: "start" | "stop") {
    enqueueForeground(() => {
      setPending(intent);
      startTransition(async () => {
        try {
          const result =
            intent === "start"
              ? await startWeldingAction({
                  characterId: state.characterId,
                  targetId: REPAIR_TARGET_IDS.cargoHold,
                })
              : await stopWeldingAction({
                  characterId: state.characterId,
                  targetId: REPAIR_TARGET_IDS.cargoHold,
                });
          applyStateResult(result);
        } catch {
          setMessage("Comms interruption. Welding status could not be confirmed.");
        } finally {
          releaseCommand();
          setPending(undefined);
        }
      });
    });
  }

  function commitMaterials() {
    if (!confirmation) return;
    enqueueForeground(() => {
      setPending("materials");
      startTransition(async () => {
        try {
          const result = await contributeRepairMaterialsAction({
            characterId: state.characterId,
            targetId: REPAIR_TARGET_IDS.cargoHold,
            expectedMaterials: confirmation,
          });
          if ("error" in result) setMessage(result.error);
          else {
            acceptState(result.state);
            setMessage(
              result.repair.status === "committed"
                ? "Repair materials installed permanently."
                : result.repair.message,
            );
          }
        } catch {
          setMessage("Comms interruption. Repair materials were not confirmed.");
        } finally {
          releaseCommand();
          setPending(undefined);
          setConfirmation(undefined);
        }
      });
    });
  }

  // The Cargo Hold's authoritative transfer commands, handed to the shared
  // storage surface. The command gate, pending/error feedback and Play-state
  // reconciliation stay here with the rest of this ship-specific host.
  function runTransfer(
    action: () => Promise<CargoHoldTransferActionResult>,
    { armFocusReturn }: StorageTransferHooks,
  ) {
    enqueueForeground(() => {
      setPending("transfer");
      startTransition(async () => {
        try {
          const result = await action();
          if ("error" in result) setMessage(result.error);
          else {
            // Armed only on a confirmed non-error result, immediately before
            // the authoritative state that may vacate the selected tile is
            // accepted — never on submission, so a mid-flight render can never
            // consume the arm before the real reconciliation happens.
            armFocusReturn();
            acceptState(result.state);
            setMessage(transferMessage(result));
          }
        } catch {
          setMessage("Comms interruption. Cargo status could not be confirmed.");
        } finally {
          releaseCommand();
          setPending(undefined);
        }
      });
    });
  }

  const cargoTransfers: StorageTransferAdapter = {
    depositStack: (input, hooks) =>
      runTransfer(
        () => depositCargoStackAction({ characterId: state.characterId, ...input }),
        hooks,
      ),
    withdrawStack: (input, hooks) =>
      runTransfer(
        () => withdrawCargoStackAction({ characterId: state.characterId, ...input }),
        hooks,
      ),
    depositUniqueItem: (input, hooks) =>
      runTransfer(
        () => depositCargoUniqueItemAction({ characterId: state.characterId, ...input }),
        hooks,
      ),
    withdrawUniqueItem: (input, hooks) =>
      runTransfer(
        () => withdrawCargoUniqueItemAction({ characterId: state.characterId, ...input }),
        hooks,
      ),
  };

  return (
    // No "CRASH SITE INFRASTRUCTURE" eyebrow any more (#193): the scene plate
    // above this panel already says Crash Site, and the hold naming its own
    // location was one of the repetitions that made the screen this long.
    <ActivityPanel
      title={
        repair.complete
          ? "CARGO HOLD"
          : repair.repairAvailable
            ? "CARGO HOLD REPAIR"
            : "Damaged Cargo Hold"
      }
      data-cargo-hold
    >
      {repair.complete ? (
        <span className="inline-block border border-[color:var(--rs-accent-mining)] px-2 py-1 font-display text-xs uppercase tracking-wide">
          OPERATIONAL
        </span>
      ) : null}

      {repair.complete ? (
        <>
          {completionFeedbackVisible ? (
            <section
              className="rs-result-feedback-success mt-4 border border-[color:var(--rs-accent-mining)] bg-[color:var(--rs-surface-panel)] p-4"
              data-cargo-hold-status="restored"
            >
              <p className="font-display text-lg font-bold uppercase tracking-wide">
                CARGO HOLD RESTORED
              </p>
              <p className="mt-1 text-sm text-[color:var(--rs-text-secondary)]">
                The stationary ship storage is online and ready for use at Crash Site.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="font-display text-sm uppercase tracking-wide">
                  {state.cargoHold.slotsUsed} / {state.cargoHold.capacitySlots} SLOTS OCCUPIED
                </p>
                <ActionButton intent="mining" onClick={() => setStorageOpen((open) => !open)}>
                  {storageOpen ? "CLOSE CARGO HOLD" : "OPEN CARGO HOLD"}
                </ActionButton>
              </div>
            </section>
          ) : (
            <div
              className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--rs-border-structural)] pt-4"
              data-cargo-hold-status="operational"
            >
              <p className="font-display text-sm uppercase tracking-wide">
                {state.cargoHold.slotsUsed} / {state.cargoHold.capacitySlots} SLOTS OCCUPIED
              </p>
              <ActionButton intent="mining" onClick={() => setStorageOpen((open) => !open)}>
                {storageOpen ? "CLOSE CARGO HOLD" : "OPEN CARGO HOLD"}
              </ActionButton>
            </div>
          )}
          {storageOpen ? (
            <div className="mt-4" data-cargo-storage>
              <StorageTransferSurface
                labels={CARGO_HOLD_STORAGE_LABELS}
                onSelectItem={() => setMessage(undefined)}
                pending={Boolean(pending)}
                projection={projectCargoHoldStorage(state)}
                transfers={cargoTransfers}
              />
            </div>
          ) : null}
        </>
      ) : repair.repairAvailable ? (
        <>
          {/* The control the player came for is first (#193). What it needs,
              what it unlocks and what it is for follow it — the same order
              every other activity now uses. */}
          {repair.materialComplete ? (
            <div className="flex flex-wrap items-center gap-3">
              {activeWelding || pending === "stop" ? (
                <ActionButton
                  disabled={Boolean(pending)}
                  intent="danger"
                  loading={pending === "stop"}
                  onClick={() => runWeldingCommand("stop")}
                >
                  STOP WELDING
                </ActionButton>
              ) : repair.weldingProgress < repair.weldingIncrements ? (
                <MissionActionButton
                  guidance={startWeldingGuided ? "active" : undefined}
                  disabled={Boolean(pending)}
                  intent="mining"
                  loading={pending === "start"}
                  onClick={() => runWeldingCommand("start")}
                >
                  START WELDING
                </MissionActionButton>
              ) : null}
              <span className="text-xs uppercase tracking-wide text-[color:var(--rs-text-secondary)]">
                {balance.welding.attemptDurationTicks} ticks /{" "}
                {(balance.welding.attemptDurationTicks * GAME_TICK_MS) / 1000}s per weld pass · +
                {balance.welding.xpPerIncrement} Welding XP
              </span>
            </div>
          ) : (
            <MissionActionButton
              guidance={contributeGuided ? "active" : undefined}
              disabled={Boolean(pending) || !contributionAvailable}
              intent="mining"
              onClick={() => setConfirmation(plannedContribution)}
            >
              CONTRIBUTE MATERIALS
            </MissionActionButton>
          )}
          {activeWelding ? (
            <div className="mt-4">
              <StatusMeter
                detail={`${secondsRemaining.toFixed(1)}s to next weld pass`}
                label="Current welding pass"
                value={weldingAttemptProgress}
              />
              {/* Clean Pass is general Welding, not a Practice feature (#190). */}
              <CleanPassControl cleanPass={repair.cleanPass} />
            </div>
          ) : null}
          {/* One card per authored material row, in recipe order (#209). The
              panel does not know that the Cargo Hold wants Ferrite and Slag;
              it renders whatever the recipe asks for, with the target's own
              authored note underneath when it wrote one. */}
          <div className="mt-4 grid gap-2 sm:grid-cols-2" data-cargo-repair-materials>
            {repair.materials.map((material) => (
              <div
                className="border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3"
                data-cargo-repair-material={material.itemId}
                key={material.itemId}
              >
                <p className="font-display text-xs uppercase tracking-wide">{material.name}</p>
                <p className="mt-1 font-display text-2xl font-bold">
                  {material.contributed} / {material.required}
                </p>
                {material.note ? (
                  <p className="text-xs text-[color:var(--rs-text-secondary)]">{material.note}</p>
                ) : null}
              </div>
            ))}
          </div>
          <div className="mt-4 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3">
            <p className="font-display text-xs uppercase tracking-wide">Welding</p>
            {!repair.materialComplete ? (
              <p className="mt-1 text-sm text-[color:var(--rs-text-secondary)]">
                LOCKED until every material requirement is complete.
              </p>
            ) : (
              <>
                <p className="mt-1 text-sm text-[color:var(--rs-text-secondary)]">
                  Material installation complete.
                </p>
                <div className="mt-3">
                  <StatusMeter
                    detail={`${repair.weldingProgress} / ${repair.weldingIncrements} completed increments`}
                    label="CARGO HOLD REPAIR"
                    value={(repair.weldingProgress / repair.weldingIncrements) * 100}
                  />
                </div>
              </>
            )}
          </div>
          <div className="mt-4 border border-[color:var(--rs-border-subtle)] bg-[color:var(--rs-surface-panel)] p-3">
            <p className="font-display text-xs uppercase tracking-wide">Reward</p>
            <p className="mt-1 text-sm">
              Cargo Hold — {balance.cargoHold.capacitySlots} occupied slots
            </p>
            <p className="mt-1 text-xs text-[color:var(--rs-text-secondary)]">
              No aggregate Cargo mass limit.
            </p>
          </div>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
            Restore the damaged Cargo Hold with replacement plating and packed bulkhead filler.
            Refined Ferrite is structural material; Slag is thermal packing, not a welding tool.
          </p>
          {/* Every weld pass here grants Welding XP, and until #193 this
              surface showed no sign of it — while the Wiki already told
              players that every skill shows its level where it is used. The
              compact row makes that true, using the same projection the
              Workbench reads; nothing about the award changes. */}
          <SkillProgressRow
            level={state.welding.level}
            skill="Welding"
            tone="welding"
            xpIntoLevel={state.welding.xpIntoLevel}
            {...(state.welding.xpToNextLevel === undefined
              ? {}
              : { xpToNextLevel: state.welding.xpToNextLevel })}
          />
          <ActivityContextRow
            items={[
              ...repair.materials.map((material) => ({
                label: `${material.name} carried`,
                quantity: state.carriedByItemId[material.itemId] ?? 0,
              })),
            ]}
          />
        </>
      ) : (
        <p
          className="max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]"
          data-cargo-hold-status="locked"
        >
          The Cargo Hold is buckled from the crash and still inaccessible.
        </p>
      )}
      <p
        aria-atomic="true"
        aria-live="polite"
        className="sr-only"
        data-cargo-hold-announcement
        role="status"
      >
        {completionAnnouncement}
      </p>
      <p aria-live="polite" className="sr-only">
        {message ?? ""}
      </p>
      {message ? (
        <div className="mt-3">
          <Feedback>{message}</Feedback>
        </div>
      ) : null}
      {confirmation ? (
        <div
          aria-label="Confirm Cargo Hold material contribution"
          className="mt-4 border border-[color:var(--rs-accent-danger)] bg-[color:var(--rs-surface-panel)] p-3"
          data-cargo-confirmation
          role="alert"
        >
          <p className="font-display text-sm uppercase tracking-wide text-[color:var(--rs-accent-danger)]">
            Commit to Cargo Hold repair
          </p>
          <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
            {repair.materials.map((material, index) => (
              <Fragment key={material.itemId}>
                {index > 0 ? <br /> : null}
                {material.name} ×{confirmation[material.itemId] ?? 0}
              </Fragment>
            ))}
          </p>
          <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
            These materials become permanently installed and cannot be recovered.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton
              disabled={Boolean(pending)}
              intent="secondary"
              onClick={() => setConfirmation(undefined)}
            >
              CANCEL
            </ActionButton>
            <ActionButton
              disabled={Boolean(pending)}
              intent="danger"
              loading={pending === "materials"}
              onClick={commitMaterials}
            >
              COMMIT MATERIALS
            </ActionButton>
          </div>
        </div>
      ) : null}
    </ActivityPanel>
  );
}
