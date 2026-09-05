#!/usr/bin/env node

import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function shouldRunFullGate({ eventName: name, event: payload }) {
  if (name === "push" || name === "workflow_dispatch") return true;
  if (name !== "pull_request") return false;

  const action = payload.action;
  const pullRequest = payload.pull_request;
  const labels = Array.isArray(pullRequest?.labels)
    ? pullRequest.labels.map((label) => label.name)
    : [];
  const hasFullCiLabel = labels.includes("full-ci");

  if (action === "ready_for_review") return true;
  if (action === "labeled") {
    return payload.label?.name === "full-ci" || pullRequest?.draft === false;
  }
  if (action === "opened" || action === "reopened" || action === "synchronize") {
    return pullRequest?.draft === false || hasFullCiLabel;
  }

  return false;
}

export function shouldRequireMergeGate({ eventName: name, event: payload }) {
  if (name === "push" || name === "workflow_dispatch") return true;
  if (name !== "pull_request") return false;

  if (payload.action === "ready_for_review") return true;
  if (payload.action === "labeled") return payload.pull_request?.draft === false;
  if (
    payload.action === "opened" ||
    payload.action === "reopened" ||
    payload.action === "synchronize"
  ) {
    return payload.pull_request?.draft === false;
  }

  return false;
}

export function shouldRunScreenshotLane({ eventName: name, event: payload }) {
  if (name !== "pull_request" || !shouldRunFullGate({ eventName: name, event: payload })) {
    return false;
  }
  const labels = Array.isArray(payload.pull_request?.labels)
    ? payload.pull_request.labels.map((label) => label.name)
    : [];
  return labels.includes("e2e-screenshots");
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const outputPath = process.env.GITHUB_OUTPUT;

  if (!eventName || !eventPath || !outputPath) {
    throw new Error("GitHub event environment is required");
  }

  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  const full = shouldRunFullGate({ eventName, event });
  const mergeRequired = shouldRequireMergeGate({ eventName, event });
  const screenshots = shouldRunScreenshotLane({ eventName, event });
  appendFileSync(outputPath, `full=${full}\n`);
  appendFileSync(outputPath, `merge_required=${mergeRequired}\n`);
  appendFileSync(outputPath, `screenshots=${screenshots}\n`);
  console.log(
    `[ci-gate] ${full ? "full" : "fast-only"}, ${mergeRequired ? "merge-required" : "draft"}, ${screenshots ? "screenshots" : "no screenshots"}`,
  );
}
