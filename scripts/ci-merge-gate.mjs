#!/usr/bin/env node

// The `Merge gate` job's verdict. It receives the workflow's `needs` context as
// JSON and passes only when every required lane succeeded. "Skipped" is never a
// pass for a required lane: GitHub reports a skipped job as successful to branch
// protection, so a skipped fast job must not hide behind green browser shards.

import { fileURLToPath } from "node:url";

// Job ids from .github/workflows/ci.yml. canonical-e2e is the five-shard
// matrix; GitHub reports one aggregate result that succeeds only if all do.
export const REQUIRED_JOBS = ["fast-checks", "integration", "canonical-e2e"];

// Opt-in through the `e2e-screenshots` label. The job has no dependencies, so it
// is skipped only when not requested; once it runs, it must succeed.
export const OPTIONAL_JOBS = ["canonical-screenshots"];

export function evaluateMergeGate(needs) {
  const failures = [];
  for (const job of REQUIRED_JOBS) {
    const result = needs?.[job]?.result ?? "missing";
    if (result !== "success") failures.push(`${job}: ${result}`);
  }
  for (const job of OPTIONAL_JOBS) {
    const result = needs?.[job]?.result ?? "missing";
    if (result !== "success" && result !== "skipped") failures.push(`${job}: ${result}`);
  }
  return { passed: failures.length === 0, failures };
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const needs = JSON.parse(process.env.NEEDS_JSON ?? "{}");
  for (const job of [...REQUIRED_JOBS, ...OPTIONAL_JOBS]) {
    console.log(`[merge-gate] ${job}: ${needs[job]?.result ?? "missing"}`);
  }
  if (process.env.PR_HEAD_SHA) {
    console.log(`[merge-gate] PR head ${process.env.PR_HEAD_SHA}`);
  }

  const { passed, failures } = evaluateMergeGate(needs);
  if (!passed) {
    console.error(`[merge-gate] Every required lane must succeed: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("[merge-gate] Merge validation passed.");
}
