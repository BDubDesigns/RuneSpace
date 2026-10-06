import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OPTIONAL_JOBS, REQUIRED_JOBS, evaluateMergeGate } from "@/scripts/ci-merge-gate.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOW = readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8");
const WORKFLOW_CODE = WORKFLOW.split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");

// The repository has no YAML parser dependency. ci.yml's job ids sit at a fixed
// two-space indent under `jobs:`, which is all these structural checks need.
function workflowJobs(): Map<string, string> {
  const body = WORKFLOW_CODE.slice(WORKFLOW_CODE.indexOf("\njobs:\n") + "\njobs:\n".length);
  const jobs = new Map<string, string>();
  const headers = [...body.matchAll(/^ {2}([a-z0-9-]+):\n/gm)];
  headers.forEach((match, index) => {
    const end = headers[index + 1]?.index ?? body.length;
    jobs.set(match[1]!, body.slice(match.index, end));
  });
  return jobs;
}

function jobNeeds(block: string): string[] {
  const match = /^ {4}needs: \[([^\]]*)\]$/m.exec(block);
  return match ? match[1]!.split(",").map((need) => need.trim()) : [];
}

function jobCondition(block: string): string | undefined {
  return /^ {4}if: (.+)$/m.exec(block)?.[1];
}

function needsWith(results: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(results).map(([job, result]) => [job, { result, outputs: {} }]),
  );
}

const ALL_GREEN = {
  "fast-checks": "success",
  integration: "success",
  "canonical-e2e": "success",
  "canonical-screenshots": "skipped",
};

describe("merge gate verdict", () => {
  it("passes when every required lane succeeds and screenshots were not requested", () => {
    expect(evaluateMergeGate(needsWith(ALL_GREEN))).toEqual({ passed: true, failures: [] });
  });

  it("passes when the requested screenshot lane also succeeds", () => {
    expect(
      evaluateMergeGate(needsWith({ ...ALL_GREEN, "canonical-screenshots": "success" })).passed,
    ).toBe(true);
  });

  it.each(["failure", "skipped", "cancelled"])(
    "fails when the fast/build lane is %s even though browser and integration lanes passed",
    (result) => {
      expect(evaluateMergeGate(needsWith({ ...ALL_GREEN, "fast-checks": result }))).toEqual({
        passed: false,
        failures: [`fast-checks: ${result}`],
      });
    },
  );

  it.each(["integration", "canonical-e2e"])("fails when %s did not succeed", (job) => {
    for (const result of ["failure", "skipped", "cancelled"]) {
      expect(evaluateMergeGate(needsWith({ ...ALL_GREEN, [job]: result })).passed).toBe(false);
    }
  });

  it("fails when a required lane is missing from the gate's needs", () => {
    const { "fast-checks": _omitted, ...withoutFast } = ALL_GREEN;
    expect(evaluateMergeGate(needsWith(withoutFast)).failures).toEqual(["fast-checks: missing"]);
    expect(evaluateMergeGate({}).passed).toBe(false);
    expect(evaluateMergeGate(undefined).passed).toBe(false);
  });

  it("fails when a requested screenshot lane ran and did not succeed", () => {
    for (const result of ["failure", "cancelled"]) {
      expect(
        evaluateMergeGate(needsWith({ ...ALL_GREEN, "canonical-screenshots": result })).passed,
      ).toBe(false);
    }
  });
});

describe("CI workflow contract", () => {
  const jobs = workflowJobs();
  const lanes = [...jobs.keys()].filter((job) => job !== "merge-gate");

  it("starts every validation lane together, with no lane waiting on another", () => {
    expect([...lanes].sort()).toEqual([...REQUIRED_JOBS, ...OPTIONAL_JOBS].sort());
    for (const lane of lanes) {
      expect(jobNeeds(jobs.get(lane)!), lane).toEqual([]);
    }
  });

  it("runs every required lane unconditionally and screenshots only on the label", () => {
    for (const lane of REQUIRED_JOBS) {
      expect(jobCondition(jobs.get(lane)!), lane).toBeUndefined();
    }
    expect(jobCondition(jobs.get("canonical-screenshots")!)).toBe(
      "${{ contains(github.event.pull_request.labels.*.name, 'e2e-screenshots') }}",
    );
  });

  it("runs five canonical E2E shards that agree on the shard total", () => {
    const e2e = jobs.get("canonical-e2e")!;
    expect(e2e).toMatch(/^ {8}shard: \[1, 2, 3, 4, 5\]$/m);
    expect(e2e).toContain("name: Canonical E2E shard ${{ matrix.shard }}/5");
    expect(e2e).toMatch(/^ {6}RUNESPACE_E2E_SHARD_TOTAL: 5$/m);
    expect(e2e).toMatch(/^ {6}RUNESPACE_E2E_WORKERS: 2$/m);
  });

  it("makes the merge gate depend on every lane and report failed or skipped ones", () => {
    const gate = jobs.get("merge-gate")!;
    expect(gate).toMatch(/^ {4}name: Merge gate$/m);
    expect(jobNeeds(gate).sort()).toEqual([...lanes].sort());
    // Without always() the gate would itself be skipped after a failed lane or
    // a canceled run, and GitHub reports a skipped job as passing.
    expect(jobCondition(gate)).toBe("${{ always() }}");
    expect(gate).toContain("NEEDS_JSON: ${{ toJSON(needs) }}");
    expect(gate).toContain("run: node scripts/ci-merge-gate.mjs");
  });

  it("runs full CI on every PR revision without draft, label, or Ready gating", () => {
    const pullRequestTypes = /pull_request:\n {4}types:\n((?: {6}- \S+\n)+)/.exec(
      WORKFLOW_CODE,
    )?.[1];
    expect([...(pullRequestTypes ?? "").matchAll(/- (\S+)/g)].map((match) => match[1])).toEqual([
      "opened",
      "reopened",
      "synchronize",
      "labeled",
    ]);
    expect(WORKFLOW_CODE).not.toMatch(/draft|ready_for_review|full-ci/);
  });

  it("runs on main pushes and keeps manual dispatch for reproduction", () => {
    expect(WORKFLOW_CODE).toMatch(/^ {2}push:\n {4}branches: \[main\]$/m);
    expect(WORKFLOW_CODE).toMatch(/^ {2}workflow_dispatch:$/m);
  });

  it("cancels superseded PR runs while main and manual runs keep unique groups", () => {
    expect(WORKFLOW_CODE).toContain("format('ci-pr-{0}', github.event.pull_request.number)");
    expect(WORKFLOW_CODE).toContain("|| format('ci-run-{0}', github.run_id)");
    expect(WORKFLOW_CODE).toContain(
      "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    );
  });
});
