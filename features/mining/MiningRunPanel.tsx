"use client";

import { RunSummary } from "@/features/shared/RunSummary";
import { miningNearMissBasisPoints } from "@/game/domain/mining";
import type { MiningRunAttempt, MiningRunState } from "@/server/mining";
import type { EffectiveGameBalance } from "@/game/config/balance";

function percentage(bps: number) {
  return (bps / 100).toFixed(2);
}

/**
 * Mining's run totals and its bounded attempt history, in the shared run
 * summary (#193). It renders inside the Mining activity panel rather than as a
 * panel of its own, so the numbers sit with the controls that produced them.
 *
 * History holds the attempts *before* the current one. The newest attempt is
 * already presented in full, with its rewards and its result animation, by the
 * activity above (`MiningActivity`'s latest-attempt block), so repeating it
 * here would put the same attempt on screen twice the moment a player opened
 * the disclosure — which is exactly the duplication this issue removed.
 */
export function MiningRunPanel({
  run,
  balance,
}: {
  run: MiningRunState;
  balance: EffectiveGameBalance;
}) {
  // Everything except the newest, which the activity itself is showing.
  const priorAttempts = run.recentAttempts.slice(0, -1);
  return (
    <RunSummary
      historyLabel="Mining attempt history"
      stats={[
        { label: "attempts", value: run.attempts },
        { label: "successful", value: run.successes },
        { label: "failed", value: run.failures },
        { label: "shale gained", value: run.shaleGained },
        { label: "Mining XP", value: run.xpGained },
      ]}
      title="This mining run"
      {...(priorAttempts.length > 0
        ? {
            history: [...priorAttempts]
              .reverse()
              .map((attempt) => (
                <MiningAttemptRow attempt={attempt} balance={balance} key={attempt.sequence} />
              )),
          }
        : {})}
    />
  );
}

function MiningAttemptRow({
  attempt,
  balance,
}: {
  attempt: MiningRunAttempt;
  balance: EffectiveGameBalance;
}) {
  return (
    <article className="border-l-2 border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-panel)] px-3 py-2 text-sm">
      <p className="font-display uppercase tracking-wide">
        Attempt {attempt.sequence} - {attempt.success ? "Success" : "Failed"}
      </p>
      <p className="text-[color:var(--rs-text-secondary)]">
        Roll {percentage(attempt.rolledBasisPoints)} | Needed below{" "}
        {percentage(attempt.thresholdBasisPoints)}
      </p>
      <p className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
        {attempt.boosted
          ? `Boosted · ${attempt.durationTicks} ticks · charge consumed: ${attempt.chargeConsumed ? "yes" : "no"} · ${attempt.remainingCharge} / ${balance.items.salvageCutter.maximumCharge} remaining`
          : `Normal · ${attempt.durationTicks} ticks`}
      </p>
      <p className="text-xs text-[color:var(--rs-text-muted)]">
        Resolved {new Date(attempt.resolvedAt).toLocaleTimeString()}
      </p>
      {attempt.success ? (
        <p>
          {attempt.shaleAwarded} Ferrite Shale | {attempt.xpAwarded} Mining XP
        </p>
      ) : (
        <p>
          Missed by{" "}
          {percentage(
            miningNearMissBasisPoints(attempt.rolledBasisPoints, attempt.thresholdBasisPoints),
          )}
        </p>
      )}
    </article>
  );
}
