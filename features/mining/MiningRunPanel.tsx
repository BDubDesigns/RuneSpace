"use client";

import { RunSummary } from "@/features/shared/RunSummary";
import { miningNearMissBasisPoints } from "@/game/domain/mining";
import { resolveItemPresentation } from "@/game/content/item-presentation";
import type { MiningRunAttempt, MiningRunState } from "@/server/mining";
import type { MiningSourceProjection } from "@/server/play";
import { remainingChargeLabel } from "./latest-result";
import { XpAmount, XpMark } from "@/components/ui/XpAmount";
import { SKILL_IDS } from "@/game/config/foundations";

function percentage(bps: number) {
  return (bps / 100).toFixed(2);
}

/** The item's authoritative display name, by its stable ID. */
function itemName(itemId: string): string {
  return resolveItemPresentation(itemId, itemId).displayName;
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
  maximumCharge,
  source,
}: {
  run: MiningRunState;
  /** The equipped Mining tool's own maximum charge, when one is equipped (#233). */
  maximumCharge: number | undefined;
  /** The source being worked, so an empty run still names what it would yield. */
  source: MiningSourceProjection;
}) {
  // Everything except the newest, which the activity itself is showing.
  const priorAttempts = run.recentAttempts.slice(0, -1);
  // A run's totals are keyed by item, so a Galvanite run reads as Galvanite
  // without this panel knowing either ore exists (#209). An untouched run has
  // no keys yet, so the current source stands in at zero rather than the row
  // disappearing.
  const gained = Object.entries(run.itemsGained);
  // The source's own ore is "gained"; an item its authored Secondary Find table
  // lists is "found" (#308) — read from the source, never inferred from "not the ore".
  const gainedRows = (gained.length > 0 ? gained : [[source.itemId, 0] as const]).map(
    ([itemId, quantity]) => ({
      label: `${itemName(itemId)} ${source.secondaryFindItemIds.includes(itemId) ? "found" : "gained"}`,
      value: quantity,
    }),
  );
  return (
    <RunSummary
      historyLabel="Mining attempt history"
      stats={[
        { label: "attempts", value: run.attempts },
        { label: "successful", value: run.successes },
        { label: "failed", value: run.failures },
        ...gainedRows,
        {
          id: "xp",
          label: (
            <>
              Mining <XpMark skillId={SKILL_IDS.mining} />
            </>
          ),
          value: run.xpGained,
        },
      ]}
      title="This mining run"
      {...(priorAttempts.length > 0
        ? {
            history: [...priorAttempts]
              .reverse()
              .map((attempt) => (
                <MiningAttemptRow
                  attempt={attempt}
                  key={attempt.sequence}
                  maximumCharge={maximumCharge}
                />
              )),
          }
        : {})}
    />
  );
}

function MiningAttemptRow({
  attempt,
  maximumCharge,
}: {
  attempt: MiningRunAttempt;
  maximumCharge: number | undefined;
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
          ? `Boosted · ${attempt.durationTicks} ticks · charge consumed: ${attempt.chargeConsumed ? "yes" : "no"} · ${remainingChargeLabel(attempt.remainingCharge, maximumCharge)}`
          : `Normal · ${attempt.durationTicks} ticks`}
      </p>
      <p className="text-xs text-[color:var(--rs-text-muted)]">
        Resolved {new Date(attempt.resolvedAt).toLocaleTimeString()}
      </p>
      {attempt.success ? (
        <p>
          {attempt.quantityAwarded} {itemName(attempt.itemId)}
          {attempt.secondaryFinds.map((find) => (
            <span data-rare-find-entry={find.itemId} key={find.itemId}>
              {" "}
              + {find.quantity} {itemName(find.itemId)} (rare find)
            </span>
          ))}{" "}
          | <XpAmount amount={attempt.xpAwarded} skillId={SKILL_IDS.mining} skillName="Mining" />
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
