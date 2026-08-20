"use client";

import { useEffect, useRef, useState } from "react";
import { ItemVisual } from "@/components/items/ItemVisual";
import { ActionButton } from "@/components/ui/ActionButton";
import { Drawer } from "@/components/ui/Drawer";
import { Feedback } from "@/components/ui/Feedback";
import { SectionHeader } from "@/components/ui/SectionHeader";
import type { ScavengeOutcome } from "@/game/content/scavenge";
import { acknowledgeScavengeRevealAction } from "@/server/actions";
import type { ScavengeResolvedOutcome } from "@/server/mining";
import { useMiningPlay } from "@/features/mining/MiningPlayContext";
import {
  createScavengeReelAnimationPlan,
  SCAVENGE_REEL_CYCLE_COUNT,
  scavengeReelPanels,
  type ScavengeReelAnimationPlan,
} from "./scavenge-reel";

const AUTO_SKIP_REEL_STORAGE_KEY = "runespace-auto-skip-reel";
const REEL_PANEL_COLORS = [
  "bg-[color:var(--rs-surface-panel)]",
  "bg-[color:var(--rs-surface-raised)]",
  "bg-[color:var(--rs-surface-page)]",
] as const;

function reelPanelClass(outcome: ScavengeOutcome, index: number): string {
  if (!outcome.itemId) {
    return outcome.id === "whammy"
      ? "bg-[color:var(--rs-accent-danger-subtle)] text-[color:var(--rs-accent-danger)]"
      : "bg-[color:var(--rs-accent-arcane-subtle)] text-[color:var(--rs-text-primary)]";
  }
  return `${REEL_PANEL_COLORS[index % REEL_PANEL_COLORS.length]} text-[color:var(--rs-text-primary)]`;
}

function ScavengeReel({
  durationMs,
  offsetY,
  spinning,
  outcomeId,
}: {
  durationMs: number;
  offsetY: number;
  spinning: boolean;
  outcomeId: ScavengeResolvedOutcome["outcomeId"];
}) {
  const panels = scavengeReelPanels();
  return (
    <div
      aria-label="Weighted Scavenge prize reel"
      className="relative mx-auto w-full max-w-[22rem]"
      data-scavenge-reel
      role="img"
    >
      <div className="relative h-[19rem] overflow-hidden border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-page)] [box-shadow:inset_0_0_1.5rem_rgb(0_0_0_/_0.35)]">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-20 h-px -translate-y-1/2">
          <span
            aria-hidden="true"
            className="absolute left-0 top-1/2 h-4 w-5 -translate-y-1/2 bg-[color:var(--rs-accent-mining)] drop-shadow-[0_0_0.35rem_var(--rs-accent-mining)] [clip-path:polygon(0_0,100%_50%,0_100%)]"
            data-scavenge-reel-pointer
          />
          <span className="absolute inset-y-0 left-5 right-0 bg-[color:var(--rs-accent-mining)] shadow-[0_0_0.45rem_var(--rs-accent-mining)]" />
        </div>
        <div
          className="absolute inset-x-0 top-0 will-change-transform"
          data-scavenge-reel-strip
          style={{
            transform: `translate3d(0, -${offsetY}px, 0)`,
            transition: spinning
              ? `transform ${durationMs}ms cubic-bezier(0.12, 0.72, 0.2, 1)`
              : "none",
          }}
        >
          {Array.from({ length: SCAVENGE_REEL_CYCLE_COUNT }, (_, cycleIndex) =>
            panels.map((panel, panelIndex) => (
              <div
                aria-hidden="true"
                className={`flex items-center justify-center border-b border-[color:var(--rs-border-structural)] px-4 text-center font-display text-sm font-bold uppercase tracking-[0.12em] sm:text-base ${reelPanelClass(panel, panelIndex)}`}
                data-scavenge-reel-cycle={cycleIndex}
                data-scavenge-reel-panel={panel.id}
                key={`${cycleIndex}-${panel.id}`}
                style={{ height: `${panel.heightPx}px` }}
              >
                {panel.label}
              </div>
            )),
          )}
        </div>
      </div>
      <span className="sr-only">Winning prize panel: {outcomeId}</span>
    </div>
  );
}

function ScavengeResult({ outcome }: { outcome: ScavengeResolvedOutcome }) {
  return (
    <section
      aria-label="Authoritative Scavenge result"
      className="border border-[color:var(--rs-accent-mining)] bg-[color:var(--rs-accent-mining-subtle)] p-3"
      data-scavenge-result={outcome.outcomeId}
    >
      <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-mining)]">
        Authoritative result
      </p>
      <p className="mt-2 font-display text-lg font-bold text-[color:var(--rs-text-primary)]">
        {outcome.label}
      </p>
      {outcome.itemId && outcome.quantity > 0 ? (
        <div className="mt-3 max-w-[9rem]">
          <ItemVisual
            accessibleLabel={`${outcome.quantity} ${outcome.label.replace(/ x\d+$/, "")} awarded`}
            itemId={outcome.itemId}
            name={outcome.label.replace(/ x\d+$/, "")}
            quantity={outcome.quantity}
          />
        </div>
      ) : (
        <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
          No item this time. The joke is harmless, and nothing was lost.
        </p>
      )}
    </section>
  );
}

function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reducedMotion;
}

export function ScavengeRevealOverlay() {
  const {
    acceptState,
    enqueueForeground,
    foregroundBusy,
    releaseCommand,
    requestAutoRefresh,
    state,
  } = useMiningPlay();
  const reveal = state.scavengeReveals[0];
  const reducedMotion = useReducedMotion();
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const spinTimer = useRef<number | undefined>(undefined);
  const previousRevealId = useRef<string | undefined>(undefined);
  const [autoSkipReel, setAutoSkipReel] = useState(false);
  const [autoSkipReelForReveal, setAutoSkipReelForReveal] = useState(false);
  const [skipPreferenceReady, setSkipPreferenceReady] = useState(false);
  const [reelPlan, setReelPlan] = useState<ScavengeReelAnimationPlan>();
  const [reelOffset, setReelOffset] = useState(0);
  const [stage, setStage] = useState<"pending" | "spinning" | "revealed">("pending");
  const [acknowledging, setAcknowledging] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    try {
      const storedPreference = window.localStorage.getItem(AUTO_SKIP_REEL_STORAGE_KEY) === "1";
      setAutoSkipReel(storedPreference);
    } catch {
      // Storage is optional; the default keeps the reel available.
    } finally {
      setSkipPreferenceReady(true);
    }
  }, []);

  useEffect(() => {
    if (!reveal || !skipPreferenceReady || reveal.revealId === previousRevealId.current) return;
    previousRevealId.current = reveal.revealId;
    const plan = createScavengeReelAnimationPlan({
      outcomeId: reveal.outcomeId,
      initialRandom: Math.random(),
      landingRandom: Math.random(),
      cycleRandom: Math.random(),
      durationRandom: Math.random(),
    });
    setReelPlan(plan);
    setReelOffset(plan.initialOffsetPx);
    setAutoSkipReelForReveal(autoSkipReel);
    setStage(autoSkipReel || reducedMotion ? "revealed" : "pending");
    setMessage(undefined);
    setAcknowledging(false);
  }, [autoSkipReel, reducedMotion, reveal, skipPreferenceReady]);

  useEffect(() => {
    if (
      reveal &&
      stage === "pending" &&
      (reducedMotion || (skipPreferenceReady && autoSkipReelForReveal))
    ) {
      setStage("revealed");
    }
  }, [autoSkipReelForReveal, reducedMotion, reveal, skipPreferenceReady, stage]);

  useEffect(
    () => () => {
      if (spinTimer.current !== undefined) window.clearTimeout(spinTimer.current);
    },
    [],
  );

  if (!reveal || !reelPlan || reelPlan.outcomeId !== reveal.outcomeId) return null;

  const revealId = reveal.revealId;
  const outcome = reveal;
  const activeReelPlan = reelPlan;

  function startSpin() {
    if (stage !== "pending") return;
    setStage("spinning");
    setReelOffset(activeReelPlan.destinationOffsetPx);
    spinTimer.current = window.setTimeout(() => {
      setStage("revealed");
      spinTimer.current = undefined;
    }, activeReelPlan.durationMs);
  }

  function skipReveal() {
    if (stage === "pending") setStage("revealed");
  }

  function acknowledge() {
    if (stage !== "revealed" || acknowledging) return;
    enqueueForeground(() => {
      setAcknowledging(true);
      void (async () => {
        try {
          const result = await acknowledgeScavengeRevealAction({
            characterId: state.characterId,
            revealId,
          });
          if ("error" in result) {
            setMessage(result.error);
            return;
          }
          acceptState(result.state);
        } catch {
          setMessage("Comms interruption. The reveal is still available.");
          requestAutoRefresh();
        } finally {
          setAcknowledging(false);
          releaseCommand();
        }
      })();
    });
  }

  function setAutoSkipReelPreference(next: boolean) {
    setAutoSkipReel(next);
    try {
      window.localStorage.setItem(AUTO_SKIP_REEL_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Storage is optional; the current reveal still has its explicit bypass.
    }
  }

  return (
    <Drawer
      dismissible={false}
      eyebrow="Optional Travel bonus"
      initialFocusRef={primaryButtonRef}
      label="Scavenge reveal"
      onClose={() => undefined}
      size="wide"
      title="Scavenge reveal"
      triggerRef={triggerRef}
    >
      <div className="mt-4 space-y-4" data-scavenge-reveal={reveal.revealId}>
        <p className="text-sm leading-relaxed text-[color:var(--rs-text-secondary)]">
          The reward was resolved and committed before this reveal opened. Travel continues on its
          ordinary schedule underneath this presentation.
        </p>

        {stage === "pending" || stage === "spinning" ? (
          <>
            <ScavengeReel
              durationMs={activeReelPlan.durationMs}
              offsetY={reelOffset}
              outcomeId={outcome.outcomeId}
              spinning={stage === "spinning"}
            />
            <div className="flex flex-wrap gap-3">
              <ActionButton
                ref={primaryButtonRef}
                disabled={stage === "spinning"}
                intent="primary"
                onClick={startSpin}
              >
                {stage === "spinning" ? "Reeling…" : "START REEL"}
              </ActionButton>
              {stage === "pending" ? (
                <ActionButton intent="secondary" onClick={skipReveal}>
                  Skip reveal
                </ActionButton>
              ) : null}
            </div>
            <p aria-live="polite" className="sr-only">
              {stage === "spinning"
                ? "Scavenge prize reel is moving."
                : "Scavenge prize reel is ready."}
            </p>
          </>
        ) : (
          <>
            <ScavengeResult outcome={outcome} />
            <div className="flex flex-wrap items-center gap-3">
              <ActionButton
                ref={primaryButtonRef}
                intent="primary"
                loading={foregroundBusy && acknowledging}
                onClick={acknowledge}
              >
                DONE
              </ActionButton>
              <label className="inline-flex min-h-[var(--rs-touch-target)] items-center gap-2 text-sm text-[color:var(--rs-text-secondary)]">
                <input
                  checked={autoSkipReel}
                  className="h-4 w-4 accent-[color:var(--rs-accent-mining)]"
                  onChange={(event) => setAutoSkipReelPreference(event.target.checked)}
                  type="checkbox"
                />
                Auto-skip reel spin next time (Scavenge stays available)
              </label>
            </div>
          </>
        )}

        {stage !== "revealed" ? (
          <label className="inline-flex min-h-[var(--rs-touch-target)] items-center gap-2 text-sm text-[color:var(--rs-text-secondary)]">
            <input
              checked={autoSkipReel}
              className="h-4 w-4 accent-[color:var(--rs-accent-mining)]"
              onChange={(event) => setAutoSkipReelPreference(event.target.checked)}
              type="checkbox"
            />
            Auto-skip reel spin next time (Scavenge stays available)
          </label>
        ) : null}
        {message ? <Feedback tone="danger">{message}</Feedback> : null}
        <SectionHeader eyebrow="Presentation only">
          No timing or reward choice is made here.
        </SectionHeader>
        <p className="text-xs text-[color:var(--rs-text-muted)]">
          Reduced-motion mode bypasses the reel spin automatically. The committed inventory result
          is unchanged.
        </p>
      </div>
    </Drawer>
  );
}
