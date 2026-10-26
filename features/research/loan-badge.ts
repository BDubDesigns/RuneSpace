import { RESEARCH_JOBS } from "@/game/content/research-jobs";
import type { PlayGameplayState } from "@/server/play";

/**
 * The short badge on a research loan's Inventory tile (#406): the Survey's
 * collected count out of its total, and a recorded Calibration sampler. Derived
 * from the server's projection of the held run; other items have none.
 */
export function loanBadge(state: PlayGameplayState, itemId: string): string | undefined {
  const job = RESEARCH_JOBS.find((candidate) => candidate.loanItemId === itemId);
  const assignment = state.research.assignment;
  if (!job || assignment?.jobId !== job.id) return undefined;
  if (job.kind === "survey") return `${assignment.progress.current}/${assignment.progress.target}`;
  if (job.kind === "calibration" && assignment.recorded) return "REC";
  return undefined;
}
