"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePlay } from "@/features/play/PlayContext";
import { ActivityPanel } from "@/features/shared/ActivityPanel";
import { RepairWorkPanel } from "@/features/welding/RepairWorkPanel";
import { getRepairTarget } from "@/game/content/repair-targets";
import { deriveCompletedMissionIds } from "@/game/domain/missions";
import { completedRepairStatus } from "@/game/domain/repair-targets";

/**
 * Where a ship system is in its life (#322), read from nothing but its repair
 * target's projection:
 *
 * - `offline`: visible, damaged, and not yet something the player has been given
 *   the job of repairing. Noninteractive and compact.
 * - `repair`: the target's authorization is active and the repair is unfinished.
 * - `complete`: the repair is finished, and stays finished.
 *
 * There is no fourth flag to drift: authorization and completion are the
 * existing `repairAvailable` and `complete` facts.
 */
export type ShipSystemState = "offline" | "repair" | "complete";

export function deriveShipSystemState(
  repair: { repairAvailable: boolean; complete: boolean } | undefined,
): ShipSystemState {
  if (repair?.complete) return "complete";
  if (repair?.repairAvailable) return "repair";
  return "offline";
}

const RESTORED_ANNOUNCEMENT_MS = 3_600;

type ShipSystemContentProps = {
  targetId: string;
  /** Copy under the install control while material is outstanding. */
  materialsPrompt: string;
  /** Copy under Start Welding once the material is in. */
  weldingPrompt: string;
  /** System-specific content of the finished system. */
  children?: (context: { justCompleted: boolean }) => ReactNode;
};

/**
 * One ship system's state and its restoration moment, shared by the standalone
 * panel and the Ship panel's section so the two can never drift (#358).
 */
function useShipSystem(targetId: string) {
  const { state } = usePlay();
  const definition = getRepairTarget(targetId);
  const systemState = deriveShipSystemState(state.repairs[targetId]);
  const complete = systemState === "complete";
  const previousComplete = useRef(complete);
  const [justCompleted, setJustCompleted] = useState(false);

  useEffect(() => {
    const wasComplete = previousComplete.current;
    previousComplete.current = complete;
    if (wasComplete || !complete) return;
    setJustCompleted(true);
    const timer = window.setTimeout(() => setJustCompleted(false), RESTORED_ANNOUNCEMENT_MS);
    return () => window.clearTimeout(timer);
  }, [complete]);

  return { state, definition, systemState, justCompleted };
}

/** What a system says and offers in each of its three states. */
function ShipSystemContent({
  targetId,
  materialsPrompt,
  weldingPrompt,
  children,
  definition,
  systemState,
  justCompleted,
  completedMissionIds,
}: ShipSystemContentProps & {
  definition: NonNullable<ReturnType<typeof getRepairTarget>>;
  systemState: ShipSystemState;
  justCompleted: boolean;
  completedMissionIds: ReadonlySet<string>;
}) {
  return (
    <>
      <p
        aria-atomic="true"
        aria-live="polite"
        className="sr-only"
        data-ship-system-announcement
        role="status"
      >
        {justCompleted ? `${definition.displayName} restored.` : ""}
      </p>
      {systemState === "offline" ? (
        <p
          className="max-w-2xl text-sm leading-relaxed text-[color:var(--rs-text-secondary)]"
          data-ship-system-status="offline"
        >
          {definition.offlineStatus ?? "Damaged."}
        </p>
      ) : systemState === "repair" ? (
        <RepairWorkPanel
          embedded
          materialsPrompt={materialsPrompt}
          targetId={targetId}
          title={definition.displayName}
          weldingPrompt={weldingPrompt}
        />
      ) : (
        <>
          <p
            className="text-sm font-semibold text-[color:var(--rs-text-secondary)]"
            data-ship-system-status="complete"
          >
            {completedRepairStatus(definition, completedMissionIds)}
          </p>
          {children?.({ justCompleted })}
        </>
      )}
    </>
  );
}

/**
 * The one presentation every major system on the crashed ship shares: the
 * Cargo Hold, the Landing Gear and the Propulsion System.
 *
 * Visible damaged system → repair authorized → the standard repair presentation
 * → completed system. Progression changes whether a system is actionable, never
 * whether the player can see that the ship has it, so a system is on screen from
 * the start and this shell decides only what it says and offers.
 *
 * The shell knows no Mission and no system. Which target it shows, what it is
 * called, and what it says while offline and once finished all come from the
 * repair-target registry (`game/content/repair-targets`); authorization and
 * completion come from the target's projection. What a finished system does for
 * the player — the Cargo Hold's storage — is passed in as `children`, and
 * `justCompleted` lets that content mark the moment of restoration without
 * owning the transition.
 *
 * Only the crashed ship's systems use it. The Deep Jag brace, the Crew Stop and
 * the stash mounts are not parts of the player's ship and keep the plain repair
 * panel.
 */
export function ShipSystemPanel({
  targetId,
  materialsPrompt,
  weldingPrompt,
  children,
  ...rest
}: ShipSystemContentProps & Omit<React.HTMLAttributes<HTMLElement>, "title" | "children">) {
  const { state, definition, systemState, justCompleted } = useShipSystem(targetId);
  if (!definition) return null;

  return (
    <ActivityPanel
      data-ship-system={targetId}
      data-ship-system-state={systemState}
      eyebrow="Ship"
      title={definition.displayName}
      {...rest}
    >
      <ShipSystemContent
        completedMissionIds={deriveCompletedMissionIds(state.missions)}
        definition={definition}
        justCompleted={justCompleted}
        materialsPrompt={materialsPrompt}
        systemState={systemState}
        targetId={targetId}
        weldingPrompt={weldingPrompt}
      >
        {children}
      </ShipSystemContent>
    </ActivityPanel>
  );
}

/**
 * The same system as a section of the single Ship panel (#358): identical
 * states, copy and repair interaction, but without a card of its own, so the
 * ship reads as one place rather than three stacked panels. It keeps the
 * `data-ship-system` identity, so Mission guidance and the repair work point
 * at exactly what they always have.
 */
export function ShipSystemSection({
  targetId,
  materialsPrompt,
  weldingPrompt,
  children,
  ...rest
}: ShipSystemContentProps & Omit<React.HTMLAttributes<HTMLElement>, "title" | "children">) {
  const { state, definition, systemState, justCompleted } = useShipSystem(targetId);
  if (!definition) return null;

  return (
    <section
      className="space-y-3 border-t border-[color:var(--rs-border-structural)] pt-3 first:border-t-0 first:pt-0"
      data-ship-system={targetId}
      data-ship-system-state={systemState}
      {...rest}
    >
      <h3 className="font-display text-sm font-bold uppercase tracking-[0.12em] text-[color:var(--rs-text-primary)]">
        {definition.displayName}
      </h3>
      <ShipSystemContent
        completedMissionIds={deriveCompletedMissionIds(state.missions)}
        definition={definition}
        justCompleted={justCompleted}
        materialsPrompt={materialsPrompt}
        systemState={systemState}
        targetId={targetId}
        weldingPrompt={weldingPrompt}
      >
        {children}
      </ShipSystemContent>
    </section>
  );
}
