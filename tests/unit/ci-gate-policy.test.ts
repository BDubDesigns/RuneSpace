import { describe, expect, it } from "vitest";
import { shouldRequireMergeGate, shouldRunFullGate } from "@/scripts/select-ci-gate.mjs";

function pullRequestEvent(
  action: string,
  { draft = true, labels = [] }: { draft?: boolean; labels?: string[] } = {},
) {
  const event = {
    action,
    pull_request: {
      draft,
      labels: labels.map((name) => ({ name })),
    },
  };
  return action === "labeled" ? { ...event, label: { name: labels.at(-1) } } : event;
}

describe("full CI gate selection", () => {
  it("keeps an ordinary draft synchronization fast-only", () => {
    expect(
      shouldRunFullGate({
        eventName: "pull_request",
        event: pullRequestEvent("synchronize"),
      }),
    ).toBe(false);
  });

  it("runs the full gate when full-ci is applied to a draft", () => {
    expect(
      shouldRunFullGate({
        eventName: "pull_request",
        event: pullRequestEvent("labeled", { labels: ["full-ci"] }),
      }),
    ).toBe(true);
  });

  it("keeps running the full gate for pushes while full-ci remains applied", () => {
    expect(
      shouldRunFullGate({
        eventName: "pull_request",
        event: pullRequestEvent("synchronize", { labels: ["full-ci"] }),
      }),
    ).toBe(true);
  });

  it("runs the full gate when a draft becomes ready without a push", () => {
    expect(
      shouldRunFullGate({
        eventName: "pull_request",
        event: pullRequestEvent("ready_for_review", { draft: false }),
      }),
    ).toBe(true);
  });

  it("runs the full gate for a pushed ready PR", () => {
    expect(
      shouldRunFullGate({
        eventName: "pull_request",
        event: pullRequestEvent("synchronize", { draft: false }),
      }),
    ).toBe(true);
  });

  it("does not treat another label as a full-gate request", () => {
    expect(
      shouldRunFullGate({
        eventName: "pull_request",
        event: pullRequestEvent("labeled", { labels: ["e2e-screenshots"] }),
      }),
    ).toBe(false);
  });

  it("runs the full gate on main pushes and manual dispatch", () => {
    expect(shouldRunFullGate({ eventName: "push", event: {} })).toBe(true);
    expect(shouldRunFullGate({ eventName: "workflow_dispatch", event: {} })).toBe(true);
  });

  it("keeps the merge gate unsatisfied for draft checkpoints", () => {
    expect(
      shouldRequireMergeGate({
        eventName: "pull_request",
        event: pullRequestEvent("synchronize"),
      }),
    ).toBe(false);
    expect(
      shouldRequireMergeGate({
        eventName: "pull_request",
        event: pullRequestEvent("labeled", { labels: ["full-ci"] }),
      }),
    ).toBe(false);
  });

  it("requires the merge gate for ready PR revisions and ready-label events", () => {
    expect(
      shouldRequireMergeGate({
        eventName: "pull_request",
        event: pullRequestEvent("ready_for_review", { draft: false }),
      }),
    ).toBe(true);
    expect(
      shouldRequireMergeGate({
        eventName: "pull_request",
        event: pullRequestEvent("synchronize", { draft: false }),
      }),
    ).toBe(true);
    expect(
      shouldRequireMergeGate({
        eventName: "pull_request",
        event: pullRequestEvent("labeled", { draft: false, labels: ["e2e-screenshots"] }),
      }),
    ).toBe(true);
    expect(
      shouldRunFullGate({
        eventName: "pull_request",
        event: pullRequestEvent("labeled", { draft: false, labels: ["e2e-screenshots"] }),
      }),
    ).toBe(true);
  });

  it("does not run the full gate when a ready PR is converted back to draft", () => {
    expect(
      shouldRunFullGate({
        eventName: "pull_request",
        event: pullRequestEvent("converted_to_draft"),
      }),
    ).toBe(false);
  });
});
