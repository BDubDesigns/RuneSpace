"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { StatusMeter } from "@/components/ui/StatusMeter";
import { planPossibleAwardAdditions } from "@/game/domain/inventory";
import { scavengePossibleAwardSpecs, scavengeWindowAt } from "@/game/domain/scavenge";
import { GAME_TICK_MS } from "@/game/config/foundations";
import { claimScavengeAction } from "@/server/actions";
import { reportClientDiagnostic } from "@/features/diagnostics/client";
import { useMiningPlay } from "@/features/mining/MiningPlayContext";

function capacityMessage(reason: "slots" | "mass") {
  return reason === "mass"
    ? "Every possible find needs more carried-mass capacity."
    : "Every possible find needs an available inventory slot.";
}

export function ScavengeControl() {
  const {
    acceptState,
    enqueueForeground,
    foregroundBusy,
    releaseCommand,
    requestAutoRefresh,
    state,
  } = useMiningPlay();
  const [now, setNow] = useState(Date.now());
  const [claiming, setClaiming] = useState(false);
  const [message, setMessage] = useState<string>();
  const [announcement, setAnnouncement] = useState<string>();
  const [, startTransition] = useTransition();
  const previousLifecycle = useRef<string | undefined>(undefined);
  const travel = state.travelState;

  useEffect(() => {
    if (!travel) return;
    const clock = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(clock);
  }, [travel]);

  const scavenge = travel?.scavenge;
  const timing =
    travel && scavenge
      ? scavengeWindowAt({
          travelStartedAt: new Date(travel.startedAt),
          opportunityStartTick: scavenge.opportunityStartTick,
          now: new Date(now),
          claimed: Boolean(scavenge.outcome),
        })
      : undefined;
  const lifecycle = timing?.lifecycle ?? "waiting";
  const capacity = planPossibleAwardAdditions(
    state.inventory.stacks,
    scavengePossibleAwardSpecs(),
    state.inventory.slotsAvailable,
    Math.max(0, state.inventory.capacityGrams - state.inventory.massGrams),
  );

  useEffect(() => {
    if (previousLifecycle.current === lifecycle) return;
    previousLifecycle.current = lifecycle;
    setAnnouncement(
      lifecycle === "available"
        ? "Scavenge is available now for three seconds."
        : lifecycle === "missed"
          ? "Scavenge window missed. Travel continues normally."
          : undefined,
    );
    if (lifecycle !== "available") setMessage(undefined);
  }, [lifecycle]);

  if (!travel || !scavenge || !timing) return null;

  function claim() {
    if (lifecycle !== "available" || !capacity.ok || claiming) return;
    enqueueForeground(() => {
      setClaiming(true);
      startTransition(async () => {
        try {
          const result = await claimScavengeAction({ characterId: state.characterId });
          if ("error" in result) {
            setMessage(result.error);
            return;
          }
          acceptState(result.state);
          if (result.scavenge.status === "claimed") setMessage(undefined);
          else setMessage(result.scavenge.message);
        } catch (error) {
          reportClientDiagnostic("mining-command", error);
          setMessage("Comms interruption. Scavenge status could not be confirmed.");
          requestAutoRefresh();
        } finally {
          setClaiming(false);
          releaseCommand();
        }
      });
    });
  }

  const remainingMs = Math.max(0, timing.expiresAt.getTime() - now);
  const progress =
    lifecycle === "available"
      ? Math.min(100, Math.max(0, (remainingMs / (5 * GAME_TICK_MS)) * 100))
      : lifecycle === "claimed"
        ? 0
        : lifecycle === "missed"
          ? 0
          : 100;
  const buttonLabel =
    lifecycle === "claimed"
      ? "CLAIMED!"
      : lifecycle === "missed"
        ? "OPPORTUNITY PASSED"
        : lifecycle === "available" && !capacity.ok
          ? capacity.reason === "mass"
            ? "NEED MORE CARRY CAPACITY"
            : "NEED AN OPEN INVENTORY SLOT"
          : lifecycle === "available"
            ? "SCAVENGE NOW"
            : "SCAVENGE";

  return (
    <section
      aria-label="Travel Scavenge opportunity"
      className="mt-5 border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] p-3"
      data-scavenge-state={lifecycle}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-xs uppercase tracking-[0.16em] text-[color:var(--rs-accent-mining)]">
            Optional find
          </p>
          <p className="mt-1 font-display text-sm font-bold text-[color:var(--rs-text-primary)]">
            {lifecycle === "waiting"
              ? "Keep an eye out…"
              : lifecycle === "available"
                ? "Something turned up"
                : lifecycle === "missed"
                  ? "Scavenge missed"
                  : "Scavenge claimed"}
          </p>
        </div>
        <ActionButton
          aria-describedby="scavenge-opportunity-detail"
          disabled={
            lifecycle !== "available" || !capacity.ok || claiming || (foregroundBusy && !claiming)
          }
          intent="mining"
          loading={claiming}
          onClick={claim}
        >
          {buttonLabel}
        </ActionButton>
      </div>

      {lifecycle === "available" ? (
        <div className="mt-3" data-scavenge-countdown>
          <StatusMeter
            detail={`${(remainingMs / 1_000).toFixed(1)}s remaining`}
            label="Scavenge window"
            value={progress}
          />
        </div>
      ) : null}
      <p
        id="scavenge-opportunity-detail"
        className="mt-2 text-xs text-[color:var(--rs-text-secondary)]"
      >
        {lifecycle === "waiting"
          ? "This optional bonus does not change your walking time."
          : lifecycle === "available"
            ? capacity.ok
              ? "Claim it before the bar drains. The server decides the result."
              : capacityMessage(capacity.reason)
            : lifecycle === "missed"
              ? "The three-second window came and went; Travel is unaffected."
              : "The reward is committed. Complete its reveal to see it."}
      </p>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {message ? <Feedback tone="danger">{message}</Feedback> : null}
    </section>
  );
}
