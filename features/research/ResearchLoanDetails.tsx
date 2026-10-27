"use client";

import { usePlay } from "@/features/play/PlayContext";
import { getLocation } from "@/game/content/locations";
import { RESEARCH_JOBS } from "@/game/content/research-jobs";
import { assignmentFactsOf, researchStage } from "@/game/domain/research-jobs";

/**
 * The Item Details of a Wise Old Enby research loan (#406): that it is borrowed
 * and what state it is in. Read-only: every fact is the server's projection of
 * the held run, so opening this changes nothing. The loan is an ordinary carried
 * item; it simply cannot be sold, traded, stored or mailed, and a player gives
 * it up with Abandon Assignment (Mission Log) or Destroy (`ResearchLoanDestroy`).
 */
export function ResearchLoanDetails({ itemId }: { itemId: string }) {
  const { state } = usePlay();
  const job = RESEARCH_JOBS.find((candidate) => candidate.loanItemId === itemId);
  const assignment = state.research.assignment;
  if (!job) return null;
  const mine = assignment?.jobId === job.id ? assignment : undefined;
  const facts = assignmentFactsOf(mine);

  return (
    <div
      className="mt-3 space-y-2 border-t border-[color:var(--rs-border-subtle)] pt-3 text-sm text-[color:var(--rs-text-secondary)]"
      data-research-loan-details={job.id}
    >
      <p className="text-xs uppercase tracking-wide text-[color:var(--rs-text-muted)]">
        On loan from The Wise Old Enby — cannot be sold, traded, stored or dropped.
      </p>
      <p>
        <span className="font-semibold text-[color:var(--rs-text-primary)]">Assignment:</span>{" "}
        {job.title}
      </p>
      {job.kind === "survey" ? (
        <ul className="space-y-1" data-research-loan-sites>
          {job.siteLocationIds.map((site) => {
            const collected = mine?.sampledLocationIds.includes(site) ?? false;
            return (
              <li data-research-site={site} data-research-site-collected={collected} key={site}>
                {collected ? "✓ Collected" : "· Missing"} — {getLocation(site)?.displayName ?? site}
              </li>
            );
          })}
        </ul>
      ) : null}
      {job.kind === "calibration" ? (
        <p data-research-loan-recorded={mine?.recorded ?? false}>
          <span className="font-semibold text-[color:var(--rs-text-primary)]">Signature:</span>{" "}
          {mine?.recorded ? "Signature Recorded" : "Not recorded"}
        </p>
      ) : null}
      {facts && job.kind !== "survey" && job.kind !== "calibration" ? (
        <p>
          {researchStage(job, facts) === "ready"
            ? "Delivered."
            : `Deliver this to the FedHex terminal at ${getLocation(job.deliveryLocationId)?.displayName}.`}
        </p>
      ) : null}
      {facts && researchStage(job, facts) === "ready" ? (
        <p>Return to The Wise Old Enby at Hilltop Workshop.</p>
      ) : null}
      {!mine ? <p className="text-xs">This loan is not tied to a current assignment.</p> : null}
    </div>
  );
}
